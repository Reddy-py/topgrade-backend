import express from "express";
import { SessionAttendanceService } from "../services/sessionAttendanceService.js";

const router = express.Router();

// 1. GENERATE DYNAMIC CLASS SESSION QR TOKEN (POST /api/session-qr/generate)
router.post("/generate", (req, res) => {
  try {
    const { classSessionId, courseId, courseName, teacherId, teacherName, startTimeIso, endTimeIso, graceMinutes } = req.body;

    if (!classSessionId || !courseId) {
      return res.status(400).json({
        success: false,
        message: "Missing mandatory fields (classSessionId, courseId)."
      });
    }

    const sessionQr = SessionAttendanceService.generateSessionQrToken({
      classSessionId,
      courseId,
      courseName: courseName || "Academic Class Session",
      teacherId: teacherId || "tchr-demo-1",
      teacherName: teacherName || "Dr. Rajesh Verma",
      startTimeIso,
      endTimeIso,
      graceMinutes: graceMinutes || 15
    });

    res.status(200).json({
      success: true,
      message: "Class session QR token generated successfully.",
      data: sessionQr
    });
  } catch (err: any) {
    res.status(500).json({
      success: false,
      message: "Failed to generate class session QR code.",
      error: err.message
    });
  }
});

// 2. STUDENT SELF CHECK-IN SCAN (POST /api/session-qr/student-scan)
router.post("/student-scan", async (req, res) => {
  try {
    const { studentId, qrToken, customScanTimeIso } = req.body;

    if (!studentId || !qrToken) {
      return res.status(400).json({
        success: false,
        message: "Missing mandatory fields (studentId, qrToken)."
      });
    }

    const result = await SessionAttendanceService.processStudentSelfScan({
      studentId,
      qrToken,
      customScanTimeIso
    });

    res.status(200).json({
      success: true,
      message: result.message,
      data: result
    });
  } catch (err: any) {
    const statusCode = err.code === "EXPIRED_SESSION_WINDOW" ? 403 : err.code === "ALREADY_CHECKED_IN" ? 409 : 400;
    res.status(statusCode).json({
      success: false,
      errorCode: err.code || "SCAN_FAILED",
      message: err.message || "Failed to process self check-in scan."
    });
  }
});

// 3. LIVE TEACHER PROJECTION ROSTER FEED (GET /api/session-qr/live-roster/:sessionId)
router.get("/live-roster/:sessionId", (req, res) => {
  try {
    const { sessionId } = req.params;
    const roster = SessionAttendanceService.getLiveSessionRoster(sessionId);

    res.status(200).json({
      success: true,
      data: roster
    });
  } catch (err: any) {
    res.status(500).json({
      success: false,
      message: err.message
    });
  }
});

export default router;
