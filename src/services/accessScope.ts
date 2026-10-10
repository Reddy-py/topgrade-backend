import { getStudentsService } from "./studentService.js";
import { ScheduleDataService } from "./scheduleDataService.js";
import { resolveTeacherIdentity } from "./teacherIdentity.js";
import type { AuthenticatedUser } from "../middleware/auth.js";
import type { UserRole } from "../constants/rolePermissions.js";

const norm = (v: unknown): string => String(v ?? "").trim().toLowerCase();
const has = (v: unknown): boolean => v !== undefined && v !== null && String(v).trim() !== "";

/**
 * Which records one login may see.
 *  ADMIN   -> everything (unrestricted).
 *  PARENT  -> only children whose parent email equals the login email.
 *  STUDENT -> only their own record.
 *  TEACHER -> only their own schedule slots and the students in them (or assigned to them).
 */
export interface AccessScope {
  role: UserRole;
  unrestricted: boolean;
  studentKeys: Set<string>;   // lower-cased student ids and student codes this login may see
  teacherKeys: Set<string>;   // lower-cased teacher ids, codes, login email, user id (TEACHER only)
  teacherNames: Set<string>;  // lower-cased teacher names, used only for exact matches on legacy slots
  courseKeys: Set<string>;    // lower-cased course ids, codes and names this login may see
}

export async function getAccessScope(user: AuthenticatedUser): Promise<AccessScope> {
  const scope: AccessScope = {
    role: user.role,
    unrestricted: user.role === "ADMIN",
    studentKeys: new Set(),
    teacherKeys: new Set(),
    teacherNames: new Set(),
    courseKeys: new Set(),
  };
  if (scope.unrestricted) return scope;

  const result = await getStudentsService({
    page: 1,
    limit: 100000,
    status: "ALL",
    grade: "ALL",
    currentUser: { id: user.id, email: user.email, role: user.role },
  });
  for (const s of (result.data || []) as any[]) {
    for (const k of [s.id, s.studentCode, s.student_id_code]) {
      if (has(k)) scope.studentKeys.add(norm(k));
    }
    if (user.role !== "TEACHER") {
      if (has(s.program)) scope.courseKeys.add(norm(s.program));
      for (const ac of s.allocatedCourses || []) {
        [ac.courseId, ac.courseName, ac.name].forEach(k => has(k) && scope.courseKeys.add(norm(k)));
      }
    }
  }

  if (user.role === "TEACHER") {
    const ident = await resolveTeacherIdentity({ id: user.id, email: user.email });
    ident.keys.forEach(k => scope.teacherKeys.add(k));
    ident.names.forEach(n => scope.teacherNames.add(n));
  }

  try {
    const slots = (await ScheduleDataService.listSchedules()) as any[];
    for (const slot of slots) {
      if (user.role === "TEACHER") {
        if (slotBelongsToTeacher(slot, scope)) {
          [slot.course_id, slot.course_name].forEach(k => has(k) && scope.courseKeys.add(norm(k)));
          for (const st of slot.students || []) {
            [st.student_id, st.student_code, st.id, st.studentCode].forEach(k => has(k) && scope.studentKeys.add(norm(k)));
          }
        }
      } else {
        const mine = (slot.students || []).some((st: any) =>
          allowsStudent(scope, st.student_id, st.student_code, st.id, st.studentCode)
        );
        if (mine) [slot.course_id, slot.course_name].forEach(k => has(k) && scope.courseKeys.add(norm(k)));
      }
    }
  } catch (err: any) {
    console.warn("accessScope: schedule lookup notice:", err?.message);
  }

  return scope;
}

export function allowsStudent(scope: AccessScope, ...keys: unknown[]): boolean {
  if (scope.unrestricted) return true;
  return keys.some(k => has(k) && scope.studentKeys.has(norm(k)));
}

export function allowsTeacher(scope: AccessScope, ...keys: unknown[]): boolean {
  if (scope.unrestricted) return true;
  return keys.some(k => has(k) && scope.teacherKeys.has(norm(k)));
}

export function allowsCourse(scope: AccessScope, ...keys: unknown[]): boolean {
  if (scope.unrestricted) return true;
  return keys.some(k => has(k) && scope.courseKeys.has(norm(k)));
}

export function slotBelongsToTeacher(slot: any, scope: AccessScope): boolean {
  return (
    allowsTeacher(scope, slot.teacher_id, slot.teacherId, slot.teacher_email) ||
    (has(slot.teacher_name) && scope.teacherNames.has(norm(slot.teacher_name)))
  );
}

/** Schedule slots one login may see. Parent and student only get the entries for their own child. */
export function scopeSchedules(slots: any[], scope: AccessScope): any[] {
  if (scope.unrestricted) return slots;
  if (scope.role === "TEACHER") return slots.filter(s => slotBelongsToTeacher(s, scope));
  return slots
    .map(s => ({
      ...s,
      students: (s.students || []).filter((st: any) =>
        allowsStudent(scope, st.student_id, st.student_code, st.id, st.studentCode)
      ),
    }))
    .filter(s => s.students.length > 0);
}

/** Attendance class sessions one login may see (sessions carry teacher and course, not a student list). */
export function scopeSessions(sessions: any[], scope: AccessScope): any[] {
  if (scope.unrestricted) return sessions;
  if (scope.role === "TEACHER") {
    return sessions.filter(s =>
      allowsTeacher(scope, s.teacherId, s.teacher_id) ||
      (has(s.teacherName) && scope.teacherNames.has(norm(s.teacherName)))
    );
  }
  return sessions.filter(s => allowsCourse(scope, s.courseId, s.courseCode, s.courseName));
}

/** Teacher record fields a parent or student may see. Never contact details, salary, birth date or documents. */
export function publicTeacherView(t: any): any {
  return {
    id: t.id,
    teacher_id_code: t.teacher_id_code,
    name: t.name,
    specialization: t.specialization,
    qualification: t.qualification,
    experience: t.experience,
    photo_url: t.photo_url,
    status: t.status,
  };
}
