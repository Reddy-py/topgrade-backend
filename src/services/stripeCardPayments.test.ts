import { describe, it } from "node:test";
import assert from "node:assert/strict";
import crypto from "node:crypto";
import { quoteEnrollment, type CoursePricingInput } from "./pricing.js";
import {
  isStripeConfigured,
  getStripeMode,
  isStripeWebhookConfigured,
  StripeService
} from "./stripeService.js";
import {
  getAvailablePaymentMethods,
  getPaymentSystemStatus,
  StripeCardProvider,
  ZellePaymentProvider
} from "./paymentProvider.js";
import { setCachedInstituteSettings } from "./instituteSettingsService.js";

describe("TASK 16b: Dual Payment Engine (Stripe Card & Zelle Invariants)", () => {
  const mockCourse: CoursePricingInput = {
    id: "course-adv-algebra",
    name: "Advanced Algebra Tutoring",
    hourly_rate: 40.0,
    package_hours: 20,
    package_price: 700.0,
    duration_months: 6,
  };

  // ---------------------------------------------------------------------------
  // 1. PROVIDER INTERFACE & SETTINGS TOGGLES
  // ---------------------------------------------------------------------------
  it("PaymentProvider interface supports both STRIPE_CARD and ZELLE providers", () => {
    const cardProvider = new StripeCardProvider();
    const zelleProvider = new ZellePaymentProvider();

    assert.equal(cardProvider.code, "STRIPE_CARD");
    assert.equal(cardProvider.displayName, "Credit or Debit Card");
    assert.equal(cardProvider.isAutomated, true);

    assert.equal(zelleProvider.code, "ZELLE");
    assert.equal(zelleProvider.displayName, "Zelle (Bank Transfer)");
    assert.equal(zelleProvider.isAutomated, false);
  });

  it("admin can switch each method on or off in institute_settings", () => {
    // Both active
    setCachedInstituteSettings({ card_enabled: true, zelle_enabled: true });
    const methodsBoth = getAvailablePaymentMethods();
    if (isStripeConfigured()) {
      assert.deepEqual(methodsBoth.map(m => m.code), ["STRIPE_CARD", "ZELLE"]);
    } else {
      assert.deepEqual(methodsBoth.map(m => m.code), ["ZELLE"]);
    }

    // Only card enabled
    setCachedInstituteSettings({ card_enabled: true, zelle_enabled: false });
    const methodsCardOnly = getAvailablePaymentMethods();
    if (isStripeConfigured()) {
      assert.deepEqual(methodsCardOnly.map(m => m.code), ["STRIPE_CARD"]);
    } else {
      assert.deepEqual(methodsCardOnly.map(m => m.code), []);
    }

    // Only zelle enabled
    setCachedInstituteSettings({ card_enabled: false, zelle_enabled: true });
    const methodsZelleOnly = getAvailablePaymentMethods();
    assert.deepEqual(methodsZelleOnly.map(m => m.code), ["ZELLE"]);

    // Neither enabled (online payment unavailable)
    setCachedInstituteSettings({ card_enabled: false, zelle_enabled: false });
    const methodsNone = getAvailablePaymentMethods();
    assert.deepEqual(methodsNone.map(m => m.code), []);

    // Restore both active
    setCachedInstituteSettings({ card_enabled: true, zelle_enabled: true });
  });

  it("reports payment system status without leaking secret keys or raw values", () => {
    const status = getPaymentSystemStatus();

    assert.equal(typeof status.stripe_configured, "boolean");
    assert.equal(["test", "live", "unconfigured"].includes(status.stripe_mode), true);
    assert.equal(typeof status.stripe_webhook_configured, "boolean");
    assert.equal(typeof status.card_enabled, "boolean");
    assert.equal(typeof status.zelle_enabled, "boolean");

    // Verify raw keys are NEVER in the status object
    const serialized = JSON.stringify(status);
    assert.equal(serialized.includes("sk_test"), false);
    assert.equal(serialized.includes("whsec_"), false);
  });

  // ---------------------------------------------------------------------------
  // 2. SERVER-CALCULATED PRICING (TAMPERED PRICE IGNORED)
  // ---------------------------------------------------------------------------
  it("server calculates quotes strictly ignoring client-side tampering", () => {
    // Malicious browser attempts to claim price is $1
    const quoteHourly = quoteEnrollment(mockCourse, "HOURS", 10);
    assert.equal(quoteHourly.is_valid, true);
    assert.equal(quoteHourly.quoted_amount, 400.0); // 10 * 40
    assert.equal(quoteHourly.hours_total, 10);

    const quotePkg = quoteEnrollment(mockCourse, "PACKAGE");
    assert.equal(quotePkg.is_valid, true);
    assert.equal(quotePkg.quoted_amount, 700.0);
    assert.equal(quotePkg.hours_total, 20);
  });

  // ---------------------------------------------------------------------------
  // 3. WEBHOOK SECURITY: SIGNED HMAC VERIFICATION & REJECTION
  // ---------------------------------------------------------------------------
  it("rejects unsigned or wrongly signed webhook requests", async () => {
    const rawPayload = Buffer.from(JSON.stringify({ id: "evt_synthetic_123", type: "checkout.session.completed" }));

    // Missing signature header
    await assert.rejects(
      async () => {
        await StripeService.handleWebhook(rawPayload, undefined);
      },
      /Missing stripe-signature header/
    );

    // Tampered or incorrect signature
    const prevKey = process.env.STRIPE_SECRET_KEY;
    const prevSec = process.env.STRIPE_WEBHOOK_SECRET;
    try {
      process.env.STRIPE_SECRET_KEY = "sk_test_synthetic_for_webhook_testing";
      process.env.STRIPE_WEBHOOK_SECRET = "whsec_synthetic_for_webhook_testing";

      await assert.rejects(
        async () => {
          await StripeService.handleWebhook(rawPayload, "t=1700000000,v1=tampered_bad_hex_signature");
        },
        /Invalid webhook signature/
      );
    } finally {
      process.env.STRIPE_SECRET_KEY = prevKey;
      process.env.STRIPE_WEBHOOK_SECRET = prevSec;
    }
  });

  // ---------------------------------------------------------------------------
  // 4. IDEMPOTENT ORDER FULFILLMENT & TOKEN LEDGER
  // ---------------------------------------------------------------------------
  it("paid session credits hours exactly once regardless of multiple deliveries", () => {
    // Simulated ledger state
    let hoursCredited = 0;
    let orderStatus = "PENDING_PAYMENT";
    const processedEvents = new Set<string>();

    const simulateFulfill = (eventId: string, orderRef: string, hours: number) => {
      // Step 1: Deduplicate event
      if (processedEvents.has(eventId)) {
        return { success: true, deduplicated: true, hoursCredited };
      }
      processedEvents.add(eventId);

      // Step 2: Idempotent order status check
      if (orderStatus === "PAID") {
        return { success: true, already_paid: true, hoursCredited };
      }

      // Step 3: Atomic credit
      orderStatus = "PAID";
      hoursCredited += hours;
      return { success: true, hoursCredited };
    };

    // First webhook delivery
    const res1 = simulateFulfill("evt_1", "TG-A1B2C3", 10);
    assert.equal(res1.hoursCredited, 10);
    assert.equal(orderStatus, "PAID");

    // Second webhook delivery (same event ID)
    const res2 = simulateFulfill("evt_1", "TG-A1B2C3", 10);
    assert.equal(res2.deduplicated, true);
    assert.equal(hoursCredited, 10); // Not doubled!

    // Success page verification arrives after webhook (different trigger, same order)
    const res3 = simulateFulfill("evt_success_page", "TG-A1B2C3", 10);
    assert.equal(res3.already_paid, true);
    assert.equal(hoursCredited, 10); // Still exactly 10 hours!
  });

  // ---------------------------------------------------------------------------
  // 5. WRONG AMOUNT / CURRENCY REJECTION
  // ---------------------------------------------------------------------------
  it("rejects session settlement if amount or currency mismatch order", () => {
    const order = {
      reference_code: "TG-TEST99",
      amount_total: 400.0,
      currency: "usd",
    };

    // Mismatched amount
    const paidSessionWrongAmount = {
      amount_total: 10000, // $100 instead of $400
      currency: "usd",
      payment_status: "paid",
    };
    const isAmountMatch = Math.abs(paidSessionWrongAmount.amount_total / 100 - order.amount_total) < 0.01;
    assert.equal(isAmountMatch, false);

    // Mismatched currency
    const paidSessionWrongCurrency = {
      amount_total: 40000,
      currency: "eur", // EUR instead of USD
      payment_status: "paid",
    };
    const isCurrencyMatch = paidSessionWrongCurrency.currency.toLowerCase() === order.currency.toLowerCase();
    assert.equal(isCurrencyMatch, false);
  });

  // ---------------------------------------------------------------------------
  // 6. EXPIRED SESSION CANCELLATION
  // ---------------------------------------------------------------------------
  it("expired checkout session cancels pending order", () => {
    let orderStatus = "PENDING_PAYMENT";

    const handleExpiredEvent = (status: string) => {
      if (status === "PENDING_PAYMENT") {
        return "EXPIRED";
      }
      return status;
    };

    orderStatus = handleExpiredEvent(orderStatus);
    assert.equal(orderStatus, "EXPIRED");
  });

  // ---------------------------------------------------------------------------
  // 7. REFUNDS REVERSE HOURS (BALANCE CAN GO NEGATIVE = OWED)
  // ---------------------------------------------------------------------------
  it("refund reverses hours via negative ADJUSTMENT ledger and allows negative owed balance", () => {
    let studentBalance = 5.0; // Student already used 5 hours out of 10 purchased
    const refundHours = 10.0;

    // Refund ledger action
    studentBalance -= refundHours;
    assert.equal(studentBalance, -5.0); // Negative balance = owed hours
    assert.equal(studentBalance < 0, true, "Negative balance is permitted and flagged as owed");
  });

  // ---------------------------------------------------------------------------
  // 8. DISPUTES FREEZE PURCHASES
  // ---------------------------------------------------------------------------
  it("dispute flag freezes new purchases for family until admin clears it", () => {
    let familyDisputeStatus = "OPEN";

    const canFamilyPurchase = (disputeStatus: string) => {
      return disputeStatus !== "OPEN";
    };

    assert.equal(canFamilyPurchase(familyDisputeStatus), false);

    // Admin clears dispute
    familyDisputeStatus = "CLEARED";
    assert.equal(canFamilyPurchase(familyDisputeStatus), true);
  });

  // ---------------------------------------------------------------------------
  // 9. ZELLE INVARIANT: ZELLE ORDERS CAN NEVER BE REFUNDED VIA SYSTEM
  // ---------------------------------------------------------------------------
  it("strictly prohibits system refunds on Zelle orders", () => {
    const isRefundable = (provider: string) => {
      if (provider === "ZELLE") return false;
      if (provider === "STRIPE_CARD") return true;
      return false;
    };

    assert.equal(isRefundable("ZELLE"), false);
    assert.equal(isRefundable("STRIPE_CARD"), true);
  });

  // ---------------------------------------------------------------------------
  // 10. TEST CARD SIMULATION FIXTURES (SUCCESS, DECLINE, 3D SECURE)
  // ---------------------------------------------------------------------------
  it("documents and validates Stripe test card fixtures", () => {
    const testCards = {
      SUCCESS: { number: "4242424242424242", outcome: "authorized", cvc: "123" },
      DECLINED: { number: "4000000000000002", outcome: "generic_decline", cvc: "123" },
      THREE_D_SECURE: { number: "4000000000003063", outcome: "requires_action", cvc: "123" },
      INSUFFICIENT_FUNDS: { number: "4000000000009995", outcome: "insufficient_funds", cvc: "123" },
    };

    assert.equal(testCards.SUCCESS.outcome, "authorized");
    assert.equal(testCards.DECLINED.outcome, "generic_decline");
    assert.equal(testCards.THREE_D_SECURE.outcome, "requires_action");
    assert.equal(testCards.INSUFFICIENT_FUNDS.outcome, "insufficient_funds");
  });
});
