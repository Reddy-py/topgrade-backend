import express from "express";
import { authenticateJwt, type AuthenticatedRequest } from "../middleware/auth.js";
import {
  listCampaigns,
  createAndScheduleCampaign,
  sendScheduledCampaignNow,
  cancelScheduledCampaign,
  resolveAudienceRecipients
} from "../services/campaignService.js";
import { verifyCanSpamAddress } from "../services/emailUnsubscribeService.js";

const router = express.Router();

/**
 * GET /api/campaigns
 * Lists all campaigns with their sent, failed, and skipped summaries.
 */
router.get("/", authenticateJwt, async (req: AuthenticatedRequest, res) => {
  try {
    const role = (req.user?.role || "").toUpperCase();
    if (role !== "ADMIN" && role !== "ACCOUNTANT") {
      return res.status(403).json({ success: false, message: "Admin authorization required." });
    }

    const campaigns = await listCampaigns();
    res.status(200).json({
      success: true,
      data: campaigns
    });
  } catch (err: any) {
    res.status(500).json({ success: false, message: err.message });
  }
});

/**
 * GET /api/campaigns/audience-preview
 * Previews the count of recipients for an audience selection.
 */
router.get("/audience-preview", authenticateJwt, async (req: AuthenticatedRequest, res) => {
  try {
    const targetAudience = (req.query.audience as string) || "ALL_FAMILIES";
    const targetCourse = (req.query.course as string) || "ALL";
    const targetGrade = (req.query.grade as string) || "ALL";

    const targets = await resolveAudienceRecipients(targetAudience, {
      targetCourse,
      targetGrade
    });

    res.status(200).json({
      success: true,
      data: {
        totalEligible: targets.length,
        audience: targetAudience
      }
    });
  } catch (err: any) {
    res.status(500).json({ success: false, message: err.message });
  }
});

/**
 * POST /api/campaigns
 * Composes and immediately sends or schedules a one-time email campaign.
 * Enforces CAN-SPAM postal address rules and skips unsubscribed addresses.
 */
router.post("/", authenticateJwt, async (req: AuthenticatedRequest, res) => {
  try {
    const role = (req.user?.role || "").toUpperCase();
    if (role !== "ADMIN") {
      return res.status(403).json({ success: false, message: "Admin authorization required to create email campaigns." });
    }

    const {
      title,
      subject,
      body,
      target_audience,
      target_course,
      target_grade,
      target_source,
      scheduled_at
    } = req.body;

    if (!title || !subject || !body) {
      return res.status(400).json({
        success: false,
        message: "Title, Subject, and Body are mandatory for all marketing campaigns."
      });
    }

    // Verify CAN-SPAM address requirement
    const canSpam = verifyCanSpamAddress();
    if (!canSpam.allowed) {
      return res.status(400).json({
        success: false,
        canSpamBlocked: true,
        message: canSpam.reason
      });
    }

    const campaign = await createAndScheduleCampaign({
      title,
      subject,
      body,
      targetAudience: target_audience || "ALL_FAMILIES",
      targetCourse: target_course || "ALL",
      targetGrade: target_grade || "ALL",
      targetSource: target_source || "ALL",
      scheduledAt: scheduled_at || null,
      autoSend: !scheduled_at,
      createdBy: req.user?.email || "admin"
    });

    res.status(201).json({
      success: true,
      message: campaign.status === "Scheduled"
        ? `Campaign successfully scheduled for ${campaign.scheduled_at}!`
        : `Campaign successfully dispatched! Sent: ${campaign.sent_count}, Failed: ${campaign.failed_count}, Skipped (Unsubscribed): ${campaign.skipped_unsubscribed_count}`,
      data: campaign
    });
  } catch (err: any) {
    res.status(500).json({ success: false, message: err.message });
  }
});

/**
 * POST /api/campaigns/:id/send-now
 * Immediately triggers a scheduled campaign.
 */
router.post("/:id/send-now", authenticateJwt, async (req: AuthenticatedRequest, res) => {
  try {
    const role = (req.user?.role || "").toUpperCase();
    if (role !== "ADMIN") {
      return res.status(403).json({ success: false, message: "Admin authorization required." });
    }

    const campaign = await sendScheduledCampaignNow(String(req.params.id));
    res.status(200).json({
      success: true,
      message: `Campaign dispatched immediately! Sent: ${campaign.sent_count}, Failed: ${campaign.failed_count}, Skipped (Unsubscribed): ${campaign.skipped_unsubscribed_count}`,
      data: campaign
    });
  } catch (err: any) {
    res.status(500).json({ success: false, message: err.message });
  }
});

/**
 * POST /api/campaigns/:id/cancel
 * Cancels a scheduled campaign.
 */
router.post("/:id/cancel", authenticateJwt, async (req: AuthenticatedRequest, res) => {
  try {
    const role = (req.user?.role || "").toUpperCase();
    if (role !== "ADMIN") {
      return res.status(403).json({ success: false, message: "Admin authorization required." });
    }

    const campaign = await cancelScheduledCampaign(String(req.params.id));
    res.status(200).json({
      success: true,
      message: "Scheduled campaign has been cancelled.",
      data: campaign
    });
  } catch (err: any) {
    res.status(500).json({ success: false, message: err.message });
  }
});

// Legacy backwards-compatibility alias for past broadcast routes
router.post("/broadcast", authenticateJwt, async (req: AuthenticatedRequest, res) => {
  const { title, subject, message, target_source, target_grade } = req.body;
  try {
    const campaign = await createAndScheduleCampaign({
      title: title || "Promotional Broadcast",
      subject: subject || "Update from Top Grade Learning",
      body: message || "",
      targetAudience: "ALL_FAMILIES",
      targetSource: target_source || "ALL",
      targetGrade: target_grade || "ALL",
      createdBy: req.user?.email || "admin"
    });
    res.status(200).json({ success: true, data: campaign });
  } catch (err: any) {
    res.status(500).json({ success: false, message: err.message });
  }
});

router.get("/history", authenticateJwt, async (_req: AuthenticatedRequest, res) => {
  try {
    const data = await listCampaigns();
    res.status(200).json({ success: true, data });
  } catch (err: any) {
    res.status(500).json({ success: false, message: err.message });
  }
});

export default router;
