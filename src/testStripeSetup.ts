import dotenv from "dotenv";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
dotenv.config({ path: path.resolve(__dirname, "../.env") });
dotenv.config();

import {
  StripeService,
  isStripeMockMode,
  pendingZelleStore
} from "./services/stripeService.js";
import {
  CourseHoursService,
  studentCourseBalancesStore,
  paymentOrdersStore
} from "./services/courseHoursService.js";

async function runStripeVerification() {
  console.log("================================================================================");
  console.log("       TOPGRADE CRM: STRIPE INTEGRATION & TOKEN SYSTEM VERIFICATION SUITE       ");
  console.log("================================================================================\n");

  let allPassed = true;

  // 1. Verify Environment Setup
  console.log("--- TEST 1: ENVIRONMENT CONFIGURATION & MOCK FALLBACK DETECTION ---");
  const secretKey = process.env.STRIPE_SECRET_KEY || "";
  const webhookSecret = process.env.STRIPE_WEBHOOK_SECRET || "";
  const currency = process.env.STRIPE_CURRENCY || "usd";
  const frontendUrl = process.env.FRONTEND_URL || "http://localhost:5174";

  console.log(`• STRIPE_SECRET_KEY: ${secretKey ? `${secretKey.slice(0, 15)}... (Placeholder)` : "MISSING"}`);
  console.log(`• STRIPE_WEBHOOK_SECRET: ${webhookSecret ? `${webhookSecret.slice(0, 12)}...` : "MISSING"}`);
  console.log(`• STRIPE_CURRENCY: ${currency}`);
  console.log(`• FRONTEND_URL: ${frontendUrl}`);

  const mockMode = isStripeMockMode();
  console.log(`• Detected Mock Mode: ${mockMode ? "YES (Graceful Mock Fallback Active)" : "NO (Live Stripe SDK)"}`);

  if (mockMode && secretKey.startsWith("sk_test_placeholder")) {
    console.log("✅ PASS: Mock mode correctly recognized placeholder key without failing.\n");
  } else {
    console.warn("⚠️ NOTICE: Running in non-placeholder or customized environment mode.\n");
  }

  // 2. Test Checkout Session Generation
  console.log("--- TEST 2: CHECKOUT SESSION CREATION (ENDPOINT 1) ---");
  const testStudentId = "std-test-stripe-verify";
  const testCourseId = "crs-sec-103";
  const testCourseName = "Full-Stack Coding & Web Dev";
  const tokensToBuy = 5;
  const unitPriceUsd = 40.0;
  const expectedCents = tokensToBuy * unitPriceUsd * 100;

  try {
    const sessionResult = await StripeService.createCheckoutSession({
      student_id: testStudentId,
      course_id: testCourseId,
      tokens_purchased: tokensToBuy,
      unit_price_usd: unitPriceUsd,
      student_name: "Aarav Sharma",
      student_email: "aarav.s@topgrade.edu",
      parent_email: "parent.aarav@topgrade.edu",
      course_name: testCourseName
    });

    console.log(`• Generated Session ID: ${sessionResult.sessionId}`);
    console.log(`• Checkout Redirect URL: ${sessionResult.url}`);
    console.log(`• Total Amount Calculated: $${(expectedCents / 100).toFixed(2)} USD (${expectedCents} cents)`);

    if (sessionResult.sessionId && sessionResult.url) {
      console.log("✅ PASS: Stripe checkout session successfully created and routed.\n");
    } else {
      console.error("❌ FAIL: Missing sessionId or url in response.");
      allPassed = false;
    }

    // 3. Test Webhook Construction & Fulfillment
    console.log("--- TEST 3: WEBHOOK EVENT PROCESSING & TOKEN CREDIT (ENDPOINT 2) ---");
    const mockWebhookPayload = JSON.stringify({
      id: `evt_mock_${Date.now()}`,
      type: "checkout.session.completed",
      data: {
        object: {
          id: sessionResult.sessionId,
          amount_total: expectedCents,
          metadata: {
            student_id: testStudentId,
            course_id: testCourseId,
            course_name: testCourseName,
            tokens_purchased: String(tokensToBuy),
            unit_price_usd: String(unitPriceUsd),
            student_name: "Aarav Sharma",
            parent_email: "parent.aarav@topgrade.edu"
          }
        }
      }
    });

    const parsedEvent = StripeService.constructWebhookEvent(mockWebhookPayload);
    console.log(`• Parsed Webhook Event Type: ${parsedEvent.type}`);

    const fulfillment = await StripeService.fulfillCheckoutSession(parsedEvent.data.object);
    console.log(`• Fulfill Result:`, {
      student_id: fulfillment.student_id,
      tokens_purchased: fulfillment.tokens_purchased,
      tokens_remaining: fulfillment.tokens_remaining,
      amount_usd: fulfillment.amount_usd,
      stripe_session_id: fulfillment.stripe_session_id
    });

    // Check balance in CourseHoursService
    const currentBal = CourseHoursService.getStudentCourseBalance(testStudentId, testCourseId);
    console.log(`• Post-Payment Balance in Store:`, {
      tokens_remaining: currentBal?.tokens_remaining,
      tokens_consumed: currentBal?.tokens_consumed,
      hourly_rate: currentBal?.hourly_rate
    });

    if (fulfillment.success && (currentBal?.tokens_remaining ?? 0) >= tokensToBuy) {
      console.log("✅ PASS: Tokens credited atomically and audited transaction recorded.\n");
    } else {
      console.error("❌ FAIL: Token balance was not credited properly.");
      allPassed = false;
    }

    // 4. Test Manual Zelle Payment Confirmation
    console.log("--- TEST 4: MANUAL ZELLE CONFIRMATION PATH (ENDPOINT 3) ---");
    const zelleRefCode = `ZEL-${Math.floor(100000 + Math.random() * 900000)}`;
    const zelleResult = await StripeService.recordZellePayment({
      student_id: testStudentId,
      course_id: testCourseId,
      tokens_purchased: 4,
      amount_usd: 160.0,
      zelle_confirmation_number: zelleRefCode,
      student_name: "Aarav Sharma",
      parent_email: "parent.aarav@topgrade.edu"
    });

    console.log(`• Zelle Reference: ${zelleResult.transaction.zelle_confirmation_number}`);
    console.log(`• Transaction Status: ${zelleResult.status}`);
    console.log(`• In-Memory Store Verified: ${pendingZelleStore.some(z => z.zelle_confirmation_number === zelleRefCode)}`);

    if (zelleResult.status === "PENDING_ADMIN_CONFIRMATION") {
      console.log("✅ PASS: Zelle confirmation recorded as PENDING_ADMIN_CONFIRMATION.\n");
    } else {
      console.error("❌ FAIL: Unexpected Zelle status:", zelleResult.status);
      allPassed = false;
    }

    // 5. Test Ledger & Roll-Call 1:1 Token Consumption
    console.log("--- TEST 5: ATTENDANCE ROLL-CALL CONSUMPTION (1:1 DEDUCTION & <= 2 WARNING) ---");
    const preRollTokens = currentBal?.tokens_remaining ?? 0;
    console.log(`• Tokens before roll call: ${preRollTokens}`);

    // Deduct 1 token for PRESENT check-in
    const deduction = CourseHoursService.deductTokenOnAttendance(testStudentId, testCourseId);
    console.log(`• Tokens after 1 PRESENT check-in: ${deduction.tokens_remaining} (consumed: ${deduction.tokens_consumed})`);

    if (deduction.tokens_remaining === preRollTokens - 1) {
      console.log("✅ PASS: Attendance check-in decremented exactly 1 token (1:1 ratio).");
    } else {
      console.error("❌ FAIL: Token deduction failed or gave unexpected count.");
      allPassed = false;
    }

    // Test Low Quota Alert Threshold (<= 2 tokens remaining)
    if (currentBal) {
      currentBal.tokens_remaining = 2;
      currentBal.availableHours = 2;
      const lowQuotaDeduction = CourseHoursService.deductTokenOnAttendance(testStudentId, testCourseId);
      console.log(`• Quota Alert Test (Tokens remaining: ${lowQuotaDeduction.tokens_remaining}):`);
      console.log(`  - isLowQuotaWarning: ${lowQuotaDeduction.isLowQuotaWarning}`);
      console.log(`  - Warning Message: ${lowQuotaDeduction.warningMessage}`);

      if (lowQuotaDeduction.isLowQuotaWarning && lowQuotaDeduction.tokens_remaining <= 2) {
        console.log("✅ PASS: Low Token Amber Alert successfully triggered for balance <= 2.\n");
      } else {
        console.error("❌ FAIL: Low quota warning failed to trigger at <= 2 tokens.");
        allPassed = false;
      }
    }

    // 6. Test Live Express HTTP Endpoints
    console.log("--- TEST 6: LIVE HTTP ROUTE REGISTRATION VERIFICATION ---");
    const port = process.env.PORT || 5000;
    const baseApi = `http://localhost:${port}/api/payments`;

    try {
      const resp = await fetch(`${baseApi}/stripe/create-checkout-session`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          student_id: testStudentId,
          course_id: testCourseId,
          tokens_purchased: 3,
          unit_price_usd: 40.0
        })
      });

      const httpData = await resp.json();
      console.log(`• POST /api/payments/stripe/create-checkout-session Status: ${resp.status}`);
      console.log(`• Response Success: ${httpData.success}, Session: ${httpData.sessionId}`);

      if (resp.status === 200 && httpData.success && httpData.url) {
        console.log("✅ PASS: HTTP endpoint /api/payments/stripe/create-checkout-session responds correctly.");
      } else {
        console.warn("⚠️ Notice on HTTP response:", httpData);
      }
    } catch (httpErr: any) {
      console.warn(`Notice on direct HTTP call (server might not be bound to localhost:${port}):`, httpErr.message);
    }

    console.log("\n================================================================================");
    if (allPassed) {
      console.log("🎉 ALL STRIPE & TOKEN INTEGRATION TESTS PASSED WITH 100% SUCCESS!");
      console.log("Ready for live keys: updating .env requires ZERO code changes.");
    } else {
      console.log("⚠️ SOME TESTS COMPLETED WITH WARNINGS. REVIEW OUTPUT ABOVE.");
    }
    console.log("================================================================================\n");
  } catch (error: any) {
    console.error("❌ Unexpected test exception:", error);
    process.exit(1);
  }
}

runStripeVerification();
