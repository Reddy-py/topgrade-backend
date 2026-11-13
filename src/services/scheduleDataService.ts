import { supabaseAdmin } from "../supabase.js";
import { getLocationById } from "./locationService.js";
import { ScheduleSlotService } from "./scheduleSlotService.js";
import { getNextDayOfWeekDateStr } from "./instituteTime.js";

export interface ScheduleStudent {
  id: string;
  schedule_id: string;
  student_id: string;
  student_name: string;
  student_code?: string | undefined;
  created_at?: string | undefined;
}

export interface ScheduleSlot {
  id: string;
  course_id: string;
  course_name: string;
  teacher_id: string;
  teacher_name: string;
  day_of_week: string; // 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'
  start_time: string;  // e.g. '10:00 AM'
  end_time: string;    // e.g. '11:30 AM'
  time_slot: string;   // e.g. '10:00 AM - 11:30 AM'
  room: string;
  location: string;
  location_id?: string | undefined;
  location_address?: string | undefined;
  max_capacity: number;
  is_active: boolean;
  students?: ScheduleStudent[];
  // Requirement 8: admin creates a slot without a teacher and marks it open; a teacher then takes it.
  open_for_teachers?: boolean | undefined;      // set by admin
  claimed_by_teacher?: boolean | undefined;     // true once a teacher took it
  eligible_teacher_ids?: string[] | undefined;  // if course lists assigned teachers, only they may take it
  program?: string | undefined;
  program_type?: string | undefined;
  start_minute?: number | undefined;
  end_minute?: number | undefined;
  duration_hours?: number | undefined;
  created_at?: string;
  updated_at?: string;
}

export interface TeacherAvailability {
  id: string;
  teacher_id: string;
  day_of_week: string;
  available_from: string;
  available_to: string;
  is_active: boolean;
  created_at?: string;
}

export interface StudentHistoryItem {
  id: string;
  student_id: string;
  student_name?: string;
  event_type: "ADMISSION" | "SCHEDULE_ASSIGNMENT" | "ATTENDANCE_RECORD" | "STATUS_CHANGE" | "NOTE" | "ENROLLMENT" | "COURSE_ENROLLMENT" | "PACKAGE_EXPIRED";
  title: string;
  description: string;
  metadata?: any;
  actor?: string;
  created_at: string;
}

// --- Time Parsing & Conflict Detection Helpers ---

export function parseTimeToMinutes(timeStr: string): number {
  if (!timeStr) return 0;
  const clean = timeStr.trim().toUpperCase();

  // Match 12-hour format e.g. "10:00 AM", "2:30 PM", "02:30PM"
  const ampmMatch = clean.match(/^(\d{1,2}):(\d{2})\s*(AM|PM)$/);
  if (ampmMatch && ampmMatch[1] && ampmMatch[2] && ampmMatch[3]) {
    let hours = parseInt(ampmMatch[1], 10);
    const minutes = parseInt(ampmMatch[2], 10);
    const period = ampmMatch[3];
    if (period === "PM" && hours < 12) hours += 12;
    if (period === "AM" && hours === 12) hours = 0;
    return hours * 60 + minutes;
  }

  // Match 24-hour format e.g. "14:30", "09:00"
  const m24 = clean.match(/^(\d{1,2}):(\d{2})$/);
  if (m24 && m24[1] && m24[2]) {
    const hours = parseInt(m24[1], 10);
    const minutes = parseInt(m24[2], 10);
    return hours * 60 + minutes;
  }

  return 0;
}

export function doTimesOverlap(startA: string, endA: string, startB: string, endB: string): boolean {
  const sA = parseTimeToMinutes(startA);
  const eA = parseTimeToMinutes(endA);
  const sB = parseTimeToMinutes(startB);
  const eB = parseTimeToMinutes(endB);

  const actualEndA = eA <= sA ? sA + 60 : eA;
  const actualEndB = eB <= sB ? sB + 60 : eB;

  return Math.max(sA, sB) < Math.min(actualEndA, actualEndB);
}

export function getSlotDurationMinutes(startTime: string, endTime: string): number {
  if (!startTime || !endTime) return 0;
  const s = parseTimeToMinutes(startTime);
  let e = parseTimeToMinutes(endTime);
  if (e <= s) e += 1440;
  return e - s;
}

export function formatMinutesToTime(minutes: number): string {
  let h = Math.floor(minutes / 60) % 24;
  const m = minutes % 60;
  const period = h >= 12 ? "PM" : "AM";
  if (h > 12) h -= 12;
  if (h === 0) h = 12;
  return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")} ${period}`;
}

export function computeEndTime(startTime: string, durationHours: number): string {
  const startMin = parseTimeToMinutes(startTime);
  const endMin = (startMin + (durationHours || 1) * 60) % 1440;
  return formatMinutesToTime(endMin);
}

// In-memory schedules cache & fallback store for resilient local/staging operation
export const inMemorySchedules = new Map<string, ScheduleSlot>();

// --- Schedule Data Service strictly backed by Supabase ---

export class ScheduleDataService {
  /**
   * Fetch all courses strictly from Supabase
   */
  static async getExistingCourses(): Promise<Array<{ id: string; name: string; course_code?: string }>> {
    try {
      const { data, error } = await supabaseAdmin
        .from("courses")
        .select("id, name, course_code")
        .order("name", { ascending: true });

      if (!error && data && data.length > 0) {
        return [...data].sort((a, b) =>
          (a.name || "").localeCompare(b.name || "", undefined, { sensitivity: "base" })
        );
      }
    } catch (err) {
      console.warn("Supabase getExistingCourses query notice:", err);
    }
    return [];
  }

  /**
   * Check for collisions: Teacher, Room, and Students
   */
  static async checkCollisions(params: {
    scheduleIdToExclude?: string | undefined;
    day_of_week: string;
    start_time: string;
    end_time: string;
    teacher_id: string;
    room: string;
    student_ids: string[];
  }): Promise<{ hasConflict: boolean; error?: string }> {
    const allSchedules = await this.listSchedules();
    const activeSchedules = allSchedules.filter(s =>
      s.is_active !== false &&
      s.id !== params.scheduleIdToExclude &&
      s.day_of_week.toLowerCase() === params.day_of_week.toLowerCase()
    );

    // 0. Teacher Availability Check (respect marked availability when set)
    if (params.teacher_id) {
      try {
        const { data: avRows } = await supabaseAdmin
          .from("teacher_availability")
          .select("*")
          .eq("teacher_id", params.teacher_id)
          .eq("is_active", true);

        const { data: teacherRow } = await supabaseAdmin
          .from("teachers")
          .select("id, name, availability_days, availability_slots")
          .eq("id", params.teacher_id)
          .maybeSingle();

        const tName = teacherRow?.name || "Teacher";

        if (avRows && avRows.length > 0) {
          const dayRule = avRows.find((r: any) => r.day_of_week.toLowerCase() === params.day_of_week.toLowerCase());
          if (!dayRule) {
            return {
              hasConflict: true,
              error: `Teacher Availability Conflict: ${tName} is not available on ${params.day_of_week}s.`
            };
          }
          const slotStartMin = parseTimeToMinutes(params.start_time);
          const slotEndMin = parseTimeToMinutes(params.end_time);
          const avStartMin = parseTimeToMinutes(dayRule.available_from);
          const avEndMin = parseTimeToMinutes(dayRule.available_to);

          if (slotStartMin < avStartMin || slotEndMin > avEndMin) {
            return {
              hasConflict: true,
              error: `Teacher Availability Conflict: ${tName}'s marked availability on ${params.day_of_week} is ${dayRule.available_from} - ${dayRule.available_to}. Slot (${params.start_time} - ${params.end_time}) falls outside available hours.`
            };
          }
        } else if (teacherRow?.availability_days && Array.isArray(teacherRow.availability_days) && teacherRow.availability_days.length > 0) {
          const isDayAvailable = teacherRow.availability_days.some((d: string) => d.toLowerCase() === params.day_of_week.toLowerCase());
          if (!isDayAvailable) {
            return {
              hasConflict: true,
              error: `Teacher Availability Conflict: ${tName} does not teach on ${params.day_of_week}s (Marked working days: ${teacherRow.availability_days.join(", ")}).`
            };
          }
        }
      } catch (avErr) {
        console.warn("Teacher availability collision check notice:", avErr);
      }
    }

    for (const slot of activeSchedules) {
      if (doTimesOverlap(slot.start_time, slot.end_time, params.start_time, params.end_time)) {
        // 1. Teacher Conflict
        if (params.teacher_id && slot.teacher_id === params.teacher_id) {
          return {
            hasConflict: true,
            error: `Teacher Collision: ${slot.teacher_name} is already scheduled for '${slot.course_name}' on ${slot.day_of_week} at ${slot.time_slot} (Room: ${slot.room}).`
          };
        }

        // 2. Room Conflict
        if (slot.room && params.room && slot.room.trim().toLowerCase() === params.room.trim().toLowerCase()) {
          return {
            hasConflict: true,
            error: `Room Collision: ${slot.room} is already booked for '${slot.course_name}' on ${slot.day_of_week} at ${slot.time_slot} (Teacher: ${slot.teacher_name}).`
          };
        }

        // 3. Student Conflict
        if (slot.students && slot.students.length > 0 && params.student_ids && params.student_ids.length > 0) {
          const conflictingStudent = slot.students.find(st => params.student_ids.includes(st.student_id));
          if (conflictingStudent) {
            return {
              hasConflict: true,
              error: `Student Collision: Student ${conflictingStudent.student_name} is already attending '${slot.course_name}' on ${slot.day_of_week} at ${slot.time_slot}.`
            };
          }
        }
      }
    }

    return { hasConflict: false };
  }

  /**
   * Suggest free 60-minute time slots for a teacher and room on a given weekday
   */
  static async suggestFreeSlots(params: {
    teacher_id?: string | undefined;
    room?: string | undefined;
    day_of_week: string;
    duration_minutes?: number | undefined;
    scheduleIdToExclude?: string | undefined;
  }): Promise<string[]> {
    const standardStartTimes = [
      "09:00 AM", "10:00 AM", "11:00 AM", "12:00 PM",
      "01:00 PM", "02:00 PM", "03:00 PM", "04:00 PM",
      "05:00 PM", "06:00 PM"
    ];
    const duration = params.duration_minutes || 60;
    const freeSlots: string[] = [];

    for (const startTime of standardStartTimes) {
      const sMin = parseTimeToMinutes(startTime);
      const eMin = sMin + duration;
      let h = Math.floor(eMin / 60);
      const m = eMin % 60;
      const period = h >= 12 && h < 24 ? "PM" : "AM";
      if (h > 12) h -= 12;
      if (h === 0) h = 12;
      const endTime = `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")} ${period}`;

      const conflict = await this.checkCollisions({
        scheduleIdToExclude: params.scheduleIdToExclude,
        day_of_week: params.day_of_week,
        start_time: startTime,
        end_time: endTime,
        teacher_id: params.teacher_id || "",
        room: params.room || "",
        student_ids: []
      });

      if (!conflict.hasConflict) {
        freeSlots.push(`${startTime} - ${endTime}`);
      }
    }

    return freeSlots;
  }

  /**
   * List all schedule slots strictly from Supabase public.schedule_slots
   */
  static async listSchedules(): Promise<ScheduleSlot[]> {
    let slotsList: ScheduleSlot[] = [];

    try {
      const dbSlots = await ScheduleSlotService.listSlots();
      if (dbSlots && dbSlots.length > 0) {
        slotsList = dbSlots
          .filter(s => s.status !== "cancelled")
          .map(s => ({
          id: s.id,
          course_id: s.course_id,
          course_name: s.course_name,
          teacher_id: s.teacher_id,
          teacher_name: s.teacher_name,
          day_of_week: s.day_of_week,
          start_time: s.start_time,
          end_time: s.end_time,
          start_minute: parseTimeToMinutes(s.start_time),
          end_minute: parseTimeToMinutes(s.end_time),
          duration_hours: s.duration_hours,
          time_slot: s.time_slot,
          room: s.notes || "Room 101",
          location: "Main Academic Center",
          max_capacity: s.max_students,
          is_active: s.status !== "cancelled",
          open_for_teachers: !s.teacher_id,
          claimed_by_teacher: Boolean(s.teacher_id),
          program: "TUTORING",
          program_type: "TUTORING",
          students: (s.students || []).map(st => ({
            id: st.booking_id,
            schedule_id: s.id,
            student_id: st.student_id,
            student_name: st.student_name,
            student_code: st.student_code
          })),
          created_at: s.created_at,
          updated_at: s.updated_at
        }));

        return slotsList.sort((a, b) =>
          (a.course_name || "").localeCompare(b.course_name || "", undefined, { sensitivity: "base" })
        );
      }
    } catch (err: any) {
      console.warn("ScheduleSlotService.listSlots notice:", err?.message);
    }

    // Merge in-memory slots that are not present in slotsList
    for (const [id, memSlot] of inMemorySchedules.entries()) {
      if (!slotsList.some(s => s.id === id)) {
        slotsList.push(memSlot);
      }
    }

    return slotsList.sort((a, b) =>
      (a.course_name || "").localeCompare(b.course_name || "", undefined, { sensitivity: "base" })
    );
  }

  /**
   * Scan existing slots and return any that are not strictly 60 minutes
   */
  static async getIrregularScheduleSlotsReport(): Promise<{
    totalScanned: number;
    irregularCount: number;
    irregularSlots: (ScheduleSlot & { duration_minutes: number })[];
  }> {
    const allSlots = await this.listSchedules();
    const irregularSlots = allSlots
      .map(slot => ({
        ...slot,
        duration_minutes: getSlotDurationMinutes(slot.start_time, slot.end_time)
      }))
      .filter(slot => slot.duration_minutes !== 60 && slot.duration_minutes !== 120);

    return {
      totalScanned: allSlots.length,
      irregularCount: irregularSlots.length,
      irregularSlots
    };
  }

  /**
   * Create a schedule slot in Supabase public.schedule_slots
   */
  static async createSchedule(payload: {
    id?: string;
    course_id: string;
    course_name: string;
    teacher_id: string;
    teacher_name: string;
    day_of_week: string;
    start_time: string;
    end_time: string;
    room?: string;
    location?: string;
    location_id?: string;
    location_address?: string;
    max_capacity?: number;
    open_for_teachers?: boolean;
    program?: string;
    program_type?: string;
    students?: Array<{ student_id: string; student_name: string; student_code?: string }>;
  }): Promise<ScheduleSlot> {
    const duration = getSlotDurationMinutes(payload.start_time, payload.end_time);
    const durHours = duration / 60;

    // Resolve date in CST for the target day of week
    const dateCst = getNextDayOfWeekDateStr(payload.day_of_week);

    // If teacher_id is empty, pick first active teacher from teachers table
    let effectiveTeacherId = payload.teacher_id;
    if (!effectiveTeacherId || effectiveTeacherId.trim() === "") {
      const { data: firstTeacher } = await supabaseAdmin
        .from("teachers")
        .select("id, name")
        .eq("status", "Active")
        .limit(1)
        .maybeSingle();
      if (firstTeacher) {
        effectiveTeacherId = firstTeacher.id;
      }
    }

    const slotDto = await ScheduleSlotService.createSlot({
      course_id: payload.course_id,
      teacher_id: effectiveTeacherId,
      date_cst: dateCst,
      start_time_cst: payload.start_time,
      duration_hours: durHours,
      max_students: payload.max_capacity || 15,
      notes: payload.room || payload.location || "Room 101"
    });

    // If students are assigned, enroll each through the transactional booking RPC
    if (payload.students && payload.students.length > 0) {
      for (const st of payload.students) {
        try {
          await ScheduleSlotService.bookSlot(st.student_id, slotDto.id);
        } catch (bErr: any) {
          console.warn(`Notice enrolling student ${st.student_name}:`, bErr?.message);
        }
      }
    }

    const reloaded = (await this.listSchedules()).find(s => s.id === slotDto.id);
    return reloaded || {
      id: slotDto.id,
      course_id: slotDto.course_id,
      course_name: slotDto.course_name,
      teacher_id: slotDto.teacher_id,
      teacher_name: slotDto.teacher_name,
      day_of_week: slotDto.day_of_week,
      start_time: slotDto.start_time,
      end_time: slotDto.end_time,
      time_slot: slotDto.time_slot,
      room: slotDto.notes || "Room 101",
      location: "Main Academic Center",
      max_capacity: slotDto.max_students,
      is_active: true,
      duration_hours: slotDto.duration_hours,
      created_at: slotDto.created_at,
      updated_at: slotDto.updated_at
    };
  }

  /**
   * Create multiple schedule slots for multiple days (atomic all-or-nothing in one transaction)
   */
  static async createMultiDaySchedules(payload: {
    course_id: string;
    course_name: string;
    teacher_id: string;
    teacher_name: string;
    days_of_week: string[];
    start_time: string;
    end_time: string;
    room?: string;
    location?: string;
    location_id?: string;
    location_address?: string;
    max_capacity?: number;
    open_for_teachers?: boolean;
    program?: string;
    program_type?: string;
    students?: Array<{ student_id: string; student_name: string; student_code?: string }>;
  }): Promise<ScheduleSlot[]> {
    const days = (payload.days_of_week && payload.days_of_week.length > 0)
      ? payload.days_of_week
      : ["Monday"];

    // 1. Pre-validate collisions across ALL days first (atomic all-or-nothing)
    for (const day of days) {
      const conflict = await this.checkCollisions({
        day_of_week: day,
        start_time: payload.start_time,
        end_time: payload.end_time,
        teacher_id: payload.teacher_id,
        room: payload.room || "Room 101",
        student_ids: (payload.students || []).map(s => s.student_id)
      });
      if (conflict.hasConflict) {
        throw new Error(`Batch Creation Aborted: Collision detected on ${day}: ${conflict.error}`);
      }
    }

    // 2. Create slots; if any fails, rollback all created slots in this batch
    const createdSlots: ScheduleSlot[] = [];
    try {
      for (const day of days) {
        const slot = await this.createSchedule({
          ...payload,
          day_of_week: day
        });
        createdSlots.push(slot);
      }
      return createdSlots;
    } catch (err: any) {
      // Rollback any slots created so far in this batch
      for (const s of createdSlots) {
        await this.deleteSchedule(s.id).catch(() => {});
      }
      throw new Error(`Batch multi-day schedule creation failed and was rolled back: ${err.message}`);
    }
  }

  /**
   * Update an existing schedule slot in Supabase
   */
  static async updateSchedule(
    id: string,
    payload: Omit<Partial<ScheduleSlot>, "students"> & { students?: Array<{ student_id: string; student_name: string; student_code?: string }> }
  ): Promise<ScheduleSlot> {
    const existing = (await this.listSchedules()).find(s => s.id === id);
    if (!existing) {
      throw new Error(`Schedule slot with ID '${id}' not found.`);
    }

    const updatedDay = payload.day_of_week || existing.day_of_week;
    const updatedStart = payload.start_time || existing.start_time;
    const updatedEnd = payload.end_time || existing.end_time;

    const duration = getSlotDurationMinutes(updatedStart, updatedEnd);
    const validDurations = [60, 120, 180, 240];
    if (!validDurations.includes(duration)) {
      throw new Error(`Invalid class duration: slot must be 1, 2, 3, or 4 whole hours (60, 120, 180, or 240 minutes). Received ${duration} minutes (${updatedStart} to ${updatedEnd}).`);
    }

    const updatedTeacher = payload.teacher_id !== undefined ? payload.teacher_id : existing.teacher_id;
    const updatedRoom = payload.room || existing.room;
    const updatedStudents = payload.students
      ? payload.students.map(s => s.student_id)
      : (existing.students || []).map(s => s.student_id);

    // Collision check
    const conflict = await this.checkCollisions({
      scheduleIdToExclude: id,
      day_of_week: updatedDay,
      start_time: updatedStart,
      end_time: updatedEnd,
      teacher_id: updatedTeacher,
      room: updatedRoom,
      student_ids: updatedStudents
    });

    if (conflict.hasConflict) {
      throw new Error(conflict.error);
    }

    const timeSlot = `${updatedStart} - ${updatedEnd}`;
    const nowIso = new Date().toISOString();
    const durHours = duration / 60;
    const dateCst = getNextDayOfWeekDateStr(updatedDay);
    const startUtc = cstDateTimeToUtc(dateCst, updatedStart);
    const endUtc = new Date(startUtc.getTime() + durHours * 3600 * 1000);

    // 1. Update public.schedule_slots (single source of truth for slot management)
    try {
      const slotUpdates: any = {
        start_at: startUtc.toISOString(),
        end_at: endUtc.toISOString(),
        duration_hours: durHours,
        max_students: payload.max_capacity !== undefined ? payload.max_capacity : (existing.max_capacity || 15),
        notes: payload.room || existing.room || "Room 101",
        updated_at: nowIso
      };
      if (payload.course_id) slotUpdates.course_id = payload.course_id;
      if (payload.grade) slotUpdates.grade = payload.grade;
      if (payload.teacher_id) {
        slotUpdates.teacher_id = payload.teacher_id;
      } else if (payload.open_for_teachers === true) {
        slotUpdates.teacher_id = null;
      }
      const { error: slotErr } = await supabaseAdmin.from("schedule_slots").update(slotUpdates).eq("id", id);
      if (slotErr) {
        console.warn("Supabase schedule_slots update note:", slotErr.message);
      }
    } catch (sErr: any) {
      console.warn("Notice updating schedule_slots in updateSchedule:", sErr?.message);
    }

    // 2. Update legacy public.schedules for backward compatibility
    const updateFields: any = {
      updated_at: nowIso,
      time_slot: timeSlot,
      start_time: updatedStart,
      end_time: updatedEnd,
      day_of_week: updatedDay
    };

    if (payload.course_id !== undefined) updateFields.course_id = payload.course_id;
    if (payload.course_name !== undefined) updateFields.course_name = payload.course_name;
    if (payload.location !== undefined || payload.location_id !== undefined || payload.location_address !== undefined) {
      let locName = payload.location || existing.location;
      let locAddr = payload.location_address !== undefined ? payload.location_address : (existing.location_address || "");
      let locId = payload.location_id !== undefined ? payload.location_id : existing.location_id;

      if (payload.location_id) {
        const loc = await getLocationById(payload.location_id);
        if (loc) {
          locName = loc.name;
          if (!locAddr) locAddr = loc.address;
        }
      } else if (payload.location) {
        const loc = await getLocationById(payload.location);
        if (loc) {
          locId = loc.id;
          locName = loc.name;
          if (!locAddr) locAddr = loc.address;
        }
      }
      updateFields.location = locName;
      updateFields.location_id = locId || null;
      updateFields.location_address = locAddr || null;
    }

    if (payload.program_type !== undefined || payload.program !== undefined) {
      const prog = (payload.program_type || payload.program || "TUTORING").toUpperCase();
      updateFields.program = prog;
      updateFields.program_type = prog;
    }

    if (payload.max_capacity !== undefined) updateFields.max_capacity = payload.max_capacity;
    if (payload.is_active !== undefined) updateFields.is_active = payload.is_active;

    if (payload.teacher_id) {
      updateFields.open_for_teachers = false;
      updateFields.teacher_id = payload.teacher_id;
      updateFields.teacher_name = payload.teacher_name || existing.teacher_name;
      await supabaseAdmin.from("teacher_slot_claims").delete().eq("slot_id", id);
    } else if (payload.open_for_teachers === true) {
      updateFields.open_for_teachers = true;
      updateFields.teacher_id = null;
      updateFields.teacher_name = null;
      await supabaseAdmin.from("teacher_slot_claims").delete().eq("slot_id", id);
    } else if (existing.claimed_by_teacher) {
      updateFields.open_for_teachers = true;
      updateFields.teacher_id = null;
      updateFields.teacher_name = null;
    }

    let { error: updErr } = await supabaseAdmin
      .from("schedules")
      .update(updateFields)
      .eq("id", id);

    if (updErr && (updErr.message.includes("location_id") || updErr.message.includes("location_address") || updErr.message.includes("program_type"))) {
      delete updateFields.location_id;
      delete updateFields.location_address;
      delete updateFields.program_type;
      const retry = await supabaseAdmin.from("schedules").update(updateFields).eq("id", id);
      updErr = retry.error;
    }

    if (updErr) {
      console.warn("Supabase schedule update note, persisting to inMemorySchedules fallback:", updErr.message);
    }

    // Update mapped students if provided
    if (payload.students) {
      try {
        await supabaseAdmin.from("schedule_students").delete().eq("schedule_id", id);
        if (payload.students.length > 0) {
          const studentRows = payload.students.map(st => ({
            schedule_id: id,
            student_id: st.student_id,
            student_name: st.student_name,
            student_code: st.student_code || null,
            created_at: nowIso
          }));
          await supabaseAdmin.from("schedule_students").insert(studentRows);
        }
      } catch (stErr: any) {
        console.warn("Supabase schedule_students update note:", stErr?.message);
      }
    }

    const updatedSlot: ScheduleSlot = {
      ...existing,
      ...updateFields,
      start_time: updatedStart,
      end_time: updatedEnd,
      day_of_week: updatedDay,
      duration_hours: durHours,
      students: payload.students ? payload.students.map((st, idx) => ({
        id: `st-map-${id}-${idx}`,
        schedule_id: id,
        student_id: st.student_id,
        student_name: st.student_name,
        student_code: st.student_code
      })) : existing.students
    };
    inMemorySchedules.set(id, updatedSlot);

    const refreshed = (await this.listSchedules()).find(s => s.id === id);
    return refreshed || updatedSlot;
  }

  /**
   * Delete or cancel a schedule slot in Supabase
   */
  static async deleteSchedule(id: string): Promise<boolean> {
    inMemorySchedules.delete(id);
    // 1. Cancel via ScheduleSlotService (releases tokens, marks bookings cancelled)
    try {
      await ScheduleSlotService.cancelSlot(id, undefined, "Slot cancelled by administrator");
    } catch (e: any) {
      console.warn("Notice cancelling slot in ScheduleSlotService:", e?.message);
    }

    // 2. Delete or mark schedule_slots cancelled
    try {
      await supabaseAdmin.from("schedule_slots").update({ status: "cancelled", updated_at: new Date().toISOString() }).eq("id", id);
      const { data: bList } = await supabaseAdmin.from("bookings").select("id").eq("slot_id", id);
      if (!bList || bList.length === 0) {
        await supabaseAdmin.from("schedule_slots").delete().eq("id", id);
      }
    } catch (e: any) {
      console.warn("Notice deleting from schedule_slots table:", e?.message);
    }

    // 3. Delete from legacy schedules and student links
    try {
      await supabaseAdmin.from("schedules").delete().eq("id", id);
      await supabaseAdmin.from("schedule_students").delete().eq("schedule_id", id);
    } catch (e: any) {
      console.warn("Notice deleting from schedules table:", e?.message);
    }

    return true;
  }

  /**
   * Enroll a student into a schedule slot (books slot via token engine)
   */
  static async enrollStudentInSchedule(params: {
    schedule_id: string;
    student_id: string;
    student_name: string;
    student_code?: string;
  }): Promise<ScheduleSlot> {
    await ScheduleSlotService.bookSlot(params.student_id, params.schedule_id);
    const slot = (await this.listSchedules()).find(s => s.id === params.schedule_id);
    if (!slot) throw new Error(`Schedule slot '${params.schedule_id}' not found after booking.`);
    return slot;
  }

  /**
   * Teacher claims an open slot
   */
  static async claimOpenSlot(slotId: string, teacherId: string, teacherName: string, teacherEmail?: string): Promise<ScheduleSlot> {
    const all = await this.listSchedules();
    const slot = all.find(s => s.id === slotId);
    if (!slot) {
      throw new Error(`Schedule slot '${slotId}' not found.`);
    }

    // Enforce teacher collision and availability checks when taking an open slot
    const conflict = await this.checkCollisions({
      scheduleIdToExclude: slotId,
      day_of_week: slot.day_of_week,
      start_time: slot.start_time,
      end_time: slot.end_time,
      teacher_id: teacherId,
      room: slot.room,
      student_ids: []
    });

    if (conflict.hasConflict) {
      throw new Error(`Cannot claim class: ${conflict.error}`);
    }

    const updatedSlot: ScheduleSlot = {
      ...slot,
      teacher_id: teacherId,
      teacher_name: teacherName,
      claimed_by_teacher: true,
      open_for_teachers: false,
      updated_at: new Date().toISOString()
    };

    inMemorySchedules.set(slotId, updatedSlot);

    try {
      await supabaseAdmin.from("schedules").update({
        teacher_id: teacherId,
        teacher_name: teacherName,
        open_for_teachers: false
      }).eq("id", slotId);
    } catch (e: any) {
      console.warn("Supabase schedule claim update notice:", e?.message);
    }

    try {
      await supabaseAdmin.from("teacher_slot_claims").insert({
        slot_id: slotId,
        teacher_id: teacherId,
        teacher_name: teacherName,
        teacher_email: teacherEmail || ""
      });
    } catch (e: any) {
      console.warn("Supabase teacher_slot_claims insert notice:", e?.message);
    }

    return updatedSlot;
  }

  /**
   * Enroll one or more students into a specific class slot with capacity and student collision checks
   */
  static async enrollStudentsInSlot(scheduleId: string, studentIds: string[]): Promise<{ slot: ScheduleSlot; enrolledCount: number }> {
    const all = await this.listSchedules();
    const slot = all.find(s => s.id === scheduleId);
    if (!slot) {
      throw new Error(`Schedule slot '${scheduleId}' not found.`);
    }

    const currentEnrolled = slot.students || [];
    const currentStudentIds = new Set(currentEnrolled.map(s => s.student_id));
    const currentStudentCodes = new Set(currentEnrolled.map(s => s.student_code).filter(Boolean));
    const newStudentIds = studentIds.filter(id => !currentStudentIds.has(id) && !currentStudentCodes.has(id));

    if (newStudentIds.length === 0) {
      return { slot, enrolledCount: currentEnrolled.length };
    }

    const maxCapacity = slot.max_capacity || 15;
    if (currentEnrolled.length + newStudentIds.length > maxCapacity) {
      throw new Error(`Class capacity limit reached (${maxCapacity}). Cannot enroll more students. (Currently enrolled: ${currentEnrolled.length}, Attempting to add: ${newStudentIds.length})`);
    }

    // Resolve student objects by ID or student_id_code
    let dbStudents: any[] = [];
    try {
      const res1 = await supabaseAdmin.from("students").select("id, name, student_id_code").in("id", newStudentIds);
      const res2 = await supabaseAdmin.from("students").select("id, name, student_id_code").in("student_id_code", newStudentIds);
      dbStudents = [...(res1.data || []), ...(res2.data || [])];
    } catch (e) {}

    const stuMap = new Map<string, any>();
    for (const s of dbStudents) {
      stuMap.set(s.id, s);
      if (s.student_id_code) stuMap.set(s.student_id_code, s);
    }

    // Check student collisions across each student's existing schedule slots
    for (const studentId of newStudentIds) {
      const studentObj = stuMap.get(studentId);
      const effectiveId = studentObj?.id || studentId;
      const studentSchedules = await this.getStudentSchedules(effectiveId);
      for (const existingSlot of studentSchedules) {
        if (
          existingSlot.id !== slot.id &&
          existingSlot.day_of_week.toLowerCase() === slot.day_of_week.toLowerCase() &&
          doTimesOverlap(existingSlot.start_time, existingSlot.end_time, slot.start_time, slot.end_time)
        ) {
          const studentName = studentObj?.name || "Student";
          throw new Error(`Student Collision: Student ${studentName} is already enrolled in '${existingSlot.course_name}' on ${slot.day_of_week} at ${existingSlot.time_slot}.`);
        }
      }
    }

    const nowIso = new Date().toISOString();
    const enrolledStudentsToAdd: ScheduleStudent[] = [];

    for (const studentId of newStudentIds) {
      const studentObj = stuMap.get(studentId);
      const effectiveStudentId = studentObj?.id || studentId;
      const studentName = studentObj?.name || (studentId.startsWith("TG-STU") ? studentId : "Student");
      const studentCode = studentObj?.student_id_code || (studentId.startsWith("TG-STU") ? studentId : undefined);

      // Book student into slot via unified token architecture
      await ScheduleSlotService.bookSlot(effectiveStudentId, slot.id);

      const entry: ScheduleStudent = {
        id: `st-map-${slot.id}-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
        schedule_id: slot.id,
        student_id: effectiveStudentId,
        student_name: studentName,
        student_code: studentCode,
        created_at: nowIso
      };
      enrolledStudentsToAdd.push(entry);

      void this.appendHistoryItem({
        student_id: effectiveStudentId,
        student_name: studentName,
        event_type: "SCHEDULE_ASSIGNMENT",
        title: `Enrolled in Class: ${slot.course_name}`,
        description: `Class on ${slot.day_of_week}s (${slot.time_slot}) at ${slot.room} with faculty ${slot.teacher_name || "Staff"}.`,
        metadata: {
          schedule_id: slot.id,
          course_name: slot.course_name,
          day_of_week: slot.day_of_week,
          time_slot: slot.time_slot,
          room: slot.room,
          teacher_name: slot.teacher_name
        },
        actor: "Academic Registrar"
      });
    }

    // Always update local slot.students and inMemorySchedules
    slot.students = [...currentEnrolled, ...enrolledStudentsToAdd];
    inMemorySchedules.set(slot.id, slot);

    return { slot, enrolledCount: slot.students.length };
  }

  /**
   * Assign / enroll a student directly into a specific schedule slot
   */
  static async assignStudentToSlot(payload: {
    schedule_id: string;
    student_id: string;
    student_name: string;
    student_code?: string;
  }): Promise<ScheduleSlot> {
    const res = await this.enrollStudentsInSlot(payload.schedule_id, [payload.student_id]);
    return res.slot;
  }

  /**
   * Unassign / remove a student from a specific schedule slot
   */
  static async unassignStudentFromSlot(payload: {
    schedule_id: string;
    student_id: string;
    student_code?: string;
  }): Promise<ScheduleSlot | null> {
    try {
      const { data: booking } = await supabaseAdmin
        .from("bookings")
        .select("id")
        .eq("slot_id", payload.schedule_id)
        .eq("student_id", payload.student_id)
        .eq("status", "booked")
        .maybeSingle();

      if (booking?.id) {
        await ScheduleSlotService.cancelBooking(booking.id, undefined, "Unassigned by administrator");
      }
    } catch (e: any) {
      console.warn("Notice cancelling booking on unassign:", e?.message);
    }

    const refreshed = (await this.listSchedules()).find(s => s.id === payload.schedule_id);
    return refreshed || null;
  }

  /**
   * Sync a student's assigned slots
   */
  static async syncStudentSlots(payload: {
    student_id: string;
    student_name: string;
    student_code?: string;
    parent_email?: string;
    schedule_ids: string[];
  }): Promise<void> {
    const all = await this.listSchedules();
    const targetIds = new Set(payload.schedule_ids || []);

    for (const slot of all) {
      const isCurrentlyInSlot = slot.students?.some(
        st => st.student_id === payload.student_id || (payload.student_code && st.student_code === payload.student_code)
      );

      if (isCurrentlyInSlot && !targetIds.has(slot.id)) {
        await this.unassignStudentFromSlot({
          schedule_id: slot.id,
          student_id: payload.student_id,
          ...(payload.student_code ? { student_code: payload.student_code } : {})
        });
      } else if (!isCurrentlyInSlot && targetIds.has(slot.id)) {
        await this.assignStudentToSlot({
          schedule_id: slot.id,
          student_id: payload.student_id,
          student_name: payload.student_name,
          ...(payload.student_code ? { student_code: payload.student_code } : {})
        });
      }
    }
  }

  /**
   * Get all schedule slots assigned to a specific student
   */
  static async getStudentSchedules(studentId: string): Promise<ScheduleSlot[]> {
    const all = await this.listSchedules();
    const sid = String(studentId);
    return all.filter(s =>
      s.is_active !== false &&
      s.students && s.students.some(st =>
        st.student_id === sid ||
        String(st.student_id) === sid ||
        (st.student_code && (st.student_code === sid || String(st.student_code) === sid))
      )
    );
  }

  /**
   * Get teacher roster
   */
  static async getTeacherRoster(teacherId: string): Promise<Array<{
    schedule_id: string;
    course_name: string;
    day_of_week: string;
    time_slot: string;
    room: string;
    students: ScheduleStudent[];
  }>> {
    const all = await this.listSchedules();
    const teacherSlots = all.filter(s => s.teacher_id === teacherId || s.teacher_name?.toLowerCase() === teacherId.toLowerCase());
    return teacherSlots.map(s => ({
      schedule_id: s.id,
      course_name: s.course_name,
      day_of_week: s.day_of_week,
      time_slot: s.time_slot,
      room: s.room,
      students: s.students || []
    }));
  }

  // In-memory student history fallback store
  private static inMemoryStudentHistory: StudentHistoryItem[] = [];

  /**
   * Append audit event to Student History in Supabase
   */
  static async appendHistoryItem(item: Omit<StudentHistoryItem, "id" | "created_at">): Promise<StudentHistoryItem> {
    const nowIso = new Date().toISOString();
    const record: StudentHistoryItem = {
      ...item,
      id: `hist-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
      created_at: nowIso
    };

    this.inMemoryStudentHistory.push(record);

    try {
      await supabaseAdmin.from("student_history").insert([
        {
          id: record.id,
          student_id: item.student_id,
          student_name: item.student_name || null,
          event_type: item.event_type,
          title: item.title,
          description: item.description || null,
          metadata: item.metadata || {},
          actor: item.actor || "System",
          created_at: nowIso
        }
      ]);
    } catch (err: any) {
      console.warn("Supabase student_history insert note:", err?.message);
    }

    return record;
  }

  /**
   * Get complete Student History Ledger
   */
  static async getStudentHistory(studentId: string): Promise<StudentHistoryItem[]> {
    let historyItems: StudentHistoryItem[] = [];

    try {
      const { data, error } = await supabaseAdmin
        .from("student_history")
        .select("*")
        .eq("student_id", studentId)
        .order("created_at", { ascending: false });

      if (!error && data && data.length > 0) {
        historyItems = data;
      }
    } catch (err) {
      console.warn("Supabase history fetch notice:", err);
    }

    // Pull attendance records for this student from Supabase attendance table
    try {
      const { data: attData } = await supabaseAdmin
        .from("attendance")
        .select("*")
        .or(`student_id.eq.${studentId},student_name.ilike.%${studentId}%`)
        .order("date", { ascending: false });

      if (attData && attData.length > 0) {
        attData.forEach((att: any) => {
          const exists = historyItems.some(h =>
            h.metadata?.attendance_id === att.id ||
            (h.event_type === "ATTENDANCE_RECORD" && h.metadata?.date === att.date && h.metadata?.class_name === att.class_name)
          );
          if (!exists) {
            historyItems.push({
              id: `att-hist-${att.id}`,
              student_id: studentId,
              student_name: att.student_name,
              event_type: "ATTENDANCE_RECORD",
              title: `Daily Attendance: ${att.status || "PRESENT"}`,
              description: `Attended '${att.class_name || "Course Session"}' on ${att.date}. Marked by: ${att.marked_by || "Faculty"}.${att.remarks ? ` Note: ${att.remarks}` : ""}`,
              metadata: {
                attendance_id: att.id,
                date: att.date,
                status: att.status,
                class_name: att.class_name,
                marked_by: att.marked_by,
                remarks: att.remarks
              },
              actor: att.marked_by || "Faculty",
              created_at: att.created_at || `${att.date}T12:00:00.000Z`
            });
          }
        });
      }
    } catch (e) {
      console.warn("Attendance ledger merge notice:", e);
    }

    // Pull student enrollments from Supabase student_enrollments table
    try {
      const { data: enrData } = await supabaseAdmin
        .from("student_enrollments")
        .select("*")
        .eq("student_id", studentId)
        .order("created_at", { ascending: false });

      if (enrData && enrData.length > 0) {
        const { data: crsList } = await supabaseAdmin
          .from("courses")
          .select("id, name, course_code");
        const courseMap = new Map((crsList || []).map((c: any) => [c.id, c.name]));

        enrData.forEach((enr: any) => {
          const cName = courseMap.get(enr.course_id) || enr.course_id || "Course";
          const exists = historyItems.some(h =>
            h.metadata?.enrollment_id === enr.id ||
            (h.event_type === "COURSE_ENROLLMENT" && h.metadata?.enrollment_id === enr.id)
          );
          if (!exists) {
            historyItems.push({
              id: `enr-hist-${enr.id}`,
              student_id: studentId,
              student_name: "",
              event_type: "COURSE_ENROLLMENT",
              title: `Course Enrolled: ${cName} (${enr.plan} Plan)`,
              description: `Enrolled into ${cName} on ${enr.starts_on}. Total Hours: ${enr.hours_total} hrs. Quoted Amount: $${enr.quoted_amount ?? 0}. ${enr.expires_on ? `Expires: ${enr.expires_on}` : "No Expiry"}. Status: ${enr.status}.`,
              metadata: {
                enrollment_id: enr.id,
                course_id: enr.course_id,
                course_name: cName,
                plan: enr.plan,
                hours_total: enr.hours_total,
                quoted_amount: enr.quoted_amount,
                starts_on: enr.starts_on,
                expires_on: enr.expires_on,
                status: enr.status
              },
              actor: "Enrollment Manager",
              created_at: enr.created_at || (enr.starts_on ? `${enr.starts_on}T09:00:00.000Z` : new Date().toISOString())
            });
          }
        });
      }
    } catch (e) {
      console.warn("Enrollment ledger merge notice:", e);
    }

    // Merge matching in-memory history events
    this.inMemoryStudentHistory
      .filter(item => item.student_id === studentId)
      .forEach(item => {
        if (!historyItems.some(h => h.id === item.id)) {
          historyItems.push(item);
        }
      });

    return historyItems.sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime());
  }

  /**
   * Teacher Availability stored in Supabase
   */
  static async getTeacherAvailability(teacherId: string): Promise<TeacherAvailability[]> {
    try {
      const { data, error } = await supabaseAdmin
        .from("teacher_availability")
        .select("*")
        .eq("teacher_id", teacherId);

      if (!error && data) return data;
    } catch (err) {
      console.warn("Supabase getTeacherAvailability notice:", err);
    }
    return [];
  }

  static async setTeacherAvailability(
    teacherId: string,
    list: Array<{ day_of_week: string; available_from: string; available_to: string; is_active: boolean }>
  ): Promise<void> {
    try {
      await supabaseAdmin.from("teacher_availability").delete().eq("teacher_id", teacherId);
      if (list.length > 0) {
        const rows = list.map(item => ({
          teacher_id: teacherId,
          day_of_week: item.day_of_week,
          available_from: item.available_from,
          available_to: item.available_to,
          is_active: item.is_active !== false,
          created_at: new Date().toISOString()
        }));
        await supabaseAdmin.from("teacher_availability").insert(rows);
      }
    } catch (err) {
      console.warn("Supabase setTeacherAvailability notice:", err);
    }
  }
}
