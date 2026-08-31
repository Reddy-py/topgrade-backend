import express from "express";
import { supabaseAdmin } from "../index.js";
import { inMemoryTeachers } from "./teachers.js";
import { inMemoryStudentStore } from "../services/studentService.js";
import { autoGenerateAttendanceSessionsForCourse, removeAttendanceSessionsForCourse } from "../services/sessionAttendanceService.js";

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
  category: "STEM & Technology" | "Advanced Mathematics" | "Science & Robotics" | "Language & Arts" | "Junior Foundation";
  grade_category: "Primary (Grade 1-5)" | "Middle School (Grade 6-8)" | "High School (Grade 9-12)" | "All Grades";
  age_group: string;
  grade_eligibility: string[];
  duration: string;
  fee: number;
  max_students: number;
  enrolled_students: number;
  status: "Active" | "Upcoming" | "Completed";
  assigned_teachers: Array<{
    teacherId: string;
    teacherCode: string;
    name: string;
    email: string;
    role: string;
    weeklySessions: number;
  }>;
  mapped_students: Array<{
    studentId: string;
    studentCode: string;
    fullName: string;
    grade: string;
    status: string;
    enrollmentDate: string;
  }>;
  schedule: CourseScheduleSlot[];
}

// Clean initial state: 0 courses (ready for manual real-time addition)
export let inMemoryCourses: CourseData[] = [];

// GET: List all courses with category and grade filtering
export const getCoursesHandler = async (req: express.Request, res: express.Response) => {
  const { grade, category, gradeCategory } = req.query;
  let list = inMemoryCourses;

  if (grade && grade !== "ALL" && grade !== "All Grades") {
    list = list.filter(c => {
      if (!c.grade_eligibility || c.grade_eligibility.length === 0) return true;
      if (c.grade_eligibility.includes("All Grades") || c.grade_eligibility.includes("ALL")) return true;
      return c.grade_eligibility.includes(grade as string) || (c.age_group && c.age_group.includes(grade as string));
    });
  }

  if (category && category !== "ALL") {
    list = list.filter(c => c.category === category);
  }

  if (gradeCategory && gradeCategory !== "ALL") {
    list = list.filter(c => c.grade_category === gradeCategory);
  }

  res.status(200).json({ success: true, data: list });
};

router.get("/list", getCoursesHandler);
router.get("/", getCoursesHandler);

// POST: Add new Course (Admin & Accountant)
export const createCourseHandler = async (req: express.Request, res: express.Response) => {
  const c = req.body;
  const uniqueCode = c.courseCode || c.course_code || `TG-CRS-${Math.floor(100 + Math.random() * 899)}`;

  const newCourse: CourseData = {
    id: `crs-${Date.now()}`,
    course_code: uniqueCode,
    name: c.name || "Untitled Course",
    description: c.description || "Interactive and rigorous academic track.",
    category: c.category || "STEM & Technology",
    grade_category: c.gradeCategory || c.grade_category || "Middle School (Grade 6-8)",
    age_group: c.ageGroup || c.age_group || (c.gradeEligibility ? c.gradeEligibility.join(", ") : "All Grades"),
    grade_eligibility: Array.isArray(c.gradeEligibility) ? c.gradeEligibility : (c.grade_eligibility || ["Grade 6", "Grade 7", "Grade 8"]),
    duration: c.duration || "6 Months",
    fee: parseFloat(c.fee) || 300.00,
    max_students: parseInt(c.maxStudents || c.max_students) || 20,
    enrolled_students: 0,
    status: c.status || "Active",
    assigned_teachers: Array.isArray(c.assignedTeachers) ? c.assignedTeachers : (c.assigned_teachers || []),
    mapped_students: Array.isArray(c.mappedStudents) ? c.mappedStudents : (c.mapped_students || []),
    schedule: Array.isArray(c.schedule) ? c.schedule : [
      { id: `sch-${Date.now()}-1`, day: "Monday", slot: "09:00 AM - 10:30 AM", room: "Room 101", programTrack: "Core Foundations" },
      { id: `sch-${Date.now()}-2`, day: "Wednesday", slot: "09:00 AM - 10:30 AM", room: "Room 101", programTrack: "Practical Application" },
      { id: `sch-${Date.now()}-3`, day: "Saturday", slot: "10:00 AM - 11:30 AM", room: "Virtual Room A", programTrack: "Weekend Review & Q&A" }
    ]
  };

  let savedData = newCourse;

  try {
    const { data, error } = await supabaseAdmin
      .from("courses")
      .insert([newCourse])
      .select()
      .single();

    if (!error && data) {
      savedData = { ...newCourse, ...data };
    } else {
      inMemoryCourses.unshift(newCourse);
    }
  } catch {
    inMemoryCourses.unshift(newCourse);
  }

  // Automatically generate Attendance Sessions for the newly added course with its schedule slots
  autoGenerateAttendanceSessionsForCourse(savedData);

  res.status(201).json({
    success: true,
    message: `Course '${newCourse.name}' created with code ${uniqueCode}. Attendance sessions automatically generated.`,
    data: savedData
  });
};

router.post("/add", createCourseHandler);
router.post("/", createCourseHandler);

// PUT: Update an existing course (Admin & Accountant)
export const editCourseHandler = async (req: express.Request, res: express.Response) => {
  const c = req.body;
  const courseId = req.params.id || c.id;
  if (!courseId) {
    return res.status(400).json({ success: false, message: "Course ID is required for editing." });
  }

  const idx = inMemoryCourses.findIndex(item => item.id === courseId || item.course_code === courseId);
  if (idx === -1 || !inMemoryCourses[idx]) {
    return res.status(404).json({ success: false, message: `Course '${courseId}' not found.` });
  }

  const currentCourse = inMemoryCourses[idx]!;

  const updatedCourse: CourseData = {
    id: currentCourse.id,
    course_code: currentCourse.course_code,
    name: c.name !== undefined ? c.name : currentCourse.name,
    description: c.description !== undefined ? c.description : currentCourse.description,
    category: c.category !== undefined ? c.category : currentCourse.category,
    grade_category: c.gradeCategory !== undefined ? c.gradeCategory : (c.grade_category !== undefined ? c.grade_category : currentCourse.grade_category),
    age_group: c.ageGroup !== undefined ? c.ageGroup : (c.age_group !== undefined ? c.age_group : currentCourse.age_group),
    grade_eligibility: Array.isArray(c.gradeEligibility) ? c.gradeEligibility : (c.grade_eligibility !== undefined ? c.grade_eligibility : currentCourse.grade_eligibility),
    duration: c.duration !== undefined ? c.duration : currentCourse.duration,
    fee: c.fee !== undefined ? parseFloat(c.fee) : currentCourse.fee,
    max_students: c.maxStudents !== undefined ? parseInt(c.maxStudents) : (c.max_students !== undefined ? parseInt(c.max_students) : currentCourse.max_students),
    enrolled_students: currentCourse.enrolled_students,
    status: c.status !== undefined ? c.status : currentCourse.status,
    assigned_teachers: Array.isArray(c.assignedTeachers) ? c.assignedTeachers : (c.assigned_teachers !== undefined ? c.assigned_teachers : currentCourse.assigned_teachers),
    mapped_students: Array.isArray(c.mappedStudents) ? c.mappedStudents : (c.mapped_students !== undefined ? c.mapped_students : currentCourse.mapped_students),
    schedule: Array.isArray(c.schedule) ? c.schedule : currentCourse.schedule
  };

  inMemoryCourses[idx] = updatedCourse;

  try {
    await supabaseAdmin
      .from("courses")
      .update(updatedCourse)
      .eq("id", courseId);
  } catch {
    // fallback
  }

  // Update attendance sessions
  autoGenerateAttendanceSessionsForCourse(updatedCourse);

  res.status(200).json({
    success: true,
    message: `Course '${updatedCourse.name}' updated successfully in real time!`,
    data: updatedCourse
  });
};

router.put("/edit/:id", editCourseHandler);
router.put("/:id", editCourseHandler);
router.post("/edit", editCourseHandler);

// PUT: Update Course Weekly Schedule (Mon-Sat, Time Slots, Room, Program Track, Teacher)
export const updateCourseScheduleHandler = async (req: express.Request, res: express.Response) => {
  const courseId = req.params.id;
  const { schedule } = req.body;

  if (!courseId) {
    return res.status(400).json({ success: false, message: "Course ID is required." });
  }
  if (!Array.isArray(schedule)) {
    return res.status(400).json({ success: false, message: "Schedule must be an array of schedule slots." });
  }

  const idx = inMemoryCourses.findIndex(c => c.id === courseId || c.course_code === courseId);
  if (idx === -1 || !inMemoryCourses[idx]) {
    return res.status(404).json({ success: false, message: `Course '${courseId}' not found.` });
  }

  inMemoryCourses[idx]!.schedule = schedule;

  // Auto update attendance sessions for the updated schedule
  autoGenerateAttendanceSessionsForCourse(inMemoryCourses[idx]);

  res.status(200).json({
    success: true,
    message: `Weekly schedule for '${inMemoryCourses[idx]!.name}' updated successfully. Attendance sessions regenerated.`,
    data: inMemoryCourses[idx]
  });
};

router.put("/:id/schedule", updateCourseScheduleHandler);

// POST: Map or Unmap Teacher to Course
export const mapTeacherHandler = async (req: express.Request, res: express.Response) => {
  const courseId = req.params.id;
  const { teacherId, teacherName, action } = req.body; // action: 'add' | 'remove'

  const idx = inMemoryCourses.findIndex(c => c.id === courseId || c.course_code === courseId);
  if (idx === -1 || !inMemoryCourses[idx]) {
    return res.status(404).json({ success: false, message: `Course '${courseId}' not found.` });
  }

  const course = inMemoryCourses[idx]!;
  if (!Array.isArray(course.assigned_teachers)) {
    course.assigned_teachers = [];
  }

  if (action === "remove") {
    course.assigned_teachers = course.assigned_teachers.filter(t => t.teacherId !== teacherId && t.name !== teacherName);
  } else {
    const existing = course.assigned_teachers.find(t => t.teacherId === teacherId || t.name === teacherName);
    if (!existing) {
      const teacherObj = inMemoryTeachers.find(t => t.id === teacherId || t.name === teacherName) || {
        id: teacherId || `tch-${Date.now()}`,
        teacher_id_code: `TG-FAC-${Math.floor(100 + Math.random() * 899)}`,
        name: teacherName || "manikanta",
        email: "manikanta@topgrade.edu"
      };

      course.assigned_teachers.push({
        teacherId: teacherObj.id,
        teacherCode: teacherObj.teacher_id_code || `TG-FAC-${teacherObj.id}`,
        name: teacherObj.name,
        email: teacherObj.email || "",
        role: "Faculty Instructor",
        weeklySessions: 4
      });
    }
  }

  res.status(200).json({
    success: true,
    message: `Teacher mapping updated for '${course.name}'.`,
    data: course
  });
};

router.post("/:id/map-teacher", mapTeacherHandler);

// POST: Map or Unmap Student to Course
export const mapStudentHandler = async (req: express.Request, res: express.Response) => {
  const courseId = req.params.id;
  const { studentId, studentName, action } = req.body; // action: 'add' | 'remove'

  const idx = inMemoryCourses.findIndex(c => c.id === courseId || c.course_code === courseId);
  if (idx === -1 || !inMemoryCourses[idx]) {
    return res.status(404).json({ success: false, message: `Course '${courseId}' not found.` });
  }

  const course = inMemoryCourses[idx]!;
  if (!Array.isArray(course.mapped_students)) {
    course.mapped_students = [];
  }

  if (action === "remove") {
    course.mapped_students = course.mapped_students.filter(s => s.studentId !== studentId && s.fullName !== studentName);
  } else {
    const existing = course.mapped_students.find(s => s.studentId === studentId || s.fullName === studentName);
    if (!existing) {
      const studentObj = inMemoryStudentStore.find(s => s.id === studentId || s.fullName === studentName) || {
        id: studentId || `std-${Date.now()}`,
        studentCode: `TG-STU-${Math.floor(100 + Math.random() * 899)}`,
        fullName: studentName || "Student",
        grade: "Grade 8",
        status: "ACTIVE"
      };

      course.mapped_students.push({
        studentId: studentObj.id || `std-${Date.now()}`,
        studentCode: studentObj.studentCode || `TG-STU-${Date.now()}`,
        fullName: studentObj.fullName || "Student",
        grade: studentObj.grade || "General",
        status: studentObj.status || "ACTIVE",
        enrollmentDate: (new Date().toISOString().split("T")[0]) || "2026-08-31"
      });
    }
  }

  course.enrolled_students = course.mapped_students.length;

  res.status(200).json({
    success: true,
    message: `Student enrollment mapping updated for '${course.name}'.`,
    data: course
  });
};

router.post("/:id/map-student", mapStudentHandler);

// DELETE: Remove course
export const deleteCourseHandler = async (req: express.Request, res: express.Response) => {
  const courseId = req.params.id;
  if (!courseId) {
    return res.status(400).json({ success: false, message: "Course ID is required." });
  }

  const idx = inMemoryCourses.findIndex(c => c.id === courseId || c.course_code === courseId);
  if (idx === -1 || !inMemoryCourses[idx]) {
    return res.status(404).json({ success: false, message: `Course with ID '${courseId}' not found.` });
  }

  const deletedCourse = inMemoryCourses.splice(idx, 1)[0]!;

  // Remove corresponding attendance sessions
  removeAttendanceSessionsForCourse(String(courseId));

  try {
    await supabaseAdmin.from("courses").delete().eq("id", courseId);
  } catch {
    // fallback
  }

  res.status(200).json({
    success: true,
    message: `Course '${deletedCourse.name}' deleted successfully. Associated attendance sessions removed.`,
    data: deletedCourse
  });
};

router.delete("/:id", deleteCourseHandler);
router.delete("/delete/:id", deleteCourseHandler);

export default router;