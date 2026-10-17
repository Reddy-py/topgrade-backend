import { Router } from "express";
import type { Request, Response } from "express";
import type { AuthenticatedRequest } from "../middleware/auth.js";
import {
  listEmailLogs,
  retryEmail,
  type EmailKind
} from "../services/emailLog.js";

const router = Router();

/**
 * GET /api/email-logs
 * Lists delivery log records with filtering by status, kind, search, and pagination.
 * Non-admin users are strictly restricted to reading only their own email records.
 */
router.get("/", async (req: Request, res: Response): Promise<any> => {
  try {
    const authReq = req as AuthenticatedRequest;
    const userRole = authReq.user?.role || "ANONYMOUS";
    const userEmail = (authReq.user?.email || "").toLowerCase().trim();

    const status = req.query.status ? String(req.query.status) : undefined;
    const kind = req.query.kind ? String(req.query.kind) : undefined;
    const search = req.query.search ? String(req.query.search) : undefined;
    const limit = req.query.limit ? parseInt(String(req.query.limit), 10) : 50;
    const offset = req.query.offset ? parseInt(String(req.query.offset), 10) : 0;

    // If user is not admin, they can ONLY search and see their own email address
    const effectiveSearch = userRole === "ADMIN" ? search : (userEmail || "__no_access__");

    const result = await listEmailLogs({
      status,
      kind,
      search: effectiveSearch,
      limit,
      offset
    });

    // Additional defense-in-depth: if not admin, double-filter any log not containing userEmail
    if (userRole !== "ADMIN") {
      result.logs = result.logs.filter(log =>
        (log.recipients || []).some(r => r.toLowerCase() === userEmail)
      );
      result.total = result.logs.length;
    }

    return res.json({
      success: true,
      logs: result.logs,
      total: result.total,
      limit,
      offset
    });
  } catch (err: any) {
    return res.status(500).json({ success: false, message: err?.message || "Failed to load delivery logs." });
  }
});

/**
 * POST /api/email-logs/:id/retry
 * Retries a failed email immediately (Admin only).
 */
router.post("/:id/retry", async (req: Request, res: Response): Promise<any> => {
  try {
    const authReq = req as AuthenticatedRequest;
    if (authReq.user?.role !== "ADMIN") {
      return res.status(403).json({ success: false, message: "Only administrators can trigger manual email retries." });
    }

    const id = String(req.params.id || "").trim();
    if (!id) {
      return res.status(400).json({ success: false, message: "Email log ID is required." });
    }

    const result = await retryEmail(id);
    return res.json({
      success: result.success,
      status: result.status,
      error: result.error,
      message: result.success ? "Email retry succeeded." : `Email retry failed: ${result.error || "Unknown error"}`
    });
  } catch (err: any) {
    return res.status(500).json({ success: false, message: err?.message || "Failed to retry email send." });
  }
});

export default router;
