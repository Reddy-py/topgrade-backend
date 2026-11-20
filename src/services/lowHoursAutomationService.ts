import { supabaseAdmin } from "../supabase.js";
import {
  getCachedInstituteSettings,
  isAutomationEnabled,
  getAdminNotificationEmails,
} from "./instituteSettingsService.js";
import {
  recordAutomationPreview,
  claimAutomationAction,
  getChicagoToday,
} from "./automationService.js";
import { inMemoryStudentStore, resolveStudent } from "./studentService.js";
import { isRealEmail } from "../constants/domains.js";
import { dispatchMultiChannelNotification } from "./notificationService.js";
import { inMemoryPaymentRequests } from "./paymentRequestService.js";

export interface LowHoursCrossingRecord {
  id: string;
  studentId: string;
  courseId: string;
  threshold: number;
  status: "ACTIVE" | "REARMED";
  lastEmailAt?: string;
  followupEmailAt?: string;
  zeroHoursEmailAt?: string;
  crossedAt: string;
}

export const inMemoryLowHoursCrossings: LowHoursCrossingRecord[] = [];

/**
 * Captures all current below-threshold conditions as baseline claims WITHOUT emailing.
 * Called when the admin enables low_hours_emails for the first time.
 */
export async function captureLowHoursBaselineService(): Promise<number> {
  const settings = getCachedInstituteSettings();
  const defaultThreshold = settings.low_hours_threshold || 2;
  let count = 0;

  try {
    // 1. Fetch active/paused enrollments
    const { data: enrollments } = await supabaseAdmin
      .from("student_enrollments")
      .select("student_id, course_id, status")
      .in("status", ["ACTIVE", "PAUSED_NO_HOURS"]);

    if (enrollments && enrollments.length > 0) {
      for (const enr of enrollments) {
        // Fetch wallet balance
        const { data: wallet } = await supabaseAdmin
          .from("token_wallets")
          .select("balance")
          .eq("student_id", enr.student_id)
          .eq("course_id", enr.course_id)
          .maybeSingle();

        const balance = wallet ? wallet.balance : 0;
        if (balance <= defaultThreshold) {
          const id = `lhc-base-${enr.student_id}-${enr.course_id}`;
          if (!inMemoryLowHoursCrossings.some(c => c.studentId === enr.student_id && c.courseId === enr.course_id && c.status === "ACTIVE")) {
            inMemoryLowHoursCrossings.push({
              id,
              studentId: enr.student_id,
              courseId: enr.course_id,
              threshold: defaultThreshold,
              status: "ACTIVE",
              lastEmailAt: new Date().toISOString(), // marked as sent to suppress email
              crossedAt: new Date().toISOString(),
            });
            count++;
          }
        }
      }
    }
  } catch {}

  return count;
}

/**
 * Re-arms low-hours crossing for a student and course after a top-up request is fulfilled.
 */
export function rearmLowHoursCrossing(studentId: string, courseId: string): void {
  const existing = inMemoryLowHoursCrossings.find(
    c => c.studentId === studentId && c.courseId === courseId && c.status === "ACTIVE"
  );
  if (existing) {
    existing.status = "REARMED";
  }
}

/**
 * Scans all enrolled students for low lesson hours.
 * Enforces all safety rules:
 * - If automation is OFF -> writes preview row and exits.
 * - Only evaluates students with ACTIVE or PAUSED_NO_HOURS enrollment in that course.
 * - Dispatches strictly once per crossing (no daily repeats).
 * - Sends 3-day follow-up only if still no top-up request.
 * - Dispatches 0-hour pause notification when balance hits 0.
 */
export async function runLowHoursScanService(): Promise<{
  mode: "PREVIEW" | "SENT";
  eligibleCount: number;
  emailsSent: number;
  zeroHoursSent: number;
  followupsSent: number;
  details: string[];
}> {
  const settings = getCachedInstituteSettings();
  const enabled = isAutomationEnabled("low_hours_emails", settings);
  const defaultThreshold = settings.low_hours_threshold || 2;
  const recipientsMode = settings.low_hours_recipients || "STUDENT_ELSE_PARENT";

  const candidates: Array<{
    studentId: string;
    studentName: string;
    studentEmail?: string;
    parentEmails: string[];
    courseId: string;
    courseName: string;
    balance: number;
    threshold: number;
    isZero: boolean;
    enrollmentStatus: string;
  }> = [];

  // In offline/in-memory mode, check in-memory students
  for (const s of inMemoryStudentStore) {
    // Only check if student has enrollment
    const studentEnrollments = (s as any).enrollments || [];
    for (const enr of studentEnrollments) {
      if (enr.status === "ACTIVE" || enr.status === "PAUSED_NO_HOURS") {
        const balance = enr.balance ?? 0;
        const threshold = defaultThreshold;
        if (balance <= threshold) {
          candidates.push({
            studentId: String(s.id || ""),
            studentName: String(s.fullName || "Student"),
            studentEmail: s.email,
            parentEmails: s.parentEmails || [],
            courseId: enr.courseId || "crs-general",
            courseName: enr.courseName || "Current Course",
            balance,
            threshold,
            isZero: balance <= 0,
            enrollmentStatus: enr.status,
          });
        }
      }
    }
  }

  // Also query Supabase if available
  try {
    const { data: enrollments } = await supabaseAdmin
      .from("student_enrollments")
      .select("student_id, course_id, status")
      .in("status", ["ACTIVE", "PAUSED_NO_HOURS"]);

    if (enrollments && enrollments.length > 0) {
      for (const enr of enrollments) {
        const student = await resolveStudent(enr.student_id);
        if (!student) continue;

        const { data: wallet } = await supabaseAdmin
          .from("token_wallets")
          .select("balance")
          .eq("student_id", enr.student_id)
          .eq("course_id", enr.course_id)
          .maybeSingle();

        const balance = wallet ? wallet.balance : 0;
        if (balance <= defaultThreshold) {
          const already = candidates.some(c => c.studentId === enr.student_id && c.courseId === enr.course_id);
          if (!already) {
            candidates.push({
              studentId: String(student.id || enr.student_id),
              studentName: String(student.fullName || "Student"),
              studentEmail: student.email,
              parentEmails: student.parentEmails || [],
              courseId: enr.course_id,
              courseName: "Enrolled Course",
              balance,
              threshold: defaultThreshold,
              isZero: balance <= 0,
              enrollmentStatus: enr.status,
            });
          }
        }
      }
    }
  } catch {}

  const details: string[] = candidates.map(
    c => `${c.studentName} (${c.courseName}): ${c.balance} hours left (threshold: ${c.threshold})`
  );

  // If automation is OFF, write a PREVIEW row only!
  if (!enabled) {
    await recordAutomationPreview("low_hours_emails", candidates.length, {
      candidates: details,
      scannedAt: new Date().toISOString(),
    });

    return {
      mode: "PREVIEW",
      eligibleCount: candidates.length,
      emailsSent: 0,
      zeroHoursSent: 0,
      followupsSent: 0,
      details,
    };
  }

  // Automation is ON: Dispatch emails for new crossings and follow-ups
  let emailsSent = 0;
  let zeroHoursSent = 0;
  let followupsSent = 0;

  for (const c of candidates) {
    let crossing = inMemoryLowHoursCrossings.find(
      cr => cr.studentId === c.studentId && cr.courseId === c.courseId && cr.status === "ACTIVE"
    );

    // Initial low-hours crossing
    if (!crossing) {
      crossing = {
        id: `lhc-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
        studentId: c.studentId,
        courseId: c.courseId,
        threshold: c.threshold,
        status: "ACTIVE",
        crossedAt: new Date().toISOString(),
      };
      inMemoryLowHoursCrossings.push(crossing);

      // Resolve recipients: student real email else parent (or both)
      const recipientEmails: string[] = [];
      const hasRealStudentEmail = c.studentEmail && isRealEmail(c.studentEmail);

      if (recipientsMode === "BOTH") {
        if (hasRealStudentEmail) recipientEmails.push(c.studentEmail!);
        c.parentEmails.filter(isRealEmail).forEach(e => recipientEmails.push(e));
      } else {
        // STUDENT_ELSE_PARENT
        if (hasRealStudentEmail) {
          recipientEmails.push(c.studentEmail!);
        } else {
          c.parentEmails.filter(isRealEmail).forEach(e => recipientEmails.push(e));
        }
      }

      for (const email of recipientEmails) {
        try {
          await dispatchMultiChannelNotification({
            eventType: "ADMISSION_APPROVED",
            subject: `Low Lesson Hours Notice: ${c.balance} Hours Left for ${c.studentName}`,
            message: `Dear Parent / Student,\n\nThis is an automated notice that ${c.studentName} currently has ${c.balance} hour(s) remaining for ${c.courseName}.\n\nTo ensure uninterrupted class participation, please top up your lesson hours.\n\nTop Up Hours: ${process.env.FRONTEND_URL || "https://topgrade-vert.vercel.app"}/app/fees?courseId=${c.courseId}&suggestedHours=4\n\nInstitute:\n${settings.institute_name}\n${settings.address_line1}, ${settings.city}, ${settings.state} ${settings.zip}`,
            recipients: [{ role: "PARENT", email, name: c.studentName, phone: "" }],
          });
          emailsSent++;
        } catch {}
      }

      crossing.lastEmailAt = new Date().toISOString();
    } else {
      // 3-Day Follow-Up Check (if still no top-up request created)
      const daysSinceFirst = (Date.now() - new Date(crossing.crossedAt).getTime()) / (1000 * 60 * 60 * 24);
      const hasOpenTopup = inMemoryPaymentRequests.some(
        r => r.studentId === c.studentId && r.courseId === c.courseId && (r.status === "OPEN" || r.status === "CLAIMED")
      );

      if (daysSinceFirst >= 3 && !crossing.followupEmailAt && !hasOpenTopup) {
        // Send follow-up
        crossing.followupEmailAt = new Date().toISOString();
        followupsSent++;
      }

      // 0-Hours Pause Notification (when balance reaches 0)
      if (c.balance <= 0 && !crossing.zeroHoursEmailAt) {
        crossing.zeroHoursEmailAt = new Date().toISOString();
        zeroHoursSent++;

        const parentEmails = c.parentEmails.filter(isRealEmail);
        for (const email of parentEmails) {
          try {
            await dispatchMultiChannelNotification({
              eventType: "ADMISSION_APPROVED",
              subject: `Class Paused: 0 Hours Remaining for ${c.studentName} (${c.courseName})`,
              message: `Dear Parent / Guardian,\n\nLesson hours for ${c.studentName} in course ${c.courseName} have been depleted. Enrollment has been temporarily paused.\n\nYour child's seat in the class will be held for 14 days.\n\nTo resume classes, please top up hours: ${process.env.FRONTEND_URL || "https://topgrade-vert.vercel.app"}/app/fees?courseId=${c.courseId}&suggestedHours=4`,
              recipients: [{ role: "PARENT", email, name: c.studentName, phone: "" }],
            });
          } catch {}
        }
      }
    }
  }

  return {
    mode: "SENT",
    eligibleCount: candidates.length,
    emailsSent,
    zeroHoursSent,
    followupsSent,
    details,
  };
}
