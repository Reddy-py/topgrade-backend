import Stripe from "stripe";
import { supabaseAdmin } from "../supabase.js";
import { createOrder, findOrder, fulfillOrder, type OrderRow } from "./tokenService.js";

/**
 * Stripe Checkout for class tokens.
 *  - The price is read from the course on the server. The browser sends only: student, course, how many tokens.
 *  - Tokens are credited ONLY after Stripe confirms payment (signed webhook, or the return page asking Stripe directly),
 *    and only once, whichever of the two arrives first.
 *  - There is no "mock mode" in production. A development mock needs ALLOW_MOCK_PAYMENTS=true and no Stripe key.
 */

const frontendUrl = (): string => (process.env.FRONTEND_URL || "http://localhost:5173").replace(/\/+$/, "");

export function isStripeConfigured(): boolean {
  const key = process.env.STRIPE_SECRET_KEY || "";
  return !!key && !key.startsWith("sk_test_placeholder");
}

export function isMockAllowed(): boolean {
  return !isStripeConfigured() && process.env.NODE_ENV !== "production" && process.env.ALLOW_MOCK_PAYMENTS === "true";
}

function stripeClient(): Stripe | null {
  return isStripeConfigured() ? new Stripe(process.env.STRIPE_SECRET_KEY as string) : null;
}

const cents = (amount: number): number => Math.round(Number(amount) * 100);

export class StripeService {
  static async createCheckout(p: {
    studentIdOrCode: string; courseIdOrName: string; quantity: number; payerEmail?: string | null; by?: string | null;
  }): Promise<{ url: string; sessionId: string; orderNumber: string; amountTotal: number; currency: string; isMock: boolean }> {
    const stripe = stripeClient();
    if (!stripe && !isMockAllowed()) {
      throw Object.assign(new Error("Online payment is not set up yet. Please contact the institute."), { status: 503 });
    }

    const { order, student, course } = await createOrder({
      studentIdOrCode: p.studentIdOrCode, courseIdOrName: p.courseIdOrName, quantity: p.quantity,
      provider: "STRIPE", status: "PENDING", payerEmail: p.payerEmail ?? null, by: p.by ?? null,
    });

    if (!stripe) {
      const mockId = `cs_mock_${order.order_number}`;
      await supabaseAdmin.from("token_orders").update({ provider_ref: mockId }).eq("id", order.id);
      return {
        url: `${frontendUrl()}/app/students?payment_success=true&mock=true&session_id=${mockId}`,
        sessionId: mockId, orderNumber: order.order_number, amountTotal: Number(order.amount_total), currency: order.currency, isMock: true,
      };
    }

    try {
      const session = await stripe.checkout.sessions.create({
        mode: "payment",
        line_items: [{
          price_data: {
            currency: order.currency,
            product_data: {
              name: `${course.name}: ${order.quantity} class hour${order.quantity > 1 ? "s" : ""}`,
              description: `Prepaid class hours for ${student.name}. One class uses one hour.`,
            },
            unit_amount: cents(order.unit_price),
          },
          quantity: order.quantity,
        }],
        metadata: { order_number: order.order_number, student_id: student.id, course_id: course.id, quantity: String(order.quantity) },
        client_reference_id: order.order_number,
        ...(p.payerEmail ? { customer_email: p.payerEmail } : {}),
        success_url: `${frontendUrl()}/app/students?payment_success=true&session_id={CHECKOUT_SESSION_ID}`,
        cancel_url: `${frontendUrl()}/app/students?payment_cancelled=true`,
      });
      if (!session.url) throw new Error("Stripe did not return a checkout link.");
      await supabaseAdmin.from("token_orders").update({ provider_ref: session.id }).eq("id", order.id);
      return { url: session.url, sessionId: session.id, orderNumber: order.order_number, amountTotal: Number(order.amount_total), currency: order.currency, isMock: false };
    } catch (err: any) {
      await supabaseAdmin.from("token_orders").update({ status: "FAILED", note: String(err?.message || "").slice(0, 300) }).eq("id", order.id);
      throw err;
    }
  }

  /** Checks a finished Checkout with Stripe itself and credits the tokens (once). Used by the return page and as a webhook backup. */
  static async verifySession(sessionId: string): Promise<{ order: OrderRow; paid: boolean; credited: boolean; balance?: number }> {
    const order = await findOrder(sessionId);
    if (!order || order.provider !== "STRIPE") throw Object.assign(new Error("Payment not found."), { status: 404 });
    if (order.status === "PAID") return { order, paid: true, credited: false };

    if (sessionId.startsWith("cs_mock_")) {
      if (!isMockAllowed()) throw Object.assign(new Error("Mock payments are disabled."), { status: 400 });
      const r = await fulfillOrder(order);
      return { order: { ...order, status: "PAID" }, paid: true, credited: r.credited, balance: r.balance };
    }

    const stripe = stripeClient();
    if (!stripe) throw Object.assign(new Error("Online payment is not set up."), { status: 503 });
    const session = await stripe.checkout.sessions.retrieve(sessionId);
    return StripeService.settle(order, session);
  }

  private static async settle(order: OrderRow, session: Stripe.Checkout.Session) {
    if (session.payment_status !== "paid") return { order, paid: false, credited: false };
    const expected = cents(order.amount_total);
    if (session.amount_total !== expected || String(session.currency).toLowerCase() !== order.currency) {
      await supabaseAdmin.from("token_orders").update({ status: "FAILED", note: "Amount or currency did not match the order." }).eq("id", order.id);
      throw new Error("The paid amount does not match the order. No tokens were added.");
    }
    const r = await fulfillOrder(order);
    return { order: { ...order, status: "PAID" }, paid: true, credited: r.credited, balance: r.balance };
  }

  /** Signed webhook. Unsigned or wrongly signed requests are always rejected. */
  static async handleWebhook(rawBody: Buffer | string, signature?: string | string[]): Promise<{ handled: boolean; type: string }> {
    const stripe = stripeClient();
    const secret = process.env.STRIPE_WEBHOOK_SECRET || "";
    if (!stripe || !secret) throw Object.assign(new Error("Stripe webhook is not configured."), { status: 400 });
    const sig = Array.isArray(signature) ? signature[0] : signature;
    if (!sig) throw Object.assign(new Error("Missing stripe-signature header."), { status: 400 });
    const event = stripe.webhooks.constructEvent(rawBody, sig, secret);

    if (event.type === "checkout.session.completed" || event.type === "checkout.session.async_payment_succeeded") {
      const session = event.data.object as Stripe.Checkout.Session;
      const order = await findOrder(session.id);
      if (!order) return { handled: false, type: event.type };
      await StripeService.settle(order, session);
      return { handled: true, type: event.type };
    }
    if (event.type === "checkout.session.expired" || event.type === "checkout.session.async_payment_failed") {
      const session = event.data.object as Stripe.Checkout.Session;
      await supabaseAdmin.from("token_orders")
        .update({ status: event.type.endsWith("expired") ? "CANCELLED" : "FAILED" })
        .eq("provider", "STRIPE").eq("provider_ref", session.id).eq("status", "PENDING");
      return { handled: true, type: event.type };
    }
    return { handled: false, type: event.type };
  }
}
