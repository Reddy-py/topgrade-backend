import { Router } from "express";
import { EnrollmentService, type EnrollmentStage } from "../services/enrollmentService.js";
import { LedgerService } from "../services/ledgerService.js";

const router = Router();

// In-memory enrollment store for rapid prototyping & integration
let enrollmentsStore: any[] = [
  {
    id: "enr-101",
    leadId: "lead-wa-101",
    studentName: "Vikram Malhotra",
    email: "vikram.m@gmail.com",
    primaryMobile: "+919876543210",
    dob: "2010-06-15",
    residentialAddress: "742 Evergreen Terrace, Springfield",
    academicGrade: "Secondary (Grade 9)",
    status: "FORM_SUBMITTED" as EnrollmentStage,
    financialWaiver: true,
    transportWaiver: true,
    mediaWaiver: true,
    submittedAt: new Date(Date.now() - 3600 * 1000 * 24).toISOString()
  },
  {
    id: "enr-102",
    leadId: "lead-ig-102",
    studentName: "Priya Nair",
    email: "priya.nair@gmail.com",
    primaryMobile: "+919812345678",
    dob: "2008-11-20",
    residentialAddress: "123 Innovation Way, Tech Park",
    academicGrade: "Higher Secondary (Grade 11)",
    status: "APPROVED" as EnrollmentStage,
    financialWaiver: true,
    transportWaiver: true,
    mediaWaiver: true,
    submittedAt: new Date(Date.now() - 3600 * 1000 * 48).toISOString()
  }
];

// 1. Submit New Enrollment
router.post("/", (req, res) => {
  try {
    const { studentName, email, primaryMobile, dob, residentialAddress, academicGrade, leadId, financialWaiver, transportWaiver, mediaWaiver } = req.body;

    if (!studentName || !email || !primaryMobile || !dob || !residentialAddress || !academicGrade) {
      return res.status(400).json({
        success: false,
        message: "Missing mandatory enrollment fields (studentName, email, primaryMobile, dob, residentialAddress, academicGrade)."
      });
    }

    const calculatedAge = EnrollmentService.calculateDynamicAge(dob);

    const newEnrollment = {
      id: `enr-${Date.now()}`,
      leadId: leadId || null,
      studentName,
      email,
      primaryMobile,
      dob,
      calculatedAge,
      residentialAddress,
      academicGrade,
      status: "FORM_SUBMITTED" as EnrollmentStage,
      financialWaiver: Boolean(financialWaiver),
      transportWaiver: Boolean(transportWaiver),
      mediaWaiver: Boolean(mediaWaiver),
      submittedAt: new Date().toISOString()
    };

    enrollmentsStore.unshift(newEnrollment);

    res.status(201).json({
      success: true,
      message: "Enrollment application submitted successfully!",
      data: newEnrollment
    });
  } catch (error: any) {
    res.status(500).json({ success: false, message: error.message });
  }
});

// 2. List Enrollments
router.get("/", (req, res) => {
  const { status } = req.query;
  let filtered = enrollmentsStore;
  if (status) {
    filtered = enrollmentsStore.filter(e => e.status === String(status).toUpperCase());
  }

  res.json({
    success: true,
    count: filtered.length,
    data: filtered
  });
});

// 3. Transition State (Review/Approve)
router.patch("/:id/review", (req, res) => {
  try {
    const { id } = req.params;
    const { nextStatus, reviewNotes } = req.body;

    const enrollment = enrollmentsStore.find(e => e.id === id);
    if (!enrollment) {
      return res.status(404).json({ success: false, message: "Enrollment record not found." });
    }

    const transitionResult = EnrollmentService.transitionStage(enrollment.status, nextStatus);
    if (!transitionResult.valid) {
      return res.status(400).json({ success: false, message: transitionResult.message });
    }

    enrollment.status = nextStatus;
    enrollment.reviewNotes = reviewNotes || enrollment.reviewNotes;
    if (nextStatus === "UNDER_REVIEW") enrollment.reviewedAt = new Date().toISOString();
    if (nextStatus === "APPROVED") enrollment.approvedAt = new Date().toISOString();

    res.json({
      success: true,
      message: transitionResult.message,
      data: enrollment
    });
  } catch (error: any) {
    res.status(500).json({ success: false, message: error.message });
  }
});

// 4. Activate Student & Generate Initial Invoice
router.post("/:id/activate", (req, res) => {
  try {
    const { id } = req.params;
    const enrollment = enrollmentsStore.find(e => e.id === id);

    if (!enrollment) {
      return res.status(404).json({ success: false, message: "Enrollment record not found." });
    }

    if (enrollment.status !== "APPROVED" && enrollment.status !== "ACTIVATED") {
      return res.status(400).json({
        success: false,
        message: `Cannot activate student from state '${enrollment.status}'. Enrollment must be APPROVED first.`
      });
    }

    // Transition to ACTIVATED
    enrollment.status = "ACTIVATED";
    enrollment.activatedAt = new Date().toISOString();

    const studentCode = EnrollmentService.generateStudentCode();
    const calculatedAge = EnrollmentService.calculateDynamicAge(enrollment.dob);

    // Initial Tuition Invoice
    const invoiceResult = LedgerService.createInvoice({
      studentId: studentCode,
      studentName: enrollment.studentName,
      grossAmount: 350.0,
      discountAmount: 50.0,
      dueDate: new Date(Date.now() + 14 * 24 * 3600 * 1000).toISOString().slice(0, 10)
    });

    res.json({
      success: true,
      message: `Student '${enrollment.studentName}' activated successfully with Code ${studentCode}!`,
      data: {
        student: {
          studentCode,
          fullName: enrollment.studentName,
          email: enrollment.email,
          dob: enrollment.dob,
          calculatedAge,
          status: "ACTIVE",
          residentialAddress: enrollment.residentialAddress
        },
        initialInvoice: invoiceResult.invoice,
        ledgerDebit: invoiceResult.debitEntry
      }
    });
  } catch (error: any) {
    res.status(500).json({ success: false, message: error.message });
  }
});

export default router;
