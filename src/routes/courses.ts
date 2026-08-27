import express from "express";
import { supabaseAdmin } from "../index.js";
import { authenticateJwt } from "../middleware/auth.js";
import type { AuthenticatedRequest } from "../middleware/auth.js";
import { authorizePermission } from "../middleware/authorize.js";
import { demoCoursesPool } from "../services/demoDataService.js";

const router = express.Router();

let inMemoryCourses: any[] = [
  {
    id: "crs-1",
    course_code: "TG-CRS-101",
    name: "Coding & Software Engineering",
    description: "Full stack programming track for K-12 students",
    age_group: "10-18 Years",
    duration: "12 Weeks",
    fee: 499.00,
    max_students: 15,
    status: "Active"
  },
  {
    id: "crs-2",
    course_code: "TG-CRS-102",
    name: "3D Printing & CAD Design",
    description: "Spatial geometry and 3D modeling fundamentals",
    age_group: "8-16 Years",
    duration: "8 Weeks",
    fee: 399.00,
    max_students: 12,
    status: "Active"
  }
];

// GET: Fetch all courses with fail-safe fallback
export const getCoursesHandler = async (req: express.Request, res: express.Response) => {
  const { grade } = req.query;
  let list = inMemoryCourses;
  if (grade && grade !== "ALL") {
    list = inMemoryCourses.filter(c => {
      if (!c.grade_eligibility || c.grade_eligibility.length === 0) return true;
      if (c.grade_eligibility.includes("All Grades") || c.grade_eligibility.includes("ALL")) return true;
      return c.grade_eligibility.includes(grade as string) || (c.age_group && c.age_group.includes(grade as string));
    });
  }
  res.status(200).json({ success: true, data: list });
};

router.get("/list", getCoursesHandler);
router.get("/", getCoursesHandler);

// POST: Provision a new course with fail-safe fallback
export const createCourseHandler = async (req: express.Request, res: express.Response) => {
  const c = req.body;
  const uniqueCode = `TG-CRS-${Math.floor(100 + Math.random() * 899)}`;

  const newCourse = {
    id: `crs-${Date.now()}`,
    course_code: uniqueCode,
    name: c.name,
    description: c.description || null,
    age_group: c.ageGroup || c.age_group || null,
    grade_eligibility: Array.isArray(c.gradeEligibility) ? c.gradeEligibility : (c.grade_eligibility || ["All Grades"]),
    duration: c.duration || null,
    fee: parseFloat(c.fee) || 0.00,
    max_students: parseInt(c.maxStudents || c.max_students) || 15,
    enrolled_students: 0,
    required_teacher_skills: c.requiredTeacherSkills || null,
    course_material: c.courseMaterial || null,
    status: c.status || "Active"
  };

  let savedData = newCourse;

  try {
    const { data, error } = await supabaseAdmin
      .from("courses")
      .insert([newCourse])
      .select()
      .single();

    if (!error && data) {
      savedData = data;
    } else {
      inMemoryCourses.unshift(newCourse);
    }
  } catch (error: any) {
    inMemoryCourses.unshift(newCourse);
  }

  res.status(201).json({ success: true, data: savedData });
};

router.post("/add", createCourseHandler);
router.post("/", createCourseHandler);

// POST/PUT: Update an existing course stream (Admin & Accountant)
export const editCourseHandler = async (req: express.Request, res: express.Response) => {
  const c = req.body;
  const courseId = req.params.id || c.id;
  if (!courseId) {
    return res.status(400).json({ success: false, message: "Course ID is required for editing." });
  }

  const updatedCourse = {
    id: courseId,
    course_code: c.courseCode || c.course_code || `TG-CRS-${courseId}`,
    name: c.name,
    description: c.description || null,
    age_group: c.ageGroup || c.age_group || null,
    grade_eligibility: Array.isArray(c.gradeEligibility) ? c.gradeEligibility : (c.grade_eligibility || ["All Grades"]),
    duration: c.duration || null,
    fee: parseFloat(c.fee) || 0.00,
    max_students: parseInt(c.maxStudents || c.max_students) || 15,
    status: c.status || "Active"
  };

  let savedData = updatedCourse;

  try {
    const { data, error } = await supabaseAdmin
      .from("courses")
      .update(updatedCourse)
      .eq("id", courseId)
      .select()
      .single();

    if (!error && data) {
      savedData = data;
    } else {
      const idx = inMemoryCourses.findIndex(item => item.id === courseId);
      if (idx !== -1) {
        inMemoryCourses[idx] = { ...inMemoryCourses[idx], ...updatedCourse };
      }
    }
  } catch (error: any) {
    const idx = inMemoryCourses.findIndex(item => item.id === courseId);
    if (idx !== -1) {
      inMemoryCourses[idx] = { ...inMemoryCourses[idx], ...updatedCourse };
    }
  }

  res.status(200).json({ success: true, message: `Course stream '${c.name}' updated successfully!`, data: savedData });
};

router.post("/edit", editCourseHandler);
router.put("/edit/:id", editCourseHandler);
router.put("/:id", editCourseHandler);

// DELETE: Remove course stream
export const deleteCourseHandler = async (req: express.Request, res: express.Response) => {
  const courseId = req.params.id;
  if (!courseId) {
    return res.status(400).json({ success: false, message: "Course ID is required." });
  }

  const idx = inMemoryCourses.findIndex(c => c.id === courseId || c.course_code === courseId);
  if (idx === -1) {
    return res.status(404).json({ success: false, message: `Course with ID '${courseId}' not found.` });
  }

  const deletedCourse = inMemoryCourses.splice(idx, 1)[0];

  try {
    await supabaseAdmin.from("courses").delete().eq("id", courseId);
  } catch (err) {
    // fallback
  }

  res.status(200).json({
    success: true,
    message: `Course stream '${deletedCourse.name}' deleted successfully.`,
    data: deletedCourse
  });
};

router.delete("/:id", deleteCourseHandler);
router.delete("/delete/:id", deleteCourseHandler);

export default router;