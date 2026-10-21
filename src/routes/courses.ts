import express from "express";
import { supabaseAdmin } from "../supabase.js";
import { removeAttendanceSessionsForCourse } from "../services/sessionAttendanceService.js";
import { ScheduleDataService } from "../services/scheduleDataService.js";
import type { AuthenticatedRequest } from "../middleware/auth.js";
import { getAccessScope, allowsCourse } from "../services/accessScope.js";
import { getInstituteSettings, updateInstituteSettings } from "../services/instituteSettingsService.js";
import { inMemoryStudentStore } from "../services/studentService.js";

const router = express.Router();

export interface CourseScheduleSlot {
  id: string;
  day: "Monday" | "Tuesday" | "Wednesday" | "Thursday" | "Friday" | "Saturday";
  slot: string; // e.g. "09:00 AM - 10:30 AM"
  room: string; // e.g. "Computer Lab 1", "Room 204", "Virtual Classroom A"
  programTrack: string; // e.g. "Core Syntax & Logic", "Hands-on Project Lab"
  teacherName?: string;
  teacherId?: string;
}

export interface CourseData {
  id: string;
  course_code: string;
  name: string;
  description: string;
  category: string;
  grade_category: string;
  age_group: string;
  grade_eligibility: string[];
  duration: string;
  duration_months?: number | null;
  package_hours?: number | null;
  package_price?: number | null;
  fee: number;
  hourly_rate?: number | null;
  max_hours?: number;
  max_students: number;
  enrolled_students: number;
  status: "Active" | "Archived" | "Draft";
  assigned_teachers: Array<{
    teacherId: string;
    teacherCode?: string;
    name: string;
    email?: string;
    role?: string;
    weeklySessions?: number;
  }>;
  mapped_students: Array<{
    studentId: string;
    studentCode?: string;
    fullName: string;
    grade?: string;
    status?: string;
    enrollmentDate?: string;
  }>;
  schedule: CourseScheduleSlot[];
}

function mapSupabaseCourseToCourseData(c: any): CourseData {
  let materialObj: any = {};
  if (c.course_material) {
    try {
      materialObj = typeof c.course_material === "string" ? JSON.parse(c.course_material) : c.course_material;
    } catch {}
  }

  const hourlyRate = c.hourly_rate !== null && c.hourly_rate !== undefined
    ? Number(c.hourly_rate)
    : null;

  const durationMonths = c.duration_months !== null && c.duration_months !== undefined
    ? Number(c.duration_months)
    : null;

  const packageHours = c.package_hours !== null && c.package_hours !== undefined
    ? Number(c.package_hours)
    : null;

  const packagePrice = c.package_price !== null && c.package_price !== undefined
    ? Number(c.package_price)
    : null;

  return {
    id: c.id,
    course_code: c.course_code || "",
    name: c.name || "",
    description: c.description || "",
    category: c.required_teacher_skills || "STEM & Technology",
    grade_category: c.age_group || "All Grades",
    age_group: c.age_group || "All Grades",
    grade_eligibility: Array.isArray(c.grade_eligibility) ? c.grade_eligibility : (c.age_group ? [c.age_group] : ["All Grades"]),
    duration: c.duration || (durationMonths ? `${durationMonths} Months` : ""),
    duration_months: durationMonths,
    package_hours: packageHours,
    package_price: packagePrice,
    fee: Number(c.fee) || 0,
    hourly_rate: hourlyRate,
    max_hours: Number(materialObj.max_hours) || 25,
    max_students: Number(c.max_students) || 20,
    enrolled_students: Array.isArray(materialObj.mapped_students) ? materialObj.mapped_students.length : 0,
    status: c.status || "Active",
    assigned_teachers: Array.isArray(materialObj.assigned_teachers) ? materialObj.assigned_teachers : [],
    mapped_students: Array.isArray(materialObj.mapped_students) ? materialObj.mapped_students : [],
    schedule: Array.isArray(materialObj.schedule) ? materialObj.schedule : []
  };
}

// GET: List all courses with category and grade filtering strictly from Supabase
export const getCoursesHandler = async (req: express.Request, res: express.Response) => {
  const { grade, category, gradeCategory } = req.query;
  let list: CourseData[] = [];

  try {
    const { data: sbCourses, error } = await supabaseAdmin
      .from("courses")
      .select("*")
      .order("name", { ascending: true });

    if (!error && sbCourses) {
      list = sbCourses.map(mapSupabaseCourseToCourseData);
    }
  } catch (err) {
    console.warn("Backend getCoursesHandler Supabase query notice:", err);
  }

  const { teacherId, teacherEmail, teacherName } = req.query;
  if (teacherId || teacherEmail || teacherName) {
    const tId = (teacherId as string)?.toLowerCase();
    const tEmail = (teacherEmail as string)?.toLowerCase();
    const tName = (teacherName as string)?.toLowerCase();
    const schedulesList = await ScheduleDataService.listSchedules();

    list = list.filter(c => {
      const teachers = c.assigned_teachers || [];
      const hasAssigned = teachers.some((t: any) =>
        (tId && (t.teacherId?.toLowerCase() === tId || t.teacherCode?.toLowerCase() === tId)) ||
        (tEmail && t.email?.toLowerCase() === tEmail) ||
        (tName && t.name?.toLowerCase().includes(tName))
      );
      const hasInSched = (c.schedule || []).some((s: any) =>
        (tId && s.teacherId?.toLowerCase() === tId) ||
        (tName && s.teacherName?.toLowerCase().includes(tName))
      );
      const hasInSchedulesDb = schedulesList.some(s =>
        (s.course_id === c.id || s.course_name?.toLowerCase() === c.name?.toLowerCase()) &&
        ((tId && s.teacher_id?.toLowerCase() === tId) || (tName && s.teacher_name?.toLowerCase().includes(tName)))
      );
      return hasAssigned || hasInSched || hasInSchedulesDb;
    });
  }

  if (grade && grade !== "ALL" && grade !== "All Grades") {
    list = list.filter(c => {
      if (!c.grade_eligibility || c.grade_eligibility.length === 0) return true;
      if (c.grade_eligibility.includes("All Grades") || c.grade_eligibility.includes("ALL")) return true;
      return c.grade_eligibility.includes(grade as string) || (c.age_group && c.age_group.includes(grade as string));
    });
  }

  if (gradeCategory && gradeCategory !== "ALL") {
    list = list.filter(c => c.grade_category === gradeCategory || c.age_group === gradeCategory);
  }

  if (category && category !== "ALL") {
    list = list.filter(c => c.category === category);
  }

  // Role scoping: students and parents see courses their child is enrolled in or eligible for
  const user = (req as AuthenticatedRequest).user;
  if (user && user.role !== "ADMIN") {
    const scope = await getAccessScope(user);
    if (!scope.unrestricted) {
      list = list.filter(c => allowsCourse(scope, c.id, c.course_code, c.name));
    }
  }

  res.status(200).json({
    success: true,
    totalCourses: list.length,
    activeProgramsCount: list.filter(c => c.status === "Active").length,
    data: list
  });
};

router.get("/list", getCoursesHandler);
router.get("/categories", async (req: express.Request, res: express.Response): Promise<any> => {
  try {
    const settings = await getInstituteSettings();
    return res.status(200).json({
      success: true,
      categories: settings.course_categories || [
        "Coding", "Robotics", "3D Printing", "Math", "Reading", "Other"
      ]
    });
  } catch (err: any) {
    return res.status(500).json({ success: false, error: err.message });
  }
});

router.post("/categories", async (req: express.Request, res: express.Response): Promise<any> => {
  try {
    const { category, categories } = req.body || {};
    const settings = await getInstituteSettings();
    const existing = new Set(settings.course_categories || [
      "Coding", "Robotics", "3D Printing", "Math", "Reading", "Other"
    ]);

    if (category && typeof category === "string") {
      const trimmed = category.trim();
      if (trimmed) existing.add(trimmed);
    }
    if (Array.isArray(categories)) {
      for (const c of categories) {
        const trimmed = String(c || "").trim();
        if (trimmed) existing.add(trimmed);
      }
    }

    const updatedList = Array.from(existing);
    const updated = await updateInstituteSettings({ course_categories: updatedList });

    return res.status(200).json({
      success: true,
      message: "Course categories updated successfully.",
      categories: updated.course_categories,
    });
  } catch (err: any) {
    return res.status(500).json({ success: false, message: err?.message || "Failed to update categories." });
  }
});

// GET: Course detail by ID or course code
export const getCourseDetailHandler = async (req: express.Request, res: express.Response): Promise<any> => {
  const courseId = req.params.id;
  if (!courseId) {
    return res.status(400).json({ success: false, message: "Course ID is required." });
  }

  try {
    const { data: courseRow, error } = await supabaseAdmin
      .from("courses")
      .select("*")
      .or(`id.eq.${courseId},course_code.eq.${courseId}`)
      .maybeSingle();

    if (error || !courseRow) {
      return res.status(404).json({ success: false, message: `Course '${courseId}' not found.` });
    }

    const courseData = mapSupabaseCourseToCourseData(courseRow);

    // Cross-reference mapped teachers and students from schedules
    const allSchedules = await ScheduleDataService.listSchedules();
    const courseSchedules = allSchedules.filter(s =>
      s.course_id === courseRow.id ||
      s.course_name?.toLowerCase() === courseRow.name?.toLowerCase()
    );

    const teacherMap = new Map<string, any>();
    (courseData.assigned_teachers || []).forEach(t => {
      teacherMap.set(t.teacherId || t.name, t);
    });

    const studentMap = new Map<string, any>();
    (courseData.mapped_students || []).forEach(s => {
      studentMap.set(s.studentId || s.fullName, s);
    });

    // Populate from schedules
    for (const sched of courseSchedules) {
      if (sched.teacher_id && !teacherMap.has(sched.teacher_id)) {
        teacherMap.set(sched.teacher_id, {
          teacherId: sched.teacher_id,
          name: sched.teacher_name || "Assigned Teacher",
          role: "Teacher",
          weeklySessions: 1
        });
      }
      for (const st of sched.students || []) {
        if (st.student_id && !studentMap.has(st.student_id)) {
          studentMap.set(st.student_id, {
            studentId: st.student_id,
            studentCode: st.student_code,
            fullName: st.student_name,
            status: "ACTIVE"
          });
        }
      }
    }

    // Role scoping
    const user = (req as AuthenticatedRequest).user;
    if (user && user.role !== "ADMIN") {
      const scope = await getAccessScope(user);
      if (!scope.unrestricted && !allowsCourse(scope, courseData.id, courseData.course_code, courseData.name)) {
        return res.status(403).json({ success: false, message: "Forbidden: You are not authorized to view this course." });
      }
    }

    courseData.assigned_teachers = Array.from(teacherMap.values());
    courseData.mapped_students = Array.from(studentMap.values());
    courseData.enrolled_students = courseData.mapped_students.length;

    return res.status(200).json({
      success: true,
      data: courseData
    });
  } catch (err: any) {
    return res.status(500).json({ success: false, message: err.message });
  }
};

router.get("/:id", getCourseDetailHandler);
router.get("/", getCoursesHandler);

// PATCH: Toggle or set course status (Active / Archived)
router.patch("/:id/status", async (req: express.Request, res: express.Response): Promise<any> => {
  const courseId = req.params.id;
  const { status } = req.body;
  if (!status || !["Active", "Archived", "Draft"].includes(status)) {
    return res.status(400).json({ success: false, message: "Valid status ('Active', 'Archived', 'Draft') is required." });
  }

  try {
    const { data: updated, error } = await supabaseAdmin
      .from("courses")
      .update({ status })
      .or(`id.eq.${courseId},course_code.eq.${courseId}`)
      .select()
      .maybeSingle();

    if (error || !updated) {
      return res.status(500).json({ success: false, message: error?.message || "Course not found or update failed." });
    }

    return res.status(200).json({
      success: true,
      status: updated.status,
      message: `Course status set to ${status}.`,
      data: mapSupabaseCourseToCourseData(updated)
    });
  } catch (err: any) {
    return res.status(500).json({ success: false, message: err.message });
  }
});

// POST: Add new course (Admin only)
export const createCourseHandler = async (req: express.Request, res: express.Response) => {
  const c = req.body;
  if (!c.name || !c.category) {
    return res.status(400).json({ success: false, message: "Course Name and Category are required." });
  }

  const prefix = c.category.includes("STEM") ? "TG-CRS-STEM" :
                 c.category.includes("Math") ? "TG-CRS-MTH" :
                 c.category.includes("Science") ? "TG-CRS-SCI" :
                 c.category.includes("Language") ? "TG-CRS-LANG" : "TG-CRS-FND";
  const uniqueCode = c.course_code || `${prefix}-${Math.floor(100 + Math.random() * 899)}`;

  let durationMonths: number | null = null;
  if (c.duration_months !== undefined && c.duration_months !== null && c.duration_months !== "") {
    const v = Number(c.duration_months);
    if (isNaN(v) || v <= 0) {
      return res.status(400).json({ success: false, message: "Course duration months must be a positive number." });
    }
    durationMonths = Math.floor(v);
  } else if (c.duration) {
    const parsed = parseInt(c.duration, 10);
    if (parsed > 0) durationMonths = parsed;
  }

  let packageHours: number | null = null;
  if (c.package_hours !== undefined && c.package_hours !== null && c.package_hours !== "") {
    const v = Number(c.package_hours);
    if (isNaN(v) || v <= 0) {
      return res.status(400).json({ success: false, message: "Package hours must be a positive number." });
    }
    packageHours = Math.floor(v);
  }

  let packagePrice: number | null = null;
  if (c.package_price !== undefined && c.package_price !== null && c.package_price !== "") {
    const v = Number(c.package_price);
    if (isNaN(v) || v <= 0) {
      return res.status(400).json({ success: false, message: "Package price must be a positive number." });
    }
    packagePrice = Math.round(v * 100) / 100;
  }

  let hourlyRate: number | null = null;
  if (c.hourly_rate !== undefined && c.hourly_rate !== null && c.hourly_rate !== "") {
    const v = Number(c.hourly_rate);
    if (isNaN(v) || v <= 0) {
      return res.status(400).json({ success: false, message: "Hourly rate must be a positive number." });
    }
    hourlyRate = Math.round(v * 100) / 100;
  }

  const materialObj = {
    duration_months: durationMonths,
    package_hours: packageHours,
    package_price: packagePrice,
    hourly_rate: hourlyRate,
    max_hours: c.max_hours ? parseInt(c.max_hours) : 25,
    assigned_teachers: Array.isArray(c.assignedTeachers) ? c.assignedTeachers : (c.assigned_teachers || []),
    mapped_students: Array.isArray(c.mappedStudents) ? c.mappedStudents : (c.mapped_students || []),
    schedule: Array.isArray(c.schedule) ? c.schedule : [],
    grade_eligibility: Array.isArray(c.gradeEligibility) ? c.gradeEligibility : (c.grade_eligibility ? [c.grade_eligibility] : [])
  };

  const courseRow: any = {
    course_code: uniqueCode,
    name: c.name,
    description: c.description || "",
    duration: c.duration || (durationMonths ? `${durationMonths} Months` : ""),
    duration_months: durationMonths,
    package_hours: packageHours,
    package_price: packagePrice,
    hourly_rate: hourlyRate,
    fee: c.fee !== undefined ? parseFloat(c.fee) : (packagePrice || 0),
    max_students: c.maxStudents ? parseInt(c.maxStudents) : (c.max_students ? parseInt(c.max_students) : 20),
    required_teacher_skills: c.category,
    status: c.status || "Active",
    course_material: JSON.stringify(materialObj)
  };

  let { data, error } = await supabaseAdmin
    .from("courses")
    .insert([courseRow])
    .select()
    .single();

  if (error && (error.message.includes("duration_months") || error.message.includes("package_hours") || error.message.includes("package_price") || error.message.includes("hourly_rate"))) {
    delete courseRow.duration_months;
    delete courseRow.package_hours;
    delete courseRow.package_price;
    delete courseRow.hourly_rate;
    const retry = await supabaseAdmin.from("courses").insert([courseRow]).select().single();
    data = retry.data;
    error = retry.error;
  }

  if (error || !data) {
    return res.status(500).json({ success: false, message: error?.message || "Failed to create course in Supabase." });
  }

  const savedData = mapSupabaseCourseToCourseData(data);

  res.status(201).json({
    success: true,
    message: `Course '${savedData.name}' created with code ${uniqueCode}.`,
    data: savedData
  });
};

router.post("/add", createCourseHandler);
router.post("/", createCourseHandler);

// PUT: Update an existing course (Admin)
export const editCourseHandler = async (req: express.Request, res: express.Response) => {
  const c = req.body;
  const courseId = req.params.id || c.id;
  if (!courseId) {
    return res.status(400).json({ success: false, message: "Course ID is required for editing." });
  }

  const { data: existingCourse, error: fetchErr } = await supabaseAdmin
    .from("courses")
    .select("*")
    .or(`id.eq.${courseId},course_code.eq.${courseId}`)
    .maybeSingle();

  if (fetchErr || !existingCourse) {
    return res.status(404).json({ success: false, message: `Course '${courseId}' not found.` });
  }

  let materialObj: any = {};
  if (existingCourse.course_material) {
    try {
      materialObj = typeof existingCourse.course_material === "string" ? JSON.parse(existingCourse.course_material) : existingCourse.course_material;
    } catch {}
  }

  const updateRow: any = {
    updated_at: new Date().toISOString()
  };

  if (c.duration_months !== undefined) {
    if (c.duration_months !== null && c.duration_months !== "") {
      const v = Number(c.duration_months);
      if (isNaN(v) || v <= 0) {
        return res.status(400).json({ success: false, message: "Course duration months must be a positive number." });
      }
      updateRow.duration_months = Math.floor(v);
      materialObj.duration_months = Math.floor(v);
    } else {
      updateRow.duration_months = null;
      materialObj.duration_months = null;
    }
  }

  if (c.package_hours !== undefined) {
    if (c.package_hours !== null && c.package_hours !== "") {
      const v = Number(c.package_hours);
      if (isNaN(v) || v <= 0) {
        return res.status(400).json({ success: false, message: "Package hours must be a positive number." });
      }
      updateRow.package_hours = Math.floor(v);
      materialObj.package_hours = Math.floor(v);
    } else {
      updateRow.package_hours = null;
      materialObj.package_hours = null;
    }
  }

  if (c.package_price !== undefined) {
    if (c.package_price !== null && c.package_price !== "") {
      const v = Number(c.package_price);
      if (isNaN(v) || v <= 0) {
        return res.status(400).json({ success: false, message: "Package price must be a positive number." });
      }
      updateRow.package_price = Math.round(v * 100) / 100;
      materialObj.package_price = Math.round(v * 100) / 100;
    } else {
      updateRow.package_price = null;
      materialObj.package_price = null;
    }
  }

  if (c.hourly_rate !== undefined) {
    if (c.hourly_rate !== null && c.hourly_rate !== "") {
      const v = Number(c.hourly_rate);
      if (isNaN(v) || v <= 0) {
        return res.status(400).json({ success: false, message: "Hourly rate must be a positive number." });
      }
      updateRow.hourly_rate = Math.round(v * 100) / 100;
      materialObj.hourly_rate = Math.round(v * 100) / 100;
    } else {
      updateRow.hourly_rate = null;
      materialObj.hourly_rate = null;
    }
  }

  if (c.max_hours !== undefined) materialObj.max_hours = parseInt(c.max_hours);
  if (c.assignedTeachers !== undefined || c.assigned_teachers !== undefined) {
    materialObj.assigned_teachers = c.assignedTeachers || c.assigned_teachers;
  }
  if (c.mappedStudents !== undefined || c.mapped_students !== undefined) {
    materialObj.mapped_students = c.mappedStudents || c.mapped_students;
  }
  if (c.schedule !== undefined) {
    materialObj.schedule = c.schedule;
  }
  if (c.gradeEligibility !== undefined || c.grade_eligibility !== undefined) {
    materialObj.grade_eligibility = c.gradeEligibility || c.grade_eligibility;
  }

  updateRow.course_material = JSON.stringify(materialObj);
  if (c.name !== undefined) updateRow.name = c.name;
  if (c.description !== undefined) updateRow.description = c.description;
  if (c.ageGroup || c.gradeCategory) updateRow.age_group = c.ageGroup || c.gradeCategory;
  if (c.duration !== undefined) updateRow.duration = c.duration;
  if (c.fee !== undefined) updateRow.fee = Number(c.fee);
  if (c.maxStudents !== undefined || c.max_students !== undefined) {
    updateRow.max_students = Number(c.maxStudents || c.max_students);
  }
  if (c.category !== undefined) updateRow.required_teacher_skills = c.category;
  if (c.status !== undefined) updateRow.status = c.status;

  const { data: updatedData, error: updErr } = await supabaseAdmin
    .from("courses")
    .update(updateRow)
    .eq("id", existingCourse.id)
    .select()
    .single();

  if (updErr || !updatedData) {
    return res.status(500).json({ success: false, message: updErr?.message || "Failed to update course." });
  }

  const updatedCourse = mapSupabaseCourseToCourseData(updatedData);

  res.status(200).json({
    success: true,
    message: `Course '${updatedCourse.name}' updated successfully in real time!`,
    data: updatedCourse
  });
};

router.put("/edit/:id", editCourseHandler);
router.put("/:id", editCourseHandler);
router.post("/edit", editCourseHandler);

// PUT: Update Course Weekly Schedule
export const updateCourseScheduleHandler = async (req: express.Request, res: express.Response) => {
  const courseId = req.params.id;
  const { schedule } = req.body;

  if (!courseId) {
    return res.status(400).json({ success: false, message: "Course ID is required." });
  }
  if (!Array.isArray(schedule)) {
    return res.status(400).json({ success: false, message: "Schedule must be an array of schedule slots." });
  }

  const { data: courseRow } = await supabaseAdmin
    .from("courses")
    .select("*")
    .or(`id.eq.${courseId},course_code.eq.${courseId}`)
    .maybeSingle();

  if (!courseRow) {
    return res.status(404).json({ success: false, message: `Course '${courseId}' not found.` });
  }

  let materialObj: any = {};
  if (courseRow.course_material) {
    try {
      materialObj = typeof courseRow.course_material === "string" ? JSON.parse(courseRow.course_material) : courseRow.course_material;
    } catch {}
  }
  materialObj.schedule = schedule;

  const { data: updatedRow } = await supabaseAdmin
    .from("courses")
    .update({ course_material: JSON.stringify(materialObj), updated_at: new Date().toISOString() })
    .eq("id", courseRow.id)
    .select()
    .single();

  const courseData = mapSupabaseCourseToCourseData(updatedRow || courseRow);

  res.status(200).json({
    success: true,
    message: `Weekly schedule for '${courseData.name}' updated successfully.`,
    data: courseData
  });
};

router.put("/:id/schedule", updateCourseScheduleHandler);

// POST: Map or Unmap Teacher to Course
export const mapTeacherHandler = async (req: express.Request, res: express.Response) => {
  const courseId = req.params.id;
  const { teacherId, teacherName, action } = req.body;

  const { data: courseRow } = await supabaseAdmin
    .from("courses")
    .select("*")
    .or(`id.eq.${courseId},course_code.eq.${courseId}`)
    .maybeSingle();

  if (!courseRow) {
    return res.status(404).json({ success: false, message: `Course '${courseId}' not found.` });
  }

  let materialObj: any = {};
  if (courseRow.course_material) {
    try {
      materialObj = typeof courseRow.course_material === "string" ? JSON.parse(courseRow.course_material) : courseRow.course_material;
    } catch {}
  }

  let teachersList: any[] = Array.isArray(materialObj.assigned_teachers) ? materialObj.assigned_teachers : [];

  if (action === "remove") {
    teachersList = teachersList.filter((t: any) => t.teacherId !== teacherId && t.name !== teacherName);
  } else {
    const existing = teachersList.find((t: any) => t.teacherId === teacherId || t.name === teacherName);
    if (!existing) {
      teachersList.push({
        teacherId: teacherId || `tch-${Date.now()}`,
        teacherCode: `TG-FAC-${teacherId || Date.now()}`,
        name: teacherName || "Faculty Instructor",
        role: "Faculty Instructor",
        weeklySessions: 4
      });
    }
  }

  materialObj.assigned_teachers = teachersList;

  const { data: updatedRow } = await supabaseAdmin
    .from("courses")
    .update({ course_material: JSON.stringify(materialObj), updated_at: new Date().toISOString() })
    .eq("id", courseRow.id)
    .select()
    .single();

  const courseData = mapSupabaseCourseToCourseData(updatedRow || courseRow);

  res.status(200).json({
    success: true,
    message: `Teacher mapping updated for '${courseData.name}'.`,
    data: courseData
  });
};

router.post("/:id/map-teacher", mapTeacherHandler);

// POST: Map or Unmap Student to Course
export const mapStudentHandler = async (req: express.Request, res: express.Response) => {
  const courseId = req.params.id;
  const { studentId, studentName, action } = req.body;

  const { data: courseRow } = await supabaseAdmin
    .from("courses")
    .select("*")
    .or(`id.eq.${courseId},course_code.eq.${courseId}`)
    .maybeSingle();

  if (!courseRow) {
    return res.status(404).json({ success: false, message: `Course '${courseId}' not found.` });
  }

  let materialObj: any = {};
  if (courseRow.course_material) {
    try {
      materialObj = typeof courseRow.course_material === "string" ? JSON.parse(courseRow.course_material) : courseRow.course_material;
    } catch {}
  }

  let studentsList: any[] = Array.isArray(materialObj.mapped_students) ? materialObj.mapped_students : [];

  if (action === "remove") {
    studentsList = studentsList.filter((s: any) => s.studentId !== studentId && s.fullName !== studentName);
  } else {
    const existing = studentsList.find((s: any) => s.studentId === studentId || s.fullName === studentName);
    if (!existing) {
      const studentObj = inMemoryStudentStore.find((s: any) => s.id === studentId || s.fullName === studentName) || {
        id: studentId || `std-${Date.now()}`,
        studentCode: `TG-STU-${Math.floor(100 + Math.random() * 899)}`,
        fullName: studentName || "Student",
        grade: "Grade 8",
        status: "ACTIVE"
      };

      studentsList.push({
        studentId: studentObj.id || `std-${Date.now()}`,
        studentCode: studentObj.studentCode || `TG-STU-${Date.now()}`,
        fullName: studentObj.fullName || "Student",
        grade: studentObj.grade || "General",
        status: studentObj.status || "ACTIVE",
        enrollmentDate: (new Date().toISOString().split("T")[0]) || "2026-08-31"
      });
    }
  }

  materialObj.mapped_students = studentsList;

  const { data: updatedRow } = await supabaseAdmin
    .from("courses")
    .update({ course_material: JSON.stringify(materialObj), updated_at: new Date().toISOString() })
    .eq("id", courseRow.id)
    .select()
    .single();

  const courseData = mapSupabaseCourseToCourseData(updatedRow || courseRow);

  res.status(200).json({
    success: true,
    message: `Student enrollment mapping updated for '${courseData.name}'.`,
    data: courseData
  });
};

router.post("/:id/map-student", mapStudentHandler);

// DELETE: Remove course
export const deleteCourseHandler = async (req: express.Request, res: express.Response) => {
  const courseId = String(req.params.id);
  if (!courseId) {
    return res.status(400).json({ success: false, message: "Course ID is required." });
  }

  const { data: deletedCourse } = await supabaseAdmin
    .from("courses")
    .select("*")
    .or(`id.eq.${courseId},course_code.eq.${courseId}`)
    .maybeSingle();

  // Remove corresponding attendance sessions
  removeAttendanceSessionsForCourse(String(courseId));

  // Remove corresponding schedule slots
  try {
    const courseName = deletedCourse?.name;
    const targetId = deletedCourse?.id || courseId;
    const allSchedules = await ScheduleDataService.listSchedules();
    for (const s of allSchedules) {
      if (s.course_id === targetId || (courseName && s.course_name?.toLowerCase() === courseName.toLowerCase())) {
        void ScheduleDataService.deleteSchedule(s.id);
      }
    }
  } catch (schErr) {
    console.warn("Notice cleaning course schedules:", schErr);
  }

  if (deletedCourse?.id) {
    await supabaseAdmin.from("courses").delete().eq("id", deletedCourse.id);
  } else {
    await supabaseAdmin.from("courses").delete().or(`id.eq.${courseId},course_code.eq.${courseId}`);
  }

  res.status(200).json({
    success: true,
    message: `Course '${deletedCourse?.name || courseId}' deleted successfully. Associated attendance sessions removed.`,
    data: deletedCourse ? mapSupabaseCourseToCourseData(deletedCourse) : null
  });
};

router.delete("/:id", deleteCourseHandler);
router.delete("/delete/:id", deleteCourseHandler);

export default router;