import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { dispatchMultiChannelNotification } from "./notificationService.js";
import { resolveTeacherIdentity } from "./teacherIdentity.js";
import { sendExamGoodLuckWishes, sendBirthdayGreetings } from "./automatedEmailService.js";
import { inMemoryTeachers } from "../routes/teachers.js";
import { supabaseAdmin } from "../supabase.js";
import { localScheduleStore } from "./scheduleDataService.js";

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
  studentAddress?: string | undefined;
  alternateAddress?: string | undefined;
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
  hoursLeft?: number | undefined;
  daysLeft?: number | undefined;
  attendedHours?: number | undefined;
  attendedSessions?: number | undefined;
  examDate?: string | undefined;
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

export function saveStudentsToDisk() {
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
let lastSupabaseStudentFetch = 0;

/**
 * Service method to retrieve paginated student records with search, filters, and RBAC accessibility.
 */
export async function getStudentsService(params: {
  page?: number | undefined;
  limit?: number | undefined;
  search?: string | undefined;
  status?: string | undefined;
  grade?: string | undefined;
  refresh?: boolean | undefined;
  currentUser?: { id?: string | undefined; email?: string | undefined; role?: string | undefined } | undefined;
}) {
  const page = params.page || 1;
  const limit = params.limit ? Number(params.limit) : 500;
  const search = (params.search || "").trim().toLowerCase();
  const statusFilter = (params.status || "ALL").toUpperCase();
  const gradeFilter = (params.grade || "ALL");
  const user = params.currentUser;

  if (params.refresh || Date.now() - lastSupabaseStudentFetch > 3000 || inMemoryStudentStore.length === 0) {
    try {
      const { data, error } = await supabaseAdmin.from("students").select("*").order("name", { ascending: true });
      if (!error && data && data.length > 0) {
        lastSupabaseStudentFetch = Date.now();
        inMemoryStudentStore = data.map((s: any) => {
          const existing = inMemoryStudentStore.find(ex => ex.id === s.id || ex.studentCode === s.student_id_code);
          const rawSchool = s.school || (s.address && s.address.includes("School: ") ? s.address.split("School: ")[1]?.trim() : (s.address && s.address.startsWith("School: ") ? s.address.replace("School: ", "").trim() : (existing?.school || "")));
          const rawGrade = s.grade || (s.nationality && s.nationality.startsWith("Grade: ") ? s.nationality.replace("Grade: ", "").trim() : (s.nationality || (s.age ? `Grade ${s.age > 12 ? 12 : s.age}` : (existing?.grade || "Grade 10"))));
          const cleanAddress = s.address ? s.address.split(" | School: ")[0]?.replace(/^School:.*$/, "").trim() : (existing?.residentialAddress || "");
          const studentAddress = s.student_address || s.alternate_address || existing?.studentAddress || "";
          const examDate = s.exam_date || (s.medical_notes && s.medical_notes.startsWith("EXAM_DATE:") ? s.medical_notes.replace("EXAM_DATE:", "") : (existing?.examDate || ""));

          return {
            id: s.id,
            studentCode: s.student_id_code || s.studentCode || existing?.studentCode || `TG-STU-${s.id?.slice(0, 4)}`,
            fullName: s.name || s.full_name || s.fullName || existing?.fullName || "Student",
            firstName: (s.name || "").split(" ")[0] || existing?.firstName || "Student",
            lastName: (s.name || "").split(" ").slice(1).join(" ") || existing?.lastName || "",
            email: s.email || existing?.email || "",
            dob: s.dob || existing?.dob || "2005-01-01",
            age: s.age || existing?.age || 18,
            school: rawSchool || "Top Grade Academy",
            grade: rawGrade || "Grade 10",
            status: (s.status || existing?.status || "ACTIVE").toUpperCase(),
            primaryMobile: s.phone || existing?.primaryMobile || "",
            studentPhones: s.student_phones || existing?.studentPhones || (s.phone ? [s.phone] : []),
            parentPhones: s.parent_phones || existing?.parentPhones || (s.father_phone ? [s.father_phone] : (s.phone ? [s.phone] : [])),
            studentWhatsapp: s.student_whatsapp || existing?.studentWhatsapp || s.phone || "",
            parentWhatsapp: s.parent_whatsapp || existing?.parentWhatsapp || (s.father_phone ? [s.father_phone] : []),
            studentEmails: s.student_emails || existing?.studentEmails || (s.email ? [s.email] : []),
            parentEmails: (s.parent_emails && s.parent_emails.length > 0) ? s.parent_emails : (existing?.parentEmails && existing.parentEmails.length > 0 ? existing.parentEmails : []),
            fatherName: s.father_name || existing?.fatherName || "",
            motherName: s.mother_name || existing?.motherName || "",
            guardianName: s.guardian || existing?.guardianName || "",
            program: s.program || existing?.program || "",
            teacher: s.teacher || existing?.teacher || "",
            residentialAddress: cleanAddress,
            studentAddress: studentAddress,
            alternateAddress: studentAddress,
            examDate: examDate,
            photoUrl: s.govt_id_url || s.photo_url || s.avatar_url || existing?.photoUrl || existing?.profileImageUrl || "",
            profileImageUrl: s.govt_id_url || s.photo_url || s.avatar_url || existing?.profileImageUrl || existing?.photoUrl || "",
            purchasedHours: 0,
            hoursLeft: 0,
            daysLeft: 0,
            feePlan: s.fee_plan || existing?.feePlan || "Standard Plan",
            allocatedCourses: (s.allocated_courses && s.allocated_courses.length > 0) ? s.allocated_courses : (existing?.allocatedCourses && existing.allocatedCourses.length > 0 ? existing.allocatedCourses : (s.program ? [{ courseName: s.program, duration: "3 Months" }] : []))
          };
        });
        saveStudentsToDisk();
      }
    } catch (err) {
      console.warn("Notice syncing students from Supabase:", err);
    }
  }

  let students = [...inMemoryStudentStore];

  // Role-based Access Filter
  if (user && user.role) {
    const roleUpper = user.role.toUpperCase();
    if (roleUpper === "STUDENT") {
      // Students see ONLY their own record
      students = students.filter(
        s => (user.id && s.id === user.id) ||
             (user.email && (s.email || "").toLowerCase() === user.email.toLowerCase()) ||
             (user.id && s.studentCode === user.id) ||
             (s.studentCode && (user as any).student_code && s.studentCode.toLowerCase() === (user as any).student_code.toLowerCase())
      );
    } else if (roleUpper === "PARENT") {
      // Parents see ONLY children whose parent email equals their login email.
      // Exact match only: no guessing from names, phone numbers or codes inside the email.
      const userEmail = (user.email || "").toLowerCase().trim();
      students = students.filter(s => {
        if (!userEmail) return false;
        const sEmails = (s.parentEmails || []).map(e => (e || "").toLowerCase().trim());
        return sEmails.includes(userEmail);
      });
    } else if (roleUpper === "TEACHER") {
      // Teachers see ONLY students assigned to them (exact id, code, email or exact name; never partial names).
      const ident = await resolveTeacherIdentity({ id: user.id, email: user.email });
      const n = (v: unknown) => String(v ?? "").trim().toLowerCase();
      students = students.filter(s => {
        const sTeacherId = n(s.assignedTeacherId);
        const sTeacher = n(s.teacher);
        const matchesDirect =
          (sTeacherId && ident.keys.has(sTeacherId)) ||
          (sTeacher && (ident.names.has(sTeacher) || ident.keys.has(sTeacher)));
        const matchesAlloc = Array.isArray(s.allocatedCourses) && s.allocatedCourses.some((ac: any) => {
          const acId = n(ac.teacherId);
          const acName = n(ac.teacher || ac.teacherName);
          return (acId && ident.keys.has(acId)) || (acName && ident.names.has(acName));
        });
        return !!(matchesDirect || matchesAlloc);
      });
    }
    // ADMIN sees ALL
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

  // Calculate hours, days left: currently every student must be ZERO as requested
  students = students.map(s => {
    const copy: any = { ...s };
    copy.purchasedHours = 0;
    copy.attendedSessions = 0;
    copy.attendedHours = 0;
    copy.hoursLeft = 0;
    copy.daysLeft = 0;

    // STRICT PRIVACY: only admin receives passwords and internal fields.
    const viewerRole = (user?.role || "").toUpperCase();
    if (viewerRole !== "ADMIN") {
      delete copy.password;
      delete copy.govtIdUrl;
      delete copy.govt_id_url;
      delete copy.medicalNotes;
      delete copy.medical_notes;
    }
    // Tutor cannot see fees, payment plans, invoices or financial details, nor parent contact details.
    if (viewerRole === "TEACHER") {
      delete copy.feePlan;
      delete copy.discount;
      delete copy.paymentMethod;
      delete copy.pricing_type;
      delete copy.parentEmails;
      delete copy.parentPhones;
      delete copy.parentWhatsapp;
      delete copy.residentialAddress;
      delete copy.emergencyContactName;
      delete copy.emergencyContactRelationship;
    }

    return copy;
  });

  // Guarantee strict alphabetical order (A to Z) by student's name
  students.sort((a, b) =>
    (a.fullName || (a as any).name || "").localeCompare(b.fullName || (b as any).name || "", undefined, { sensitivity: "base" })
  );

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
    email: (cleanStudentEmails[0] || payload.email || "").trim(),
    parentOccupation: payload.parentOccupation || "",
    emergencyContactName: payload.emergencyContactName || "",
    emergencyContactRelationship: payload.emergencyContactRelationship || "",
    residentialAddress: payload.residentialAddress || "",
    studentAddress: payload.studentAddress || payload.alternateAddress || "",
    alternateAddress: payload.studentAddress || payload.alternateAddress || "",
    examDate: payload.examDate || "",
    purchasedHours: payload.purchasedHours ? Number(payload.purchasedHours) : 20,
    officeAddress: payload.officeAddress || "",

    password: payload.password || "Student@TopGrade2026",
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
  lastSupabaseStudentFetch = 0; // invalidate cache

  // ─── Real-time Supabase Database & Auth Sync ───
  try {
    let authUserId: string | null = null;
    if (newStudent.email) {
      const studentEmail = newStudent.email.trim().toLowerCase();
      const studentPassword = newStudent.password || "Student@TopGrade2026";
      const { data: authCreated, error: authErr } = await supabaseAdmin.auth.admin.createUser({
        email: studentEmail,
        password: studentPassword,
        email_confirm: true,
        user_metadata: {
          full_name: newStudent.fullName,
          role: "STUDENT",
          student_code: newStudent.studentCode
        }
      });
      if (authCreated?.user) {
        authUserId = authCreated.user.id;
      } else if (authErr) {
        console.warn("Notice: student auth createUser:", authErr.message);
      }
      // Also record student in profiles table
      await supabaseAdmin.from("profiles").upsert({
        ...(authUserId ? { id: authUserId } : {}),
        email: studentEmail,
        full_name: newStudent.fullName,
        role: "STUDENT",
        status: "Active",
        updated_at: new Date().toISOString()
      }, { onConflict: "email" });
    }

    // Parent Auth & Profile in Supabase
    if (cleanParentEmails[0]) {
      const parentEmail = cleanParentEmails[0].trim().toLowerCase();
      const parentPassword = "Parent@TopGrade2026";
      let parentAuthId: string | null = null;
      try {
        const { data: pAuthCreated } = await supabaseAdmin.auth.admin.createUser({
          email: parentEmail,
          password: parentPassword,
          email_confirm: true,
          user_metadata: {
            full_name: newStudent.fatherName || newStudent.motherName || "Parent",
            role: "PARENT",
            student_code: newStudent.studentCode,
            student_name: newStudent.fullName
          }
        });
        if (pAuthCreated?.user) parentAuthId = pAuthCreated.user.id;
      } catch (pe: any) {
        console.warn("Parent admin.createUser notice:", pe?.message);
      }

      try {
        await supabaseAdmin.from("profiles").upsert({
          ...(parentAuthId ? { id: parentAuthId } : {}),
          email: parentEmail,
          full_name: newStudent.fatherName || newStudent.motherName || "Parent",
          role: "PARENT",
          status: "Active",
          updated_at: new Date().toISOString()
        }, { onConflict: "email" });
      } catch (pe: any) {
        console.warn("Parent profile upsert notice:", pe?.message);
      }
    }

    const sbAddress = newStudent.residentialAddress
      ? (newStudent.school ? `${newStudent.residentialAddress} | School: ${newStudent.school}` : newStudent.residentialAddress)
      : (newStudent.school ? `School: ${newStudent.school}` : "");
    const sbNationality = newStudent.grade
      ? (newStudent.grade.startsWith("Grade") ? newStudent.grade : `Grade: ${newStudent.grade}`)
      : null;

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
      father_phone: cleanParentPhones[0] || null,
      parent_emails: cleanParentEmails.map(e => e.trim().toLowerCase()),
      nationality: sbNationality,
      address: sbAddress,
      alternate_address: newStudent.studentAddress || newStudent.alternateAddress || "",
      purchased_hours: newStudent.purchasedHours || 20,
      govt_id_url: newStudent.profileImageUrl || newStudent.photoUrl || null,
      medical_notes: newStudent.examDate ? `EXAM_DATE:${newStudent.examDate}` : null,
      program: newStudent.program || "General Academic Track",
      teacher: newStudent.teacher || "Unassigned",
      status: newStudent.status || "ACTIVE"
    };
    if (authUserId) studentRow.user_id = authUserId;

    const { error: stuUpsertErr } = await supabaseAdmin.from("students").upsert(studentRow, { onConflict: "student_id_code" });
    if (stuUpsertErr) {
      console.warn("Supabase student upsert notice:", stuUpsertErr.message);
    }
  } catch (sbErr: any) {
    console.warn("Supabase student sync notice:", sbErr?.message);
  }

  // Automatic Birthday Wish Email Trigger if Birthday is today
  if (newStudent.dob) {
    const today = new Date();
    const curMonth = today.getMonth() + 1;
    const curDay = today.getDate();
    const parts = newStudent.dob.split(/[-/]/).map(Number);
    let isBirthdayToday = false;
    const [p0, p1, p2] = parts;
    if (p0 !== undefined && p1 !== undefined && p2 !== undefined) {
      if (p0 > 1900 && p1 === curMonth && p2 === curDay) isBirthdayToday = true;
      else if (p2 > 1900 && p1 === curMonth && p0 === curDay) isBirthdayToday = true;
    }
    if (isBirthdayToday) {
      sendBirthdayGreetings(newStudent).catch(err =>
        console.warn("Auto birthday greeting error:", err)
      );
    }
  }

  // Multi-Email Dispatch Notification to Respected Student & Parent Email Addresses
  try {
    const parentEmail = cleanParentEmails[0] || `parent.${(newStudent.fatherName || newStudent.firstName || "guardian").toLowerCase().replace(/[^a-z0-9]/g, "")}.${(newStudent.studentCode || "").replace(/[^0-9]/g, "") || Math.floor(1000 + Math.random() * 9000)}@parents.topgrade.edu`;
    const parentPassword = "Parent@TopGrade2026";

    const recipients: Array<{ role: "STUDENT" | "PARENT" | "TEACHER" | "ADMIN"; email: string; name: string; phone: string }> = [];
    
    cleanStudentEmails.forEach(e => {
      recipients.push({ role: "STUDENT", email: e, name: newStudent.fullName, phone: newStudent.primaryMobile || "" });
    });
    
    if (cleanParentEmails.length > 0) {
      cleanParentEmails.forEach(e => {
        recipients.push({ role: "PARENT", email: e, name: newStudent.fatherName || "Parent", phone: cleanParentPhones[0] || "" });
      });
    } else {
      recipients.push({ role: "PARENT", email: parentEmail, name: newStudent.fatherName || "Parent", phone: cleanParentPhones[0] || "" });
    }

    if (recipients.length === 0 && newStudent.email) {
      recipients.push({ role: "STUDENT", email: newStudent.email, name: newStudent.fullName, phone: newStudent.primaryMobile || "" });
    }

    const adminEmail = process.env.ADMIN_EMAIL || "tglbiz101@gmail.com";
    recipients.push({ role: "ADMIN", email: adminEmail, name: "System Administrator", phone: "" });

    await dispatchMultiChannelNotification({
      eventType: "PAYMENT_COMPLETED",
      subject: `🎉 Student Enrollment Registered — ${newStudent.fullName} (${newStudent.studentCode})`,
      message: `Dear ${newStudent.fullName} & Parent,\n\nCongratulations! Your student profile has been registered in TopGrade CRM.\n\n📋 Dossier Summary:\n• Student Name: ${newStudent.fullName}\n• Student ID Code: ${newStudent.studentCode}\n• School: ${newStudent.school}\n• Grade: ${newStudent.grade}\n• Enrolled Courses: ${newStudent.allocatedCourses?.map(c => c.courseName).join(", ")}\n\n🔑 Student Portal Login Credentials:\n• Portal Email: ${newStudent.email}\n• Password: ${newStudent.password}\n• Role: STUDENT\n\n👨‍👩‍👧 Parent Portal Login Credentials:\n• Parent Portal Email: ${parentEmail}\n• Password: ${parentPassword}\n• Role: PARENT\n• Parent Portal Features: Track your child's attendance, weekly schedule slots, fee receipts, and academic reports.\n\nThank you for choosing TopGrade CRM!`,
      recipients
    });
  } catch (err) {
    // Non-blocking log
  }

  return newStudent;
}

/**
 * Service to dispatch Parent Credentials specifically on demand
 */
export async function sendParentCredentialsService(studentIdOrCode: string): Promise<{ success: boolean; message: string; parentEmail: string }> {
  const isUUID = (str?: string | null): boolean =>
    !!str && /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(str);

  let student = inMemoryStudentStore.find(s => s.id === studentIdOrCode || s.studentCode === studentIdOrCode);
  if (!student) {
    try {
      let sbQuery = supabaseAdmin.from("students").select("*");
      if (isUUID(studentIdOrCode)) {
        sbQuery = sbQuery.eq("id", studentIdOrCode);
      } else {
        sbQuery = sbQuery.eq("student_id_code", studentIdOrCode);
      }
      const { data } = await sbQuery.maybeSingle();
      if (data) {
        student = {
          id: data.id,
          studentCode: data.student_id_code,
          fullName: data.name,
          firstName: (data.name || "").split(" ")[0] || "Student",
          lastName: (data.name || "").split(" ").slice(1).join(" ") || "",
          email: data.email,
          dob: data.dob || "2005-01-01",
          age: data.age || 18,
          school: data.school || "Top Grade Academy",
          grade: data.grade || "Grade 10",
          status: data.status || "ACTIVE",
          primaryMobile: data.phone || "",
          studentPhones: [data.phone || ""].filter(Boolean),
          parentPhones: [data.father_phone || ""].filter(Boolean),
          studentEmails: [data.email || ""].filter(Boolean),
          parentEmails: [],
          fatherName: data.father_name || "Parent",
          motherName: data.mother_name || "",
          guardianName: data.guardian || "",
          program: data.program || "General Track",
          teacher: data.teacher || "Unassigned",
          allocatedCourses: data.allocated_courses || [],
          password: data.password || "Student@123"
        } as any;
      }
    } catch (e) {}
  }

  if (!student) {
    throw new Error(`Student record not found for ID/Code '${studentIdOrCode}'.`);
  }

  const cleanParentEmails = (student.parentEmails || []).filter(e => e && e.includes("@"));
  const defaultParentEmail = `parent.${(student.fatherName || student.firstName || "guardian").toLowerCase().replace(/[^a-z0-9]/g, "")}.${(student.studentCode || "").replace(/[^0-9]/g, "") || "2026"}@parents.topgrade.edu`;
  const parentEmail = cleanParentEmails[0] || defaultParentEmail;
  const parentPassword = "Parent@TopGrade2026";
  const parentName = student.fatherName || student.motherName || student.guardianName || `${student.fullName}'s Parent`;

  // Ensure Parent User exists in Supabase Auth & profiles
  try {
    const { data: pAuth } = await supabaseAdmin.auth.admin.createUser({
      email: parentEmail,
      password: parentPassword,
      email_confirm: true,
      user_metadata: {
        role: "PARENT",
        full_name: parentName,
        child_code: student.studentCode,
        child_codes: [student.studentCode],
        child_name: student.fullName
      }
    });

    await supabaseAdmin.from("profiles").upsert({
      ...(pAuth?.user?.id ? { id: pAuth.user.id } : {}),
      email: parentEmail,
      full_name: parentName,
      role: "PARENT",
      status: "Active",
      updated_at: new Date().toISOString()
    }, { onConflict: "email" });
  } catch (authErr) {
    // If user already exists, update their metadata
    try {
      const { data: userList } = await supabaseAdmin.auth.admin.listUsers();
      const existingUser = userList?.users?.find(u => u.email?.toLowerCase() === parentEmail.toLowerCase());
      if (existingUser) {
        await supabaseAdmin.auth.admin.updateUserById(existingUser.id, {
          user_metadata: {
            ...existingUser.user_metadata,
            role: "PARENT",
            full_name: parentName,
            child_code: student.studentCode,
            child_codes: Array.from(new Set([...(existingUser.user_metadata?.child_codes || []), student.studentCode])),
            child_name: student.fullName
          }
        });
      }
    } catch {}
  }

  // Dispatch Email
  const recipients = [
    { role: "PARENT" as const, email: parentEmail, name: parentName, phone: student.parentPhones?.[0] || "" },
    { role: "ADMIN" as const, email: process.env.ADMIN_EMAIL || "tglbiz101@gmail.com", name: "TopGrade Admin", phone: "" }
  ];

  await dispatchMultiChannelNotification({
    eventType: "PAYMENT_COMPLETED",
    subject: `🔑 TopGrade CRM — Parent Portal Access Credentials for ${student.fullName}`,
    message: `Dear ${parentName},\n\nHere are your official TopGrade CRM Parent Portal credentials to access your child's academic schedules, attendance records, course streams, and tuition statements:\n\n👤 Student Information:\n• Student Name: ${student.fullName}\n• Student ID Code: ${student.studentCode}\n• School: ${student.school || "Top Grade Academy"}\n• Grade: ${student.grade || "General"}\n\n🔑 Parent Login Credentials:\n• Parent Portal Email: ${parentEmail}\n• Password: ${parentPassword}\n• Role: PARENT\n\n🌐 Sign In: You can sign in using these credentials at the TopGrade CRM login screen.\n\nThank you,\nTopGrade CRM Administration`,
    recipients
  });

  return {
    success: true,
    message: `Parent credentials successfully dispatched to '${parentEmail}'.`,
    parentEmail
  };
}

/**
 * Service method to update an existing student dossier by ID with real-time disk persistence.
 */
export async function updateStudentService(id: string, payload: Partial<StudentDossier>): Promise<StudentDossier> {
  const isUUID = (str?: string | null): boolean =>
    !!str && /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(str);

  let index = inMemoryStudentStore.findIndex(s => s.id === id || s.studentCode === id);
  if (index === -1) {
    // If not found in memory, try looking up in Supabase
    try {
      let sbQuery = supabaseAdmin.from("students").select("*");
      if (isUUID(id)) {
        sbQuery = sbQuery.eq("id", id);
      } else {
        sbQuery = sbQuery.eq("student_id_code", id);
      }
      const { data: sbRow } = await sbQuery.maybeSingle();

      if (sbRow) {
        const rawSchool = sbRow.school || (sbRow.address && sbRow.address.includes("School: ") ? sbRow.address.split("School: ")[1]?.trim() : (sbRow.address && sbRow.address.startsWith("School: ") ? sbRow.address.replace("School: ", "").trim() : ""));
        const rawGrade = sbRow.grade || (sbRow.nationality && sbRow.nationality.startsWith("Grade: ") ? sbRow.nationality.replace("Grade: ", "").trim() : (sbRow.nationality || (sbRow.age ? `Grade ${sbRow.age > 12 ? 12 : sbRow.age}` : "Grade 10")));
        const cleanAddress = sbRow.address ? sbRow.address.split(" | School: ")[0]?.replace(/^School:.*$/, "").trim() : "";
        const examDate = sbRow.exam_date || (sbRow.medical_notes && sbRow.medical_notes.startsWith("EXAM_DATE:") ? sbRow.medical_notes.replace("EXAM_DATE:", "") : "");

        const restored: StudentDossier = {
          id: sbRow.id,
          studentCode: sbRow.student_id_code || `TG-STU-${sbRow.id?.slice(0, 4)}`,
          fullName: sbRow.name || "Student",
          firstName: (sbRow.name || "").split(" ")[0] || "Student",
          lastName: (sbRow.name || "").split(" ").slice(1).join(" ") || "",
          email: sbRow.email,
          dob: sbRow.dob || "2005-01-01",
          age: sbRow.age || 18,
          school: rawSchool || "Top Grade Academy",
          grade: rawGrade || "Grade 10",
          status: (sbRow.status || "ACTIVE").toUpperCase(),
          primaryMobile: sbRow.phone || "",
          studentPhones: sbRow.phone ? [sbRow.phone] : [],
          parentPhones: sbRow.father_phone ? [sbRow.father_phone] : [],
          studentEmails: sbRow.email ? [sbRow.email] : [],
          parentEmails: Array.isArray(sbRow.parent_emails) ? sbRow.parent_emails : [],
          fatherName: sbRow.father_name || "",
          motherName: sbRow.mother_name || "",
          guardianName: sbRow.guardian || "",
          program: sbRow.program || "",
          teacher: sbRow.teacher || "",
          residentialAddress: cleanAddress,
          studentAddress: sbRow.alternate_address || "",
          alternateAddress: sbRow.alternate_address || "",
          examDate: examDate,
          purchasedHours: Number(sbRow.purchased_hours) || 20,
          feePlan: sbRow.fee_plan || "Standard Plan",
          allocatedCourses: sbRow.program ? [{ courseName: sbRow.program, duration: "3 Months" }] : []
        };
        inMemoryStudentStore.push(restored);
        index = inMemoryStudentStore.length - 1;
      }
    } catch (findErr: any) {
      console.warn("Supabase student find notice:", findErr?.message);
    }
  }

  const existing = inMemoryStudentStore[index];
  if (index === -1 || !existing) {
    throw new Error(`Student with ID or Code '${id}' not found.`);
  }

  const firstName = payload.firstName !== undefined ? payload.firstName.trim() : (payload.fullName ? payload.fullName.split(" ")[0] : existing.firstName);
  const lastName = payload.lastName !== undefined ? payload.lastName.trim() : (payload.fullName ? payload.fullName.split(" ").slice(1).join(" ") : existing.lastName);
  const fullName = payload.fullName ? payload.fullName.trim() : ((firstName || lastName) ? `${firstName || ""} ${lastName || ""}`.trim() : existing.fullName);

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
  lastSupabaseStudentFetch = Date.now(); // Keep updated memory cache active

  // Real-time Supabase Update Sync
  try {
    const sbAddress = updated.residentialAddress
      ? (updated.school ? `${updated.residentialAddress} | School: ${updated.school}` : updated.residentialAddress)
      : (updated.school ? `School: ${updated.school}` : "");
    const sbNationality = updated.grade
      ? (updated.grade.startsWith("Grade") ? updated.grade : `Grade: ${updated.grade}`)
      : null;

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
      father_phone: (updated.parentPhones && updated.parentPhones[0]) || updated.primaryMobile || null,
      parent_emails: (updated.parentEmails || []).map((e: string) => e.trim().toLowerCase()),
      nationality: sbNationality,
      address: sbAddress,
      alternate_address: updated.studentAddress || updated.alternateAddress || "",
      purchased_hours: updated.purchasedHours || 0,
      govt_id_url: updated.profileImageUrl || updated.photoUrl || null,
      medical_notes: updated.examDate ? `EXAM_DATE:${updated.examDate}` : null,
      program: updated.program || "General Academic Track",
      teacher: updated.teacher || "Unassigned",
      status: (updated.status || "ACTIVE").toUpperCase()
    };

    const targetIdToUpdate = isUUID(updated.id) ? updated.id : (isUUID(id) ? id : null);
    if (targetIdToUpdate) {
      const { error: sbErr } = await supabaseAdmin.from("students").update(updateFields).eq("id", targetIdToUpdate);
      if (sbErr) console.warn("Notice updating student by id in Supabase:", sbErr.message);
    } else {
      const codeToUpdate = updated.studentCode || id;
      const { error: sbErr } = await supabaseAdmin.from("students").update(updateFields).eq("student_id_code", codeToUpdate);
      if (sbErr) console.warn("Notice updating student by code in Supabase:", sbErr.message);
    }

    // Update profiles table in Supabase if email exists
    if (updated.email) {
      try {
        const photoCdnUrl = updated.profileImageUrl || updated.photoUrl || null;
        if (existing.email && existing.email.toLowerCase() !== updated.email.toLowerCase()) {
          await supabaseAdmin.from("profiles").update({
            email: updated.email,
            full_name: updated.fullName,
            avatar_url: photoCdnUrl,
            updated_at: new Date().toISOString()
          }).eq("email", existing.email);
        } else {
          await supabaseAdmin.from("profiles").upsert({
            email: updated.email,
            full_name: updated.fullName,
            avatar_url: photoCdnUrl,
            role: "STUDENT",
            status: "Active",
            updated_at: new Date().toISOString()
          }, { onConflict: "email" });
        }
      } catch (profErr: any) {
        console.warn("Supabase profiles update notice:", profErr?.message);
      }
    }
  } catch (e: any) {
    console.warn("Supabase student update notice:", e?.message);
  }

  // Silent mutation: Unsolicited profile update & exam emails purged per privacy isolation standards
  return updated;
}

/**
 * Service method to delete a student dossier by ID with disk persistence.
 */
export async function deleteStudentService(id: string): Promise<boolean> {
  const index = inMemoryStudentStore.findIndex(s => s.id === id || s.studentCode === id);
  let removed: any = null;
  if (index !== -1) {
    removed = inMemoryStudentStore.splice(index, 1)[0];
    saveStudentsToDisk();
  }
  lastSupabaseStudentFetch = 0;

  // Real-time Supabase Cascade Delete Sync
  try {
    const isUUID = (str?: string | null): boolean =>
      !!str && /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(str);

    const targetStudentId = removed?.id || (isUUID(id) ? id : null);
    const targetStudentCode = removed?.studentCode || (!isUUID(id) ? id : null);
    const targetStudentName = removed?.fullName;
    const targetStudentEmail = removed?.email;

    // 1. Delete from students table
    if (targetStudentId && isUUID(targetStudentId)) {
      await supabaseAdmin.from("students").delete().eq("id", targetStudentId);
    }
    if (targetStudentCode) {
      await supabaseAdmin.from("students").delete().eq("student_id_code", targetStudentCode);
    }
    if (targetStudentEmail) {
      await supabaseAdmin.from("students").delete().eq("email", targetStudentEmail);
      await supabaseAdmin.from("profiles").delete().eq("email", targetStudentEmail);
    }

    // 2. Delete from schedule_students table
    if (targetStudentId) {
      await supabaseAdmin.from("schedule_students").delete().eq("student_id", targetStudentId);
    }
    if (targetStudentCode) {
      await supabaseAdmin.from("schedule_students").delete().eq("student_code", targetStudentCode);
    }

    // 3. Delete from attendance table
    if (targetStudentId) {
      await supabaseAdmin.from("attendance").delete().eq("student_id", targetStudentId);
    }
    if (targetStudentName) {
      await supabaseAdmin.from("attendance").delete().eq("student_name", targetStudentName);
    }

    // 4. Delete from fees table
    if (targetStudentId) {
      await supabaseAdmin.from("fees").delete().eq("student_id", targetStudentId);
    }
    if (targetStudentCode) {
      await supabaseAdmin.from("fees").delete().eq("student_code", targetStudentCode);
    }

    // 5. Delete from parent_students table
    if (targetStudentId) {
      await supabaseAdmin.from("parent_students").delete().eq("student_id", targetStudentId);
    }

    // 6. Remove from local schedule store slots
    try {
      const allSchedules = localScheduleStore.getAllSchedules();
      for (const slot of allSchedules) {
        if (slot.students && slot.students.length > 0) {
          const filteredStudents = slot.students.filter(
            (st: any) => st.student_id !== targetStudentId && 
                  st.student_id !== targetStudentCode && 
                  st.student_code !== targetStudentCode &&
                  st.student_name !== targetStudentName
          );
          if (filteredStudents.length !== slot.students.length) {
            localScheduleStore.saveSchedule({
              ...slot,
              students: filteredStudents,
              updated_at: new Date().toISOString()
            });
          }
        }
      }
    } catch (schErr) {
      console.warn("Notice updating local schedules on student delete:", schErr);
    }

  } catch (e: any) {
    console.warn("Supabase student cascade delete notice:", e?.message);
  }

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
 * Automatically updates disk storage and notifies Admin via email.
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

  // Automatic email notification to Admin
  try {
    await dispatchMultiChannelNotification({
      eventType: "PASSWORD_CHANGE_ALERT",
      subject: `🔑 Security Alert: Student Password Updated — ${student.fullName} (${student.studentCode})`,
      message: `Dear Administrator,\n\nStudent ${student.fullName} (ID: ${student.studentCode}, Email: ${student.email}) has updated their portal login password.\n\nTime: ${new Date().toLocaleString()}\nStatus: 1-Time Self Service Used (Future changes require Admin reset)\n\nTopGrade Security Center`,
      recipients: [
        { role: "ADMIN", email: process.env.ADMIN_EMAIL || "tglbiz101@gmail.com", name: "System Administrator" }
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
      message: `Dear Administrator,\n\nStudent ${targetName} (ID: ${targetCode}, Email: ${targetEmail}) has requested a secondary password reset after using their 1-time password change limit.\n\nPlease log in to the Admin Portal to manage their credentials.\n\nTopGrade Security Management`,
      recipients: [
        { role: "ADMIN", email: process.env.ADMIN_EMAIL || "tglbiz101@gmail.com", name: "System Administrator" }
      ]
    });
  } catch (err) {
    console.warn("Notice sending reset request email:", err);
  }

  return {
    success: true,
    message: "Password reset request dispatched to Administrator."
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
      student: matchingStudent
    };
  }

  // 2. Check Parent Database
  const matchingParent = inMemoryStudentStore.find(
    s => s.parentEmails?.some(e => e.toLowerCase() === query)
  );

  if (matchingParent) {
    return {
      success: true,
      role: "PARENT",
      student: matchingParent
    };
  }

  // 3. System Roles
  const configuredAdmin = (process.env.ADMIN_EMAIL || "").toLowerCase();
  if (
    (configuredAdmin && query === configuredAdmin) ||
    query === "tglbiz101@gmail.com" ||
    query === "admin@topgrade.edu" ||
    query.startsWith("admin@") ||
    query.includes("admin_") ||
    query === "admin"
  ) {
    return { success: true, role: "ADMIN" };
  }
  if (query.includes("teacher")) return { success: true, role: "TEACHER" };

  // Any other registered student email
  return { success: true, role: "STUDENT" };
}

/**
 * Service method to force-reload student records live from Supabase, bypassing in-memory cache.
 */
export async function reloadStudentsService(): Promise<StudentDossier[]> {
  lastSupabaseStudentFetch = 0;
  const result = await getStudentsService({ limit: 1000, refresh: true });
  return result.data;
}

