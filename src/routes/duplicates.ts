import express from "express";
import { authenticateJwt, type AuthenticatedRequest } from "../middleware/auth.js";
import { authorizePermission } from "../middleware/authorize.js";
import { scanDuplicatesService, mergeRecordsService } from "../services/duplicatesService.js";

const router = express.Router();

/**
 * GET /api/duplicates/scan
 * Scans students and parents for duplicate records. Admin only.
 */
router.get("/scan", authenticateJwt, authorizePermission("students.edit"), async (_req: AuthenticatedRequest, res: express.Response) => {
  try {
    const clusters = await scanDuplicatesService();
    res.status(200).json({
      success: true,
      count: clusters.length,
      data: clusters
    });
  } catch (error: any) {
    res.status(500).json({ success: false, message: error.message || "Failed to scan duplicates." });
  }
});

/**
 * POST /api/duplicates/merge
 * Merges a duplicate record into a primary surviving record with dry-run support.
 */
router.post("/merge", authenticateJwt, authorizePermission("students.edit"), async (req: AuthenticatedRequest, res: express.Response) => {
  try {
    const { primaryId, duplicateId, type, dryRun } = req.body || {};
    if (!primaryId || !duplicateId) {
      return res.status(400).json({ success: false, message: "primaryId and duplicateId are required." });
    }

    const adminEmail = (req.user as any)?.email || "admin";
    const result = await mergeRecordsService({
      primaryId,
      duplicateId,
      type: type || "STUDENT",
      dryRun: dryRun === true || dryRun === "true",
      adminEmail
    });

    res.status(200).json({
      success: true,
      data: result
    });
  } catch (error: any) {
    res.status(400).json({ success: false, message: error.message || "Failed to merge records." });
  }
});

export default router;
