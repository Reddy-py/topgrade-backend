import { attendanceStore, type AttendanceRecord } from "./attendanceService.js";
import { studentCourseBalancesStore } from "./courseHoursService.js";
import { dispatchMultiChannelNotification } from "./notificationService.js";
import { inMemoryStudentStore } from "./studentService.js";

export interface ClassSessionQRRecord {
  id: string;
  classSessionId: string;
  courseId: string;
  courseName: string;
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
    status: "PRESENT" | "ABSENT" | "LATE";
    notes?: string | undefined;
  }>;
}

// Scheduled Teacher Class Sessions Store with Time-Gating (Live only, 0 demo sessions initially)
export const classSessionQrStore: ClassSessionQRRecord[] = [];

/**
 * Automatically generates attendance session records and QR codes whenever a course with a weekly schedule is created or updated.
 */
export function autoGenerateAttendanceSessionsForCourse(course: any) {
  if (!course || !course.id) return;

  // Remove existing sessions for this course
  for (let i = classSessionQrStore.length - 1; i >= 0; i--) {
    if (classSessionQrStore[i]?.courseId === course.id) {
      classSessionQrStore.splice(i, 1);
    }
  }

  const schedule = Array.isArray(course.schedule) ? course.schedule : [];
  schedule.forEach((slot: any, idx: number) => {
    const teacherId = slot.teacherId || course.assigned_teachers?.[0]?.teacherId || "tch-1";
    const teacherName = slot.teacherName || course.assigned_teachers?.[0]?.name || "manikanta";
    const day = slot.day || "Monday";
    const slotName = slot.slot || "09:00 AM - 10:30 AM";

    const sessionRecord: ClassSessionQRRecord = {
      id: `sqr-${course.id}-${slot.id || idx + 1}`,
      classSessionId: `sess-${course.id}-${day.toLowerCase()}-${idx + 1}`,
      courseId: course.id,
      courseName: course.name,
      teacherId,
      teacherName,
      startTime: new Date().toISOString(), // Unlocked for immediate operational marking
      endTime: new Date(Date.now() + 86400000 * 30).toISOString(),
      graceMinutes: 30,
      qrToken: `TG-SESSION-${course.course_code || course.id}-${day.substring(0, 3).toUpperCase()}-${idx + 1}`,
      isExpired: false,
      dayOfWeek: day,
      slotName: slotName,
      room: slot.room || "Lab 1",
      programTrack: slot.programTrack || "Academic Session",
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
   * Check Time-Gated Status for Class Session QR
   */
  public static checkSessionQrTimeGate(sessionQr: ClassSessionQRRecord, customScanTimeIso?: string) {
    const now = customScanTimeIso ? new Date(customScanTimeIso) : new Date();
    const startTime = new Date(sessionQr.startTime);
    const graceExpiryTime = new Date(startTime.getTime() + sessionQr.graceMinutes * 60000);

    if (now < startTime) {
      return {
        isUnlocked: false,
        statusBadgeText: `🔒 QR Locked — Unlocks at ${startTime.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })} on Scheduled Date`,
        reason: "TOO_EARLY"
      };
    }

    if (now > graceExpiryTime && sessionQr.isExpired) {
      return {
        isUnlocked: false,
        statusBadgeText: `⚠️ Check-in Expired (Passed ${sessionQr.graceMinutes}-min grace window)`,
        reason: "EXPIRED"
      };
    }

    return {
      isUnlocked: true,
      statusBadgeText: `🔓 QR Active & Unlocked`,
      reason: "ACTIVE"
    };
  }

  public static generateSessionQrToken(input: {
    classSessionId: string;
    courseId: string;
    courseName: string;
    teacherId: string;
    teacherName: string;
    dayOfWeek?: string;
    slotName?: string;
    startTimeIso?: string;
    endTimeIso?: string;
    graceMinutes?: number;
  }) {
    const nowIso = new Date().toISOString();
    const startTime = input.startTimeIso || nowIso;
    const endTime = input.endTimeIso || new Date(Date.now() + 7200000).toISOString();
    const graceMinutes = input.graceMinutes || 15;

    const qrToken = `TG-SESSION-${input.classSessionId}-${Date.now()}`;

    const sessionQr: ClassSessionQRRecord = {
      id: `sqr-${Date.now()}`,
      classSessionId: input.classSessionId,
      courseId: input.courseId,
      courseName: input.courseName,
      teacherId: input.teacherId,
      teacherName: input.teacherName,
      startTime,
      endTime,
      graceMinutes,
      qrToken,
      isExpired: false,
      dayOfWeek: input.dayOfWeek || "Monday",
      slotName: input.slotName || "Morning",
      createdAt: nowIso
    };

    const idx = classSessionQrStore.findIndex(s => s.classSessionId === input.classSessionId);
    if (idx >= 0) {
      classSessionQrStore[idx] = sessionQr;
    } else {
      classSessionQrStore.push(sessionQr);
    }

    return sessionQr;
  }

  public static getSessionRoster(classSessionId: string) {
    const sessionQr = classSessionQrStore.find(s => s.classSessionId === classSessionId) || classSessionQrStore[0];

    const roster = inMemoryStudentStore.map(s => {
      const balObj = studentCourseBalancesStore.find(b => b.studentId === s.id);
      return {
        studentId: s.id,
        fullName: s.fullName,
        studentCode: s.studentCode || `TG-STU-${s.id}`,
        email: s.email,
        parentEmail: s.parentEmails?.[0] || s.email,
        parentPhone: s.parentPhones?.[0] || s.primaryMobile || "",
        fatherName: s.fatherName || s.parentFirstName || "Parent",
        availableHours: balObj ? balObj.availableHours : 20,
        grade: s.grade || "Grade 8",
        status: s.status || "ACTIVE"
      };
    });

    return {
      sessionQr: sessionQr || {
        classSessionId,
        courseId: "crs-active",
        courseName: "Scheduled Academic Class",
        teacherName: "manikanta",
        startTime: new Date().toISOString(),
        qrToken: `TG-SESSION-${classSessionId}`,
        isExpired: false
      },
      timeGate: sessionQr ? this.checkSessionQrTimeGate(sessionQr) : { isUnlocked: true, statusBadgeText: "🔓 QR Active & Unlocked", reason: "ACTIVE" },
      studentsCount: roster.length,
      roster
    };
  }

  public static async submitTeacherSessionAttendance(input: TeacherSessionSubmitInput) {
    const { classSessionId, teacherId, entries } = input;
    const nowIso = new Date().toISOString();

    const sessionQr = classSessionQrStore.find(s => s.classSessionId === classSessionId) || {
      id: "sqr-temp",
      classSessionId,
      courseId: "crs-auto",
      courseName: "Class Session",
      teacherId: teacherId || "tch-1",
      teacherName: "manikanta",
      startTime: nowIso,
      endTime: nowIso,
      graceMinutes: 15,
      qrToken: `TG-SESSION-${classSessionId}`,
      isExpired: false,
      createdAt: nowIso
    };

    let presentCount = 0;
    let absentCount = 0;
    const createdRecords: AttendanceRecord[] = [];
    const auditDeductionLogs: string[] = [];

    for (const entry of entries) {
      const isAttended = entry.status === "PRESENT" || entry.status === "LATE";
      if (isAttended) presentCount++;
      else absentCount++;

      const studentMeta = inMemoryStudentStore.find(s => s.id === entry.studentId) || {
        studentCode: `TG-STU-${entry.studentId}`,
        parentEmails: ["parent@topgrade.edu"],
        parentPhones: [""],
        fatherName: "Parent"
      };

      const record: AttendanceRecord = {
        id: `att-${Date.now()}-${Math.floor(Math.random() * 1000)}`,
        studentId: entry.studentId,
        studentName: entry.studentName,
        studentCode: studentMeta.studentCode || `TG-STU-${entry.studentId}`,
        courseId: sessionQr.courseId,
        courseName: sessionQr.courseName,
        parentEmail: studentMeta.parentEmails?.[0] || "parent@topgrade.edu",
        parentPhone: studentMeta.parentPhones?.[0] || "",
        parentName: studentMeta.fatherName || "Parent",
        checkInTime: isAttended ? nowIso : undefined,
        status: entry.status,
        scanMethod: "TEACHER_BATCH",
        date: nowIso.slice(0, 10),
        notes: entry.notes || `Submitted by instructor ${sessionQr.teacherName}`,
        createdAt: nowIso
      };

      attendanceStore.unshift(record);
      createdRecords.push(record);

      let updatedHours = 20;
      const balObj = studentCourseBalancesStore.find(b => b.studentId === entry.studentId);

      if (isAttended) {
        if (balObj) {
          balObj.usedHours += 1;
          balObj.availableHours = Math.max(0, balObj.availableHours - 1);
          balObj.updatedAt = nowIso;
          updatedHours = balObj.availableHours;
        }
        auditDeductionLogs.push(`• ${entry.studentName}: 1 Hour Credit Deducted (Remaining: ${updatedHours} hrs)`);
      } else {
        if (balObj) updatedHours = balObj.availableHours;
        auditDeductionLogs.push(`• ${entry.studentName}: Marked ABSENT (Credit Balance: ${updatedHours} hrs)`);
      }

      const adminEmail = process.env.GMAIL_USER || "sivareddy683970@gmail.com";
      dispatchMultiChannelNotification({
        eventType: "ATTENDANCE_ALERT",
        subject: `🔔 Attendance Update — ${sessionQr.courseName}`,
        message: `Dear ${entry.studentName},\n\nYour attendance for '${sessionQr.courseName}' on ${nowIso.slice(0, 10)} has been logged as [${entry.status}].\n\nRemaining Prepaid Class Hours: ${updatedHours}\n\nBest Regards,\nTopGrade Learning Administration`,
        recipients: [
          { role: "STUDENT", email: adminEmail, name: entry.studentName }
        ]
      }).catch(err => console.warn("Student email note:", err));

      dispatchMultiChannelNotification({
        eventType: "ATTENDANCE_ALERT",
        subject: `🔔 Parent Notification: ${entry.studentName}'s Class Attendance (${entry.status})`,
        message: `Dear Parent,\n\nThis is an automated notification regarding ${entry.studentName}.\n\nCourse: ${sessionQr.courseName}\nStatus: ${entry.status}\nDate: ${nowIso.slice(0, 10)}\nUpdated Prepaid Session Balance: ${updatedHours} Sessions Remaining\n\nBest Regards,\nTopGrade Learning Administration`,
        recipients: [
          { role: "PARENT", email: adminEmail, name: `Parent of ${entry.studentName}` }
        ]
      }).catch(err => console.warn("Parent email note:", err));
    }

    const adminEmail = process.env.GMAIL_USER || "sivareddy683970@gmail.com";
    dispatchMultiChannelNotification({
      eventType: "ATTENDANCE_ALERT",
      subject: `📋 Teacher Session Summary — ${sessionQr.courseName}`,
      message: `Dear ${sessionQr.teacherName},\n\nYou have successfully completed and submitted attendance for '${sessionQr.courseName}'.\n\nDate: ${nowIso.slice(0, 10)}\nTotal Roster Submitted: ${entries.length}\nTotal Present: ${presentCount}\nTotal Absent: ${absentCount}\n\nRoster Breakdown:\n${entries.map(e => `• ${e.studentName}: ${e.status}`).join('\n')}\n\nThank you,\nTopGrade CRM Engine`,
      recipients: [
        { role: "TEACHER", email: adminEmail, name: sessionQr.teacherName }
      ]
    }).catch(err => console.warn("Teacher summary email note:", err));

    dispatchMultiChannelNotification({
      eventType: "ATTENDANCE_ALERT",
      subject: `💳 Accountant Audit & Credit Deduction Ledger — ${sessionQr.courseName}`,
      message: `Attention: Finance & Accounting Department (accountant@topgrade.edu),\n\nClass Session Attendance Submitted & Ledger Hour Credits Settled.\n\nCourse: ${sessionQr.courseName}\nTeacher: ${sessionQr.teacherName}\nDate: ${nowIso.slice(0, 10)}\nTotal Credits Settled: ${presentCount} Paid Hours Deducted\n\nDetailed Audit Logs:\n${auditDeductionLogs.join('\n')}\n\nTopGrade Financial System`,
      recipients: [
        { role: "ACCOUNTANT", email: adminEmail, name: "Accountant" }
      ]
    }).catch(err => console.warn("Accountant email note:", err));

    sessionQr.isExpired = true;

    return {
      success: true,
      message: `Attendance submitted & multi-channel notifications dispatched successfully!`,
      processedCount: entries.length,
      presentCount,
      absentCount,
      emailsDispatchedCount: (entries.length * 2) + 2
    };
  }

  public static async processStudentSelfScan(input: StudentSelfScanInput) {
    const { studentId, qrToken, customScanTimeIso } = input;
    const scanTime = customScanTimeIso ? new Date(customScanTimeIso) : new Date();

    const sessionQr = classSessionQrStore.find(s => s.qrToken === qrToken);
    if (!sessionQr) {
      throw {
        code: "INVALID_SESSION_TOKEN",
        message: "Invalid or unrecognized class session QR code token."
      };
    }

    const timeGateCheck = this.checkSessionQrTimeGate(sessionQr, customScanTimeIso);
    if (!timeGateCheck.isUnlocked) {
      throw {
        code: "EXPIRED_SESSION_WINDOW",
        message: timeGateCheck.statusBadgeText
      };
    }

    const studentInfo = inMemoryStudentStore.find(s => s.id === studentId || s.studentCode === studentId) || {
      id: studentId,
      studentCode: "TG-STU-2026",
      fullName: "Student",
      email: "student@topgrade.edu",
      fatherName: "Parent",
      parentEmails: ["parent@topgrade.edu"],
      parentPhones: [""]
    };

    const existingLog = attendanceStore.find(
      r => r.studentId === studentId && r.courseId === sessionQr.courseId && r.date === scanTime.toISOString().slice(0, 10)
    );

    if (existingLog) {
      return {
        alreadyScanned: true,
        message: `Self Check-in already verified for ${studentInfo.fullName} today at ${existingLog.checkInTime?.slice(11, 19)}`,
        record: existingLog
      };
    }

    const record: AttendanceRecord = {
      id: `att-self-${Date.now()}`,
      studentId,
      studentName: studentInfo.fullName,
      studentCode: studentInfo.studentCode || `TG-STU-${studentId}`,
      courseId: sessionQr.courseId,
      courseName: sessionQr.courseName,
      parentEmail: studentInfo.parentEmails?.[0] || "parent@topgrade.edu",
      parentPhone: studentInfo.parentPhones?.[0] || "",
      parentName: studentInfo.fatherName || "Parent",
      checkInTime: scanTime.toISOString(),
      status: "PRESENT",
      scanMethod: "STUDENT_SELF_QR",
      date: scanTime.toISOString().slice(0, 10),
      notes: `Student self-scanned QR at class start`,
      createdAt: scanTime.toISOString()
    };

    attendanceStore.unshift(record);

    let updatedHours = 20;
    const balObj = studentCourseBalancesStore.find(b => b.studentId === studentId);
    if (balObj) {
      balObj.usedHours += 1;
      balObj.availableHours = Math.max(0, balObj.availableHours - 1);
      balObj.updatedAt = scanTime.toISOString();
      updatedHours = balObj.availableHours;
    }

    const adminEmail = process.env.GMAIL_USER || "sivareddy683970@gmail.com";
    dispatchMultiChannelNotification({
      eventType: "ATTENDANCE_ALERT",
      subject: `🔔 Self-Scan Check-In: ${studentInfo.fullName}`,
      message: `Dear Parent,\n\n${studentInfo.fullName} has successfully self-scanned into '${sessionQr.courseName}' at ${scanTime.toLocaleTimeString()}.\n\nRemaining Prepaid Hours: ${updatedHours}\n\nTopGrade Learning Administration`,
      recipients: [
        { role: "PARENT", email: adminEmail, name: `Parent of ${studentInfo.fullName}` }
      ]
    }).catch(err => console.warn("Scan notification note:", err));

    return {
      success: true,
      message: `🎉 Check-in verified for ${studentInfo.fullName} in '${sessionQr.courseName}'!`,
      record,
      remainingHours: updatedHours
    };
  }
}
