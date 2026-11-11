import { Router } from "express";
import type { Request, Response } from "express";
import type { AuthenticatedRequest } from "../middleware/auth.js";
import { broadcastAnnouncement, type BroadcastAnnouncementInput } from "../services/eventEmailService.js";

const router = Router();

/**
 * POST /api/emails/announcements
 * Broadcasts an announcement message to the specified audience.
 * Enforces CAN-SPAM address verification, signed unsubscribe link generation,
 * and delivery tracking.
 */
router.post("/", async (req: Request, res: Response): Promise<any> => {
  try {
    const authReq = req as AuthenticatedRequest;
    if (authReq.user?.role !== "ADMIN") {
      return res.status(403).json({ success: false, message: "Only administrators can broadcast announcements." });
    }

    const { title, body, audience, targetFilter, customEmail } = req.body || {};

    if (!title || !title.trim()) {
      return res.status(400).json({ success: false, message: "Announcement title is required." });
    }
    if (!body || !body.trim()) {
      return res.status(400).json({ success: false, message: "Announcement message body is required." });
    }

    const validAudiences = [
      "ALL_PARENTS",
      "ALL_STUDENTS",
      "ALL_TEACHERS",
      "COURSE",
      "PROGRAM",
      "EVERYONE",
      "CUSTOM_EMAIL",
      "SINGLE_EMAIL"
    ];
    if (!validAudiences.includes(audience)) {
      return res.status(400).json({
        success: false,
        message: `Audience must be one of: ${validAudiences.join(", ")}.`
      });
    }

    const effectiveTargetFilter = (customEmail || targetFilter ? String(customEmail || targetFilter).trim() : undefined);

    if ((audience === "CUSTOM_EMAIL" || audience === "SINGLE_EMAIL") && (!effectiveTargetFilter || !effectiveTargetFilter.includes("@"))) {
      return res.status(400).json({
        success: false,
        message: "A valid recipient email address is required for custom single email announcements."
      });
    }

    const result = await broadcastAnnouncement({
      title: title.trim(),
      body: body.trim(),
      audience,
      customEmail: effectiveTargetFilter,
      targetFilter: effectiveTargetFilter,
      senderAdminEmail: authReq.user?.email
    });

    if (result.blockedCanSpam) {
      return res.status(422).json({
        success: false,
        blockedCanSpam: true,
        message: result.reason || "CAN-SPAM check failed. Physical postal address is required before sending announcements."
      });
    }

    return res.json({
      success: true,
      message: `Announcement broadcast complete. Sent to ${result.sentCount} recipient(s). ${result.skippedUnsubscribed} skipped due to unsubscribe preference.`,
      stats: {
        totalRecipients: result.totalRecipients,
        sentCount: result.sentCount,
        skippedUnsubscribed: result.skippedUnsubscribed
      }
    });
  } catch (err: any) {
    return res.status(500).json({ success: false, message: err?.message || "Failed to broadcast announcement." });
  }
});

export default router;
