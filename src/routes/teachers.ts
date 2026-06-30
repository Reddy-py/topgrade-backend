import express from "express";
import { supabaseAdmin } from "../index.js";

const router = express.Router();

// GET: List all teachers
router.get("/list", async (req, res) => {
  try {
    const { data, error } = await supabaseAdmin
      .from("teachers")
      .select("*")
      .order("created_at", { ascending: false });

    if (error) throw error;
    res.status(200).json({ success: true, data });
  } catch (error: any) {
    res.status(500).json({ success: false, message: error.message });
  }
});

// POST: Add new faculty teacher profiles
router.post("/add", async (req, res) => {
  const t = req.body;
  try {
    const uniqueId = `TG-FAC-${Math.floor(100 + Math.random() * 900)}`;

    const { data, error } = await supabaseAdmin
      .from("teachers")
      .insert([
        {
          teacher_id_code: uniqueId,
          name: t.name,
          photo_url: t.photoUrl || null,
          phone: t.phone || null,
          email: t.email || null,
          qualification: t.qualification || null,
          experience: t.experience || null,
          specialization: t.specialization || null,
          joining_date: t.joiningDate || null,
          salary: t.salary || null,
          status: "Active",
          availability_days: t.availabilityDays,
          availability_slots: t.availabilitySlots,
          assigned_students_count: parseInt(t.assignedStudents) || 0,
          assigned_courses_count: parseInt(t.assignedCourses) || 0,
          assigned_schedules_count: parseInt(t.assignedSchedules) || 0,
          doc_resume: !!t.docResume,
          doc_id_proof: !!t.docIdProof,
          doc_certificates: !!t.docCertificates,
          doc_contract: !!t.docContract
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