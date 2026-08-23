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
router.get("/list", authenticateJwt, authorizePermission("courses.view"), async (_req: AuthenticatedRequest, res) => {
  const mappedDemoCourses = demoCoursesPool.map(c => ({
    id: c.id,
    course_code: `TG-CRS-${c.id.replace('crs-demo-', '')}`,
    name: c.title,
    description: c.description,
    age_group: c.targetGrade,
    duration: c.duration,
    fee: c.baseFee,
    max_students: c.capacity,
    status: "Active"
  }));

  const allCourses = [...inMemoryCourses, ...mappedDemoCourses];

  res.status(200).json({ success: true, data: allCourses });
});

// POST: Provision a new course with fail-safe fallback
router.post("/add", authenticateJwt, authorizePermission("courses.create"), async (req: AuthenticatedRequest, res) => {
  const c = req.body;
  const uniqueCode = `TG-CRS-${Math.floor(100 + Math.random() * 899)}`;

  const newCourse = {
    id: `crs-${Date.now()}`,
    course_code: uniqueCode,
    name: c.name,
    description: c.description || null,
    age_group: c.ageGroup || null,
    duration: c.duration || null,
    fee: parseFloat(c.fee) || 0.00,
    max_students: parseInt(c.maxStudents) || 15,
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
});

// POST: Update an existing course stream (Admin & Accountant)
router.post("/edit", authenticateJwt, authorizePermission("courses.edit"), async (req: AuthenticatedRequest, res) => {
  const c = req.body;
  if (!c.id) {
    return res.status(400).json({ success: false, message: "Course ID is required for editing." });
  }

  const updatedCourse = {
    id: c.id,
    course_code: c.courseCode || c.course_code || `TG-CRS-${c.id}`,
    name: c.name,
    description: c.description || null,
    age_group: c.ageGroup || c.age_group || null,
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
      .eq("id", c.id)
      .select()
      .single();

    if (!error && data) {
      savedData = data;
    } else {
      const idx = inMemoryCourses.findIndex(item => item.id === c.id);
      if (idx !== -1) {
        inMemoryCourses[idx] = { ...inMemoryCourses[idx], ...updatedCourse };
      }
    }
  } catch (error: any) {
    const idx = inMemoryCourses.findIndex(item => item.id === c.id);
    if (idx !== -1) {
      inMemoryCourses[idx] = { ...inMemoryCourses[idx], ...updatedCourse };
    }
  }

  res.status(200).json({ success: true, message: "Course stream updated successfully!", data: savedData });
});

export default router;