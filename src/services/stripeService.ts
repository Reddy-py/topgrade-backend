import Stripe from "stripe";
import { supabaseAdmin } from "../supabase.js";
import {
  createOrder,
  findOrder,
  fulfillOrder,
  applyTokens,
  findStudent,
  type OrderRow,
  type StudentInfo
} from "./tokenService.js";
import { getCachedInstituteSettings, instituteAddress } from "./instituteSettingsService.js";
import { renderTemplate } from "./emailTemplateService.js";
import { dispatchMultiChannelNotification } from "./notificationService.js";

const frontendUrl = (): string => (process.env.FRONTEND_URL || "http://localhost:5173").replace(/\/+$/, "");

export function isStripeConfigured(): boolean {
  const key = process.env.STRIPE_SECRET_KEY || "";
  return !!key && !key.startsWith("sk_test_placeholder");
}

export function isStripeWebhookConfigured(): boolean {
  const secret = process.env.STRIPE_WEBHOOK_SECRET || "";
  return !!secret && !secret.startsWith("whsec_placeholder");
}

export function getStripeMode(): "test" | "live" | "unconfigured" {
  const key = process.env.STRIPE_SECRET_KEY || "";
  if (!key || key.startsWith("sk_test_placeholder")) return "unconfigured";
  if (key.startsWith("sk_live_")) return "live";
  return "test";
}

function stripeClient(): Stripe | null {
  return isStripeConfigured() ? new Stripe(process.env.STRIPE_SECRET_KEY as string) : null;
}

const cents = (amount: number): number => Math.round(Number(amount) * 100);

export class StripeService {
  /**
   * Creates a hosted Stripe Checkout Session for student hours/packages.
   * - Enforces server-side pricing.
   * - Enforces card_enabled switch.
   * - Enforces active dispute freeze.
   */
  static async createCheckout(p: {
    studentIdOrCode: string;
    courseIdOrName: string;
    quantity?: number | undefined;
    plan?: "HOURS" | "PACKAGE" | undefined;
    payerEmail?: string | null | undefined;
    by?: string | null | undefined;
  }): Promise<{
    url: string;
    sessionId: string;
    orderNumber: string;
    referenceCode: string;
    amountTotal: number;
    currency: string;
  }> {
    const settings = getCachedInstituteSettings();
    if (settings.card_enabled === false) {
      throw Object.assign(new Error("Card payments are currently disabled by the institute."), { status: 403 });
    }

    // Check if the student or family is currently frozen by an active dispute
    const student = await findStudent(p.studentIdOrCode);
    if (!student) throw Object.assign(new Error("Student not found."), { status: 404 });

    const { data: openDispute } = await supabaseAdmin
      .from("token_orders")
      .select("id, order_number")
      .eq("student_id", student.id)
      .eq("dispute_status", "DISPUTED")
      .limit(1)
      .maybeSingle();

    if (openDispute) {
      throw Object.assign(
        new Error(
          `New purchases for this account are temporarily suspended due to an open payment inquiry on order ${openDispute.order_number}. Please contact institute administration.`
        ),
        { status: 403 }
      );
    }

    const stripe = stripeClient();
    if (!stripe) {
      throw Object.assign(
        new Error("Card payment is not configured on the server. Please contact the institute."),
        { status: 503 }
      );
    }

    // 1. Create order on server; price calculated strictly from course
    const { order, course } = await createOrder({
      studentIdOrCode: p.studentIdOrCode,
      courseIdOrName: p.courseIdOrName,
      quantity: p.quantity,
      plan: p.plan,
      provider: "STRIPE",
      status: "PENDING_PAYMENT",
      payerEmail: p.payerEmail ?? null,
      by: p.by ?? null,
    });

    const isPackage = order.plan === "PACKAGE";
    const lineItemName = isPackage
      ? `${course.name}: Full Course Package (${order.quantity} hrs)`
      : `${course.name}: ${order.quantity} Class Hour${order.quantity > 1 ? "s" : ""}`;
    const lineItemDesc = isPackage
      ? `Full course curriculum package for ${student.name}. Includes ${order.quantity} instructional hours.`
      : `Prepaid instructional hours for ${student.name}. 1 class = 1 hour credit.`;

    try {
      const session = await stripe.checkout.sessions.create({
        mode: "payment",
        line_items: [
          {
            price_data: {
              currency: order.currency,
              product_data: {
                name: lineItemName,
                description: lineItemDesc,
              },
              unit_amount: cents(order.amount_total),
            },
            quantity: 1,
          },
        ],
        metadata: {
          order_id: order.id,
          order_number: order.order_number,
          reference_code: order.reference_code || "",
          student_id: student.id,
          course_id: course.id,
          quantity: String(order.quantity),
        },
        client_reference_id: order.reference_code || order.order_number,
        ...(p.payerEmail ? { customer_email: p.payerEmail } : {}),
        success_url: `${frontendUrl()}/app/fees?payment_success=true&session_id={CHECKOUT_SESSION_ID}&order_id=${order.id}`,
        cancel_url: `${frontendUrl()}/app/fees?payment_cancelled=true&order_id=${order.id}`,
      });

      if (!session.url) {
        throw new Error("Stripe did not return a checkout redirect URL.");
      }

      await supabaseAdmin.from("token_orders").update({
        provider_ref: session.id,
        stripe_session_id: session.id,
      }).eq("id", order.id);

      // Send order created notification
      if (order.payer_email || student.parentEmails.length > 0) {
        const recipient = order.payer_email || student.parentEmails[0] || "";
        void renderTemplate("CARD_ORDER_CREATED", {
          parent_name: "Parent / Guardian",
          student_name: student.name,
          order_number: order.order_number,
          reference_code: order.reference_code || "N/A",
          course_name: course.name,
          quantity: order.quantity,
          amount_total: Number(order.amount_total).toFixed(2),
          checkout_url: session.url,
        }).then(rendered => {
          if (rendered.enabled && recipient) {
            void dispatchMultiChannelNotification({
              eventType: "ADMISSION_APPROVED",
              subject: rendered.subject,
              message: rendered.htmlBody,
              recipients: [{ role: "PARENT", email: recipient, name: "Parent", phone: "" }],
            });
          }
        }).catch(err => console.warn("Notice sending card order created email:", err?.message));
      }

      return {
        url: session.url,
        sessionId: session.id,
        orderNumber: order.order_number,
        referenceCode: order.reference_code || "",
        amountTotal: Number(order.amount_total),
        currency: order.currency,
      };
    } catch (err: any) {
      await supabaseAdmin.from("token_orders").update({
        status: "FAILED",
        note: String(err?.message || "").slice(0, 300),
      }).eq("id", order.id);
      throw err;
    }
  }

  /**
   * Verifies a completed Checkout session with Stripe.
   * Called by the frontend return page as an immediate confirmation and webhook backup.
   */
  static async verifySession(sessionId: string): Promise<{
    order: OrderRow;
    paid: boolean;
    credited: boolean;
    balance?: number;
  }> {
    const order = await findOrder(sessionId);
    if (!order || (order.provider !== "STRIPE" && order.provider !== "STRIPE_CARD")) {
      throw Object.assign(new Error("Card payment order not found."), { status: 404 });
    }

    if (order.status === "PAID") {
      return { order, paid: true, credited: false };
    }

    const stripe = stripeClient();
    if (!stripe) {
      throw Object.assign(new Error("Stripe is not configured on the server."), { status: 503 });
    }

    const session = await stripe.checkout.sessions.retrieve(sessionId, {
      expand: ["payment_intent", "line_items"],
    });

    return StripeService.settleSession(order, session);
  }

  /**
   * Atomically settles a Stripe session:
   * - Verifies payment_status === 'paid'
   * - Verifies amount and currency match order
   * - Extracts card brand & last 4 digits
   * - Credits hours idempotently via fulfillOrder
   */
  private static async settleSession(order: OrderRow, session: Stripe.Checkout.Session): Promise<{
    order: OrderRow;
    paid: boolean;
    credited: boolean;
    balance?: number;
  }> {
    if (session.payment_status !== "paid") {
      return { order, paid: false, credited: false };
    }

    const expectedCents = cents(order.amount_total);
    if (session.amount_total !== expectedCents || String(session.currency).toLowerCase() !== order.currency.toLowerCase()) {
      await supabaseAdmin.from("token_orders").update({
        status: "FAILED",
        note: `Payment amount ($${(session.amount_total ? session.amount_total / 100 : 0).toFixed(2)}) or currency (${session.currency}) did not match order ($${order.amount_total} ${order.currency}).`,
      }).eq("id", order.id);
      throw new Error("Paid amount or currency does not match the order total. No class hours credited.");
    }

    // Extract payment intent and card details if available
    let piId: string | null = null;
    let cardBrand: string | null = null;
    let cardLast4: string | null = null;

    if (session.payment_intent) {
      if (typeof session.payment_intent === "string") {
        piId = session.payment_intent;
        try {
          const stripe = stripeClient();
          if (stripe) {
            const pi = await stripe.paymentIntents.retrieve(piId, {
              expand: ["latest_charge"],
            });
            const charge = pi.latest_charge as Stripe.Charge | null;
            if (charge?.payment_method_details?.card) {
              cardBrand = charge.payment_method_details.card.brand || null;
              cardLast4 = charge.payment_method_details.card.last4 || null;
            }
          }
        } catch {
          // Non-critical metadata extraction
        }
      } else {
        const pi = session.payment_intent as Stripe.PaymentIntent;
        piId = pi.id;
        const charge = (pi.latest_charge as Stripe.Charge) || null;
        if (charge?.payment_method_details?.card) {
          cardBrand = charge.payment_method_details.card.brand || null;
          cardLast4 = charge.payment_method_details.card.last4 || null;
        }
      }
    }

    // Save payment intent and card info
    await supabaseAdmin.from("token_orders").update({
      stripe_payment_intent_id: piId,
      card_brand: cardBrand,
      card_last4: cardLast4,
      amount_received: order.amount_total,
    }).eq("id", order.id);

    const updatedOrder: OrderRow = {
      ...order,
      stripe_payment_intent_id: piId,
      card_brand: cardBrand,
      card_last4: cardLast4,
      amount_received: order.amount_total,
    };

    // Fulfill order: credits hours idempotently and sends receipt email
    const fulfillment = await fulfillOrder(updatedOrder, "STRIPE_CHECKOUT");

    // Send CARD_PAYMENT_CONFIRMED email if freshly applied
    if (fulfillment.credited) {
      const student = await findStudent(order.student_id);
      const recipient = order.payer_email || (student ? student.parentEmails[0] : null);
      if (recipient && student) {
        const settings = getCachedInstituteSettings();
        const cardDetails = cardBrand && cardLast4 ? `(${cardBrand.toUpperCase()} ending in •••• ${cardLast4})` : "";
        void renderTemplate("CARD_PAYMENT_CONFIRMED", {
          parent_name: "Parent / Guardian",
          student_name: student.name,
          order_number: order.order_number,
          reference_code: order.reference_code || "N/A",
          course_name: order.course_name || "Course",
          card_details: cardDetails,
          amount_paid: Number(order.amount_total).toFixed(2),
          hours_credited: order.quantity,
          balance_after: fulfillment.balance,
          institute_name: settings.institute_name,
          institute_address: instituteAddress(),
        }).then(rendered => {
          if (rendered.enabled) {
            void dispatchMultiChannelNotification({
              eventType: "PAYMENT_COMPLETED",
              subject: rendered.subject,
              message: rendered.htmlBody,
              recipients: [{ role: "PARENT", email: recipient, name: "Parent", phone: "" }],
            });
          }
        }).catch(err => console.warn("Notice sending card receipt email:", err?.message));
      }
    }

    return {
      order: { ...updatedOrder, status: "PAID" },
      paid: true,
      credited: fulfillment.credited,
      balance: fulfillment.balance,
    };
  }

  /**
   * Signed webhook receiver.
   * - Strictly validates stripe-signature HMAC.
   * - Idempotent by event_id in stripe_processed_events.
   * - Handles completions, failures, cancellations, refunds, and disputes.
   */
  static async handleWebhook(
    rawBody: Buffer | string,
    signature?: string | string[]
  ): Promise<{ handled: boolean; type: string; duplicate?: boolean }> {
    const sig = Array.isArray(signature) ? signature[0] : signature;
    if (!sig) {
      throw Object.assign(new Error("Missing stripe-signature header."), { status: 400 });
    }

    const stripe = stripeClient();
    const secret = process.env.STRIPE_WEBHOOK_SECRET || "";
    if (!stripe || !secret) {
      throw Object.assign(new Error("Stripe webhook signing secret is not configured."), { status: 400 });
    }

    let event: Stripe.Event;
    try {
      event = stripe.webhooks.constructEvent(rawBody, sig, secret);
    } catch (err: any) {
      throw Object.assign(new Error(`Invalid webhook signature: ${err?.message}`), { status: 400 });
    }

    // Check idempotency: store processed events
    const { data: existingEvent } = await supabaseAdmin
      .from("stripe_processed_events")
      .select("event_id")
      .eq("event_id", event.id)
      .maybeSingle();

    if (existingEvent) {
      return { handled: true, type: event.type, duplicate: true };
    }

    // Record event as processed
    await supabaseAdmin.from("stripe_processed_events").insert({
      event_id: event.id,
      event_type: event.type,
      processed_at: new Date().toISOString(),
    });

    switch (event.type) {
      case "checkout.session.completed":
      case "checkout.session.async_payment_succeeded": {
        const session = event.data.object as Stripe.Checkout.Session;
        const order = await findOrder(session.id);
        if (!order) return { handled: false, type: event.type };
        await StripeService.settleSession(order, session);
        return { handled: true, type: event.type };
      }

      case "checkout.session.expired":
      case "checkout.session.async_payment_failed": {
        const session = event.data.object as Stripe.Checkout.Session;
        const newStatus = event.type.endsWith("expired") ? "EXPIRED" : "FAILED";
        await supabaseAdmin.from("token_orders")
          .update({
            status: newStatus,
            note: `Stripe event: ${event.type}`,
          })
          .eq("provider", "STRIPE")
          .eq("provider_ref", session.id)
          .in("status", ["PENDING_PAYMENT", "PENDING"]);
        return { handled: true, type: event.type };
      }

      case "charge.refunded": {
        const charge = event.data.object as Stripe.Charge;
        const piId = typeof charge.payment_intent === "string" ? charge.payment_intent : charge.payment_intent?.id;
        if (!piId) return { handled: false, type: event.type };

        const { data: orderData } = await supabaseAdmin
          .from("token_orders")
          .select("*")
          .eq("stripe_payment_intent_id", piId)
          .maybeSingle();

        if (!orderData) return { handled: false, type: event.type };
        const order = orderData as OrderRow;

        const refundDollars = (charge.amount_refunded || 0) / 100;
        await StripeService.recordRefund(order, refundDollars, "Stripe webhook charge.refunded", "STRIPE_WEBHOOK");
        return { handled: true, type: event.type };
      }

      case "charge.dispute.created": {
        const dispute = event.data.object as Stripe.Dispute;
        const chargeId = typeof dispute.charge === "string" ? dispute.charge : dispute.charge?.id;
        const piId = dispute.payment_intent ? (typeof dispute.payment_intent === "string" ? dispute.payment_intent : dispute.payment_intent.id) : null;

        const { data: orderData } = await supabaseAdmin
          .from("token_orders")
          .select("*")
          .or(`stripe_payment_intent_id.eq.${piId},provider_ref.eq.${chargeId}`)
          .maybeSingle();

        if (!orderData) return { handled: false, type: event.type };
        const order = orderData as OrderRow;

        await StripeService.recordDispute(order, dispute);
        return { handled: true, type: event.type };
      }

      default:
        return { handled: false, type: event.type };
    }
  }

  /**
   * Records a refund on an order, deducts matching hours, and emails the parent.
   */
  public static async recordRefund(
    order: OrderRow,
    refundAmount: number,
    reason: string,
    adminOrSource: string
  ): Promise<{ hoursDeducted: number; newBalance: number }> {
    const hoursToDeduct = Math.max(
      1,
      Math.round((refundAmount / Number(order.amount_total)) * Number(order.quantity))
    );

    // Write negative ledger adjustment
    const applyRes = await applyTokens({
      studentId: order.student_id,
      courseId: order.course_id,
      delta: -hoursToDeduct,
      reason: "ADJUSTMENT",
      ref: order.order_number,
      note: `Refund: ${reason} ($${refundAmount.toFixed(2)} refunded)`,
      by: adminOrSource,
    });

    const totalRefunded = (Number(order.refunded_amount) || 0) + refundAmount;
    await supabaseAdmin.from("token_orders").update({
      refunded_amount: totalRefunded,
      refund_reason: reason,
      refunded_at: new Date().toISOString(),
      mismatch_note: `Refund issued: $${refundAmount.toFixed(2)}. ${reason}`,
    }).eq("id", order.id);

    // Send refund notice email to parent
    const student = await findStudent(order.student_id);
    const recipient = order.payer_email || (student ? student.parentEmails[0] : null);
    if (recipient && student) {
      void renderTemplate("CARD_REFUND_PROCESSED", {
        parent_name: "Parent / Guardian",
        student_name: student.name,
        order_number: order.order_number,
        reference_code: order.reference_code || "N/A",
        refund_amount: refundAmount.toFixed(2),
        refund_reason: reason,
        hours_deducted: hoursToDeduct,
        balance_after: applyRes.balance,
      }).then(rendered => {
        if (rendered.enabled) {
          void dispatchMultiChannelNotification({
            eventType: "PAYMENT_COMPLETED",
            subject: rendered.subject,
            message: rendered.htmlBody,
            recipients: [{ role: "PARENT", email: recipient, name: "Parent", phone: "" }],
          });
        }
      }).catch(err => console.warn("Notice sending refund email:", err?.message));
    }

    return { hoursDeducted: hoursToDeduct, newBalance: applyRes.balance };
  }

  /**
   * Flags an order as DISPUTED, freezes student purchase privileges, and alerts admin.
   */
  public static async recordDispute(order: OrderRow, dispute?: Stripe.Dispute): Promise<void> {
    await supabaseAdmin.from("token_orders").update({
      dispute_status: "DISPUTED",
      disputed_at: new Date().toISOString(),
      note: `Chargeback dispute opened. Reason: ${dispute?.reason || "Inquiry"}. Amount: $${dispute ? (dispute.amount / 100).toFixed(2) : order.amount_total}.`,
    }).eq("id", order.id);

    const student = await findStudent(order.student_id);
    const settings = getCachedInstituteSettings();
    const adminEmail = settings.support_email || process.env.ADMIN_EMAIL || "admin@topgrade.edu";

    void renderTemplate("CARD_DISPUTE_OPENED", {
      order_number: order.order_number,
      reference_code: order.reference_code || "N/A",
      student_name: student ? student.name : "Student",
      student_code: student ? student.code : "",
      parent_name: "Parent",
      parent_email: order.payer_email || (student ? student.parentEmails[0] : "N/A"),
      dispute_amount: dispute ? (dispute.amount / 100).toFixed(2) : Number(order.amount_total).toFixed(2),
      dispute_reason: dispute?.reason || "Cardholder inquiry",
    }).then(rendered => {
      if (rendered.enabled && adminEmail) {
        void dispatchMultiChannelNotification({
          eventType: "ADMISSION_APPROVED",
          subject: rendered.subject,
          message: rendered.htmlBody,
          recipients: [{ role: "ADMIN", email: adminEmail, name: "Admin", phone: "" }],
        });
      }
    }).catch(err => console.warn("Notice sending dispute alert:", err?.message));
  }

  /**
   * Admin-initiated refund from the dashboard.
   * Full or partial refund with a mandatory reason.
   */
  static async processRefund(p: {
    orderId: string;
    amount?: number | undefined;
    reason: string;
    adminId: string;
  }): Promise<{ success: boolean; refundedAmount: number; hoursDeducted: number; balance: number }> {
    if (!p.reason || !p.reason.trim()) {
      throw Object.assign(new Error("A mandatory explanation reason is required to issue a refund."), { status: 400 });
    }

    const { data: orderData, error } = await supabaseAdmin
      .from("token_orders")
      .select("*")
      .eq("id", p.orderId)
      .maybeSingle();

    if (error || !orderData) {
      throw Object.assign(new Error("Order not found."), { status: 404 });
    }

    const order = orderData as OrderRow;

    if (order.provider === "ZELLE") {
      throw Object.assign(
        new Error("Zelle orders cannot be refunded through the card system. Zelle payments must be handled directly between your bank and the parent."),
        { status: 400 }
      );
    }

    if (order.status !== "PAID" && order.status !== "PARTIAL") {
      throw Object.assign(new Error(`Cannot refund an order in status: ${order.status}`), { status: 400 });
    }

    const currentRefunded = Number(order.refunded_amount) || 0;
    const maxRefundable = Number(order.amount_total) - currentRefunded;
    const requestedAmount = p.amount !== undefined ? Number(p.amount) : maxRefundable;

    if (requestedAmount <= 0) {
      throw Object.assign(new Error("Refund amount must be greater than $0.00."), { status: 400 });
    }

    if (requestedAmount > maxRefundable + 0.001) {
      throw Object.assign(
        new Error(`Requested refund ($${requestedAmount.toFixed(2)}) exceeds remaining refundable balance ($${maxRefundable.toFixed(2)}).`),
        { status: 400 }
      );
    }

    const stripe = stripeClient();
    if (!stripe) {
      throw Object.assign(new Error("Stripe secret key is not configured."), { status: 503 });
    }

    if (!order.stripe_payment_intent_id) {
      throw Object.assign(new Error("Stripe payment intent is missing on this order. Cannot issue automatic refund."), { status: 400 });
    }

    // Call Stripe refund API
    await stripe.refunds.create({
      payment_intent: order.stripe_payment_intent_id,
      amount: cents(requestedAmount),
      reason: "requested_by_customer",
      metadata: {
        order_number: order.order_number,
        admin_id: p.adminId,
        reason: p.reason.trim(),
      },
    });

    const { hoursDeducted, newBalance } = await StripeService.recordRefund(
      order,
      requestedAmount,
      p.reason.trim(),
      p.adminId
    );

    return {
      success: true,
      refundedAmount: requestedAmount,
      hoursDeducted,
      balance: newBalance,
    };
  }

  /**
   * Admin-initiated resolution of an open dispute.
   * Clears the dispute flag and unfreezes purchase privileges for the family.
   */
  static async resolveDispute(p: {
    orderId: string;
    note: string;
    adminId: string;
  }): Promise<{ success: boolean }> {
    const { data: orderData, error } = await supabaseAdmin
      .from("token_orders")
      .select("*")
      .eq("id", p.orderId)
      .maybeSingle();

    if (error || !orderData) {
      throw Object.assign(new Error("Order not found."), { status: 404 });
    }

    await supabaseAdmin.from("token_orders").update({
      dispute_status: "RESOLVED",
      note: `Dispute cleared by admin (${p.adminId}): ${p.note || "Resolved"}.`,
    }).eq("id", p.orderId);

    return { success: true };
  }
}
