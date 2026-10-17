import express from "express";
import { authenticateJwt, type AuthenticatedRequest } from "../middleware/auth.js";
import { computeUpsellSuggestions, sendUpsellSuggestionEmail } from "../services/upsellService.js";

const router = express.Router();

/**
 * GET /api/upsell
 * Returns real data-driven upsell suggestions across all students.
 */
router.get("/", authenticateJwt, async (req: AuthenticatedRequest, res) => {
  try {
    const role = (req.user?.role || "").toUpperCase();
    if (role !== "ADMIN" && role !== "ACCOUNTANT") {
      return res.status(403).json({ success: false, message: "Admin authorization required." });
    }

    const typeFilter = req.query.type as string;
    let suggestions = await computeUpsellSuggestions();

    if (typeFilter && typeFilter !== "ALL") {
      suggestions = suggestions.filter(s => s.type === typeFilter);
    }

    res.status(200).json({
      success: true,
      count: suggestions.length,
      data: suggestions
    });
  } catch (err: any) {
    res.status(500).json({ success: false, message: err.message });
  }
});

/**
 * GET /api/upsell/student/:studentId
 * Returns real data-driven upsell suggestions for a specific student's profile.
 */
router.get("/student/:studentId", authenticateJwt, async (req: AuthenticatedRequest, res) => {
  try {
    const studentId = typeof req.params.studentId === "string" ? req.params.studentId : undefined;
    const suggestions = await computeUpsellSuggestions(studentId);

    res.status(200).json({
      success: true,
      data: suggestions
    });
  } catch (err: any) {
    res.status(500).json({ success: false, message: err.message });
  }
});

/**
 * POST /api/upsell/send
 * 1-Click send suggestion email. Respects CAN-SPAM postal address and unsubscribe.
 */
router.post("/send", authenticateJwt, async (req: AuthenticatedRequest, res) => {
  try {
    const role = (req.user?.role || "").toUpperCase();
    if (role !== "ADMIN") {
      return res.status(403).json({ success: false, message: "Admin authorization required to dispatch upsell emails." });
    }

    const { studentId, suggestionType, customNote, suggestion } = req.body;
    const targetStudentId = studentId || suggestion?.studentId;
    const targetType = suggestionType || suggestion?.type;

    if (!targetStudentId && !suggestion) {
      return res.status(400).json({ success: false, message: "studentId or suggestion is required." });
    }

    const result = await sendUpsellSuggestionEmail({
      studentId: targetStudentId,
      suggestionType: targetType,
      suggestion,
      customNote
    });

    res.status(result.success ? 200 : 400).json(result);
  } catch (err: any) {
    const isUnsub = err.message && err.message.toLowerCase().includes("unsubscribed");
    res.status(isUnsub ? 400 : 500).json({
      success: false,
      message: err.message,
      unsubscribed: isUnsub
    });
  }
});

export default router;
