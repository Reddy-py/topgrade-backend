import express from "express";
import { authenticateJwt, type AuthenticatedRequest } from "../middleware/auth.js";
import {
  getOrCreateParentReferralCode,
  validateReferralCode,
  listAllReferrals,
  listReferralsForParent,
  updateReferralRewardNotes
} from "../services/referralService.js";
import { normEmail } from "../services/studentAccounts.js";

const router = express.Router();

/**
 * GET /api/referrals/my-code
 * Visible ONLY to the owning parent and admin.
 * Returns the authenticated parent's random, unique, unguessable referral code.
 */
router.get("/my-code", authenticateJwt, async (req: AuthenticatedRequest, res) => {
  try {
    const parentEmail = req.user?.email || "";
    const parentName = req.user?.metadata?.full_name || req.user?.email?.split("@")[0] || "Parent";

    if (!parentEmail) {
      return res.status(401).json({ success: false, message: "Authentication required to view referral code." });
    }

    const codeRecord = await getOrCreateParentReferralCode(parentEmail, parentName);

    res.status(200).json({
      success: true,
      data: {
        code: codeRecord.code,
        parentEmail: codeRecord.parent_email,
        parentName: codeRecord.parent_name,
        createdAt: codeRecord.created_at
      }
    });
  } catch (err: any) {
    res.status(500).json({ success: false, message: err.message });
  }
});

/**
 * GET /api/referrals/my-referrals
 * Returns list of referrals made by the authenticated parent.
 */
router.get("/my-referrals", authenticateJwt, async (req: AuthenticatedRequest, res) => {
  try {
    const parentEmail = req.user?.email || "";
    if (!parentEmail) {
      return res.status(401).json({ success: false, message: "Authentication required." });
    }

    const referrals = await listReferralsForParent(parentEmail);
    res.status(200).json({ success: true, data: referrals });
  } catch (err: any) {
    res.status(500).json({ success: false, message: err.message });
  }
});

/**
 * GET /api/referrals/validate/:code
 * Checks whether a referral code entered on registration is valid.
 */
router.get("/validate/:code", async (req, res) => {
  try {
    const code = req.params.code;
    const result = await validateReferralCode(code);
    if (!result.valid) {
      return res.status(200).json({ success: true, valid: false, message: "Referral code not found." });
    }

    res.status(200).json({
      success: true,
      valid: true,
      referrerName: result.referrer?.name || "TopGrade Family"
    });
  } catch (err: any) {
    res.status(500).json({ success: false, message: err.message });
  }
});

/**
 * GET /api/referrals
 * Admin Referrals Page: Lists all referrers, referred students, statuses, and rewards.
 */
router.get("/", authenticateJwt, async (req: AuthenticatedRequest, res) => {
  try {
    const role = (req.user?.role || "").toUpperCase();
    if (role !== "ADMIN" && role !== "ACCOUNTANT") {
      return res.status(403).json({ success: false, message: "Admin access required to view all referrals." });
    }

    const status = (req.query.status as string) || "ALL";
    const search = (req.query.search as string) || "";

    const referrals = await listAllReferrals({ status, search });
    res.status(200).json({ success: true, data: referrals });
  } catch (err: any) {
    res.status(500).json({ success: false, message: err.message });
  }
});

/**
 * PUT /api/referrals/:id/reward
 * Admin updates manual reward notes (no money logic).
 */
router.put("/:id/reward", authenticateJwt, async (req: AuthenticatedRequest, res) => {
  try {
    const role = (req.user?.role || "").toUpperCase();
    if (role !== "ADMIN") {
      return res.status(403).json({ success: false, message: "Admin access required to update referral rewards." });
    }

    const { reward_notes } = req.body;
    const updated = await updateReferralRewardNotes(String(req.params.id), reward_notes || "");

    res.status(200).json({
      success: true,
      message: "Referral reward note recorded successfully.",
      data: updated
    });
  } catch (err: any) {
    res.status(500).json({ success: false, message: err.message });
  }
});

export default router;
