import { Router } from "express";
import type { Request, Response } from "express";
import { supabaseAdmin } from "../supabase.js";
import type { AuthenticatedRequest } from "../middleware/auth.js";
import { getAccessScope, allowsStudent } from "../services/accessScope.js";
import { ReceiptPdfService } from "../services/receiptPdfService.js";
import { getCachedInstituteSettings } from "../services/instituteSettingsService.js";
import {
  applyTokens,
  buildReceiptData,
  createOrder,
  findCourse,
  findOrder,
  findStudent,
  fulfillOrder,
  getBalances,
  getBalancesForStudents,
  getLedger,
  isUuid,
  tokenCurrency,
  MAX_TOKENS_PER_ORDER,
  LOW_TOKEN_LIMIT,
  type OrderRow,
} from "../services/tokenService.js";
import {
  BankReconciliationService,
  type BankCsvInputRow,
} from "../services/bankReconciliationService.js";
import { StripeService } from "../services/stripeService.js";
import { getAvailablePaymentMethods, getPaymentSystemStatus } from "../services/paymentProvider.js";
import { rateLimit } from "../middleware/rateLimit.js";

const router = Router();

const fail = (res: Response, err: any, fallback = 500) =>
  res.status(err?.status || fallback).json({ success: false, message: err?.message || "Something went wrong." });

const userOf = (req: Request) => (req as AuthenticatedRequest).user!;

// Helper to provide parent-safe Zelle payment instructions
function getZelleInstructions(order: OrderRow) {
  const s = getCachedInstituteSettings();
  return {
    zelle_display_name: s.zelle_display_name || s.institute_name,
    zelle_tag: s.zelle_tag || null,
    zelle_email: s.zelle_email || null,
    zelle_phone: s.zelle_phone || null,
    payment_instructions_note: s.payment_instructions_note || "Pay in your bank app using Zelle and write this code in the memo.",
    reference_code: order.reference_code || order.order_number,
    exact_amount: Number(order.amount_total),
    currency: "USD",
    memo_instruction: `Enter "${order.reference_code || order.order_number}" in your bank app Zelle memo field.`,
  };
}

// Rate limit: max 5 order creations per 10 minutes per IP/parent
const orderCreationRateLimit = rateLimit(5, 600_000);

// ───────────────────────── Payment Methods & System Status ─────────────────────────

/**
 * GET /api/payments/methods
 * Returns currently enabled and configured payment options for the order screen.
 * If neither card nor zelle is enabled, returns empty array.
 */
router.get("/methods", async (_req, res): Promise<any> => {
  try {
    const methods = getAvailablePaymentMethods();
    return res.json({
      success: true,
      methods,
      hasAvailableMethods: methods.length > 0,
      unavailableNotice: methods.length === 0 ? "Online payment is not available yet. Please contact the institute." : undefined,
    });
  } catch (err: any) {
    return fail(res, err);
  }
});

/**
 * GET /api/payments/system-status
 * Diagnostics endpoint for Admin settings (never exposes secrets).
 */
router.get("/system-status", async (_req, res): Promise<any> => {
  try {
    const status = getPaymentSystemStatus();
    return res.json({ success: true, status });
  } catch (err: any) {
    return fail(res, err);
  }
});

// ───────────────────────── Card Flow (Stripe Hosted Checkout) ─────────────────────────

/**
 * POST /api/payments/checkout-session
 * Creates an order with reference_code and redirects to hosted Stripe Checkout.
 * Price is calculated strictly on the SERVER via quoteEnrollment.
 */
router.post("/checkout-session", orderCreationRateLimit, async (req, res): Promise<any> => {
  try {
    const user = userOf(req);
    const { student_id, course_id, plan, quantity } = req.body || {};

    let targetStudentId = student_id;
    if (!targetStudentId && user.role === "STUDENT") {
      const scope = await getAccessScope(user);
      const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
      const myId = Array.from(scope.studentKeys).find(k => uuidRegex.test(k));
      if (myId) targetStudentId = myId;
    }

    if (!targetStudentId || !course_id) {
      return res.status(400).json({ success: false, message: "student_id and course_id are required." });
    }

    if (user.role !== "ADMIN") {
      const scope = await getAccessScope(user);
      if (!allowsStudent(scope, String(targetStudentId))) {
        return res.status(403).json({ success: false, message: "Forbidden: You may only purchase hours for yourself or your child." });
      }
    }

    const session = await StripeService.createCheckout({
      studentIdOrCode: String(targetStudentId),
      courseIdOrName: String(course_id),
      quantity: quantity !== undefined ? Number(quantity) : undefined,
      plan: plan === "PACKAGE" ? "PACKAGE" : "HOURS",
      payerEmail: user.email ?? null,
      by: user.id,
    });

    return res.status(201).json({
      success: true,
      url: session.url,
      sessionId: session.sessionId,
      orderNumber: session.orderNumber,
      referenceCode: session.referenceCode,
      amountTotal: session.amountTotal,
      currency: session.currency,
    });
  } catch (err: any) {
    return fail(res, err, 400);
  }
});

/**
 * POST /api/payments/verify-session
 * Return page verifies session with Stripe directly and credits hours once.
 */
router.post("/verify-session", rateLimit(30, 60_000), async (req, res): Promise<any> => {
  try {
    const { session_id } = req.body || {};
    if (!session_id) {
      return res.status(400).json({ success: false, message: "session_id is required." });
    }

    const result = await StripeService.verifySession(String(session_id));
    return res.json({
      success: true,
      paid: result.paid,
      credited: result.credited,
      balance: result.balance,
      order: result.order,
    });
  } catch (err: any) {
    return fail(res, err, 400);
  }
});

/**
 * POST /api/payments/stripe-webhook
 * Public signed webhook for Stripe events. Rate limited, validates stripe-signature.
 */
router.post("/stripe-webhook", async (req, res): Promise<any> => {
  try {
    const rawBody = (req as any).rawBody || req.body;
    const sig = req.headers["stripe-signature"];
    const outcome = await StripeService.handleWebhook(rawBody, sig);
    return res.json({ received: true, ...outcome });
  } catch (err: any) {
    return res.status(err?.status || 400).json({ error: err?.message || "Webhook error" });
  }
});

// ───────────────────────── Zelle Orders (Parent & Admin) ─────────────────────────

/**
 * POST /api/payments/zelle-order
 * Parent creates a pending Zelle order for their child.
 * Price is calculated strictly on the SERVER via quoteEnrollment.
 * The browser sends only: student_id, course_id, plan, and quantity/hours.
 */
router.post("/zelle-order", orderCreationRateLimit, async (req, res): Promise<any> => {
  try {
    const user = userOf(req);
    const { student_id, course_id, plan, quantity } = req.body || {};

    let targetStudentId = student_id;
    if (!targetStudentId && user.role === "STUDENT") {
      const scope = await getAccessScope(user);
      const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
      const myId = Array.from(scope.studentKeys).find(k => uuidRegex.test(k));
      if (myId) targetStudentId = myId;
    }

    if (!targetStudentId || !course_id) {
      return res.status(400).json({ success: false, message: "student_id and course_id are required." });
    }

    // Verify parent or student has access to this student
    if (user.role !== "ADMIN") {
      const scope = await getAccessScope(user);
      if (!allowsStudent(scope, String(targetStudentId))) {
        return res.status(403).json({ success: false, message: "Forbidden: You may only purchase hours for yourself or your child." });
      }
    }

    const { order, student, course } = await createOrder({
      studentIdOrCode: String(targetStudentId),
      courseIdOrName: String(course_id),
      plan: plan === "PACKAGE" ? "PACKAGE" : "HOURS",
      quantity: quantity !== undefined ? Number(quantity) : undefined,
      provider: "ZELLE",
      status: "PENDING_PAYMENT",
      payerEmail: user.email ?? null,
      by: user.id,
    });

    // Send instructions email (simulated in test mode)
    void BankReconciliationService.dispatchOrderCreatedEmail(order, student);

    return res.status(201).json({
      success: true,
      message: "Order placed. Please send Zelle payment from your bank app.",
      order,
      zelle: getZelleInstructions(order),
    });
  } catch (err: any) {
    return fail(res, err, 400);
  }
});

// ───────────────────────── Orders Queries ─────────────────────────

/**
 * GET /api/payments/orders
 * Admin sees all orders; Parents see only their own children's orders.
 * Supports filtering by method/provider, status, dispute status, and date range.
 */
router.get("/orders", async (req, res): Promise<any> => {
  try {
    const user = userOf(req);
    let q = supabaseAdmin.from("token_orders").select("*").order("created_at", { ascending: false }).limit(500);

    if (req.query.status) {
      q = q.eq("status", String(req.query.status).toUpperCase());
    }

    if (req.query.provider) {
      const p = String(req.query.provider).toUpperCase();
      if (p === "CARD" || p === "STRIPE") {
        q = q.in("provider", ["STRIPE", "STRIPE_CARD"]);
      } else {
        q = q.eq("provider", p);
      }
    }

    if (req.query.dispute === "true" || req.query.dispute_status === "DISPUTED") {
      q = q.eq("dispute_status", "DISPUTED");
    }

    if (req.query.startDate) {
      q = q.gte("created_at", String(req.query.startDate));
    }
    if (req.query.endDate) {
      q = q.lte("created_at", String(req.query.endDate));
    }

    if (user.role !== "ADMIN") {
      const scope = await getAccessScope(user);
      const ids = Array.from(scope.studentKeys).filter(isUuid);
      if (ids.length === 0) return res.json({ success: true, data: [] });
      q = q.in("student_id", ids);
    }

    const { data, error } = await q;
    if (error) throw new Error(error.message);
    const rows = (data || []) as OrderRow[];

    const studentIds = Array.from(new Set(rows.map(r => r.student_id)));
    const { data: students } = studentIds.length
      ? await supabaseAdmin.from("students").select("id, name, student_id_code").in("id", studentIds)
      : { data: [] as any[] };
    const nameOf = new Map<string, any>((students || []).map((s: any) => [s.id, s]));

    const enriched = rows.map(r => {
      const stu = nameOf.get(r.student_id);
      return {
        ...r,
        student_name: stu?.name || "",
        student_code: stu?.student_id_code || "",
        zelle: r.provider === "ZELLE" && r.status === "PENDING_PAYMENT" ? getZelleInstructions(r) : undefined,
      };
    });

    return res.json({ success: true, data: enriched });
  } catch (err: any) {
    return fail(res, err);
  }
});

/**
 * POST /api/payments/stripe-refund
 * Admin issues a full or partial refund for a card order with mandatory reason.
 * Zelle orders are strictly blocked.
 */
router.post("/stripe-refund", async (req, res): Promise<any> => {
  try {
    const user = userOf(req);
    if (user.role !== "ADMIN") {
      return res.status(403).json({ success: false, message: "Forbidden: Admin access required." });
    }

    const { order_id, amount, reason } = req.body || {};
    if (!order_id || !reason) {
      return res.status(400).json({ success: false, message: "order_id and a mandatory reason are required." });
    }

    const result = await StripeService.processRefund({
      orderId: String(order_id),
      amount: amount !== undefined ? Number(amount) : undefined,
      reason: String(reason),
      adminId: user.id,
    });

    return res.json({
      message: `Refund of $${result.refundedAmount.toFixed(2)} processed. ${result.hoursDeducted} hour(s) deducted from student balance.`,
      ...result,
    });
  } catch (err: any) {
    return fail(res, err, 400);
  }
});

/**
 * POST /api/payments/resolve-dispute
 * Admin clears a payment dispute flag after resolution with cardholder.
 */
router.post("/resolve-dispute", async (req, res): Promise<any> => {
  try {
    const user = userOf(req);
    if (user.role !== "ADMIN") {
      return res.status(403).json({ success: false, message: "Forbidden: Admin access required." });
    }

    const { order_id, note } = req.body || {};
    if (!order_id) {
      return res.status(400).json({ success: false, message: "order_id is required." });
    }

    const result = await StripeService.resolveDispute({
      orderId: String(order_id),
      note: String(note || "Resolved by administrator"),
      adminId: user.id,
    });

    return res.json({
      success: true,
      message: "Dispute cleared. Family purchase privileges have been restored.",
    });
  } catch (err: any) {
    return fail(res, err, 400);
  }
});

/**
 * GET /api/payments/daily-summary
 * Aggregates daily payment totals separated by Card and Zelle.
 * Admin only.
 */
router.get("/daily-summary", async (req, res): Promise<any> => {
  try {
    const user = userOf(req);
    if (user.role !== "ADMIN") {
      return res.status(403).json({ success: false, message: "Admin access required." });
    }

    const { data, error } = await supabaseAdmin
      .from("token_orders")
      .select("created_at, paid_at, amount_total, amount_received, refunded_amount, provider, status")
      .in("status", ["PAID", "PARTIAL", "REFUNDED"])
      .order("created_at", { ascending: false });

    if (error) throw new Error(error.message);

    const summaryMap = new Map<string, {
      date: string;
      cardOrdersCount: number;
      cardGrossAmount: number;
      cardRefundedAmount: number;
      cardNetAmount: number;
      zelleOrdersCount: number;
      zelleGrossAmount: number;
      totalNetRevenue: number;
    }>();

    for (const row of (data || []) as any[]) {
      const dateStr = (row.paid_at || row.created_at || "").slice(0, 10);
      if (!dateStr) continue;

      if (!summaryMap.has(dateStr)) {
        summaryMap.set(dateStr, {
          date: dateStr,
          cardOrdersCount: 0,
          cardGrossAmount: 0,
          cardRefundedAmount: 0,
          cardNetAmount: 0,
          zelleOrdersCount: 0,
          zelleGrossAmount: 0,
          totalNetRevenue: 0,
        });
      }

      const item = summaryMap.get(dateStr)!;
      const isCard = row.provider === "STRIPE" || row.provider === "STRIPE_CARD";
      const amt = Number(row.amount_received ?? row.amount_total) || 0;
      const refund = Number(row.refunded_amount) || 0;

      if (isCard) {
        item.cardOrdersCount++;
        item.cardGrossAmount += amt;
        item.cardRefundedAmount += refund;
        item.cardNetAmount += (amt - refund);
      } else {
        item.zelleOrdersCount++;
        item.zelleGrossAmount += amt;
      }
      item.totalNetRevenue = item.cardNetAmount + item.zelleGrossAmount;
    }

    const dailySummary = Array.from(summaryMap.values()).sort((a, b) => b.date.localeCompare(a.date));
    return res.json({ success: true, data: dailySummary });
  } catch (err: any) {
    return fail(res, err);
  }
});

/**
 * GET /api/payments/orders/:id
 * Fetches single order details and instructions.
 */
router.get("/orders/:id", async (req, res): Promise<any> => {
  try {
    const user = userOf(req);
    const order = await findOrder(String(req.params.id));
    if (!order) return res.status(404).json({ success: false, message: "Order not found." });

    if (user.role !== "ADMIN") {
      const scope = await getAccessScope(user);
      if (!allowsStudent(scope, order.student_id)) {
        return res.status(403).json({ success: false, message: "Forbidden: This order belongs to another family." });
      }
    }

    const student = await findStudent(order.student_id);

    return res.json({
      success: true,
      order: {
        ...order,
        student_name: student?.name || "",
        student_code: student?.code || "",
      },
      zelle: getZelleInstructions(order),
    });
  } catch (err: any) {
    return fail(res, err);
  }
});

/**
 * POST /api/payments/orders/:id/cancel
 * Parent can cancel their own pending order; admin can cancel any pending order.
 */
router.post("/orders/:id/cancel", async (req, res): Promise<any> => {
  try {
    const user = userOf(req);
    const order = await findOrder(String(req.params.id));
    if (!order) return res.status(404).json({ success: false, message: "Order not found." });

    if (user.role !== "ADMIN") {
      const scope = await getAccessScope(user);
      if (!allowsStudent(scope, order.student_id)) {
        return res.status(403).json({ success: false, message: "Forbidden: Access denied." });
      }
    }

    if (order.status !== "PENDING_PAYMENT" && order.status !== "PENDING") {
      return res.status(400).json({ success: false, message: `Cannot cancel an order that is ${order.status.toLowerCase()}.` });
    }

    await supabaseAdmin
      .from("token_orders")
      .update({ status: "CANCELLED", mismatch_note: String(req.body?.reason || "Cancelled by user").slice(0, 300) })
      .eq("id", order.id);

    return res.json({ success: true, message: "Order cancelled." });
  } catch (err: any) {
    return fail(res, err);
  }
});

/**
 * POST /api/payments/orders/:id/resend-instructions
 * Resends Zelle payment instructions to the parent.
 */
router.post("/orders/:id/resend-instructions", async (req, res): Promise<any> => {
  try {
    const user = userOf(req);
    const order = await findOrder(String(req.params.id));
    if (!order) return res.status(404).json({ success: false, message: "Order not found." });

    if (user.role !== "ADMIN") {
      const scope = await getAccessScope(user);
      if (!allowsStudent(scope, order.student_id)) {
        return res.status(403).json({ success: false, message: "Forbidden." });
      }
    }

    const student = await findStudent(order.student_id);
    if (!student) return res.status(404).json({ success: false, message: "Student record not found." });

    await BankReconciliationService.dispatchOrderCreatedEmail(order, student);
    return res.json({ success: true, message: "Payment instructions re-sent." });
  } catch (err: any) {
    return fail(res, err);
  }
});

// ───────────────────────── Admin Reconciliation Endpoints ─────────────────────────

/**
 * GET /api/payments/reconciliation/suggestions
 * Auto-suggests matches between pending orders and unmatched bank transactions.
 * Admin only.
 */
router.get("/reconciliation/suggestions", async (req, res): Promise<any> => {
  try {
    const user = userOf(req);
    if (user.role !== "ADMIN") return res.status(403).json({ success: false, message: "Admin access required." });

    const suggestions = await BankReconciliationService.getMatchSuggestions();
    return res.json({ success: true, data: suggestions });
  } catch (err: any) {
    return fail(res, err);
  }
});

/**
 * GET /api/payments/reconciliation/unmatched-bank
 * Lists unmatched bank transactions imported from statements.
 * Admin only.
 */
router.get("/reconciliation/unmatched-bank", async (req, res): Promise<any> => {
  try {
    const user = userOf(req);
    if (user.role !== "ADMIN") return res.status(403).json({ success: false, message: "Admin access required." });

    const { data, error } = await supabaseAdmin
      .from("bank_transactions")
      .select("*")
      .eq("status", "UNMATCHED")
      .order("transaction_date", { ascending: false })
      .limit(200);

    if (error) throw new Error(error.message);
    return res.json({ success: true, data: data || [] });
  } catch (err: any) {
    return fail(res, err);
  }
});

/**
 * POST /api/payments/reconciliation/import-csv
 * Safe in-memory CSV import of bank statements.
 * Enforces size limit, neutralizes formula injection, stores deduplicated rows.
 * Admin only.
 */
router.post("/reconciliation/import-csv", async (req, res): Promise<any> => {
  try {
    const user = userOf(req);
    if (user.role !== "ADMIN") return res.status(403).json({ success: false, message: "Admin access required." });

    const { csvText, mapping } = req.body || {};
    if (!csvText || typeof csvText !== "string") {
      return res.status(400).json({ success: false, message: "CSV content is required." });
    }

    const defaultMapping = {
      date: mapping?.date || "Date",
      amount: mapping?.amount || "Amount",
      sender: mapping?.sender || "Sender",
      memo: mapping?.memo || "Memo",
      bankTxId: mapping?.bankTxId || "Transaction ID",
    };

    const result = await BankReconciliationService.importBankCsv(csvText, defaultMapping, user.id);
    return res.json({ success: true, ...result });
  } catch (err: any) {
    return fail(res, err, 400);
  }
});

/**
 * POST /api/payments/reconciliation/confirm
 * Admin confirms match (either from bank file or manual entry).
 * In one atomic transaction: marks order PAID/PARTIAL, links bank transaction, credits hours once.
 * Admin only.
 */
router.post("/reconciliation/confirm", async (req, res): Promise<any> => {
  try {
    const user = userOf(req);
    if (user.role !== "ADMIN") return res.status(403).json({ success: false, message: "Admin access required." });

    const {
      orderId,
      bankTransactionId,
      amountReceived,
      isPartial,
      creditHours,
      mismatchNote,
      isManual,
    } = req.body || {};

    if (!orderId || amountReceived === undefined) {
      return res.status(400).json({ success: false, message: "orderId and amountReceived are required." });
    }

    const result = await BankReconciliationService.confirmPayment({
      orderId: String(orderId),
      bankTransactionId: bankTransactionId ? String(bankTransactionId) : null,
      adminId: user.id,
      amountReceived: Number(amountReceived),
      isPartial: Boolean(isPartial),
      creditHours: creditHours !== undefined && creditHours !== null ? Number(creditHours) : null,
      mismatchNote: mismatchNote ? String(mismatchNote).trim() : null,
      isManual: Boolean(isManual),
    });

    return res.json(result);
  } catch (err: any) {
    return fail(res, err, 400);
  }
});

/**
 * POST /api/payments/orders/:id/confirm
 * Alias route for confirming an individual order.
 */
router.post("/orders/:id/confirm", async (req, res): Promise<any> => {
  try {
    const user = userOf(req);
    if (user.role !== "ADMIN") return res.status(403).json({ success: false, message: "Admin access required." });

    const order = await findOrder(String(req.params.id));
    if (!order) return res.status(404).json({ success: false, message: "Order not found." });

    const amountReceived = req.body?.amountReceived !== undefined ? Number(req.body.amountReceived) : Number(order.amount_total);
    const result = await BankReconciliationService.confirmPayment({
      orderId: order.id,
      bankTransactionId: req.body?.bankTransactionId ? String(req.body.bankTransactionId) : null,
      adminId: user.id,
      amountReceived,
      isPartial: Boolean(req.body?.isPartial),
      creditHours: req.body?.creditHours !== undefined ? Number(req.body.creditHours) : null,
      mismatchNote: req.body?.note ? String(req.body.note) : null,
      isManual: Boolean(req.body?.isManual || !req.body?.bankTransactionId),
    });

    return res.json(result);
  } catch (err: any) {
    return fail(res, err, 400);
  }
});

/**
 * POST /api/payments/orders/:id/reject
 * Admin rejects an order with mandatory reason.
 */
router.post("/orders/:id/reject", async (req, res): Promise<any> => {
  try {
    const user = userOf(req);
    if (user.role !== "ADMIN") return res.status(403).json({ success: false, message: "Admin access required." });

    const reason = String(req.body?.note || req.body?.reason || "").trim();
    if (!reason) return res.status(400).json({ success: false, message: "A reason is required to reject an order." });

    await BankReconciliationService.rejectOrder(String(req.params.id), reason, user.id);
    return res.json({ success: true, message: "Order rejected." });
  } catch (err: any) {
    return fail(res, err, 400);
  }
});

/**
 * GET /api/payments/reconciliation/report
 * Exports daily reconciliation report in JSON, CSV, or Excel format.
 * Admin only.
 */
router.get("/reconciliation/report", async (req, res): Promise<any> => {
  try {
    const user = userOf(req);
    if (user.role !== "ADMIN") return res.status(403).json({ success: false, message: "Admin access required." });

    const format = String(req.query.format || "json").toLowerCase();
    const report = await BankReconciliationService.generateReconciliationReport();

    if (format === "csv") {
      res.setHeader("Content-Type", "text/csv");
      res.setHeader("Content-Disposition", 'attachment; filename="reconciliation_report.csv"');
      return res.send(report.csvContent);
    }

    if (format === "excel" || format === "xlsx") {
      res.setHeader("Content-Type", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet");
      res.setHeader("Content-Disposition", 'attachment; filename="reconciliation_report.xlsx"');
      return res.send(report.excelBuffer);
    }

    return res.json({ success: true, summary: report.summary, csvContent: report.csvContent });
  } catch (err: any) {
    return fail(res, err);
  }
});

// ───────────────────────── Staff Manual Credit & Corrections ─────────────────────────

// Cash, bank transfer, cheque: the admin records it and the tokens are added.
router.post("/manual-credit", async (req, res): Promise<any> => {
  try {
    const user = userOf(req);
    if (user.role !== "ADMIN") return res.status(403).json({ success: false, message: "Admin access required." });

    const { student_id, course_id, quantity, method, reference, note } = req.body || {};
    const provider = String(method || "OTHER").toUpperCase();
    if (!["ZELLE", "CASH", "BANK_TRANSFER", "CHEQUE", "OTHER"].includes(provider)) {
      return res.status(400).json({ success: false, message: "Method must be CASH, BANK_TRANSFER, CHEQUE, ZELLE or OTHER." });
    }

    const { order } = await createOrder({
      studentIdOrCode: String(student_id || ""),
      courseIdOrName: String(course_id || ""),
      quantity: Number(quantity || 1),
      provider,
      providerRef: reference ? String(reference).trim() : null,
      status: "PENDING_PAYMENT",
      note: note ? String(note).slice(0, 300) : null,
      by: user.id,
    });

    const r = await fulfillOrder(order, user.id);
    return res.status(201).json({
      success: true,
      message: `${order.quantity} hour(s) added for ${order.course_name}.`,
      balance: r.balance,
      order,
    });
  } catch (err: any) {
    return fail(res, err, 400);
  }
});

// Correction (for example an attendance adjustment, refund or mistake). Needs a mandatory note.
router.post("/adjust", async (req, res): Promise<any> => {
  try {
    const user = userOf(req);
    if (user.role !== "ADMIN") return res.status(403).json({ success: false, message: "Admin access required." });

    const { student_id, course_id, delta, note } = req.body || {};
    const d = Math.trunc(Number(delta));
    if (!Number.isFinite(d) || d === 0 || Math.abs(d) > 500) {
      return res.status(400).json({ success: false, message: "delta must be a whole number between -500 and 500, not 0." });
    }
    if (!String(note || "").trim()) {
      return res.status(400).json({ success: false, message: "A note is required for a correction." });
    }
    const student = await findStudent(String(student_id || ""));
    const course = await findCourse(String(course_id || ""));
    if (!student || !course) return res.status(404).json({ success: false, message: "Student or course not found." });

    const r = await applyTokens({
      studentId: student.id,
      courseId: course.id,
      delta: d,
      reason: "ADJUSTMENT",
      note: String(note).slice(0, 300),
      by: user.id,
    });

    return res.json({ success: true, balance: r.balance });
  } catch (err: any) {
    return fail(res, err, 400);
  }
});

// ───────────────────────── Balances, Ledger, Roster, Receipt ─────────────────────────

router.get("/balance/:studentId", async (req, res): Promise<any> => {
  try {
    const wallets = await getBalances(String(req.params.studentId));
    const courseKey = String(req.query.courseId || "").trim().toLowerCase();
    const picked = courseKey
      ? wallets.filter(w => w.courseId.toLowerCase() === courseKey || w.courseName.toLowerCase() === courseKey)
      : wallets;
    const remaining = picked.reduce((n, w) => n + w.balance, 0);
    const used = picked.reduce((n, w) => n + w.totalUsed, 0);
    const first = picked[0];

    return res.json({
      success: true,
      data: {
        tokens_remaining: remaining,
        tokens_consumed: used,
        hourly_rate: first?.pricePerToken ?? 0,
        isLowQuota: remaining <= LOW_TOKEN_LIMIT,
        teacherWarningMessage:
          remaining < 0
            ? `Hours owed: ${-remaining}. Please purchase hours.`
            : remaining <= LOW_TOKEN_LIMIT
            ? `Low hours: ${remaining} class(es) left.`
            : undefined,
      },
      courses: wallets,
    });
  } catch (err: any) {
    return fail(res, err);
  }
});

router.get("/ledger/:studentId", async (req, res): Promise<any> => {
  try {
    return res.json({ success: true, data: await getLedger(String(req.params.studentId)) });
  } catch (err: any) {
    return fail(res, err);
  }
});

// Teacher: balances of students in their own classes. Admin: everyone.
router.get("/teacher-roster", async (req, res): Promise<any> => {
  try {
    const user = userOf(req);
    let ids: string[];
    if (user.role === "ADMIN") {
      const { data } = await supabaseAdmin.from("token_wallets").select("student_id");
      ids = Array.from(new Set((data || []).map((r: any) => r.student_id as string)));
    } else {
      ids = Array.from((await getAccessScope(user)).studentKeys).filter(isUuid);
    }
    const rows = await getBalancesForStudents(ids);
    return res.json({
      success: true,
      data: rows.map(r => ({
        ...r,
        tokens_remaining: r.balance,
        availableHours: r.balance,
        remainingClassesText: r.owed ? `${-r.balance} hour(s) owed` : `${r.balance} hours remaining`,
        isLowQuotaWarning: r.low,
      })),
    });
  } catch (err: any) {
    return fail(res, err);
  }
});

router.get("/receipt/:orderId/html", async (req, res): Promise<any> => {
  try {
    const order = await findOrder(String(req.params.orderId));
    if (!order) return res.status(404).send("Receipt not found.");
    if (order.status !== "PAID" && order.status !== "PARTIAL") {
      return res.status(400).send("This order is not paid yet.");
    }
    const student = await findStudent(order.student_id);
    if (!student) return res.status(404).send("Student not found.");
    return res.type("html").send(ReceiptPdfService.generateReceiptHtml(buildReceiptData(order, student)));
  } catch (err: any) {
    return res.status(500).send(err?.message || "Could not build receipt.");
  }
});

// ───────────────────────── Future Bank Integration Webhook ─────────────────────────
/**
 * POST /api/payments/bank-webhook
 * Contract for direct bank integration (e.g. Plaid, Teller, bank direct feed).
 * Inserts bank_transactions rows and suggests matches.
 * NEVER auto-confirms UNLESS auto_confirm_strong_matches setting is true and match is strong.
 */
router.post("/bank-webhook", async (req, res): Promise<any> => {
  try {
    const payload = req.body || {};
    const items = Array.isArray(payload) ? payload : (payload.transactions || [payload]);

    const settings = getCachedInstituteSettings();
    const autoConfirm = Boolean(settings.auto_confirm_strong_matches);

    let inserted = 0;
    const autoConfirmedOrders: string[] = [];

    for (const item of items) {
      const date = item.date || item.transaction_date || new Date().toISOString().slice(0, 10);
      const amount = Math.abs(Number(item.amount || 0));
      const sender = String(item.sender || item.sender_name || "").trim();
      const memo = String(item.memo || item.description || "").trim();
      const txId = item.id || item.transaction_id || item.bank_tx_id || null;

      if (amount <= 0) continue;

      const hash = BankReconciliationService.computeRowHash(date, amount, sender, memo);

      const { data: newTx, error } = await supabaseAdmin.from("bank_transactions").insert({
        bank_tx_id: txId,
        transaction_date: date,
        amount,
        sender_name: sender,
        memo,
        row_hash: hash,
        status: "UNMATCHED",
        imported_by: "BANK_WEBHOOK",
        raw_data: item,
      }).select("id").maybeSingle();

      if (!error && newTx) {
        inserted++;

        // Only auto-confirm if explicitly enabled by admin
        if (autoConfirm) {
          // Check for exact amount + reference code match within validity
          const { data: matchedOrder } = await supabaseAdmin
            .from("token_orders")
            .select("*")
            .eq("status", "PENDING_PAYMENT")
            .gt("expires_at", new Date().toISOString())
            .maybeSingle();

          if (matchedOrder && matchedOrder.reference_code && memo.toUpperCase().includes(matchedOrder.reference_code.toUpperCase())) {
            if (Math.abs(Number(matchedOrder.amount_total) - amount) < 0.01) {
              await BankReconciliationService.confirmPayment({
                orderId: matchedOrder.id,
                bankTransactionId: newTx.id,
                adminId: "AUTO_CONFIRM_WEBHOOK",
                amountReceived: amount,
              });
              autoConfirmedOrders.push(matchedOrder.order_number);
            }
          }
        }
      }
    }

    return res.status(200).json({
      received: true,
      inserted,
      autoConfirmedOrders,
    });
  } catch (err: any) {
    return res.status(400).json({ received: false, message: err?.message || "Invalid payload." });
  }
});

// Legacy removed routes
const removed = (_req: Request, res: Response) =>
  res.status(410).json({ success: false, message: "This payment route is deprecated. Use the bank-verified Zelle payment flow." });
router.all(["/settle", "/manual/zelle-confirm", "/zelle-request"], removed);

export default router;
