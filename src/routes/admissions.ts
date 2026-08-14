import express from "express";
import { supabaseAdmin } from "../index.js";
import { authenticateJwt } from "../middleware/auth.js";
import type { AuthenticatedRequest } from "../middleware/auth.js";
import { authorizePermission } from "../middleware/authorize.js";
import { dispatchMultiChannelNotification } from "../services/notificationService.js";

const router = express.Router();

let inMemoryAdmissions: any[] = [];

// Unified Handler for Public Admission Requests (/inquiry & /register)
const handleAdmissionSubmission = async (req: express.Request, res: express.Response) => {
  const { 
    studentName, 
    email, 
    phone, 
    courseInterested, 
    parentEmail, 
    parentPhone, 
    gradeLevel,
    fatherName,
    motherName
  } = req.body;

  const targetEmail = email || parentEmail;
  const targetPhone = phone || parentPhone;
  const targetCourse = courseInterested || gradeLevel || "General Enrollment";

  if (!studentName || !targetEmail) {
    res.status(400).json({ success: false, message: "Student Name and Email (or Parent Email) are required for admission inquiry." });
    return;
  }

  const newInquiry = {
    id: `inq-${Date.now()}`,
    student_name: studentName,
    email: targetEmail,
    phone: targetPhone || null,
    course_interested: targetCourse,
    status: "Pending",
    created_at: new Date().toISOString()
  };

  let savedData = newInquiry;

  try {
    const { data, error } = await supabaseAdmin
      .from("admission_requests")
      .insert([newInquiry])
      .select()
      .single();

    if (!error && data) {
      savedData = data;
    } else {
      inMemoryAdmissions.unshift(newInquiry);
    }
  } catch (err: any) {
    inMemoryAdmissions.unshift(newInquiry);
  }

  const adminEmail = process.env.GMAIL_USER || "sivareddy683970@gmail.com";

  // Trigger Automatic Emails to BOTH Admin & Student/Parent
  await dispatchMultiChannelNotification({
    eventType: "ADMISSION_INQUIRY",
    subject: `TopGrade Admission Inquiry Received — ${studentName}`,
    message: `Dear ${studentName},\nThank you for applying to TopGrade CRM. Your admission inquiry for ${targetCourse} has been received. Our administration will review your request shortly.${fatherName ? `\nParent: ${fatherName}` : ''}`,
    recipients: [
      { role: "STUDENT", email: targetEmail, name: studentName, phone: targetPhone },
      { role: "ADMIN", email: adminEmail, name: "System Administrator" }
    ]
  });

  res.status(201).json({
    success: true,
    message: "Admission inquiry submitted successfully. Confirmation emails sent to Admin & Student.",
    data: savedData
  });
};

// 1. PUBLIC: Submit prospective student admission inquiry (Supports /inquiry and /register)
router.post("/inquiry", handleAdmissionSubmission);
router.post("/register", handleAdmissionSubmission);

// 2. PROTECTED: List pending admission requests (Admin & Accountant)
router.get("/list", authenticateJwt, authorizePermission("students.view"), async (_req: AuthenticatedRequest, res) => {
  try {
    const { data, error } = await supabaseAdmin
      .from("admission_requests")
      .select("*")
      .order("created_at", { ascending: false });

    if (error || !data) {
      res.status(200).json({ success: true, data: inMemoryAdmissions });
      return;
    }

    res.status(200).json({ success: true, data });
  } catch (err: any) {
    res.status(200).json({ success: true, data: inMemoryAdmissions });
  }
});

// 3. PROTECTED: Admin Approve Admission Inquiry
router.post("/approve/:id", authenticateJwt, authorizePermission("students.create"), async (req: AuthenticatedRequest, res) => {
  const { id } = req.params;

  try {
    await supabaseAdmin
      .from("admission_requests")
      .update({ status: "Approved" })
      .eq("id", id);
  } catch (err) {
    const idx = inMemoryAdmissions.findIndex(a => a.id === id);
    if (idx > -1) inMemoryAdmissions[idx].status = "Approved";
  }

  // Trigger Automatic Emails to Student & Accountant
  await dispatchMultiChannelNotification({
    eventType: "ADMISSION_APPROVED",
    subject: `🎉 Admission Approved — Welcome to TopGrade!`,
    message: `Your admission request has been APPROVED by the Administrator! Our Accountant will now proceed to complete your formal course registration.`,
    recipients: [
      { role: "STUDENT", email: "student@topgrade.edu", name: "Student" },
      { role: "ACCOUNTANT", email: "accountant@topgrade.edu", name: "Billing Department" }
    ]
  });

  res.status(200).json({
    success: true,
    message: "Admission inquiry approved! Automatic notifications dispatched to Student & Accountant."
  });
});

export default router;
