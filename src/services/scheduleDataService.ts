import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { supabaseAdmin } from "../supabase.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const DATA_DIR = path.resolve(__dirname, "../../data");
const SCHEDULES_FILE = path.join(DATA_DIR, "schedules_db.json");
const TEACHER_AVAILABILITY_FILE = path.join(DATA_DIR, "teacher_availability_db.json");
const STUDENT_HISTORY_FILE = path.join(DATA_DIR, "student_history_db.json");

// Ensure data directory exists
if (!fs.existsSync(DATA_DIR)) {
  fs.mkdirSync(DATA_DIR, { recursive: true });
}

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
  start_time: string;  // e.g. '10:00' or '10:00 AM'
  end_time: string;    // e.g. '11:30' or '11:30 AM'
  time_slot: string;   // e.g. '10:00 AM - 11:30 AM'
  room: string;
  location: string;
  max_capacity: number;
  is_active: boolean;
  students?: ScheduleStudent[];
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
}

export interface StudentHistoryItem {
  id: string;
  student_id: string;
  student_name?: string;
  event_type: "ADMISSION" | "SCHEDULE_ASSIGNMENT" | "ATTENDANCE_RECORD" | "STATUS_CHANGE" | "NOTE";
  title: string;
  description: string;
  metadata?: any;
  actor?: string;
  created_at: string;
}

// In-Memory & File Store Fallback
class LocalScheduleStore {
  private schedules: ScheduleSlot[] = [];
  private teacherAvailability: TeacherAvailability[] = [];
  private studentHistory: StudentHistoryItem[] = [];

  constructor() {
    this.loadFromDisk();
  }

  private loadFromDisk() {
    try {
      if (fs.existsSync(SCHEDULES_FILE)) {
        this.schedules = JSON.parse(fs.readFileSync(SCHEDULES_FILE, "utf-8"));
      } else {
        this.schedules = [];
        this.saveSchedules();
      }

      if (fs.existsSync(TEACHER_AVAILABILITY_FILE)) {
        this.teacherAvailability = JSON.parse(fs.readFileSync(TEACHER_AVAILABILITY_FILE, "utf-8"));
      } else {
        this.teacherAvailability = [];
        this.saveTeacherAvailability();
      }

      if (fs.existsSync(STUDENT_HISTORY_FILE)) {
        this.studentHistory = JSON.parse(fs.readFileSync(STUDENT_HISTORY_FILE, "utf-8"));
      } else {
        this.studentHistory = [];
        this.saveStudentHistory();
      }
    } catch (err) {
      console.warn("LocalScheduleStore load warning:", err);
    }
  }

  private saveSchedules() {
    try {
      fs.writeFileSync(SCHEDULES_FILE, JSON.stringify(this.schedules, null, 2));
    } catch (err) {
      console.error("Failed to persist schedules to disk:", err);
    }
  }

  private saveTeacherAvailability() {
    try {
      fs.writeFileSync(TEACHER_AVAILABILITY_FILE, JSON.stringify(this.teacherAvailability, null, 2));
    } catch (err) {
      console.error("Failed to persist teacher availability to disk:", err);
    }
  }

  private saveStudentHistory() {
    try {
      fs.writeFileSync(STUDENT_HISTORY_FILE, JSON.stringify(this.studentHistory, null, 2));
    } catch (err) {
      console.error("Failed to persist student history to disk:", err);
    }
  }

  // --- Schedules CRUD ---
  getAllSchedules(): ScheduleSlot[] {
    return [...this.schedules];
  }

  getScheduleById(id: string): ScheduleSlot | undefined {
    return this.schedules.find(s => s.id === id);
  }

  saveSchedule(slot: ScheduleSlot) {
    const idx = this.schedules.findIndex(s => s.id === slot.id);
    if (idx >= 0) {
      this.schedules[idx] = slot;
    } else {
      this.schedules.push(slot);
    }
    this.saveSchedules();
  }

  deleteSchedule(id: string): boolean {
    const initialLen = this.schedules.length;
    this.schedules = this.schedules.filter(s => s.id !== id);
    if (this.schedules.length !== initialLen) {
      this.saveSchedules();
      return true;
    }
    return false;
  }

  // --- Teacher Availability ---
  getTeacherAvailability(teacherId: string): TeacherAvailability[] {
    return this.teacherAvailability.filter(a => a.teacher_id === teacherId);
  }

  setTeacherAvailability(teacherId: string, list: Array<{ day_of_week: string; available_from: string; available_to: string; is_active: boolean }>) {
    this.teacherAvailability = this.teacherAvailability.filter(a => a.teacher_id !== teacherId);
    list.forEach(item => {
      this.teacherAvailability.push({
        id: `avail-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
        teacher_id: teacherId,
        day_of_week: item.day_of_week,
        available_from: item.available_from,
        available_to: item.available_to,
        is_active: item.is_active
      });
    });
    this.saveTeacherAvailability();
  }

  // --- Student History ---
  appendHistory(item: Omit<StudentHistoryItem, "id" | "created_at">): StudentHistoryItem {
    const record: StudentHistoryItem = {
      ...item,
      id: `hist-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
      created_at: new Date().toISOString()
    };
    this.studentHistory.push(record);
    this.saveStudentHistory();
    return record;
  }

  getStudentHistory(studentId: string): StudentHistoryItem[] {
    return this.studentHistory.filter(h => h.student_id === studentId || h.student_id === String(studentId));
  }
}

export const localScheduleStore = new LocalScheduleStore();

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

  // If start >= end, it might span midnight or be equal
  const actualEndA = eA <= sA ? sA + 60 : eA;
  const actualEndB = eB <= sB ? sB + 60 : eB;

  return Math.max(sA, sB) < Math.min(actualEndA, actualEndB);
}

// --- Schedule Data Service with Supabase + Local Resilience ---

export class ScheduleDataService {
  /**
   * Fetch all courses strictly from Supabase/DB (no new courses hardcoded)
   */
  static async getExistingCourses(): Promise<Array<{ id: string; name: string; course_code?: string }>> {
    try {
      const { data, error } = await supabaseAdmin
        .from("courses")
        .select("id, name, course_code")
        .order("name", { ascending: true });

      if (!error && data && data.length > 0) {
        return data;
      }
    } catch (err) {
      console.warn("Supabase getExistingCourses error, fallback check:", err);
    }

    // Fallback: Check distinct courses from student records
    try {
      const { data } = await supabaseAdmin.from("students").select("courses");
      if (data && data.length > 0) {
        const unique = new Set<string>();
        data.forEach((s: any) => {
          if (Array.isArray(s.courses)) s.courses.forEach((c: any) => unique.add(typeof c === "string" ? c : c.courseName || c.name));
        });
        if (unique.size > 0) {
          return Array.from(unique).map((name, idx) => ({ id: `crs-auto-${idx}`, name }));
        }
      }
    } catch (e) {
      console.warn("Student distinct courses fallback error:", e);
    }

    return [];
  }

  /**
   * Check for collisions: Teacher, Room, and Students
   */
  static async checkCollisions(params: {
    scheduleIdToExclude?: string;
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
        if (slot.teacher_id === params.teacher_id) {
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
   * List all schedule slots with mapped students
   */
  static async listSchedules(): Promise<ScheduleSlot[]> {
    // 1. Attempt Supabase fetch
    try {
      const { data: schedData, error: schedErr } = await supabaseAdmin
        .from("schedules")
        .select("*")
        .order("created_at", { ascending: true });

      if (!schedErr && schedData && schedData.length > 0) {
        // Fetch students mapped to these schedules
        const { data: studentMap } = await supabaseAdmin
          .from("schedule_students")
          .select("*");

        const mappedList: ScheduleSlot[] = schedData.map((s: any) => {
          const students = studentMap ? studentMap.filter((sm: any) => sm.schedule_id === s.id) : [];
          return {
            id: s.id,
            course_id: s.course_id,
            course_name: s.course_name,
            teacher_id: s.teacher_id,
            teacher_name: s.teacher_name,
            day_of_week: s.day_of_week,
            start_time: s.start_time,
            end_time: s.end_time,
            time_slot: s.time_slot || `${s.start_time} - ${s.end_time}`,
            room: s.room || "Room 101",
            location: s.location || "Main Campus",
            max_capacity: s.max_capacity || 15,
            is_active: s.is_active !== false,
            students: students.map((sm: any) => ({
              id: sm.id,
              schedule_id: sm.schedule_id,
              student_id: sm.student_id,
              student_name: sm.student_name,
              student_code: sm.student_code,
              created_at: sm.created_at
            })),
            created_at: s.created_at,
            updated_at: s.updated_at
          };
        });

        return mappedList;
      }
    } catch (err) {
      console.warn("Supabase schedules query fallback to local store:", err);
    }

    // 2. Return from local persistent store
    return localScheduleStore.getAllSchedules();
  }

  /**
   * Create a schedule slot
   */
  static async createSchedule(payload: {
    course_id: string;
    course_name: string;
    teacher_id: string;
    teacher_name: string;
    day_of_week: string;
    start_time: string;
    end_time: string;
    room?: string;
    location?: string;
    max_capacity?: number;
    students?: Array<{ student_id: string; student_name: string; student_code?: string }>;
  }): Promise<ScheduleSlot> {
    const studentIds = (payload.students || []).map(s => s.student_id);

    // Run collision check
    const conflict = await this.checkCollisions({
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
    const scheduleId = `sch-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
    const nowIso = new Date().toISOString();

    const mappedStudents: ScheduleStudent[] = (payload.students || []).map(st => ({
      id: `sch-stu-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
      schedule_id: scheduleId,
      student_id: st.student_id,
      student_name: st.student_name,
      student_code: st.student_code,
      created_at: nowIso
    }));

    const newSlot: ScheduleSlot = {
      id: scheduleId,
      course_id: payload.course_id,
      course_name: payload.course_name,
      teacher_id: payload.teacher_id,
      teacher_name: payload.teacher_name,
      day_of_week: payload.day_of_week,
      start_time: payload.start_time,
      end_time: payload.end_time,
      time_slot: timeSlot,
      room: payload.room || "Room 101",
      location: payload.location || "Main Campus",
      max_capacity: payload.max_capacity || 15,
      is_active: true,
      students: mappedStudents,
      created_at: nowIso,
      updated_at: nowIso
    };

    // Save to local store
    localScheduleStore.saveSchedule(newSlot);

    // Attempt Supabase insert
    try {
      await supabaseAdmin.from("schedules").insert([
        {
          id: newSlot.id,
          course_id: newSlot.course_id,
          course_name: newSlot.course_name,
          teacher_id: newSlot.teacher_id,
          teacher_name: newSlot.teacher_name,
          day_of_week: newSlot.day_of_week,
          start_time: newSlot.start_time,
          end_time: newSlot.end_time,
          time_slot: newSlot.time_slot,
          room: newSlot.room,
          location: newSlot.location,
          max_capacity: newSlot.max_capacity,
          is_active: newSlot.is_active
        }
      ]);

      if (mappedStudents.length > 0) {
        await supabaseAdmin.from("schedule_students").insert(
          mappedStudents.map(ms => ({
            schedule_id: ms.schedule_id,
            student_id: ms.student_id,
            student_name: ms.student_name,
            student_code: ms.student_code
          }))
        );
      }
    } catch (err) {
      console.warn("Supabase schedule insert notice (persisted locally):", err);
    }

    // Append to Student History for each mapped student
    for (const st of mappedStudents) {
      this.appendHistoryItem({
        student_id: st.student_id,
        student_name: st.student_name,
        event_type: "SCHEDULE_ASSIGNMENT",
        title: `Enrolled in Weekly Schedule: ${payload.course_name}`,
        description: `Class scheduled on ${payload.day_of_week}s (${timeSlot}) at ${payload.room || "Room 101"} with faculty ${payload.teacher_name}.`,
        metadata: {
          schedule_id: scheduleId,
          course_name: payload.course_name,
          day_of_week: payload.day_of_week,
          time_slot: timeSlot,
          room: payload.room,
          teacher_name: payload.teacher_name
        },
        actor: "Admin / Faculty"
      });
    }

    return newSlot;
  }

  /**
   * Update an existing schedule slot
   */
  static async updateSchedule(id: string, payload: Partial<ScheduleSlot> & { students?: Array<{ student_id: string; student_name: string; student_code?: string }> }): Promise<ScheduleSlot> {
    const existing = (await this.listSchedules()).find(s => s.id === id);
    if (!existing) {
      throw new Error(`Schedule slot with ID '${id}' not found.`);
    }

    const updatedDay = payload.day_of_week || existing.day_of_week;
    const updatedStart = payload.start_time || existing.start_time;
    const updatedEnd = payload.end_time || existing.end_time;
    const updatedTeacher = payload.teacher_id || existing.teacher_id;
    const updatedRoom = payload.room || existing.room;
    const updatedStudents = payload.students ? payload.students.map(s => s.student_id) : (existing.students || []).map(s => s.student_id);

    // Check collisions excluding current slot
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

    let mappedStudents = existing.students || [];
    if (payload.students) {
      mappedStudents = payload.students.map(st => ({
        id: `sch-stu-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
        schedule_id: id,
        student_id: st.student_id,
        student_name: st.student_name,
        student_code: st.student_code,
        created_at: nowIso
      }));
    }

    const updatedSlot: ScheduleSlot = {
      ...existing,
      ...payload,
      id,
      time_slot: timeSlot,
      students: mappedStudents,
      updated_at: nowIso
    };

    localScheduleStore.saveSchedule(updatedSlot);

    // Update in Supabase
    try {
      await supabaseAdmin.from("schedules").update({
        course_id: updatedSlot.course_id,
        course_name: updatedSlot.course_name,
        teacher_id: updatedSlot.teacher_id,
        teacher_name: updatedSlot.teacher_name,
        day_of_week: updatedSlot.day_of_week,
        start_time: updatedSlot.start_time,
        end_time: updatedSlot.end_time,
        time_slot: updatedSlot.time_slot,
        room: updatedSlot.room,
        location: updatedSlot.location,
        max_capacity: updatedSlot.max_capacity,
        is_active: updatedSlot.is_active,
        updated_at: nowIso
      }).eq("id", id);

      if (payload.students) {
        await supabaseAdmin.from("schedule_students").delete().eq("schedule_id", id);
        if (mappedStudents.length > 0) {
          await supabaseAdmin.from("schedule_students").insert(
            mappedStudents.map(ms => ({
              schedule_id: ms.schedule_id,
              student_id: ms.student_id,
              student_name: ms.student_name,
              student_code: ms.student_code
            }))
          );
        }
      }
    } catch (err) {
      console.warn("Supabase schedule update notice (updated locally):", err);
    }

    return updatedSlot;
  }

  /**
   * Delete a schedule slot
   */
  static async deleteSchedule(id: string): Promise<boolean> {
    localScheduleStore.deleteSchedule(id);
    try {
      await supabaseAdmin.from("schedule_students").delete().eq("schedule_id", id);
      await supabaseAdmin.from("schedules").delete().eq("id", id);
    } catch (err) {
      console.warn("Supabase schedule delete notice:", err);
    }
    return true;
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
   * Get teacher roster: all students mapped to a teacher grouped by Course, Day, and Slot
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

  /**
   * Append audit event to Student History
   */
  static appendHistoryItem(item: Omit<StudentHistoryItem, "id" | "created_at">): StudentHistoryItem {
    // 1. Save to local store
    const record = localScheduleStore.appendHistory(item);

    // 2. Attempt Supabase save
    const insertPromise = supabaseAdmin.from("student_history").insert([
      {
        student_id: item.student_id,
        student_name: item.student_name,
        event_type: item.event_type,
        title: item.title,
        description: item.description,
        metadata: item.metadata || {},
        actor: item.actor || "System",
        created_at: record.created_at
      }
    ]);
    Promise.resolve(insertPromise).then((res: any) => {
      if (res?.error) console.warn("Supabase student_history insert warning:", res.error.message);
    }).catch((e: any) => console.warn("Supabase student_history network note:", e));

    return record;
  }

  /**
   * Get complete Student History Ledger (combining student_history + Supabase attendance logs)
   */
  static async getStudentHistory(studentId: string): Promise<StudentHistoryItem[]> {
    let historyItems: StudentHistoryItem[] = [];

    // 1. Fetch from Supabase student_history
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

    // Fallback to local store if Supabase returns nothing
    if (historyItems.length === 0) {
      historyItems = localScheduleStore.getStudentHistory(studentId);
    }

    // Also pull actual attendance records for this student from Supabase `attendance`
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

    // Sort descending by date
    return historyItems.sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime());
  }
}
