import { dispatchMultiChannelNotification } from "./notificationService.js";
import { studentCourseBalancesStore } from "./courseHoursService.js";

export type AttendanceStatusEnum = "PRESENT" | "ABSENT" | "LATE" | "EXCUSED";
export type ScanMethodEnum = "QR_CODE_SCANNER" | "MANUAL_MARKING" | "TEACHER_BATCH" | "STUDENT_SELF_QR";

export interface AttendanceRecord {
  id: string;
  studentId: string;
  studentName: string;
  studentCode: string;
  courseId: string;
  courseName: string;
  parentEmail?: string | undefined;
  parentPhone?: string | undefined;
  parentName?: string | undefined;
  checkInTime?: string | undefined;
  checkOutTime?: string | undefined;
  status: AttendanceStatusEnum;
  scanMethod: ScanMethodEnum;
  date: string; // YYYY-MM-DD
  notes?: string | undefined;
  createdAt: string;
}

export interface QrScanInput {
  studentQrCode: string; // e.g. "std-qr-rahul" or "TG-2026-9081"
  courseId?: string | undefined;
  scanMethod?: ScanMethodEnum | undefined;
}

export interface BatchAttendanceInput {
  courseId: string;
  date: string;
  entries: Array<{
    studentId: string;
    studentName: string;
    status: AttendanceStatusEnum;
    notes?: string | undefined;
  }>;
}

// Default Seed Students for QR Mapping
export const studentProfilesMap: Record<string, any> = {
  "TG-2026-9081": {
    studentId: "std-demo-1",
    studentName: "Rahul Kumar",
    studentCode: "TG-2026-9081",
    studentEmail: "rahul.k@topgrade.edu",
    parentEmail: "parent@topgrade.edu",
    parentPhone: "",
    parentName: "Rajesh Kumar",
    courseId: "crs-sec-103",
    courseName: "Full-Stack Coding & Web Dev"
  },
  "std-qr-rahul": {
    studentId: "std-demo-1",
    studentName: "Rahul Kumar",
    studentCode: "TG-2026-9081",
    studentEmail: "rahul.k@topgrade.edu",
    parentEmail: "parent@topgrade.edu",
    parentPhone: "",
    parentName: "Rajesh Kumar",
    courseId: "crs-sec-103",
    courseName: "Full-Stack Coding & Web Dev"
  },
  "TG-2026-9082": {
    studentId: "std-demo-2",
    studentName: "Ananya Sharma",
    studentCode: "TG-2026-9082",
    studentEmail: "ananya.s@topgrade.edu",
    parentEmail: "parent@topgrade.edu",
    parentPhone: "",
    parentName: "Suresh Sharma",
    courseId: "crs-elem-102",
    courseName: "Primary Math & Logic Track"
  },
  "std-qr-ananya": {
    studentId: "std-demo-2",
    studentName: "Ananya Sharma",
    studentCode: "TG-2026-9082",
    studentEmail: "ananya.s@topgrade.edu",
    parentEmail: "parent@topgrade.edu",
    parentPhone: "",
    parentName: "Suresh Sharma",
    courseId: "crs-elem-102",
    courseName: "Primary Math & Logic Track"
  }
};

// In-Memory store for fast execution & fallback
export const attendanceStore: AttendanceRecord[] = [
  {
    id: "att-101",
    studentId: "std-demo-1",
    studentName: "Rahul Kumar",
    studentCode: "TG-2026-9081",
    courseId: "crs-sec-103",
    courseName: "Full-Stack Coding & Web Dev",
    parentEmail: "parent@topgrade.edu",
    parentName: "Rajesh Kumar",
    checkInTime: new Date(Date.now() - 86400000).toISOString(),
    checkOutTime: new Date(Date.now() - 79200000).toISOString(),
    status: "PRESENT",
    scanMethod: "QR_CODE_SCANNER",
    date: new Date(Date.now() - 86400000).toISOString().slice(0, 10),
    createdAt: new Date(Date.now() - 86400000).toISOString()
  },
  {
    id: "att-102",
    studentId: "std-demo-2",
    studentName: "Ananya Sharma",
    studentCode: "TG-2026-9082",
    courseId: "crs-elem-102",
    courseName: "Primary Math & Logic Track",
    parentEmail: "parent@topgrade.edu",
    parentName: "Suresh Sharma",
    checkInTime: new Date(Date.now() - 172800000).toISOString(),
    status: "ABSENT",
    scanMethod: "TEACHER_BATCH",
    date: new Date(Date.now() - 172800000).toISOString().slice(0, 10),
    createdAt: new Date(Date.now() - 172800000).toISOString()
  },
  {
    id: "att-103",
    studentId: "std-demo-2",
    studentName: "Ananya Sharma",
    studentCode: "TG-2026-9082",
    courseId: "crs-elem-102",
    courseName: "Primary Math & Logic Track",
    parentEmail: "parent@topgrade.edu",
    parentName: "Suresh Sharma",
    checkInTime: new Date(Date.now() - 259200000).toISOString(),
    status: "ABSENT",
    scanMethod: "TEACHER_BATCH",
    date: new Date(Date.now() - 259200000).toISOString().slice(0, 10),
    createdAt: new Date(Date.now() - 259200000).toISOString()
  },
  {
    id: "att-104",
    studentId: "std-demo-2",
    studentName: "Ananya Sharma",
    studentCode: "TG-2026-9082",
    courseId: "crs-elem-102",
    courseName: "Primary Math & Logic Track",
    parentEmail: "parent@topgrade.edu",
    parentName: "Suresh Sharma",
    checkInTime: new Date(Date.now() - 345600000).toISOString(),
    status: "PRESENT",
    scanMethod: "QR_CODE_SCANNER",
    date: new Date(Date.now() - 345600000).toISOString().slice(0, 10),
    createdAt: new Date(Date.now() - 345600000).toISOString()
  }
];

export class AttendanceService {
  /**
   * 1. Process QR Code Scanner Check-In & Check-Out Workflow
   */
  public static async scanQrCodeCheckInCheckOut(input: QrScanInput) {
    const rawQr = (input.studentQrCode || "").trim();
    const studentInfo = studentProfilesMap[rawQr] || studentProfilesMap["TG-2026-9081"];

    const todayStr = new Date().toISOString().slice(0, 10);
    const nowIso = new Date().toISOString();

    // Check if student already checked IN today without check out
    const openRecord = attendanceStore.find(
      r => r.studentId === studentInfo.studentId && r.date === todayStr && !r.checkOutTime
    );

    const adminEmail = process.env.GMAIL_USER || "sivareddy683970@gmail.com";
    const parentEmail = studentInfo.parentEmail || adminEmail;

    if (openRecord) {
      // Execute Check-Out
      openRecord.checkOutTime = nowIso;

      // Dispatch Departure Parent Alert
      dispatchMultiChannelNotification({
        eventType: "ATTENDANCE_ALERT",
        subject: `🔔 TopGrade Attendance Alert — Check-OUT Confirmed (${studentInfo.studentName})`,
        message: `Dear ${studentInfo.parentName || "Parent"},\n\nThis is an automated notification confirming that ${studentInfo.studentName} has checked OUT at ${new Date(nowIso).toLocaleTimeString()}.\n\nCourse: ${studentInfo.courseName}\nDate: ${todayStr}\n\nBest Regards,\nTopGrade Learning Administration`,
        recipients: [
          { role: "PARENT", email: parentEmail, name: studentInfo.parentName || "Parent" },
          { role: "ADMIN", email: adminEmail, name: "Administrator" }
        ]
      }).catch(err => console.warn("Check-out parent notification note:", err));

      return {
        action: "CHECK_OUT",
        message: `Check-OUT logged for '${studentInfo.studentName}' at ${new Date(nowIso).toLocaleTimeString()}`,
        record: openRecord,
        parentNotificationSent: true
      };
    }

    // Execute Check-In
    const newRecord: AttendanceRecord = {
      id: `att-${Date.now()}`,
      studentId: studentInfo.studentId,
      studentName: studentInfo.studentName,
      studentCode: studentInfo.studentCode,
      courseId: input.courseId || studentInfo.courseId,
      courseName: studentInfo.courseName,
      parentEmail: studentInfo.parentEmail,
      parentPhone: studentInfo.parentPhone,
      parentName: studentInfo.parentName,
      checkInTime: nowIso,
      status: "PRESENT",
      scanMethod: input.scanMethod || "QR_CODE_SCANNER",
      date: todayStr,
      createdAt: nowIso
    };

    attendanceStore.unshift(newRecord);

    // Decrement 1 Paid Class Credit Hour from StudentCourseBalance
    const balanceObj = studentCourseBalancesStore.find(
      b => b.studentId === studentInfo.studentId
    );
    if (balanceObj) {
      balanceObj.usedHours += 1;
      balanceObj.availableHours = Math.max(0, balanceObj.availableHours - 1);
      balanceObj.updatedAt = nowIso;
      if (balanceObj.availableHours <= 2) {
        balanceObj.quotaWarningTriggered = true;
        balanceObj.teacherWarningMessage = `⚠️ Quota Warning: Student '${studentInfo.studentName}' has only ${balanceObj.availableHours} session(s) remaining!`;
      }
    }

    // Dispatch Arrival Parent Alert
    dispatchMultiChannelNotification({
      eventType: "ATTENDANCE_ALERT",
      subject: `🔔 TopGrade Attendance Alert — Check-IN Confirmed (${studentInfo.studentName})`,
      message: `Dear ${studentInfo.parentName || "Parent"},\n\nThis is an automated notification confirming that ${studentInfo.studentName} has checked IN at ${new Date(nowIso).toLocaleTimeString()}.\n\nCourse: ${studentInfo.courseName}\nPaid Sessions Remaining: ${balanceObj ? balanceObj.availableHours : "Active"}\nDate: ${todayStr}\n\nBest Regards,\nTopGrade Learning Administration`,
      recipients: [
        { role: "PARENT", email: parentEmail, name: studentInfo.parentName || "Parent" },
        { role: "ADMIN", email: adminEmail, name: "Administrator" }
      ]
    }).catch(err => console.warn("Check-in parent notification note:", err));

    return {
      action: "CHECK_IN",
      message: `Check-IN logged for '${studentInfo.studentName}' at ${new Date(nowIso).toLocaleTimeString()}`,
      record: newRecord,
      remainingHours: balanceObj ? balanceObj.availableHours : undefined,
      parentNotificationSent: true
    };
  }

  /**
   * 2. Batch Attendance Marking by Teacher Roster
   */
  public static async markBatchAttendance(input: BatchAttendanceInput) {
    const nowIso = new Date().toISOString();
    const createdRecords: AttendanceRecord[] = [];

    for (const entry of input.entries) {
      const studentInfo = Object.values(studentProfilesMap).find(s => s.studentId === entry.studentId) || {
        studentId: entry.studentId,
        studentName: entry.studentName,
        studentCode: `TG-${Date.now()}`,
        parentEmail: "parent@topgrade.edu",
        parentName: "Parent",
        courseId: input.courseId,
        courseName: "Academic Class"
      };

      const record: AttendanceRecord = {
        id: `att-batch-${Date.now()}-${Math.floor(Math.random() * 1000)}`,
        studentId: entry.studentId,
        studentName: entry.studentName,
        studentCode: studentInfo.studentCode,
        courseId: input.courseId,
        courseName: studentInfo.courseName,
        parentEmail: studentInfo.parentEmail,
        parentName: studentInfo.parentName,
        checkInTime: entry.status === "PRESENT" || entry.status === "LATE" ? nowIso : undefined,
        status: entry.status,
        scanMethod: "TEACHER_BATCH",
        date: input.date || nowIso.slice(0, 10),
        notes: entry.notes,
        createdAt: nowIso
      };

      attendanceStore.unshift(record);
      createdRecords.push(record);

      // Decrement prepaid hours if PRESENT or LATE
      if (entry.status === "PRESENT" || entry.status === "LATE") {
        const balanceObj = studentCourseBalancesStore.find(b => b.studentId === entry.studentId);
        if (balanceObj) {
          balanceObj.usedHours += 1;
          balanceObj.availableHours = Math.max(0, balanceObj.availableHours - 1);
          balanceObj.updatedAt = nowIso;
        }
      }
    }

    return {
      success: true,
      count: createdRecords.length,
      records: createdRecords
    };
  }

  /**
   * 3. Calculate Attendance Stats & Low Attendance Analytics (< 75% Risk Trigger)
   */
  public static getStudentAttendanceStats(studentId: string, thresholdPercent = 75) {
    const logs = attendanceStore.filter(r => r.studentId === studentId);
    const totalSessions = logs.length;

    if (totalSessions === 0) {
      return {
        studentId,
        totalSessions: 0,
        presentCount: 0,
        absentCount: 0,
        lateCount: 0,
        excusedCount: 0,
        attendancePercent: 100,
        lowAttendanceWarning: false,
        warningMessage: undefined,
        logs: []
      };
    }

    const presentCount = logs.filter(r => r.status === "PRESENT").length;
    const lateCount = logs.filter(r => r.status === "LATE").length;
    const absentCount = logs.filter(r => r.status === "ABSENT").length;
    const excusedCount = logs.filter(r => r.status === "EXCUSED").length;

    // Weight: Present & Late count as attended
    const attendedCount = presentCount + lateCount;
    const attendancePercent = Math.round((attendedCount / totalSessions) * 100);

    const isLowAttendance = attendancePercent < thresholdPercent;

    return {
      studentId,
      studentName: logs[0]?.studentName || "Student",
      totalSessions,
      presentCount,
      absentCount,
      lateCount,
      excusedCount,
      attendancePercent,
      lowAttendanceWarning: isLowAttendance,
      warningMessage: isLowAttendance
        ? `⚠️ Low Attendance Risk Warning: Student attendance is ${attendancePercent}% (Below ${thresholdPercent}% threshold).`
        : undefined,
      logs
    };
  }
}
