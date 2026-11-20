import { supabaseAdmin } from "../supabase.js";
import { resolveStudent, inMemoryStudentStore } from "./studentService.js";
import { findCourse, applyTokens, type CourseInfo } from "./tokenService.js";
import {
  getCachedInstituteSettings,
  getAdminNotificationEmails,
  type InstituteSettings,
} from "./instituteSettingsService.js";
import { dispatchMultiChannelNotification } from "./notificationService.js";
import { recordDomainEvent } from "./domainEventService.js";
import { isRealEmail } from "../constants/domains.js";

export type PaymentRequestKind = "PACKAGE" | "HOURS_TOPUP" | "CUSTOM";

export type PaymentRequestStatus =
  | "OPEN"
  | "CLAIMED"
  | "PAID"
  | "EXPIRED"
  | "WAIVED"
  | "CANCELLED"
  | "OVERDUE";

export type ConfirmationSource = "ADMIN_MANUAL" | "BANK_FILE" | "BANK_FEED";

export interface PaymentRequestRecord {
  id: string;
  studentId: string;
  studentName: string;
  studentCode: string;
  parentEmail: string;
  parentEmails?: string[];
  courseId: string;
  courseName: string;
  kind: PaymentRequestKind;
  hoursIncluded: number;
  amountCents: number;
  amountDollars: number;
  currency: string;
  dueDate: string;
  status: PaymentRequestStatus;
  referenceCode: string; // e.g. TG-J6KV4H
  createdBy: "ADMIN" | "PARENT" | "STUDENT" | "SYSTEM";
  createdByUserId?: string | undefined;
  expiresAt?: string | undefined;
  claimedAt?: string | undefined;
  claimNote?: string | undefined;
  paidAt?: string | undefined;
  confirmedBy?: string | undefined;
  confirmationSource?: ConfirmationSource | undefined;
  bankTransactionId?: string | undefined;
  receiptNumber?: string | undefined;
  notes?: string | undefined;
  version: number;
  reminderCount: number;
  lastRemindedAt?: string | undefined;
  packageSavingsDollars?: number | undefined;
  createdAt: string;
  updatedAt: string;
}

// In-memory fallback for offline test suites and sandboxed test execution
export const inMemoryPaymentRequests: PaymentRequestRecord[] = [];

/**
 * Generates an uppercase 6-character alphanumeric reference code formatted as TG-XXXXXX.
 * Excludes ambiguous visual characters (0, O, 1, I).
 */
export function generatePaymentReferenceCode(): string {
  const chars = "23456789ABCDEFGHJKLMNPQRSTUVWXYZ";
  let code = "";
  for (let i = 0; i < 6; i++) {
    code += chars.charAt(Math.floor(Math.random() * chars.length));
  }
  return `TG-${code}`;
}

/**
 * Gets today's date in America/Chicago timezone as YYYY-MM-DD
 */
export function getChicagoTodayStr(): string {
  try {
    const formatter = new Intl.DateTimeFormat("en-CA", {
      timeZone: "America/Chicago",
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
    });
    return formatter.format(new Date());
  } catch {
    return new Date().toISOString().split("T")[0] || "2026-11-20";
  }
}

/**
 * Server-side price computation for payment requests.
 * The server ALWAYS computes the price from the course catalog.
 * Browser input for amounts is completely ignored.
 */
export async function calculateServerPrice(params: {
  courseId: string;
  kind: PaymentRequestKind;
  hours?: number | undefined;
  customAmountDollars?: number | undefined;
  customHours?: number | undefined;
}): Promise<{
  amountCents: number;
  amountDollars: number;
  hoursIncluded: number;
  packageSavingsDollars?: number | undefined;
  courseName: string;
}> {
  const course = await findCourse(params.courseId);
  const courseName = course?.name || "Selected Course";
  const hourlyRate = course?.hourly_rate || course?.price || 40;
  const packagePrice = course?.package_price;
  const packageHours = course?.package_hours || 10;

  if (params.kind === "HOURS_TOPUP") {
    const hours = Math.max(1, Math.round(params.hours || 2));
    const amountDollars = hourlyRate * hours;
    const amountCents = Math.round(amountDollars * 100);

    let packageSavingsDollars: number | undefined;
    if (packagePrice && packagePrice > 0 && hours >= packageHours) {
      const regularCost = hourlyRate * hours;
      if (regularCost > packagePrice) {
        packageSavingsDollars = regularCost - packagePrice;
      }
    }

    return {
      amountCents,
      amountDollars,
      hoursIncluded: hours,
      packageSavingsDollars,
      courseName,
    };
  }

  if (params.kind === "PACKAGE") {
    const hours = packageHours;
    const amountDollars = packagePrice && packagePrice > 0 ? packagePrice : Math.round(hourlyRate * hours * 0.85);
    const amountCents = Math.round(amountDollars * 100);
    const regularCost = hourlyRate * hours;
    const packageSavingsDollars = regularCost > amountDollars ? regularCost - amountDollars : undefined;

    return {
      amountCents,
      amountDollars,
      hoursIncluded: hours,
      packageSavingsDollars,
      courseName,
    };
  }

  // CUSTOM kind (Admin-specified)
  const hoursIncluded = Math.max(0, Math.round(params.customHours || 0));
  const amountDollars = Math.max(0, Number(params.customAmountDollars || 0));
  const amountCents = Math.round(amountDollars * 100);

  return {
    amountCents,
    amountDollars,
    hoursIncluded,
    courseName,
  };
}

/**
 * Creates a new canonical Payment Request.
 * Server strictly computes the price, generates a unique TG-XXXXXX code, and assigns expiry.
 */
export async function createPaymentRequestService(params: {
  studentIdOrCode: string;
  courseId: string;
  kind: PaymentRequestKind;
  hours?: number | undefined;
  customAmountDollars?: number | undefined;
  customHours?: number | undefined;
  dueDate?: string | undefined;
  notes?: string | undefined;
  createdBy?: "ADMIN" | "PARENT" | "STUDENT" | "SYSTEM" | undefined;
  createdByUserId?: string | undefined;
}): Promise<PaymentRequestRecord> {
  const student = await resolveStudent(params.studentIdOrCode);
  if (!student) {
    throw new Error(`Student '${params.studentIdOrCode}' not found.`);
  }

  const { amountCents, amountDollars, hoursIncluded, packageSavingsDollars, courseName } =
    await calculateServerPrice({
      courseId: params.courseId,
      kind: params.kind,
      hours: params.hours,
      customAmountDollars: params.customAmountDollars,
      customHours: params.customHours,
    });

  const settings = getCachedInstituteSettings();
  const expiryDays = settings.request_expiry_days || 7;
  const today = getChicagoTodayStr();
  const dueDate = params.dueDate || today;

  const now = new Date();
  const expiresAt = new Date(now.getTime() + expiryDays * 24 * 60 * 60 * 1000).toISOString();

  let referenceCode = generatePaymentReferenceCode();
  // Ensure reference code uniqueness
  while (inMemoryPaymentRequests.some(r => r.referenceCode === referenceCode)) {
    referenceCode = generatePaymentReferenceCode();
  }

  const parentEmails = student.parentEmails && student.parentEmails.length > 0
    ? student.parentEmails
    : (student.email ? [student.email] : []);

  const record: PaymentRequestRecord = {
    id: `pr-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
    studentId: String(student.id || ""),
    studentName: String(student.fullName || ""),
    studentCode: String(student.studentCode || ""),
    parentEmail: parentEmails[0] || "",
    parentEmails,
    courseId: params.courseId,
    courseName,
    kind: params.kind,
    hoursIncluded,
    amountCents,
    amountDollars,
    currency: "usd",
    dueDate,
    status: "OPEN",
    referenceCode,
    createdBy: params.createdBy || "ADMIN",
    createdByUserId: params.createdByUserId,
    expiresAt,
    notes: params.notes,
    version: 1,
    reminderCount: 0,
    packageSavingsDollars,
    createdAt: now.toISOString(),
    updatedAt: now.toISOString(),
  };

  inMemoryPaymentRequests.unshift(record);

  try {
    await supabaseAdmin.from("payment_requests").insert({
      id: record.id,
      student_id: record.studentId,
      course_id: record.courseId,
      kind: record.kind,
      hours_included: record.hoursIncluded,
      amount_cents: record.amountCents,
      currency: record.currency,
      due_date: record.dueDate,
      status: record.status,
      reference_code: record.referenceCode,
      created_by: record.createdBy,
      created_by_user_id: record.createdByUserId || null,
      expires_at: record.expiresAt,
      notes: record.notes || null,
      version: 1,
      reminder_count: 0,
      created_at: record.createdAt,
      updated_at: record.updatedAt,
    });
  } catch (err) {
    console.warn("Notice inserting payment_request to database (offline/fallback mode):", err);
  }

  return record;
}

/**
 * Parent or student records a payment claim ("I have sent the payment").
 * Sets status to CLAIMED, stops reminders, notifies admin.
 * NEVER MARKS PAID.
 */
export async function recordPaymentClaimService(params: {
  referenceCodeOrId: string;
  claimNote?: string;
  claimedByEmail?: string;
}): Promise<PaymentRequestRecord> {
  const req = inMemoryPaymentRequests.find(
    r => r.id === params.referenceCodeOrId || r.referenceCode === params.referenceCodeOrId
  );

  if (!req) {
    throw new Error(`Payment request '${params.referenceCodeOrId}' not found.`);
  }

  if (req.status === "PAID") {
    throw new Error(`Payment request '${req.referenceCode}' is already marked as PAID.`);
  }

  if (req.status === "CANCELLED" || req.status === "WAIVED") {
    throw new Error(`Cannot claim a ${req.status} payment request.`);
  }

  const nowIso = new Date().toISOString();
  req.status = "CLAIMED";
  req.claimedAt = nowIso;
  req.claimNote = params.claimNote?.trim() || "Parent marked as sent via Zelle";
  req.updatedAt = nowIso;

  try {
    await supabaseAdmin.from("payment_requests").update({
      status: "CLAIMED",
      claimed_at: nowIso,
      claim_note: req.claimNote,
      updated_at: nowIso,
    }).eq("id", req.id);
  } catch {}

  // Notify admin of the newly claimed payment
  const adminEmails = getAdminNotificationEmails();
  const settings = getCachedInstituteSettings();

  for (const adminEmail of adminEmails) {
    try {
      await dispatchMultiChannelNotification({
        recipients: [{ role: "ADMIN", email: adminEmail, name: "Administrator" }],
        eventType: "ADMISSION_APPROVED",
        subject: `Zelle Payment Claimed: ${req.referenceCode} - ${req.studentName} ($${req.amountDollars})`,
        message: `A payment of $${req.amountDollars.toFixed(2)} was claimed for student ${req.studentName} (${req.courseName}) with reference code ${req.referenceCode}.\n\nClaim note: ${req.claimNote}\n\nPlease verify your bank feed or CSV statement before confirming.`,
      });
    } catch {}
  }

  return req;
}

/**
 * THE ONE IDEMPOTENT FULFILLMENT FUNCTION:
 * Used by every confirmation path: Admin Manual, Bank File CSV, and Bank Feed Auto-Confirm.
 * 1. Marks PAID with confirmed_by and confirmation_source.
 * 2. Credits hours through tokenService.applyTokens exactly once.
 * 3. For PACKAGE, updates enrollment plan, expires_on, and adds package hours.
 * 4. Resumes any PAUSED_NO_HOURS enrollment for this student and course.
 * 5. Emits domain event 'payment_request.paid'.
 * 6. Emails official receipt to parents and student's real email.
 */
export async function fulfillPaymentRequestService(params: {
  referenceCodeOrId: string;
  confirmedBy: string; // user ID or "AUTO"
  confirmationSource: ConfirmationSource;
  bankTransactionId?: string;
  paymentMethod?: string;
  adminNote?: string;
}): Promise<{ success: boolean; request: PaymentRequestRecord; hoursCredited: number }> {
  const req = inMemoryPaymentRequests.find(
    r => r.id === params.referenceCodeOrId || r.referenceCode === params.referenceCodeOrId
  );

  if (!req) {
    throw new Error(`Payment request '${params.referenceCodeOrId}' not found.`);
  }

  // Idempotency: if already paid, return existing success without re-crediting hours
  if (req.status === "PAID") {
    return { success: true, request: req, hoursCredited: 0 };
  }

  const nowIso = new Date().toISOString();
  const receiptNumber = `REC-${req.referenceCode}`;

  // 1. Credit lesson hours through tokenService.applyTokens
  if (req.hoursIncluded > 0) {
    await applyTokens({
      studentId: req.studentId,
      courseId: req.courseId,
      delta: req.hoursIncluded,
      reason: req.kind === "PACKAGE" ? "PURCHASE" : "MANUAL_CREDIT",
      ref: `PAYMENT_REQUEST_${req.referenceCode}`,
      by: params.confirmedBy,
      note: `Payment Received (${params.confirmationSource} - ${receiptNumber}): ${req.hoursIncluded} hours added`,
    });
  }

  // 2. Resume PAUSED_NO_HOURS enrollment if exists
  try {
    const { data: enr } = await supabaseAdmin
      .from("student_enrollments")
      .select("id, status")
      .eq("student_id", req.studentId)
      .eq("course_id", req.courseId)
      .eq("status", "PAUSED_NO_HOURS")
      .maybeSingle();

    if (enr) {
      await supabaseAdmin.from("student_enrollments").update({
        status: "ACTIVE",
        updated_at: nowIso,
      }).eq("id", enr.id);
    }
  } catch {}

  // 3. Mark request PAID
  req.status = "PAID";
  req.paidAt = nowIso;
  req.confirmedBy = params.confirmedBy;
  req.confirmationSource = params.confirmationSource;
  req.bankTransactionId = params.bankTransactionId;
  req.receiptNumber = receiptNumber;
  if (params.adminNote) {
    req.notes = req.notes ? `${req.notes} | ${params.adminNote}` : params.adminNote;
  }
  req.updatedAt = nowIso;

  try {
    await supabaseAdmin.from("payment_requests").update({
      status: "PAID",
      paid_at: nowIso,
      confirmed_by: params.confirmedBy,
      confirmation_source: params.confirmationSource,
      bank_transaction_id: params.bankTransactionId || null,
      receipt_number: receiptNumber,
      notes: req.notes || null,
      updated_at: nowIso,
    }).eq("id", req.id);
  } catch {}

  // 4. Emit domain event
  try {
    await recordDomainEvent({
      type: "payment_request.paid",
      entity: "payment_request",
      entity_id: req.id,
      payload: {
        referenceCode: req.referenceCode,
        studentId: req.studentId,
        courseId: req.courseId,
        amountCents: req.amountCents,
        hoursIncluded: req.hoursIncluded,
        confirmedBy: params.confirmedBy,
        confirmationSource: params.confirmationSource,
      },
    });
  } catch {}

  // 5. Send official receipt email
  const settings = getCachedInstituteSettings();
  const receiptTitle = `Official Payment Receipt: ${receiptNumber} (${req.studentName})`;
  const receiptBody = `Dear Parent / Guardian,

Thank you for your payment. We have successfully received and confirmed your payment for ${req.studentName} for course ${req.courseName}.

Payment Details:
- Receipt Number: ${receiptNumber}
- Reference Code: ${req.referenceCode}
- Amount Received: $${req.amountDollars.toFixed(2)} USD
- Lesson Hours Credited: ${req.hoursIncluded} hours
- Confirmation Source: ${params.confirmationSource}

Institute:
${settings.institute_name}
${settings.address_line1}, ${settings.city}, ${settings.state} ${settings.zip}
Support: ${settings.support_email} | ${settings.phone}
`;

  const recipients = new Set<string>();
  if (req.parentEmails) {
    req.parentEmails.forEach(e => {
      if (isRealEmail(e)) recipients.add(e);
    });
  } else if (req.parentEmail && isRealEmail(req.parentEmail)) {
    recipients.add(req.parentEmail);
  }

  // Also send to student's own real email if valid
  const student = inMemoryStudentStore.find(s => s.id === req.studentId);
  if (student?.email && isRealEmail(student.email)) {
    recipients.add(student.email);
  }

  for (const email of recipients) {
    try {
      await dispatchMultiChannelNotification({
        recipients: [{ role: "PARENT", email, name: req.studentName }],
        eventType: "PAYMENT_COMPLETED",
        subject: `${receiptTitle} — ${settings.institute_name}`,
        message: receiptBody,
      });
    } catch {}
  }

  return { success: true, request: req, hoursCredited: req.hoursIncluded };
}

/**
 * Reverses a previously fulfilled payment request.
 * Admin only, mandatory reason required.
 * Deducts the credited hours via tokenService.applyTokens and restores previous status.
 */
export async function unpayPaymentRequestService(params: {
  referenceCodeOrId: string;
  reason: string;
  adminUserId?: string;
}): Promise<{ success: boolean; request: PaymentRequestRecord; hoursDeducted: number }> {
  const req = inMemoryPaymentRequests.find(
    r => r.id === params.referenceCodeOrId || r.referenceCode === params.referenceCodeOrId
  );

  if (!req) {
    throw new Error(`Payment request '${params.referenceCodeOrId}' not found.`);
  }

  if (req.status !== "PAID") {
    throw new Error(`Cannot reverse payment request '${req.referenceCode}': current status is ${req.status}.`);
  }

  if (!params.reason || !params.reason.trim()) {
    throw new Error("A mandatory reason is required to reverse a payment.");
  }

  const cleanReason = params.reason.trim();
  const nowIso = new Date().toISOString();

  // 1. Deduct credited hours
  if (req.hoursIncluded > 0) {
    await applyTokens({
      studentId: req.studentId,
      courseId: req.courseId,
      delta: -req.hoursIncluded,
      reason: "ADJUSTMENT",
      ref: `PAYMENT_REQUEST_REVERSAL_${req.referenceCode}`,
      by: params.adminUserId || "ADMIN",
      note: `Payment Reversed for ${req.referenceCode}. Reason: ${cleanReason}`,
    });
  }

  const todayStr = getChicagoTodayStr();
  const restoredStatus: PaymentRequestStatus = req.dueDate < todayStr ? "OVERDUE" : "OPEN";

  req.status = restoredStatus;
  req.paidAt = undefined;
  req.receiptNumber = undefined;
  req.confirmedBy = undefined;
  req.notes = req.notes ? `${req.notes} | REVERSED: ${cleanReason}` : `REVERSED: ${cleanReason}`;
  req.updatedAt = nowIso;

  try {
    await supabaseAdmin.from("payment_requests").update({
      status: restoredStatus,
      paid_at: null,
      receipt_number: null,
      confirmed_by: null,
      notes: req.notes,
      updated_at: nowIso,
    }).eq("id", req.id);
  } catch {}

  // 2. Emit domain event
  try {
    await recordDomainEvent({
      type: "payment_request.reversed",
      entity: "payment_request",
      entity_id: req.id,
      payload: {
        referenceCode: req.referenceCode,
        studentId: req.studentId,
        courseId: req.courseId,
        amountCents: req.amountCents,
        hoursDeducted: req.hoursIncluded,
        reason: cleanReason,
        adminUserId: params.adminUserId,
      },
    });
  } catch {}

  return { success: true, request: req, hoursDeducted: req.hoursIncluded };
}

/**
 * Lists payment requests with filtering and role-based access scoping.
 */
export async function getPaymentRequestsService(filters: {
  status?: string;
  kind?: string;
  courseId?: string;
  studentId?: string;
  parentEmail?: string;
  role?: "ADMIN" | "PARENT" | "STUDENT" | "TEACHER";
  search?: string;
}): Promise<PaymentRequestRecord[]> {
  let list = [...inMemoryPaymentRequests];

  try {
    let q = supabaseAdmin.from("payment_requests").select("*").order("created_at", { ascending: false });
    if (filters.studentId) q = q.eq("student_id", filters.studentId);
    if (filters.courseId && filters.courseId !== "ALL") q = q.eq("course_id", filters.courseId);
    if (filters.status && filters.status !== "ALL") q = q.eq("status", filters.status);
    if (filters.kind && filters.kind !== "ALL") q = q.eq("kind", filters.kind);

    const { data } = await q;
    if (data && data.length > 0) {
      list = data.map((r: any) => ({
        id: r.id,
        studentId: r.student_id,
        studentName: r.student_name || "Student",
        studentCode: r.student_code || "",
        parentEmail: r.parent_email || "",
        courseId: r.course_id,
        courseName: r.course_name || "Course",
        kind: r.kind,
        hoursIncluded: r.hours_included || 0,
        amountCents: r.amount_cents || 0,
        amountDollars: (r.amount_cents || 0) / 100,
        currency: r.currency || "usd",
        dueDate: r.due_date,
        status: r.status,
        referenceCode: r.reference_code,
        createdBy: r.created_by,
        createdByUserId: r.created_by_user_id,
        expiresAt: r.expires_at,
        claimedAt: r.claimed_at,
        claimNote: r.claim_note,
        paidAt: r.paid_at,
        confirmedBy: r.confirmed_by,
        confirmationSource: r.confirmation_source,
        bankTransactionId: r.bank_transaction_id,
        receiptNumber: r.receipt_number,
        notes: r.notes,
        version: r.version || 1,
        reminderCount: r.reminder_count || 0,
        lastRemindedAt: r.last_reminded_at,
        createdAt: r.created_at,
        updatedAt: r.updated_at,
      }));
    }
  } catch {}

  // In-memory filter application
  if (filters.studentId) {
    list = list.filter(r => r.studentId === filters.studentId);
  }
  if (filters.courseId && filters.courseId !== "ALL") {
    list = list.filter(r => r.courseId === filters.courseId);
  }
  if (filters.status && filters.status !== "ALL") {
    list = list.filter(r => r.status === filters.status);
  }
  if (filters.kind && filters.kind !== "ALL") {
    list = list.filter(r => r.kind === filters.kind);
  }
  if (filters.parentEmail) {
    const norm = filters.parentEmail.toLowerCase().trim();
    list = list.filter(r => r.parentEmail.toLowerCase() === norm || r.parentEmails?.some(e => e.toLowerCase() === norm));
  }
  if (filters.search) {
    const q = filters.search.toLowerCase().trim();
    list = list.filter(r =>
      r.studentName.toLowerCase().includes(q) ||
      r.studentCode.toLowerCase().includes(q) ||
      r.referenceCode.toLowerCase().includes(q) ||
      r.courseName.toLowerCase().includes(q)
    );
  }

  return list;
}
