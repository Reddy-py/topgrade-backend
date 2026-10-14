import { Router } from "express";
import type { Request, Response } from "express";
import { supabaseAdmin } from "../supabase.js";
import type { AuthenticatedRequest } from "../middleware/auth.js";
import { getAccessScope, allowsStudent } from "../services/accessScope.js";
import { StripeService, isStripeConfigured, isMockAllowed } from "../services/stripeService.js";
import { ReceiptPdfService } from "../services/receiptPdfService.js";
import { dispatchMultiChannelNotification } from "../services/notificationService.js";
import {
  applyTokens, buildReceiptData, createOrder, findCourse, findOrder, findStudent, fulfillOrder,
  getBalances, getBalancesForStudents, getLedger, isUuid, tokenCurrency, MAX_TOKENS_PER_ORDER, LOW_TOKEN_LIMIT,
} from "../services/tokenService.js";

const router = Router();

const fail = (res: Response, err: any, fallback = 500) =>
  res.status(err?.status || fallback).json({ success: false, message: err?.message || "Something went wrong." });

const userOf = (req: Request) => (req as AuthenticatedRequest).user!;

// ───────────────────────── Stripe (card) ─────────────────────────

// Parent buys tokens. The browser sends who, which course and how many. The price is calculated here.
router.post("/stripe/create-checkout-session", async (req, res): Promise<any> => {
  try {
    const user = userOf(req);
    const { student_id, course_id, quantity, tokens_purchased } = req.body || {};
    if (!student_id || !course_id) return res.status(400).json({ success: false, message: "student_id and course_id are required." });
    const s = await StripeService.createCheckout({
      studentIdOrCode: String(student_id), courseIdOrName: String(course_id),
      quantity: Number(quantity ?? tokens_purchased ?? 1), payerEmail: user.email ?? null, by: user.id,
    });
    return res.status(200).json({
      success: true, sessionId: s.sessionId, url: s.url, isMock: s.isMock,
      orderNumber: s.orderNumber, amountTotal: s.amountTotal, currency: s.currency,
    });
  } catch (err: any) { return fail(res, err, 400); }
});

// Signed by Stripe. Public, but anything not signed correctly is rejected.
router.post("/stripe/webhook", async (req, res): Promise<any> => {
  try {
    const raw = (req as any).rawBody || Buffer.from(JSON.stringify(req.body || {}));
    const r = await StripeService.handleWebhook(raw, req.headers["stripe-signature"]);
    return res.status(200).json({ received: true, ...r });
  } catch (err: any) {
    return res.status(err?.status || 400).json({ received: false, message: err?.message || "Invalid webhook." });
  }
});

// The return page asks this after Stripe sends the parent back. Safe to repeat.
router.get("/stripe/verify-session", async (req, res): Promise<any> => {
  try {
    const sessionId = String(req.query.session_id || "");
    if (!sessionId) return res.status(400).json({ success: false, message: "session_id is required." });
    const order = await findOrder(sessionId);
    if (!order) return res.status(404).json({ success: false, message: "Payment not found." });
    const scope = await getAccessScope(userOf(req));
    if (!allowsStudent(scope, order.student_id)) return res.status(403).json({ success: false, message: "Forbidden: this payment belongs to another student." });
    const r = await StripeService.verifySession(sessionId);
    return res.status(200).json({ success: true, paid: r.paid, credited: r.credited, balance: r.balance, order: r.order });
  } catch (err: any) { return fail(res, err, 400); }
});

router.get("/stripe/status", (_req, res) => {
  res.json({
    success: true, configured: isStripeConfigured(), webhookSecretSet: !!process.env.STRIPE_WEBHOOK_SECRET,
    mockAllowed: isMockAllowed(), currency: tokenCurrency(), maxTokensPerOrder: MAX_TOKENS_PER_ORDER,
  });
});

// ───────────────────────── Zelle (parent reports, admin confirms) ─────────────────────────

router.post("/zelle-request", async (req, res): Promise<any> => {
  try {
    const user = userOf(req);
    const { student_id, course_id, quantity, zelle_confirmation_number } = req.body || {};
    const refCode = String(zelle_confirmation_number || "").trim();
    if (!student_id || !course_id) return res.status(400).json({ success: false, message: "student_id and course_id are required." });
    if (refCode.length < 4) return res.status(400).json({ success: false, message: "Enter the Zelle confirmation code." });
    const { order, student } = await createOrder({
      studentIdOrCode: String(student_id), courseIdOrName: String(course_id), quantity: Number(quantity || 1),
      provider: "ZELLE", providerRef: refCode.toUpperCase(), status: "PENDING", payerEmail: user.email ?? null, by: user.id,
    });
    void dispatchMultiChannelNotification({
      eventType: "ADMISSION_APPROVED",
      subject: `Zelle payment to confirm: ${student.name} (${order.order_number})`,
      message: `A parent reported a Zelle payment.\n\nStudent: ${student.name} (${student.code})\nCourse: ${order.course_name}\nTokens: ${order.quantity}\nAmount due: ${order.amount_total} ${order.currency.toUpperCase()}\nZelle code: ${refCode.toUpperCase()}\n\nCheck your bank, then confirm or reject it in the Fees page.`,
      escapeMessage: true,
      recipients: [{ role: "ADMIN", email: process.env.ADMIN_EMAIL || "tglbiz101@gmail.com", name: "Administrator", phone: "" }],
    }).catch(() => undefined);
    return res.status(201).json({ success: true, message: "Thank you. The institute will confirm your payment and add the tokens.", order });
  } catch (err: any) {
    const msg = String(err?.message || "");
    return fail(res, msg.includes("duplicate") || err?.code === "23505" ? Object.assign(err, { message: "This Zelle code was already submitted." }) : err, 400);
  }
});

// ───────────────────────── Admin: orders, manual credit, corrections ─────────────────────────

router.get("/orders", async (req, res): Promise<any> => {
  try {
    const user = userOf(req);
    let q = supabaseAdmin.from("token_orders").select("*").order("created_at", { ascending: false }).limit(300);
    if (req.query.status) q = q.eq("status", String(req.query.status).toUpperCase());
    if (user.role !== "ADMIN") {
      const scope = await getAccessScope(user);
      const ids = Array.from(scope.studentKeys).filter(isUuid);
      if (ids.length === 0) return res.json({ success: true, data: [] });
      q = q.in("student_id", ids);
    }
    const { data, error } = await q;
    if (error) throw new Error(error.message);
    const rows = (data || []) as any[];
    const studentIds = Array.from(new Set(rows.map(r => r.student_id)));
    const { data: students } = studentIds.length ? await supabaseAdmin.from("students").select("id, name, student_id_code").in("id", studentIds) : { data: [] as any[] };
    const nameOf = new Map<string, any>((students || []).map((s: any) => [s.id, s]));
    return res.json({ success: true, data: rows.map(r => ({ ...r, student_name: nameOf.get(r.student_id)?.name || "", student_code: nameOf.get(r.student_id)?.student_id_code || "" })) });
  } catch (err: any) { return fail(res, err); }
});

router.post("/orders/:id/confirm", async (req, res): Promise<any> => {
  try {
    const order = await findOrder(String(req.params.id));
    if (!order) return res.status(404).json({ success: false, message: "Order not found." });
    if (order.provider === "STRIPE") return res.status(400).json({ success: false, message: "Card payments are confirmed by Stripe, not by hand." });
    if (order.status === "PAID") return res.json({ success: true, message: "Already confirmed.", order });
    if (order.status !== "PENDING") return res.status(400).json({ success: false, message: `This order is ${order.status.toLowerCase()}.` });
    const r = await fulfillOrder(order, userOf(req).id);
    return res.json({ success: true, message: `${order.quantity} token(s) added.`, balance: r.balance });
  } catch (err: any) { return fail(res, err); }
});

router.post("/orders/:id/reject", async (req, res): Promise<any> => {
  try {
    const order = await findOrder(String(req.params.id));
    if (!order) return res.status(404).json({ success: false, message: "Order not found." });
    if (order.status !== "PENDING") return res.status(400).json({ success: false, message: `This order is ${order.status.toLowerCase()}.` });
    await supabaseAdmin.from("token_orders").update({ status: "CANCELLED", note: String(req.body?.note || "Rejected by admin").slice(0, 300) }).eq("id", order.id);
    return res.json({ success: true, message: "Order rejected." });
  } catch (err: any) { return fail(res, err); }
});

// Cash, bank transfer, cheque: the admin records it and the tokens are added.
router.post("/manual-credit", async (req, res): Promise<any> => {
  try {
    const { student_id, course_id, quantity, method, reference, note } = req.body || {};
    const provider = String(method || "OTHER").toUpperCase();
    if (!["ZELLE", "CASH", "BANK_TRANSFER", "CHEQUE", "OTHER"].includes(provider)) {
      return res.status(400).json({ success: false, message: "Method must be CASH, BANK_TRANSFER, CHEQUE, ZELLE or OTHER." });
    }
    const { order } = await createOrder({
      studentIdOrCode: String(student_id || ""), courseIdOrName: String(course_id || ""), quantity: Number(quantity || 1),
      provider, providerRef: reference ? String(reference).trim() : null, status: "PENDING",
      note: note ? String(note).slice(0, 300) : null, by: userOf(req).id,
    });
    const r = await fulfillOrder(order, userOf(req).id);
    return res.status(201).json({ success: true, message: `${order.quantity} token(s) added for ${order.course_name}.`, balance: r.balance, order });
  } catch (err: any) { return fail(res, err, 400); }
});

// Correction (for example a refund or a mistake). Needs a note. Positive adds tokens, negative removes them.
router.post("/adjust", async (req, res): Promise<any> => {
  try {
    const { student_id, course_id, delta, note } = req.body || {};
    const d = Math.trunc(Number(delta));
    if (!Number.isFinite(d) || d === 0 || Math.abs(d) > 500) return res.status(400).json({ success: false, message: "delta must be a whole number between -500 and 500, not 0." });
    if (!String(note || "").trim()) return res.status(400).json({ success: false, message: "A note is required for a correction." });
    const student = await findStudent(String(student_id || ""));
    const course = await findCourse(String(course_id || ""));
    if (!student || !course) return res.status(404).json({ success: false, message: "Student or course not found." });
    const r = await applyTokens({ studentId: student.id, courseId: course.id, delta: d, reason: "ADJUSTMENT", note: String(note).slice(0, 300), by: userOf(req).id });
    return res.json({ success: true, balance: r.balance });
  } catch (err: any) { return fail(res, err, 400); }
});

// ───────────────────────── Balances, ledger, roster, receipt ─────────────────────────

router.get("/balance/:studentId", async (req, res): Promise<any> => {
  try {
    const wallets = await getBalances(String(req.params.studentId));
    const courseKey = String(req.query.courseId || "").trim().toLowerCase();
    const picked = courseKey ? wallets.filter(w => w.courseId.toLowerCase() === courseKey || w.courseName.toLowerCase() === courseKey) : wallets;
    const remaining = picked.reduce((n, w) => n + w.balance, 0);
    const used = picked.reduce((n, w) => n + w.totalUsed, 0);
    const first = picked[0];
    return res.json({
      success: true,
      // one summary object (the shape the student screen already reads) plus the per-course list
      data: {
        tokens_remaining: remaining, tokens_consumed: used, hourly_rate: first?.pricePerToken ?? 0,
        isLowQuota: remaining <= LOW_TOKEN_LIMIT,
        teacherWarningMessage: remaining < 0 ? `Tokens owed: ${-remaining}. Please buy tokens.` : remaining <= LOW_TOKEN_LIMIT ? `Low tokens: ${remaining} class(es) left.` : undefined,
      },
      courses: wallets,
    });
  } catch (err: any) { return fail(res, err); }
});

router.get("/ledger/:studentId", async (req, res): Promise<any> => {
  try { return res.json({ success: true, data: await getLedger(String(req.params.studentId)) }); } catch (err: any) { return fail(res, err); }
});

// Teacher: balances of the students in their own classes. Admin: everyone with a wallet.
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
        ...r, tokens_remaining: r.balance, availableHours: r.balance,
        remainingClassesText: r.owed ? `${-r.balance} class(es) owed` : `${r.balance} classes remaining`,
        isLowQuotaWarning: r.low,
      })),
    });
  } catch (err: any) { return fail(res, err); }
});

router.get("/receipt/:orderId/html", async (req, res): Promise<any> => {
  try {
    const order = await findOrder(String(req.params.orderId));
    if (!order) return res.status(404).send("Receipt not found.");
    if (order.status !== "PAID") return res.status(400).send("This order is not paid yet.");
    const student = await findStudent(order.student_id);
    if (!student) return res.status(404).send("Student not found.");
    return res.type("html").send(ReceiptPdfService.generateReceiptHtml(buildReceiptData(order, student)));
  } catch (err: any) { return res.status(500).send(err?.message || "Could not build the receipt."); }
});

// ───────────────────────── Removed ─────────────────────────
// Razorpay, UPI and the old "settle" endpoint trusted prices and payment proof typed in the browser
// (a 12-digit number was enough to receive tokens). They are switched off. Use Stripe, Zelle (confirmed by the admin)
// or manual-credit.
const removed = (_req: Request, res: Response) =>
  res.status(410).json({ success: false, message: "This payment method is no longer available. Use card (Stripe) or ask the institute." });
router.use(["/razorpay", "/upi"], removed);
router.post(["/settle", "/manual/zelle-confirm"], removed);

export default router;
