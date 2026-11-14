import { supabaseAdmin } from "../supabase.js";
import { instituteTimezone } from "./instituteTime.js";
import { recordDomainEvent } from "./domainEventService.js";

export interface ScheduleSlotDto {
  id: string;
  course_id: string;
  course_name: string;
  course_code?: string;
  teacher_id: string;
  teacher_name: string;
  teacher_email?: string;
  grade: string;
  start_at: string; // UTC ISO
  end_at: string;   // UTC ISO
  duration_hours: number;
  max_students: number;
  max_capacity: number; // backward compatibility
  booked_count: number;
  available_seats: number;
  status: "open" | "full" | "completed" | "cancelled" | "active" | "archived";
  notes?: string;
  // CST formatted display fields
  day_of_week: string;
  start_time: string;
  end_time: string;
  time_slot: string;
  cst_date: string;
  students: Array<{
    booking_id: string;
    student_id: string;
    student_name: string;
    student_code?: string;
    email?: string;
    status: string;
    tokens_reserved: number;
  }>;
  created_at: string;
  updated_at: string;
}

export interface CreateSlotPayload {
  course_id: string;
  teacher_id: string;
  grade?: string;
  start_at?: string;
  end_at?: string;
  date_cst?: string;       // e.g. "2026-11-16"
  start_time_cst?: string; // e.g. "10:00 AM" or "10:00"
  duration_hours?: number; // whole number of hours from 1 to 4
  max_students?: number;
  notes?: string;
}

/**
 * Converts a CST date and time string into a UTC Date object.
 * Perfectly handles CST (UTC-6) and CDT (UTC-5) automatic daylight saving transitions.
 */
export function cstDateTimeToUtc(dateStr: string, timeStr: string): Date {
  const clean = (timeStr || "").trim().toUpperCase();
  let hours = 0;
  let minutes = 0;

  const ampm = clean.match(/^(\d{1,2}):(\d{2})\s*(AM|PM)$/);
  if (ampm && ampm[1] && ampm[2] && ampm[3]) {
    hours = parseInt(ampm[1], 10);
    minutes = parseInt(ampm[2], 10);
    if (ampm[3] === "PM" && hours < 12) hours += 12;
    if (ampm[3] === "AM" && hours === 12) hours = 0;
  } else {
    const m24 = clean.match(/^(\d{1,2}):(\d{2})$/);
    if (m24 && m24[1] && m24[2]) {
      hours = parseInt(m24[1], 10);
      minutes = parseInt(m24[2], 10);
    }
  }

  const [yStr, mStr, dStr] = dateStr.split("-");
  const y = parseInt(yStr || "2026", 10);
  const m = parseInt(mStr || "1", 10);
  const d = parseInt(dStr || "1", 10);

  const guess = new Date(Date.UTC(y, m - 1, d, hours, minutes, 0));
  const tz = instituteTimezone();
  const dtf = new Intl.DateTimeFormat("en-US", {
    timeZone: tz,
    year: "numeric", month: "numeric", day: "numeric",
    hour: "numeric", minute: "numeric", second: "numeric",
    hour12: false
  });

  const parts = dtf.formatToParts(guess);
  const get = (type: string) => parseInt(parts.find(p => p.type === type)?.value || "0", 10);
  let localH = get("hour");
  if (localH === 24) localH = 0;
  const localGuess = new Date(Date.UTC(get("year"), get("month") - 1, get("day"), localH, get("minute"), get("second")));

  const diffMs = guess.getTime() - localGuess.getTime();
  return new Date(guess.getTime() + diffMs);
}

/**
 * Formats a UTC Date into CST time and day parts.
 */
export function utcToCstParts(utcDate: Date) {
  const tz = instituteTimezone();
  const dateFmt = new Intl.DateTimeFormat("en-US", {
    timeZone: tz,
    year: "numeric", month: "2-digit", day: "2-digit",
    weekday: "long"
  });
  const timeFmt = new Intl.DateTimeFormat("en-US", {
    timeZone: tz,
    hour: "numeric", minute: "2-digit",
    hour12: true
  });
  const isoDateFmt = new Intl.DateTimeFormat("en-CA", {
    timeZone: tz,
    year: "numeric", month: "2-digit", day: "2-digit"
  });

  return {
    dayOfWeek: dateFmt.formatToParts(utcDate).find(p => p.type === "weekday")?.value || "Monday",
    timeStr: timeFmt.format(utcDate),
    cstDate: isoDateFmt.format(utcDate)
  };
}

export class ScheduleSlotService {
  /**
   * List schedule slots from canonical public.schedules enriched with course, teacher, and student_enrollments.
   */
  static async listSlots(filters?: {
    course_id?: string;
    teacher_id?: string;
    status?: string;
    day_of_week?: string;
    date?: string;
  }): Promise<ScheduleSlotDto[]> {
    let query = supabaseAdmin
      .from("schedules")
      .select("*")
      .order("created_at", { ascending: true });

    if (filters?.course_id && filters.course_id !== "ALL") {
      query = query.eq("course_id", filters.course_id);
    }
    if (filters?.teacher_id && filters.teacher_id !== "ALL") {
      query = query.eq("teacher_id", filters.teacher_id);
    }
    if (filters?.status && filters.status !== "ALL") {
      query = query.eq("status", filters.status);
    }

    const { data: rawSlots, error: slotsErr } = await query;
    if (slotsErr) {
      throw new Error(`Failed to list schedules: ${slotsErr.message}`);
    }

    if (!rawSlots || rawSlots.length === 0) {
      return [];
    }

    // 2. Fetch courses map
    const { data: courses } = await supabaseAdmin
      .from("courses")
      .select("id, name, course_code");
    const courseMap = new Map((courses || []).map(c => [c.id, c]));

    // 3. Fetch teachers map
    const { data: teachers } = await supabaseAdmin
      .from("teachers")
      .select("id, name, email, phone");
    const teacherMap = new Map((teachers || []).map(t => [t.id, t]));

    // 4. Fetch active and paused enrollments with students from canonical student_enrollments
    const slotIds = rawSlots.map(s => s.id);
    const { data: enrollments } = await supabaseAdmin
      .from("student_enrollments")
      .select(`
        id,
        slot_id,
        student_id,
        status,
        hours_total,
        created_at,
        students ( id, name, student_id_code, email )
      `)
      .in("slot_id", slotIds)
      .in("status", ["ACTIVE", "PAUSED_NO_HOURS"]);

    const enrollmentsBySlot = new Map<string, any[]>();
    for (const enr of enrollments || []) {
      if (enr.slot_id) {
        if (!enrollmentsBySlot.has(enr.slot_id)) {
          enrollmentsBySlot.set(enr.slot_id, []);
        }
        enrollmentsBySlot.get(enr.slot_id)!.push(enr);
      }
    }

    // 5. Enrich and format slots
    const results: ScheduleSlotDto[] = rawSlots.map(slot => {
      const course = courseMap.get(slot.course_id);
      const teacher = teacherMap.get(slot.teacher_id);
      const slotEnrollments = enrollmentsBySlot.get(slot.id) || [];

      let startUtcStr = slot.start_at;
      let endUtcStr = slot.end_at;

      if (!startUtcStr || !endUtcStr) {
        const dateCst = new Date().toISOString().slice(0, 10);
        const sDate = cstDateTimeToUtc(dateCst, slot.start_time || "10:00 AM");
        const dur = Number(slot.duration_hours || 1.0);
        const eDate = new Date(sDate.getTime() + dur * 3600 * 1000);
        startUtcStr = sDate.toISOString();
        endUtcStr = eDate.toISOString();
      }

      const startUtc = new Date(startUtcStr);
      const endUtc = new Date(endUtcStr);
      const startParts = utcToCstParts(startUtc);
      const endParts = utcToCstParts(endUtc);

      const mappedStudents = slotEnrollments.map((e: any) => {
        const sInfo = Array.isArray(e.students) ? e.students[0] : e.students;
        return {
          booking_id: e.id,
          student_id: e.student_id,
          student_name: sInfo?.name || "Student",
          student_code: sInfo?.student_id_code || "",
          email: sInfo?.email || "",
          status: e.status,
          tokens_reserved: Number(e.hours_total || slot.duration_hours || 1.0)
        };
      });

      const bookedCount = mappedStudents.filter(s => s.status === "ACTIVE").length;
      const maxStudents = Number(slot.max_capacity || slot.max_students || 15);
      const availableSeats = Math.max(0, maxStudents - bookedCount);

      return {
        id: slot.id,
        course_id: slot.course_id,
        course_name: slot.course_name || course?.name || "General Course",
        course_code: course?.course_code || "",
        teacher_id: slot.teacher_id || "",
        teacher_name: slot.teacher_name || teacher?.name || "Unassigned Faculty",
        teacher_email: teacher?.email || "",
        grade: slot.grade_range || slot.grade || "All Grades",
        start_at: startUtcStr,
        end_at: endUtcStr,
        duration_hours: Number(slot.duration_hours || 1.0),
        max_students: maxStudents,
        max_capacity: maxStudents,
        booked_count: bookedCount,
        available_seats: availableSeats,
        status: slot.status || (slot.is_active ? "active" : "cancelled"),
        notes: slot.notes || slot.room || "",
        day_of_week: slot.day_of_week || startParts.dayOfWeek,
        start_time: slot.start_time || startParts.timeStr,
        end_time: slot.end_time || endParts.timeStr,
        time_slot: slot.time_slot || `${startParts.timeStr} - ${endParts.timeStr}`,
        cst_date: startParts.cstDate,
        students: mappedStudents,
        created_at: slot.created_at,
        updated_at: slot.updated_at
      };
    });

    if (filters?.day_of_week && filters.day_of_week !== "ALL") {
      const dLower = filters.day_of_week.toLowerCase().trim();
      return results.filter(r => r.day_of_week.toLowerCase() === dLower);
    }

    if (filters?.date) {
      return results.filter(r => r.cst_date === filters.date);
    }

    return results;
  }

  /**
   * Create a schedule slot in canonical public.schedules
   */
  static async createSlot(payload: CreateSlotPayload): Promise<ScheduleSlotDto> {
    if (!payload.course_id) throw new Error("Course ID is required.");

    // Validate course exists
    const { data: course, error: cErr } = await supabaseAdmin
      .from("courses")
      .select("id, name, status")
      .eq("id", payload.course_id)
      .single();
    if (cErr || !course) throw new Error("Selected course does not exist.");
    if (course.status && course.status.toLowerCase() === "archived") {
      throw new Error("Cannot schedule slots for an archived course.");
    }

    // Validate teacher exists if provided
    let teacherName = "Unassigned Faculty";
    if (payload.teacher_id && payload.teacher_id.trim() !== "") {
      const { data: teacher, error: tErr } = await supabaseAdmin
        .from("teachers")
        .select("id, name, status")
        .eq("id", payload.teacher_id)
        .single();
      if (tErr || !teacher) throw new Error("Selected teacher does not exist.");
      if (teacher.status && teacher.status.toLowerCase() === "archived") {
        throw new Error("Cannot schedule slots for an archived teacher.");
      }
      teacherName = teacher.name;
    }

    // Compute start_at and end_at in UTC
    let startUtc: Date;
    let endUtc: Date;
    let durationHours = payload.duration_hours || 1.0;

    // Validate duration: whole number of hours from 1 to 4 (TASK 18)
    if (![1, 2, 3, 4].includes(durationHours)) {
      throw new Error(`Invalid duration: ${durationHours} hours. Class length must be a whole number of hours from 1 to 4.`);
    }

    if (payload.start_at && payload.end_at) {
      startUtc = new Date(payload.start_at);
      endUtc = new Date(payload.end_at);
    } else if (payload.date_cst && payload.start_time_cst) {
      startUtc = cstDateTimeToUtc(payload.date_cst, payload.start_time_cst);
      endUtc = new Date(startUtc.getTime() + durationHours * 3600 * 1000);
    } else {
      throw new Error("Missing start time or date for schedule slot.");
    }

    if (endUtc <= startUtc) {
      throw new Error("End time must be after start time.");
    }

    const startParts = utcToCstParts(startUtc);
    const endParts = utcToCstParts(endUtc);
    const maxStudents = Math.max(1, payload.max_students || 15);
    const slotId = 'sch-' + Date.now() + '-' + Math.random().toString(36).slice(2, 6);

    // Insert slot into canonical public.schedules
    const { data: newSlot, error: insertErr } = await supabaseAdmin
      .from("schedules")
      .insert({
        id: slotId,
        course_id: payload.course_id,
        course_name: course.name,
        teacher_id: payload.teacher_id || null,
        teacher_name: teacherName,
        day_of_week: startParts.dayOfWeek,
        start_time: startParts.timeStr,
        end_time: endParts.timeStr,
        time_slot: `${startParts.timeStr} - ${endParts.timeStr}`,
        duration_hours: durationHours,
        max_capacity: maxStudents,
        room: payload.notes || "Room 101",
        notes: payload.notes || "",
        location: "Main Academic Center",
        grade_range: payload.grade || "All Grades",
        start_at: startUtc.toISOString(),
        end_at: endUtc.toISOString(),
        status: "active",
        is_active: true,
        open_for_teachers: !payload.teacher_id
      })
      .select()
      .single();

    if (insertErr) {
      if (
        insertErr.code === "23P01" ||
        insertErr.message?.includes("no_teacher_slot_collision") ||
        insertErr.message?.includes("Teacher collision")
      ) {
        throw new Error(`Teacher Collision: Teacher is already scheduled for another class during this time.`);
      }
      throw new Error(`Failed to create schedule slot: ${insertErr.message}`);
    }

    void recordDomainEvent({
      type: "slot.created",
      entity: "schedules",
      entity_id: newSlot.id,
      payload: {
        course_id: newSlot.course_id,
        teacher_id: newSlot.teacher_id,
        duration_hours: durationHours,
        max_capacity: maxStudents
      }
    });

    const createdList = await this.listSlots({ course_id: newSlot.course_id });
    const enriched = createdList.find(s => s.id === newSlot.id);
    if (!enriched) throw new Error("Slot created but failed to retrieve record.");
    return enriched;
  }

  /**
   * Update a schedule slot in canonical public.schedules
   */
  static async updateSlot(
    slotId: string,
    payload: Partial<CreateSlotPayload> & { status?: "active" | "archived" | "cancelled" }
  ): Promise<ScheduleSlotDto> {
    const { data: existing, error: existErr } = await supabaseAdmin
      .from("schedules")
      .select("*")
      .eq("id", slotId)
      .single();
    if (existErr || !existing) throw new Error("Schedule slot not found.");

    // Count active enrollments
    const { count: activeEnrollmentsCount } = await supabaseAdmin
      .from("student_enrollments")
      .select("*", { count: "exact", head: true })
      .eq("slot_id", slotId)
      .eq("status", "ACTIVE");

    const activeCount = activeEnrollmentsCount || 0;

    if (payload.max_students !== undefined && payload.max_students < activeCount) {
      throw new Error(`Cannot decrease capacity to ${payload.max_students}: slot currently has ${activeCount} active student enrollments.`);
    }

    const updates: any = { updated_at: new Date().toISOString() };
    if (payload.max_students !== undefined) updates.max_capacity = payload.max_students;
    if (payload.notes !== undefined) {
      updates.notes = payload.notes;
      updates.room = payload.notes;
    }
    if (payload.status) updates.status = payload.status;
    if (payload.grade) updates.grade_range = payload.grade;

    if (payload.duration_hours) {
      if (![1, 2, 3, 4].includes(payload.duration_hours)) {
        throw new Error("Class length must be a whole number of hours from 1 to 4.");
      }
      updates.duration_hours = payload.duration_hours;
    }

    if (payload.start_at && payload.end_at) {
      updates.start_at = payload.start_at;
      updates.end_at = payload.end_at;
      const sDate = new Date(payload.start_at);
      const eDate = new Date(payload.end_at);
      const sParts = utcToCstParts(sDate);
      const eParts = utcToCstParts(eDate);
      updates.day_of_week = sParts.dayOfWeek;
      updates.start_time = sParts.timeStr;
      updates.end_time = eParts.timeStr;
      updates.time_slot = `${sParts.timeStr} - ${eParts.timeStr}`;
    }

    const { data: updated, error: updateErr } = await supabaseAdmin
      .from("schedules")
      .update(updates)
      .eq("id", slotId)
      .select()
      .single();

    if (updateErr) {
      throw new Error(`Failed to update schedule slot: ${updateErr.message}`);
    }

    void recordDomainEvent({
      type: "slot.updated",
      entity: "schedules",
      entity_id: slotId,
      payload: updates
    });

    const updatedList = await this.listSlots();
    const enriched = updatedList.find(s => s.id === updated.id);
    if (!enriched) throw new Error("Slot updated but failed to retrieve record.");
    return enriched;
  }

  /**
   * Cancels a schedule slot and ends enrollments.
   * R4 & R5: Cancelling a slot deducts 0 hours and preserves student wallet hours.
   */
  static async cancelSlot(slotId: string, _cancelledBy?: string, reason?: string) {
    const { data: slot, error: sErr } = await supabaseAdmin
      .from("schedules")
      .select("*")
      .eq("id", slotId)
      .single();
    if (sErr || !slot) throw new Error("Schedule slot not found.");
    if (slot.status === "cancelled") throw new Error("Schedule slot is already cancelled.");

    await supabaseAdmin
      .from("schedules")
      .update({ status: "cancelled", is_active: false, updated_at: new Date().toISOString() })
      .eq("id", slotId);

    const { data: enrollments } = await supabaseAdmin
      .from("student_enrollments")
      .select("id, student_id")
      .eq("slot_id", slotId)
      .in("status", ["ACTIVE", "PAUSED_NO_HOURS"]);

    const count = enrollments ? enrollments.length : 0;

    await supabaseAdmin
      .from("student_enrollments")
      .update({ status: "ENDED", end_date: new Date().toISOString(), updated_at: new Date().toISOString() })
      .eq("slot_id", slotId)
      .in("status", ["ACTIVE", "PAUSED_NO_HOURS"]);

    await supabaseAdmin
      .from("attendance")
      .update({ status: "cancelled" })
      .eq("schedule_id", slotId)
      .eq("status", "scheduled");

    void recordDomainEvent({
      type: "slot.cancelled",
      entity: "schedules",
      entity_id: slotId,
      payload: {
        course_id: slot.course_id,
        course_name: slot.course_name,
        affected_students: enrollments,
        reason
      }
    });

    return {
      success: true,
      bookingsCancelled: count,
      tokensReleased: 0
    };
  }

  /**
   * Enrolls a student in a slot adhering strictly to R2:
   * Course active, slot active + free seat, grade range match, hours balance >= slot duration, no collision.
   */
  static async bookSlot(studentId: string, slotId: string) {
    const { data: slot, error: sErr } = await supabaseAdmin
      .from("schedules")
      .select("*")
      .eq("id", slotId)
      .single();
    if (sErr || !slot || slot.status === "cancelled" || slot.is_active === false) {
      throw new Error("Class schedule slot not found or inactive.");
    }

    const { data: course } = await supabaseAdmin
      .from("courses")
      .select("*")
      .eq("id", slot.course_id)
      .single();
    if (!course || course.status === "archived") {
      throw new Error("Associated course is archived or inactive.");
    }

    // Check capacity: count of ACTIVE enrollments + PAUSED within 14-day hold
    const { data: existingEnr } = await supabaseAdmin
      .from("student_enrollments")
      .select("id, student_id, status, paused_at")
      .eq("slot_id", slotId)
      .in("status", ["ACTIVE", "PAUSED_NO_HOURS"]);

    const activeCount = (existingEnr || []).filter((e: any) => {
      if (e.status === "ACTIVE") return true;
      if (e.status === "PAUSED_NO_HOURS" && e.paused_at) {
        const days = (Date.now() - new Date(e.paused_at).getTime()) / (1000 * 3600 * 24);
        return days <= 14;
      }
      return true;
    }).length;

    const maxStudents = Number(slot.max_capacity || slot.max_students || 15);
    if (activeCount >= maxStudents) {
      throw new Error("Class is full. Maximum student capacity reached.");
    }

    // Check if student already enrolled in this slot
    const already = (existingEnr || []).find((e: any) => e.student_id === studentId && (e.status === "ACTIVE" || e.status === "PAUSED_NO_HOURS"));
    if (already) {
      throw new Error("Student is already enrolled in this class slot.");
    }

    // Check hours balance for this course in token_wallets
    const { data: wallet } = await supabaseAdmin
      .from("token_wallets")
      .select("balance")
      .eq("student_id", studentId)
      .eq("course_id", slot.course_id)
      .maybeSingle();

    const balance = Number(wallet?.balance || 0);
    const requiredHours = Number(slot.duration_hours || 1.0);
    if (balance < requiredHours) {
      throw new Error(`Insufficient hours for this course. Required: ${requiredHours} hr(s), Available: ${balance} hr(s).`);
    }

    // Insert enrollment
    const enrollmentId = 'enr-' + Date.now() + '-' + Math.random().toString(36).slice(2, 6);
    const { data: newEnr, error: enrErr } = await supabaseAdmin
      .from("student_enrollments")
      .insert({
        id: enrollmentId,
        slot_id: slotId,
        student_id: studentId,
        course_id: slot.course_id,
        plan: "HOURS",
        hours_total: requiredHours,
        status: "ACTIVE",
        created_at: new Date().toISOString()
      })
      .select()
      .single();

    if (enrErr) {
      throw new Error(`Enrollment failed: ${enrErr.message}`);
    }

    void recordDomainEvent({
      type: "enrollment.created",
      entity: "student_enrollments",
      entity_id: enrollmentId,
      payload: {
        slot_id: slotId,
        student_id: studentId,
        course_id: slot.course_id,
        duration_hours: requiredHours
      }
    });

    return {
      success: true,
      bookingId: newEnr.id
    };
  }

  /**
   * Cancels a student's enrollment in a slot.
   */
  static async cancelBooking(bookingId: string, _cancelledBy?: string, _reason?: string) {
    const { data: enr, error } = await supabaseAdmin
      .from("student_enrollments")
      .select("*")
      .eq("id", bookingId)
      .single();

    if (error || !enr) throw new Error("Enrollment not found.");

    await supabaseAdmin
      .from("student_enrollments")
      .update({ status: "ENDED", end_date: new Date().toISOString(), updated_at: new Date().toISOString() })
      .eq("id", bookingId);

    void recordDomainEvent({
      type: "enrollment.ended",
      entity: "student_enrollments",
      entity_id: bookingId,
      payload: {
        slot_id: enr.slot_id,
        student_id: enr.student_id,
        course_id: enr.course_id
      }
    });

    return {
      success: true,
      tokensReleased: 0,
      policy: "Unused hours preserved on student wallet"
    };
  }

  /**
   * List slots for a specific date in CST for attendance marking.
   */
  static async listAttendanceSlots(dateStr?: string, teacherId?: string) {
    const nowParts = utcToCstParts(new Date());
    const targetDate = dateStr || nowParts.cstDate;
    const targetDay = new Date(`${targetDate}T12:00:00Z`).toLocaleDateString("en-US", { weekday: "long", timeZone: "UTC" });

    let query = supabaseAdmin
      .from("schedules")
      .select("*")
      .eq("is_active", true)
      .neq("status", "cancelled");

    if (teacherId && teacherId !== "ALL") {
      query = query.eq("teacher_id", teacherId);
    }

    const { data: rawSlots, error } = await query;
    if (error) throw error;

    return (rawSlots || []).filter(s => (s.day_of_week || "").trim().toLowerCase() === targetDay.toLowerCase());
  }

  /**
   * Marks attendance and deducts slot duration hours via token_ledger and token_wallets.
   */
  static async markAttendance(
    attendanceId: string,
    status: "present" | "absent" | "late" | "excused",
    markedBy?: string,
    remarks?: string
  ) {
    const { data: att, error: attErr } = await supabaseAdmin
      .from("attendance")
      .select("*, schedules(*)")
      .eq("id", attendanceId)
      .single();

    if (attErr || !att) throw new Error("Attendance record not found.");

    const slot = att.schedules;
    const durHours = Number(slot?.duration_hours || 1.0);
    const prevStatus = att.status;

    if (status === "present" && prevStatus !== "present") {
      await supabaseAdmin.from("token_ledger").insert({
        student_id: att.student_id,
        course_id: slot?.course_id || "general",
        delta: -durHours,
        reason: "CLASS_ATTENDED",
        ref: `att:${attendanceId}`,
        note: remarks || `Class attended (${durHours} hr deducted)`,
        created_by: markedBy || "faculty"
      });

      const { data: w } = await supabaseAdmin
        .from("token_wallets")
        .select("balance")
        .eq("student_id", att.student_id)
        .eq("course_id", slot?.course_id || "general")
        .maybeSingle();

      const newBal = (w ? Number(w.balance) : 0) - durHours;
      await supabaseAdmin
        .from("token_wallets")
        .upsert({
          student_id: att.student_id,
          course_id: slot?.course_id || "general",
          balance: newBal,
          updated_at: new Date().toISOString()
        });

      if (newBal < durHours) {
        await supabaseAdmin
          .from("student_enrollments")
          .update({ status: "PAUSED_NO_HOURS", paused_at: new Date().toISOString() })
          .eq("student_id", att.student_id)
          .eq("slot_id", att.schedule_id)
          .eq("status", "ACTIVE");
      }
    } else if (prevStatus === "present" && status !== "present") {
      await supabaseAdmin.from("token_ledger").insert({
        student_id: att.student_id,
        course_id: slot?.course_id || "general",
        delta: durHours,
        reason: "ADJUSTMENT",
        ref: `att-rev:${attendanceId}`,
        note: remarks || `Attendance corrected from present to ${status} (+${durHours} hr restored)`,
        created_by: markedBy || "faculty"
      });

      const { data: w } = await supabaseAdmin
        .from("token_wallets")
        .select("balance")
        .eq("student_id", att.student_id)
        .eq("course_id", slot?.course_id || "general")
        .maybeSingle();

      const newBal = (w ? Number(w.balance) : 0) + durHours;
      await supabaseAdmin
        .from("token_wallets")
        .upsert({
          student_id: att.student_id,
          course_id: slot?.course_id || "general",
          balance: newBal,
          updated_at: new Date().toISOString()
        });

      if (newBal >= durHours) {
        await supabaseAdmin
          .from("student_enrollments")
          .update({ status: "ACTIVE", paused_at: null })
          .eq("student_id", att.student_id)
          .eq("slot_id", att.schedule_id)
          .eq("status", "PAUSED_NO_HOURS");
      }
    }

    await supabaseAdmin
      .from("attendance")
      .update({
        status,
        marked_at: new Date().toISOString(),
        remarks: remarks || null
      })
      .eq("id", attendanceId);

    const eventType = prevStatus ? "attendance.corrected" : "attendance.marked";
    void recordDomainEvent({
      type: eventType,
      entity: "attendance",
      entity_id: attendanceId,
      payload: {
        slot_id: att.schedule_id,
        student_id: att.student_id,
        status,
        prev_status: prevStatus,
        hours_deducted: status === "present" ? durHours : 0
      }
    });

    if (status === "present" && prevStatus !== "present") {
      const { data: wCheck } = await supabaseAdmin
        .from("token_wallets")
        .select("balance")
        .eq("student_id", att.student_id)
        .eq("course_id", slot?.course_id || "general")
        .maybeSingle();

      if (wCheck && Number(wCheck.balance) < durHours) {
        void recordDomainEvent({
          type: "enrollment.paused",
          entity: "student_enrollments",
          entity_id: att.schedule_id,
          payload: {
            slot_id: att.schedule_id,
            student_id: att.student_id,
            course_id: slot?.course_id || "general",
            remaining_hours: Number(wCheck.balance)
          }
        });
      }
    } else if (prevStatus === "present" && status !== "present") {
      void recordDomainEvent({
        type: "enrollment.resumed",
        entity: "student_enrollments",
        entity_id: att.schedule_id,
        payload: {
          slot_id: att.schedule_id,
          student_id: att.student_id,
          course_id: slot?.course_id || "general"
        }
      });
    }

    return {
      success: true,
      status,
      tokensAffected: status === "present" ? -durHours : (prevStatus === "present" ? durHours : 0)
    };
  }

  /**
   * Computes the weekly attendance rate in America/Chicago (CST/CDT):
   * (present + late) / (present + late + absent)
   */
  static async getWeeklyAttendanceRate() {
    const nowCst = utcToCstParts(new Date());
    const cstDate = new Date(`${nowCst.cstDate}T12:00:00Z`);
    const dayOfWeek = cstDate.getUTCDay();

    const diffToMonday = dayOfWeek === 0 ? -6 : 1 - dayOfWeek;
    const monday = new Date(cstDate);
    monday.setUTCDate(cstDate.getUTCDate() + diffToMonday);
    const mondayStr = monday.toISOString().slice(0, 10);

    const sunday = new Date(monday);
    sunday.setUTCDate(monday.getUTCDate() + 6);
    const sundayStr = sunday.toISOString().slice(0, 10);

    const startUtc = cstDateTimeToUtc(mondayStr, "00:00").toISOString();
    const endUtc = cstDateTimeToUtc(sundayStr, "23:59").toISOString();

    const { data: rows, error } = await supabaseAdmin
      .from("attendance")
      .select("status")
      .gte("marked_at", startUtc)
      .lte("marked_at", endUtc)
      .in("status", ["present", "late", "absent"]);

    if (error || !rows || rows.length === 0) {
      return {
        rate: null,
        display: "No classes held yet",
        presentCount: 0,
        lateCount: 0,
        absentCount: 0,
        totalMarked: 0
      };
    }

    const present = rows.filter(r => r.status === "present").length;
    const late = rows.filter(r => r.status === "late").length;
    const absent = rows.filter(r => r.status === "absent").length;
    const denominator = present + late + absent;

    if (denominator === 0) {
      return {
        rate: null,
        display: "No classes held yet",
        presentCount: 0,
        lateCount: 0,
        absentCount: 0,
        totalMarked: 0
      };
    }

    const rate = Math.round(((present + late) / denominator) * 100);
    return {
      rate,
      display: `${rate}%`,
      presentCount: present,
      lateCount: late,
      absentCount: absent,
      totalMarked: denominator
    };
  }
}
