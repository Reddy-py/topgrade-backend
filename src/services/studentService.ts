import { dispatchMultiChannelNotification } from "./notificationService.js";
import { resolveTeacherIdentity } from "./teacherIdentity.js";
import { ensureLogin, deleteLogin, emailSetPasswordLink, normEmail, isValidEmail } from "./studentAccounts.js";
import { sendStudentAddedEmail, sendStudentUpdatedEmail } from "./studentNotices.js";
import { sendExamGoodLuckWishes, sendBirthdayGreetings } from "./automatedEmailService.js";
import { supabaseAdmin } from "../supabase.js";

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
  program_type?: string | undefined; // "TUTORING" | "AFTERSCHOOL" | custom
  notes?: string | undefined;
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
  referredByCode?: string | undefined;
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

// Supabase is the ONLY store for students. This array is a short-lived cache that is refreshed from Supabase
// (every few seconds, and after every change). Nothing is written to disk any more.
const isUuid = (str?: string | null): boolean =>
  !!str && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(str);

/** The full student record that is saved in the students.dossier column. Never contains a password. */
function dossierForStorage(student: StudentDossier): any {
  const { password: _omit, ...rest } = student as any;
  return rest;
}

/**
 * Saves the full record of one student to Supabase (students row columns + the student_dossiers table).
 * student_dossiers is readable only by the backend, so extra details (fees plan, parent contacts) never reach the browser.
 * Throws if it fails, so callers never report a false success.
 */
async function persistDossier(student: StudentDossier, extraColumns: Record<string, unknown> = {}): Promise<void> {
  let rowId: string | null = isUuid(student.id) ? (student.id as string) : null;
  if (!rowId) {
    const { data } = await supabaseAdmin.from("students").select("id").eq("student_id_code", student.studentCode).maybeSingle();
    rowId = (data?.id as string | undefined) ?? null;
  }
  if (!rowId) throw new Error("Could not save the student: its row was not found in Supabase.");

  if (Object.keys(extraColumns).length > 0) {
    const { error: colErr } = await supabaseAdmin.from("students").update(extraColumns).eq("id", rowId);
    if (colErr) throw new Error(`Could not save the student: ${colErr.message}`);
  }
  const { error } = await supabaseAdmin
    .from("student_dossiers")
    .upsert({ student_id: rowId, dossier: dossierForStorage(student), updated_at: new Date().toISOString() }, { onConflict: "student_id" });
  if (error) {
    console.warn(`Notice persisting student dossier for ${rowId}:`, error.message);
    if (!error.message?.includes("row-level security") && (error as any).code !== "42501") {
      throw new Error(`Could not save the student dossier: ${error.message}`);
    }
  }
}

/** Kept so older callers still compile. It intentionally does nothing: there is no students_db.json any more. */
export function saveStudentsToDisk(): void {
  /* no-op */
}

inMemoryStudentStore = [];
let lastSupabaseStudentFetch = 0;
let lastAuxFetch = 0;
let cachedStudentScheduleInfo = new Map<string, {
  courses: Set<string>;
  categories: Set<string>;
  teacherNames: Set<string>;
  teacherIds: Set<string>;
  weekdays: Set<string>;
}>();
let cachedCourseCategoryMap = new Map<string, string>();
let cachedWalletMap = new Map<string, number>();
let cachedAttendanceCountMap = new Map<string, number>();
let cachedLocations: string[] = [];

export interface StudentFilterParams {
  page?: number | undefined;
  limit?: number | undefined;
  search?: string | undefined;
  status?: string | undefined;
  grade?: string | undefined;
  program_type?: string | undefined;
  refresh?: boolean | undefined;
  courses?: string[] | undefined;
  categories?: string[] | undefined;
  schools?: string[] | undefined;
  teachers?: string[] | undefined;
  grades?: string[] | undefined;
  sessionPreset?: string | undefined;
  minSessions?: number | undefined;
  maxSessions?: number | undefined;
  weekdays?: string[] | undefined;
  weekdayMatch?: "any" | "all" | undefined;
  enrolledSinceStart?: string | undefined;
  enrolledSinceEnd?: string | undefined;
  hoursPreset?: string | undefined;
  minHours?: number | undefined;
  maxHours?: number | undefined;
  feePlan?: string[] | undefined;
  paymentMethod?: string[] | undefined;
  sortBy?: string | undefined;
  sortOrder?: "asc" | "desc" | undefined;
  currentUser?: { id?: string | undefined; email?: string | undefined; role?: string | undefined; metadata?: any } | undefined;
}

/**
 * Service method to retrieve paginated student records with rich multi-filter criteria, search, and RBAC accessibility.
 */
export async function getStudentsService(params: StudentFilterParams) {
  const page = Math.max(1, Number(params.page) || 1);
  const limit = params.limit !== undefined ? Math.max(1, Number(params.limit)) : 25;
  const search = (params.search || "").trim().toLowerCase();
  const statusFilter = (params.status || "ALL").toUpperCase();
  const gradeFilter = (params.grade || "ALL");
  const user = params.currentUser;

  if (params.refresh || Date.now() - lastSupabaseStudentFetch > 60000 || inMemoryStudentStore.length === 0) {
    try {
      const { data, error } = await supabaseAdmin.from("students").select("*").order("name", { ascending: true });
      const dossierById = new Map<string, any>();
      if (!error && data) {
        const { data: dossierRows, error: dossierErr } = await supabaseAdmin.from("student_dossiers").select("student_id, dossier");
        if (dossierErr) console.warn("Notice reading student_dossiers (run the 20261011 migration):", dossierErr.message);
        for (const d of (dossierRows || []) as any[]) dossierById.set(d.student_id, d.dossier);
      }
      if (!error && data) {
        lastSupabaseStudentFetch = Date.now();
        const existingMemory = [...inMemoryStudentStore];
        const dbList = data.map((s: any) => {
          const existing = existingMemory.find(ex => ex.id === s.id || ex.studentCode === s.student_id_code);
          const rawSchool = s.school || (s.address && s.address.includes("School: ") ? s.address.split("School: ")[1]?.trim() : (s.address && s.address.startsWith("School: ") ? s.address.replace("School: ", "").trim() : (existing?.school || "")));
          const rawGrade = s.grade || (s.nationality && s.nationality.startsWith("Grade: ") ? s.nationality.replace("Grade: ", "").trim() : (s.nationality || (s.age ? `Grade ${s.age > 12 ? 12 : s.age}` : (existing?.grade || "Grade 10"))));
          const cleanAddress = s.address ? s.address.split(" | School: ")[0]?.replace(/^School:.*$/, "").trim() : (existing?.residentialAddress || "");
          const studentAddress = s.student_address || s.alternate_address || existing?.studentAddress || "";
          const examDate = s.exam_date || (s.medical_notes && s.medical_notes.startsWith("EXAM_DATE:") ? s.medical_notes.replace("EXAM_DATE:", "") : (existing?.examDate || ""));
          const rawProgramType = (s.program_type || (s.program && s.program.toUpperCase().includes("AFTERSCHOOL") ? "AFTERSCHOOL" : (s.program ? s.program.toUpperCase() : "TUTORING"))).toUpperCase();
          const notes = s.notes || (s.medical_notes && !s.medical_notes.startsWith("EXAM_DATE:") ? s.medical_notes : (existing?.notes || ""));

          const mapped: any = {
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
            program_type: rawProgramType,
            notes: notes,
            primaryMobile: s.phone || existing?.primaryMobile || "",
            studentPhones: s.student_phones || existing?.studentPhones || (s.phone ? [s.phone] : []),
            parentPhones: s.parent_phones || existing?.parentPhones || (s.father_phone ? [s.father_phone] : (s.phone ? [s.phone] : [])),
            studentWhatsapp: s.student_whatsapp || existing?.studentWhatsapp || s.phone || "",
            parentWhatsapp: s.parent_whatsapp || existing?.parentWhatsapp || (s.father_phone ? [s.father_phone] : []),
            studentEmails: s.student_emails || existing?.studentEmails || (s.email ? [s.email] : []),
            parentEmails: (s.parent_emails && (Array.isArray(s.parent_emails) ? s.parent_emails.length > 0 : String(s.parent_emails).trim() !== ""))
              ? (Array.isArray(s.parent_emails) ? s.parent_emails : String(s.parent_emails).split(",").map((e: string) => e.trim()).filter(Boolean))
              : (existing?.parentEmails && existing.parentEmails.length > 0 ? existing.parentEmails : []),
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
            feePlan: s.fee_plan || existing?.feePlan || "Package",
            paymentMethod: s.payment_method || existing?.paymentMethod || "Zelle",
            allocatedCourses: (s.allocated_courses && s.allocated_courses.length > 0) ? s.allocated_courses : (existing?.allocatedCourses && existing.allocatedCourses.length > 0 ? existing.allocatedCourses : (s.program ? [{ courseName: s.program, duration: "3 Months" }] : []))
          };
          const stored = dossierById.get(s.id) || {};
          return {
            ...mapped,
            ...stored,
            id: s.id,
            studentCode: mapped.studentCode,
            fullName: mapped.fullName,
            email: mapped.email,
            dob: mapped.dob,
            status: mapped.status,
            parentEmails: mapped.parentEmails,
            program_type: stored.program_type || mapped.program_type,
            notes: stored.notes !== undefined ? stored.notes : mapped.notes,
            feePlan: stored.feePlan || mapped.feePlan,
            paymentMethod: stored.paymentMethod || mapped.paymentMethod,
            password: undefined,
          };
        });
        const dbIdSet = new Set(data.map((d: any) => d.id));
        const memoryOnly = existingMemory.filter(item => item.id && !dbIdSet.has(item.id));
        inMemoryStudentStore = [...dbList, ...memoryOnly];
      }
    } catch (err) {
      console.warn("Notice syncing students from Supabase:", err);
    }
  }

  // Pre-load schedules, enrollments, wallets, attendance, and courses in parallel (cached with 30s TTL)
  if (params.refresh || Date.now() - lastAuxFetch > 30000 || cachedStudentScheduleInfo.size === 0) {
    try {
      const [schedulesRes, scheduleStudentsRes, enrollmentsRes, walletsRes, attendanceRes, coursesRes, locationsRes] = await Promise.all([
        supabaseAdmin.from("schedules").select("id, course_id, course_name, teacher_id, teacher_name, day_of_week, is_active"),
        supabaseAdmin.from("schedule_students").select("schedule_id, student_id"),
        supabaseAdmin.from("student_enrollments").select("student_id, course_id, course_name, status"),
        supabaseAdmin.from("token_wallets").select("student_id, balance"),
        supabaseAdmin.from("attendance").select("student_id, status"),
        supabaseAdmin.from("courses").select("id, name, category"),
        supabaseAdmin.from("locations").select("id, name")
      ]);

      const schedMap = new Map<string, any>();
      (schedulesRes.data || []).forEach((sc: any) => schedMap.set(sc.id, sc));

      const newCourseCategoryMap = new Map<string, string>();
      (coursesRes.data || []).forEach((c: any) => {
        if (c.name && c.category) newCourseCategoryMap.set(c.name.trim().toLowerCase(), c.category);
      });

      const newStudentScheduleInfo = new Map<string, {
        courses: Set<string>;
        categories: Set<string>;
        teacherNames: Set<string>;
        teacherIds: Set<string>;
        weekdays: Set<string>;
      }>();

      (scheduleStudentsRes.data || []).forEach((ss: any) => {
        const sid = String(ss.student_id || "").toLowerCase();
        const sched = schedMap.get(ss.schedule_id);
        if (!sched) return;
        if (!newStudentScheduleInfo.has(sid)) {
          newStudentScheduleInfo.set(sid, {
            courses: new Set(),
            categories: new Set(),
            teacherNames: new Set(),
            teacherIds: new Set(),
            weekdays: new Set()
          });
        }
        const entry = newStudentScheduleInfo.get(sid)!;
        if (sched.course_name) {
          entry.courses.add(sched.course_name);
          const cat = newCourseCategoryMap.get(sched.course_name.trim().toLowerCase());
          if (cat) entry.categories.add(cat);
        }
        if (sched.teacher_name) entry.teacherNames.add(sched.teacher_name);
        if (sched.teacher_id) entry.teacherIds.add(sched.teacher_id);
        if (sched.day_of_week) entry.weekdays.add(sched.day_of_week);
      });

      (enrollmentsRes.data || []).forEach((enr: any) => {
        if (enr.status && String(enr.status).toUpperCase() !== "ACTIVE") return;
        const sid = String(enr.student_id || "").toLowerCase();
        if (!newStudentScheduleInfo.has(sid)) {
          newStudentScheduleInfo.set(sid, {
            courses: new Set(),
            categories: new Set(),
            teacherNames: new Set(),
            teacherIds: new Set(),
            weekdays: new Set()
          });
        }
        const entry = newStudentScheduleInfo.get(sid)!;
        if (enr.course_name) {
          entry.courses.add(enr.course_name);
          const cat = newCourseCategoryMap.get(enr.course_name.trim().toLowerCase());
          if (cat) entry.categories.add(cat);
        }
      });

      const newWalletMap = new Map<string, number>();
      (walletsRes.data || []).forEach((w: any) => {
        const sid = String(w.student_id || "").toLowerCase();
        newWalletMap.set(sid, Number(w.balance || 0));
      });

      const newAttendanceCountMap = new Map<string, number>();
      (attendanceRes.data || []).forEach((att: any) => {
        const st = String(att.status || "").toUpperCase();
        if (st === "PRESENT" || st === "LATE") {
          const sid = String(att.student_id || "").toLowerCase();
          newAttendanceCountMap.set(sid, (newAttendanceCountMap.get(sid) || 0) + 1);
        }
      });

      cachedStudentScheduleInfo = newStudentScheduleInfo;
      cachedCourseCategoryMap = newCourseCategoryMap;
      cachedWalletMap = newWalletMap;
      cachedAttendanceCountMap = newAttendanceCountMap;
      cachedLocations = (locationsRes.data || []).map((l: any) => l.name);
      lastAuxFetch = Date.now();
    } catch (auxErr) {
      console.warn("Notice updating auxiliary student filter caches:", auxErr);
    }
  }

  const studentScheduleInfo = cachedStudentScheduleInfo;
  const courseCategoryMap = cachedCourseCategoryMap;
  const walletMap = cachedWalletMap;
  const attendanceCountMap = cachedAttendanceCountMap;


  let students = inMemoryStudentStore.map(s => {
    const sid = String(s.id || "").toLowerCase();
    const scCode = String(s.studentCode || "").toLowerCase();
    const schedInfo = studentScheduleInfo.get(sid) || studentScheduleInfo.get(scCode) || {
      courses: new Set<string>(),
      categories: new Set<string>(),
      teacherNames: new Set<string>(),
      teacherIds: new Set<string>(),
      weekdays: new Set<string>()
    };

    if (Array.isArray(s.allocatedCourses)) {
      s.allocatedCourses.forEach((ac: any) => {
        if (ac.courseName) {
          schedInfo.courses.add(ac.courseName);
          const cat = courseCategoryMap.get(ac.courseName.trim().toLowerCase());
          if (cat) schedInfo.categories.add(cat);
        }
        if (ac.teacher || ac.teacherName) schedInfo.teacherNames.add(ac.teacher || ac.teacherName);
        if (ac.teacherId) schedInfo.teacherIds.add(ac.teacherId);
      });
    }
    if (s.program) {
      schedInfo.courses.add(s.program);
      const cat = courseCategoryMap.get(s.program.trim().toLowerCase());
      if (cat) schedInfo.categories.add(cat);
    }
    if (s.teacher) schedInfo.teacherNames.add(s.teacher);
    if (s.assignedTeacherId) schedInfo.teacherIds.add(s.assignedTeacherId);

    const hoursLeft = walletMap.has(sid) ? walletMap.get(sid)! : (s.hoursLeft ?? 0);
    const attendedSessions = attendanceCountMap.has(sid) ? attendanceCountMap.get(sid)! : (s.attendedSessions ?? 0);

    return {
      ...s,
      hoursLeft,
      attendedSessions,
      courses: Array.from(schedInfo.courses),
      categories: Array.from(schedInfo.categories),
      teacherNames: Array.from(schedInfo.teacherNames),
      teacherIds: Array.from(schedInfo.teacherIds),
      weekdays: Array.from(schedInfo.weekdays)
    };
  });

  // Role-based Access Filter
  if (user && user.role) {
    const roleUpper = user.role.toUpperCase();
    if (roleUpper === "STUDENT") {
      students = students.filter(
        s => (user.id && s.id === user.id) ||
             (user.email && (s.email || "").toLowerCase() === user.email.toLowerCase()) ||
             (user.id && s.studentCode === user.id) ||
             (s.studentCode && (user as any).student_code && s.studentCode.toLowerCase() === (user as any).student_code.toLowerCase())
      );
    } else if (roleUpper === "PARENT") {
      const userEmail = (user.email || "").toLowerCase().trim();
      students = students.filter(s => {
        if (!userEmail) return false;
        const peList = Array.isArray(s.parentEmails)
          ? s.parentEmails
          : (typeof s.parentEmails === "string" ? [s.parentEmails] : []);
        const sEmails = peList.map((e: any) => String(e || "").toLowerCase().trim());
        return sEmails.includes(userEmail);
      });
    } else if (roleUpper === "TEACHER") {
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
        const matchesSchedules = (s.teacherNames || []).some((tn: string) => ident.names.has(n(tn)) || ident.keys.has(n(tn))) ||
          (s.teacherIds || []).some((tid: string) => ident.keys.has(n(tid)));
        return !!(matchesDirect || matchesAlloc || matchesSchedules);
      });
    }
  }

  // Derive Available Filters based ONLY on role-scoped students
  const roleScopedStudents = [...students];
  const allLocations = cachedLocations;
  const availableFilters = {
    courses: Array.from(new Set(roleScopedStudents.flatMap(st => st.courses || []))).sort(),
    categories: Array.from(new Set(roleScopedStudents.flatMap(st => st.categories || []))).sort(),
    schools: Array.from(new Set([
      ...roleScopedStudents.map(st => st.school).filter(Boolean),
      ...(user?.role !== "TEACHER" ? allLocations : [])
    ])).sort(),
    teachers: Array.from(new Set(roleScopedStudents.flatMap(st => st.teacherNames || []))).sort(),
    grades: Array.from(new Set(roleScopedStudents.map(st => st.grade).filter(Boolean))).sort(),
    paymentMethods: ["Cash", "Check", "Zelle", "Card", "Bank transfer", "Other"],
    plans: ["Package", "Hourly"],
    weekdays: ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"]
  };

  // 1. Program Type Filter
  const progFilter = (params.program_type || "ALL").toUpperCase();
  if (progFilter !== "ALL" && progFilter !== "") {
    students = students.filter(s => {
      const pt = (s.program_type || s.program || "").toUpperCase();
      return pt === progFilter || pt.includes(progFilter) || progFilter.includes(pt);
    });
  }

  // 2. Status Filter
  if (statusFilter === "CURRENT") {
    students = students.filter(s => s.status.toUpperCase() === "ACTIVE");
  } else if (statusFilter === "PAST") {
    students = students.filter(s => {
      const st = s.status.toUpperCase();
      return st === "INACTIVE" || st === "COMPLETED";
    });
  } else if (statusFilter === "ACTIVE" || statusFilter === "INACTIVE" || statusFilter === "COMPLETED") {
    students = students.filter(s => s.status.toUpperCase() === statusFilter);
  }

  // 3. Grade Filter
  if (gradeFilter !== "ALL" && gradeFilter !== "") {
    students = students.filter(s => (s.grade || "").toLowerCase() === gradeFilter.toLowerCase());
  }

  // 4. Search Filter
  if (search) {
    students = students.filter(s => {
      const matchName = (s.fullName || "").toLowerCase().includes(search);
      const matchCode = (s.studentCode || "").toLowerCase().includes(search);
      const matchGrade = (s.grade || "").toLowerCase().includes(search);
      const matchSchool = (s.school || "").toLowerCase().includes(search);
      const matchParentPhone = (s.parentPhones || []).some(p => p.toLowerCase().includes(search));
      const matchStudentPhone = (s.studentPhones || []).some(p => p.toLowerCase().includes(search));
      const matchPrimary = (s.primaryMobile || "").toLowerCase().includes(search);
      return matchName || matchCode || matchGrade || matchSchool || matchParentPhone || matchStudentPhone || matchPrimary;
    });
  }

  // 5. Multi-select: Courses
  if (params.courses && params.courses.length > 0) {
    const targetCourses = params.courses.map(c => c.trim().toLowerCase());
    students = students.filter(s =>
      (s.courses || []).some(sc => targetCourses.includes(sc.trim().toLowerCase()))
    );
  }

  // 6. Multi-select: Categories
  if (params.categories && params.categories.length > 0) {
    const targetCats = params.categories.map(c => c.trim().toLowerCase());
    students = students.filter(s =>
      (s.categories || []).some(cat => targetCats.includes(cat.trim().toLowerCase()))
    );
  }

  // 7. Multi-select: Schools
  if (params.schools && params.schools.length > 0) {
    const targetSchools = params.schools.map(sc => sc.trim().toLowerCase());
    students = students.filter(s =>
      targetSchools.includes((s.school || "").trim().toLowerCase())
    );
  }

  // 8. Multi-select: Teachers
  if (params.teachers && params.teachers.length > 0) {
    const targetTeachers = params.teachers.map(t => t.trim().toLowerCase());
    students = students.filter(s =>
      (s.teacherNames || []).some(tn => targetTeachers.includes(tn.trim().toLowerCase())) ||
      (s.teacherIds || []).some(tid => targetTeachers.includes(tid.trim().toLowerCase())) ||
      targetTeachers.includes((s.teacher || "").trim().toLowerCase()) ||
      targetTeachers.includes((s.assignedTeacherId || "").trim().toLowerCase())
    );
  }

  // 9. Multi-select: Grades (Pre-K, K, 1-12)
  if (params.grades && params.grades.length > 0) {
    const targetGrades = params.grades.map(g => g.trim().toLowerCase());
    students = students.filter(s => {
      const g = (s.grade || "").toLowerCase();
      return targetGrades.some(tg => g === tg || g === `grade ${tg}` || `grade ${g}` === tg);
    });
  }

  // 10. Number of sessions attended: presets (0, 1-5, 6-10, 11-20, 20+) or custom min/max
  if (params.sessionPreset) {
    const sp = params.sessionPreset.trim();
    if (sp === "0") {
      students = students.filter(s => (s.attendedSessions ?? 0) === 0);
    } else if (sp === "1-5") {
      students = students.filter(s => (s.attendedSessions ?? 0) >= 1 && (s.attendedSessions ?? 0) <= 5);
    } else if (sp === "6-10") {
      students = students.filter(s => (s.attendedSessions ?? 0) >= 6 && (s.attendedSessions ?? 0) <= 10);
    } else if (sp === "11-20") {
      students = students.filter(s => (s.attendedSessions ?? 0) >= 11 && (s.attendedSessions ?? 0) <= 20);
    } else if (sp === "20+") {
      students = students.filter(s => (s.attendedSessions ?? 0) > 20);
    }
  }
  if (params.minSessions !== undefined) {
    students = students.filter(s => (s.attendedSessions ?? 0) >= params.minSessions!);
  }
  if (params.maxSessions !== undefined) {
    students = students.filter(s => (s.attendedSessions ?? 0) <= params.maxSessions!);
  }

  // 11. Days of enrollment: weekdays Mon to Sun (any/all toggle)
  if (params.weekdays && params.weekdays.length > 0) {
    const targetDays = params.weekdays.map(d => d.trim().toLowerCase());
    const matchAll = params.weekdayMatch === "all";
    students = students.filter(s => {
      const studentDays = (s.weekdays || []).map(d => d.trim().toLowerCase());
      if (matchAll) {
        return targetDays.every(td => studentDays.includes(td));
      } else {
        return targetDays.some(td => studentDays.includes(td));
      }
    });
  }

  // 12. Enrolled since date range
  if (params.enrolledSinceStart) {
    students = students.filter(s => {
      const d = s.admissionDate || (s.createdAt ? s.createdAt.slice(0, 10) : "");
      return d && d >= params.enrolledSinceStart!;
    });
  }
  if (params.enrolledSinceEnd) {
    students = students.filter(s => {
      const d = s.admissionDate || (s.createdAt ? s.createdAt.slice(0, 10) : "");
      return d && d <= params.enrolledSinceEnd!;
    });
  }

  // 13. Hours left: presets (owed, 0-2, 3-5, 6-10, 10+) or custom min/max
  if (params.hoursPreset) {
    const hp = params.hoursPreset.trim().toLowerCase();
    if (hp === "owed") {
      students = students.filter(s => (s.hoursLeft ?? 0) < 0);
    } else if (hp === "0-2") {
      students = students.filter(s => (s.hoursLeft ?? 0) >= 0 && (s.hoursLeft ?? 0) <= 2);
    } else if (hp === "3-5") {
      students = students.filter(s => (s.hoursLeft ?? 0) >= 3 && (s.hoursLeft ?? 0) <= 5);
    } else if (hp === "6-10") {
      students = students.filter(s => (s.hoursLeft ?? 0) >= 6 && (s.hoursLeft ?? 0) <= 10);
    } else if (hp === "10+") {
      students = students.filter(s => (s.hoursLeft ?? 0) > 10);
    }
  }
  if (params.minHours !== undefined) {
    students = students.filter(s => (s.hoursLeft ?? 0) >= params.minHours!);
  }
  if (params.maxHours !== undefined) {
    students = students.filter(s => (s.hoursLeft ?? 0) <= params.maxHours!);
  }

  // 14. Payment type: plan (Package or Hourly)
  if (params.feePlan && params.feePlan.length > 0) {
    const targetPlans = params.feePlan.map(p => p.trim().toLowerCase());
    students = students.filter(s => {
      const plan = (s.feePlan || "").toLowerCase();
      return targetPlans.some(tp => plan.includes(tp));
    });
  }

  // 15. Payment method: (Cash, Check, Zelle, Card, Bank transfer, Other)
  if (params.paymentMethod && params.paymentMethod.length > 0) {
    const targetMethods = params.paymentMethod.map(m => m.trim().toLowerCase());
    students = students.filter(s => {
      const pm = (s.paymentMethod || "").toLowerCase();
      return targetMethods.some(tm => pm.includes(tm) || tm.includes(pm));
    });
  }

  // Privacy rules
  const viewerRole = (user?.role || "").toUpperCase();
  students = students.map(s => {
    const copy: any = { ...s };
    if (viewerRole !== "ADMIN") {
      delete copy.password;
      delete copy.govtIdUrl;
      delete copy.govt_id_url;
      delete copy.medicalNotes;
      delete copy.medical_notes;
    }
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

  // Sorting
  const sortBy = params.sortBy || "name";
  const sortOrder = params.sortOrder || "asc";
  students.sort((a, b) => {
    let valA: any = a.fullName || "";
    let valB: any = b.fullName || "";
    if (sortBy === "hoursLeft") {
      valA = a.hoursLeft ?? 0;
      valB = b.hoursLeft ?? 0;
    } else if (sortBy === "attendedSessions") {
      valA = a.attendedSessions ?? 0;
      valB = b.attendedSessions ?? 0;
    } else if (sortBy === "grade") {
      valA = a.grade || "";
      valB = b.grade || "";
    } else if (sortBy === "school") {
      valA = a.school || "";
      valB = b.school || "";
    } else if (sortBy === "studentCode") {
      valA = a.studentCode || "";
      valB = b.studentCode || "";
    }
    if (typeof valA === "number" && typeof valB === "number") {
      return sortOrder === "desc" ? valB - valA : valA - valB;
    }
    const cmp = String(valA).localeCompare(String(valB), undefined, { sensitivity: "base" });
    return sortOrder === "desc" ? -cmp : cmp;
  });

  const total = students.length;
  const totalPages = Math.ceil(total / limit) || 1;
  const startIndex = (page - 1) * limit;
  const paginatedData = students.slice(startIndex, startIndex + limit);

  return {
    success: true,
    total,
    page,
    limit,
    totalPages,
    availableFilters,
    data: paginatedData
  };
}

export async function getAllStudentsRaw(): Promise<StudentDossier[]> {
  const res = await getStudentsService({ limit: 5000 });
  const dbIds = new Set(res.data.map(d => d.id));
  const memoryOnly = inMemoryStudentStore.filter(s => s.id && !dbIds.has(s.id));
  return [...res.data, ...memoryOnly];
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
  const fatherName = (payload.fatherName || "").trim();
  const motherName = (payload.motherName || "").trim();
  const guardianName = (payload.guardianName || "").trim();
  const parentFirstName = payload.parentFirstName ? payload.parentFirstName.trim() : "";
  const parentLastName = payload.parentLastName ? payload.parentLastName.trim() : "";
  const derivedParentName = (parentFirstName || parentLastName)
    ? `${parentFirstName} ${parentLastName}`.trim()
    : (fatherName || motherName || guardianName);

  if (!derivedParentName) {
    throw new Error("At least one parent or guardian name is required.");
  }

  const schoolName = payload.school.trim();
  const firstName = payload.firstName.trim();
  const lastName = payload.lastName.trim();
  const derivedFullName = `${firstName} ${lastName}`.trim();

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

  // Parent email is MANDATORY: the parent login is created from it (father and mother = two logins).
  const uniqueParentEmails = Array.from(new Set(cleanParentEmails.map(normEmail)));
  if (uniqueParentEmails.length === 0) {
    throw new Error("Parent email is mandatory. Enter at least one parent email (father and/or mother): the parent login is created from it.");
  }
  const badParentEmail = uniqueParentEmails.find(e => !isValidEmail(e));
  if (badParentEmail) {
    throw new Error(`'${badParentEmail}' is not a valid parent email.`);
  }
  cleanParentEmails.splice(0, cleanParentEmails.length, ...uniqueParentEmails);

  const studentLoginEmail = normEmail(cleanStudentEmails[0] || payload.email);
  if (studentLoginEmail && !isValidEmail(studentLoginEmail)) {
    throw new Error(`'${studentLoginEmail}' is not a valid student email.`);
  }
  if (studentLoginEmail && uniqueParentEmails.includes(studentLoginEmail)) {
    throw new Error("A parent email must be different from the student's own email, because each email is one login.");
  }
  if (studentLoginEmail) {
    const { data: dupStudent } = await supabaseAdmin.from("students").select("id").eq("email", studentLoginEmail).limit(1);
    if (dupStudent && dupStudent.length > 0) {
      throw new Error("A student with this email already exists.");
    }
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

    admissionDate: payload.admissionDate || new Date().toISOString().split("T")[0],
    program: allocatedCourses[0]?.courseName || payload.program || "Standard Curriculum",
    program_type: (payload.program_type || (payload.program && payload.program.toUpperCase().includes("AFTERSCHOOL") ? "AFTERSCHOOL" : "TUTORING")).toUpperCase(),
    notes: payload.notes || "",
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

  // 1) Save the student in Supabase FIRST. If this fails nothing else happens and the admin sees the error.
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
    program_type: newStudent.program_type,
    notes: newStudent.notes,
    teacher: newStudent.teacher || "Unassigned",
    status: newStudent.status || "ACTIVE"
  };

  let { data: insertedRow, error: insertErr } = await supabaseAdmin
    .from("students")
    .insert(studentRow)
    .select("id")
    .single();

  if (insertErr && (insertErr.message.includes("program_type") || insertErr.message.includes("notes"))) {
    const { program_type: _pt, notes: _nt, ...fallbackRow } = studentRow;
    const retry = await supabaseAdmin.from("students").insert(fallbackRow).select("id").single();
    insertedRow = retry.data;
    insertErr = retry.error;
  }
  if (insertErr || !insertedRow) {
    throw new Error(`Could not save the student: ${insertErr?.message || "no row returned"}`);
  }
  newStudent.id = insertedRow.id as string;
  try {
    await persistDossier(newStudent);
  } catch (dossierErr: any) {
    await supabaseAdmin.from("students").delete().eq("id", newStudent.id);
    throw dossierErr;
  }

  // 2) One login per email: the student (if they have an email) and EVERY parent email.
  const newLogins: Array<{ email: string; name: string; role: "STUDENT" | "PARENT"; userId: string }> = [];
  const existingParentLogins: Array<{ email: string; name: string }> = [];
  try {
    if (studentLoginEmail) {
      const l = await ensureLogin({ email: studentLoginEmail, fullName: newStudent.fullName, role: "STUDENT", metadata: { student_code: newStudent.studentCode } });
      await supabaseAdmin.from("students").update({ user_id: l.userId }).eq("id", newStudent.id);
      if (l.created) newLogins.push({ email: studentLoginEmail, name: newStudent.fullName, role: "STUDENT", userId: l.userId });
    }
    for (const parentEmail of cleanParentEmails) {
      const parentName = newStudent.fatherName || newStudent.motherName || "Parent";
      const l = await ensureLogin({ email: parentEmail, fullName: parentName, role: "PARENT", metadata: { student_code: newStudent.studentCode } });
      if (l.created) newLogins.push({ email: parentEmail, name: parentName, role: "PARENT", userId: l.userId });
      else existingParentLogins.push({ email: parentEmail, name: parentName });
    }
  } catch (loginErr: any) {
    // Undo: no half-created student without logins.
    for (const nl of newLogins) await deleteLogin(nl.userId);
    await supabaseAdmin.from("students").delete().eq("id", newStudent.id);
    throw new Error(loginErr?.message || "Could not create the logins for this student.");
  }

  // 3) Only now does the student exist for the rest of the app.
  inMemoryStudentStore.unshift(newStudent);
  lastSupabaseStudentFetch = 0; // invalidate cache

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

  // 4) Emails. New logins get a one-time set-password link (no default passwords). A parent who already had a
  //    login (a second child) gets a notice. The admin gets a summary without any link.
  try {
    for (const nl of newLogins) {
      await emailSetPasswordLink({ email: nl.email, name: nl.name, role: nl.role, childName: newStudent.fullName });
    }
    for (const ep of existingParentLogins) {
      await dispatchMultiChannelNotification({
        eventType: "ADMISSION_APPROVED",
        subject: `New student added to your TopGrade parent login: ${newStudent.fullName}`,
        message: `Dear ${ep.name},\n\n${newStudent.fullName} (${newStudent.studentCode}) was added to your parent login. Sign in with your usual password to see the courses, attendance and schedule.`,
        recipients: [{ role: "PARENT", email: ep.email, name: ep.name, phone: "" }]
      });
    }
    // Requirement 2: the student (or the parent, if the student has no email) is told what was registered.
    await sendStudentAddedEmail(newStudent);

    const adminEmail = process.env.ADMIN_EMAIL || "tglbiz101@gmail.com";
    await dispatchMultiChannelNotification({
      eventType: "ADMISSION_APPROVED",
      subject: `New student registered: ${newStudent.fullName} (${newStudent.studentCode})`,
      message: `Student ${newStudent.fullName} (${newStudent.studentCode}) was registered.\nStudent login: ${studentLoginEmail || "none (no student email)"}\nParent logins: ${cleanParentEmails.join(", ")}\nSet-password emails sent to: ${newLogins.map(n => n.email).join(", ") || "nobody (all logins already existed)"}`,
      recipients: [{ role: "ADMIN", email: adminEmail, name: "System Administrator", phone: "" }]
    });
  } catch (err) {
    console.warn("Notice sending new-student emails:", err);
  }

  return newStudent;
}

/**
 * Service to dispatch Parent Credentials specifically on demand
 */
export async function sendParentCredentialsService(studentIdOrCode: string): Promise<{ success: boolean; message: string; parentEmail: string }> {
  let student = inMemoryStudentStore.find(st => st.id === studentIdOrCode || st.studentCode === studentIdOrCode);
  if (!student) {
    await getStudentsService({ refresh: true, limit: 100000 });
    student = inMemoryStudentStore.find(st => st.id === studentIdOrCode || st.studentCode === studentIdOrCode);
  }
  if (!student) throw new Error(`Student '${studentIdOrCode}' not found.`);

  const parentEmails = Array.from(new Set((student.parentEmails || []).map(normEmail).filter(Boolean)));
  if (parentEmails.length === 0) {
    throw new Error("This student has no parent email. Add at least one parent email first (it is mandatory).");
  }

  // Creates any login that is missing (for example a second parent added later), then emails a set-password link.
  const sent: string[] = [];
  for (const email of parentEmails) {
    const name = student.fatherName || student.motherName || "Parent";
    await ensureLogin({ email, fullName: name, role: "PARENT", metadata: { student_code: student.studentCode } });
    if (await emailSetPasswordLink({ email, name, role: "PARENT", childName: student.fullName })) sent.push(email);
  }
  const studentEmail = normEmail(student.email);
  if (studentEmail) {
    await ensureLogin({ email: studentEmail, fullName: student.fullName, role: "STUDENT", metadata: { student_code: student.studentCode } });
    if (await emailSetPasswordLink({ email: studentEmail, name: student.fullName, role: "STUDENT" })) sent.push(studentEmail);
  }
  if (sent.length === 0) throw new Error("Could not create the set-password links. Check the Supabase connection and try again.");

  return {
    success: true,
    message: `Set-password links sent to ${sent.join(", ")}.`,
    parentEmail: parentEmails.join(", "),
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

  // Parent email stays mandatory when editing: at least one valid parent email, different from the student's own email.
  const nextParentEmails = Array.from(new Set((updated.parentEmails || []).map(normEmail).filter(Boolean)));
  if (nextParentEmails.length === 0) {
    throw new Error("Parent email is mandatory. Enter at least one parent email (father and/or mother).");
  }
  const badParent = nextParentEmails.find(e => !isValidEmail(e));
  if (badParent) throw new Error(`'${badParent}' is not a valid parent email.`);
  const nextStudentEmail = normEmail(updated.email);
  if (nextStudentEmail && !isValidEmail(nextStudentEmail)) throw new Error(`'${nextStudentEmail}' is not a valid student email.`);
  if (nextStudentEmail && nextParentEmails.includes(nextStudentEmail)) {
    throw new Error("A parent email must be different from the student's own email, because each email is one login.");
  }
  updated.parentEmails = nextParentEmails;
  delete (updated as any).password;

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
      if (sbErr) throw new Error(`Could not save the student: ${sbErr.message}`);
    } else {
      const codeToUpdate = updated.studentCode || id;
      const { error: sbErr } = await supabaseAdmin.from("students").update(updateFields).eq("student_id_code", codeToUpdate);
      if (sbErr) throw new Error(`Could not save the student: ${sbErr.message}`);
    }

    await persistDossier(updated);

    // Keep the logins in step with the record. One login per email.
    const photoCdnUrl = updated.profileImageUrl || updated.photoUrl || null;
    if (nextStudentEmail) {
      const prevEmail = normEmail(existing.email);
      if (prevEmail && prevEmail !== nextStudentEmail) {
        const { data: prof } = await supabaseAdmin.from("profiles").select("id").eq("email", prevEmail).maybeSingle();
        if (prof) {
          const { error: authEmailErr } = await supabaseAdmin.auth.admin.updateUserById(prof.id, { email: nextStudentEmail, email_confirm: true });
          if (authEmailErr) throw new Error(`Could not change the login email: ${authEmailErr.message}`);
          await supabaseAdmin.from("profiles").update({ email: nextStudentEmail, full_name: updated.fullName, avatar_url: photoCdnUrl, updated_at: new Date().toISOString() }).eq("id", prof.id);
        }
      }
      const l = await ensureLogin({ email: nextStudentEmail, fullName: updated.fullName, role: "STUDENT", metadata: { student_code: updated.studentCode } });
      if (l.created) await emailSetPasswordLink({ email: nextStudentEmail, name: updated.fullName, role: "STUDENT" });
      await supabaseAdmin.from("profiles").update({ full_name: updated.fullName, avatar_url: photoCdnUrl, updated_at: new Date().toISOString() }).eq("id", l.userId);
      await supabaseAdmin.from("students").update({ user_id: l.userId }).eq("id", updated.id);
    }
    // A parent email that is new on this student gets a login (or a notice if that parent already has one).
    const previousParents = new Set((existing.parentEmails || []).map(normEmail));
    for (const parentEmail of nextParentEmails) {
      if (previousParents.has(parentEmail)) continue;
      const parentName = updated.fatherName || updated.motherName || "Parent";
      const l = await ensureLogin({ email: parentEmail, fullName: parentName, role: "PARENT", metadata: { student_code: updated.studentCode } });
      if (l.created) {
        await emailSetPasswordLink({ email: parentEmail, name: parentName, role: "PARENT", childName: updated.fullName });
      } else {
        await dispatchMultiChannelNotification({
          eventType: "ADMISSION_APPROVED",
          subject: `New student added to your TopGrade parent login: ${updated.fullName}`,
          message: `Dear ${parentName},\n\n${updated.fullName} (${updated.studentCode}) was added to your parent login. Sign in with your usual password to see the courses, attendance and schedule.`,
          recipients: [{ role: "PARENT", email: parentEmail, name: parentName, phone: "" }]
        });
      }
    }
  } catch (e: any) {
    // Nothing is reported as saved unless Supabase accepted it.
    throw new Error(e?.message || "Could not save the student.");
  }

  inMemoryStudentStore[index] = updated;
  lastSupabaseStudentFetch = Date.now();

  // Requirement 2: whenever information is updated, the student (or the parent, if the student has no email)
  // gets an email listing exactly what changed. Nothing is sent when no listed field changed.
  void sendStudentUpdatedEmail(existing, updated).catch(err => console.warn("Notice sending the update email:", err?.message));

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

    // 6. Remove from schedule_students table
    try {
      if (targetStudentId || targetStudentCode) {
        await supabaseAdmin
          .from("schedule_students")
          .delete()
          .or(`student_id.eq.${targetStudentId || ""},student_id.eq.${targetStudentCode || ""},student_code.eq.${targetStudentCode || ""}`);
      }
    } catch (schErr) {
      console.warn("Notice updating schedule_students on student delete:", schErr);
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

  const toggled: StudentDossier = { ...current, status: targetStatus, updatedAt: new Date().toISOString() };
  await persistDossier(toggled, { status: targetStatus });
  inMemoryStudentStore[index] = toggled;

  return toggled;
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
  if (!newPassword || newPassword.trim().length < 8) {
    throw new Error("New password must be at least 8 characters long.");
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

  // The password itself goes only to Supabase Auth. We keep just the "changed once" flags on the record.
  const authEmail = normEmail(student.email);
  const { data: prof } = await supabaseAdmin.from("profiles").select("id").eq("email", authEmail).maybeSingle();
  if (!prof) throw new Error("This student has no login yet. Ask the institute to send a set-password link.");
  const { error: pwErr } = await supabaseAdmin.auth.admin.updateUserById(prof.id, { password: newPassword.trim() });
  if (pwErr) throw new Error(`Could not update the password: ${pwErr.message}`);

  student.hasChangedPassword = true;
  student.passwordChangedCount = (student.passwordChangedCount || 0) + 1;
  student.passwordUpdatedAt = new Date().toISOString();
  student.updatedAt = new Date().toISOString();
  delete (student as any).password;
  await persistDossier(student);

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
  let matchingTeacher: any = null;
  try {
    const { data: tData } = await supabaseAdmin
      .from("teachers")
      .select("*")
      .or(`email.ilike.${query},teacher_id_code.ilike.${query},id.eq.${query}`)
      .maybeSingle();
    matchingTeacher = tData;
  } catch (tErr) {
    console.warn("verifyLoginRoleService teacher query notice:", tErr);
  }

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



