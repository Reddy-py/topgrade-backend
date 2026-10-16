import { markAttendance } from "./attendanceService.js";
import type { AttendanceStatusEnum } from "./attendanceRepo.js";
import { instituteNow } from "./instituteTime.js";
import { ScheduleDataService } from "./scheduleDataService.js";
import { resolveTeacherIdentity } from "./teacherIdentity.js";
import { dispatchMultiChannelNotification } from "./notificationService.js";
import { supabaseAdmin } from "../supabase.js";

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
  entries: Array<{
    studentId: string;
    studentName: string;
    studentEmail?: string;
    status: "PRESENT" | "ABSENT" | "LATE";
    notes?: string | undefined;
  }>;
}

export const classSessionQrStore: ClassSessionQRRecord[] = [];

/**
 * Automatically generates attendance session records whenever a course with a weekly schedule is created or updated.
 */
export function autoGenerateAttendanceSessionsForCourse(course: any) {
  if (!course || !course.id) return;

  // Remove existing sessions for this course in local memory
  for (let i = classSessionQrStore.length - 1; i >= 0; i--) {
    if (classSessionQrStore[i]?.courseId === course.id) {
      classSessionQrStore.splice(i, 1);
    }
  }

  const schedule = Array.isArray(course.schedule) ? course.schedule : [];
  schedule.forEach((slot: any, idx: number) => {
    const teacherId = slot.teacherId || course.assigned_teachers?.[0]?.teacherId || "tch-1";
    const teacherName = slot.teacherName || course.assigned_teachers?.[0]?.name || "Assigned Faculty";
    const day = slot.day || "Monday";
    const slotName = slot.slot || "09:00 AM - 10:30 AM";

    const sessionRecord: ClassSessionQRRecord = {
      id: `sqr-${course.id}-${slot.id || idx + 1}`,
      classSessionId: `sess-${course.id}-${day.toLowerCase()}-${idx + 1}`,
      courseId: course.id,
      courseName: course.name,
      courseCode: course.course_code,
      teacherId,
      teacherName,
      startTime: new Date().toISOString(),
      endTime: new Date(Date.now() + 86400000 * 30).toISOString(),
      graceMinutes: 30,
      qrToken: `TG-SESSION-${course.course_code || course.id}-${day.substring(0, 3).toUpperCase()}-${idx + 1}`,
      isExpired: false,
      dayOfWeek: day,
      slotName: slotName,
      room: slot.room || "Computer Lab 1",
      programTrack: slot.programTrack || "Core Foundations & Concepts",
      createdAt: new Date().toISOString()
    };

    classSessionQrStore.push(sessionRecord);
  });
}

/**
 * Removes all attendance sessions when a course is deleted.
 */
export function removeAttendanceSessionsForCourse(courseId: string) {
  for (let i = classSessionQrStore.length - 1; i >= 0; i--) {
    if (classSessionQrStore[i]?.courseId === courseId) {
      classSessionQrStore.splice(i, 1);
    }
  }
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
    classSessionQrStore.push(record);
    return record;
  }

  /**
   * Process student QR self-scan
   */
  public static async processStudentSelfScan(input: StudentSelfScanInput) {
    const { studentId, qrToken, customScanTimeIso } = input;
    // The scan time is always the server's time. (A custom time is accepted only outside production, for testing.)
    const nowIso = process.env.NODE_ENV !== "production" && customScanTimeIso ? customScanTimeIso : new Date().toISOString();

    const liveSessions = await this.getLiveSessionsFromSupabase();
    const session = liveSessions.find(s => s.qrToken === qrToken) || classSessionQrStore.find(s => s.qrToken === qrToken);

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

    // The class must be open now, and the student must be enrolled in it.
    const start = Date.parse(session.startTime);
    const end = Date.parse(session.endTime);
    if (Number.isFinite(start) && Number.isFinite(end) && end > start) {
      const graceMs = (session.graceMinutes || 15) * 60000;
      const t = Date.parse(nowIso);
      if (t < start - 30 * 60000 || t > end + graceMs) {
        const err: any = new Error("This class is not open for check-in right now.");
        err.code = "OUTSIDE_CLASS_TIME";
        throw err;
      }
    }
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

    // One attendance row per student, per class, per day, saved in Supabase. PRESENT uses one class token.
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
  public static checkSessionQrTimeGate(sessionQr: ClassSessionQRRecord, _customScanTimeIso?: string) {
    return {
      isUnlocked: true,
      statusBadgeText: `🔓 Session Active & Ready for Marking`,
      reason: "ACTIVE"
    };
  }

  /**
   * Fetches all live attendance sessions derived directly from Supabase courses and their schedule slots
   */
  public static async getLiveSessionsFromSupabase(): Promise<ClassSessionQRRecord[]> {
    try {
      const { data: courses, error } = await supabaseAdmin
        .from("courses")
        .select("*")
        .order("created_at", { ascending: false });

      if (error || !courses) {
        return classSessionQrStore;
      }

      const { data: students } = await supabaseAdmin.from("students").select("id, name, program, status");
      const allStudents = students || [];

      const sessions: ClassSessionQRRecord[] = [];

      courses.forEach((course: any) => {
        let meta: any = {};
        try {
          if (typeof course.course_material === "string") {
            meta = JSON.parse(course.course_material);
          } else if (course.course_material && typeof course.course_material === "object") {
            meta = course.course_material;
          }
        } catch {}

        const schedule = Array.isArray(meta.schedule) ? meta.schedule : [];
        const assignedTeachers = Array.isArray(meta.assigned_teachers) ? meta.assigned_teachers : [];
        const defaultTeacher = assignedTeachers[0]?.name || course.required_teacher_skills || "Assigned Faculty";
        const defaultTeacherId = assignedTeachers[0]?.teacherId || "";

        // Filter students enrolled in this course
        const enrolledCount = allStudents.filter(s => 
          s.program && (s.program.trim().toLowerCase() === (course.name || "").trim().toLowerCase() || s.program.includes(course.course_code))
        ).length;

        schedule.forEach((slot: any, idx: number) => {
          const sessionObj: ClassSessionQRRecord = {
            id: `sqr-${course.id}-${slot.id || (slot.day + '-' + idx)}`,
            classSessionId: `sess-${course.id}-${slot.id || (slot.day.toLowerCase() + '-' + idx)}`,
            courseId: course.id,
            courseName: course.name,
            courseCode: course.course_code || `CRS-${course.id}`,
            teacherId: slot.teacherId || defaultTeacherId || "tch-1",
            teacherName: slot.teacherName || defaultTeacher,
            dayOfWeek: slot.day,
            slotName: slot.slot,
            room: slot.room || "Computer Lab 1",
            programTrack: slot.programTrack || "Core Foundations & Concepts",
            startTime: new Date().toISOString(),
            endTime: new Date(Date.now() + 86400000 * 30).toISOString(),
            graceMinutes: 30,
            qrToken: `TG-SESSION-${course.course_code || course.id}-${slot.day?.substring(0, 3).toUpperCase()}-${idx + 1}`,
            isExpired: false,
            enrolledStudentsCount: enrolledCount,
            createdAt: course.created_at || new Date().toISOString()
          };
          sessions.push(sessionObj);
        });
      });

      return sessions;
    } catch (err) {
      console.error("Error fetching live sessions from Supabase:", err);
      return classSessionQrStore;
    }
  }

  /**
   * Generates or returns session roster with live enrolled students from Supabase
   */
  public static async getSessionRoster(classSessionId: string) {
    const liveSessions = await this.getLiveSessionsFromSupabase();
    let sessionQr = liveSessions.find(s => s.classSessionId === classSessionId || s.id === classSessionId);

    if (!sessionQr) {
      // Find by partial course ID if needed
      sessionQr = liveSessions[0] || {
        id: "sqr-default",
        classSessionId,
        courseId: "crs-1",
        courseName: "Python programming",
        courseCode: "CRS-431",
        teacherId: "tch-1",
        teacherName: "Assigned Faculty",
        startTime: new Date().toISOString(),
        endTime: new Date().toISOString(),
        graceMinutes: 30,
        qrToken: `TG-SESSION-${classSessionId}`,
        isExpired: false,
        dayOfWeek: "Monday",
        slotName: "09:00 AM - 10:30 AM",
        room: "Computer Lab 1",
        programTrack: "Core Foundations & Concepts",
        enrolledStudentsCount: 0,
        createdAt: new Date().toISOString()
      };
    }

    // Fetch enrolled students from Supabase
    let roster: any[] = [];
    try {
      const { data: students, error: stuErr } = await supabaseAdmin
        .from("students")
        .select("*")
        .order("name", { ascending: true });

      if (!stuErr && students) {
        // Find matching students for this course
        const targetCourseName = (sessionQr.courseName || "").trim().toLowerCase();
        let matched = students.filter(s => 
          s.program && (s.program.trim().toLowerCase() === targetCourseName || (sessionQr?.courseCode && s.program.includes(sessionQr.courseCode)))
        );

        // If no specific course match found, list all active students so instructor can mark attendance
        if (matched.length === 0) {
          matched = students;
        }

        // Check if attendance already marked today
        const todayDate = new Date().toISOString().slice(0, 10);
        const { data: todayLogs } = await supabaseAdmin
          .from("attendance")
          .select("*")
          .eq("date", todayDate)
          .eq("class_name", sessionQr.courseName);

        roster = matched.map(s => {
          const existingMark = todayLogs?.find(l => l.student_id === s.id || l.student_name === s.name);
          const currentStatus = existingMark ? (existingMark.status?.toUpperCase() || "PRESENT") : "PRESENT";

          return {
            studentId: s.id,
            fullName: s.name,
            studentCode: s.student_id_code || `TG-STU-${s.id}`,
            email: s.email,
            parentEmail: s.email,
            grade: s.age ? `Grade ${s.age > 12 ? 12 : s.age}` : "Grade 8",
            status: currentStatus,
            notes: existingMark?.remarks || ""
          };
        });
      }
    } catch (e) {
      console.error("Error building session roster from Supabase:", e);
    }

    return {
      sessionQr,
      timeGate: { isUnlocked: true, statusBadgeText: "🔓 Session Active & Ready for Marking", reason: "ACTIVE" },
      studentsCount: roster.length,
      roster
    };
  }

  /**
   * Submits teacher session attendance: Saves to Supabase attendance table & dispatches emails to each student
   */
  public static async submitTeacherSessionAttendance(
    input: TeacherSessionSubmitInput,
    actor?: { id?: string; role?: string; email?: string; name?: string }
  ) {
    const { classSessionId, entries } = input;
    const nowIso = new Date().toISOString();
    const todayDate = instituteNow().dateStr;

    const liveSessions = await this.getLiveSessionsFromSupabase();
    const sessionQr = liveSessions.find(s => s.classSessionId === classSessionId || s.id === classSessionId);
    if (!sessionQr) {
      const err: any = new Error("This class session was not found.");
      err.status = 404;
      throw err;
    }
    // A teacher can submit only their own class. The admin can submit any.
    if (actor?.role === "TEACHER") {
      const ident = await resolveTeacherIdentity({ id: actor.id, email: actor.email });
      const mine = ident.keys.has(String(sessionQr.teacherId || "").toLowerCase()) ||
        ident.names.has(String(sessionQr.teacherName || "").trim().toLowerCase());
      if (!mine) {
        const err: any = new Error("This class is not yours.");
        err.status = 403;
        throw err;
      }
    }

    let presentCount = 0;
    let absentCount = 0;

    // Fetch students to ensure we have their correct registered emails
    const { data: studentsDb } = await supabaseAdmin.from("students").select("id, name, email, student_id_code");
    const studentsMap = new Map((studentsDb || []).map(s => [s.id, s]));
    const warnings: string[] = [];
    let savedCount = 0;

    for (const entry of entries) {
      const status = String(entry.status || "PRESENT").toUpperCase() as AttendanceStatusEnum;
      const attended = status === "PRESENT" || status === "LATE";
      const studentInfo = studentsMap.get(entry.studentId);
      if (!studentInfo) {
        warnings.push(`${entry.studentName || entry.studentId}: student not found, not saved.`);
        continue;
      }

      let saved;
      try {
        saved = await markAttendance({
          studentIdOrCode: studentInfo.id, status,
          courseId: sessionQr.courseId, courseName: sessionQr.courseName, scheduleId: sessionQr.classSessionId,
          date: todayDate,
          remarks: entry.notes ? `${entry.notes} (Faculty: ${sessionQr.teacherName})` : `Marked by ${sessionQr.teacherName}`,
          scanMethod: "TEACHER_BATCH", markedByName: actor?.name || sessionQr.teacherName,
          ...(actor?.id ? { markedByUserId: actor.id } : {}),
        });
      } catch (saveErr: any) {
        warnings.push(`${studentInfo.name}: ${saveErr?.message}`);
        continue;
      }
      savedCount++;
      if (attended) presentCount++; else absentCount++;
      if (saved.token.warning) warnings.push(`${studentInfo.name}: ${saved.token.warning}`);

      // Email to the student's own address (no placeholder addresses)
      const studentEmail = entry.studentEmail || studentInfo.email;
      if (studentEmail && !String(studentEmail).toLowerCase().endsWith("@topgrade.edu")) {
        const emailSubject = `Attendance: ${sessionQr.courseName} (${attended ? "Present" : "Absent"})`;
        const emailMessage =
          `Dear ${studentInfo.name},\n\nYour attendance for the class '${sessionQr.courseName}' was recorded.\n\n` +
          `• Course: ${sessionQr.courseName}\n` +
          `• Day and time: ${sessionQr.dayOfWeek || "Today"} (${sessionQr.slotName || "Scheduled session"})\n` +
          `• Status: ${status}\n` +
          `• Date: ${todayDate}\n` +
          (entry.notes ? `• Teacher's note: ${entry.notes}\n` : "") +
          `\nIf you have questions, please contact your teacher or the institute.`;
        dispatchMultiChannelNotification({
          eventType: "ATTENDANCE_ALERT",
          subject: emailSubject,
          message: emailMessage,
          escapeMessage: true,
          recipients: [{ role: "STUDENT", email: studentEmail, name: studentInfo.name }]
        }).catch(err => console.warn(`Student attendance email notice for ${studentEmail}:`, err));
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
}
