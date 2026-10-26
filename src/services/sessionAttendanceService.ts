import { markAttendance } from "./attendanceService.js";
import type { AttendanceStatusEnum } from "./attendanceRepo.js";
import { instituteNow } from "./instituteTime.js";
import { ScheduleDataService } from "./scheduleDataService.js";
import { resolveTeacherIdentity } from "./teacherIdentity.js";
import { dispatchMultiChannelNotification } from "./notificationService.js";
import { supabaseAdmin } from "../supabase.js";
import { claimEmail, finishEmail } from "./emailLog.js";
import { getBalances } from "./tokenService.js";

export interface ClassSessionQRRecord {
  id: string;
  classSessionId: string;
  courseId: string;
  courseName: string;
  courseCode?: string;
  teacherId: string;
  teacherName: string;
  startTime: string; // ISO string
  endTime: string;   // ISO string
  graceMinutes: number;
  qrToken: string;
  isExpired: boolean;
  dayOfWeek?: string;
  slotName?: string;
  room?: string;
  programTrack?: string;
  enrolledStudentsCount?: number;
  createdAt: string;
}

export interface StudentSelfScanInput {
  studentId: string;
  qrToken: string;
  customScanTimeIso?: string | undefined;
}

export interface TeacherSessionSubmitInput {
  classSessionId: string;
  teacherId?: string | undefined;
  date?: string | undefined;
  auditNote?: string | undefined;
  entries: Array<{
    studentId: string;
    studentName?: string;
    studentEmail?: string;
    status: "PRESENT" | "ABSENT";
    notes?: string | undefined;
  }>;
}

export const classSessionQrStore: ClassSessionQRRecord[] = [];

/**
 * Removes placeholder compatibility helpers (no dummy attendance generation)
 */
export function autoGenerateAttendanceSessionsForCourse(_course: any) {
  // Deliberately no-op: Attendance classes are strictly backed by real schedule slots
}

export function removeAttendanceSessionsForCourse(_courseId: string) {
  // Deliberately no-op
}

function isPlaceholderEmail(email?: string): boolean {
  if (!email) return true;
  const e = email.trim().toLowerCase();
  return (
    !e.includes("@") ||
    e.endsWith("@topgrade.edu") ||
    e.endsWith("@test.com") ||
    e.endsWith("@example.com") ||
    e.endsWith("@placeholder.com") ||
    e.includes("parent.placeholder") ||
    e.includes("student.placeholder")
  );
}

export class SessionAttendanceService {
  /**
   * Generates a new session QR record
   */
  public static generateSessionQrToken(params: {
    classSessionId: string;
    courseId: string;
    courseName: string;
    teacherId: string;
    teacherName: string;
    startTimeIso?: string;
    endTimeIso?: string;
    graceMinutes?: number;
  }): ClassSessionQRRecord {
    const record: ClassSessionQRRecord = {
      id: `sqr-${Date.now()}`,
      classSessionId: params.classSessionId,
      courseId: params.courseId,
      courseName: params.courseName,
      teacherId: params.teacherId,
      teacherName: params.teacherName,
      startTime: params.startTimeIso || new Date().toISOString(),
      endTime: params.endTimeIso || new Date(Date.now() + 7200000).toISOString(),
      graceMinutes: params.graceMinutes || 15,
      qrToken: `TG-SESSION-${params.classSessionId}-${Date.now()}`,
      isExpired: false,
      createdAt: new Date().toISOString()
    };
    return record;
  }

  /**
   * Process student QR self-scan
   */
  public static async processStudentSelfScan(input: StudentSelfScanInput) {
    const { studentId, qrToken, customScanTimeIso } = input;
    const nowIso = process.env.NODE_ENV !== "production" && customScanTimeIso ? customScanTimeIso : new Date().toISOString();

    const liveSessions = await this.getLiveSessionsFromSupabase();
    const session = liveSessions.find(s => s.qrToken === qrToken || s.classSessionId === qrToken);

    if (!session) {
      const err: any = new Error("Invalid or expired session QR code.");
      err.code = "INVALID_QR_TOKEN";
      throw err;
    }

    const { data: student } = await supabaseAdmin.from("students").select("id, name, student_id_code").eq("id", studentId).maybeSingle();
    if (!student) {
      const err: any = new Error("Student not found.");
      err.code = "STUDENT_NOT_FOUND";
      throw err;
    }
    const studentName = student.name || "Student";

    const slot = (await ScheduleDataService.listSchedules()).find(sl => sl.id === session.classSessionId);
    if (slot) {
      const enrolled = (slot.students || []).some(st =>
        String(st.student_id).toLowerCase() === String(student.id).toLowerCase() ||
        (!!st.student_code && String(st.student_code).toLowerCase() === String(student.student_id_code || "").toLowerCase()));
      if (!enrolled) {
        const err: any = new Error("You are not enrolled in this class.");
        err.code = "NOT_ENROLLED";
        throw err;
      }
    }

    await markAttendance({
      studentIdOrCode: student.id, status: "PRESENT", courseId: session.courseId, courseName: session.courseName,
      scheduleId: session.classSessionId, date: instituteNow().dateStr, remarks: "Self check-in via QR scan",
      scanMethod: "STUDENT_SELF_QR", markedByName: "Student self-scan", checkInTime: nowIso,
    });

    return {
      success: true,
      message: `Self check-in verified! Marked Present for ${session.courseName}.`,
      sessionName: session.courseName,
      studentName,
      checkInTime: nowIso
    };
  }

  /**
   * Check Time-Gated Status for Class Session QR
   */
  public static checkSessionQrTimeGate(_sessionQr: ClassSessionQRRecord, _customScanTimeIso?: string) {
    return {
      isUnlocked: true,
      statusBadgeText: `🔓 Session Active & Ready for Marking`,
      reason: "ACTIVE"
    };
  }

  /**
   * Fetches all live attendance classes derived strictly from schedules table.
   * Empty state when no schedule slots exist.
   */
  public static async getLiveSessionsFromSupabase(): Promise<ClassSessionQRRecord[]> {
    try {
      const allSlots = await ScheduleDataService.listSchedules();
      const sessions: ClassSessionQRRecord[] = allSlots.map(slot => ({
        id: slot.id,
        classSessionId: slot.id,
        courseId: slot.course_id,
        courseName: slot.course_name,
        teacherId: slot.teacher_id,
        teacherName: slot.teacher_name || "Unassigned Faculty",
        dayOfWeek: slot.day_of_week,
        slotName: slot.time_slot,
        room: slot.room,
        programTrack: slot.program || "Core Curriculum",
        startTime: new Date().toISOString(),
        endTime: new Date().toISOString(),
        graceMinutes: 30,
        qrToken: `TG-SESSION-${slot.id}`,
        isExpired: false,
        enrolledStudentsCount: slot.students?.length || 0,
        createdAt: slot.created_at || new Date().toISOString()
      }));

      return sessions;
    } catch (err) {
      console.error("Error fetching live sessions from schedules:", err);
      return [];
    }
  }

  /**
   * Generates or returns session roster strictly from registered slot students
   */
  public static async getSessionRoster(classSessionId: string) {
    const allSlots = await ScheduleDataService.listSchedules();
    const cleanId = classSessionId.replace(/^sess-/, "").replace(/^sqr-/, "");
    const slot = allSlots.find(s => s.id === classSessionId || s.id === cleanId || classSessionId.includes(s.id));

    if (!slot) {
      throw new Error(`Class slot '${classSessionId}' was not found.`);
    }

    const sessionQr: ClassSessionQRRecord = {
      id: slot.id,
      classSessionId: slot.id,
      courseId: slot.course_id,
      courseName: slot.course_name,
      teacherId: slot.teacher_id,
      teacherName: slot.teacher_name || "Unassigned Faculty",
      dayOfWeek: slot.day_of_week,
      slotName: slot.time_slot,
      room: slot.room,
      programTrack: slot.program || "Core Curriculum",
      startTime: new Date().toISOString(),
      endTime: new Date().toISOString(),
      graceMinutes: 30,
      qrToken: `TG-SESSION-${slot.id}`,
      isExpired: false,
      enrolledStudentsCount: slot.students?.length || 0,
      createdAt: slot.created_at || new Date().toISOString()
    };

    const enrolled = slot.students || [];
    const todayDate = instituteNow().dateStr;

    // Fetch existing attendance marks for today in this class
    const { data: todayLogs } = await supabaseAdmin
      .from("attendance")
      .select("*")
      .eq("date", todayDate)
      .eq("schedule_id", slot.id);

    // Fetch student profile details (balances, grades)
    const studentIds = enrolled.map(e => e.student_id);
    const { data: dbStudents } = studentIds.length > 0
      ? await supabaseAdmin.from("students").select("id, name, email, parent_emails, age, student_id_code").in("id", studentIds)
      : { data: [] };
    const dbStuMap = new Map((dbStudents || []).map((s: any) => [s.id, s]));

    const roster = await Promise.all(
      enrolled.map(async (st: any) => {
        const fullSt = dbStuMap.get(st.student_id) || {};
        const existingMark = (todayLogs || []).find((l: any) => l.student_id === st.student_id || l.student_name === st.student_name);
        const currentStatus = existingMark ? (existingMark.status?.toUpperCase() || "PRESENT") : "PRESENT";

        // Check hour balance
        let balance = 0;
        let isOwed = false;
        try {
          const balances = await getBalances(st.student_id);
          const cBal = balances.find(b => b.courseId === slot.course_id || b.courseName.toLowerCase() === slot.course_name.toLowerCase()) || balances[0];
          if (cBal) {
            balance = cBal.balance;
            isOwed = cBal.owed || cBal.balance <= 0;
          }
        } catch {}

        return {
          studentId: st.student_id,
          fullName: st.student_name,
          studentCode: st.student_code || fullSt.student_id_code || `TG-STU-${st.student_id.slice(0, 6)}`,
          email: fullSt.email || "",
          parentEmail: fullSt.parent_emails?.[0] || "",
          grade: fullSt.age ? `Grade ${fullSt.age > 12 ? 12 : fullSt.age}` : "Grade 8",
          status: currentStatus,
          notes: existingMark?.remarks || "",
          hoursLeft: balance,
          isHoursOwed: isOwed
        };
      })
    );

    return {
      sessionQr,
      timeGate: { isUnlocked: true, statusBadgeText: "🔓 Session Active & Ready for Marking", reason: "ACTIVE" },
      studentsCount: roster.length,
      roster
    };
  }

  /**
   * Teacher marks attendance:
   * - Teacher role can mark ONLY their own class, ONLY for today (institute time).
   * - Admin can mark/correct any date with an audit note.
   * - Present: 1 hour deducted. Absent: no deduction (hour refunded).
   * - Repeated saves never deduct twice.
   * - Email dispatched to student real email, else parent real email (placeholder addresses count as no email).
   * - Names class, date, time, status, hours left (says 'no hour deducted' for absent, or correction notice).
   * - Idempotent via email_log claims.
   */
  public static async submitTeacherSessionAttendance(
    input: TeacherSessionSubmitInput,
    actor?: { id?: string; role?: string; email?: string; name?: string }
  ) {
    const { classSessionId, entries } = input;
    const cleanId = classSessionId.replace(/^sess-/, "").replace(/^sqr-/, "");
    const allSlots = await ScheduleDataService.listSchedules();
    const slot = allSlots.find(s => s.id === classSessionId || s.id === cleanId || classSessionId.includes(s.id));

    if (!slot) {
      const err: any = new Error("This class was not found.");
      err.status = 404;
      throw err;
    }

    const todayDate = instituteNow().dateStr;
    const rollDate = String(input.date || todayDate).slice(0, 10);

    // Rule: Teacher can submit ONLY their own class, and ONLY for today
    if (actor?.role === "TEACHER") {
      const ident = await resolveTeacherIdentity({ id: actor.id, email: actor.email });
      const isMine =
        ident.keys.has(String(slot.teacher_id || "").toLowerCase()) ||
        ident.names.has(String(slot.teacher_name || "").trim().toLowerCase());

      if (!isMine) {
        const err: any = new Error("This class is not yours. Teachers can mark only their own classes.");
        err.status = 403;
        throw err;
      }

      if (rollDate !== todayDate) {
        const err: any = new Error(`Teachers can mark attendance only for today's class (${todayDate}).`);
        err.status = 400;
        throw err;
      }
    }

    const enrolledStudentIds = new Set((slot.students || []).map(s => s.student_id));
    const warnings: string[] = [];
    let savedCount = 0;
    let presentCount = 0;
    let absentCount = 0;

    // Fetch existing attendance marks on rollDate for correction detection
    const { data: existingMarks } = await supabaseAdmin
      .from("attendance")
      .select("id, student_id, status, remarks")
      .eq("schedule_id", slot.id)
      .eq("date", rollDate);

    const existingMarkMap = new Map((existingMarks || []).map((m: any) => [m.student_id, m]));

    // Fetch students database for contact emails
    const entryStudentIds = entries.map(e => e.studentId);
    const { data: dbStudents } = await supabaseAdmin
      .from("students")
      .select("id, name, email, parent_emails, student_id_code")
      .in("id", entryStudentIds);
    const stuMap = new Map((dbStudents || []).map((s: any) => [s.id, s]));

    for (const entry of entries) {
      // Must be registered in class
      if (actor?.role === "TEACHER" && !enrolledStudentIds.has(entry.studentId)) {
        warnings.push(`${entry.studentName || entry.studentId}: not enrolled in this class, skipped.`);
        continue;
      }

      const rawStatus = String(entry.status || "PRESENT").toUpperCase();
      const status: "PRESENT" | "ABSENT" = rawStatus === "ABSENT" ? "ABSENT" : "PRESENT";
      const attended = status === "PRESENT";
      const studentInfo = stuMap.get(entry.studentId);
      const studentName = studentInfo?.name || entry.studentName || "Student";

      const prevMark = existingMarkMap.get(entry.studentId);
      const isCorrection = prevMark && prevMark.status && prevMark.status.toUpperCase() !== status;

      const classHours = slot.duration_hours === 2 ? 2 : 1;

      let saved;
      try {
        const noteWithAudit = input.auditNote
          ? `${entry.notes ? entry.notes + " • " : ""}Audit: ${input.auditNote} (by ${actor?.name || "Admin"})`
          : entry.notes || `Marked by ${actor?.name || slot.teacher_name || "Faculty"}`;

        saved = await markAttendance({
          studentIdOrCode: entry.studentId,
          status: status as AttendanceStatusEnum,
          courseId: slot.course_id,
          courseName: slot.course_name,
          scheduleId: slot.id,
          date: rollDate,
          remarks: noteWithAudit,
          hours: classHours,
          scanMethod: "TEACHER_BATCH",
          markedByName: actor?.name || slot.teacher_name || "Faculty",
          ...(actor?.id ? { markedByUserId: actor.id } : {})
        });
      } catch (saveErr: any) {
        warnings.push(`${studentName}: ${saveErr?.message}`);
        continue;
      }

      savedCount++;
      if (attended) presentCount++; else absentCount++;

      // Warning if student with 0 hours is marked present (hours owed)
      if (attended && (saved.token.owed || (saved.token.remaining ?? 0) <= 0)) {
        warnings.push(`Warning: ${studentName} has 0 hours left (hours owed).`);
      } else if (saved.token.warning) {
        warnings.push(`${studentName}: ${saved.token.warning}`);
      }

      // Determine real recipient email
      let targetRecipient: { email: string; name: string; role: "STUDENT" | "PARENT" } | null = null;
      if (studentInfo?.email && !isPlaceholderEmail(studentInfo.email)) {
        targetRecipient = { email: studentInfo.email, name: studentName, role: "STUDENT" };
      } else if (studentInfo?.parent_emails && studentInfo.parent_emails.length > 0) {
        const realParent = studentInfo.parent_emails.find((pe: string) => !isPlaceholderEmail(pe));
        if (realParent) {
          targetRecipient = { email: realParent, name: `Parent of ${studentName}`, role: "PARENT" };
        }
      }

      // If valid real email exists, dispatch automatic attendance email idempotently via email_log
      if (targetRecipient) {
        const hoursLeft = saved.token.remaining ?? 0;
        const claimKey = `${entry.studentId}:${slot.id}:${rollDate}:${status}${isCorrection ? ':corr' : ''}`;
        const emailSubject = isCorrection
          ? `[Corrected] Attendance Notice: ${slot.course_name}`
          : `Attendance Notice: ${slot.course_name} (${status === "PRESENT" ? "Present" : "Absent"})`;

        const statusCopy = status === "PRESENT"
          ? `Present (${classHours} ${classHours > 1 ? "hours" : "hour"} deducted)`
          : `Absent (nothing deducted)`;

        const emailMessage = isCorrection
          ? `CORRECTION NOTICE: Attendance for ${studentName} in '${slot.course_name}' on ${rollDate} has been updated.\n\n` +
            `• Class: ${slot.course_name}\n` +
            `• Date & Time: ${rollDate} (${slot.time_slot})\n` +
            `• Updated Status: ${statusCopy}\n` +
            `• Hours Remaining: ${hoursLeft} hr(s) ${status === "ABSENT" ? "(nothing deducted)" : ""}\n` +
            (input.auditNote ? `• Audit Note: ${input.auditNote}\n` : "") +
            `\nPlease contact the institute if you have any questions.`
          : `Dear ${studentName},\n\nYour attendance for '${slot.course_name}' on ${rollDate} has been recorded.\n\n` +
            `• Class: ${slot.course_name}\n` +
            `• Date & Time: ${rollDate} (${slot.time_slot})\n` +
            `• Status: ${statusCopy}\n` +
            `• Hours Remaining: ${hoursLeft} hr(s) ${status === "ABSENT" ? "(nothing deducted)" : ""}\n` +
            `\nPlease contact the institute if you have any questions.`;

        // Claim in email_log to guarantee one email per student per class per date per status
        try {
          const claimId = await claimEmail(
            "ATTENDANCE_DAILY",
            claimKey,
            rollDate,
            [targetRecipient.email],
            emailSubject,
            emailMessage.slice(0, 300),
            {
              scheduleId: slot.id,
              studentId: entry.studentId,
              status,
              isCorrection,
              hoursLeft
            }
          );

          if (claimId) {
            try {
              await dispatchMultiChannelNotification({
                eventType: "ATTENDANCE_ALERT",
                subject: emailSubject,
                message: emailMessage,
                escapeMessage: true,
                recipients: [targetRecipient]
              });
              await finishEmail(claimId, process.env.SIMULATE_EMAILS === "true" ? "simulated" : "sent");
            } catch (sendErr: any) {
              await finishEmail(claimId, "failed", sendErr.message);
              console.warn(`Attendance email delivery error for ${targetRecipient.email}:`, sendErr.message);
            }
          }
        } catch (claimErr) {
          console.warn("Notice in email_log claim for attendance notice:", claimErr);
        }
      }
    }

    return {
      success: true,
      message: `Attendance saved for ${savedCount} of ${entries.length} students.`,
      processedCount: savedCount,
      presentCount,
      absentCount,
      warnings
    };
  }

  /**
   * Reports attendance rows in the database that do not belong to an existing class
   */
  public static async getOrphanAttendanceCount(): Promise<{ orphanCount: number; totalCount: number }> {
    try {
      const allSlots = await ScheduleDataService.listSchedules();
      const validSlotIds = new Set(allSlots.map(s => s.id));

      const { data: attendanceRows, error } = await supabaseAdmin
        .from("attendance")
        .select("id, schedule_id, class_name");

      if (error || !attendanceRows) {
        return { orphanCount: 0, totalCount: 0 };
      }

      let orphans = 0;
      for (const row of attendanceRows) {
        const hasMatchingSchedule = row.schedule_id && validSlotIds.has(row.schedule_id);
        if (!hasMatchingSchedule) {
          orphans++;
        }
      }

      return { orphanCount: orphans, totalCount: attendanceRows.length };
    } catch (e) {
      console.warn("Orphan attendance calculation notice:", e);
      return { orphanCount: 0, totalCount: 0 };
    }
  }
}
