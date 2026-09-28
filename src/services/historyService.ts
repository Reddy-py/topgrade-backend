import { inMemoryStudentStore } from "./studentService.js";
import { inMemoryTeachers } from "../routes/teachers.js";
import { inMemoryCourses } from "../routes/courses.js";
import { attendanceStore } from "./attendanceService.js";
import { inMemoryPayments } from "../routes/fees.js";
import { dispatchMultiChannelNotification } from "./notificationService.js";

export interface TutoringPastRecord {
  id: string;
  studentId: string;
  studentName: string;
  studentCode: string;
  subject: string;
  teacherName: string;
  termPeriod: string; // e.g. "Spring 2026", "Jan 2026 - Mar 2026"
  totalHoursCompleted: number;
  totalSessionsAttended: number;
  finalScorePercentage: number;
  curriculumMilestones: string[];
  status: "Completed" | "Terminated" | "Extended";
  reenrollmentEligible: boolean;
  reenrollmentStatus: "Pending Invitation" | "Invite Sent" | "Re-enrolled" | "Declined";
  completionDate: string;
}

export interface AfterschoolPastRecord {
  id: string;
  studentId: string;
  studentName: string;
  studentCode: string;
  programName: string;
  gradeLevel: string;
  termPeriod: string;
  attendanceConsistencyRate: number; // e.g. 96%
  activitiesCompleted: string[];
  certificateIssued: boolean;
  certificateUrl?: string;
  retentionRecommendation: "High Potential Re-enroll" | "Standard Followup" | "Schedule Assessment";
  status: "Completed" | "Discontinued";
  endDate: string;
}

export interface StudentLifecycleEvent {
  id: string;
  studentId: string;
  studentName: string;
  studentCode: string;
  eventType: "ADMISSION" | "COURSE_ENROLLMENT" | "GRADE_PROMOTION" | "STATUS_CHANGE" | "PAYMENT_RECORD" | "PARENT_COMMUNICATION";
  title: string;
  description: string;
  timestamp: string;
  actor: string;
}

// In-Memory Storage for Historical Records (Cleaned of mock demo data)
export const tutoringPastStore: TutoringPastRecord[] = [];

export const afterschoolPastStore: AfterschoolPastRecord[] = [];

export class HistoryService {
  /**
   * 1. Retrieve Overview Metrics for Retention & Re-enrollment
   */
  public static getHistoryOverview() {
    const totalTutoringPast = tutoringPastStore.length;
    const totalAfterschoolPast = afterschoolPastStore.length;
    const totalCompletedStudents = new Set([
      ...tutoringPastStore.map(t => t.studentId),
      ...afterschoolPastStore.map(a => a.studentId)
    ]).size;

    const reenrollmentOpportunities = tutoringPastStore.filter(t => t.reenrollmentEligible && t.reenrollmentStatus !== "Re-enrolled").length +
      afterschoolPastStore.filter(a => a.retentionRecommendation === "High Potential Re-enroll").length;

    return {
      totalTutoringPast,
      totalAfterschoolPast,
      totalCompletedStudents,
      reenrollmentOpportunities,
      totalStudentsEnrolled: inMemoryStudentStore.length,
      retentionRatePercentage: 92
    };
  }

  /**
   * 2. Retrieve Tutoring Past Logs
   */
  public static getTutoringPast(studentId?: string) {
    if (studentId) {
      return tutoringPastStore.filter(t => t.studentId === studentId);
    }
    return tutoringPastStore;
  }

  /**
   * 3. Retrieve Afterschool Past Logs
   */
  public static getAfterschoolPast(studentId?: string) {
    if (studentId) {
      return afterschoolPastStore.filter(a => a.studentId === studentId);
    }
    return afterschoolPastStore;
  }

  /**
   * 4. Retrieve Longitudinal Student History Timeline
   */
  public static getStudentHistoryTimeline(studentId?: string): StudentLifecycleEvent[] {
    const timeline: StudentLifecycleEvent[] = [];

    const students = studentId 
      ? inMemoryStudentStore.filter(s => s.id === studentId)
      : inMemoryStudentStore;

    students.forEach(s => {
      const sid = s.id || `std-${Math.random()}`;
      // 1. Admission Event
      timeline.push({
        id: `event-adm-${sid}`,
        studentId: sid,
        studentName: s.fullName,
        studentCode: s.studentCode || `TG-STU-${sid}`,
        eventType: "ADMISSION",
        title: "Student Admitted & Profile Created",
        description: `Enrolled into TopGrade Learning system with Grade: ${s.grade || 'General'} from ${s.school || 'Academic Institution'}.`,
        timestamp: s.createdAt || "2026-08-24T09:55:00.000Z",
        actor: "Admin (manikanata)"
      });

      // 2. Status Event
      timeline.push({
        id: `event-stat-${sid}`,
        studentId: sid,
        studentName: s.fullName,
        studentCode: s.studentCode || `TG-STU-${sid}`,
        eventType: "STATUS_CHANGE",
        title: "Active Status Confirmed",
        description: `Student dossier verified with Emergency Contact: ${s.fatherName || 'Parent'} (${(s as any).primaryMobile || 'Provided'}).`,
        timestamp: s.updatedAt || new Date().toISOString(),
        actor: "System Administrator"
      });
    });

    // 3. Attendance Events
    attendanceStore.slice(0, 10).forEach((att, idx) => {
      timeline.push({
        id: `event-att-${att.id || idx}`,
        studentId: att.studentId,
        studentName: att.studentName,
        studentCode: att.studentCode,
        eventType: "COURSE_ENROLLMENT",
        title: `Class Attendance Logged (${att.status})`,
        description: `Verified attendance check for ${att.courseName} via ${att.scanMethod}.`,
        timestamp: att.createdAt || new Date().toISOString(),
        actor: "Faculty Instructor (manikanta)"
      });
    });

    return timeline.sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime());
  }

  /**
   * 5. Retrieve Payment Audit History
   */
  public static getPaymentHistory(studentId?: string) {
    let list = inMemoryPayments || [];
    if (studentId) {
      list = list.filter((p: any) => p.studentId === studentId);
    }
    return list;
  }

  /**
   * 6. Retrieve Attendance History with Analytics
   */
  public static getAttendanceHistory(studentId?: string) {
    let list = attendanceStore;
    if (studentId) {
      list = list.filter(a => a.studentId === studentId);
    }
    return list;
  }

  /**
   * 7. Trigger Re-Enrollment & Retention Campaign Invitation
   */
  public static async triggerReenrollmentInvite(input: {
    recordId: string;
    studentId: string;
    studentName: string;
    programType: "TUTORING" | "AFTERSCHOOL";
    offerDiscountCode?: string;
    customNote?: string;
  }) {
    const student = inMemoryStudentStore.find(s => s.id === input.studentId);
    const targetEmail = student?.email || "sivareddy68397@gmail.com";
    const discount = input.offerDiscountCode || "RE-ENROLL-15";

    if (input.programType === "TUTORING") {
      const rec = tutoringPastStore.find(t => t.id === input.recordId);
      if (rec) {
        rec.reenrollmentStatus = "Invite Sent";
      }
    }

    const adminEmail = process.env.ADMIN_EMAIL || process.env.GMAIL_SENDER_EMAIL || "tglbiz101@gmail.com";

    // Dispatch Re-enrollment Invitation Email
    await dispatchMultiChannelNotification({
      eventType: "ADMISSION_APPROVED",
      subject: `🎓 Exclusive Re-Enrollment Invitation for ${input.studentName} — TopGrade Learning`,
      message: `Dear ${input.studentName} and Parents,\n\nWe are delighted to invite you to re-enroll for our upcoming advanced academic term.\n\nBecause of ${input.studentName}'s outstanding progress in our past ${input.programType.toLowerCase()} program, we have reserved your priority seat with an exclusive re-enrollment discount.\n\nUse Promo Code: [${discount}] for 15% OFF tuition.\n\n${input.customNote || "We look forward to continuing your academic excellence journey!"}\n\nBest Regards,\nTopGrade Learning Administration`,
      recipients: [
        { role: "STUDENT", email: targetEmail, name: input.studentName },
        { role: "ADMIN", email: adminEmail, name: "Administrator" }
      ]
    });

    return {
      success: true,
      message: `Re-enrollment invitation successfully dispatched to ${input.studentName} (${targetEmail}) with code ${discount}.`
    };
  }
}
