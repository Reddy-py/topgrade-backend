import express from "express";
import type { Request, Response } from "express";
import { HistoryService } from "../services/historyService.js";
import { ScheduleDataService } from "../services/scheduleDataService.js";
import { getAccessScope, allowsStudent } from "../services/accessScope.js";
import type { AuthenticatedRequest } from "../middleware/auth.js";

const router = express.Router();

/**
 * 0. GET CHRONOLOGICAL STUDENT AUDIT LEDGER (GET /api/history/student/:studentId)
 * Scoped: Admin can view any student; Parent can view ONLY their own child.
 */
router.get("/student/:studentId", async (req: Request, res: Response): Promise<any> => {
  try {
    const authUser = (req as AuthenticatedRequest).user;
    if (!authUser) {
      return res.status(401).json({ success: false, message: "Unauthorized. Please log in." });
    }

    const studentId = String(req.params.studentId || "");
    const scope = await getAccessScope(authUser as any);

    if (!allowsStudent(scope, studentId)) {
      return res.status(403).json({
        success: false,
        message: "Forbidden: You are not authorized to view this student's history."
      });
    }

    const [history, pastTutoring, pastAfterschool, attendanceHistory] = await Promise.all([
      ScheduleDataService.getStudentHistory(studentId),
      HistoryService.getTutoringPast(studentId),
      HistoryService.getAfterschoolPast(studentId),
      HistoryService.getAttendanceHistory(studentId)
    ]);

    return res.status(200).json({
      success: true,
      studentId,
      count: history.length,
      data: history,
      pastTutoring,
      pastAfterschool,
      attendanceHistory
    });
  } catch (err: any) {
    return res.status(500).json({ success: false, message: err.message });
  }
});

/**
 * Helper to ensure Admin-only access for institutional history management
 */
function requireAdmin(req: Request, res: Response, next: express.NextFunction) {
  const authUser = (req as AuthenticatedRequest).user;
  if (!authUser) {
    return res.status(401).json({ success: false, message: "Unauthorized. Please log in." });
  }
  if (authUser.role !== "ADMIN") {
    return res.status(403).json({
      success: false,
      message: "Forbidden: Only administrators can access the institutional history and retention hub."
    });
  }
  next();
}

// 1. GET HISTORY OVERVIEW (GET /api/history/overview) - ADMIN ONLY
router.get("/overview", requireAdmin, async (_req, res) => {
  try {
    const overview = await HistoryService.getHistoryOverview();
    res.status(200).json({ success: true, data: overview });
  } catch (err: any) {
    res.status(500).json({ success: false, message: err.message });
  }
});

// 2. GET TUTORING PAST (GET /api/history/tutoring) - ADMIN ONLY
router.get("/tutoring", requireAdmin, async (req, res) => {
  try {
    const studentId = req.query.studentId ? String(req.query.studentId) : undefined;
    const data = await HistoryService.getTutoringPast(studentId);
    res.status(200).json({ success: true, count: data.length, data });
  } catch (err: any) {
    res.status(500).json({ success: false, message: err.message });
  }
});

// 3. GET AFTERSCHOOL PAST (GET /api/history/afterschool) - ADMIN ONLY
router.get("/afterschool", requireAdmin, async (req, res) => {
  try {
    const studentId = req.query.studentId ? String(req.query.studentId) : undefined;
    const data = await HistoryService.getAfterschoolPast(studentId);
    res.status(200).json({ success: true, count: data.length, data });
  } catch (err: any) {
    res.status(500).json({ success: false, message: err.message });
  }
});

// 4. GET LONGITUDINAL STUDENT TIMELINE (GET /api/history/students) - ADMIN ONLY
router.get("/students", requireAdmin, async (req, res) => {
  try {
    const studentId = req.query.studentId ? String(req.query.studentId) : undefined;
    const timeline = await HistoryService.getStudentHistoryTimeline(studentId);
    res.status(200).json({ success: true, count: timeline.length, data: timeline });
  } catch (err: any) {
    res.status(500).json({ success: false, message: err.message });
  }
});

// 5. GET ATTENDANCE AUDIT HISTORY (GET /api/history/attendance) - ADMIN ONLY
router.get("/attendance", requireAdmin, async (req, res) => {
  try {
    const studentId = req.query.studentId ? String(req.query.studentId) : undefined;
    const data = await HistoryService.getAttendanceHistory(studentId);
    res.status(200).json({ success: true, count: data.length, data });
  } catch (err: any) {
    res.status(500).json({ success: false, message: err.message });
  }
});

// 6. GET PAYMENT AUDIT HISTORY (GET /api/history/payments)
// Payment history stays hidden until payments return!
router.get("/payments", (_req, res) => {
  res.status(200).json({
    success: true,
    enabled: false,
    available: false,
    message: "Payments not enabled yet. Payment history is temporarily disabled.",
    count: 0,
    data: []
  });
});

// 7. GET RETENTION LIST (GET /api/history/retention) - ADMIN ONLY
router.get("/retention", requireAdmin, async (_req, res) => {
  try {
    const retention = await HistoryService.getRetentionList();
    res.status(200).json({
      success: true,
      total: retention.total,
      grouped: retention.grouped,
      data: retention.all
    });
  } catch (err: any) {
    res.status(500).json({ success: false, message: err.message });
  }
});

// 8. EXPORT RETENTION LIST TO CSV OR EXCEL (GET /api/history/retention/export) - ADMIN ONLY
router.get("/retention/export", requireAdmin, async (req: Request, res: Response): Promise<any> => {
  try {
    const format = String(req.query.format || "csv").toLowerCase() === "xlsx" ? "xlsx" : "csv";
    const authUser = (req as AuthenticatedRequest).user;
    const actor = authUser?.email || "Administration";

    const exported = await HistoryService.exportRetentionList(format, actor);

    res.setHeader("Content-Type", exported.contentType);
    res.setHeader("Content-Disposition", `attachment; filename="${exported.filename}"`);
    return res.send(exported.buffer);
  } catch (err: any) {
    return res.status(500).json({ success: false, message: err.message || "Export failed." });
  }
});

// 9. TRIGGER RE-ENROLLMENT INVITATION (POST /api/history/re-enrollment-invite & /trigger-reenrollment) - ADMIN ONLY
router.post(["/re-enrollment-invite", "/trigger-reenrollment"], requireAdmin, async (req: Request, res: Response): Promise<any> => {
  try {
    const { studentId, offerDiscountCode, promoDiscountCode, customNote } = req.body;
    const authUser = (req as AuthenticatedRequest).user;

    if (!studentId) {
      return res.status(400).json({ success: false, message: "studentId is required." });
    }

    const result = await HistoryService.triggerReenrollmentInvite({
      studentId,
      offerDiscountCode: offerDiscountCode || promoDiscountCode,
      customNote,
      actor: authUser?.email || "Administrator"
    });

    return res.status(200).json(result);
  } catch (err: any) {
    const isRateLimit = err?.message?.includes("Rate limit") || err?.message?.includes("already sent");
    return res.status(isRateLimit ? 429 : 400).json({
      success: false,
      message: err.message || "Failed to dispatch re-enrollment invitation."
    });
  }
});

// 10. SET STUDENT INACTIVE / PAST (POST /api/history/set-inactive) - ADMIN ONLY
router.post("/set-inactive", requireAdmin, async (req: Request, res: Response): Promise<any> => {
  try {
    const { studentId } = req.body;
    const authUser = (req as AuthenticatedRequest).user;

    if (!studentId) {
      return res.status(400).json({ success: false, message: "studentId is required." });
    }

    const result = await HistoryService.setStudentInactive(studentId, authUser?.email || "Administrator");
    return res.status(200).json(result);
  } catch (err: any) {
    return res.status(400).json({ success: false, message: err.message });
  }
});

// 11. RESTORE STUDENT TO CURRENT / ACTIVE (POST /api/history/restore-student) - ADMIN ONLY
router.post("/restore-student", requireAdmin, async (req: Request, res: Response): Promise<any> => {
  try {
    const { studentId } = req.body;
    const authUser = (req as AuthenticatedRequest).user;

    if (!studentId) {
      return res.status(400).json({ success: false, message: "studentId is required." });
    }

    const result = await HistoryService.restoreStudentToCurrent(studentId, authUser?.email || "Administrator");
    return res.status(200).json(result);
  } catch (err: any) {
    return res.status(400).json({ success: false, message: err.message });
  }
});

export default router;
