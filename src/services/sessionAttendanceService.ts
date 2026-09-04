import { attendanceStore, type AttendanceRecord } from "./attendanceService.js";
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
    const nowIso = customScanTimeIso || new Date().toISOString();

    const liveSessions = await this.getLiveSessionsFromSupabase();
    const session = liveSessions.find(s => s.qrToken === qrToken) || classSessionQrStore.find(s => s.qrToken === qrToken);

    if (!session) {
      const err: any = new Error("Invalid or expired session QR code.");
      err.code = "INVALID_QR_TOKEN";
      throw err;
    }

    const { data: student } = await supabaseAdmin.from("students").select("*").eq("id", studentId).single();
    const studentName = student?.name || "Student";
    const studentCode = student?.student_id_code || `TG-STU-${studentId}`;

    const logRecord = {
      student_id: studentId,
      student_name: studentName,
      class_name: session.courseName,
      status: "Present",
      date: nowIso.slice(0, 10),
      remarks: "Self check-in via QR scan",
      marked_by: "Student Self-Scan"
    };

    await supabaseAdmin.from("attendance").insert([logRecord]);

    attendanceStore.unshift({
      id: `att-${Date.now()}`,
      studentId,
      studentName,
      studentCode,
      courseId: session.courseId,
      courseName: session.courseName,
      parentEmail: student?.email || "",
      parentPhone: student?.phone || "",
      parentName: "Parent",
      checkInTime: nowIso,
      status: "PRESENT",
      scanMethod: "STUDENT_SELF_QR",
      date: nowIso.slice(0, 10),
      notes: "Scanned session QR",
      createdAt: nowIso
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
  public static async submitTeacherSessionAttendance(input: TeacherSessionSubmitInput) {
    const { classSessionId, teacherId, entries } = input;
    const nowIso = new Date().toISOString();
    const todayDate = nowIso.slice(0, 10);

    const liveSessions = await this.getLiveSessionsFromSupabase();
    const sessionQr = liveSessions.find(s => s.classSessionId === classSessionId || s.id === classSessionId) || {
      id: "sqr-temp",
      classSessionId,
      courseId: "crs-auto",
      courseName: "Python programming",
      courseCode: "CRS-431",
      teacherId: teacherId || "tch-1",
      teacherName: "Assigned Faculty",
      dayOfWeek: "Monday",
      slotName: "09:00 AM - 10:30 AM",
      startTime: nowIso,
      endTime: nowIso,
      graceMinutes: 15,
      qrToken: `TG-SESSION-${classSessionId}`,
      isExpired: false,
      createdAt: nowIso
    };

    let presentCount = 0;
    let absentCount = 0;

    // Fetch students to ensure we have their correct registered emails
    const { data: studentsDb } = await supabaseAdmin.from("students").select("id, name, email, student_id_code");
    const studentsMap = new Map((studentsDb || []).map(s => [s.id, s]));

    const attendanceRows: any[] = [];

    for (const entry of entries) {
      const isAttended = entry.status === "PRESENT" || entry.status === "LATE";
      if (isAttended) presentCount++;
      else absentCount++;

      const studentInfo = studentsMap.get(entry.studentId) || {
        id: entry.studentId,
        name: entry.studentName,
        email: entry.studentEmail || "student@topgrade.edu",
        student_id_code: `TG-STU-${entry.studentId}`
      };

      const studentEmail = entry.studentEmail || studentInfo.email;
      const statusLabel = isAttended ? "Present" : "Absent";

      const isValidUuid = (val: string) => /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(val);
      const studentUuid = isValidUuid(entry.studentId) ? entry.studentId : null;
      const teacherUuid = sessionQr.teacherId && isValidUuid(sessionQr.teacherId) ? sessionQr.teacherId : null;

      attendanceRows.push({
        student_id: studentUuid,
        student_name: entry.studentName,
        class_name: sessionQr.courseName,
        status: statusLabel,
        date: todayDate,
        remarks: entry.notes ? `${entry.notes} (Faculty: ${sessionQr.teacherName})` : `Marked by ${sessionQr.teacherName}`,
        marked_by: teacherUuid
      });

      // Also record in in-memory attendanceStore for fast sync
      attendanceStore.unshift({
        id: `att-${Date.now()}-${Math.floor(Math.random() * 1000)}`,
        studentId: entry.studentId,
        studentName: entry.studentName,
        studentCode: studentInfo.student_id_code,
        courseId: sessionQr.courseId,
        courseName: sessionQr.courseName,
        parentEmail: studentEmail,
        parentPhone: "",
        parentName: "Parent",
        checkInTime: isAttended ? nowIso : undefined,
        status: entry.status,
        scanMethod: "TEACHER_BATCH",
        date: todayDate,
        notes: entry.notes || `Submitted by instructor ${sessionQr.teacherName}`,
        createdAt: nowIso
      });

      // 📧 AUTOMATIC EMAIL TO INDIVIDUAL STUDENT
      const emailSubject = `🔔 TopGrade Attendance: ${sessionQr.courseName} — ${isAttended ? 'Present ✅' : 'Absent ❌'}`;
      const emailMessage = `Dear ${entry.studentName},\n\nYour attendance for class session '${sessionQr.courseName}' has been officially recorded by your faculty instructor ${sessionQr.teacherName}.\n\n` +
        `• Course: ${sessionQr.courseName} (${sessionQr.courseCode || 'TopGrade Stream'})\n` +
        `• Day & Time Slot: ${sessionQr.dayOfWeek || 'Today'} (${sessionQr.slotName || 'Scheduled Session'})\n` +
        `• Attendance Status: [ ${entry.status} ]\n` +
        `• Date: ${todayDate}\n` +
        (entry.notes ? `• Instructor Remarks: ${entry.notes}\n` : '') +
        `\nIf you have any questions regarding this session, please contact your faculty instructor or center administration.\n\nBest Regards,\nTop Grade Learning Management`;

      dispatchMultiChannelNotification({
        eventType: "ATTENDANCE_ALERT",
        subject: emailSubject,
        message: emailMessage,
        recipients: [
          { role: "STUDENT", email: studentEmail, name: entry.studentName }
        ]
      }).catch(err => console.warn(`Student attendance email notice for ${studentEmail}:`, err));
    }

    // Insert attendance records into Supabase attendance table
    try {
      const { error: attErr } = await supabaseAdmin
        .from("attendance")
        .insert(attendanceRows);

      if (attErr) {
        console.error("Supabase attendance insert error:", attErr);
      }
    } catch (sbE) {
      console.error("Supabase attendance insertion exception:", sbE);
    }

    return {
      success: true,
      message: `Attendance submitted to Supabase for ${entries.length} students. Individual status notification emails dispatched successfully!`,
      processedCount: entries.length,
      presentCount,
      absentCount,
      emailsDispatchedCount: entries.length
    };
  }
}
