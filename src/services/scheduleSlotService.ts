import { supabaseAdmin } from "../supabase.js";
import { instituteTimezone } from "./instituteTime.js";

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
  status: "open" | "full" | "completed" | "cancelled";
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
  duration_hours?: number; // strictly 0.5 increments e.g. 1.0, 1.5, 2.0
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
   * List schedule slots from public.schedule_slots enriched with course, teacher, and booking details.
   */
  static async listSlots(filters?: {
    course_id?: string;
    teacher_id?: string;
    status?: string;
    day_of_week?: string;
    date?: string;
  }): Promise<ScheduleSlotDto[]> {
    // 1. Fetch slots
    let query = supabaseAdmin
      .from("schedule_slots")
      .select("*")
      .order("start_at", { ascending: true });

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
      throw new Error(`Failed to list schedule slots: ${slotsErr.message}`);
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

    // 4. Fetch active bookings with students
    const slotIds = rawSlots.map(s => s.id);
    const { data: bookings } = await supabaseAdmin
      .from("bookings")
      .select(`
        id,
        slot_id,
        student_id,
        status,
        tokens_reserved,
        created_at,
        students ( id, name, student_id_code, email )
      `)
      .in("slot_id", slotIds)
      .neq("status", "cancelled");

    const bookingsBySlot = new Map<string, any[]>();
    for (const b of bookings || []) {
      if (!bookingsBySlot.has(b.slot_id)) {
        bookingsBySlot.set(b.slot_id, []);
      }
      bookingsBySlot.get(b.slot_id)!.push(b);
    }

    // 5. Enrich and format slots
    const results: ScheduleSlotDto[] = rawSlots.map(slot => {
      const course = courseMap.get(slot.course_id);
      const teacher = teacherMap.get(slot.teacher_id);
      const slotBookings = bookingsBySlot.get(slot.id) || [];

      const startUtc = new Date(slot.start_at);
      const endUtc = new Date(slot.end_at);

      const startParts = utcToCstParts(startUtc);
      const endParts = utcToCstParts(endUtc);

      const mappedStudents = slotBookings.map(b => {
        const sInfo = Array.isArray(b.students) ? b.students[0] : b.students;
        return {
          booking_id: b.id,
          student_id: b.student_id,
          student_name: sInfo?.name || "Student",
          student_code: sInfo?.student_id_code || "",
          email: sInfo?.email || "",
          status: b.status,
          tokens_reserved: Number(b.tokens_reserved)
        };
      });

      const bookedCount = mappedStudents.length;
      const maxStudents = Number(slot.max_students || 15);
      const availableSeats = Math.max(0, maxStudents - bookedCount);

      return {
        id: slot.id,
        course_id: slot.course_id,
        course_name: course?.name || "General Course",
        course_code: course?.course_code || "",
        teacher_id: slot.teacher_id,
        teacher_name: teacher?.name || "Unassigned Faculty",
        teacher_email: teacher?.email || "",
        grade: slot.grade || "All Grades",
        start_at: slot.start_at,
        end_at: slot.end_at,
        duration_hours: Number(slot.duration_hours || 1.0),
        max_students: maxStudents,
        max_capacity: maxStudents,
        booked_count: bookedCount,
        available_seats: availableSeats,
        status: slot.status,
        notes: slot.notes || "",
        day_of_week: startParts.dayOfWeek,
        start_time: startParts.timeStr,
        end_time: endParts.timeStr,
        time_slot: `${startParts.timeStr} - ${endParts.timeStr}`,
        cst_date: startParts.cstDate,
        students: mappedStudents,
        created_at: slot.created_at,
        updated_at: slot.updated_at
      };
    });

    // Optional post-filters (day of week, date)
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
   * Create a schedule slot in public.schedule_slots
   */
  static async createSlot(payload: CreateSlotPayload): Promise<ScheduleSlotDto> {
    if (!payload.course_id) throw new Error("Course ID is required.");
    if (!payload.teacher_id) throw new Error("Teacher ID is required.");

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

    // Validate teacher exists
    const { data: teacher, error: tErr } = await supabaseAdmin
      .from("teachers")
      .select("id, name, status")
      .eq("id", payload.teacher_id)
      .single();
    if (tErr || !teacher) throw new Error("Selected teacher does not exist.");
    if (teacher.status && teacher.status.toLowerCase() === "archived") {
      throw new Error("Cannot schedule slots for an archived teacher.");
    }

    // Compute start_at and end_at in UTC
    let startUtc: Date;
    let endUtc: Date;
    let durationHours = payload.duration_hours || 1.0;

    // Validate duration: 0.5 increments between 0.5 and 4.0
    if (durationHours < 0.5 || durationHours > 4.0 || (durationHours * 2) % 1 !== 0) {
      throw new Error(`Invalid duration: ${durationHours} hours. Classes must be in 0.5 hour increments (0.5 to 4.0 hours).`);
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

    const maxStudents = Math.max(1, payload.max_students || 15);

    // Insert slot into Supabase
    const { data: newSlot, error: insertErr } = await supabaseAdmin
      .from("schedule_slots")
      .insert({
        course_id: payload.course_id,
        teacher_id: payload.teacher_id,
        grade: payload.grade || "Grade 10",
        start_at: startUtc.toISOString(),
        end_at: endUtc.toISOString(),
        duration_hours: durationHours,
        max_students: maxStudents,
        status: "open",
        notes: payload.notes || ""
      })
      .select()
      .single();

    if (insertErr) {
      // Check for PostgreSQL exclusion violation (code 23P01 or constraint no_teacher_slot_overlap)
      if (
        insertErr.code === "23P01" ||
        insertErr.message?.includes("no_teacher_slot_overlap") ||
        insertErr.message?.includes("conflicting key value")
      ) {
        throw new Error(`Teacher Collision: ${teacher.name} is already scheduled for another class during this time.`);
      }
      throw new Error(`Failed to create schedule slot: ${insertErr.message}`);
    }

    const createdList = await this.listSlots({ course_id: newSlot.course_id });
    const enriched = createdList.find(s => s.id === newSlot.id);
    if (!enriched) throw new Error("Slot created but failed to retrieve record.");
    return enriched;
  }

  /**
   * Update a schedule slot in public.schedule_slots
   */
  static async updateSlot(
    slotId: string,
    payload: Partial<CreateSlotPayload> & { status?: "open" | "full" | "completed" | "cancelled" }
  ): Promise<ScheduleSlotDto> {
    // 1. Fetch existing slot
    const { data: existing, error: existErr } = await supabaseAdmin
      .from("schedule_slots")
      .select("*")
      .eq("id", slotId)
      .single();
    if (existErr || !existing) throw new Error("Schedule slot not found.");

    // 2. Count active bookings
    const { count: activeBookingsCount } = await supabaseAdmin
      .from("bookings")
      .select("*", { count: "exact", head: true })
      .eq("slot_id", slotId)
      .neq("status", "cancelled");

    const activeCount = activeBookingsCount || 0;

    // Check if new max_students is below active bookings
    if (payload.max_students !== undefined && payload.max_students < activeCount) {
      throw new Error(`Cannot reduce class capacity to ${payload.max_students}. There are currently ${activeCount} active booked students.`);
    }

    const updates: any = { updated_at: new Date().toISOString() };
    if (payload.course_id) updates.course_id = payload.course_id;
    if (payload.teacher_id) updates.teacher_id = payload.teacher_id;
    if (payload.grade) updates.grade = payload.grade;
    if (payload.notes !== undefined) updates.notes = payload.notes;
    if (payload.max_students) updates.max_students = payload.max_students;
    if (payload.status) updates.status = payload.status;

    if (payload.date_cst && payload.start_time_cst) {
      const dur = payload.duration_hours || existing.duration_hours;
      const startUtc = cstDateTimeToUtc(payload.date_cst, payload.start_time_cst);
      const endUtc = new Date(startUtc.getTime() + dur * 3600 * 1000);
      updates.start_at = startUtc.toISOString();
      updates.end_at = endUtc.toISOString();
      updates.duration_hours = dur;
    } else if (payload.start_at && payload.end_at) {
      updates.start_at = new Date(payload.start_at).toISOString();
      updates.end_at = new Date(payload.end_at).toISOString();
      if (payload.duration_hours) updates.duration_hours = payload.duration_hours;
    }

    const { data: updated, error: updateErr } = await supabaseAdmin
      .from("schedule_slots")
      .update(updates)
      .eq("id", slotId)
      .select()
      .single();

    if (updateErr) {
      if (
        updateErr.code === "23P01" ||
        updateErr.message?.includes("no_teacher_slot_overlap") ||
        updateErr.message?.includes("conflicting key value")
      ) {
        throw new Error("Teacher Collision: Teacher is already scheduled for another class during this time.");
      }
      throw new Error(`Failed to update schedule slot: ${updateErr.message}`);
    }

    const updatedList = await this.listSlots();
    const enriched = updatedList.find(s => s.id === updated.id);
    if (!enriched) throw new Error("Slot updated but failed to retrieve record.");
    return enriched;
  }

  /**
   * Cancels a schedule slot and releases all reserved tokens back to booked students.
   */
  static async cancelSlot(slotId: string, cancelledBy?: string, reason?: string) {
    // Attempt via RPC first
    try {
      const { data: rpcData, error: rpcErr } = await supabaseAdmin.rpc("cancel_schedule_slot", {
        p_slot_id: slotId,
        p_cancelled_by: cancelledBy || null,
        p_reason: reason || null
      });

      if (!rpcErr && rpcData && rpcData[0]) {
        const row = rpcData[0];
        if (!row.success) throw new Error(row.error_message || "Failed to cancel slot.");
        return {
          success: true,
          bookingsCancelled: row.bookings_cancelled,
          tokensReleased: Number(row.total_tokens_released)
        };
      }
    } catch (rpcEx: any) {
      // Fallback if RPC not yet installed
      console.warn("cancel_schedule_slot RPC fallback:", rpcEx.message);
    }

    // Direct transaction fallback
    const { data: slot, error: sErr } = await supabaseAdmin
      .from("schedule_slots")
      .select("*")
      .eq("id", slotId)
      .single();
    if (sErr || !slot) throw new Error("Schedule slot not found.");
    if (slot.status === "cancelled") throw new Error("Schedule slot is already cancelled.");

    // Mark slot cancelled
    await supabaseAdmin
      .from("schedule_slots")
      .update({ status: "cancelled", updated_at: new Date().toISOString() })
      .eq("id", slotId);

    // Fetch active bookings
    const { data: bookings } = await supabaseAdmin
      .from("bookings")
      .select("*")
      .eq("slot_id", slotId)
      .eq("status", "booked");

    let count = 0;
    let releasedTokens = 0;

    for (const b of bookings || []) {
      const dur = Number(b.tokens_reserved || slot.duration_hours || 1.0);
      // Append release to token_ledger
      await supabaseAdmin.from("token_ledger").insert({
        student_id: b.student_id,
        course_id: slot.course_id,
        hours: dur,
        type: "release",
        ref_booking_id: b.id,
        note: reason || "Class slot cancelled by institute - hours restored",
        created_by: cancelledBy || "admin"
      });

      releasedTokens += dur;
      count++;
    }

    // Cancel bookings & attendance
    await supabaseAdmin
      .from("bookings")
      .update({ status: "cancelled", cancelled_at: new Date().toISOString() })
      .eq("slot_id", slotId)
      .eq("status", "booked");

    await supabaseAdmin
      .from("attendance")
      .update({ status: "cancelled" })
      .eq("slot_id", slotId)
      .eq("status", "scheduled");

    return {
      success: true,
      bookingsCancelled: count,
      tokensReleased: releasedTokens
    };
  }

  /**
   * Books a slot for a student using public.book_slot RPC.
   */
  static async bookSlot(studentId: string, slotId: string) {
    const { data, error } = await supabaseAdmin.rpc("book_slot", {
      p_student_id: studentId,
      p_slot_id: slotId
    });

    if (error) {
      throw new Error(`Booking failed: ${error.message}`);
    }

    if (!data || !data[0]) {
      throw new Error("No response returned from booking engine.");
    }

    const result = data[0];
    if (!result.success) {
      throw new Error(result.error_message || "Booking failed.");
    }

    return {
      success: true,
      bookingId: result.booking_id
    };
  }

  /**
   * Cancels a booking with the 24-hour token release / forfeiture policy.
   */
  static async cancelBooking(bookingId: string, cancelledBy?: string, reason?: string) {
    try {
      const { data: rpcData, error: rpcErr } = await supabaseAdmin.rpc("cancel_booking", {
        p_booking_id: bookingId,
        p_cancelled_by: cancelledBy || null,
        p_reason: reason || null
      });

      if (!rpcErr && rpcData && rpcData[0]) {
        const row = rpcData[0];
        if (!row.success) throw new Error(row.error_message || "Failed to cancel booking.");
        return {
          success: true,
          tokensReleased: Number(row.tokens_released),
          policy: row.policy_applied
        };
      }
    } catch (rpcEx: any) {
      console.warn("cancel_booking RPC fallback:", rpcEx.message);
    }

    // Direct fallback
    const { data: booking, error: bErr } = await supabaseAdmin
      .from("bookings")
      .select("*, schedule_slots (*)")
      .eq("id", bookingId)
      .single();

    if (bErr || !booking) throw new Error("Booking not found.");
    if (booking.status === "cancelled") throw new Error("Booking is already cancelled.");

    const slot = booking.schedule_slots;
    const startAt = new Date(slot.start_at).getTime();
    const now = Date.now();
    const hoursUntilStart = (startAt - now) / (1000 * 3600);

    let released = 0;
    let policy = "";

    if (hoursUntilStart >= 24) {
      released = Number(booking.tokens_reserved);
      policy = "Full release (>= 24h notice)";
      await supabaseAdmin.from("token_ledger").insert({
        student_id: booking.student_id,
        course_id: slot.course_id,
        hours: released,
        type: "release",
        ref_booking_id: booking.id,
        note: reason || "Booking cancelled >= 24h before class - hours restored",
        created_by: cancelledBy || "student"
      });
    } else {
      policy = "Forfeited (< 24h notice)";
    }

    await supabaseAdmin
      .from("bookings")
      .update({ status: "cancelled", cancelled_at: new Date().toISOString() })
      .eq("id", bookingId);

    await supabaseAdmin
      .from("attendance")
      .update({ status: "cancelled" })
      .eq("booking_id", bookingId);

    if (slot.status === "full") {
      await supabaseAdmin
        .from("schedule_slots")
        .update({ status: "open" })
        .eq("id", slot.id);
    }

    return {
      success: true,
      tokensReleased: released,
      policy
    };
  }

  /**
   * List slots for a specific date in CST for attendance marking.
   */
  static async listAttendanceSlots(dateStr?: string, teacherId?: string) {
    // Default to CST today
    const nowParts = utcToCstParts(new Date());
    const targetDate = dateStr || nowParts.cstDate;

    // Get CST start and end of target day in UTC ISO
    const startUtc = cstDateTimeToUtc(targetDate, "00:00").toISOString();
    const endUtc = cstDateTimeToUtc(targetDate, "23:59").toISOString();

    let query = supabaseAdmin
      .from("schedule_slots")
      .select("*")
      .gte("start_at", startUtc)
      .lte("start_at", endUtc)
      .neq("status", "cancelled")
      .order("start_at", { ascending: true });

    if (teacherId && teacherId !== "ALL") {
      query = query.eq("teacher_id", teacherId);
    }

    const { data: slots, error: slotErr } = await query;
    if (slotErr) throw new Error(`Failed to query attendance slots: ${slotErr.message}`);

    if (!slots || slots.length === 0) return [];

    const slotIds = slots.map(s => s.id);

    // Fetch courses
    const { data: courses } = await supabaseAdmin.from("courses").select("id, name, course_code");
    const courseMap = new Map((courses || []).map(c => [c.id, c]));

    // Fetch teachers
    const { data: teachers } = await supabaseAdmin.from("teachers").select("id, name, email, phone");
    const teacherMap = new Map((teachers || []).map(t => [t.id, t]));

    // Fetch attendance rows for these slots
    const { data: attRows } = await supabaseAdmin
      .from("attendance")
      .select("id, slot_id, student_id, booking_id, status, marked_by, marked_at, students(id, name, student_id_code, email)")
      .in("slot_id", slotIds)
      .neq("status", "cancelled");

    const attMap = new Map<string, any[]>();
    for (const row of attRows || []) {
      const list = attMap.get(row.slot_id) || [];
      list.push(row);
      attMap.set(row.slot_id, list);
    }

    return slots.map(slot => {
      const crs = courseMap.get(slot.course_id);
      const tch = teacherMap.get(slot.teacher_id);
      const startParts = utcToCstParts(new Date(slot.start_at));
      const endParts = utcToCstParts(new Date(slot.end_at));
      const slotAtt = attMap.get(slot.id) || [];

      return {
        id: slot.id,
        course_id: slot.course_id,
        course_name: crs?.name || "Unassigned Course",
        course_code: crs?.course_code || "",
        teacher_id: slot.teacher_id,
        teacher_name: tch?.name || "Faculty",
        grade: slot.grade || "All Grades",
        start_at: slot.start_at,
        end_at: slot.end_at,
        duration_hours: Number(slot.duration_hours),
        max_students: slot.max_students,
        status: slot.status,
        day_of_week: startParts.dayOfWeek,
        time_slot: `${startParts.timeStr} - ${endParts.timeStr} CST`,
        date_cst: startParts.cstDate,
        studentsCount: slotAtt.length,
        isCompleted: slot.status === "completed" || (slotAtt.length > 0 && slotAtt.every(a => a.status !== "scheduled")),
        students: slotAtt.map((a: any) => ({
          attendance_id: a.id,
          booking_id: a.booking_id,
          student_id: a.student_id,
          student_name: a.students?.name || "Student",
          student_code: a.students?.student_id_code || `TG-STU-${a.student_id.slice(0, 6)}`,
          email: a.students?.email || "",
          status: a.status,
          marked_at: a.marked_at,
          marked_by: a.marked_by
        }))
      };
    });
  }

  /**
   * Marks attendance for an attendance record (present, late, absent, excused)
   * with strict net-zero token accounting and slot completion triggers.
   */
  static async markAttendance(
    attendanceId: string,
    status: "present" | "absent" | "late" | "excused",
    markedBy?: string,
    remarks?: string
  ) {
    if (!["present", "absent", "late", "excused"].includes(status)) {
      throw new Error("Invalid status. Must be present, absent, late, or excused.");
    }

    // Try RPC first
    try {
      const { data: rpcData, error: rpcErr } = await supabaseAdmin.rpc("mark_attendance", {
        p_attendance_id: attendanceId,
        p_status: status,
        p_marked_by: markedBy || null,
        p_remarks: remarks || null
      });

      if (!rpcErr && rpcData && rpcData[0]?.success) {
        return {
          success: true,
          status,
          slotCompleted: rpcData[0].slot_completed,
          tokensAffected: Number(rpcData[0].tokens_affected)
        };
      }
    } catch (rpcEx: any) {
      console.warn("mark_attendance RPC fallback:", rpcEx.message);
    }

    // Direct fallback implementation
    const { data: att, error: attErr } = await supabaseAdmin
      .from("attendance")
      .select("*, bookings(*), schedule_slots(*)")
      .eq("id", attendanceId)
      .single();

    if (attErr || !att) throw new Error("Attendance record not found.");

    const booking = att.bookings;
    const slot = att.schedule_slots;
    const prevStatus = att.status;
    let tokensAffected = 0;

    // Apply token rules
    if (prevStatus === "excused" && (status === "present" || status === "late" || status === "absent")) {
      // Re-reserve tokens that were previously released
      tokensAffected = -Number(booking.tokens_reserved);
      await supabaseAdmin.from("token_ledger").insert({
        student_id: att.student_id,
        course_id: slot.course_id,
        hours: tokensAffected,
        type: "reserve",
        ref_booking_id: booking.id,
        note: remarks || `Hours re-reserved: excused status updated to ${status}`,
        created_by: markedBy || "faculty"
      });
    } else if (prevStatus !== "excused" && status === "excused") {
      // Release tokens back to student
      tokensAffected = Number(booking.tokens_reserved);
      await supabaseAdmin.from("token_ledger").insert({
        student_id: att.student_id,
        course_id: slot.course_id,
        hours: tokensAffected,
        type: "release",
        ref_booking_id: booking.id,
        note: remarks || "Absence excused by faculty - hours restored",
        created_by: markedBy || "faculty"
      });
    }

    // Validate markedBy against public.profiles (to satisfy foreign key constraint)
    let validMarkedBy: string | null = null;
    if (markedBy) {
      try {
        const { data: prof } = await supabaseAdmin
          .from("profiles")
          .select("id")
          .eq("id", markedBy)
          .maybeSingle();
        if (prof) validMarkedBy = prof.id;
      } catch {}
    }

    // Update attendance row
    const { error: updErr } = await supabaseAdmin
      .from("attendance")
      .update({
        status,
        marked_by: validMarkedBy,
        marked_at: new Date().toISOString()
      })
      .eq("id", attendanceId);

    if (updErr) {
      throw new Error(`Failed to update attendance status: ${updErr.message}`);
    }

    // Check if all attendance rows for this slot are marked
    const { count: scheduledRemaining, error: countErr } = await supabaseAdmin
      .from("attendance")
      .select("id", { count: "exact", head: true })
      .eq("slot_id", att.slot_id)
      .eq("status", "scheduled");

    let slotCompleted = false;
    if (scheduledRemaining === 0) {
      await supabaseAdmin
        .from("schedule_slots")
        .update({ status: "completed" })
        .eq("id", att.slot_id)
        .neq("status", "cancelled");
      slotCompleted = true;
    }

    return {
      success: true,
      status,
      slotCompleted,
      tokensAffected
    };
  }

  /**
   * Computes the weekly attendance rate in America/Chicago (CST/CDT):
   * (present + late) / (present + late + absent)
   * Returns null if no marked attendance records exist for the current week.
   */
  static async getWeeklyAttendanceRate() {
    const nowCst = utcToCstParts(new Date());
    const cstDate = new Date(`${nowCst.cstDate}T12:00:00Z`);
    const dayOfWeek = cstDate.getUTCDay(); // 0 is Sunday, 1 is Monday...

    // Calculate Monday of current week
    const diffToMonday = dayOfWeek === 0 ? -6 : 1 - dayOfWeek;
    const monday = new Date(cstDate);
    monday.setUTCDate(cstDate.getUTCDate() + diffToMonday);
    const mondayStr = monday.toISOString().slice(0, 10);

    // Calculate Sunday of current week
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
        display: "—",
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
        display: "—",
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
