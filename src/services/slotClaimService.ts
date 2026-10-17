import { supabaseAdmin } from "../supabase.js";
import { ScheduleDataService, doTimesOverlap, inMemorySchedules, type ScheduleSlot } from "./scheduleDataService.js";
import { getTeacherRecord, type TeacherRecord } from "./teacherIdentity.js";
import { dispatchMultiChannelNotification } from "./notificationService.js";
import { sendTeacherScheduleActionNotice } from "./eventEmailService.js";
import type { AuthenticatedUser } from "../middleware/auth.js";

/**
 * Requirement 8: teachers choose their classes from slots the admin created.
 *  - The admin creates a slot with "open for teachers" (no teacher yet).
 *  - A teacher sees the open slots they are allowed to take and takes one. One teacher per slot: the claim is a row
 *    keyed by the slot id, so two teachers pressing the button at the same moment cannot both get it.
 *  - A teacher cannot take a slot that overlaps one of their own classes, or a day they marked unavailable.
 *  - A teacher can give a slot back until students are enrolled in it. After that the admin reassigns it.
 */

const norm = (v: unknown): string => String(v ?? "").trim().toLowerCase();

class ClaimError extends Error {
  status: number;
  constructor(message: string, status = 400) { super(message); this.status = status; }
}

async function requireTeacher(user: AuthenticatedUser): Promise<TeacherRecord> {
  const teacher = await getTeacherRecord({ id: user.id, email: user.email });
  if (!teacher) throw new ClaimError("Your login is not linked to a teacher record. Ask the institute to check your profile.", 403);
  if (norm(teacher.status) !== "active") throw new ClaimError("Your teacher account is not active.", 403);
  return teacher;
}

const isMine = (slot: ScheduleSlot, t: TeacherRecord): boolean =>
  [t.id, t.code, t.email].some(k => k && norm(slot.teacher_id) === norm(k)) ||
  (!!slot.teacher_name && norm(slot.teacher_name) === norm(t.name));

function eligible(slot: ScheduleSlot, t: TeacherRecord): boolean {
  const list = slot.eligible_teacher_ids || [];
  if (list.length === 0) return true; // the course names no teachers: any teacher may take it
  return list.some(id => [t.id, t.code].some(k => k && norm(id) === norm(k)));
}

function dayAllowed(slot: ScheduleSlot, t: TeacherRecord): boolean {
  if (t.availabilityDays.length === 0) return true; // no availability set: not restricted
  return t.availabilityDays.some(d => norm(d) === norm(slot.day_of_week));
}

/** Open slots this teacher may take, with a reason why not when they cannot. */
export async function listOpenSlots(user: AuthenticatedUser): Promise<Array<ScheduleSlot & { canTake: boolean; blockedReason?: string }>> {
  const teacher = await requireTeacher(user);
  const all = await ScheduleDataService.listSchedules();
  const mine = all.filter(s => s.is_active !== false && isMine(s, teacher));

  return all
    .filter(s => s.is_active !== false && s.open_for_teachers === true && !s.claimed_by_teacher)
    .map(slot => {
      let blockedReason: string | undefined;
      if (!eligible(slot, teacher)) blockedReason = "This course is taught by specific teachers.";
      else if (!dayAllowed(slot, teacher)) blockedReason = `You marked ${slot.day_of_week} as unavailable.`;
      else {
        const clash = mine.find(m => norm(m.day_of_week) === norm(slot.day_of_week) && doTimesOverlap(m.start_time, m.end_time, slot.start_time, slot.end_time));
        if (clash) blockedReason = `Overlaps your class '${clash.course_name}' (${clash.time_slot}).`;
      }
      const { students: _hide, ...rest } = slot as any;
      return { ...(rest as ScheduleSlot), canTake: !blockedReason, ...(blockedReason ? { blockedReason } : {}) };
    });
}

export async function claimSlot(user: AuthenticatedUser, slotId: string): Promise<ScheduleSlot> {
  const teacher = await requireTeacher(user);
  const all = await ScheduleDataService.listSchedules();
  const slot = all.find(s => s.id === slotId);
  if (!slot || slot.is_active === false) throw new ClaimError("This class was not found.", 404);
  if (slot.open_for_teachers !== true) throw new ClaimError("This class is not open for teachers to choose.");
  if (slot.claimed_by_teacher) throw new ClaimError("Another teacher already took this class.", 409);
  if (!eligible(slot, teacher)) throw new ClaimError("This course is taught by specific teachers, and you are not one of them.", 403);
  if (!dayAllowed(slot, teacher)) throw new ClaimError(`You marked ${slot.day_of_week} as unavailable. Change your availability first.`);

  const clash = all.find(m =>
    m.id !== slot.id && m.is_active !== false && isMine(m, teacher) &&
    norm(m.day_of_week) === norm(slot.day_of_week) && doTimesOverlap(m.start_time, m.end_time, slot.start_time, slot.end_time));
  if (clash) throw new ClaimError(`This overlaps your class '${clash.course_name}' on ${clash.day_of_week} (${clash.time_slot}).`);

  const { error } = await supabaseAdmin.from("teacher_slot_claims").insert({
    slot_id: slot.id, teacher_id: teacher.id, teacher_name: teacher.name, teacher_email: teacher.email,
  });
  if (error) {
    if (error.code === "23505") throw new ClaimError("Another teacher just took this class.", 409);
    throw new ClaimError(`Could not save your choice (run migration 20261013): ${error.message}`, 500);
  }

  void sendTeacherScheduleActionNotice({
    eventType: "CLASS_TAKEN",
    teacherName: teacher.name,
    teacherEmail: teacher.email,
    courseName: slot.course_name,
    dayOfWeek: slot.day_of_week,
    timeSlot: slot.time_slot,
    room: slot.room,
    locationName: slot.location,
    enrolledCount: slot.students?.length || 0
  }).catch(() => undefined);

  const memSlot = inMemorySchedules.get(slot.id);
  if (memSlot) {
    memSlot.teacher_id = teacher.id;
    memSlot.teacher_name = teacher.name;
    memSlot.claimed_by_teacher = true;
    memSlot.open_for_teachers = false;
  }

  return { ...slot, teacher_id: teacher.id, teacher_name: teacher.name, claimed_by_teacher: true };
}

export async function releaseSlot(user: AuthenticatedUser, slotId: string): Promise<void> {
  const isAdmin = user.role === "ADMIN";
  const { data: claim } = await supabaseAdmin.from("teacher_slot_claims").select("*").eq("slot_id", slotId).maybeSingle();
  if (!claim) throw new ClaimError("This class is not taken by a teacher.", 404);

  const slot = (await ScheduleDataService.listSchedules()).find(s => s.id === slotId);

  if (!isAdmin) {
    const teacher = await requireTeacher(user);
    if (norm(claim.teacher_id) !== norm(teacher.id)) throw new ClaimError("This class is not yours.", 403);
    if ((slot?.students || []).length > 0) {
      throw new ClaimError("Students are enrolled in this class, so you cannot give it back yourself. Ask the institute to reassign it.", 409);
    }
  }
  const { error } = await supabaseAdmin.from("teacher_slot_claims").delete().eq("slot_id", slotId);
  if (error) throw new ClaimError(error.message, 500);

  void sendTeacherScheduleActionNotice({
    eventType: "CLASS_RELEASED",
    teacherName: claim.teacher_name || "Faculty",
    teacherEmail: claim.teacher_email || "",
    courseName: slot?.course_name || "Course Session",
    dayOfWeek: slot?.day_of_week || "",
    timeSlot: slot?.time_slot || "",
    room: slot?.room,
    locationName: slot?.location,
    enrolledCount: slot?.students?.length || 0
  }).catch(() => undefined);
}

export { ClaimError };
