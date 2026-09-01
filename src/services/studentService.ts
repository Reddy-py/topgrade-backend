import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { dispatchMultiChannelNotification } from "./notificationService.js";
import { inMemoryTeachers } from "../routes/teachers.js";
import { supabaseAdmin } from "../index.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const DATA_DIR = path.join(__dirname, "../../data");
const DB_FILE_PATH = path.join(DATA_DIR, "students_db.json");

export interface CourseAllocation {
  courseName: string;
  duration: string; // e.g. "1 Hr Session", "3 Months", "6 Months", "1 Year"
}

export interface StudentDossier {
  id?: string | undefined;
  studentCode?: string | undefined;
  firstName?: string | undefined;
  lastName?: string | undefined;
  fullName: string;
  photoUrl?: string | undefined;
  profileImageUrl?: string | undefined;
  gender?: string | undefined;
  dob: string; // ISO date string (YYYY-MM-DD)
  age?: number | undefined;
  school: string; // MANDATORY
  grade?: string | undefined;
  status: string;

  // Parent & Guardian Details
  parentFirstName?: string | undefined;
  parentLastName?: string | undefined;
  fatherName?: string | undefined;
  motherName?: string | undefined;
  guardianName?: string | undefined;
  studentPhones?: string[] | undefined;
  parentPhones?: string[] | undefined;
  studentWhatsapp?: string | undefined;
  parentWhatsapp?: string[] | undefined;
  sameAsStudentPhone?: boolean | undefined;
  sameAsParentPhone?: boolean | undefined;
  studentEmails?: string[] | undefined;
  parentEmails?: string[] | undefined;
  primaryMobile?: string | undefined;
  email: string;
  parentOccupation?: string | undefined;
  emergencyContactName?: string | undefined;
  emergencyContactRelationship?: string | undefined;
  residentialAddress?: string | undefined;
  officeAddress?: string | undefined;

  // Enrollment & Credentials Details
  password?: string | undefined; // Unique student login password
  hasChangedPassword?: boolean | undefined;
  passwordChangedCount?: number | undefined;
  passwordUpdatedAt?: string | undefined;
  admissionDate?: string | undefined;
  program?: string | undefined;
  allocatedCourses?: CourseAllocation[] | undefined;
  assignedTeacherId?: string | undefined;
  teacher?: string | undefined;
  weeklyClasses?: string | undefined;
  courseDuration?: string | undefined;
  startDate?: string | undefined;
  endDate?: string | undefined;
  feePlan?: string | undefined;
  discount?: string | undefined;
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

// Persistent Storage Layer (Disk File + In-Memory Cache)
export let inMemoryStudentStore: StudentDossier[] = [];

function loadStudentsFromDisk(): StudentDossier[] {
  try {
    if (!fs.existsSync(DATA_DIR)) {
      fs.mkdirSync(DATA_DIR, { recursive: true });
    }
    if (fs.existsSync(DB_FILE_PATH)) {
      const content = fs.readFileSync(DB_FILE_PATH, "utf-8");
      const parsed = JSON.parse(content);
      if (Array.isArray(parsed)) {
        return parsed;
      }
    }
  } catch (err) {
    console.warn("Notice reading students_db.json:", err);
  }
  return [];
}

function saveStudentsToDisk() {
  try {
    if (!fs.existsSync(DATA_DIR)) {
      fs.mkdirSync(DATA_DIR, { recursive: true });
    }
    fs.writeFileSync(DB_FILE_PATH, JSON.stringify(inMemoryStudentStore, null, 2), "utf-8");
  } catch (err) {
    console.error("Error saving students_db.json:", err);
  }
}

// Initialize from persistent file on startup
inMemoryStudentStore = loadStudentsFromDisk();

/**
 * Service method to retrieve paginated student records with search, filters, and RBAC accessibility.
 */
export async function getStudentsService(params: {
  page?: number | undefined;
  limit?: number | undefined;
  search?: string | undefined;
  status?: string | undefined;
  grade?: string | undefined;
  currentUser?: { id?: string | undefined; email?: string | undefined; role?: string | undefined } | undefined;
}) {
  const page = params.page || 1;
  const limit = params.limit || 50;
  const search = (params.search || "").trim().toLowerCase();
  const statusFilter = (params.status || "ALL").toUpperCase();
  const gradeFilter = (params.grade || "ALL");
  const user = params.currentUser;

  let students = [...inMemoryStudentStore];

  // Role-based Access Filter
  if (user && user.role) {
    const roleUpper = user.role.toUpperCase();
    if (roleUpper === "STUDENT") {
      // Students see ONLY their own record
      students = students.filter(
        s => (user.id && s.id === user.id) ||
             (user.email && s.email.toLowerCase() === user.email.toLowerCase()) ||
             (user.id && s.studentCode === user.id)
      );
    } else if (roleUpper === "PARENT") {
      // Parents see ONLY their linked children
      students = students.filter(
        s => (user.email && (s.parentEmails || []).some(e => e.toLowerCase() === user.email?.toLowerCase())) ||
             (user.email && s.email.toLowerCase() === user.email.toLowerCase())
      );
    } else if (roleUpper === "TEACHER") {
      // Teachers see ONLY students in their assigned courses or classes
      students = students.filter(
        s => (user.id && s.assignedTeacherId === user.id) ||
             (user.id && s.teacher && s.teacher.toLowerCase().includes(user.id.toLowerCase()))
      );
    }
    // ADMIN and ACCOUNTANT see ALL
  }

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
      const matchSchool = (s.school || "").toLowerCase().includes(search);
      const matchParentPhone = (s.parentPhones || []).some(p => p.toLowerCase().includes(search));
      const matchStudentPhone = (s.studentPhones || []).some(p => p.toLowerCase().includes(search));
      const matchPrimary = (s.primaryMobile || "").toLowerCase().includes(search);
      return matchName || matchCode || matchGrade || matchSchool || matchParentPhone || matchStudentPhone || matchPrimary;
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
 * Service method to create a new student dossier with MANDATORY School validation & persistent file storage.
 */
export async function createStudentService(payload: Partial<StudentDossier>) {
  // Validate Required Mandatory Fields
  if (!payload.firstName || !payload.firstName.trim()) {
    throw new Error("First Name is a mandatory field.");
  }
  if (!payload.lastName || !payload.lastName.trim()) {
    throw new Error("Last Name is a mandatory field.");
  }
  if (!payload.dob || !payload.dob.trim()) {
    throw new Error("Date of Birth is a mandatory field.");
  }
  if (!payload.school || !payload.school.trim()) {
    throw new Error("School Name is a mandatory field.");
  }
  if (!payload.fatherName || !payload.fatherName.trim()) {
    throw new Error("Father Name is a mandatory field.");
  }
  if (!payload.motherName || !payload.motherName.trim()) {
    throw new Error("Mother Name is a mandatory field.");
  }

  const schoolName = payload.school.trim();
  const firstName = payload.firstName.trim();
  const lastName = payload.lastName.trim();
  const derivedFullName = `${firstName} ${lastName}`.trim();

  const parentFirstName = payload.parentFirstName ? payload.parentFirstName.trim() : "";
  const parentLastName = payload.parentLastName ? payload.parentLastName.trim() : "";
  const derivedParentName = (parentFirstName || parentLastName) ? `${parentFirstName} ${parentLastName}`.trim() : (payload.fatherName || payload.motherName || "").trim();

  const dobStr: string = payload.dob ? String(payload.dob) : new Date().toISOString().split("T")[0] || "";
  const calculatedAge = calculateAgeFromDOB(dobStr);

  const studentId = `std-${Date.now()}-${Math.floor(100 + Math.random() * 900)}`;
  const randomSuffix = Math.floor(1000 + Math.random() * 9000);
  const studentCode = payload.studentCode || `TG-STU-2026-${randomSuffix}`;

  const formatPhone = (p: string) => {
    if (!p || !p.trim()) return "";
    const t = p.trim();
    return t.startsWith("+") ? t : `+1 ${t}`;
  };

  const cleanStudentPhones = (payload.studentPhones || [])
    .filter(p => p && p.trim() !== "")
    .map(formatPhone);
  if (cleanStudentPhones.length === 0 && payload.primaryMobile) {
    cleanStudentPhones.push(formatPhone(payload.primaryMobile));
  }
  const cleanParentPhones = (payload.parentPhones || [])
    .filter(p => p && p.trim() !== "")
    .map(formatPhone);

  // WhatsApp Number Logic (+1 default prefix)
  let studentWhatsapp = formatPhone(payload.studentWhatsapp || "");
  if (payload.sameAsStudentPhone && cleanStudentPhones[0]) {
    studentWhatsapp = cleanStudentPhones[0];
  }

  let parentWhatsapp = (payload.parentWhatsapp || [])
    .filter(p => p && p.trim() !== "")
    .map(formatPhone);
  if (payload.sameAsParentPhone && cleanParentPhones[0]) {
    parentWhatsapp = [cleanParentPhones[0]];
  }

  const cleanParentEmails = (payload.parentEmails || []).filter(e => e && e.trim() !== "");
  const cleanStudentEmails = (payload.studentEmails || []).filter(e => e && e.trim() !== "");
  if (cleanStudentEmails.length === 0 && payload.email) {
    cleanStudentEmails.push(payload.email);
  }

  const allocatedCourses: CourseAllocation[] = payload.allocatedCourses && payload.allocatedCourses.length > 0
    ? payload.allocatedCourses
    : [{ courseName: payload.program || "Standard Curriculum", duration: payload.courseDuration || "6 Months" }];

  const newStudent: StudentDossier = {
    id: studentId,
    studentCode,
    firstName,
    lastName,
    fullName: derivedFullName,
    profileImageUrl: payload.photoUrl || payload.profileImageUrl || "",
    gender: payload.gender || "Male",
    dob: dobStr,
    age: calculatedAge,
    school: schoolName,
    grade: payload.grade || "Grade 1",
    status: (payload.status || "ACTIVE").toUpperCase() === "INACTIVE" ? "INACTIVE" : "ACTIVE",

    parentFirstName,
    parentLastName,
    fatherName: payload.fatherName || derivedParentName || "Parent",
    motherName: payload.motherName || "",
    guardianName: payload.guardianName || "",
    studentPhones: cleanStudentPhones,
    parentPhones: cleanParentPhones,
    studentWhatsapp,
    parentWhatsapp,
    sameAsStudentPhone: !!payload.sameAsStudentPhone,
    sameAsParentPhone: !!payload.sameAsParentPhone,
    studentEmails: cleanStudentEmails,
    parentEmails: cleanParentEmails,
    primaryMobile: cleanStudentPhones[0] || payload.primaryMobile || "",
    email: (cleanStudentEmails[0] || payload.email || "").trim() || undefined,
    parentOccupation: payload.parentOccupation || "",
    emergencyContactName: payload.emergencyContactName || "",
    emergencyContactRelationship: payload.emergencyContactRelationship || "",
    residentialAddress: payload.residentialAddress || "",
    officeAddress: payload.officeAddress || "",

    password: payload.password || "Student@123",
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
  saveStudentsToDisk();

  // ─── Real-time Supabase Database & Auth Sync ───
  (async () => {
    try {
      let authUserId: string | null = null;
      if (newStudent.email) {
        const { data: authCreated } = await supabaseAdmin.auth.admin.createUser({
          email: newStudent.email,
          password: newStudent.password || "Student@123",
          email_confirm: true,
          user_metadata: {
            full_name: newStudent.fullName,
            role: "STUDENT",
            student_code: newStudent.studentCode
          }
        });
        if (authCreated?.user) {
          authUserId = authCreated.user.id;
          // Also record in profiles table
          await supabaseAdmin.from("profiles").upsert({
            id: authUserId,
            email: newStudent.email,
            full_name: newStudent.fullName,
            role: "STUDENT",
            status: "Active"
          }, { onConflict: "id" });
        }
      }

      const studentRow: any = {
        name: newStudent.fullName,
        student_id_code: newStudent.studentCode,
        gender: newStudent.gender || "Male",
        dob: newStudent.dob || null,
        age: newStudent.age || 0,
        phone: newStudent.primaryMobile || null,
        email: newStudent.email || null,
        father_name: newStudent.fatherName || null,
        mother_name: newStudent.motherName || null,
        guardian: newStudent.guardianName || null,
        program: newStudent.program || "General Academic Track",
        teacher: newStudent.teacher || "Unassigned",
        status: newStudent.status || "Active"
      };
      if (authUserId) studentRow.user_id = authUserId;

      await supabaseAdmin.from("students").upsert(studentRow, { onConflict: "student_id_code" });
    } catch (sbErr: any) {
      console.warn("Supabase student sync notice:", sbErr?.message);
    }
  })();

  // Multi-Email Dispatch Notification to Respected Student & Parent Email Addresses
  try {
    const recipients: Array<{ role: "STUDENT" | "PARENT" | "TEACHER" | "ACCOUNTANT" | "ADMIN"; email: string; name: string; phone: string }> = [];
    
    cleanStudentEmails.forEach(e => {
      recipients.push({ role: "STUDENT", email: e, name: newStudent.fullName, phone: newStudent.primaryMobile || "" });
    });
    
    cleanParentEmails.forEach(e => {
      recipients.push({ role: "PARENT", email: e, name: newStudent.fatherName || "Parent", phone: cleanParentPhones[0] || "" });
    });

    if (recipients.length === 0 && newStudent.email) {
      recipients.push({ role: "STUDENT", email: newStudent.email, name: newStudent.fullName, phone: newStudent.primaryMobile || "" });
    }

    recipients.push({ role: "ADMIN", email: "sivareddy683970@gmail.com", name: "System Administrator", phone: "" });

    await dispatchMultiChannelNotification({
      eventType: "PAYMENT_COMPLETED",
      subject: `🎉 Student Enrollment Registered — ${newStudent.fullName} (${newStudent.studentCode})`,
      message: `Dear ${newStudent.fullName} & Parent,\n\nCongratulations! Your student profile has been registered.\n\n📋 Dossier Summary:\n• Student Name: ${newStudent.fullName}\n• Student ID Code: ${newStudent.studentCode}\n• School: ${newStudent.school}\n• Grade: ${newStudent.grade}\n• Enrolled Courses: ${newStudent.allocatedCourses?.map(c => c.courseName).join(", ")}\n\n🔑 Student Portal Login Credentials:\n• Portal Email: ${newStudent.email}\n• Password: ${newStudent.password}\n\nThank you for choosing TopGrade CRM!`,
      recipients
    });
  } catch (err) {
    // Non-blocking log
  }

  return newStudent;
}

/**
 * Service method to update an existing student dossier by ID with real-time disk persistence.
 */
export async function updateStudentService(id: string, payload: Partial<StudentDossier>): Promise<StudentDossier> {
  const index = inMemoryStudentStore.findIndex(s => s.id === id || s.studentCode === id);
  const existing = inMemoryStudentStore[index];
  if (index === -1 || !existing) {
    throw new Error(`Student with ID or Code '${id}' not found.`);
  }

  const firstName = payload.firstName !== undefined ? payload.firstName.trim() : existing.firstName;
  const lastName = payload.lastName !== undefined ? payload.lastName.trim() : existing.lastName;
  const fullName = (firstName || lastName) ? `${firstName || ""} ${lastName || ""}`.trim() : (payload.fullName || existing.fullName);

  const dobStr = payload.dob || existing.dob;
  const age = payload.dob ? calculateAgeFromDOB(dobStr) : (payload.age ?? existing.age);

  if (payload.school !== undefined && !payload.school.trim()) {
    throw new Error("School Name is a mandatory field.");
  }

  const updated: StudentDossier = {
    ...existing,
    ...payload,
    firstName,
    lastName,
    fullName,
    dob: dobStr,
    age,
    school: payload.school !== undefined ? payload.school.trim() : existing.school,
    updatedAt: new Date().toISOString()
  };

  inMemoryStudentStore[index] = updated;
  saveStudentsToDisk();

  // Real-time Supabase Update Sync
  (async () => {
    try {
      const updateFields: any = {
        name: updated.fullName,
        gender: updated.gender || "Male",
        dob: updated.dob || null,
        age: updated.age || 0,
        phone: updated.primaryMobile || null,
        email: updated.email || null,
        father_name: updated.fatherName || null,
        mother_name: updated.motherName || null,
        guardian: updated.guardianName || null,
        program: updated.program || "General Academic Track",
        teacher: updated.teacher || "Unassigned",
        status: updated.status || "Active"
      };
      await supabaseAdmin.from("students").update(updateFields).eq("student_id_code", updated.studentCode);
    } catch (e: any) {
      console.warn("Supabase student update notice:", e?.message);
    }
  })();

  return updated;
}

/**
 * Service method to delete a student dossier by ID with disk persistence.
 */
export async function deleteStudentService(id: string): Promise<boolean> {
  const index = inMemoryStudentStore.findIndex(s => s.id === id || s.studentCode === id);
  if (index === -1) {
    throw new Error(`Student with ID '${id}' not found.`);
  }

  const removed = inMemoryStudentStore.splice(index, 1)[0];
  saveStudentsToDisk();

  // Real-time Supabase Delete Sync
  (async () => {
    try {
      if (removed?.studentCode) {
        await supabaseAdmin.from("students").delete().eq("student_id_code", removed.studentCode);
      }
    } catch (e: any) {
      console.warn("Supabase student delete notice:", e?.message);
    }
  })();

  return true;
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
  saveStudentsToDisk();

  // Real-time Supabase Status Toggle Sync
  (async () => {
    try {
      await supabaseAdmin.from("students").update({ status: targetStatus }).eq("student_id_code", current.studentCode);
    } catch (e: any) {
      console.warn("Supabase student status toggle notice:", e?.message);
    }
  })();

  return current;
}

/**
 * Service to change student password (ONE-TIME ONLY policy).
 * Automatically updates disk storage and notifies Admin & Accountant via email.
 */
export async function changeStudentPasswordService(params: {
  studentId?: string | undefined;
  email?: string | undefined;
  newPassword: string;
}) {
  const { studentId, email, newPassword } = params;
  if (!newPassword || newPassword.trim().length < 6) {
    throw new Error("New password must be at least 6 characters long.");
  }

  const queryEmail = (email || "").trim().toLowerCase();
  const student = inMemoryStudentStore.find(
    s => (studentId && (s.id === studentId || s.studentCode === studentId)) ||
         (queryEmail && s.email.toLowerCase() === queryEmail) ||
         (queryEmail && (s.studentEmails || []).some(e => e.toLowerCase() === queryEmail))
  );

  if (!student) {
    throw new Error("Student profile not found.");
  }

  if (student.passwordChangedCount && student.passwordChangedCount >= 1) {
    throw new Error("Password change limit reached (1-time allowed). Please request admin to reset your password.");
  }

  student.password = newPassword.trim();
  student.hasChangedPassword = true;
  student.passwordChangedCount = (student.passwordChangedCount || 0) + 1;
  student.passwordUpdatedAt = new Date().toISOString();
  student.updatedAt = new Date().toISOString();

  saveStudentsToDisk();

  // Real-time Supabase Auth Password Update
  (async () => {
    try {
      if (student.email) {
        const { data: userList } = await supabaseAdmin.auth.admin.listUsers();
        const user = userList?.users?.find(u => u.email?.toLowerCase() === student.email.toLowerCase());
        if (user) {
          await supabaseAdmin.auth.admin.updateUserById(user.id, { password: newPassword.trim() });
        }
      }
    } catch (e: any) {
      console.warn("Supabase student password update notice:", e?.message);
    }
  })();

  // Automatic email notification to Admin & Accountant
  try {
    await dispatchMultiChannelNotification({
      eventType: "PASSWORD_CHANGE_ALERT",
      subject: `🔑 Security Alert: Student Password Updated — ${student.fullName} (${student.studentCode})`,
      message: `Dear Administrator & Accountant,\n\nStudent ${student.fullName} (ID: ${student.studentCode}, Email: ${student.email}) has updated their portal login password.\n\nTime: ${new Date().toLocaleString()}\nStatus: 1-Time Self Service Used (Future changes require Admin reset)\n\nTopGrade Security Center`,
      recipients: [
        { role: "ADMIN", email: "sivareddy683970@gmail.com", name: "System Administrator" },
        { role: "ACCOUNTANT", email: "accountant@topgrade.edu", name: "Lead Accountant" }
      ]
    });
  } catch (emailErr) {
    console.warn("Notice dispatching password update email:", emailErr);
  }

  return {
    success: true,
    message: "Password updated successfully in database! (One-time policy recorded)",
    student: {
      id: student.id,
      studentCode: student.studentCode,
      fullName: student.fullName,
      email: student.email,
      hasChangedPassword: true,
      passwordChangedCount: 1
    }
  };
}

/**
 * Service to request a secondary password reset from Admin.
 */
export async function requestPasswordResetService(params: {
  studentId?: string | undefined;
  email?: string | undefined;
  studentName?: string | undefined;
}) {
  const { studentId, email, studentName } = params;
  const queryEmail = (email || "").trim().toLowerCase();
  const student = inMemoryStudentStore.find(
    s => (studentId && (s.id === studentId || s.studentCode === studentId)) ||
         (queryEmail && s.email.toLowerCase() === queryEmail) ||
         (studentName && s.fullName.toLowerCase() === studentName.toLowerCase())
  );

  const targetName = student ? student.fullName : (studentName || "Student");
  const targetEmail = student ? student.email : (email || "student@topgrade.edu");
  const targetCode = student?.studentCode || "TG-STU";

  try {
    await dispatchMultiChannelNotification({
      eventType: "PASSWORD_RESET_REQUEST",
      subject: `⚠️ Action Required: Password Reset Requested — ${targetName} (${targetCode})`,
      message: `Dear Administrator & Accountant,\n\nStudent ${targetName} (ID: ${targetCode}, Email: ${targetEmail}) has requested a secondary password reset after using their 1-time password change limit.\n\nPlease log in to the Admin Portal to manage their credentials.\n\nTopGrade Security Management`,
      recipients: [
        { role: "ADMIN", email: "sivareddy683970@gmail.com", name: "System Administrator" },
        { role: "ACCOUNTANT", email: "accountant@topgrade.edu", name: "Lead Accountant" }
      ]
    });
  } catch (err) {
    console.warn("Notice sending reset request email:", err);
  }

  return {
    success: true,
    message: "Password reset request dispatched to Admin and Accountant."
  };
}

/**
 * Service to determine user role and profile from login identifier with database precision.
 */
export async function verifyLoginRoleService(emailOrCode: string) {
  if (!emailOrCode || !emailOrCode.trim()) {
    return { success: true, role: "STUDENT" };
  }

  const query = emailOrCode.trim().toLowerCase();

  // 1. Exact match in Teachers Database (teacher.email, teacher.teacher_id_code, teacher.id)
  const matchingTeacher = inMemoryTeachers.find(
    t => t.email?.toLowerCase() === query ||
         t.teacher_id_code?.toLowerCase() === query ||
         t.id?.toLowerCase() === query
  );

  if (matchingTeacher) {
    return {
      success: true,
      role: "TEACHER",
      teacher: {
        id: matchingTeacher.id,
        teacher_id_code: matchingTeacher.teacher_id_code,
        fullName: matchingTeacher.name,
        name: matchingTeacher.name,
        email: matchingTeacher.email,
        phone: matchingTeacher.phone,
        qualification: matchingTeacher.qualification,
        specialization: matchingTeacher.specialization,
        availability_days: matchingTeacher.availability_days,
        availability_slots: matchingTeacher.availability_slots
      }
    };
  }

  // 2. Exact match in Students Database (s.email, studentEmails, studentCode)
  const matchingStudent = inMemoryStudentStore.find(
    s => s.email?.toLowerCase() === query ||
         s.studentCode?.toLowerCase() === query ||
         (s.studentEmails || []).some(e => e.toLowerCase() === query)
  );

  if (matchingStudent) {
    return {
      success: true,
      role: "STUDENT",
      student: {
        id: matchingStudent.id,
        studentCode: matchingStudent.studentCode,
        fullName: matchingStudent.fullName,
        email: matchingStudent.email,
        school: matchingStudent.school,
        grade: matchingStudent.grade,
        hasChangedPassword: !!matchingStudent.hasChangedPassword,
        passwordChangedCount: matchingStudent.passwordChangedCount || 0
      }
    };
  }

  // 3. Parent match
  const matchingParent = inMemoryStudentStore.find(
    s => (s.parentEmails || []).some(e => e.toLowerCase() === query)
  );
  if (matchingParent) {
    return {
      success: true,
      role: "PARENT",
      student: matchingParent
    };
  }

  // 4. System Roles
  if (query.includes("teacher")) return { success: true, role: "TEACHER" };
  if (query.includes("accountant")) return { success: true, role: "ACCOUNTANT" };
  if (query === "admin@topgrade.edu" || query.startsWith("admin@") || query.includes("admin_") || query === "admin") {
    return { success: true, role: "ADMIN" };
  }

  // Any other registered student email
  return { success: true, role: "STUDENT" };
}
