import express from "express";
import { AttendanceService, attendanceStore, studentProfilesMap } from "../services/attendanceService.js";
import { SessionAttendanceService, classSessionQrStore, type ClassSessionQRRecord } from "../services/sessionAttendanceService.js";

const router = express.Router();

// 1. TEACHER SESSION ROSTER UNLOCK (GET /api/attendance/session/:sessionId/roster)
router.get("/session/:sessionId/roster", (req, res) => {
  try {
    const { sessionId } = req.params;
    const rosterData = SessionAttendanceService.getSessionRoster(sessionId);
    res.status(200).json({
      success: true,
      data: rosterData
    });
  } catch (err: any) {
    res.status(500).json({
      success: false,
      message: "Failed to fetch session roster.",
      error: err.message
    });
  }
});

// 2. TEACHER BATCH ATTENDANCE SUBMIT & 4-PARTY EMAIL DISPATCH (POST /api/attendance/session/:sessionId/submit)
router.post("/session/:sessionId/submit", async (req, res) => {
  try {
    const { sessionId } = req.params;
    const { teacherId, entries } = req.body;

    if (!Array.isArray(entries) || entries.length === 0) {
      return res.status(400).json({
        success: false,
        message: "Missing 'entries' array in submission payload."
      });
    }

    const result = await SessionAttendanceService.submitTeacherSessionAttendance({
      classSessionId: sessionId,
      teacherId,
      entries
    });

    res.status(200).json({
      success: true,
      message: result.message,
      data: result
    });
  } catch (err: any) {
    res.status(500).json({
      success: false,
      message: "Failed to submit class attendance.",
      error: err.message
    });
  }
});

// 3. QR CODE SCANNER CHECK-IN / CHECK-OUT (POST /api/attendance/scan-qr)
router.post("/scan-qr", async (req, res) => {
  try {
    const { studentQrCode, courseId, scanMethod } = req.body;

    if (!studentQrCode) {
      return res.status(400).json({
        success: false,
        message: "Missing 'studentQrCode' parameter for scanning."
      });
    }

    const result = await AttendanceService.scanQrCodeCheckInCheckOut({
      studentQrCode,
      courseId,
      scanMethod: scanMethod || "QR_CODE_SCANNER"
    });

    res.status(200).json({
      success: true,
      message: result.message,
      data: result
    });
  } catch (err: any) {
    res.status(500).json({
      success: false,
      message: "Failed to process QR code attendance scan.",
      error: err.message
    });
  }
});

// 4. TEACHER BATCH ATTENDANCE MARKING (POST /api/attendance/mark-batch)
router.post("/mark-batch", async (req, res) => {
  try {
    const { courseId, date, entries } = req.body;

    if (!courseId || !Array.isArray(entries) || entries.length === 0) {
      return res.status(400).json({
        success: false,
        message: "Missing mandatory fields (courseId, entries array)."
      });
    }

    const result = await AttendanceService.markBatchAttendance({
      courseId,
      date: date || new Date().toISOString().slice(0, 10),
      entries
    });

    res.status(200).json({
      success: true,
      message: `Batch attendance logged for ${result.count} students successfully.`,
      data: result
    });
  } catch (err: any) {
    res.status(500).json({
      success: false,
      message: "Failed to log batch attendance.",
      error: err.message
    });
  }
});

// 5. STUDENT ATTENDANCE STATS & LOW ATTENDANCE ANALYTICS (GET /api/attendance/student-stats/:studentId)
router.get("/student-stats/:studentId", (req, res) => {
  try {
    const { studentId } = req.params;
    const threshold = req.query.threshold ? Number(req.query.threshold) : 75;

    const stats = AttendanceService.getStudentAttendanceStats(studentId, threshold);

    res.status(200).json({
      success: true,
      data: stats
    });
  } catch (err: any) {
    res.status(500).json({
      success: false,
      message: err.message
    });
  }
});

// 6. GET STUDENT QR CODE PASS (GET /api/attendance/qr-code/:studentId)
router.get("/qr-code/:studentId", (req, res) => {
  const { studentId } = req.params;
  const match = Object.values(studentProfilesMap).find(s => s.studentId === studentId) || {
    studentId,
    studentName: "Rahul Kumar",
    studentCode: "TG-2026-9081",
    courseName: "Full-Stack Coding & Web Dev"
  };

  const qrCodeData = `TG-QR-${match.studentCode}`;

  res.status(200).json({
    success: true,
    studentQrPass: {
      studentId: match.studentId,
      studentName: match.studentName,
      studentCode: match.studentCode,
      courseName: match.courseName,
      qrCodeData,
      qrImageMockUrl: `https://api.qrserver.com/v1/create-qr-code/?size=250x250&data=${encodeURIComponent(qrCodeData)}`
    }
  });
});

// 7. GET ALL ATTENDANCE LOGS (GET /api/attendance/list)
router.get("/list", (req, res) => {
  const { studentId, courseId } = req.query;
  let filtered = attendanceStore;

  if (studentId) {
    filtered = filtered.filter(a => a.studentId === String(studentId));
  }

  if (courseId) {
    filtered = filtered.filter(a => a.courseId === String(courseId));
  }

  res.status(200).json({
    success: true,
    count: filtered.length,
    data: filtered
  });
});

// 8. GET ALL SCHEDULED COURSE ATTENDANCE SESSIONS BY DAY & SLOT (GET /api/attendance/sessions)
router.get("/sessions", (req, res) => {
  try {
    const { courseId, day, slot } = req.query;
    let list = classSessionQrStore.map(s => {
      const timeGate = SessionAttendanceService.checkSessionQrTimeGate(s);
      return {
        ...s,
        isUnlocked: timeGate.isUnlocked,
        statusBadgeText: timeGate.statusBadgeText,
        qrMockUrl: `https://api.qrserver.com/v1/create-qr-code/?size=250x250&data=${encodeURIComponent(s.qrToken)}`
      };
    });

    if (courseId) {
      list = list.filter(s => s.courseId === String(courseId));
    }
    if (day && day !== "ALL") {
      list = list.filter(s => (s as any).dayOfWeek === String(day) || s.courseName.toLowerCase().includes(String(day).toLowerCase()));
    }
    if (slot && slot !== "ALL") {
      list = list.filter(s => (s as any).slotName === String(slot) || (s as any).slotName?.toLowerCase().includes(String(slot).toLowerCase()));
    }

    res.status(200).json({
      success: true,
      count: list.length,
      data: list
    });
  } catch (err: any) {
    res.status(500).json({
      success: false,
      message: "Failed to retrieve attendance sessions.",
      error: err.message
    });
  }
});

// 9. SCHEDULE DYNAMIC ATTENDANCE SESSION FOR ANY COURSE (POST /api/attendance/sessions/create)
router.post("/sessions/create", (req, res) => {
  try {
    const { courseId, courseName, teacherId, teacherName, dayOfWeek, slotName, startTimeIso, endTimeIso, graceMinutes } = req.body;

    if (!courseName) {
      return res.status(400).json({ success: false, message: "Course Name is required." });
    }

    const sessionId = `sess-${(courseId || 'crs').toLowerCase().replace(/[^a-z0-9]/g, '-')}-${Date.now().toString().slice(-4)}`;
    const nowIso = new Date().toISOString();
    const start = startTimeIso || nowIso;
    const end = endTimeIso || new Date(Date.now() + 7200000).toISOString();

    const newSession = SessionAttendanceService.generateSessionQrToken({
      classSessionId: sessionId,
      courseId: courseId || `crs-${Date.now()}`,
      courseName: courseName,
      teacherId: teacherId || "tchr-gen-1",
      teacherName: teacherName || "Assigned Faculty",
      startTimeIso: start,
      endTimeIso: end,
      graceMinutes: parseInt(graceMinutes) || 15
    });

    (newSession as any).dayOfWeek = dayOfWeek || "Today";
    (newSession as any).slotName = slotName || "Standard Class Slot";

    res.status(201).json({
      success: true,
      message: `Live Attendance Session for '${courseName}' scheduled for ${dayOfWeek || 'Today'} (${slotName || 'Active Slot'}) with QR Code!`,
      data: {
        ...newSession,
        qrMockUrl: `https://api.qrserver.com/v1/create-qr-code/?size=250x250&data=${encodeURIComponent(newSession.qrToken)}`
      }
    });
  } catch (err: any) {
    res.status(500).json({
      success: false,
      message: "Failed to schedule course attendance session.",
      error: err.message
    });
  }
});

export default router;
