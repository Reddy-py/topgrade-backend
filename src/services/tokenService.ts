import { supabaseAdmin } from "../supabase.js";
import { ReceiptPdfService, type ReceiptDataInput } from "./receiptPdfService.js";

/**
 * Class tokens. One class = one token, kept per student per course.
 * Everything lives in Supabase (token_wallets, token_ledger, token_orders). The price of a token is the course's
 * price per class, read on the SERVER. The browser never decides a price.
 */

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export const isUuid = (v: unknown): boolean => typeof v === "string" && UUID.test(v);
export const tokenCurrency = (): string => (process.env.TOKEN_CURRENCY || process.env.STRIPE_CURRENCY || "usd").toLowerCase();
export const MAX_TOKENS_PER_ORDER = Number(process.env.MAX_TOKENS_PER_ORDER || 100);
export const LOW_TOKEN_LIMIT = 2;

export type LedgerReason = "PURCHASE" | "MANUAL_CREDIT" | "CLASS_ATTENDED" | "ADJUSTMENT" | "REFUND";

export interface CourseInfo { id: string; name: string; price: number; }
export interface StudentInfo { id: string; name: string; code: string; email: string; parentEmails: string[]; }

export async function findCourse(idOrName: string): Promise<CourseInfo | null> {
  const key = String(idOrName ?? "").trim();
  if (!key) return null;
  const { data } = await supabaseAdmin.from("courses").select("id, name, course_material");
  const rows = (data || []) as any[];
  const hit = rows.find(c => String(c.id) === key) || rows.find(c => String(c.name || "").trim().toLowerCase() === key.toLowerCase());
  if (!hit) return null;
  let material: any = {};
  try { material = typeof hit.course_material === "string" ? JSON.parse(hit.course_material) : (hit.course_material || {}); } catch { /* ignore */ }
  return { id: String(hit.id), name: String(hit.name || ""), price: Number(material.hourly_rate) || 0 };
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
    ref: `refund:${base}#${k}`, note: "Attendance changed: token returned", by: p.by ?? null,
  });
  return { ok: true, refunded: r.applied, balance: r.balance };
}

// ------------------------------------------------------------------ balances
export interface WalletView {
  studentId: string; courseId: string; courseName: string; pricePerToken: number;
  balance: number; totalPurchased: number; totalUsed: number; low: boolean; owed: boolean;
}

async function viewWallets(rows: any[]): Promise<WalletView[]> {
  const { data: courses } = await supabaseAdmin.from("courses").select("id, name, course_material");
  const byId = new Map<string, CourseInfo>();
  for (const c of (courses || []) as any[]) {
    let m: any = {};
    try { m = typeof c.course_material === "string" ? JSON.parse(c.course_material) : (c.course_material || {}); } catch { /* ignore */ }
    byId.set(String(c.id), { id: String(c.id), name: String(c.name || ""), price: Number(m.hourly_rate) || 0 });
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
  id: string; order_number: string; student_id: string; course_id: string; course_name: string | null;
  quantity: number; unit_price: number; amount_total: number; currency: string; provider: string;
  provider_ref: string | null; status: string; payer_email: string | null; note: string | null; created_at: string; paid_at: string | null;
}

const newOrderNumber = (): string => `ORD-${new Date().getFullYear()}-${Math.floor(100000 + Math.random() * 900000)}`;

/** Creates an order. The price is always calculated here from the course, never taken from the request. */
export async function createOrder(p: {
  studentIdOrCode: string; courseIdOrName: string; quantity: number; provider: OrderRow["provider"];
  providerRef?: string | null; status?: "PENDING" | "PAID"; payerEmail?: string | null; note?: string | null; by?: string | null;
}): Promise<{ order: OrderRow; student: StudentInfo; course: CourseInfo }> {
  const student = await findStudent(p.studentIdOrCode);
  if (!student) throw new Error("Student not found.");
  const course = await findCourse(p.courseIdOrName);
  if (!course) throw new Error("Course not found.");
  if (!(course.price > 0)) throw new Error(`The price per class for ${course.name} is not set. Ask the institute to set it on the course.`);
  const quantity = Math.floor(Number(p.quantity));
  if (!Number.isFinite(quantity) || quantity < 1 || quantity > MAX_TOKENS_PER_ORDER) {
    throw new Error(`Choose between 1 and ${MAX_TOKENS_PER_ORDER} tokens.`);
  }
  const amountTotal = Math.round(course.price * 100) * quantity / 100;

  for (let attempt = 0; attempt < 3; attempt++) {
    const { data, error } = await supabaseAdmin.from("token_orders").insert({
      order_number: newOrderNumber(), student_id: student.id, course_id: course.id, course_name: course.name,
      quantity, unit_price: course.price, amount_total: amountTotal, currency: tokenCurrency(),
      provider: p.provider, provider_ref: p.providerRef ?? null, status: p.status ?? "PENDING",
      payer_email: p.payerEmail ?? null, note: p.note ?? null, created_by: p.by ?? null,
    }).select("*").single();
    if (!error && data) return { order: data as OrderRow, student, course };
    if (error?.code !== "23505") throw new Error(`Could not create the order (run migration 20261013): ${error?.message}`);
  }
  throw new Error("Could not create a unique order number. Try again.");
}

export async function findOrder(idOrNumberOrRef: string): Promise<OrderRow | null> {
  const key = String(idOrNumberOrRef ?? "").trim();
  if (!key) return null;
  const col = isUuid(key) ? "id" : key.startsWith("ORD-") ? "order_number" : "provider_ref";
  const { data } = await supabaseAdmin.from("token_orders").select("*").eq(col, key).maybeSingle();
  return (data as OrderRow) || null;
}

/** Marks the order paid and credits the tokens, exactly once, however many times this is called. */
export async function fulfillOrder(order: OrderRow, by?: string | null): Promise<{ credited: boolean; balance: number }> {
  const r = await applyTokens({
    studentId: order.student_id, courseId: order.course_id, delta: order.quantity,
    reason: order.provider === "STRIPE" ? "PURCHASE" : "MANUAL_CREDIT",
    ref: order.order_number, note: `${order.provider} order ${order.order_number}`, by: by ?? null,
  });
  await supabaseAdmin.from("token_orders").update({ status: "PAID", paid_at: new Date().toISOString() }).eq("id", order.id).neq("status", "PAID");
  if (r.applied) void sendOrderReceipt(order).catch(err => console.warn("Receipt email notice:", err?.message));
  return { credited: r.applied, balance: r.balance };
}

export function buildReceiptData(order: OrderRow, student: StudentInfo): ReceiptDataInput {
  return {
    receiptNumber: order.order_number.replace("ORD-", "REC-"),
    orderNumber: order.order_number,
    studentName: student.name,
    studentCode: student.code,
    parentName: "Parent",
    studentEmail: student.email,
    parentEmail: student.parentEmails[0] || order.payer_email || "",
    courseName: order.course_name || "Course",
    pricingModel: "HOURLY_CREDIT_PACKAGE",
    purchasedHours: order.quantity,
    grossAmount: Number(order.amount_total),
    taxAmount: 0,
    totalPayable: Number(order.amount_total),
    paymentMethod: order.provider,
    paymentDate: order.paid_at || order.created_at,
  } as ReceiptDataInput;
}

async function sendOrderReceipt(order: OrderRow): Promise<void> {
  const student = await findStudent(order.student_id);
  if (!student) return;
  await ReceiptPdfService.dispatchReceiptEmail(buildReceiptData(order, student));
}
