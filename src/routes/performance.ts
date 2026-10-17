import express from "express";
import { authenticateJwt, type AuthenticatedRequest } from "../middleware/auth.js";
import { getStudentPerformance, getTeacherPerformance } from "../services/performanceService.js";

const router = express.Router();

/**
 * GET /api/performance/student/:studentId
 * Returns student performance tracking data:
 * - Attendance trend by month
 * - Hours used and left
 * - Courses breakdown
 */
router.get("/student/:studentId", authenticateJwt, async (req: AuthenticatedRequest, res) => {
  try {
    const studentId = String(req.params.studentId || "");
    if (!studentId) {
      return res.status(400).json({ success: false, message: "studentId parameter is required." });
    }

    const data = await getStudentPerformance(studentId);
    res.status(200).json({ success: true, data });
  } catch (err: any) {
    res.status(500).json({ success: false, message: err.message });
  }
});

/**
 * GET /api/performance/teacher/:teacherId
 * Returns teacher performance tracking data:
 * - Classes taught (overall and by month)
 * - Attendance rate of their classes
 * - Hours taught
 */
router.get("/teacher/:teacherId", authenticateJwt, async (req: AuthenticatedRequest, res) => {
  try {
    const teacherId = String(req.params.teacherId || "");
    if (!teacherId) {
      return res.status(400).json({ success: false, message: "teacherId parameter is required." });
    }

    const data = await getTeacherPerformance(teacherId);
    res.status(200).json({ success: true, data });
  } catch (err: any) {
    res.status(500).json({ success: false, message: err.message });
  }
});

/**
 * GET /api/performance/my-student
 * Automatically resolves caller's student ID
 */
router.get("/my-student", authenticateJwt, async (req: AuthenticatedRequest, res) => {
  try {
    const studentId = req.user?.id || req.user?.email || "";
    const data = await getStudentPerformance(studentId);
    res.status(200).json({ success: true, data });
  } catch (err: any) {
    res.status(500).json({ success: false, message: err.message });
  }
});

/**
 * GET /api/performance/my-teacher
 * Automatically resolves caller's teacher ID
 */
router.get("/my-teacher", authenticateJwt, async (req: AuthenticatedRequest, res) => {
  try {
    const teacherId = req.user?.id || req.user?.email || req.user?.metadata?.full_name || "";
    const data = await getTeacherPerformance(teacherId);
    res.status(200).json({ success: true, data });
  } catch (err: any) {
    res.status(500).json({ success: false, message: err.message });
  }
});

export default router;
