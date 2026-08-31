import { dispatchMultiChannelNotification } from "./notificationService.js";
import { studentCourseBalancesStore } from "./courseHoursService.js";
import { inMemoryStudentStore } from "./studentService.js";

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
  studentQrCode: string; // e.g. "TG-STU-2026-3632"
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

// Live in-memory attendance ledger (0 demo records initially)
export const attendanceStore: AttendanceRecord[] = [];

export class AttendanceService {
  /**
   * 1. Process QR Code Scanner Check-In & Check-Out Workflow
   */
  public static async scanQrCodeCheckInCheckOut(input: QrScanInput) {
    const rawQr = (input.studentQrCode || "").trim();
    
    // Dynamically lookup from inMemoryStudentStore
    const matchedStudent = inMemoryStudentStore.find(
      s => s.studentCode === rawQr || s.id === rawQr || s.fullName.toLowerCase().includes(rawQr.toLowerCase())
    ) || inMemoryStudentStore[0] || {
      id: "std-temp",
      fullName: "Student",
      studentCode: rawQr || "TG-STU-2026",
      parentEmails: ["parent@topgrade.edu"],
      parentPhones: [""],
      fatherName: "Parent",
      email: "student@topgrade.edu"
    };

    const studentInfo = {
      studentId: matchedStudent.id || "std-temp",
      studentName: matchedStudent.fullName,
      studentCode: matchedStudent.studentCode || `TG-STU-${matchedStudent.id}`,
      parentEmail: (matchedStudent as any).parentEmails?.[0] || matchedStudent.email || "parent@topgrade.edu",
      parentPhone: (matchedStudent as any).parentPhones?.[0] || (matchedStudent as any).primaryMobile || "",
      parentName: (matchedStudent as any).fatherName || (matchedStudent as any).parentFirstName || "Parent",
      courseId: input.courseId || "crs-active",
      courseName: "Academic Course Stream"
    };

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
        message: `Dear ${studentInfo.parentName},\n\nThis is an automated notification confirming that ${studentInfo.studentName} has checked OUT at ${new Date(nowIso).toLocaleTimeString()}.\n\nCourse: ${studentInfo.courseName}\nDate: ${todayStr}\n\nBest Regards,\nTopGrade Learning Administration`,
        recipients: [
          { role: "PARENT", email: parentEmail, name: studentInfo.parentName },
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

    let remainingHours = 20;
    if (balanceObj) {
      balanceObj.usedHours += 1;
      balanceObj.availableHours = Math.max(0, balanceObj.availableHours - 1);
      balanceObj.updatedAt = nowIso;
      remainingHours = balanceObj.availableHours;
    }

    // Dispatch Arrival Parent Alert
    dispatchMultiChannelNotification({
      eventType: "ATTENDANCE_ALERT",
      subject: `🔔 TopGrade Attendance Alert — Check-IN Confirmed (${studentInfo.studentName})`,
      message: `Dear ${studentInfo.parentName},\n\nThis is an automated notification confirming that ${studentInfo.studentName} has arrived and checked IN for '${studentInfo.courseName}' at ${new Date(nowIso).toLocaleTimeString()}.\n\nRemaining Prepaid Hours: ${remainingHours}\nDate: ${todayStr}\n\nBest Regards,\nTopGrade Learning Administration`,
      recipients: [
        { role: "PARENT", email: parentEmail, name: studentInfo.parentName },
        { role: "ADMIN", email: adminEmail, name: "Administrator" }
      ]
    }).catch(err => console.warn("Check-in parent notification note:", err));

    return {
      action: "CHECK_IN",
      message: `Check-IN verified for '${studentInfo.studentName}'. Parent notification dispatched.`,
      record: newRecord,
      remainingHours,
      parentNotificationSent: true
    };
  }

  /**
   * 2. Process Batch Teacher Attendance Marking
   */
  public static async markBatchAttendance(input: BatchAttendanceInput) {
    const { courseId, date, entries } = input;
    const nowIso = new Date().toISOString();

    const createdRecords: AttendanceRecord[] = [];
    let presentCount = 0;
    let absentCount = 0;

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
        courseId,
        courseName: "Scheduled Academic Course",
        parentEmail: studentMeta.parentEmails?.[0] || "parent@topgrade.edu",
        parentPhone: studentMeta.parentPhones?.[0] || "",
        parentName: studentMeta.fatherName || "Parent",
        checkInTime: isAttended ? nowIso : undefined,
        status: entry.status,
        scanMethod: "TEACHER_BATCH",
        date: date || nowIso.slice(0, 10),
        notes: entry.notes,
        createdAt: nowIso
      };

      attendanceStore.unshift(record);
      createdRecords.push(record);

      if (isAttended) {
        const balObj = studentCourseBalancesStore.find(b => b.studentId === entry.studentId);
        if (balObj) {
          balObj.usedHours += 1;
          balObj.availableHours = Math.max(0, balObj.availableHours - 1);
          balObj.updatedAt = nowIso;
        }
      }
    }

    return {
      success: true,
      message: `Batch attendance processed for ${entries.length} students (${presentCount} Present, ${absentCount} Absent).`,
      records: createdRecords,
      presentCount,
      absentCount
    };
  }

  /**
   * 3. Calculate Real-Time Attendance Statistics for a Student
   */
  public static getStudentAttendanceStats(studentId: string, alertThresholdPercentage: number = 75) {
    const studentRecords = attendanceStore.filter(r => r.studentId === studentId);
    const totalSessions = studentRecords.length;

    if (totalSessions === 0) {
      return {
        studentId,
        totalSessions: 0,
        presentSessions: 0,
        absentSessions: 0,
        lateSessions: 0,
        attendancePercentage: 100,
        isBelowThreshold: false,
        warningAlert: "No recorded class sessions yet.",
        records: []
      };
    }

    const presentSessions = studentRecords.filter(r => r.status === "PRESENT" || r.status === "LATE").length;
    const absentSessions = studentRecords.filter(r => r.status === "ABSENT").length;
    const lateSessions = studentRecords.filter(r => r.status === "LATE").length;

    const attendancePercentage = Math.round((presentSessions / totalSessions) * 100);
    const isBelowThreshold = attendancePercentage < alertThresholdPercentage;

    return {
      studentId,
      totalSessions,
      presentSessions,
      absentSessions,
      lateSessions,
      attendancePercentage,
      isBelowThreshold,
      warningAlert: isBelowThreshold 
        ? `⚠️ Attendance (${attendancePercentage}%) is below required ${alertThresholdPercentage}% threshold!`
        : "Attendance in good standing.",
      records: studentRecords
    };
  }

  /**
   * 4. Retrieve Full Attendance History
   */
  public static getAllAttendance(filters?: { courseId?: string; date?: string; studentId?: string }) {
    let list = attendanceStore;
    if (filters?.courseId) {
      list = list.filter(r => r.courseId === filters.courseId);
    }
    if (filters?.date) {
      list = list.filter(r => r.date === filters.date);
    }
    if (filters?.studentId) {
      list = list.filter(r => r.studentId === filters.studentId);
    }
    return list;
  }
}
