import { dispatchMultiChannelNotification } from "./notificationService.js";
import { consumeAttendanceToken, refundAttendanceToken, findCourse, findStudent } from "./tokenService.js";
import {
  saveAttendance, findOpenCheckin, setCheckOut, listAttendance, statsFor, isAttended, classKeyOf,
  type AttendanceRecord, type AttendanceStatusEnum, type ScanMethodEnum, type RecordInput,
} from "./attendanceRepo.js";
import { instituteNow } from "./instituteTime.js";
import { studentContactEmails } from "./studentNotices.js";

export type { AttendanceRecord, AttendanceStatusEnum, ScanMethodEnum };

export interface QrScanInput {
  studentQrCode: string; // the student's ID code, e.g. "TG-STU-2026-3632"
  courseId?: string | undefined;
  scanMethod?: ScanMethodEnum | undefined;
}

export interface BatchAttendanceInput {
  courseId: string;
  date: string;
  entries: Array<{ studentId: string; studentName?: string; status: AttendanceStatusEnum; notes?: string | undefined }>;
}

export interface TokenOutcome {
  remaining?: number | undefined;
  owed: boolean;
  low: boolean;
  warning?: string | undefined;
}

/**
 * Saves one attendance mark and keeps the class token in step:
 * PRESENT or LATE uses one token, any other status gives it back, marking again does nothing extra.
 * The token and the attendance row use the SAME class key, so every screen counts a class once.
 */
export async function markAttendance(p: RecordInput): Promise<{ record: AttendanceRecord; created: boolean; token: TokenOutcome }> {
  const saved = await saveAttendance(p);
  const token: TokenOutcome = { owed: false, low: false };
  const courseKey = p.courseId || p.courseName || "";
  const classRef = `${classKeyOf(p)}:${p.date}`;
  try {
    if (!courseKey || !(await findCourse(courseKey))) {
      token.warning = "No token was used: this class is not linked to a course.";
    } else if (isAttended(p.status)) {
      const used = await consumeAttendanceToken({ studentIdOrCode: p.studentIdOrCode, courseIdOrName: courseKey, classRef, by: p.markedByUserId ?? null });
      token.remaining = used.balance;
      token.owed = !!used.owed;
      token.low = !!used.low;
      token.warning = used.owed
        ? `No tokens left: ${-(used.balance ?? 0)} class(es) owed. Ask the parent to buy tokens.`
        : used.low ? `Low tokens: ${used.balance} class(es) left.` : undefined;
    } else {
      const back = await refundAttendanceToken({ studentIdOrCode: p.studentIdOrCode, courseIdOrName: courseKey, classRef, by: p.markedByUserId ?? null });
      token.remaining = back.balance;
    }
  } catch (err: any) {
    token.warning = `Token update failed: ${err?.message}`;
  }
  return { record: saved.record, created: saved.created, token };
}

async function parentEmailsOf(studentUuid: string, fallback: { email: string; parentEmails: string[] }): Promise<string[]> {
  const list = studentContactEmails({ email: fallback.email, studentEmails: [], parentEmails: fallback.parentEmails });
  return list;
}

export class AttendanceService {
  /**
   * QR scanner at the door of a class. First scan = check-in (uses one token), second scan = check-out.
   * The QR code must belong to a real student: an unknown code is rejected (it never marks another child).
   */
  public static async scanQrCodeCheckInCheckOut(input: QrScanInput, actor?: { id?: string; name?: string }) {
    const code = (input.studentQrCode || "").trim();
    const student = await findStudent(code);
    if (!student) throw Object.assign(new Error("This QR code does not match any student."), { status: 404 });
    if (!input.courseId) throw Object.assign(new Error("Choose the class this scan is for."), { status: 400 });

    const course = await findCourse(input.courseId);
    const courseName = course?.name || input.courseId;
    const today = instituteNow().dateStr;
    const nowIso = new Date().toISOString();
    const classKey = classKeyOf({ courseId: input.courseId });
    const scanMethod = input.scanMethod || "QR_CODE_SCANNER";

    const open = await findOpenCheckin(student.id, classKey, today);
    const to = await parentEmailsOf(student.id, { email: student.email, parentEmails: student.parentEmails });

    if (open) {
      const record = await setCheckOut(open.id, nowIso);
      if (to.length > 0) {
        void dispatchMultiChannelNotification({
          eventType: "ATTENDANCE_ALERT",
          subject: `Check-out: ${student.name} (${courseName})`,
          message: `${student.name} left ${courseName} at ${new Date(nowIso).toLocaleTimeString()}.`,
          escapeMessage: true,
          recipients: to.map(e => ({ role: "PARENT" as const, email: e, name: "Parent", phone: "" })),
        }).catch(() => undefined);
      }
      return { action: "CHECK_OUT" as const, message: `Check-out saved for ${student.name}.`, record, parentNotificationSent: to.length > 0 };
    }

    const r = await markAttendance({
      studentIdOrCode: student.id, status: "PRESENT", courseId: input.courseId, courseName,
      date: today, scanMethod, checkInTime: nowIso, markedByName: actor?.name || "QR scanner", ...(actor?.id ? { markedByUserId: actor.id } : {}),
    });
    if (to.length > 0) {
      void dispatchMultiChannelNotification({
        eventType: "ATTENDANCE_ALERT",
        subject: `Check-in: ${student.name} (${courseName})`,
        message: `${student.name} arrived for ${courseName} at ${new Date(nowIso).toLocaleTimeString()}.`,
        escapeMessage: true,
        recipients: to.map(e => ({ role: "PARENT" as const, email: e, name: "Parent", phone: "" })),
      }).catch(() => undefined);
    }
    return {
      action: "CHECK_IN" as const,
      message: `Check-in saved for ${student.name}.`,
      record: r.record,
      remainingHours: r.token.remaining ?? 0,
      tokenWarning: r.token.warning,
      parentNotificationSent: to.length > 0,
    };
  }

  /** Teacher marks a whole class at once. */
  public static async markBatchAttendance(input: BatchAttendanceInput, actor?: { id?: string; name?: string }) {
    const { courseId, date, entries } = input;
    const course = await findCourse(courseId);
    const records: AttendanceRecord[] = [];
    const warnings: string[] = [];
    let present = 0;
    let absent = 0;

    for (const entry of entries) {
      const status = entry.status;
      if (isAttended(status)) present++; else absent++;
      const r = await markAttendance({
        studentIdOrCode: entry.studentId, status, courseId, ...(course ? { courseName: course.name } : {}),
        date, remarks: entry.notes, scanMethod: "TEACHER_BATCH", markedByName: actor?.name || "Teacher", ...(actor?.id ? { markedByUserId: actor.id } : {}),
      });
      records.push(r.record);
      if (r.token.warning) warnings.push(`${r.record.studentName}: ${r.token.warning}`);
    }
    return {
      success: true,
      message: `Batch attendance saved for ${entries.length} students (${present} present, ${absent} not present).`,
      records, presentCount: present, absentCount: absent, warnings,
    };
  }

  public static async getStudentAttendanceStats(studentId: string, alertThresholdPercentage = 75) {
    return statsFor(studentId, alertThresholdPercentage);
  }

  public static async getAllAttendance(filters?: { courseId?: string; date?: string; studentIds?: string[] }) {
    return listAttendance(filters || {});
  }
}
