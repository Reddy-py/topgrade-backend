import express from "express";
import { supabaseAdmin } from "../index.js";

const router = express.Router();

// GET: Fetch complete student files
router.get("/list", async (req, res) => {
  try {
    const { data, error } = await supabaseAdmin
      .from("students")
      .select("*")
      .order("created_at", { ascending: false });

    if (error) throw error;

    res.status(200).json({ success: true, data });
  } catch (error: any) {
    console.error("Fetch Error:", error);
    res.status(500).json({ success: false, message: error.message });
  }
});

// POST: Add student along with comprehensive details
router.post("/add", async (req, res) => {
  const s = req.body;

  try {
    const uniqueShortId = `TG-2026-${Math.floor(1000 + Math.random() * 9000)}`;

    const { data, error } = await supabaseAdmin
      .from("students")
      .insert([
        {
          student_id_code: uniqueShortId,
          name: s.studentName,
          photo_url: s.photoUrl || null,
          gender: s.gender,
          dob: s.dateOfBirth,
          age: parseInt(s.age) || 0,
          school: s.school || null,
          grade_level: s.gradeLevel,
          blood_group: s.bloodGroup,
          medical_notes: s.medicalNotes || null,
          special_needs: s.specialNeeds || null,
          status: s.status || "Active",

          // Parent Details Mapping
          father_name: s.fatherName || null,
          mother_name: s.motherName || null,
          guardian: s.guardian || null,
          phone: s.phone || null,
          whatsapp: s.whatsapp || null,
          email: s.email || null,
          occupation: s.occupation || null,
          emergency_contact: s.emergencyContact || null,
          relationship: s.relationship || null,
          address: s.address || null,

          // Enrollment Matrix Mapping
          admission_date: s.admissionDate || null,
          program: s.program || null,
          teacher: s.teacher || null,
          weekly_classes: parseInt(s.weeklyClasses) || null,
          course_duration: s.courseDuration || null,
          start_date: s.startDate || null,
          end_date: s.endDate || null,
          fee_plan: s.feePlan || null,
          discount: s.discount || null,
          scholarship: s.scholarship || null,
          operational_notes: s.operationalNotes || null,

          // Documents Flag Booleans
          doc_birth_certificate: !!s.docBirthCertificate,
          doc_photo: !!s.docPhoto,
          doc_id_proof: !!s.docIdProof,
          doc_school_id: !!s.docSchoolId,
          doc_medical_certificate: !!s.docMedicalCertificate,
          doc_agreement: !!s.docAgreement
        }
      ])
      .select()
      .single();

    if (error) throw error;

    res.status(201).json({ success: true, data });
  } catch (error: any) {
    console.error("DB Save Fault:", error);
    res.status(500).json({ success: false, message: error.message });
  }
});

export default router;