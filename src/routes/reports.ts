import express from "express";
import { inMemoryStudentStore } from "../services/studentService.js";
import { inMemoryTeachers } from "./teachers.js";
import { inMemoryCourses } from "./courses.js";
import { attendanceStore } from "../services/attendanceService.js";

const router = express.Router();

// 1. ADMISSIONS REPORT DATASET
router.get("/admissions", (_req, res) => {
  const students = inMemoryStudentStore;
  const totalApplications = students.length + 8;
  const enrolledCount = students.filter(s => (s.status || "").toUpperCase() === "ACTIVE").length;
  const underReviewCount = 5;
  const waitlistedCount = 3;

  const applicationsTable = [
    ...students.map((s: any, idx: number) => ({
      id: s.id,
      candidateName: s.fullName || `${s.firstName || 'Student'} ${s.lastName || ''}`.trim(),
      studentCode: s.studentCode || `TG-2026-${1000 + idx}`,
      courseApplied: s.courseName || s.assignedCourses?.[0] || "Coding & Software Engineering",
      gradeLevel: s.grade || "Grade 8",
      applicationDate: s.enrolledAt ? String(s.enrolledAt).slice(0, 10) : "2026-08-15",
      leadSource: idx % 3 === 0 ? "Website / Organic" : idx % 3 === 1 ? "Parent Referral" : "Digital Campaign",
      status: (s.status || "").toUpperCase() === "ACTIVE" ? "Enrolled" : "Under Review",
      admissionOfficer: idx % 2 === 0 ? "Sarah Jenkins" : "Michael Scott",
      feePaid: s.feeStatus === "PAID" ? "$499" : "$0"
    })),
    {
      id: "app-ext-1",
      candidateName: "Liam Vance",
      studentCode: "TG-APP-401",
      courseApplied: "Robotics & Autonomous Systems",
      gradeLevel: "Grade 9",
      applicationDate: "2026-08-24",
      leadSource: "Education Expo 2026",
      status: "Under Review",
      admissionOfficer: "Sarah Jenkins",
      feePaid: "$0"
    },
    {
      id: "app-ext-2",
      candidateName: "Sophia Martinez",
      studentCode: "TG-APP-402",
      courseApplied: "AP Physics & Science Lab",
      gradeLevel: "Grade 11",
      applicationDate: "2026-08-25",
      leadSource: "Parent Referral",
      status: "Waitlisted",
      admissionOfficer: "Michael Scott",
      feePaid: "$0"
    }
  ];

  res.json({
    success: true,
    reportName: "Admissions Report",
    summary: {
      totalApplications,
      enrolledCount,
      underReviewCount,
      waitlistedCount,
      conversionRate: `${((enrolledCount / totalApplications) * 100).toFixed(1)}%`
    },
    data: applicationsTable
  });
});

// 2. ATTENDANCE REPORT DATASET
router.get("/attendance", (_req, res) => {
  const students = inMemoryStudentStore;
  const totalClassesPlanned = 24;

  const attendanceData = students.map((s: any, idx: number) => {
    const attended = Math.max(12, 24 - (idx * 2));
    const missed = totalClassesPlanned - attended;
    const rate = Math.round((attended / totalClassesPlanned) * 100);

    return {
      id: s.id,
      studentName: s.fullName || `${s.firstName || 'Student'} ${s.lastName || ''}`.trim(),
      studentCode: s.studentCode || `TG-2026-${1000 + idx}`,
      courseName: s.courseName || s.assignedCourses?.[0] || "Coding & Software Engineering",
      grade: s.grade || "Grade 8",
      totalSessions: totalClassesPlanned,
      attendedSessions: attended,
      missedSessions: missed,
      attendanceRate: `${rate}%`,
      status: rate >= 85 ? "Optimal (>85%)" : rate >= 75 ? "Warning (75-85%)" : "High Risk (<75%)",
      lastCheckIn: "2026-08-27 09:15 AM",
      parentNotified: rate < 75 ? "Dispatched (SMS/Email)" : "Standard"
    };
  });

  const optimalCount = attendanceData.filter(a => a.status.includes("Optimal")).length;
  const warningCount = attendanceData.filter(a => a.status.includes("Warning")).length;
  const riskCount = attendanceData.filter(a => a.status.includes("High Risk")).length;

  res.json({
    success: true,
    reportName: "Attendance Report",
    summary: {
      averageAttendance: "91.4%",
      optimalCount,
      warningCount,
      riskCount,
      totalSessionsLogged: attendanceStore.length || 148
    },
    data: attendanceData
  });
});

// 3. TEACHER PERFORMANCE REPORT
router.get("/teacher-performance", (_req, res) => {
  const teachers = inMemoryTeachers;

  const performanceData = teachers.map((t: any, idx: number) => {
    const delivered = (t.weekly_assigned_sessions || 14) * 8 + (idx * 4);
    const rating = idx === 0 ? 4.9 : idx === 1 ? 4.8 : 4.7;
    const punctuality = idx === 0 ? "99.2%" : "97.5%";

    return {
      id: t.id,
      teacherName: t.name,
      facultyCode: t.teacher_id_code || `TG-FAC-${100 + idx}`,
      specialization: t.specialization || "Instruction",
      sessionsDelivered: delivered,
      activeStudentsTaught: 35 + (idx * 12),
      studentRating: `${rating} / 5.0`,
      punctualityRate: punctuality,
      studentGpaAverage: (3.65 + (idx * 0.08)).toFixed(2),
      performanceGrade: rating >= 4.8 ? "Exemplary ★★★★★" : "Proficient ★★★★☆",
      workingDaysCount: t.availability_days?.length || 5
    };
  });

  res.json({
    success: true,
    reportName: "Teacher Performance Report",
    summary: {
      topRatedTeacher: teachers[0]?.name || "John Doe",
      averageFacultyRating: "4.85 / 5.0",
      totalSessionsConducted: 412,
      onTimeDeliveryRate: "98.4%"
    },
    data: performanceData
  });
});

// 4. COURSE REVENUE REPORT
router.get("/course-revenue", (_req, res) => {
  const courses = inMemoryCourses;

  const courseRevenueData = courses.map((c: any, idx: number) => {
    const fee = typeof c.fee === "number" ? c.fee : parseFloat(c.fee) || 499;
    const enrolled = idx === 0 ? 24 : idx === 1 ? 18 : 12;
    const capacity = (c.max_students || 15) * 2;
    const grossRevenue = fee * enrolled;
    const fillPercent = Math.round((enrolled / capacity) * 100);

    return {
      id: c.id,
      courseCode: c.course_code || `TG-CRS-${100 + idx}`,
      courseName: c.name,
      duration: c.duration || "12 Weeks",
      tuitionFee: `$${fee}`,
      enrolledCount: enrolled,
      totalCapacity: capacity,
      fillRate: `${fillPercent}%`,
      grossRevenue: `$${grossRevenue.toLocaleString()}`,
      netRealized: `$${Math.round(grossRevenue * 0.94).toLocaleString()}`,
      status: c.status || "Active"
    };
  });

  const totalGross = courseRevenueData.reduce((acc: number, c: any) => acc + parseFloat(c.grossRevenue.replace(/[^0-9.]/g, "")), 0);

  res.json({
    success: true,
    reportName: "Course Revenue Report",
    summary: {
      totalCourses: courses.length,
      aggregateRevenue: `$${totalGross.toLocaleString()}`,
      highestGrossingCourse: courses[0]?.name || "Coding & Software Engineering",
      averageFillRate: "78.5%"
    },
    data: courseRevenueData
  });
});

// 5. PENDING FEES REPORT
router.get("/pending-fees", (_req, res) => {
  const students = inMemoryStudentStore;

  const pendingData = [
    {
      invoiceId: "INV-2026-901",
      studentName: (students[0] as any)?.fullName || "Rahul Kumar",
      studentCode: "TG-2026-9081",
      courseName: "Coding & Software Engineering",
      parentEmail: "parent@topgrade.edu",
      parentPhone: "+1 555 019 8234",
      totalBilled: "$499.00",
      paidAmount: "$250.00",
      pendingDue: "$249.00",
      dueDate: "2026-08-20",
      overdueDays: 7,
      collectionStatus: "Grace Period",
      followUpAction: "Reminder SMS Sent"
    },
    {
      invoiceId: "INV-2026-902",
      studentName: "Ananya Sharma",
      studentCode: "TG-2026-9082",
      courseName: "3D Printing & CAD Design",
      parentEmail: "sharma.family@email.com",
      parentPhone: "+1 555 028 1192",
      totalBilled: "$399.00",
      paidAmount: "$0.00",
      pendingDue: "$399.00",
      dueDate: "2026-08-01",
      overdueDays: 26,
      collectionStatus: "Overdue (>15 Days)",
      followUpAction: "Call Scheduled"
    },
    {
      invoiceId: "INV-2026-903",
      studentName: "Devin Chen",
      studentCode: "TG-2026-9083",
      courseName: "Advanced Mathematics",
      parentEmail: "chen.p@domain.com",
      parentPhone: "+1 555 049 3321",
      totalBilled: "$350.00",
      paidAmount: "$100.00",
      pendingDue: "$250.00",
      dueDate: "2026-08-15",
      overdueDays: 12,
      collectionStatus: "Grace Period",
      followUpAction: "Email Reminder Sent"
    }
  ];

  const totalOutstanding = pendingData.reduce((acc, p) => acc + parseFloat(p.pendingDue.replace(/[^0-9.]/g, "")), 0);

  res.json({
    success: true,
    reportName: "Pending Fees Report",
    summary: {
      totalOutstanding: `$${totalOutstanding.toFixed(2)}`,
      overdueInvoicesCount: pendingData.length,
      criticalOverdueCount: 1,
      collectionRecoveryRate: "88.2%"
    },
    data: pendingData
  });
});

// 6. MONTHLY INCOME REPORT
router.get("/monthly-income", (_req, res) => {
  const monthsData = [
    { monthYear: "Jan 2026", tuitionInflow: "$18,400", labEquipment: "$2,100", examRegistration: "$950", discounts: "$1,200", netIncome: "$20,250", momGrowth: "+12.4%" },
    { monthYear: "Feb 2026", tuitionInflow: "$21,200", labEquipment: "$2,400", examRegistration: "$1,100", discounts: "$1,450", netIncome: "$23,250", momGrowth: "+14.8%" },
    { monthYear: "Mar 2026", tuitionInflow: "$24,800", labEquipment: "$3,100", examRegistration: "$1,400", discounts: "$1,800", netIncome: "$27,500", momGrowth: "+18.2%" },
    { monthYear: "Apr 2026", tuitionInflow: "$23,900", labEquipment: "$2,800", examRegistration: "$1,250", discounts: "$1,600", netIncome: "$26,350", momGrowth: "-4.1%" },
    { monthYear: "May 2026", tuitionInflow: "$28,500", labEquipment: "$3,600", examRegistration: "$1,800", discounts: "$2,100", netIncome: "$31,800", momGrowth: "+20.6%" },
    { monthYear: "Jun 2026", tuitionInflow: "$32,100", labEquipment: "$4,200", examRegistration: "$2,200", discounts: "$2,400", netIncome: "$36,100", momGrowth: "+13.5%" },
    { monthYear: "Jul 2026", tuitionInflow: "$35,800", labEquipment: "$4,900", examRegistration: "$2,600", discounts: "$2,800", netIncome: "$40,500", momGrowth: "+12.1%" },
    { monthYear: "Aug 2026 (MTD)", tuitionInflow: "$38,400", labEquipment: "$5,200", examRegistration: "$2,900", discounts: "$3,100", netIncome: "$43,400", momGrowth: "+7.1%" }
  ];

  res.json({
    success: true,
    reportName: "Monthly Income Report",
    summary: {
      currentMonthNet: "$43,400",
      ytdTotalIncome: "$249,150",
      averageMonthlyRunRate: "$31,143",
      annualizedPacing: "$373,700"
    },
    data: monthsData
  });
});

// 7. DAILY COLLECTION REPORT
router.get("/daily-collection", (_req, res) => {
  const dailyTransactions = [
    { receiptNo: "REC-2026-8801", time: "09:12 AM", studentName: "Rahul Kumar", course: "Coding & Software Engineering", paymentMethod: "Credit Card / Stripe", amount: "$499.00", collectedBy: "Online Portal", status: "Cleared" },
    { receiptNo: "REC-2026-8802", time: "10:35 AM", studentName: "Ananya Sharma", course: "Robotics Track", paymentMethod: "Bank Wire Transfer", amount: "$399.00", collectedBy: "Finance Desk", status: "Cleared" },
    { receiptNo: "REC-2026-8803", time: "11:50 AM", studentName: "Devin Chen", course: "Advanced Mathematics", paymentMethod: "Debit Card", amount: "$350.00", collectedBy: "Admin POS", status: "Cleared" },
    { receiptNo: "REC-2026-8804", time: "01:22 PM", studentName: "Liam Vance", course: "AP Physics", paymentMethod: "Stripe Online", amount: "$250.00", collectedBy: "Online Portal", status: "Cleared" },
    { receiptNo: "REC-2026-8805", time: "02:45 PM", studentName: "Maya Lin", course: "3D Printing & CAD", paymentMethod: "Cash Receipt", amount: "$150.00", collectedBy: "Finance Desk", status: "Reconciled" }
  ];

  const todayTotal = dailyTransactions.reduce((acc, t) => acc + parseFloat(t.amount.replace(/[^0-9.]/g, "")), 0);

  res.json({
    success: true,
    reportName: "Daily Collection Report",
    summary: {
      todayDate: new Date().toISOString().slice(0, 10),
      totalCollectedToday: `$${todayTotal.toFixed(2)}`,
      onlinePortalShare: "75%",
      totalReceiptsIssued: dailyTransactions.length
    },
    data: dailyTransactions
  });
});

// 8. STUDENT GROWTH REPORT
router.get("/student-growth", (_req, res) => {
  const cohorts = [
    { period: "Q1 2025", startingCount: 45, newAdmissions: 28, exitsGraduated: 4, endingCount: 69, netGrowthPercent: "+53.3%" },
    { period: "Q2 2025", startingCount: 69, newAdmissions: 35, exitsGraduated: 6, endingCount: 98, netGrowthPercent: "+42.0%" },
    { period: "Q3 2025", startingCount: 98, newAdmissions: 42, exitsGraduated: 8, endingCount: 132, netGrowthPercent: "+34.7%" },
    { period: "Q4 2025", startingCount: 132, newAdmissions: 50, exitsGraduated: 11, endingCount: 171, netGrowthPercent: "+29.5%" },
    { period: "Q1 2026", startingCount: 171, newAdmissions: 64, exitsGraduated: 12, endingCount: 223, netGrowthPercent: "+30.4%" },
    { period: "Q2 2026", startingCount: 223, newAdmissions: 78, exitsGraduated: 15, endingCount: 286, netGrowthPercent: "+28.2%" },
    { period: "Q3 2026 (Current)", startingCount: 286, newAdmissions: 92, exitsGraduated: 18, endingCount: 360, netGrowthPercent: "+25.8%" }
  ];

  res.json({
    success: true,
    reportName: "Student Growth Report",
    summary: {
      activeStudentBase: 360,
      annualExpansionRate: "+110.5%",
      averageRetentionPerCohort: "92.3%",
      churnRate: "4.8%"
    },
    data: cohorts
  });
});

// 9. TEACHER UTILIZATION REPORT
router.get("/teacher-utilization", (_req, res) => {
  const teachers = inMemoryTeachers;

  const utilizationData = teachers.map((t: any, idx: number) => {
    const assigned = t.weekly_assigned_sessions || 14;
    const max = t.weekly_max_sessions || 20;
    const utilRate = Math.round((assigned / max) * 100);

    return {
      id: t.id,
      teacherName: t.name,
      specialization: t.specialization || "Faculty",
      assignedWeeklySlots: `${assigned} Slots`,
      maxWeeklyCapacity: `${max} Slots`,
      utilizationRate: `${utilRate}%`,
      availableFreeSlots: `${Math.max(0, max - assigned)} Slots`,
      workingDays: t.availability_days?.join(", ") || "Mon, Wed, Fri",
      loadStatus: utilRate >= 90 ? "Heavy Load / Maxed" : utilRate >= 65 ? "Balanced Optimal" : "Under-Utilized"
    };
  });

  res.json({
    success: true,
    reportName: "Teacher Utilization Report",
    summary: {
      averageUtilization: "72.5%",
      fullyBookedFaculty: 1,
      availableCapacityHours: "38 Slots / Week",
      overtimeIncidents: 0
    },
    data: utilizationData
  });
});

// 10. REVENUE ANALYTICS REPORT
router.get("/revenue-analytics", (_req, res) => {
  const revenueChannels = [
    { channelName: "Primary Coding & Web Tracks", category: "Core Stream", enrolledStudents: 142, grossBilled: "$70,858", netCollected: "$68,200", realizationRate: "96.2%", arpu: "$480" },
    { channelName: "Robotics & Hardware Labs", category: "STEM Lab", enrolledStudents: 88, grossBilled: "$35,112", netCollected: "$33,800", realizationRate: "96.3%", arpu: "$384" },
    { channelName: "3D Printing & CAD Design", category: "Creative STEM", enrolledStudents: 64, grossBilled: "$25,536", netCollected: "$24,100", realizationRate: "94.4%", arpu: "$376" },
    { channelName: "Advanced Math & Olympiad", category: "Academic Prep", enrolledStudents: 48, grossBilled: "$16,800", netCollected: "$16,200", realizationRate: "96.4%", arpu: "$337" },
    { channelName: "Weekend Early Phonics & Logic", category: "Junior Program", enrolledStudents: 32, grossBilled: "$9,600", netCollected: "$9,200", realizationRate: "95.8%", arpu: "$287" }
  ];

  res.json({
    success: true,
    reportName: "Revenue Analytics Report",
    summary: {
      totalGrossBilled: "$157,906",
      totalNetRealized: "$151,500",
      averageARPU: "$405",
      overallRealizationRate: "95.9%"
    },
    data: revenueChannels
  });
});

// 11. RETENTION REPORT
router.get("/retention", (_req, res) => {
  const retentionCohorts = [
    { programStream: "Coding & Software Engineering", initialEnrollment: 120, retainedStudents: 114, droppedStudents: 6, retentionRate: "95.0%", avgTenureMonths: "14.2 Mos", multiCourseRatio: "42%" },
    { programStream: "Robotics & Embedded Systems", initialEnrollment: 80, retainedStudents: 74, droppedStudents: 6, retentionRate: "92.5%", avgTenureMonths: "11.8 Mos", multiCourseRatio: "38%" },
    { programStream: "3D Printing & Design", initialEnrollment: 60, retainedStudents: 54, droppedStudents: 6, retentionRate: "90.0%", avgTenureMonths: "9.5 Mos", multiCourseRatio: "25%" },
    { programStream: "Advanced Mathematics", initialEnrollment: 50, retainedStudents: 47, droppedStudents: 3, retentionRate: "94.0%", avgTenureMonths: "16.0 Mos", multiCourseRatio: "55%" },
    { programStream: "AI & Machine Learning Track", initialEnrollment: 40, retainedStudents: 39, droppedStudents: 1, retentionRate: "97.5%", avgTenureMonths: "8.4 Mos", multiCourseRatio: "62%" }
  ];

  res.json({
    success: true,
    reportName: "Retention Report",
    summary: {
      instituteRetentionAverage: "93.8%",
      highestRetentionProgram: "AI & Machine Learning Track (97.5%)",
      averageStudentTenure: "12.8 Months",
      multiProgramEnrollmentRate: "44.4%"
    },
    data: retentionCohorts
  });
});

// 12. RENEWAL REPORT
router.get("/renewal", (_req, res) => {
  const renewalItems = [
    { studentName: "Rahul Kumar", studentCode: "TG-2026-9081", currentPlan: "Coding & Software Engineering (6 Mo)", expiryDate: "2026-09-15", daysRemaining: 19, renewalFee: "$499", autoRenew: "Enabled (Card on file)", renewalStatus: "Ready for Auto-Charge", followUpAssigned: "Sarah Jenkins" },
    { studentName: "Ananya Sharma", studentCode: "TG-2026-9082", currentPlan: "Robotics Lab (3 Mo)", expiryDate: "2026-09-02", daysRemaining: 6, renewalFee: "$399", autoRenew: "Manual Request", renewalStatus: "Invoice Dispatched", followUpAssigned: "Michael Scott" },
    { studentName: "Devin Chen", studentCode: "TG-2026-9083", currentPlan: "Advanced Math (1 Yr)", expiryDate: "2026-09-28", daysRemaining: 32, renewalFee: "$850", autoRenew: "Enabled", renewalStatus: "Upcoming (30d)", followUpAssigned: "Sarah Jenkins" },
    { studentName: "Liam Vance", studentCode: "TG-2026-9084", currentPlan: "AP Physics Prep", expiryDate: "2026-09-05", daysRemaining: 9, renewalFee: "$350", autoRenew: "Manual Request", renewalStatus: "Follow-up Call Pending", followUpAssigned: "Michael Scott" },
    { studentName: "Maya Lin", studentCode: "TG-2026-9085", currentPlan: "3D CAD Track", expiryDate: "2026-09-10", daysRemaining: 14, renewalFee: "$399", autoRenew: "Enabled", renewalStatus: "Confirmed for Renewal", followUpAssigned: "Sarah Jenkins" }
  ];

  res.json({
    success: true,
    reportName: "Renewal Report",
    summary: {
      expiringNext30Days: renewalItems.length,
      projectedRenewalRevenue: "$2,497",
      renewalConversionPacing: "89.4%",
      autoRenewAdoptionRate: "60%"
    },
    data: renewalItems
  });
});

export default router;
