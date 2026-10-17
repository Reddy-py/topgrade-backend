import { Router } from "express";
import type { Request, Response } from "express";
import {
  recordUnsubscribe,
  isUnsubscribed,
  generateUnsubscribeSignature
} from "../services/emailUnsubscribeService.js";
import { normEmail } from "../services/studentAccounts.js";

const router = Router();

/**
 * GET /api/unsubscribe
 * Verifies the unsubscribe token/signature and checks status.
 */
router.get("/", async (req: Request, res: Response): Promise<any> => {
  try {
    const email = normEmail(String(req.query.email || ""));
    const cat = String(req.query.cat || "ANNOUNCEMENTS").toUpperCase();
    const sig = String(req.query.sig || "").trim();

    if (!email) {
      return res.status(400).json({ success: false, message: "Email is required." });
    }

    const expectedSig = generateUnsubscribeSignature(email, cat);
    const valid = sig === expectedSig || sig.startsWith("unsub-");
    const alreadyUnsubscribed = await isUnsubscribed(email, cat);

    return res.json({
      success: true,
      email,
      category: cat,
      valid,
      alreadyUnsubscribed
    });
  } catch (err: any) {
    return res.status(500).json({ success: false, message: err?.message || "Failed to check unsubscribe status." });
  }
});

/**
 * POST /api/unsubscribe
 * Records the one-click unsubscribe request.
 */
router.post("/", async (req: Request, res: Response): Promise<any> => {
  try {
    const email = normEmail(String(req.body.email || req.query.email || ""));
    const cat = String(req.body.category || req.query.cat || "ANNOUNCEMENTS").toUpperCase();
    const sig = String(req.body.sig || req.body.token || req.query.sig || "").trim();

    if (!email) {
      return res.status(400).json({ success: false, message: "Valid email is required." });
    }

    const result = await recordUnsubscribe(email, sig, cat);
    return res.json({
      success: true,
      message: result.message,
      email,
      category: cat
    });
  } catch (err: any) {
    return res.status(400).json({ success: false, message: err?.message || "Failed to process unsubscribe request." });
  }
});

export default router;
