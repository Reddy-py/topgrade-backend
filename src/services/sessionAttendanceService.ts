import { attendanceStore, type AttendanceRecord } from "./attendanceService.js";
import { studentCourseBalancesStore } from "./courseHoursService.js";
import { dispatchMultiChannelNotification } from "./notificationService.js";
import { demoStudentsPool } from "./demoDataService.js";

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

// Scheduled Teacher Class Sessions Store with Time-Gating
export const classSessionQrStore: ClassSessionQRRecord[] = [
  {
    id: "sqr-101",
    classSessionId: "sess-physics-101",
    courseId: "crs-sec-103",
    courseName: "AP Physics & Mechanics Lab",
    teacherId: "tchr-demo-1",
    teacherName: "Dr. Rajesh Verma",
    startTime: new Date().toISOString(), // Unlocked Now
    endTime: new Date(Date.now() + 7200000).toISOString(),
    graceMinutes: 15,
    qrToken: "TG-SESSION-sess-physics-101-LIVE",
    isExpired: false,
    createdAt: new Date().toISOString()
  },
  {
    id: "sqr-102",
    classSessionId: "sess-robotics-102",
    courseId: "crs-demo-136",
    courseName: "Robotics & Autonomous Rovers Lab",
    teacherId: "tchr-demo-3",
    teacherName: "David Miller",
    startTime: new Date(Date.now() + 3600000).toISOString(), // Unlocks in 1 hour
    endTime: new Date(Date.now() + 10800000).toISOString(),
    graceMinutes: 15,
    qrToken: "TG-SESSION-sess-robotics-102-LOCKED",
    isExpired: false,
    createdAt: new Date().toISOString()
  },
  {
    id: "sqr-103",
    classSessionId: "sess-aiml-103",
    courseId: "crs-demo-137",
    courseName: "Artificial Intelligence & Machine Learning (AIML)",
    teacherId: "tchr-demo-5",
    teacherName: "Michael Brown",
    startTime: new Date(Date.now() + 7200000).toISOString(), // Unlocks in 2 hours
    endTime: new Date(Date.now() + 14400000).toISOString(),
    graceMinutes: 15,
    qrToken: "TG-SESSION-sess-aiml-103-LOCKED",
    isExpired: false,
    createdAt: new Date().toISOString()
  }
];

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

    if (now > graceExpiryTime) {
      return {
        isUnlocked: false,
        statusBadgeText: `⚠️ Check-in Expired (Passed ${sessionQr.graceMinutes}-min grace window)`,
        reason: "EXPIRED"
      };
    }

    return {
      isUnlocked: true,
      statusBadgeText: `🔓 QR Active & Unlocked (Grace window closes at ${graceExpiryTime.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })})`,
      reason: "ACTIVE"
    };
  }

  public static generateSessionQrToken(input: {
    classSessionId: string;
    courseId: string;
    courseName: string;
    teacherId: string;
    teacherName: string;
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
    const defaultSession = classSessionQrStore[0]!;
    const sessionQr = classSessionQrStore.find(s => s.classSessionId === classSessionId) || defaultSession;

    const rosterSource = demoStudentsPool.length > 0 ? demoStudentsPool : [
      {
        id: "std-demo-1",
        fullName: "Rahul Kumar",
        studentCode: "TG-2026-9081",
        email: "rahul.k@student.topgrade.edu",
        parentEmail: "parent@topgrade.edu",
        parentPhone: "+1-555-TOP-GRADE",
        fatherName: "Rajesh Kumar",
        availableHours: 34
      },
      {
        id: "std-demo-2",
        fullName: "Ananya Sharma",
        studentCode: "TG-2026-9082",
        email: "ananya.s@student.topgrade.edu",
        parentEmail: "parent@topgrade.edu",
        parentPhone: "+1-555-TOP-GRADE",
        fatherName: "Suresh Sharma",
        availableHours: 20
      }
    ];

    const timeGateStatus = this.checkSessionQrTimeGate(sessionQr);

    const enrolledRoster = rosterSource.slice(0, 10).map(s => {
      const balObj = studentCourseBalancesStore.find(b => b.studentId === s.id);
      return {
        studentId: s.id,
        fullName: s.fullName,
        studentCode: s.studentCode,
        studentEmail: s.email,
        parentEmail: s.parentEmail,
        parentName: s.fatherName,
        availableHours: balObj ? balObj.availableHours : (s.availableHours || 20)
      };
    });

    return {
      classSessionId: sessionQr.classSessionId,
      courseId: sessionQr.courseId,
      courseName: sessionQr.courseName,
      teacherId: sessionQr.teacherId,
      teacherName: sessionQr.teacherName,
      startTime: sessionQr.startTime,
      endTime: sessionQr.endTime,
      isExpired: sessionQr.isExpired,
      timeGateStatus,
      enrolledRoster
    };
  }

  public static async submitTeacherSessionAttendance(input: TeacherSessionSubmitInput) {
    const { classSessionId, entries } = input;
    const nowIso = new Date().toISOString();

    const defaultSession = classSessionQrStore[0]!;
    const sessionQr = classSessionQrStore.find(s => s.classSessionId === classSessionId) || defaultSession;

    const createdRecords: AttendanceRecord[] = [];
    const auditDeductionLogs: string[] = [];

    let presentCount = 0;
    let absentCount = 0;

    for (const entry of entries) {
      const isAttended = entry.status === "PRESENT" || entry.status === "LATE";
      if (isAttended) presentCount++;
      else absentCount++;

      const record: AttendanceRecord = {
        id: `att-tchr-${Date.now()}-${Math.floor(Math.random() * 1000)}`,
        studentId: entry.studentId,
        studentName: entry.studentName,
        studentCode: `TG-2026-${entry.studentId}`,
        courseId: sessionQr.courseId,
        courseName: sessionQr.courseName,
        parentEmail: "parent@topgrade.edu",
        parentName: "Parent",
        checkInTime: isAttended ? nowIso : undefined,
        status: entry.status as any,
        scanMethod: "TEACHER_BATCH",
        date: nowIso.slice(0, 10),
        notes: entry.notes,
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
        auditDeductionLogs.push(`• ${entry.studentName}: Marked ABSENT (Credit Balance Untouched: ${updatedHours} hrs)`);
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
      message: `Attendance submitted & 4-party email notifications dispatched successfully!`,
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

    const studentInfo = demoStudentsPool.find(s => s.id === studentId) || {
      id: studentId,
      studentCode: "TG-2026-9081",
      fullName: "Aarav Sharma",
      email: "aarav.sharma@student.topgrade.edu",
      fatherName: "Rajesh Sharma",
      parentEmail: "parent@topgrade.edu",
      parentPhone: "+1-555-TOP-GRADE"
    };

    const existingLog = attendanceStore.find(
      r => r.studentId === studentId && r.courseId === sessionQr.courseId && r.date === scanTime.toISOString().slice(0, 10)
    );

    if (existingLog) {
      throw {
        code: "ALREADY_CHECKED_IN",
        message: `⚠️ Already Checked In: You have already logged attendance for ${sessionQr.courseName} today.`
      };
    }

    const newRecord: AttendanceRecord = {
      id: `att-self-${Date.now()}`,
      studentId: studentInfo.id,
      studentName: studentInfo.fullName,
      studentCode: studentInfo.studentCode,
      courseId: sessionQr.courseId,
      courseName: sessionQr.courseName,
      parentEmail: studentInfo.parentEmail,
      parentPhone: studentInfo.parentPhone,
      parentName: studentInfo.fatherName,
      checkInTime: scanTime.toISOString(),
      status: "PRESENT",
      scanMethod: "STUDENT_SELF_QR",
      date: scanTime.toISOString().slice(0, 10),
      createdAt: scanTime.toISOString()
    };

    attendanceStore.unshift(newRecord);

    const balanceObj = studentCourseBalancesStore.find(b => b.studentId === studentId);
    if (balanceObj) {
      balanceObj.usedHours += 1;
      balanceObj.availableHours = Math.max(0, balanceObj.availableHours - 1);
      balanceObj.updatedAt = scanTime.toISOString();
    }

    const adminEmail = process.env.GMAIL_USER || "sivareddy683970@gmail.com";
    const parentEmail = studentInfo.parentEmail || adminEmail;

    dispatchMultiChannelNotification({
      eventType: "ATTENDANCE_ALERT",
      subject: `🔔 TopGrade Class QR Alert — ${studentInfo.fullName} Checked IN`,
      message: `Dear ${studentInfo.fatherName || "Parent"},\n\nYour child ${studentInfo.fullName} has successfully self-scanned and checked IN for class session '${sessionQr.courseName}'.\n\nCheck-In Time: ${scanTime.toLocaleTimeString()}\nTeacher: ${sessionQr.teacherName}\nRemaining Sessions: ${balanceObj ? balanceObj.availableHours : "Active"}\n\nBest Regards,\nTopGrade Learning Administration`,
      recipients: [
        { role: "PARENT", email: parentEmail, name: studentInfo.fatherName || "Parent" },
        { role: "ADMIN", email: adminEmail, name: "Administrator" }
      ]
    }).catch(err => console.warn("Self scan parent notification note:", err));

    return {
      success: true,
      action: "STUDENT_SELF_CHECK_IN",
      message: `Checked IN successfully for '${sessionQr.courseName}' at ${scanTime.toLocaleTimeString()}`,
      record: newRecord,
      remainingHours: balanceObj ? balanceObj.availableHours : undefined
    };
  }

  public static getLiveSessionRoster(classSessionId: string) {
    const defaultSession = classSessionQrStore[0]!;
    const sessionQr = classSessionQrStore.find(s => s.classSessionId === classSessionId) || defaultSession;
    const todayStr = new Date().toISOString().slice(0, 10);

    const timeGateCheck = this.checkSessionQrTimeGate(sessionQr);

    const presentLogs = attendanceStore.filter(
      r => r.courseId === sessionQr.courseId && r.date === todayStr
    );

    return {
      classSessionId: sessionQr.classSessionId,
      courseId: sessionQr.courseId,
      courseName: sessionQr.courseName,
      teacherName: sessionQr.teacherName,
      qrToken: sessionQr.qrToken,
      startTime: sessionQr.startTime,
      endTime: sessionQr.endTime,
      graceMinutes: sessionQr.graceMinutes,
      timeGateStatus: timeGateCheck,
      totalEnrolledCount: 20,
      totalPresentCount: presentLogs.length,
      liveCheckInFeed: presentLogs
    };
  }
}
