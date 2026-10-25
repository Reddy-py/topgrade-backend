import { supabaseAdmin } from "../supabase.js";
import { ReceiptPdfService, type ReceiptDataInput } from "./receiptPdfService.js";
import { quoteEnrollment, type EnrollmentPlan } from "./pricing.js";
import { generateReferenceCode } from "./bankReconciliationService.js";
import { getCachedInstituteSettings, instituteAddress } from "./instituteSettingsService.js";

/**
 * Class tokens. One class = one token, kept per student per course.
 * Everything lives in Supabase (token_wallets, token_ledger, token_orders). The price of a token is the course's
 * price, read on the SERVER via quoteEnrollment. The browser never decides a price.
 */

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export const isUuid = (v: unknown): boolean => typeof v === "string" && UUID.test(v);
export const tokenCurrency = (): string => (process.env.TOKEN_CURRENCY || "usd").toLowerCase();
export const MAX_TOKENS_PER_ORDER = Number(process.env.MAX_TOKENS_PER_ORDER || 100);
export const LOW_TOKEN_LIMIT = 2;

export type LedgerReason = "PURCHASE" | "MANUAL_CREDIT" | "CLASS_ATTENDED" | "ADJUSTMENT" | "REFUND";

export interface CourseInfo {
  id: string;
  name: string;
  price: number;
  hourly_rate?: number | undefined;
  package_price?: number | undefined;
  package_hours?: number | undefined;
  duration_months?: number | undefined;
}
export interface StudentInfo { id: string; name: string; code: string; email: string; parentEmails: string[]; }

export async function findCourse(idOrName: string): Promise<CourseInfo | null> {
  const key = String(idOrName ?? "").trim();
  if (!key) return null;
  const { data } = await supabaseAdmin.from("courses").select("id, name, hourly_rate, package_price, package_hours, duration_months");
  const rows = (data || []) as any[];
  const hit = rows.find(c => String(c.id) === key) || rows.find(c => String(c.name || "").trim().toLowerCase() === key.toLowerCase());
  if (!hit) return null;
  const hRate = hit.hourly_rate !== null && hit.hourly_rate !== undefined ? Number(hit.hourly_rate) : 0;
  return {
    id: String(hit.id),
    name: String(hit.name || ""),
    price: hRate,
    hourly_rate: hRate,
    package_price: hit.package_price !== null && hit.package_price !== undefined ? Number(hit.package_price) : undefined,
    package_hours: hit.package_hours !== null && hit.package_hours !== undefined ? Number(hit.package_hours) : undefined,
    duration_months: hit.duration_months !== null && hit.duration_months !== undefined ? Number(hit.duration_months) : undefined,
  };
}

export async function findStudent(idOrCode: string): Promise<StudentInfo | null> {
  const key = String(idOrCode ?? "").trim();
  if (!key) return null;
  const q = supabaseAdmin.from("students").select("id, name, student_id_code, email, parent_emails");
  const { data } = await (isUuid(key) ? q.eq("id", key) : q.eq("student_id_code", key)).maybeSingle();
  if (!data) return null;
  return {
    id: data.id as string,
    name: (data.name as string) || "",
    code: (data.student_id_code as string) || "",
    email: (data.email as string) || "",
    parentEmails: Array.isArray(data.parent_emails) ? (data.parent_emails as string[]) : [],
  };
}

/** The one place tokens change. Repeat-safe: the same (reason, ref) is applied only once. */
export async function applyTokens(p: {
  studentId: string; courseId: string; delta: number; reason: LedgerReason;
  ref?: string | null; note?: string | null; by?: string | null;
}): Promise<{ applied: boolean; balance: number }> {
  const { data, error } = await supabaseAdmin.rpc("token_apply", {
    p_student: p.studentId, p_course: p.courseId, p_delta: p.delta, p_reason: p.reason,
    p_ref: p.ref ?? null, p_note: p.note ?? null, p_by: p.by ?? null,
  });
  if (error) throw new Error(`Could not update tokens (run migration 20261013): ${error.message}`);
  const row = Array.isArray(data) ? data[0] : data;
  return { applied: !!row?.out_applied, balance: Number(row?.out_balance ?? 0) };
}

// ------------------------------------------------------------------ attendance
// A token is used when a student is marked PRESENT in a class. Marking again does nothing.
// Changing PRESENT to ABSENT gives the token back; marking PRESENT again uses a new one.

async function refundCount(studentId: string, base: string): Promise<number> {
  const { count } = await supabaseAdmin
    .from("token_ledger").select("id", { count: "exact", head: true })
    .eq("student_id", studentId).eq("reason", "REFUND").like("ref", `refund:${base}#%`);
  return count ?? 0;
}

export async function consumeAttendanceToken(p: {
  studentIdOrCode: string; courseIdOrName: string; classRef: string; by?: string | null;
}): Promise<{ ok: boolean; reason?: string; balance?: number; owed?: boolean; low?: boolean; courseName?: string }> {
  const student = await findStudent(p.studentIdOrCode);
  const course = await findCourse(p.courseIdOrName);
  if (!student) return { ok: false, reason: "Student not found." };
  if (!course) return { ok: false, reason: "Course not found." };
  const base = `${student.id}:${p.classRef}`;
  const k = await refundCount(student.id, base);
  const r = await applyTokens({
    studentId: student.id, courseId: course.id, delta: -1, reason: "CLASS_ATTENDED",
    ref: `${base}#${k}`, note: `Class attended: ${course.name}`, by: p.by ?? null,
  });
  return { ok: true, balance: r.balance, owed: r.balance < 0, low: r.balance <= LOW_TOKEN_LIMIT, courseName: course.name };
}

export async function refundAttendanceToken(p: {
  studentIdOrCode: string; courseIdOrName: string; classRef: string; by?: string | null;
}): Promise<{ ok: boolean; refunded: boolean; balance?: number }> {
  const student = await findStudent(p.studentIdOrCode);
  const course = await findCourse(p.courseIdOrName);
  if (!student || !course) return { ok: false, refunded: false };
  const base = `${student.id}:${p.classRef}`;
  const k = await refundCount(student.id, base);
  const { data: used } = await supabaseAdmin
    .from("token_ledger").select("id").eq("student_id", student.id).eq("reason", "CLASS_ATTENDED").eq("ref", `${base}#${k}`).maybeSingle();
  if (!used) return { ok: true, refunded: false };
  const r = await applyTokens({
    studentId: student.id, courseId: course.id, delta: 1, reason: "REFUND",
    ref: `refund:${base}#${k}`, note: "Attendance changed: hour returned", by: p.by ?? null,
  });
  return { ok: true, refunded: r.applied, balance: r.balance };
}

// ------------------------------------------------------------------ balances
export interface WalletView {
  studentId: string; courseId: string; courseName: string; pricePerToken: number;
  balance: number; totalPurchased: number; totalUsed: number; low: boolean; owed: boolean;
}

async function viewWallets(rows: any[]): Promise<WalletView[]> {
  const { data: courses } = await supabaseAdmin.from("courses").select("id, name, hourly_rate");
  const byId = new Map<string, CourseInfo>();
  for (const c of (courses || []) as any[]) {
    byId.set(String(c.id), { id: String(c.id), name: String(c.name || ""), price: c.hourly_rate !== null && c.hourly_rate !== undefined ? Number(c.hourly_rate) : 0 });
  }
  return rows.map(w => {
    const c = byId.get(String(w.course_id));
    const balance = Number(w.balance) || 0;
    return {
      studentId: w.student_id, courseId: w.course_id, courseName: c?.name || "Course",
      pricePerToken: c?.price || 0, balance, totalPurchased: Number(w.total_purchased) || 0,
      totalUsed: Number(w.total_used) || 0, low: balance <= LOW_TOKEN_LIMIT, owed: balance < 0,
    };
  });
}

export async function getBalances(studentIdOrCode: string): Promise<WalletView[]> {
  const student = await findStudent(studentIdOrCode);
  if (!student) return [];
  const { data } = await supabaseAdmin.from("token_wallets").select("*").eq("student_id", student.id);
  return viewWallets((data || []) as any[]);
}

export async function getBalancesForStudents(studentUuids: string[]): Promise<Array<WalletView & { studentName: string; studentCode: string }>> {
  const ids = studentUuids.filter(isUuid);
  if (ids.length === 0) return [];
  const { data: wallets } = await supabaseAdmin.from("token_wallets").select("*").in("student_id", ids);
  const { data: students } = await supabaseAdmin.from("students").select("id, name, student_id_code").in("id", ids);
  const nameOf = new Map<string, any>((students || []).map((s: any) => [s.id, s]));
  const views = await viewWallets((wallets || []) as any[]);
  return views.map(v => ({ ...v, studentName: nameOf.get(v.studentId)?.name || "", studentCode: nameOf.get(v.studentId)?.student_id_code || "" }));
}

export async function getLedger(studentIdOrCode: string, limit = 100) {
  const student = await findStudent(studentIdOrCode);
  if (!student) return [];
  const { data } = await supabaseAdmin
    .from("token_ledger").select("id, course_id, delta, reason, note, balance_after, created_at")
    .eq("student_id", student.id).order("created_at", { ascending: false }).limit(limit);
  return data || [];
}

// ------------------------------------------------------------------ orders
export interface OrderRow {
  id: string;
  order_number: string;
  reference_code: string | null;
  student_id: string;
  course_id: string;
  course_name: string | null;
  quantity: number;
  unit_price: number;
  amount_total: number;
  currency: string;
  provider: string;
  provider_ref: string | null;
  status: "PENDING_PAYMENT" | "PAID" | "PARTIAL" | "EXPIRED" | "CANCELLED" | "FAILED" | string;
  payer_email: string | null;
  note: string | null;
  expires_at: string | null;
  bank_transaction_id: string | null;
  confirmed_by: string | null;
  confirmed_at: string | null;
  amount_received: number | null;
  mismatch_note: string | null;
  plan: "HOURS" | "PACKAGE" | string;
  dispute_status?: "NONE" | "DISPUTED" | "RESOLVED" | "LOST" | null | undefined;
  disputed_at?: string | null | undefined;
  refunded_amount?: number | null | undefined;
  refund_reason?: string | null | undefined;
  refunded_at?: string | null | undefined;
  card_brand?: string | null | undefined;
  card_last4?: string | null | undefined;
  stripe_payment_intent_id?: string | null | undefined;
  stripe_session_id?: string | null | undefined;
  created_at: string;
  paid_at: string | null;
}

const newOrderNumber = (): string => `ORD-${new Date().getFullYear()}-${Math.floor(100000 + Math.random() * 900000)}`;

/** Creates an order. The price is always calculated here from the course via quoteEnrollment, never taken from the request. */
export async function createOrder(p: {
  studentIdOrCode: string;
  courseIdOrName: string;
  quantity?: number | undefined;
  plan?: "HOURS" | "PACKAGE" | undefined;
  provider?: OrderRow["provider"] | undefined;
  providerRef?: string | null | undefined;
  status?: OrderRow["status"] | undefined;
  payerEmail?: string | null | undefined;
  note?: string | null | undefined;
  by?: string | null | undefined;
}): Promise<{ order: OrderRow; student: StudentInfo; course: CourseInfo }> {
  const student = await findStudent(p.studentIdOrCode);
  if (!student) throw new Error("Student not found.");
  const course = await findCourse(p.courseIdOrName);
  if (!course) throw new Error("Course not found.");

  const plan: EnrollmentPlan = p.plan === "PACKAGE" ? "PACKAGE" : "HOURS";
  const hoursRequested = p.quantity !== undefined ? Number(p.quantity) : undefined;

  // Use pure function quoteEnrollment to strictly verify pricing on server
  const quote = quoteEnrollment(course, plan, hoursRequested);
  if (!quote.is_valid) {
    throw new Error(quote.error || "Unable to calculate course fee quote.");
  }

  const hours = quote.hours_total;
  const amountTotal = quote.quoted_amount;
  const unitPrice = hours > 0 ? Math.round((amountTotal / hours) * 100) / 100 : (course.hourly_rate || 0);

  const settings = getCachedInstituteSettings();
  const expiryDays = settings.pending_order_expiry_days || 7;
  const expiresAt = new Date(Date.now() + expiryDays * 24 * 60 * 60 * 1000).toISOString();
  const provider = (p.provider || "ZELLE").toUpperCase();

  for (let attempt = 0; attempt < 5; attempt++) {
    const referenceCode = generateReferenceCode();
    const { data, error } = await supabaseAdmin.from("token_orders").insert({
      order_number: newOrderNumber(),
      reference_code: referenceCode,
      student_id: student.id,
      course_id: course.id,
      course_name: course.name,
      quantity: hours,
      unit_price: unitPrice,
      amount_total: amountTotal,
      currency: tokenCurrency(),
      provider,
      provider_ref: p.providerRef ?? referenceCode,
      status: p.status ?? "PENDING_PAYMENT",
      payer_email: p.payerEmail ?? null,
      note: p.note ?? null,
      expires_at: expiresAt,
      plan,
      created_by: p.by ?? null,
    }).select("*").single();

    if (!error && data) return { order: data as OrderRow, student, course };
    if (error?.code !== "23505") throw new Error(`Could not create order: ${error?.message}`);
  }
  throw new Error("Could not create a unique order reference. Please try again.");
}

export async function findOrder(idOrNumberOrRef: string): Promise<OrderRow | null> {
  const key = String(idOrNumberOrRef ?? "").trim();
  if (!key) return null;
  const col = isUuid(key)
    ? "id"
    : key.startsWith("ORD-")
    ? "order_number"
    : key.startsWith("TG-")
    ? "reference_code"
    : "provider_ref";

  const { data } = await supabaseAdmin.from("token_orders").select("*").eq(col, key).maybeSingle();
  if (data) return data as OrderRow;

  // Secondary fallback across all lookup columns
  const { data: fallback } = await supabaseAdmin
    .from("token_orders")
    .select("*")
    .or(`reference_code.eq.${key},order_number.eq.${key},provider_ref.eq.${key}`)
    .maybeSingle();

  return (fallback as OrderRow) || null;
}

/** Marks the order paid and credits the tokens, exactly once, however many times this is called. */
export async function fulfillOrder(order: OrderRow, by?: string | null): Promise<{ credited: boolean; balance: number }> {
  const r = await applyTokens({
    studentId: order.student_id,
    courseId: order.course_id,
    delta: order.quantity,
    reason: "PURCHASE",
    ref: order.order_number,
    note: `${order.provider} payment verified: ${order.reference_code || order.order_number}`,
    by: by ?? null,
  });
  await supabaseAdmin.from("token_orders").update({
    status: "PAID",
    paid_at: new Date().toISOString(),
    confirmed_at: new Date().toISOString(),
    confirmed_by: by ?? null,
  }).eq("id", order.id).neq("status", "PAID");

  if (r.applied) void sendOrderReceipt(order).catch(err => console.warn("Receipt email notice:", err?.message));
  return { credited: r.applied, balance: r.balance };
}

export function buildReceiptData(order: OrderRow, student: StudentInfo): ReceiptDataInput {
  const s = getCachedInstituteSettings();
  const address = instituteAddress();
  return {
    receiptNumber: order.order_number.replace("ORD-", "REC-"),
    orderNumber: `${order.order_number} (Ref: ${order.reference_code || "N/A"})`,
    studentName: student.name,
    studentCode: student.code,
    parentName: "Parent / Guardian",
    studentEmail: student.email,
    parentEmail: student.parentEmails[0] || order.payer_email || "",
    courseName: order.course_name || "Course",
    pricingModel: order.plan === "PACKAGE" ? "FIXED_COURSE_PACKAGE" : "HOURLY_CREDIT_PACKAGE",
    purchasedHours: order.quantity,
    grossAmount: Number(order.amount_total),
    taxAmount: 0,
    totalPayable: Number(order.amount_received ?? order.amount_total),
    paymentMethod:
      order.provider === "ZELLE"
        ? "Zelle (Bank Verified)"
        : (order.provider === "STRIPE" || order.provider === "STRIPE_CARD")
        ? (order.card_brand && order.card_last4
            ? `Card (${order.card_brand.toUpperCase()} •••• ${order.card_last4})`
            : "Card")
        : order.provider,
    paymentDate: order.paid_at || order.created_at,
  } as ReceiptDataInput;
}

async function sendOrderReceipt(order: OrderRow): Promise<void> {
  const student = await findStudent(order.student_id);
  if (!student) return;
  await ReceiptPdfService.dispatchReceiptEmail(buildReceiptData(order, student));
}

