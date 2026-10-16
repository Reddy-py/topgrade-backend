import { supabaseAdmin } from "../supabase.js";
import { findStudent, isUuid } from "./tokenService.js";

export type AttendanceStatusEnum = "PRESENT" | "ABSENT" | "LATE" | "EXCUSED";
export type ScanMethodEnum = "QR_CODE_SCANNER" | "MANUAL_MARKING" | "TEACHER_BATCH" | "STUDENT_SELF_QR" | "TEACHER_ROLLCALL";

export interface AttendanceRecord {
  id: string;
  studentId: string;
  studentName: string;
  studentCode: string;
  courseId: string;
  courseName: string;
  scheduleId?: string | undefined;
  checkInTime?: string | undefined;
  checkOutTime?: string | undefined;
  status: AttendanceStatusEnum;
  scanMethod: ScanMethodEnum | string;
  date: string; // YYYY-MM-DD
  notes?: string | undefined;
  markedBy?: string | undefined;
  createdAt: string;
}

const STATUSES: AttendanceStatusEnum[] = ["PRESENT", "ABSENT", "LATE", "EXCUSED"];

export function normalizeStatus(value: unknown): AttendanceStatusEnum {
  const s = String(value ?? "PRESENT").trim().toUpperCase() as AttendanceStatusEnum;
  if (!STATUSES.includes(s)) throw new Error(`Status must be one of: ${STATUSES.join(", ")}.`);
  return s;
}

export const isAttended = (s: AttendanceStatusEnum): boolean => s === "PRESENT" || s === "LATE";

/** Which class a record belongs to. The same student, class and day is always ONE row. */
export const classKeyOf = (p: { scheduleId?: string | undefined; sessionRef?: string | undefined; courseId?: string | undefined; courseName?: string | undefined }): string =>
  String(p.scheduleId || p.sessionRef || p.courseId || p.courseName || "").trim().toLowerCase();

function fromRow(r: any): AttendanceRecord {
  return {
    id: r.id,
    studentId: r.student_id,
    studentName: r.student_name || "",
    studentCode: r.student_code || "",
    courseId: r.course_id || r.class_name || "",
    courseName: r.course_name || r.class_name || "",
    scheduleId: r.schedule_id || undefined,
    checkInTime: r.check_in_time || undefined,
    checkOutTime: r.check_out_time || undefined,
    status: String(r.status || "PRESENT").toUpperCase() as AttendanceStatusEnum,
    scanMethod: r.scan_method || "MANUAL_MARKING",
    date: String(r.date).slice(0, 10),
    notes: r.remarks || undefined,
    markedBy: r.marked_by_name || undefined,
    createdAt: r.created_at,
  };
}

export interface RecordInput {
  studentIdOrCode: string;
  status: AttendanceStatusEnum;
  courseId?: string | undefined;
  courseName?: string | undefined;
  scheduleId?: string | undefined;
  sessionRef?: string | undefined;
  date: string;
  remarks?: string | undefined;
  scanMethod: ScanMethodEnum;
  markedByUserId?: string | undefined; // auth user id (uuid)
  markedByName?: string | undefined;
  checkInTime?: string | undefined;
  checkOutTime?: string | undefined;
}

/**
 * The ONLY way attendance is saved. One row per student, per class, per day:
 * saving the same class again changes that row instead of adding another.
 * Throws when Supabase refuses, so nobody is told "saved" when it was not.
 */
export async function saveAttendance(p: RecordInput): Promise<{ record: AttendanceRecord; created: boolean; previousStatus?: AttendanceStatusEnum }> {
  const student = await findStudent(p.studentIdOrCode);
  if (!student) throw new Error("Student not found.");
  const classKey = classKeyOf(p);
  if (!classKey) throw new Error("A class (course or schedule) is required to save attendance.");
  if (!/^\d{4}-\d{2}-\d{2}$/.test(p.date)) throw new Error("Date must be YYYY-MM-DD.");

  const base: Record<string, unknown> = {
    student_id: student.id,
    student_name: student.name,
    student_code: student.code,
    class_name: p.courseName || p.courseId || p.scheduleId || classKey,
    course_id: p.courseId ?? null,
    course_name: p.courseName ?? null,
    schedule_id: p.scheduleId ?? null,
    class_key: classKey,
    status: p.status,
    date: p.date,
    remarks: p.remarks ?? null,
    scan_method: p.scanMethod,
    marked_by_name: p.markedByName ?? null,
    marked_by: p.markedByUserId && isUuid(p.markedByUserId) ? p.markedByUserId : null,
  };

  const { data: existing } = await supabaseAdmin
    .from("attendance").select("*")
    .eq("student_id", student.id).eq("class_key", classKey).eq("date", p.date).maybeSingle();

  const attended = isAttended(p.status);
  const times: Record<string, unknown> = {
    check_in_time: attended ? (p.checkInTime || existing?.check_in_time || new Date().toISOString()) : null,
    check_out_time: p.checkOutTime ?? existing?.check_out_time ?? null,
  };

  if (existing) {
    const { data, error } = await supabaseAdmin.from("attendance").update({ ...base, ...times }).eq("id", existing.id).select("*").single();
    if (error || !data) throw new Error(`Could not save attendance: ${error?.message}`);
    return { record: fromRow(data), created: false, previousStatus: String(existing.status).toUpperCase() as AttendanceStatusEnum };
  }

  const { data, error } = await supabaseAdmin.from("attendance").insert({ ...base, ...times }).select("*").single();
  if (error?.code === "23505") {
    // two screens saved the same class at the same moment: update the row the other one created
    const { data: again, error: upErr } = await supabaseAdmin.from("attendance").update({ ...base, ...times })
      .eq("student_id", student.id).eq("class_key", classKey).eq("date", p.date).select("*").single();
    if (upErr || !again) throw new Error(`Could not save attendance: ${upErr?.message}`);
    return { record: fromRow(again), created: false };
  }
  if (error || !data) throw new Error(`Could not save attendance (run migration 20261014): ${error?.message}`);
  return { record: fromRow(data), created: true };
}

/** Today's check-in that has no check-out yet (QR scanner: the second scan is the check-out). */
export async function findOpenCheckin(studentUuid: string, classKey: string, date: string): Promise<AttendanceRecord | null> {
  const { data } = await supabaseAdmin.from("attendance").select("*")
    .eq("student_id", studentUuid).eq("class_key", classKey).eq("date", date)
    .not("check_in_time", "is", null).is("check_out_time", null).maybeSingle();
  return data ? fromRow(data) : null;
}

export async function setCheckOut(id: string, iso: string): Promise<AttendanceRecord> {
  const { data, error } = await supabaseAdmin.from("attendance").update({ check_out_time: iso }).eq("id", id).select("*").single();
  if (error || !data) throw new Error(`Could not save the check-out: ${error?.message}`);
  return fromRow(data);
}

export async function listAttendance(f: { studentIds?: string[]; courseId?: string; date?: string; limit?: number } = {}): Promise<AttendanceRecord[]> {
  let q = supabaseAdmin.from("attendance").select("*").order("date", { ascending: false }).order("created_at", { ascending: false }).limit(f.limit ?? 2000);
  if (f.studentIds) {
    const ids = f.studentIds.filter(isUuid);
    if (ids.length === 0) return [];
    q = q.in("student_id", ids);
  }
  if (f.courseId) q = q.or(`course_id.eq.${f.courseId.replace(/[^\w-]/g, "")},class_key.eq.${f.courseId.toLowerCase().replace(/[^\w -]/g, "")}`);
  if (f.date) q = q.eq("date", f.date);
  const { data, error } = await q;
  if (error) throw new Error(`Could not read attendance: ${error.message}`);
  return (data || []).map(fromRow);
}

export async function statsFor(studentIdOrCode: string, threshold = 75) {
  const student = await findStudent(studentIdOrCode);
  const records = student ? await listAttendance({ studentIds: [student.id] }) : [];
  const total = records.length;
  const present = records.filter(r => isAttended(r.status)).length;
  const late = records.filter(r => r.status === "LATE").length;
  const absent = records.filter(r => r.status === "ABSENT").length;
  const pct = total === 0 ? 100 : Math.round((present / total) * 100);
  return {
    studentId: student?.id || studentIdOrCode,
    totalSessions: total, presentSessions: present, absentSessions: absent, lateSessions: late,
    attendancePercentage: pct, isBelowThreshold: total > 0 && pct < threshold,
    warningAlert: total === 0 ? "No recorded class sessions yet." : pct < threshold ? `Attendance (${pct}%) is below the required ${threshold}%.` : "Attendance in good standing.",
    records,
  };
}
