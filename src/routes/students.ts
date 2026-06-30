import express from "express";
import { supabaseAdmin } from "../index.js";

const router = express.Router();

// 1. GET: /api/students/list (Fetches all records for the management table)
router.get("/list", async (req, res) => {
  try {
    const { data, error } = await supabaseAdmin
      .from("students")
      .select("*")
      .order("created_at", { ascending: false });

    if (error) throw error;

    res.status(200).json({
      success: true,
      data: data
    });
  } catch (error: any) {
    console.error("Fetch Students Ledger Error:", error);
    res.status(500).json({
      success: false,
      message: error.message || "Internal transaction database retrieval failure."
    });
  }
});

// 2. POST: /api/students/add
router.post("/add", async (req, res) => {
  const { 
    studentName, 
    photoUrl, 
    gender, 
    dateOfBirth, 
    age, 
    school, 
    gradeLevel, 
    bloodGroup, 
    medicalNotes, 
    specialNeeds, 
    status 
  } = req.body;

  try {
    const uniqueShortId = `TG-2026-${Math.floor(1000 + Math.random() * 9000)}`;

    const { data, error } = await supabaseAdmin
      .from("students")
      .insert([
        {
          student_id_code: uniqueShortId,
          name: studentName,
          photo_url: photoUrl || null,
          gender: gender,
          dob: dateOfBirth,
          age: parseInt(age) || 0,
          school: school || null,
          grade_level: gradeLevel,
          blood_group: bloodGroup,
          medical_notes: medicalNotes || null,
          special_needs: specialNeeds || null,
          status: status || "Active"
        }
      ])
      .select()
      .single();

    if (error) throw error;

    res.status(201).json({
      success: true,
      message: "Student file committed natively to Supabase ledger.",
      data: data
    });

  } catch (error: any) {
    console.error("Student Registration DB Error:", error);
    res.status(500).json({
      success: false,
      message: error.message || "Internal database transaction failure."
    });
  }
});

export default router;