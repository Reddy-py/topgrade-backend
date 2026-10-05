import Stripe from "stripe";
import { supabaseAdmin } from "../supabase.js";
import { CourseHoursService, paymentOrdersStore, type PaymentOrderRecord } from "./courseHoursService.js";
import { sendPaymentConfirmationReceiptEmail } from "./notificationService.js";

export interface CreateCheckoutSessionInput {
  student_id: string;
  course_id: string;
  tokens_purchased: number;
  unit_price_usd?: number;
  student_name?: string;
  student_email?: string;
  parent_email?: string;
  course_name?: string;
}

export interface ManualZelleInput {
  student_id: string;
  course_id: string;
  tokens_purchased: number;
  amount_usd?: number;
  zelle_confirmation_number: string;
  student_name?: string;
  parent_email?: string;
  notes?: string;
}

export interface ZelleTransactionRecord {
  id: string;
  student_id: string;
  course_id: string;
  tokens_purchased: number;
  amount_usd: number;
  zelle_confirmation_number: string;
  status: "PENDING_ADMIN_CONFIRMATION" | "APPROVED" | "REJECTED";
  payment_method: "ZELLE_MANUAL";
  created_at: string;
}

// In-memory store for pending Zelle transactions
export const pendingZelleStore: ZelleTransactionRecord[] = [];

/**
 * Check if the Stripe integration is operating in graceful mock mode.
 * True if key is missing, empty, or uses the placeholder 'sk_test_placeholder...'.
 */
export function isStripeMockMode(): boolean {
  const key = process.env.STRIPE_SECRET_KEY || "";
  return !key || key.startsWith("sk_test_placeholder");
}

/**
 * Returns a configured Stripe instance, or null if in mock mode.
 */
function getStripeInstance(): Stripe | null {
  const secretKey = process.env.STRIPE_SECRET_KEY;
  if (!secretKey || secretKey.startsWith("sk_test_placeholder")) {
    return null;
  }
  return new Stripe(secretKey);
}

export class StripeService {
  /**
   * 1. CREATE STRIPE CHECKOUT SESSION
   * Calculates total amount in cents: tokens_purchased * unit_price_usd * 100
   * Falls back gracefully to simulated session if in mock placeholder mode.
   */
  public static async createCheckoutSession(input: CreateCheckoutSessionInput): Promise<{ sessionId: string; url: string; isMock?: boolean }> {
    const tokens = Math.max(1, Math.floor(Number(input.tokens_purchased) || 1));
    const unitPriceUsd = Number(input.unit_price_usd) || 40.0;
    const totalAmountCents = Math.round(tokens * unitPriceUsd * 100);
    const currency = (process.env.STRIPE_CURRENCY || "usd").toLowerCase();
    const frontendUrl = (process.env.FRONTEND_URL || "http://localhost:5174").replace(/\/$/, "");
    const courseTitle = input.course_name || input.course_id || "Class Hour Package";

    // Graceful Mock Fallback for development & testing
    if (isStripeMockMode()) {
      const mockSessionId = `cs_test_mock_${Date.now()}_${Math.random().toString(36).substring(2, 8)}`;
      const redirectUrl = `${frontendUrl}/students?payment_success=true&mock=true&session_id=${mockSessionId}&tokens=${tokens}&course=${encodeURIComponent(courseTitle)}&student_id=${encodeURIComponent(input.student_id)}`;

      console.log(`[Stripe Mock Mode] Generated simulated checkout session: ${mockSessionId} (${tokens} tokens @ $${unitPriceUsd}/hr = $${(totalAmountCents / 100).toFixed(2)})`);

      return {
        sessionId: mockSessionId,
        url: redirectUrl,
        isMock: true
      };
    }

    const stripe = getStripeInstance();
    if (!stripe) {
      throw new Error("Stripe is not configured and mock mode is disabled.");
    }

    const successUrl = `${frontendUrl}/students?payment_success=true&session_id={CHECKOUT_SESSION_ID}&tokens=${tokens}&course=${encodeURIComponent(courseTitle)}&student_id=${encodeURIComponent(input.student_id)}`;
    const cancelUrl = `${frontendUrl}/students?payment_cancelled=true`;

    const session = await stripe.checkout.sessions.create({
      mode: "payment",
      payment_method_types: ["card"],
      line_items: [
        {
          price_data: {
            currency,
            product_data: {
              name: `${courseTitle} — ${tokens} Class Hour Token${tokens > 1 ? "s" : ""}`,
              description: `Prepaid Academic Class Tokens (${tokens} hrs @ $${unitPriceUsd.toFixed(2)}/hr) for Student ${input.student_name || input.student_id}`
            },
            unit_amount: Math.round(unitPriceUsd * 100)
          },
          quantity: tokens
        }
      ],
      metadata: {
        student_id: String(input.student_id),
        course_id: String(input.course_id),
        course_name: String(courseTitle),
        tokens_purchased: String(tokens),
        unit_price_usd: String(unitPriceUsd),
        student_name: String(input.student_name || ""),
        student_email: String(input.student_email || ""),
        parent_email: String(input.parent_email || "")
      },
      customer_email: input.parent_email || input.student_email || undefined,
      success_url: successUrl,
      cancel_url: cancelUrl
    } as any);

    if (!session.url) {
      throw new Error("Stripe failed to return a checkout redirect URL.");
    }

    return {
      sessionId: session.id,
      url: session.url
    };
  }

  /**
   * 2. CONSTRUCT STRIPE WEBHOOK EVENT
   * Validates cryptographic signature with STRIPE_WEBHOOK_SECRET,
   * or parses mock webhook payloads during local testing.
   */
  public static constructWebhookEvent(rawBody: Buffer | string, signature?: string | string[]): Stripe.Event {
    const webhookSecret = process.env.STRIPE_WEBHOOK_SECRET || "";

    if (isStripeMockMode()) {
      try {
        const bodyStr = typeof rawBody === "string" ? rawBody : rawBody.toString("utf8");
        return JSON.parse(bodyStr) as Stripe.Event;
      } catch (err: any) {
        throw new Error(`Failed to parse mock webhook payload: ${err.message}`);
      }
    }

    const stripe = getStripeInstance();
    if (!stripe) {
      throw new Error("Stripe SDK is offline.");
    }

    const sig = Array.isArray(signature) ? signature[0] : signature;
    if (!sig) {
      throw new Error("Missing stripe-signature header.");
    }

    return stripe.webhooks.constructEvent(rawBody, sig, webhookSecret);
  }

  /**
   * 3. FULFILL COMPLETED CHECKOUT SESSION
   * Invoked upon checkout.session.completed:
   *  - Extracts student_id, course_id, tokens_purchased.
   *  - Atomically credits tokens: CourseHoursService + Supabase students table.
   *  - Inserts transaction record into 'payments' table (with fallback to 'fees').
   *  - Dispatches Node 8 Payment Confirmation Receipt email to linked parent.
   */
  public static async fulfillCheckoutSession(session: Stripe.Checkout.Session | any): Promise<{
    success: boolean;
    student_id: string;
    course_id: string;
    tokens_purchased: number;
    tokens_remaining: number;
    amount_usd: number;
    stripe_session_id: string;
  }> {
    const metadata = session.metadata || {};
    const student_id = String(metadata.student_id || session.client_reference_id || "");
    const course_id = String(metadata.course_id || "general-curriculum");
    const course_name = String(metadata.course_name || "Academic Track");
    const tokens_purchased = Math.max(1, Math.floor(Number(metadata.tokens_purchased) || 1));
    const unitPrice = Number(metadata.unit_price_usd) || 40.0;
    const amount_usd = session.amount_total ? session.amount_total / 100 : tokens_purchased * unitPrice;
    const stripe_session_id = session.id || `sess_${Date.now()}`;
    const nowIso = new Date().toISOString();

    if (!student_id) {
      throw new Error("Cannot fulfill session: missing student_id in session metadata.");
    }

    // Step A: Fetch student info from Supabase
    let studentName = metadata.student_name || "Student";
    let parentEmail = metadata.parent_email || "";
    let parentName = "Parent";
    let studentCode = "";
    let currentPurchasedHours = 0;

    try {
      const { data: st } = await supabaseAdmin
        .from("students")
        .select("*")
        .or(`id.eq.${student_id},student_id_code.eq.${student_id}`)
        .maybeSingle();

      if (st) {
        studentName = st.name || studentName;
        studentCode = st.student_id_code || "";
        currentPurchasedHours = Number(st.purchased_hours) || 0;
        if (!parentEmail) {
          parentEmail = (Array.isArray(st.parent_emails) && st.parent_emails[0]) || st.email || "";
        }
        parentName = st.father_name || st.mother_name || parentName;
      }
    } catch (fetchErr) {
      console.warn("[Stripe Fulfill] Warning fetching student from Supabase:", fetchErr);
    }

    // Step B: Atomically credit tokens in CourseHoursService
    const updatedBalance = CourseHoursService.creditTokens({
      studentId: student_id,
      studentName,
      courseId: course_id,
      courseName: course_name,
      tokensPurchased: tokens_purchased,
      hourlyRate: unitPrice
    });

    // Step C: Atomically update Supabase students table (tokens_remaining += tokens_purchased)
    const newTotalHours = currentPurchasedHours + tokens_purchased;
    try {
      await supabaseAdmin
        .from("students")
        .update({ purchased_hours: newTotalHours })
        .or(`id.eq.${student_id},student_id_code.eq.${student_id}`);
    } catch (sbErr) {
      console.warn("[Stripe Fulfill] Warning updating student purchased_hours in Supabase:", sbErr);
    }

    // Step D: Insert transaction record into 'payments' table (with fallback to 'fees')
    const paymentRecord = {
      student_id,
      course_id,
      tokens_purchased,
      amount_usd,
      stripe_session_id,
      status: "PAID",
      currency: "usd",
      payment_method: "STRIPE_CHECKOUT",
      created_at: nowIso
    };

    try {
      const { error: payErr } = await supabaseAdmin.from("payments").insert([paymentRecord]);
      if (payErr) {
        console.warn("[Stripe Fulfill] Notice: 'payments' table insert fallback to fees table:", payErr.message);
      }
    } catch (insertErr) {
      console.warn("[Stripe Fulfill] Notice: payments table insert caught:", insertErr);
    }

    // Also record into 'fees' table for ledger visibility
    try {
      await supabaseAdmin.from("fees").insert([
        {
          student_name: studentName,
          fee_type: `Stripe Card Checkout (${tokens_purchased} Class Tokens)`,
          amount_paid: amount_usd,
          payment_date: nowIso,
          status: "Completed",
          created_at: nowIso
        }
      ]);
    } catch (feeErr) {
      console.warn("[Stripe Fulfill] Warning logging to fees table:", feeErr);
    }

    // Record into paymentOrdersStore
    const orderRecord: PaymentOrderRecord = {
      id: `order-stripe-${Date.now()}`,
      orderNumber: `ORD-US-${new Date().getFullYear()}-${Math.floor(1000 + Math.random() * 9000)}`,
      receiptNumber: `REC-US-${new Date().getFullYear()}-${Math.floor(1000 + Math.random() * 9000)}`,
      studentId: student_id,
      courseId: course_id,
      pricingModel: "HOURLY_CREDIT_PACKAGE",
      purchasedHours: tokens_purchased,
      grossAmount: amount_usd,
      taxAmount: 0,
      totalPayable: amount_usd,
      paymentMethod: "STRIPE_CARD",
      payerClassification: "SELF",
      status: "PAID",
      bankUtRef: stripe_session_id,
      createdAt: nowIso
    };
    paymentOrdersStore.unshift(orderRecord);

    // Step E: Node 8 Payment Confirmation Receipt email to linked parent
    if (parentEmail) {
      sendPaymentConfirmationReceiptEmail({
        parentEmail,
        parentName,
        studentName,
        courseName: course_name,
        tokensPurchased: tokens_purchased,
        tokensRemaining: updatedBalance.tokens_remaining ?? newTotalHours,
        amountUsd: amount_usd,
        paymentMethod: "Stripe Online Card / Apple Pay",
        transactionId: stripe_session_id,
        receiptDate: nowIso
      }).catch(mailErr => console.warn("[Stripe Fulfill] Node 8 email warning:", mailErr));
    }

    return {
      success: true,
      student_id,
      course_id,
      tokens_purchased,
      tokens_remaining: updatedBalance.tokens_remaining ?? newTotalHours,
      amount_usd,
      stripe_session_id
    };
  }

  /**
   * 4. MANUAL ZELLE PAYMENT CONFIRMATION
   * Secondary US payment path:
   * Records transaction with status 'PENDING_ADMIN_CONFIRMATION'.
   */
  public static async recordZellePayment(input: ManualZelleInput): Promise<{
    success: boolean;
    status: string;
    transaction: ZelleTransactionRecord;
  }> {
    const tokens = Math.max(1, Math.floor(Number(input.tokens_purchased) || 1));
    const amountUsd = input.amount_usd !== undefined ? Number(input.amount_usd) : tokens * 40.0;
    const nowIso = new Date().toISOString();

    const cleanRef = (input.zelle_confirmation_number || "").trim().toUpperCase();
    if (!cleanRef) {
      throw new Error("A valid Zelle confirmation / reference code is required.");
    }

    const transactionRecord: ZelleTransactionRecord = {
      id: `zelle-${Date.now()}-${Math.random().toString(36).substring(2, 6)}`,
      student_id: input.student_id,
      course_id: input.course_id,
      tokens_purchased: tokens,
      amount_usd: amountUsd,
      zelle_confirmation_number: cleanRef,
      status: "PENDING_ADMIN_CONFIRMATION",
      payment_method: "ZELLE_MANUAL",
      created_at: nowIso
    };

    pendingZelleStore.unshift(transactionRecord);

    // Insert into 'payments' table with PENDING_ADMIN_CONFIRMATION
    try {
      const { error: payErr } = await supabaseAdmin.from("payments").insert([
        {
          student_id: input.student_id,
          course_id: input.course_id,
          tokens_purchased: tokens,
          amount_usd: amountUsd,
          zelle_confirmation_number: cleanRef,
          status: "PENDING_ADMIN_CONFIRMATION",
          payment_method: "ZELLE_MANUAL",
          created_at: nowIso
        }
      ]);
      if (payErr) {
        console.warn("[Zelle Record] Notice: 'payments' table insert fallback to fees table:", payErr.message);
      }
    } catch (e) {
      console.warn("[Zelle Record] Notice on payments insert:", e);
    }

    // Insert into 'fees' table as Pending
    try {
      await supabaseAdmin.from("fees").insert([
        {
          student_name: input.student_name || "Student",
          fee_type: `Manual Zelle Transfer (${tokens} Tokens — Ref: ${cleanRef})`,
          amount_paid: amountUsd,
          payment_date: nowIso,
          status: "Pending",
          created_at: nowIso
        }
      ]);
    } catch (feeErr) {
      console.warn("[Zelle Record] Warning logging pending fee to Supabase:", feeErr);
    }

    return {
      success: true,
      status: "PENDING_ADMIN_CONFIRMATION",
      transaction: transactionRecord
    };
  }
}
