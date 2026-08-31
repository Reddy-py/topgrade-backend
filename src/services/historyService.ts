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

// In-Memory Storage for Historical Records
export const tutoringPastStore: TutoringPastRecord[] = [
  {
    id: "tut-hist-1",
    studentId: "std-1787565325848-825",
    studentName: "Siva Reddy",
    studentCode: "TG-STU-2026-3632",
    subject: "Advanced Mathematics & Coding Foundations",
    teacherName: "manikanta",
    termPeriod: "Jan 2026 - Apr 2026 (Winter Term)",
    totalHoursCompleted: 36,
    totalSessionsAttended: 24,
    finalScorePercentage: 94,
    curriculumMilestones: [
      "Algebraic Functions & Quadratics",
      "Python Data Structures & Syntax",
      "Problem Solving & Algorithm Design"
    ],
    status: "Completed",
    reenrollmentEligible: true,
    reenrollmentStatus: "Pending Invitation",
    completionDate: "2026-04-20"
  },
  {
    id: "tut-hist-2",
    studentId: "std-1787569238941-822",
    studentName: "rajesh ganta",
    studentCode: "TG-STU-2026-4231",
    subject: "Middle School Science & Robotics Basics",
    teacherName: "manikanta",
    termPeriod: "Feb 2026 - May 2026 (Spring Term)",
    totalHoursCompleted: 28,
    totalSessionsAttended: 18,
    finalScorePercentage: 88,
    curriculumMilestones: [
      "Physical Sciences & Mechanics",
      "Introductory Circuitry & Sensors",
      "Robotics Control Logic"
    ],
    status: "Completed",
    reenrollmentEligible: true,
    reenrollmentStatus: "Pending Invitation",
    completionDate: "2026-05-15"
  }
];

export const afterschoolPastStore: AfterschoolPastRecord[] = [
  {
    id: "aft-hist-1",
    studentId: "std-1787565325848-825",
    studentName: "Siva Reddy",
    studentCode: "TG-STU-2026-3632",
    programName: "STEM & Robotics Innovation Club",
    gradeLevel: "Grade 9",
    termPeriod: "Winter Session 2026",
    attendanceConsistencyRate: 98,
    activitiesCompleted: [
      "Autonomous Rover Navigation",
      "Logic Puzzles & Algorithmic Games",
      "Science Fair Project Showcase"
    ],
    certificateIssued: true,
    retentionRecommendation: "High Potential Re-enroll",
    status: "Completed",
    endDate: "2026-04-30"
  },
  {
    id: "aft-hist-2",
    studentId: "std-1787569238941-822",
    studentName: "rajesh ganta",
    studentCode: "TG-STU-2026-4231",
    programName: "Creative Logic & Junior Web Builders",
    gradeLevel: "Grade 8",
    termPeriod: "Spring Session 2026",
    attendanceConsistencyRate: 92,
    activitiesCompleted: [
      "Interactive Web Stories (HTML/CSS)",
      "Math Olympiad Preparation",
      "Creative Design & Typing Speed Labs"
    ],
    certificateIssued: true,
    retentionRecommendation: "High Potential Re-enroll",
    status: "Completed",
    endDate: "2026-05-30"
  }
];

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
    const defaultHistory = [
      {
        id: "pay-hist-1",
        studentId: "std-1787565325848-825",
        studentName: "Siva Reddy",
        studentCode: "TG-STU-2026-3632",
        invoiceNumber: "INV-2026-0089",
        amountPaid: 450.00,
        totalInvoiceAmount: 450.00,
        paymentMode: "Online Transfer (UPI/Card)",
        transactionRef: "TXN_789423610",
        paymentDate: "2026-08-24",
        status: "COMPLETED",
        notes: "Fall Academic Term Tuition Package (Settled in full)"
      },
      {
        id: "pay-hist-2",
        studentId: "std-1787569238941-822",
        studentName: "rajesh ganta",
        studentCode: "TG-STU-2026-4231",
        invoiceNumber: "INV-2026-0094",
        amountPaid: 350.00,
        totalInvoiceAmount: 350.00,
        paymentMode: "Direct Card / Terminal",
        transactionRef: "TXN_987123441",
        paymentDate: "2026-08-24",
        status: "COMPLETED",
        notes: "Middle School STEM & Robotics Lab Fee"
      }
    ];

    let list = inMemoryPayments.length > 0 ? inMemoryPayments : defaultHistory;
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
    const targetEmail = student?.email || "sivareddy683970@gmail.com";
    const discount = input.offerDiscountCode || "RE-ENROLL-15";

    if (input.programType === "TUTORING") {
      const rec = tutoringPastStore.find(t => t.id === input.recordId);
      if (rec) {
        rec.reenrollmentStatus = "Invite Sent";
      }
    }

    const adminEmail = process.env.GMAIL_USER || "sivareddy683970@gmail.com";

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
