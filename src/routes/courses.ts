import express from "express";
import { supabaseAdmin } from "../index.js";

const router = express.Router();

// GET: Fetch all courses ledger elements
router.get("/list", async (req, res) => {
  try {
    const { data, error } = await supabaseAdmin
      .from("courses")
      .select("*")
      .order("created_at", { ascending: false });

    if (error) throw error;
    res.status(200).json({ success: true, data });
  } catch (error: any) {
    res.status(500).json({ success: false, message: error.message });
  }
});

// POST: Provision a new specialized course matrix
router.post("/add", async (req, res) => {
  const c = req.body;
  try {
    const uniqueCode = `TG-CRS-${Math.floor(100 + Math.random() * 899)}`;

    const { data, error } = await supabaseAdmin
      .from("courses")
      .insert([
        {
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
        }
      ])
      .select()
      .single();

    if (error) throw error;
    res.status(201).json({ success: true, data });
  } catch (error: any) {
    res.status(500).json({ success: false, message: error.message });
  }
});

export default router;