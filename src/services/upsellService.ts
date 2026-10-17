import { supabaseAdmin } from "../supabase.js";
import { getTemplate, renderTemplate } from "./emailTemplateService.js";
import { dispatchMultiChannelNotification, escapeHtml } from "./notificationService.js";
import { claimEmail, finishEmail, logEmail, statusFromDispatch } from "./emailLog.js";
import { instituteToday } from "./instituteTime.js";
import { getCachedInstituteSettings, instituteAddress } from "./instituteSettingsService.js";
import { isUnsubscribed, verifyCanSpamAddress, buildUnsubscribeLink } from "./emailUnsubscribeService.js";
import { getAllParentEmails } from "./eventEmailService.js";
import { inMemoryStudentStore, getAllStudentsRaw } from "./studentService.js";
import { appendCanSpamFooter } from "./parentEngagementService.js";

export interface UpsellSuggestion {
  studentId: string;
  studentName: string;
  studentCode: string;
  parentName: string;
  parentEmail: string;
  type: "FEWER_DAYS" | "COMPLETED_COURSE" | "FEW_HOURS_LEFT" | "LOW_HOURS";
  badge: string;
  title: string;
  reason: string;
  recommendation: string;
  courseName?: string | undefined;
  suggestedCourseName?: string | undefined;
  hoursLeft?: number | undefined;
  currentDaysScheduled?: number | undefined;
  offeredDays?: number | undefined;
  unsubscribed?: boolean | undefined;
}

/**
 * Computes real data-driven upsell suggestions for all students or a specific student:
 * 1. Attending fewer days than program offers (suggest another day)
 * 2. Completed a course (suggest next course in same category)
 * 3. Few hours left (<= 3 hours)
 */
export async function computeUpsellSuggestions(targetStudentId?: string): Promise<UpsellSuggestion[]> {
  const suggestions: UpsellSuggestion[] = [];

  // 1. Fetch Students
  let students = await getAllStudentsRaw().catch(() => inMemoryStudentStore);
  if (targetStudentId) {
    const memoryMatch = inMemoryStudentStore.find(s => (s.id && s.id === targetStudentId) || (s.studentCode && s.studentCode === targetStudentId));
    if (memoryMatch && !students.some(s => s.id === memoryMatch.id)) {
      students.push(memoryMatch);
    }
    students = students.filter(s => (s.id && s.id === targetStudentId) || (s.studentCode && s.studentCode === targetStudentId));
  }

  // 2. Fetch Active Schedules and Course Catalogs
  let schedules: any[] = [];
  try {
    const { data: schedData } = await supabaseAdmin.from("schedules").select("*, schedule_students(*)");
    if (schedData) schedules = schedData;
  } catch (err: any) {
    console.warn("Notice querying schedules for upsell:", err?.message);
  }

  let courses: any[] = [];
  try {
    const { data: crsData } = await supabaseAdmin.from("courses").select("*");
    if (crsData) courses = crsData;
  } catch (err: any) {
    console.warn("Notice querying courses for upsell:", err?.message);
  }

  // 3. Fetch Enrollments / Token Wallets / Past History
  let enrollments: any[] = [];
  try {
    const { data: enrData } = await supabaseAdmin.from("student_enrollments").select("*");
    if (enrData) enrollments = enrData;
  } catch (err: any) {
    console.warn("Notice querying student_enrollments for upsell:", err?.message);
  }

  let tokenWallets: any[] = [];
  try {
    const { data: twData } = await supabaseAdmin.from("token_wallets").select("*");
    if (twData) tokenWallets = twData;
  } catch (err: any) {
    console.warn("Notice querying token_wallets for upsell:", err?.message);
  }

  let studentHistoryRows: any[] = [];
  try {
    const { data: histData } = await supabaseAdmin.from("student_history").select("*");
    if (histData) studentHistoryRows = histData;
  } catch (err: any) {
    console.warn("Notice querying student_history for upsell:", err?.message);
  }

  for (const stu of students) {
    if (stu.status?.toUpperCase() !== "ACTIVE") continue;

    const parentEmails = getAllParentEmails(stu);
    const primaryParentEmail = parentEmails[0] || (stu.parentEmails ? stu.parentEmails[0] : "");
    const parentName = (stu as any).parentFirstName
      ? `${(stu as any).parentFirstName} ${(stu as any).parentLastName || ""}`.trim()
      : (stu as any).fatherName || (stu as any).motherName || "Parent";

    const studentFullName = stu.fullName || "Student";
    const studentIdStr = stu.id || stu.studentCode || "";
    const studentCode = stu.studentCode || (stu as any).student_id_code || `TG-${studentIdStr.slice(0, 6)}`;
    const program = (stu.program || (stu as any).program_type || "TUTORING").toUpperCase();

    // -------------------------------------------------------------------------
    // TRIGGER 1: Attending fewer days than the program offers (suggest another day)
    // -------------------------------------------------------------------------
    // Afterschool offers up to 5 days/week; Tutoring standard multi-day tracks offer 2-3 days/week.
    const studentSchedules = schedules.filter(sch => {
      const matchInSched = sch.student_id === stu.id;
      const matchInJoin = Array.isArray(sch.schedule_students) &&
        sch.schedule_students.some((ss: any) => ss.student_id === stu.id);
      return matchInSched || matchInJoin;
    });

    const uniqueDays = new Set(studentSchedules.map(s => s.day_of_week).filter(Boolean));
    const currentDaysScheduled = uniqueDays.size;

    const offeredDays = program.includes("AFTERSCHOOL") ? 5 : 2;
    if (currentDaysScheduled > 0 && currentDaysScheduled < offeredDays) {
      suggestions.push({
        studentId: studentIdStr,
        studentName: studentFullName,
        studentCode,
        parentName: parentName || "Parent",
        parentEmail: primaryParentEmail || "",
        type: "FEWER_DAYS",
        badge: "Schedule Optimization",
        title: `Add Another Weekly Day for ${program}`,
        reason: `${studentFullName} currently attends ${currentDaysScheduled} day(s)/week, while the ${program} curriculum is designed for ${offeredDays} weekly sessions.`,
        recommendation: `Add a second or third weekly class day to maximize retention, accelerate concept mastery, and keep pace with curriculum benchmarks.`,
        currentDaysScheduled,
        offeredDays
      });
    }

    // -------------------------------------------------------------------------
    // TRIGGER 2: Completed a course (suggest next course in the same category)
    // -------------------------------------------------------------------------
    // Check completed enrollments or completed history
    const stuEnrollments = enrollments.filter(e => e.student_id === stu.id);
    const completedEnrollments = stuEnrollments.filter(
      e => e.status === "COMPLETED" || (e.remaining_hours !== null && e.remaining_hours === 0 && e.used_hours > 0)
    );

    const stuHistory = studentHistoryRows.filter(
      h => h.student_id === stu.id && h.status === "COMPLETED"
    );

    const completedCourseNames = new Set<string>();
    completedEnrollments.forEach(e => { if (e.course_name) completedCourseNames.add(e.course_name); });
    stuHistory.forEach(h => { if (h.course_name) completedCourseNames.add(h.course_name); });

    // Also check student's allocated courses with 0 hours left
    if (Array.isArray(stu.allocatedCourses)) {
      stu.allocatedCourses.forEach((ac: any) => {
        if (ac.completed || ac.status === "COMPLETED") completedCourseNames.add(ac.courseName);
      });
    }

    for (const completedName of completedCourseNames) {
      // Find course category
      const matchedCourse = courses.find(
        c => (c.name || c.title || "").toLowerCase() === completedName.toLowerCase()
      );
      const category = matchedCourse?.category || "STEM & Technology";

      // Find other active courses in same category that student hasn't taken
      const nextCourse = courses.find(
        c =>
          c.category?.toLowerCase() === category.toLowerCase() &&
          c.status !== "ARCHIVED" &&
          (c.name || c.title || "").toLowerCase() !== completedName.toLowerCase() &&
          !stuEnrollments.some(e => (e.course_name || "").toLowerCase() === (c.name || c.title || "").toLowerCase())
      );

      if (nextCourse) {
        const nextCourseTitle = nextCourse.name || nextCourse.title || "Advanced Level";
        suggestions.push({
          studentId: studentIdStr,
          studentName: studentFullName,
          studentCode,
          parentName: parentName || "Parent",
          parentEmail: primaryParentEmail || "",
          type: "COMPLETED_COURSE",
          badge: "Course Advancement",
          title: `Progress to ${nextCourseTitle} (${category})`,
          reason: `${studentFullName} has completed ${completedName}. The next progressive milestone in ${category} is ${nextCourseTitle}.`,
          recommendation: `Seamlessly bridge into ${nextCourseTitle} to build advanced competencies and maintain momentum with familiar faculty mentors.`,
          courseName: completedName,
          suggestedCourseName: nextCourseTitle
        });
      }
    }

    // -------------------------------------------------------------------------
    // TRIGGER 3: Few hours left (<= 3 class hours remaining or negative balance)
    // -------------------------------------------------------------------------
    const wallet = tokenWallets.find(w => w.student_id === stu.id);
    let hoursLeft = (stu as any).hoursLeft ?? (stu as any).hours_left ?? null;

    if (wallet && typeof wallet.balance === "number") {
      hoursLeft = wallet.balance;
    } else if (stuEnrollments.length > 0) {
      const activeEnr = stuEnrollments.find(e => e.status === "ACTIVE" && e.remaining_hours !== null);
      if (activeEnr) hoursLeft = activeEnr.remaining_hours;
    }

    if (hoursLeft !== null && hoursLeft <= 3) {
      suggestions.push({
        studentId: studentIdStr,
        studentName: studentFullName,
        studentCode,
        parentName: parentName || "Parent",
        parentEmail: primaryParentEmail || "",
        type: "LOW_HOURS",
        badge: "Quota Replenishment",
        title: `Replenish Hours (${hoursLeft} Hour${hoursLeft === 1 ? "" : "s"} Remaining)`,
        reason: `${studentFullName} has only ${hoursLeft} class hour${hoursLeft === 1 ? "" : "s"} remaining in their current package.`,
        recommendation: `Renew or top-up your class hours now to prevent session interruptions and retain reserved schedule slots with faculty instructors.`,
        hoursLeft
      });
    }
  }

  return suggestions;
}

export interface SendUpsellParams {
  studentId?: string | undefined;
  suggestionType?: "FEWER_DAYS" | "COMPLETED_COURSE" | "FEW_HOURS_LEFT" | "LOW_HOURS" | undefined;
  suggestion?: UpsellSuggestion | undefined;
  customNote?: string | undefined;
  sentByUserId?: string | undefined;
}

/**
 * Sends a 1-click tailored upsell suggestion email to the student's parent.
 * Strictly respects CAN-SPAM postal address rules and unsubscribe status.
 * Automatically logged in email_log.
 */
export async function sendUpsellSuggestionEmail(params: SendUpsellParams): Promise<{
  success: boolean;
  message: string;
  unsubscribed?: boolean | undefined;
  emailLogId?: string | undefined;
  logId?: string | undefined;
}> {
  // 1. Verify CAN-SPAM physical postal address
  const canSpam = verifyCanSpamAddress();
  if (!canSpam.allowed) {
    throw new Error(canSpam.reason || "CAN-SPAM Violation: Institute postal address is required in Settings.");
  }

  // 2. Resolve suggestion
  let match: UpsellSuggestion | undefined = params.suggestion;
  const targetStudentId = params.studentId || params.suggestion?.studentId;

  if (!match && targetStudentId) {
    const suggestions = await computeUpsellSuggestions(targetStudentId);
    const reqType = params.suggestionType;
    match = suggestions.find(s => {
      if (!reqType) return true;
      if (s.type === reqType) return true;
      if ((reqType === "LOW_HOURS" || reqType === "FEW_HOURS_LEFT") && (s.type === "LOW_HOURS" || s.type === "FEW_HOURS_LEFT")) return true;
      return false;
    }) || suggestions[0];
  }

  if (!match) {
    throw new Error(`No active suggestion found for student ID ${targetStudentId || "unknown"}.`);
  }

  if (!match.parentEmail) {
    throw new Error(`No parent email on file for ${match.studentName}.`);
  }

  // 3. Respect Unsubscribe (CAN-SPAM Compliance)
  if (
    match.unsubscribed ||
    (await isUnsubscribed(match.parentEmail, "MARKETING")) ||
    (await isUnsubscribed(match.parentEmail, "ENGAGEMENT"))
  ) {
    throw new Error(`Cannot dispatch suggestion: ${match.parentEmail} has unsubscribed from promotional communications.`);
  }

  // 4. Claim Email in email_log (prevents accidental rapid double-sends)
  const todayStr = instituteToday();
  const claimId = await claimEmail(
    "UPSELL_SUGGESTION",
    `${match.studentId}-${match.type}`,
    todayStr,
    [match.parentEmail],
    match.title,
    match.recommendation
  );
  if (!claimId) {
    return {
      success: false,
      message: `A suggestion email of type '${match.type}' was already sent to ${match.parentEmail} today.`
    };
  }

  const settings = getCachedInstituteSettings();

  const recommendationText = params.customNote
    ? `${match.recommendation}<br><br><strong>Personal Advisor Note:</strong> ${escapeHtml(params.customNote)}`
    : match.recommendation;

  const rendered = await renderTemplate("UPSELL_SUGGESTION", {
    parent_name: match.parentName,
    student_name: match.studentName,
    suggestion_title: match.title,
    recommendation_text: recommendationText,
    course_name: match.suggestedCourseName || match.courseName || "",
    institute_name: settings.institute_name,
    support_email: settings.support_email
  });

  const fullHtml = appendCanSpamFooter(rendered.htmlBody, match.parentEmail, "MARKETING");

  const res = await dispatchMultiChannelNotification({
    eventType: "ADMISSION_APPROVED",
    subject: rendered.subject,
    message: fullHtml,
    recipients: [{ role: "PARENT", email: match.parentEmail, name: match.parentName }]
  });

  const status = statusFromDispatch(res);
  await finishEmail(claimId, status, res.failures?.join("; "));

  return {
    success: status !== "failed",
    message: `Suggestion email successfully sent to ${match.parentEmail} and logged in email delivery records.`,
    emailLogId: claimId,
    logId: claimId
  };
}
