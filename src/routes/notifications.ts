import express from "express";
import { runAutomatedEmailScan, sendBirthdayGreetings, sendExamGoodLuckWishes } from "../services/automatedEmailService.js";
import { inMemoryStudentStore } from "../services/studentService.js";

const router = express.Router();

/**
 * POST /api/notifications/trigger-birthdays
 * Force scan and send birthday emails for today
 */
router.post("/trigger-birthdays", async (_req, res): Promise<any> => {
  try {
    const result = await runAutomatedEmailScan();
    return res.status(200).json({
      success: true,
      message: `Birthday and exam email scan completed.`,
      data: result
    });
  } catch (err: any) {
    return res.status(500).json({ success: false, error: err.message });
  }
});

/**
 * POST /api/notifications/trigger-exam-wishes
 * Force scan and send good luck emails for upcoming exams
 */
router.post("/trigger-exam-wishes", async (_req, res): Promise<any> => {
  try {
    const result = await runAutomatedEmailScan();
    return res.status(200).json({
      success: true,
      message: `Exam good luck scan completed.`,
      data: result
    });
  } catch (err: any) {
    return res.status(500).json({ success: false, error: err.message });
  }
});

/**
 * POST /api/notifications/send-exam-wish/:studentId
 * Send immediate good luck wish to specific student
 */
router.post("/send-exam-wish/:studentId", async (req, res): Promise<any> => {
  try {
    const { studentId } = req.params;
    const { examDate } = req.body || {};
    const student = inMemoryStudentStore.find(s => s.id === studentId || s.studentCode === studentId);
    if (!student) {
      return res.status(404).json({ success: false, error: "Student not found" });
    }

    const dateToUse = examDate || student.examDate || new Date().toISOString().split("T")[0];
    const ok = await sendExamGoodLuckWishes(student, dateToUse);
    return res.status(200).json({
      success: ok,
      message: ok ? `Exam good luck email sent to ${student.fullName} and parents.` : "Failed to send exam email."
    });
  } catch (err: any) {
    return res.status(500).json({ success: false, error: err.message });
  }
});

export default router;
