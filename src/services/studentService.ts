import { dispatchMultiChannelNotification } from "./notificationService.js";
import { demoStudentsPool } from "./demoDataService.js";

export interface CourseAllocation {
  courseName: string;
  duration: string; // e.g. "1 Hr Session", "3 Months", "6 Months", "1 Year"
}

export interface StudentDossier {
  id?: string | undefined;
  studentCode?: string | undefined;
  fullName: string;
  photoUrl?: string | undefined;
  profileImageUrl?: string | undefined;
  gender?: string | undefined;
  dob: string; // ISO date string
  age?: number | undefined;
  school?: string | undefined;
  grade?: string | undefined;
  status: string;

  // Parent & Guardian Details
  fatherName?: string | undefined;
  motherName?: string | undefined;
  guardianName?: string | undefined;
  studentPhones?: string[] | undefined;
  parentPhones?: string[] | undefined;
  studentWhatsapp?: string | undefined;
  parentWhatsapp?: string[] | undefined;
  studentEmails?: string[] | undefined;
  parentEmails?: string[] | undefined;
  primaryMobile?: string | undefined;
  email: string;
  parentOccupation?: string | undefined;
  emergencyContactName?: string | undefined;
  emergencyContactRelationship?: string | undefined;
  residentialAddress?: string | undefined;

  // Enrollment & Multiple Course Details
  admissionDate?: string | undefined;
  program?: string | undefined; // Primary program
  allocatedCourses?: CourseAllocation[] | undefined; // Multiple allocated courses
  assignedTeacherId?: string | undefined;
  teacher?: string | undefined;
  weeklyClasses?: string | undefined;
  courseDuration?: string | undefined;
  startDate?: string | undefined;
  endDate?: string | undefined;
  feePlan?: string | undefined;
  discount?: string | undefined; // Promo Code (e.g. TOPGRD)
  purchasedHours?: number | undefined;
  paymentMethod?: string | undefined;
  createdAt?: string | undefined;
  updatedAt?: string | undefined;
}

/**
 * Calculates exact age in years from a Date of Birth string or Date object.
 */
export function calculateAgeFromDOB(dob: Date | string): number {
  if (!dob) return 0;
  const birthDate = new Date(dob);
  if (isNaN(birthDate.getTime())) return 0;
  const today = new Date();
  let age = today.getFullYear() - birthDate.getFullYear();
  const monthDiff = today.getMonth() - birthDate.getMonth();
  if (monthDiff < 0 || (monthDiff === 0 && today.getDate() < birthDate.getDate())) {
    age--;
  }
  return Math.max(0, age);
}

/**
 * In-memory fallback store for robust operational resilience.
 */
export const inMemoryStudentStore: StudentDossier[] = [
  {
    id: "std-demo-101",
    studentCode: "TG-STU-2026-1001",
    fullName: "Reddy V",
    profileImageUrl: "https://images.unsplash.com/photo-1534528741775-53994a69daeb?w=150&auto=format&fit=crop&q=80",
    gender: "Male",
    dob: "2008-04-12",
    age: 18,
    school: "St. Xavier International School",
    grade: "Grade 11",
    status: "ACTIVE",

    fatherName: "Venkat Reddy",
    motherName: "Lakshmi Reddy",
    guardianName: "N/A",
    studentPhones: ["+91 77806 40562"],
    parentPhones: ["+91 94926 02243", "+91 94926 02259"],
    studentWhatsapp: "+91 77806 40562",
    parentWhatsapp: ["+91 94926 02243"],
    studentEmails: ["reddy.student@topgrade.edu"],
    parentEmails: ["venkat.reddy@gmail.com", "lakshmi.reddy@gmail.com"],
    primaryMobile: "+91 77806 40562",
    email: "reddy.student@topgrade.edu",
    parentOccupation: "Software Architect",
    emergencyContactName: "Uncle Srinivas",
    emergencyContactRelationship: "Uncle",
    residentialAddress: "Plot 42, Green Valley Enclave, Vijayawada, AP",

    admissionDate: "2026-01-15",
    program: "Full-Stack Web Development",
    allocatedCourses: [
      { courseName: "Full-Stack Web Development", duration: "1 Year" },
      { courseName: "Data Science & Machine Learning", duration: "6 Months" }
    ],
    assignedTeacherId: "tch-101",
    teacher: "Prof. Alan Turing",
    weeklyClasses: "3 classes/week",
    courseDuration: "1 Year",
    startDate: "2026-02-01",
    endDate: "2027-02-01",
    feePlan: "Quarterly",
    discount: "TOPGRD",
    createdAt: new Date("2026-01-15").toISOString(),
    updatedAt: new Date("2026-01-15").toISOString()
  },
  {
    id: "std-demo-102",
    studentCode: "TG-STU-2026-1002",
    fullName: "Ananya Sharma",
    profileImageUrl: "https://images.unsplash.com/photo-1494790108377-be9c29b29330?w=150&auto=format&fit=crop&q=80",
    gender: "Female",
    dob: "2012-09-24",
    age: 13,
    school: "Delhi Public School",
    grade: "Grade 8",
    status: "ACTIVE",

    fatherName: "Rajesh Sharma",
    motherName: "Sunita Sharma",
    guardianName: "",
    studentPhones: ["+91 98765 43210"],
    parentPhones: ["+91 98765 12345"],
    studentWhatsapp: "+91 98765 43210",
    parentWhatsapp: ["+91 98765 12345"],
    studentEmails: ["ananya.s@gmail.com"],
    parentEmails: ["rajesh.sharma@corp.com"],
    primaryMobile: "+91 98765 43210",
    email: "ananya.s@gmail.com",
    parentOccupation: "Senior Finance Manager",
    emergencyContactName: "Sunita Sharma",
    emergencyContactRelationship: "Mother",
    residentialAddress: "B-204, Rosewood Heights, Hyderabad",

    admissionDate: "2026-03-01",
    program: "Python Data Science Basics",
    allocatedCourses: [
      { courseName: "Python Data Science Basics", duration: "6 Months" },
      { courseName: "Algebra & Geometry Lab", duration: "1 Hr Session" }
    ],
    assignedTeacherId: "tch-102",
    teacher: "Dr. Grace Hopper",
    weeklyClasses: "2 classes/week",
    courseDuration: "6 Months",
    startDate: "2026-03-05",
    endDate: "2026-09-05",
    feePlan: "Monthly",
    discount: "SUMMER",
    createdAt: new Date("2026-03-01").toISOString(),
    updatedAt: new Date("2026-03-01").toISOString()
  },
  {
    id: "std-demo-103",
    studentCode: "TG-STU-2025-089",
    fullName: "Karan Verma",
    profileImageUrl: "",
    gender: "Male",
    dob: "2006-11-05",
    age: 19,
    school: "National Institute of Science",
    grade: "UG",
    status: "INACTIVE",

    fatherName: "Mahesh Verma",
    motherName: "Kavita Verma",
    guardianName: "",
    studentPhones: ["+91 91234 56789"],
    parentPhones: ["+91 91234 98765"],
    studentWhatsapp: "+91 91234 56789",
    parentWhatsapp: ["+91 91234 98765"],
    studentEmails: ["karan.v@uni.edu"],
    parentEmails: ["mahesh.v@gmail.com"],
    primaryMobile: "+91 91234 56789",
    email: "karan.v@uni.edu",
    parentOccupation: "Business Owner",
    emergencyContactName: "Mahesh Verma",
    emergencyContactRelationship: "Father",
    residentialAddress: "Flat 12, Sunrise Apartments, Bangalore",

    admissionDate: "2025-06-10",
    program: "Enterprise Full-Stack Web Engineering",
    allocatedCourses: [
      { courseName: "Enterprise Full-Stack Web Engineering", duration: "1 Year" }
    ],
    assignedTeacherId: "tch-103",
    teacher: "Prof. Alan Turing",
    weeklyClasses: "2 classes/week",
    courseDuration: "1 Year",
    startDate: "2025-06-15",
    endDate: "2026-06-15",
    feePlan: "Full One-Time",
    discount: "SCHOLR",
    createdAt: new Date("2025-06-10").toISOString(),
    updatedAt: new Date("2025-12-15").toISOString()
  }
];

/**
 * Service method to retrieve paginated student records with search and filters.
 */
export async function getStudentsService(params: {
  page?: number | undefined;
  limit?: number | undefined;
  search?: string | undefined;
  status?: string | undefined;
  grade?: string | undefined;
}) {
  const page = params.page || 1;
  const limit = params.limit || 50;
  const search = (params.search || "").trim().toLowerCase();
  const statusFilter = (params.status || "ALL").toUpperCase();
  const gradeFilter = (params.grade || "ALL");

  const mappedDemoStudents: StudentDossier[] = demoStudentsPool.map(s => ({
    id: s.id,
    studentCode: s.studentCode,
    fullName: s.fullName,
    gender: "Male",
    dob: s.dob,
    age: s.age,
    school: "TopGrade Academy",
    grade: s.grade,
    status: "ACTIVE",
    fatherName: s.fatherName,
    motherName: s.motherName,
    studentPhones: [s.parentPhone],
    parentPhones: [s.parentPhone],
    primaryMobile: s.parentPhone,
    email: s.email,
    parentEmails: [s.parentEmail],
    admissionDate: "2026-01-15",
    program: s.enrolledCourseName,
    allocatedCourses: [{ courseName: s.enrolledCourseName, duration: "6 Months" }]
  }));

  let students = [...inMemoryStudentStore, ...mappedDemoStudents];

  if (statusFilter === "ACTIVE" || statusFilter === "INACTIVE") {
    students = students.filter(s => s.status.toUpperCase() === statusFilter);
  }

  if (gradeFilter !== "ALL" && gradeFilter !== "") {
    students = students.filter(s => (s.grade || "").toLowerCase() === gradeFilter.toLowerCase());
  }

  if (search) {
    students = students.filter(s => {
      const matchName = s.fullName.toLowerCase().includes(search);
      const matchCode = (s.studentCode || "").toLowerCase().includes(search);
      const matchGrade = (s.grade || "").toLowerCase().includes(search);
      const matchParentPhone = (s.parentPhones || []).some(p => p.toLowerCase().includes(search));
      const matchStudentPhone = (s.studentPhones || []).some(p => p.toLowerCase().includes(search));
      const matchPrimary = (s.primaryMobile || "").toLowerCase().includes(search);
      return matchName || matchCode || matchGrade || matchParentPhone || matchStudentPhone || matchPrimary;
    });
  }

  const total = students.length;
  const startIndex = (page - 1) * limit;
  const paginatedData = students.slice(startIndex, startIndex + limit);

  return {
    success: true,
    total,
    page,
    limit,
    data: paginatedData
  };
}

/**
 * Service method to create a new student dossier with multi-email notification dispatch.
 */
export async function createStudentService(payload: Partial<StudentDossier>) {
  if (!payload.fullName || !payload.fullName.trim()) {
    throw new Error("Student Name is required.");
  }

  const dobStr = payload.dob || new Date().toISOString();
  const calculatedAge = payload.age || calculateAgeFromDOB(dobStr);

  const studentId = `std-${Date.now()}-${Math.floor(100 + Math.random() * 900)}`;
  const randomSuffix = Math.floor(1000 + Math.random() * 9000);
  const studentCode = payload.studentCode || `TG-STU-2026-${randomSuffix}`;

  const cleanStudentPhones = (payload.studentPhones || []).filter(p => p.trim() !== "");
  if (cleanStudentPhones.length === 0 && payload.primaryMobile) {
    cleanStudentPhones.push(payload.primaryMobile);
  }
  const cleanParentPhones = (payload.parentPhones || []).filter(p => p.trim() !== "");
  const cleanParentWhatsapp = (payload.parentWhatsapp || []).filter(p => p.trim() !== "");
  const cleanParentEmails = (payload.parentEmails || []).filter(e => e.trim() !== "");
  const cleanStudentEmails = (payload.studentEmails || []).filter(e => e.trim() !== "");
  if (cleanStudentEmails.length === 0 && payload.email) {
    cleanStudentEmails.push(payload.email);
  }

  // Parse multi-course allocations
  const allocatedCourses: CourseAllocation[] = payload.allocatedCourses && payload.allocatedCourses.length > 0
    ? payload.allocatedCourses
    : [{ courseName: payload.program || "Standard Curriculum", duration: payload.courseDuration || "6 Months" }];

  const newStudent: StudentDossier = {
    id: studentId,
    studentCode,
    fullName: payload.fullName.trim(),
    profileImageUrl: payload.photoUrl || payload.profileImageUrl || "",
    gender: payload.gender || "Male",
    dob: dobStr,
    age: calculatedAge,
    school: payload.school || "",
    grade: payload.grade || "Grade 1",
    status: (payload.status || "ACTIVE").toUpperCase() === "INACTIVE" ? "INACTIVE" : "ACTIVE",

    fatherName: payload.fatherName || "",
    motherName: payload.motherName || "",
    guardianName: payload.guardianName || "",
    studentPhones: cleanStudentPhones,
    parentPhones: cleanParentPhones.length > 0 ? cleanParentPhones : [payload.primaryMobile || "+91 99999 99999"],
    studentWhatsapp: payload.studentWhatsapp || cleanStudentPhones[0] || "",
    parentWhatsapp: cleanParentWhatsapp,
    studentEmails: cleanStudentEmails,
    parentEmails: cleanParentEmails,
    primaryMobile: cleanStudentPhones[0] || payload.primaryMobile || "",
    email: cleanStudentEmails[0] || payload.email || `${studentId}@topgrade.edu`,
    parentOccupation: payload.parentOccupation || "",
    emergencyContactName: payload.emergencyContactName || "",
    emergencyContactRelationship: payload.emergencyContactRelationship || "",
    residentialAddress: payload.residentialAddress || "",

    admissionDate: payload.admissionDate || new Date().toISOString().split("T")[0],
    program: allocatedCourses[0]?.courseName || payload.program || "Standard Curriculum",
    allocatedCourses,
    assignedTeacherId: payload.assignedTeacherId || "",
    teacher: payload.teacher || "Assigned Faculty",
    weeklyClasses: payload.weeklyClasses || "2 classes/week",
    courseDuration: allocatedCourses[0]?.duration || payload.courseDuration || "6 Months",
    startDate: payload.startDate || new Date().toISOString().split("T")[0],
    endDate: payload.endDate || "",
    feePlan: payload.feePlan || "Monthly",
    discount: (payload.discount || "TOPGRD").toUpperCase(),
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString()
  };

  inMemoryStudentStore.unshift(newStudent);

  // Automatic Multi-Email Dispatch to ALL Student Emails, ALL Parent Emails, and Default Admin Email
  try {
    const recipients: Array<{ role: "STUDENT" | "PARENT" | "TEACHER" | "ACCOUNTANT" | "ADMIN"; email: string; name: string; phone: string }> = [];

    // Add student emails
    cleanStudentEmails.forEach(e => {
      recipients.push({ role: "STUDENT", email: e, name: newStudent.fullName, phone: newStudent.primaryMobile || "" });
    });

    // Add parent emails
    cleanParentEmails.forEach(e => {
      recipients.push({ role: "PARENT", email: e, name: newStudent.fatherName || newStudent.motherName || "Parent", phone: cleanParentPhones[0] || "" });
    });

    // Default Admin email
    recipients.push({ role: "ADMIN", email: "admin@topgrade.edu", name: "System Administrator", phone: "" });

    const courseNamesStr = newStudent.allocatedCourses?.map(c => `${c.courseName} (${c.duration})`).join(", ");

    await dispatchMultiChannelNotification({
      eventType: "PAYMENT_COMPLETED",
      subject: `🎉 Student Enrollment dossier Registered — ${newStudent.fullName} (${newStudent.studentCode})`,
      message: `Dear Student & Parent,\n\nStudent Profile successfully created!\n\n📋 Dossier Summary:\n• Student Name: ${newStudent.fullName}\n• Student Code: ${newStudent.studentCode}\n• Grade: ${newStudent.grade}\n• Age: ${newStudent.age} Years\n• Enrolled Courses: ${courseNamesStr}\n• Promo Code Applied: ${newStudent.discount}\n• Fee Billing Plan: ${newStudent.feePlan}\n\nThank you for choosing TopGrade CRM!`,
      recipients
    });
  } catch (err) {
    // Non-blocking notification dispatch log
  }

  return newStudent;
}

/**
 * Service method to update an existing student dossier by ID.
 */
export async function updateStudentService(id: string, payload: Partial<StudentDossier>): Promise<StudentDossier> {
  const index = inMemoryStudentStore.findIndex(s => s.id === id || s.studentCode === id);
  const existing = inMemoryStudentStore[index];
  if (index === -1 || !existing) {
    throw new Error(`Student with ID or Code '${id}' not found.`);
  }

  const dobStr = payload.dob || existing.dob;
  const age = payload.dob ? calculateAgeFromDOB(dobStr) : (payload.age ?? existing.age);

  const updated: StudentDossier = {
    ...existing,
    ...payload,
    fullName: payload.fullName || existing.fullName,
    dob: dobStr,
    age,
    updatedAt: new Date().toISOString()
  };

  inMemoryStudentStore[index] = updated;
  return updated;
}

/**
 * Service method to toggle student ACTIVE / INACTIVE status.
 */
export async function toggleStudentStatusService(id: string, newStatus?: string): Promise<StudentDossier> {
  const index = inMemoryStudentStore.findIndex(s => s.id === id || s.studentCode === id);
  const current = inMemoryStudentStore[index];
  if (index === -1 || !current) {
    throw new Error(`Student with ID '${id}' not found.`);
  }

  let targetStatus = newStatus;
  if (!targetStatus) {
    targetStatus = current.status.toUpperCase() === "ACTIVE" ? "INACTIVE" : "ACTIVE";
  } else {
    targetStatus = targetStatus.toUpperCase();
  }

  current.status = targetStatus;
  current.updatedAt = new Date().toISOString();
  inMemoryStudentStore[index] = current;
  return current;
}
