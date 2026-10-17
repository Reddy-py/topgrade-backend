import { supabaseAdmin } from "../supabase.js";
import { getLocationById } from "./locationService.js";

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
   * List all schedule slots strictly from Supabase schedules table + claims overlay
   */
  static async listSchedules(): Promise<ScheduleSlot[]> {
    let slotsList: ScheduleSlot[] = [];

    try {
      const { data: schedData, error: schedErr } = await supabaseAdmin
        .from("schedules")
        .select("*")
        .order("created_at", { ascending: true });

      if (schedErr) {
        console.warn("Supabase schedules query notice:", schedErr.message);
        return Array.from(inMemorySchedules.values()).sort((a, b) =>
          (a.course_name || "").localeCompare(b.course_name || "", undefined, { sensitivity: "base" })
        );
      }

      if (!schedData || schedData.length === 0) {
        return Array.from(inMemorySchedules.values()).sort((a, b) =>
          (a.course_name || "").localeCompare(b.course_name || "", undefined, { sensitivity: "base" })
        );
      }

      // Fetch students mapped to all schedules
      const { data: studentMap } = await supabaseAdmin
        .from("schedule_students")
        .select("*");

      const studentsBySchedule = new Map<string, ScheduleStudent[]>();
      if (studentMap && Array.isArray(studentMap)) {
        for (const sm of studentMap) {
          const schedId = sm.schedule_id;
          if (!studentsBySchedule.has(schedId)) {
            studentsBySchedule.set(schedId, []);
          }
          studentsBySchedule.get(schedId)!.push({
            id: sm.id,
            schedule_id: sm.schedule_id,
            student_id: sm.student_id,
            student_name: sm.student_name,
            student_code: sm.student_code,
            created_at: sm.created_at
          });
        }
      }

      // Fetch teacher slot claims overlay
      const { data: claimsData } = await supabaseAdmin
        .from("teacher_slot_claims")
        .select("slot_id, teacher_id, teacher_name, teacher_email");

      const claimBySlot = new Map<string, any>(
        (claimsData || []).map((c: any) => [c.slot_id, c])
      );

      slotsList = schedData.map((s: any) => {
        const slotStudents = (studentsBySchedule.get(s.id) || []).sort((a, b) =>
          (a.student_name || "").localeCompare(b.student_name || "", undefined, { sensitivity: "base" })
        );

        const isOpen = s.open_for_teachers === true;
        const claim = isOpen ? claimBySlot.get(s.id) : undefined;
        const rawProgram = s.program_type || s.program || "TUTORING";

        return {
          id: String(s.id),
          course_id: String(s.course_id || ""),
          course_name: String(s.course_name || ""),
          teacher_id: claim ? claim.teacher_id : (s.teacher_id || ""),
          teacher_name: claim ? (claim.teacher_name || s.teacher_name || "") : (s.teacher_name || ""),
          day_of_week: s.day_of_week,
          start_time: s.start_time,
          end_time: s.end_time,
          time_slot: s.time_slot || `${s.start_time} - ${s.end_time}`,
          room: s.room || "Room 101",
          location: s.location || "Main Academic Center",
          location_id: s.location_id || undefined,
          location_address: s.location_address || undefined,
          max_capacity: s.max_capacity || 15,
          is_active: s.is_active !== false,
          open_for_teachers: isOpen,
          claimed_by_teacher: Boolean(claim),
          program: rawProgram,
          program_type: (s.program_type || rawProgram).toUpperCase(),
          students: slotStudents,
          created_at: s.created_at,
          updated_at: s.updated_at
        };
      });
    } catch (err: any) {
      console.warn("ScheduleDataService.listSchedules error:", err?.message);
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
      .filter(slot => slot.duration_minutes !== 60);

    return {
      totalScanned: allSlots.length,
      irregularCount: irregularSlots.length,
      irregularSlots
    };
  }

  /**
   * Create a schedule slot in Supabase
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
    if (duration !== 60) {
      throw new Error(`Invalid class duration: slot must be exactly 60 minutes (1 hour). Received ${duration} minutes (${payload.start_time} to ${payload.end_time}).`);
    }

    const studentIds = (payload.students || []).map(s => s.student_id);

    // Collision check
    const conflict = await this.checkCollisions({
      scheduleIdToExclude: payload.id,
      day_of_week: payload.day_of_week,
      start_time: payload.start_time,
      end_time: payload.end_time,
      teacher_id: payload.teacher_id,
      room: payload.room || "Room 101",
      student_ids: studentIds
    });

    if (conflict.hasConflict) {
      throw new Error(conflict.error);
    }

    const timeSlot = `${payload.start_time} - ${payload.end_time}`;
    const scheduleId = payload.id || `sch-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
    const nowIso = new Date().toISOString();

    let locName = payload.location || "Main Academic Center";
    let locAddr = payload.location_address || "";
    let locId = payload.location_id;

    if (locId) {
      const loc = await getLocationById(locId);
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

    const progType = (payload.program_type || payload.program || "TUTORING").toUpperCase();

    const newSlot: ScheduleSlot = {
      id: scheduleId,
      course_id: payload.course_id,
      course_name: payload.course_name,
      teacher_id: payload.teacher_id || "",
      teacher_name: payload.teacher_name || "",
      day_of_week: payload.day_of_week,
      start_time: payload.start_time,
      end_time: payload.end_time,
      time_slot: timeSlot,
      room: payload.room || "Room 101",
      location: locName,
      location_id: locId,
      location_address: locAddr,
      max_capacity: payload.max_capacity || 15,
      is_active: true,
      open_for_teachers: payload.open_for_teachers === true,
      program: progType,
      program_type: progType,
      created_at: nowIso,
      updated_at: nowIso
    };

    // Insert into Supabase schedules
    const insertRow: any = {
      id: newSlot.id,
      course_id: newSlot.course_id,
      course_name: newSlot.course_name,
      teacher_id: newSlot.teacher_id ? newSlot.teacher_id : null,
      teacher_name: newSlot.teacher_name ? newSlot.teacher_name : null,
      day_of_week: newSlot.day_of_week,
      start_time: newSlot.start_time,
      end_time: newSlot.end_time,
      time_slot: newSlot.time_slot,
      room: newSlot.room,
      location: newSlot.location,
      location_id: newSlot.location_id || null,
      location_address: newSlot.location_address || null,
      max_capacity: newSlot.max_capacity,
      is_active: newSlot.is_active,
      open_for_teachers: newSlot.open_for_teachers,
      program: newSlot.program || null,
      program_type: newSlot.program_type || null,
      created_at: nowIso,
      updated_at: nowIso
    };

    let { error: insErr } = await supabaseAdmin.from("schedules").insert([insertRow]);
    if (insErr && (insErr.message.includes("location_id") || insErr.message.includes("location_address") || insErr.message.includes("program_type"))) {
      delete insertRow.location_id;
      delete insertRow.location_address;
      delete insertRow.program_type;
      const retry = await supabaseAdmin.from("schedules").insert([insertRow]);
      insErr = retry.error;
    }

    if (insErr) {
      console.warn("Supabase schedules insert note, persisting in inMemorySchedules fallback:", insErr.message);
    }

    // Insert mapped students into schedule_students
    const mappedStudents: ScheduleStudent[] = [];
    if (payload.students && payload.students.length > 0) {
      const studentRows = payload.students.map((st, idx) => ({
        id: `st-map-${scheduleId}-${idx}`,
        schedule_id: scheduleId,
        student_id: st.student_id,
        student_name: st.student_name,
        student_code: st.student_code || null,
        created_at: nowIso
      }));

      try {
        const { data: insertedStudents, error: stErr } = await supabaseAdmin
          .from("schedule_students")
          .insert(studentRows)
          .select("*");

        if (!stErr && insertedStudents) {
          insertedStudents.forEach((sm: any) => {
            mappedStudents.push({
              id: sm.id,
              schedule_id: sm.schedule_id,
              student_id: sm.student_id,
              student_name: sm.student_name,
              student_code: sm.student_code,
              created_at: sm.created_at
            });
          });
        }
      } catch (err: any) {
        console.warn("Supabase schedule_students insert note:", err?.message);
      }

      if (mappedStudents.length === 0) {
        studentRows.forEach(sr => mappedStudents.push({ ...sr, student_code: sr.student_code || undefined }));
      }
    }
    newSlot.students = mappedStudents;
    inMemorySchedules.set(scheduleId, newSlot);

    // Log to student history
    for (const st of payload.students || []) {
      void this.appendHistoryItem({
        student_id: st.student_id,
        student_name: st.student_name,
        event_type: "SCHEDULE_ASSIGNMENT",
        title: `Enrolled in Weekly Schedule: ${payload.course_name}`,
        description: `Class scheduled on ${payload.day_of_week}s (${timeSlot}) at ${payload.room || "Room 101"}${payload.teacher_name ? ` with faculty ${payload.teacher_name}` : ""}.`,
        metadata: {
          schedule_id: scheduleId,
          course_name: payload.course_name,
          day_of_week: payload.day_of_week,
          time_slot: timeSlot,
          room: payload.room,
          teacher_name: payload.teacher_name
        },
        actor: "Academic Registrar"
      });
    }

    return newSlot;
  }

  /**
   * Create multiple schedule slots for multiple days
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

    const createdSlots: ScheduleSlot[] = [];
    const errors: string[] = [];

    for (const day of days) {
      try {
        const slot = await this.createSchedule({
          ...payload,
          day_of_week: day
        });
        createdSlots.push(slot);
      } catch (err: any) {
        errors.push(`${day}: ${err.message}`);
      }
    }

    if (createdSlots.length === 0 && errors.length > 0) {
      throw new Error(errors.join(" | "));
    }

    return createdSlots;
  }

  /**
   * Update an existing schedule slot in Supabase
   */
  static async updateSchedule(
    id: string,
    payload: Partial<ScheduleSlot> & { students?: Array<{ student_id: string; student_name: string; student_code?: string }> }
  ): Promise<ScheduleSlot> {
    const existing = (await this.listSchedules()).find(s => s.id === id);
    if (!existing) {
      throw new Error(`Schedule slot with ID '${id}' not found.`);
    }

    const updatedDay = payload.day_of_week || existing.day_of_week;
    const updatedStart = payload.start_time || existing.start_time;
    const updatedEnd = payload.end_time || existing.end_time;

    const duration = getSlotDurationMinutes(updatedStart, updatedEnd);
    if (duration !== 60) {
      throw new Error(`Invalid class duration: slot must be exactly 60 minutes (1 hour). Received ${duration} minutes (${updatedStart} to ${updatedEnd}).`);
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

    const updateFields: any = {
      updated_at: nowIso,
      time_slot: timeSlot
    };

    if (payload.course_id !== undefined) updateFields.course_id = payload.course_id;
    if (payload.course_name !== undefined) updateFields.course_name = payload.course_name;
    if (payload.day_of_week !== undefined) updateFields.day_of_week = payload.day_of_week;
    if (payload.start_time !== undefined) updateFields.start_time = payload.start_time;
    if (payload.end_time !== undefined) updateFields.end_time = payload.end_time;
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

    // Admin claims logic:
    //  - assigning a teacher closes the slot and clears claims
    //  - opening for teachers clears teacher and clears claims
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
      throw new Error(`Failed to update schedule in Supabase: ${updErr.message}`);
    }

    // Update mapped students if provided
    if (payload.students) {
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
    }

    const refreshed = (await this.listSchedules()).find(s => s.id === id);
    return refreshed || { ...existing, ...payload, ...updateFields };
  }

  /**
   * Delete a schedule slot in Supabase
   */
  static async deleteSchedule(id: string): Promise<boolean> {
    inMemorySchedules.delete(id);
    try {
      await supabaseAdmin.from("teacher_slot_claims").delete().eq("slot_id", id);
      await supabaseAdmin.from("schedule_students").delete().eq("schedule_id", id);
      await supabaseAdmin.from("schedules").delete().eq("id", id);
    } catch (e: any) {
      console.warn("Supabase schedule delete notice:", e?.message);
    }
    return true;
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
   * Assign / enroll a student directly into a specific schedule slot
   */
  static async assignStudentToSlot(payload: {
    schedule_id: string;
    student_id: string;
    student_name: string;
    student_code?: string;
  }): Promise<ScheduleSlot> {
    const all = await this.listSchedules();
    const slot = all.find(s => s.id === payload.schedule_id);
    if (!slot) {
      throw new Error(`Schedule slot '${payload.schedule_id}' not found.`);
    }

    const { error } = await supabaseAdmin.from("schedule_students").upsert(
      {
        schedule_id: slot.id,
        student_id: payload.student_id,
        student_name: payload.student_name,
        student_code: payload.student_code || null,
        created_at: new Date().toISOString()
      },
      { onConflict: "schedule_id,student_id" }
    );

    if (error) {
      console.warn("Supabase schedule_student upsert notice:", error.message);
    }

    // Append to Student History
    void this.appendHistoryItem({
      student_id: payload.student_id,
      student_name: payload.student_name,
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

    const refreshed = (await this.listSchedules()).find(s => s.id === payload.schedule_id);
    return refreshed || slot;
  }

  /**
   * Unassign / remove a student from a specific schedule slot
   */
  static async unassignStudentFromSlot(payload: {
    schedule_id: string;
    student_id: string;
    student_code?: string;
  }): Promise<ScheduleSlot | null> {
    await supabaseAdmin
      .from("schedule_students")
      .delete()
      .eq("schedule_id", payload.schedule_id)
      .eq("student_id", payload.student_id);

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
    return all.filter(s =>
      s.is_active !== false &&
      s.students && s.students.some(st => st.student_id === studentId || st.student_id === String(studentId))
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
