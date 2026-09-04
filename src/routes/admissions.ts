import express from "express";
import { supabaseAdmin } from "../supabase.js";
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
    fatherName,
    motherName,
    studentPhone,
    fatherPhone,
    motherPhone,
    gender,
    dateOfBirth,
    age,
    studentEmail, 
    parentEmails,
    parentEmail,
    gradeLevel,
    courseInterested, 
    phone, 
    email
  } = req.body;

  const targetStudentEmail = studentEmail || email || parentEmail || "";
  const targetParentEmails: string[] = Array.isArray(parentEmails) && parentEmails.length > 0 
    ? parentEmails 
    : (parentEmail ? [parentEmail] : []);
  const targetStudentPhone = studentPhone || phone || "";
  const targetGrade = gradeLevel || courseInterested || "Grade 1";

  if (!studentName || !targetStudentEmail) {
    res.status(400).json({ success: false, message: "Student Name and Student Email (or Parent Email) are required for admission inquiry." });
    return;
  }

  const newInquiry = {
    id: `inq-${Date.now()}`,
    student_name: studentName,
    father_name: fatherName || "",
    mother_name: motherName || "",
    student_phone: targetStudentPhone,
    father_phone: fatherPhone || "",
    mother_phone: motherPhone || "",
    gender: gender || "Male",
    date_of_birth: dateOfBirth || null,
    age: age || null,
    student_email: targetStudentEmail,
    parent_emails: targetParentEmails,
    email: targetStudentEmail,
    parent_email: targetParentEmails[0] || "",
    grade_level: targetGrade,
    course_interested: targetGrade,
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

  // Build Notification Recipients list
  const recipients: Array<{ role: "STUDENT" | "PARENT" | "ADMIN"; email: string; name: string }> = [
    { role: "STUDENT", email: targetStudentEmail, name: studentName },
    { role: "ADMIN", email: adminEmail, name: "System Administrator" }
  ];

  targetParentEmails.forEach((pEmail, idx) => {
    if (pEmail && pEmail.trim() !== "") {
      recipients.push({
        role: "PARENT",
        email: pEmail.trim(),
        name: fatherName || motherName || `Parent ${idx + 1}`
      });
    }
  });

  // Trigger Automatic Emails to Student, Parents, and Admin
  await dispatchMultiChannelNotification({
    eventType: "ADMISSION_INQUIRY",
    subject: `TopGrade Admission Inquiry Received — ${studentName}`,
    message: `Dear ${studentName},\n\nThank you for submitting your admission enrollment request to TopGrade Learning.\n\n📋 Inquiry Summary:\n• Student Name: ${studentName}\n• Academic Grade: ${targetGrade}\n• Date of Birth: ${dateOfBirth || "N/A"} (${age ? `${age} Yrs` : "N/A"})\n• Father Name: ${fatherName || "N/A"} (${fatherPhone || "N/A"})\n• Mother Name: ${motherName || "N/A"} (${motherPhone || "N/A"})\n\nOur center administration will review your application shortly.`,
    recipients
  });

  res.status(201).json({
    success: true,
    message: "Admission inquiry submitted successfully. Confirmation emails sent to Student, Parent & Admin.",
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

    if (error || !data || data.length === 0) {
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
  const adminEmail = process.env.GMAIL_USER || "sivareddy683970@gmail.com";
  const accountantEmail = process.env.ACCOUNTANT_EMAIL || adminEmail;

  let targetInquiry: any = null;

  try {
    const { data } = await supabaseAdmin
      .from("admission_requests")
      .select("*")
      .eq("id", id)
      .single();

    if (data) targetInquiry = data;

    await supabaseAdmin
      .from("admission_requests")
      .update({ status: "Approved" })
      .eq("id", id);
  } catch (err) {
    const idx = inMemoryAdmissions.findIndex(a => a.id === id);
    if (idx > -1) {
      inMemoryAdmissions[idx].status = "Approved";
      targetInquiry = inMemoryAdmissions[idx];
    }
  }

  if (!targetInquiry) {
    targetInquiry = inMemoryAdmissions.find(a => a.id === id) || { student_name: "Student", email: adminEmail };
  }

  // Update in-memory record status
  const memIdx = inMemoryAdmissions.findIndex(a => a.id === id);
  if (memIdx > -1) inMemoryAdmissions[memIdx].status = "Approved";

  const studentName = targetInquiry.student_name || "Student";
  const studentEmail = targetInquiry.student_email || targetInquiry.email || adminEmail;
  const parentEmailsList: string[] = Array.isArray(targetInquiry.parent_emails) && targetInquiry.parent_emails.length > 0 
    ? targetInquiry.parent_emails 
    : (targetInquiry.parent_email ? [targetInquiry.parent_email] : []);

  const recipients: Array<{ role: "STUDENT" | "PARENT" | "ADMIN" | "ACCOUNTANT"; email: string; name: string }> = [
    { role: "STUDENT", email: studentEmail, name: studentName },
    { role: "ADMIN", email: adminEmail, name: "System Administrator" },
    { role: "ACCOUNTANT", email: accountantEmail, name: "Accounts Department" }
  ];

  parentEmailsList.forEach((pEmail, idx) => {
    if (pEmail && pEmail.trim() !== "") {
      recipients.push({
        role: "PARENT",
        email: pEmail.trim(),
        name: targetInquiry.father_name || targetInquiry.mother_name || `Parent ${idx + 1}`
      });
    }
  });

  // Trigger Approval Email Notifications
  await dispatchMultiChannelNotification({
    eventType: "ADMISSION_APPROVED",
    subject: `🎉 Admission Approved — Welcome to TopGrade Learning!`,
    message: `Dear ${studentName},\n\nWe are delighted to inform you that your admission request for ${targetInquiry.grade_level || targetInquiry.course_interested || "Academic Program"} has been APPROVED by the Center Administrator!\n\nOur Accounts & Billing Department will complete your formal enrollment and issue your course schedules.`,
    recipients
  });

  res.status(200).json({
    success: true,
    message: "Admission inquiry approved! Automatic acceptance emails sent to Admin, Parents, Student & Accountant."
  });
});

// 4. PROTECTED: Admin Reject Admission Inquiry
router.post("/reject/:id", authenticateJwt, authorizePermission("students.create"), async (req: AuthenticatedRequest, res) => {
  const { id } = req.params;
  const adminEmail = process.env.GMAIL_USER || "sivareddy683970@gmail.com";

  let targetInquiry: any = null;

  try {
    const { data } = await supabaseAdmin
      .from("admission_requests")
      .select("*")
      .eq("id", id)
      .single();

    if (data) targetInquiry = data;

    await supabaseAdmin
      .from("admission_requests")
      .update({ status: "Rejected" })
      .eq("id", id);
  } catch (err) {
    const idx = inMemoryAdmissions.findIndex(a => a.id === id);
    if (idx > -1) {
      inMemoryAdmissions[idx].status = "Rejected";
      targetInquiry = inMemoryAdmissions[idx];
    }
  }

  if (!targetInquiry) {
    targetInquiry = inMemoryAdmissions.find(a => a.id === id) || { student_name: "Student", email: adminEmail };
  }

  // Update in-memory record status
  const memIdx = inMemoryAdmissions.findIndex(a => a.id === id);
  if (memIdx > -1) inMemoryAdmissions[memIdx].status = "Rejected";

  const studentName = targetInquiry.student_name || "Student";
  const studentEmail = targetInquiry.student_email || targetInquiry.email || adminEmail;
  const parentEmailsList: string[] = Array.isArray(targetInquiry.parent_emails) && targetInquiry.parent_emails.length > 0 
    ? targetInquiry.parent_emails 
    : (targetInquiry.parent_email ? [targetInquiry.parent_email] : []);

  const recipients: Array<{ role: "STUDENT" | "PARENT" | "ADMIN"; email: string; name: string }> = [
    { role: "STUDENT", email: studentEmail, name: studentName },
    { role: "ADMIN", email: adminEmail, name: "System Administrator" }
  ];

  parentEmailsList.forEach((pEmail, idx) => {
    if (pEmail && pEmail.trim() !== "") {
      recipients.push({
        role: "PARENT",
        email: pEmail.trim(),
        name: targetInquiry.father_name || targetInquiry.mother_name || `Parent ${idx + 1}`
      });
    }
  });

  // Trigger Rejection Email Notifications
  await dispatchMultiChannelNotification({
    eventType: "ADMISSION_INQUIRY",
    subject: `Admission Application Update — TopGrade Learning`,
    message: `Dear ${studentName},\n\nThank you for your interest in TopGrade Learning. Following a review of your admission application, we regret to inform you that we are unable to process your admission at this time.\n\nIf you have any questions or require further guidance, please feel free to reach out to center administration.`,
    recipients
  });

  res.status(200).json({
    success: true,
    message: "Admission inquiry rejected. Rejection emails sent to Admin, Parents & Student."
  });
});

export default router;
