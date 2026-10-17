import { Router } from "express";
import type { Request, Response } from "express";
import type { AuthenticatedRequest } from "../middleware/auth.js";
import {
  listTemplates,
  getTemplate,
  updateTemplate,
  sendTemplateTest,
  renderTemplate
} from "../services/emailTemplateService.js";

const router = Router();

/**
 * GET /api/email-templates
 * Returns list of all email templates seeded or customized.
 */
router.get("/", async (_req: Request, res: Response): Promise<any> => {
  try {
    const templates = await listTemplates();
    return res.json({ success: true, templates });
  } catch (err: any) {
    return res.status(500).json({ success: false, message: err?.message || "Failed to list templates." });
  }
});

/**
 * GET /api/email-templates/:key
 * Returns a single template by key with sample preview.
 */
router.get("/:key", async (req: Request, res: Response): Promise<any> => {
  try {
    const key = String(req.params.key || "").trim().toUpperCase();
    const template = await getTemplate(key);
    if (!template) {
      return res.status(404).json({ success: false, message: `Template '${key}' not found.` });
    }
    return res.json({ success: true, template });
  } catch (err: any) {
    return res.status(500).json({ success: false, message: err?.message || "Failed to fetch template." });
  }
});

/**
 * PUT /api/email-templates/:key
 * Updates template subject, body, or enabled toggle.
 */
router.put("/:key", async (req: Request, res: Response): Promise<any> => {
  try {
    const authReq = req as AuthenticatedRequest;
    const key = String(req.params.key || "").trim().toUpperCase();
    const { subject, body, enabled } = req.body || {};

    const updated = await updateTemplate(key, {
      subject,
      body,
      enabled: typeof enabled === "boolean" ? enabled : undefined,
      updatedBy: authReq.user?.email || "admin"
    });

    return res.json({ success: true, template: updated, message: `Template '${key}' successfully updated.` });
  } catch (err: any) {
    return res.status(400).json({ success: false, message: err?.message || "Failed to update template." });
  }
});

/**
 * POST /api/email-templates/:key/test
 * Sends a live preview of the template with sample data to the requesting admin.
 */
router.post("/:key/test", async (req: Request, res: Response): Promise<any> => {
  try {
    const authReq = req as AuthenticatedRequest;
    const key = String(req.params.key || "").trim().toUpperCase();
    const recipient = String(req.body.recipientEmail || authReq.user?.email || "").trim();

    if (!recipient || !recipient.includes("@")) {
      return res.status(400).json({ success: false, message: "A valid recipient email address is required for sending preview." });
    }

    const sampleVars = req.body.variables || {
      recipient_name: "Valued Family / Faculty",
      student_name: "Alex Johnson",
      student_code: "TG-2026-99",
      parent_name: "Sarah Johnson",
      teacher_name: "Prof. Alan Turing",
      course_name: "Advanced Physics & Mathematics",
      day_of_week: "Tuesday",
      time_slot: "4:00 PM - 5:30 PM",
      room: "Room 102",
      location_name: "Main Edison Campus",
      remaining_hours: 1.5,
      owed_hours: -2.0,
      days_left: 7,
      expiry_date: "2026-11-01",
      total_attended: 8,
      total_sessions: 8,
      attendance_pct: "100%",
      hours_used: 12.0,
      hours_left: 8.0,
      teacher_note: "Alex has made exceptional progress in quadratic functions this month."
    };

    const result = await sendTemplateTest(key, recipient, sampleVars);
    return res.json({ success: result.success, message: result.message, subject: result.subject });
  } catch (err: any) {
    return res.status(500).json({ success: false, message: err?.message || "Failed to send test preview." });
  }
});

export default router;
