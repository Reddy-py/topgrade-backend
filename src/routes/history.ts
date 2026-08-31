import express from "express";
import { HistoryService } from "../services/historyService.js";

const router = express.Router();

// 1. GET HISTORY OVERVIEW (GET /api/history/overview)
router.get("/overview", (_req, res) => {
  try {
    const overview = HistoryService.getHistoryOverview();
    res.status(200).json({ success: true, data: overview });
  } catch (err: any) {
    res.status(500).json({ success: false, message: err.message });
  }
});

// 2. GET TUTORING PAST (GET /api/history/tutoring)
router.get("/tutoring", (req, res) => {
  try {
    const studentId = req.query.studentId ? String(req.query.studentId) : undefined;
    const data = HistoryService.getTutoringPast(studentId);
    res.status(200).json({ success: true, count: data.length, data });
  } catch (err: any) {
    res.status(500).json({ success: false, message: err.message });
  }
});

// 3. GET AFTERSCHOOL PAST (GET /api/history/afterschool)
router.get("/afterschool", (req, res) => {
  try {
    const studentId = req.query.studentId ? String(req.query.studentId) : undefined;
    const data = HistoryService.getAfterschoolPast(studentId);
    res.status(200).json({ success: true, count: data.length, data });
  } catch (err: any) {
    res.status(500).json({ success: false, message: err.message });
  }
});

// 4. GET LONGITUDINAL STUDENT TIMELINE (GET /api/history/students)
router.get("/students", (req, res) => {
  try {
    const studentId = req.query.studentId ? String(req.query.studentId) : undefined;
    const timeline = HistoryService.getStudentHistoryTimeline(studentId);
    res.status(200).json({ success: true, count: timeline.length, data: timeline });
  } catch (err: any) {
    res.status(500).json({ success: false, message: err.message });
  }
});

// 5. GET PAYMENT AUDIT HISTORY (GET /api/history/payments)
router.get("/payments", (req, res) => {
  try {
    const studentId = req.query.studentId ? String(req.query.studentId) : undefined;
    const data = HistoryService.getPaymentHistory(studentId);
    res.status(200).json({ success: true, count: data.length, data });
  } catch (err: any) {
    res.status(500).json({ success: false, message: err.message });
  }
});

// 6. GET ATTENDANCE AUDIT HISTORY (GET /api/history/attendance)
router.get("/attendance", (req, res) => {
  try {
    const studentId = req.query.studentId ? String(req.query.studentId) : undefined;
    const data = HistoryService.getAttendanceHistory(studentId);
    res.status(200).json({ success: true, count: data.length, data });
  } catch (err: any) {
    res.status(500).json({ success: false, message: err.message });
  }
});

// 7. TRIGGER RE-ENROLLMENT INVITATION (POST /api/history/trigger-reenrollment)
router.post("/trigger-reenrollment", async (req, res) => {
  try {
    const { recordId, studentId, studentName, programType, offerDiscountCode, customNote } = req.body;
    if (!studentId || !studentName) {
      return res.status(400).json({ success: false, message: "studentId and studentName are required." });
    }

    const result = await HistoryService.triggerReenrollmentInvite({
      recordId: recordId || "rec-auto",
      studentId,
      studentName,
      programType: programType || "TUTORING",
      offerDiscountCode,
      customNote
    });

    res.status(200).json(result);
  } catch (err: any) {
    res.status(500).json({ success: false, message: err.message });
  }
});

export default router;
