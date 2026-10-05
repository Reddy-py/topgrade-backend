import express, { type Request, type Response } from "express";
import { StripeService, isStripeMockMode, type CreateCheckoutSessionInput, type ManualZelleInput } from "../services/stripeService.js";

const router = express.Router();

/**
 * 1. POST /api/payments/stripe/create-checkout-session
 * Creates a Stripe Checkout Session for custom Hour-as-a-Token purchases.
 * Input: { student_id, course_id, tokens_purchased, unit_price_usd, student_name, student_email, parent_email, course_name }
 * Amount: tokens_purchased * unit_price_usd * 100 (in cents)
 * Graceful Mock Fallback: Returns simulated checkout session if in placeholder mode.
 */
export async function createCheckoutSessionHandler(req: Request, res: Response): Promise<any> {
  try {
    const {
      student_id,
      course_id,
      tokens_purchased,
      unit_price_usd,
      student_name,
      student_email,
      parent_email,
      course_name
    } = req.body;

    if (!student_id || !course_id) {
      return res.status(400).json({
        success: false,
        message: "Missing required fields: student_id and course_id are mandatory."
      });
    }

    const tokens = Math.max(1, Math.floor(Number(tokens_purchased) || 1));
    const unitPrice = Number(unit_price_usd) || 40.0;

    const sessionResult = await StripeService.createCheckoutSession({
      student_id: String(student_id),
      course_id: String(course_id),
      tokens_purchased: tokens,
      unit_price_usd: unitPrice,
      student_name,
      student_email,
      parent_email,
      course_name
    });

    return res.status(200).json({
      success: true,
      sessionId: sessionResult.sessionId,
      url: sessionResult.url,
      isMock: !!sessionResult.isMock,
      total_amount_cents: Math.round(tokens * unitPrice * 100),
      currency: process.env.STRIPE_CURRENCY || "usd"
    });
  } catch (error: any) {
    console.error("[Stripe Session Error]:", error);
    return res.status(500).json({
      success: false,
      message: error.message || "Failed to create Stripe checkout session."
    });
  }
}

/**
 * 2. POST /api/payments/stripe/webhook
 * Handles incoming Stripe Webhook events with raw body verification.
 * Automatically credits tokens and sends Node 8 parent receipt on checkout.session.completed.
 */
export async function stripeWebhookHandler(req: Request, res: Response): Promise<any> {
  const sig = req.headers["stripe-signature"];
  const rawBody = (req as any).rawBody || Buffer.from(JSON.stringify(req.body || {}));

  let event: any;
  try {
    event = StripeService.constructWebhookEvent(rawBody, sig);
  } catch (err: any) {
    console.error(`[Stripe Webhook Signature Error]: ${err.message}`);
    return res.status(400).send(`Webhook Error: ${err.message}`);
  }

  try {
    switch (event.type) {
      case "checkout.session.completed": {
        const session = event.data.object;
        console.log(`[Stripe Webhook] Received checkout.session.completed for session: ${session.id}`);

        const fulfillment = await StripeService.fulfillCheckoutSession(session);
        console.log(`[Stripe Webhook] Successfully fulfilled tokens for student ${fulfillment.student_id}: +${fulfillment.tokens_purchased} tokens.`);
        break;
      }

      case "payment_intent.succeeded": {
        const paymentIntent = event.data.object;
        console.log(`[Stripe Webhook] PaymentIntent ${paymentIntent.id} succeeded ($${(paymentIntent.amount / 100).toFixed(2)})`);
        break;
      }

      default:
        console.log(`[Stripe Webhook] Unhandled event type: ${event.type}`);
    }

    return res.status(200).json({ received: true, event_type: event.type });
  } catch (err: any) {
    console.error(`[Stripe Webhook Handling Error]:`, err);
    return res.status(500).json({
      success: false,
      message: `Webhook handler failed: ${err.message}`
    });
  }
}

/**
 * 3. POST /api/payments/manual/zelle-confirm
 * Secondary US payment path: Receives student ID, course ID, tokens, and Zelle confirmation number.
 * Records transaction with status 'PENDING_ADMIN_CONFIRMATION'.
 */
export async function manualZelleConfirmHandler(req: Request, res: Response): Promise<any> {
  try {
    const {
      student_id,
      course_id,
      tokens_purchased,
      amount_usd,
      zelle_confirmation_number,
      student_name,
      parent_email,
      notes
    } = req.body;

    if (!student_id || !course_id) {
      return res.status(400).json({
        success: false,
        message: "Missing mandatory fields: student_id and course_id are required."
      });
    }

    if (!zelle_confirmation_number || !zelle_confirmation_number.trim()) {
      return res.status(400).json({
        success: false,
        message: "A valid Zelle confirmation reference code is required."
      });
    }

    const tokens = Math.max(1, Math.floor(Number(tokens_purchased) || 1));
    const result = await StripeService.recordZellePayment({
      student_id: String(student_id),
      course_id: String(course_id),
      tokens_purchased: tokens,
      amount_usd: amount_usd !== undefined ? Number(amount_usd) : tokens * 40.0,
      zelle_confirmation_number: String(zelle_confirmation_number).trim(),
      student_name,
      parent_email,
      notes
    });

    return res.status(201).json({
      success: true,
      message: `Zelle confirmation recorded with reference ${result.transaction.zelle_confirmation_number}. Awaiting admin review.`,
      status: result.status,
      data: result.transaction
    });
  } catch (error: any) {
    console.error("[Zelle Confirm Error]:", error);
    return res.status(500).json({
      success: false,
      message: error.message || "Failed to record Zelle payment."
    });
  }
}

// Router registrations
router.post("/stripe/create-checkout-session", createCheckoutSessionHandler);
router.post("/stripe/webhook", stripeWebhookHandler);
router.post("/manual/zelle-confirm", manualZelleConfirmHandler);

// Helper check endpoint
router.get("/stripe/status", (_req: Request, res: Response) => {
  res.json({
    mock_mode: isStripeMockMode(),
    currency: process.env.STRIPE_CURRENCY || "usd",
    publishable_key_set: !!process.env.VITE_STRIPE_PUBLISHABLE_KEY || !!process.env.STRIPE_SECRET_KEY
  });
});

export default router;
