import express from "express";
import { authenticateJwt, type AuthenticatedRequest } from "../middleware/auth.js";
import { getCachedInstituteSettings, updateInstituteSettings } from "../services/instituteSettingsService.js";
import { getTemplate, updateTemplate } from "../services/emailTemplateService.js";
import { runEngagementScan } from "../services/parentEngagementService.js";

const router = express.Router();

/**
 * GET /api/engagement/settings
 * Returns the current toggles for welcome series, monthly updates, and we-miss-you notices.
 */
router.get("/settings", authenticateJwt, async (_req: AuthenticatedRequest, res) => {
  try {
    const settings = getCachedInstituteSettings();

    const [w1, w2, w3, monthly, missYou] = await Promise.all([
      getTemplate("WELCOME_SERIES_WEEK_1"),
      getTemplate("WELCOME_SERIES_WEEK_2"),
      getTemplate("WELCOME_SERIES_WEEK_3"),
      getTemplate("MONTHLY_PROGRESS_REPORT"),
      getTemplate("WE_MISS_YOU_14_DAYS")
    ]);

    res.status(200).json({
      success: true,
      data: {
        welcome_series_enabled: settings.engagement_welcome_series_enabled ?? true,
        monthly_update_enabled: settings.engagement_monthly_update_enabled ?? true,
        we_miss_you_enabled: settings.engagement_we_miss_you_enabled ?? true,
        templates: {
          welcome_week_1: { key: "WELCOME_SERIES_WEEK_1", enabled: w1?.enabled ?? true, name: w1?.name },
          welcome_week_2: { key: "WELCOME_SERIES_WEEK_2", enabled: w2?.enabled ?? true, name: w2?.name },
          welcome_week_3: { key: "WELCOME_SERIES_WEEK_3", enabled: w3?.enabled ?? true, name: w3?.name },
          monthly_update: { key: "MONTHLY_PROGRESS_REPORT", enabled: monthly?.enabled ?? true, name: monthly?.name },
          we_miss_you: { key: "WE_MISS_YOU_14_DAYS", enabled: missYou?.enabled ?? true, name: missYou?.name }
        }
      }
    });
  } catch (err: any) {
    res.status(500).json({ success: false, message: err.message });
  }
});

/**
 * PUT /api/engagement/settings
 * Admin switches each engagement email on or off.
 */
router.put("/settings", authenticateJwt, async (req: AuthenticatedRequest, res) => {
  try {
    const role = (req.user?.role || "").toUpperCase();
    if (role !== "ADMIN") {
      return res.status(403).json({ success: false, message: "Admin authorization required." });
    }

    const {
      welcome_series_enabled,
      monthly_update_enabled,
      we_miss_you_enabled,
      template_toggles
    } = req.body;

    const updates: any = {};
    if (typeof welcome_series_enabled === "boolean") {
      updates.engagement_welcome_series_enabled = welcome_series_enabled;
    }
    if (typeof monthly_update_enabled === "boolean") {
      updates.engagement_monthly_update_enabled = monthly_update_enabled;
    }
    if (typeof we_miss_you_enabled === "boolean") {
      updates.engagement_we_miss_you_enabled = we_miss_you_enabled;
    }

    const savedSettings = await updateInstituteSettings(updates);

    // If template toggles were supplied, update templates table
    if (template_toggles && typeof template_toggles === "object") {
      for (const [key, enabled] of Object.entries(template_toggles)) {
        if (typeof enabled === "boolean") {
          await updateTemplate(key, { enabled, updatedBy: req.user?.email || "admin" });
        }
      }
    }

    res.status(200).json({
      success: true,
      message: "Parent engagement settings updated successfully.",
      data: {
        welcome_series_enabled: savedSettings.engagement_welcome_series_enabled ?? true,
        monthly_update_enabled: savedSettings.engagement_monthly_update_enabled ?? true,
        we_miss_you_enabled: savedSettings.engagement_we_miss_you_enabled ?? true
      }
    });
  } catch (err: any) {
    res.status(500).json({ success: false, message: err.message });
  }
});

/**
 * POST /api/engagement/run-scan
 * Admin manually triggers engagement scans (welcome series, we miss you).
 */
router.post("/run-scan", authenticateJwt, async (req: AuthenticatedRequest, res) => {
  try {
    const role = (req.user?.role || "").toUpperCase();
    if (role !== "ADMIN") {
      return res.status(403).json({ success: false, message: "Admin authorization required." });
    }

    const result = await runEngagementScan();
    res.status(200).json({
      success: true,
      message: `Engagement scan completed. Dispatched: ${result.welcomeWeek1 + result.welcomeWeek2 + result.welcomeWeek3 + result.weMissYou} emails, Skipped unsubscribed: ${result.skippedUnsubscribed}`,
      data: result
    });
  } catch (err: any) {
    res.status(500).json({ success: false, message: err.message });
  }
});

export default router;
