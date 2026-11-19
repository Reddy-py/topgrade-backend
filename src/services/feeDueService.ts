import { supabaseAdmin } from "../supabase.js";
import { resolveStudent, inMemoryStudentStore } from "./studentService.js";
import { normEmail } from "./studentAccounts.js";
import { isRealEmail } from "../constants/domains.js";
import { dispatchMultiChannelNotification } from "./notificationService.js";
import { applyTokens } from "./tokenService.js";
import { getCachedInstituteSettings } from "./instituteSettingsService.js";

export type FeeDueStatus =
  | "UPCOMING"
  | "REMINDED_1"
  | "REMINDED_2"
  | "PAID"
  | "WAIVED"
  | "CANCELLED"
  | "OVERDUE";

export type PaymentMethod =
  | "cash"
  | "cheque"
  | "bank_transfer_neft"
  | "zelle"
  | "other";

export interface FeeDueRecord {
  id: string;
  studentId: string;
  studentName: string;
  studentCode: string;
  parentEmail: string;
  courseId: string;
  courseName: string;
  amountDollars: number;
  currency: string;
  dueDate: string;
  status: FeeDueStatus;
  invoiceRef: string; // e.g. TG-8K2M9P
  notes?: string | undefined;
  paidAt?: string | undefined;
  paymentMethod?: PaymentMethod | undefined;
  bankReference?: string | undefined;
  receiptNo?: string | undefined;
  hoursIncluded: number;
  hoursCredited: number;
  hourlyRateCents: number;
  reminder1At?: string | undefined;
  reminder2At?: string | undefined;
  unpaidReason?: string | undefined;
  hasPendingClaim?: boolean | undefined;
  createdBy?: string | undefined;
  createdAt: string;
  updatedAt: string;
}

export interface FeeDueClaimRecord {
  id: string;
  feeDueId: string;
  studentId: string;
  parentEmail: string;
  amount: number;
  zelleMemo?: string | undefined;
  claimTimestamp: string;
  status: "PENDING_VERIFICATION" | "VERIFIED" | "REJECTED";
  verifiedBy?: string | undefined;
  verifiedAt?: string | undefined;
  notes?: string | undefined;
}

// In-memory fallback stores for offline testing and development
export const inMemoryFeeDues: FeeDueRecord[] = [];
export const inMemoryFeeDueClaims: FeeDueClaimRecord[] = [];

/**
 * Generates an uppercase 6-character alphanumeric reference formatted as TG-XXXXXX
 */
export function generateFeeInvoiceRef(): string {
  const chars = "23456789ABCDEFGHJKLMNPQRSTUVWXYZ"; // exclude easily confused chars like 0/O, 1/I
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
    return new Date().toISOString().split("T")[0] || "2026-11-19";
  }
}

/**
 * List fee dues with comprehensive filters
 */
export async function listFeeDuesService(filters: {
  status?: string | undefined;
  studentId?: string | undefined;
  courseId?: string | undefined;
  overdueOnly?: boolean | undefined;
  dueInDays?: number | undefined;
  search?: string | undefined;
  notPaidAfter2Reminders?: boolean | undefined;
  noReminderYet?: boolean | undefined;
}): Promise<FeeDueRecord[]> {
  const todayStr = getChicagoTodayStr();
  let list: FeeDueRecord[] = [];

  // Try DB query with 2s timeout
  try {
    const timeoutPromise = new Promise<any>((resolve) =>
      setTimeout(() => resolve({ data: null, error: new Error("DB timeout") }), 2000)
    );
    const queryPromise = supabaseAdmin.from("fee_dues").select("*").order("due_date", { ascending: true });
    const { data, error } = await Promise.race([queryPromise, timeoutPromise]);

    if (!error && Array.isArray(data)) {
      list = data.map((r: any) => ({
        id: r.id,
        studentId: r.student_id,
        studentName: r.student_name || "Student",
        studentCode: r.student_code || "",
        parentEmail: r.parent_email || "",
        courseId: r.course_id || "GENERAL",
        courseName: r.course_name || "Course Tuition",
        amountDollars: Number(r.amount_dollars) || 0,
        currency: r.currency || "USD",
        dueDate: r.due_date,
        status: r.status as FeeDueStatus,
        invoiceRef: r.invoice_ref,
        notes: r.notes || "",
        paidAt: r.paid_at,
        paymentMethod: r.payment_method,
        bankReference: r.bank_reference,
        receiptNo: r.receipt_no,
        hoursIncluded: Number(r.hours_included) || 0,
        hoursCredited: Number(r.hours_credited) || 0,
        hourlyRateCents: Number(r.hourly_rate_cents) || 0,
        reminder1At: r.reminder_1_at,
        reminder2At: r.reminder_2_at,
        unpaidReason: r.unpaid_reason,
        createdBy: r.created_by,
        createdAt: r.created_at,
        updatedAt: r.updated_at,
      }));
    }
  } catch {}

  if (list.length === 0) {
    list = [...inMemoryFeeDues];
  }

  // Check claims
  const pendingClaimsSet = new Set(
    inMemoryFeeDueClaims.filter((c) => c.status === "PENDING_VERIFICATION").map((c) => c.feeDueId)
  );

  // Dynamically evaluate OVERDUE status for unpaid records past due date
  list = list.map((due) => {
    let currentStatus = due.status;
    if (
      ["UPCOMING", "REMINDED_1", "REMINDED_2"].includes(currentStatus) &&
      due.dueDate < todayStr
    ) {
      currentStatus = "OVERDUE";
    }
    return {
      ...due,
      status: currentStatus,
      hasPendingClaim: pendingClaimsSet.has(due.id),
    };
  });

  // Apply filters
  if (filters.status) {
    const targetStatus = filters.status.toUpperCase();
    list = list.filter((d) => d.status.toUpperCase() === targetStatus);
  }
  if (filters.studentId) {
    const sId = filters.studentId.trim().toLowerCase();
    list = list.filter(
      (d) => d.studentId.toLowerCase() === sId || d.studentCode.toLowerCase() === sId
    );
  }
  if (filters.courseId) {
    const cId = filters.courseId.trim().toLowerCase();
    list = list.filter(
      (d) => d.courseId.toLowerCase() === cId || d.courseName.toLowerCase().includes(cId)
    );
  }
  if (filters.overdueOnly) {
    list = list.filter((d) => d.status === "OVERDUE" || (d.dueDate < todayStr && d.status !== "PAID" && d.status !== "WAIVED"));
  }
  if (filters.dueInDays !== undefined) {
    const targetDate = new Date();
    targetDate.setDate(targetDate.getDate() + filters.dueInDays);
    const targetDateStr = targetDate.toISOString().split("T")[0]!;
    list = list.filter((d) => d.dueDate <= targetDateStr && d.dueDate >= todayStr && d.status !== "PAID");
  }
  if (filters.notPaidAfter2Reminders) {
    list = list.filter((d) => d.status === "REMINDED_2" || (d.reminder2At && d.status !== "PAID"));
  }
  if (filters.noReminderYet) {
    list = list.filter((d) => d.status === "UPCOMING" && !d.reminder1At);
  }
  if (filters.search) {
    const q = filters.search.trim().toLowerCase();
    list = list.filter(
      (d) =>
        d.studentName.toLowerCase().includes(q) ||
        d.studentCode.toLowerCase().includes(q) ||
        d.parentEmail.toLowerCase().includes(q) ||
        d.invoiceRef.toLowerCase().includes(q) ||
        d.courseName.toLowerCase().includes(q)
    );
  }

  return list;
}

/**
 * Creates a new fee due for a student and course
 */
export async function createFeeDueService(params: {
  studentId: string;
  courseId: string;
  courseName?: string | undefined;
  amountDollars: number;
  dueDate: string;
  hoursIncluded?: number | undefined;
  hourlyRateDollars?: number | undefined;
  notes?: string | undefined;
  createdBy?: string | undefined;
}): Promise<FeeDueRecord> {
  const student = await resolveStudent(params.studentId);
  if (!student) {
    throw new Error(`Student '${params.studentId}' not found.`);
  }

  const pEmail = student.parentEmails?.[0] || student.email || "";
  const invoiceRef = generateFeeInvoiceRef();
  const hoursInc = Number(params.hoursIncluded) || 0;
  const rateCents = Math.round((Number(params.hourlyRateDollars) || 0) * 100);

  const due: FeeDueRecord = {
    id: `fd-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
    studentId: student.id || params.studentId,
    studentName: student.fullName,
    studentCode: student.studentCode || "",
    parentEmail: pEmail,
    courseId: params.courseId,
    courseName: params.courseName || params.courseId,
    amountDollars: Number(params.amountDollars),
    currency: "USD",
    dueDate: params.dueDate,
    status: "UPCOMING",
    invoiceRef,
    notes: params.notes || "",
    hoursIncluded: hoursInc,
    hoursCredited: 0,
    hourlyRateCents: rateCents,
    createdBy: params.createdBy,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };

  inMemoryFeeDues.push(due);

  // Try DB insert
  try {
    const { data } = await supabaseAdmin
      .from("fee_dues")
      .insert({
        student_id: due.studentId,
        student_name: due.studentName,
        student_code: due.studentCode,
        parent_email: due.parentEmail,
        course_id: due.courseId,
        course_name: due.courseName,
        amount_dollars: due.amountDollars,
        currency: due.currency,
        due_date: due.dueDate,
        status: due.status,
        invoice_ref: due.invoiceRef,
        notes: due.notes,
        hours_included: due.hoursIncluded,
        hours_credited: 0,
        hourly_rate_cents: due.hourlyRateCents,
        created_by: due.createdBy,
      })
      .select()
      .maybeSingle();

    if (data?.id) due.id = data.id;
  } catch {}

  return due;
}

/**
 * Marks a fee due as PAID: records timestamp, method, receipt;
 * CREDITS hours_included via tokenService.applyTokens;
 * dispatches receipt email.
 */
export async function markFeeDuePaidService(params: {
  feeDueId: string;
  paymentMethod: PaymentMethod;
  bankReference?: string | undefined;
  receiptNo?: string | undefined;
  notes?: string | undefined;
  adminUserId?: string | undefined;
}): Promise<FeeDueRecord> {
  const dues = await listFeeDuesService({});
  const due = dues.find((d) => d.id === params.feeDueId || d.invoiceRef === params.feeDueId);
  if (!due) {
    throw new Error(`Fee due '${params.feeDueId}' not found.`);
  }

  if (due.status === "PAID") {
    throw new Error(`Fee due '${due.invoiceRef}' is already marked as PAID.`);
  }

  const receiptNo = params.receiptNo || `REC-${due.invoiceRef}`;
  const paidAt = new Date().toISOString();

  // 1. Credit lesson hours through tokenService.applyTokens
  if (due.hoursIncluded > 0) {
    await applyTokens({
      studentId: due.studentId,
      courseId: due.courseId,
      delta: due.hoursIncluded,
      reason: "MANUAL_CREDIT",
      ref: `FEE_DUE_${due.invoiceRef}`,
      by: params.adminUserId ?? null,
      note: `Fee Payment Received (${params.paymentMethod.toUpperCase()} - ${receiptNo}): ${due.hoursIncluded} hours added`,
    });
  }

  due.status = "PAID";
  due.paidAt = paidAt;
  due.paymentMethod = params.paymentMethod;
  due.receiptNo = receiptNo;
  due.bankReference = params.bankReference;
  due.hoursCredited = due.hoursIncluded;
  due.updatedAt = paidAt;

  // Update in-memory
  const memIdx = inMemoryFeeDues.findIndex((d) => d.id === due.id);
  if (memIdx >= 0) inMemoryFeeDues[memIdx] = { ...due };

  // Update DB
  try {
    await supabaseAdmin
      .from("fee_dues")
      .update({
        status: "PAID",
        paid_at: paidAt,
        payment_method: params.paymentMethod,
        receipt_no: receiptNo,
        bank_reference: params.bankReference || null,
        hours_credited: due.hoursIncluded,
        updated_at: paidAt,
      })
      .eq("id", due.id);
  } catch {}

  // 2. Dispatch Official Payment Receipt Email
  const settings = getCachedInstituteSettings();
  const recipientEmail = normEmail(due.parentEmail);
  if (recipientEmail && isRealEmail(recipientEmail)) {
    const subject = `Official Payment Receipt: ${receiptNo} (${due.studentName}) — ${settings.institute_name}`;
    const body =
      `Dear Parent / Guardian,\n\n` +
      `Thank you for your payment. We have received payment for ${due.studentName} for ${due.courseName}.\n\n` +
      `Payment Receipt Details:\n` +
      `----------------------------------------\n` +
      `Receipt Number:  ${receiptNo}\n` +
      `Invoice Ref:     ${due.invoiceRef}\n` +
      `Amount Paid:     $${due.amountDollars.toFixed(2)} USD\n` +
      `Payment Method:  ${params.paymentMethod.toUpperCase()}\n` +
      `Date:            ${paidAt.split("T")[0]}\n` +
      `Hours Credited:  ${due.hoursIncluded} hour(s) added to lesson balance\n` +
      `----------------------------------------\n\n` +
      `You can view your updated hours wallet and course progress in the TopGrade Parent Portal.\n\n` +
      `Sincerely,\n` +
      `${settings.institute_name}\n` +
      `${settings.address_line1}, ${settings.city}, ${settings.state} ${settings.zip}\n` +
      `${settings.phone}`;

    await dispatchMultiChannelNotification({
      eventType: "ADMISSION_APPROVED", // maps to receipt
      subject,
      message: body,
      escapeMessage: true,
      recipients: [
        {
          role: "PARENT",
          email: recipientEmail,
          name: due.studentName,
          phone: "",
        },
      ],
    }).catch(() => undefined);
  }

  return due;
}

/**
 * Reverses a paid fee due (unpay): requires mandatory reason,
 * REVERSES credited hours via tokenService.applyTokens,
 * restores status.
 */
export async function unmarkFeeDuePaidService(params: {
  feeDueId: string;
  reason: string;
  adminUserId?: string | undefined;
}): Promise<FeeDueRecord> {
  const cleanReason = (params.reason || "").trim();
  if (!cleanReason) {
    throw new Error("A mandatory reason is required to reverse a payment.");
  }

  const dues = await listFeeDuesService({});
  const due = dues.find((d) => d.id === params.feeDueId || d.invoiceRef === params.feeDueId);
  if (!due) {
    throw new Error(`Fee due '${params.feeDueId}' not found.`);
  }

  if (due.status !== "PAID") {
    throw new Error(`Fee due '${due.invoiceRef}' is not in PAID status.`);
  }

  // 1. Reverse hours credited
  if (due.hoursCredited > 0) {
    await applyTokens({
      studentId: due.studentId,
      courseId: due.courseId,
      delta: -due.hoursCredited,
      reason: "ADJUSTMENT",
      ref: `FEE_DUE_REVERSAL_${due.invoiceRef}`,
      by: params.adminUserId ?? null,
      note: `Payment Reversed for ${due.invoiceRef}. Reason: ${cleanReason}`,
    });
  }

  const todayStr = getChicagoTodayStr();
  const restoredStatus: FeeDueStatus = due.dueDate < todayStr ? "OVERDUE" : "UPCOMING";
  const nowStr = new Date().toISOString();

  due.status = restoredStatus;
  due.paidAt = undefined;
  due.paymentMethod = undefined;
  due.unpaidReason = cleanReason;
  due.hoursCredited = 0;
  due.updatedAt = nowStr;

  // Update in-memory
  const memIdx = inMemoryFeeDues.findIndex((d) => d.id === due.id);
  if (memIdx >= 0) inMemoryFeeDues[memIdx] = { ...due };

  // Update DB
  try {
    await supabaseAdmin
      .from("fee_dues")
      .update({
        status: restoredStatus,
        paid_at: null,
        payment_method: null,
        unpaid_reason: cleanReason,
        hours_credited: 0,
        updated_at: nowStr,
      })
      .eq("id", due.id);
  } catch {}

  return due;
}

/**
 * Parent flow: Records a Zelle payment claim with TG-XXXXXX reference memo.
 * Stays unpaid until verified by admin.
 */
export async function recordParentZelleClaimService(params: {
  feeDueId: string;
  studentId: string;
  parentEmail: string;
  amount: number;
  zelleMemo?: string | undefined;
  notes?: string | undefined;
}): Promise<FeeDueClaimRecord> {
  const dues = await listFeeDuesService({});
  const due = dues.find((d) => d.id === params.feeDueId || d.invoiceRef === params.feeDueId);
  if (!due) {
    throw new Error(`Fee due '${params.feeDueId}' not found.`);
  }

  const claim: FeeDueClaimRecord = {
    id: `claim-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
    feeDueId: due.id,
    studentId: due.studentId,
    parentEmail: normEmail(params.parentEmail),
    amount: Number(params.amount) || due.amountDollars,
    zelleMemo: params.zelleMemo || due.invoiceRef,
    claimTimestamp: new Date().toISOString(),
    status: "PENDING_VERIFICATION",
    notes: params.notes || "Parent reported Zelle transfer submitted",
  };

  inMemoryFeeDueClaims.push(claim);

  // Try DB insert
  try {
    await supabaseAdmin.from("fee_due_claims").insert({
      id: claim.id,
      fee_due_id: claim.feeDueId,
      student_id: claim.studentId,
      parent_email: claim.parentEmail,
      amount: claim.amount,
      zelle_memo: claim.zelleMemo,
      status: claim.status,
      notes: claim.notes,
    });
  } catch {}

  return claim;
}

/**
 * Runs the daily automatic reminder scan (at 9:00 AM Central, America/Chicago):
 * Claims daily job so it executes once per day.
 * Day -14: Sends Reminder 1 (UPCOMING -> REMINDED_1)
 * Day -7: Sends Reminder 2 (REMINDED_1 -> REMINDED_2)
 */
export async function runAutomaticFeeReminderScanService(opts?: {
  forceRun?: boolean;
  referenceDateStr?: string;
}): Promise<{
  reminder1Sent: number;
  reminder2Sent: number;
  overdueCount: number;
  details: string[];
}> {
  const todayStr = opts?.referenceDateStr || getChicagoTodayStr();
  const details: string[] = [];
  let reminder1Sent = 0;
  let reminder2Sent = 0;
  let overdueCount = 0;

  // Claim daily execution via daily_job_claims
  if (!opts?.forceRun) {
    try {
      const { data, error } = await supabaseAdmin
        .from("daily_job_claims")
        .insert({
          job_name: "fee_due_reminders",
          claim_date: todayStr,
        })
        .select()
        .maybeSingle();

      if (error || !data) {
        details.push(`Daily fee reminder scan already executed for ${todayStr}. Skipping.`);
        return { reminder1Sent: 0, reminder2Sent: 0, overdueCount: 0, details };
      }
    } catch {}
  }

  const dues = await listFeeDuesService({});
  const todayDate = new Date(todayStr);
  const settings = getCachedInstituteSettings();

  for (const due of dues) {
    if (["PAID", "WAIVED", "CANCELLED"].includes(due.status)) continue;

    const dueDate = new Date(due.dueDate);
    const diffTime = dueDate.getTime() - todayDate.getTime();
    const diffDays = Math.round(diffTime / (1000 * 60 * 60 * 24));

    const pEmail = normEmail(due.parentEmail);
    const hasValidEmail = pEmail && isRealEmail(pEmail);

    // Case 1: Day -14 (between 14 and 8 days before due date) & status UPCOMING
    if (diffDays <= 14 && diffDays > 7 && due.status === "UPCOMING" && !due.reminder1At) {
      if (hasValidEmail) {
        const subject = `Fee Reminder: Tuition Due in ${diffDays} Days for ${due.studentName} (${due.invoiceRef})`;
        const body =
          `Dear Parent / Guardian,\n\n` +
          `This is a friendly reminder that the tuition fee for ${due.studentName} for course ${due.courseName} is due in ${diffDays} days on ${due.dueDate}.\n\n` +
          `Invoice Summary:\n` +
          `----------------------------------------\n` +
          `Student:         ${due.studentName} (${due.studentCode})\n` +
          `Course:          ${due.courseName}\n` +
          `Amount Due:      $${due.amountDollars.toFixed(2)} USD\n` +
          `Due Date:        ${due.dueDate}\n` +
          `Hours Included:  ${due.hoursIncluded} hour(s)\n` +
          `----------------------------------------\n\n` +
          `HOW TO PAY VIA ZELLE (Quickest & Fee-Free):\n` +
          `1. Open your bank's mobile app and select Send Money with Zelle.\n` +
          `2. Send payment to: ${settings.zelle_email || settings.support_email} (or Phone: ${settings.zelle_phone})\n` +
          `3. Recipient Name:  ${settings.zelle_display_name}\n` +
          `4. IMPORTANT MEMO:   Type "${due.invoiceRef}" in the Zelle memo field so your payment is automatically attributed.\n\n` +
          `Thank you for being part of Top Grade Learning.\n\n` +
          `Warm regards,\n` +
          `${settings.institute_name} Billing Team`;

        await dispatchMultiChannelNotification({
          eventType: "ADMISSION_APPROVED",
          subject,
          message: body,
          escapeMessage: true,
          recipients: [{ role: "PARENT", email: pEmail, name: due.studentName, phone: "" }],
        }).catch(() => undefined);

        const nowIso = new Date().toISOString();
        due.status = "REMINDED_1";
        due.reminder1At = nowIso;
        const memIdx = inMemoryFeeDues.findIndex(d => d.id === due.id);
        if (memIdx >= 0) {
          const m = inMemoryFeeDues[memIdx];
          if (m) {
            m.status = "REMINDED_1";
            m.reminder1At = nowIso;
          }
        }
        supabaseAdmin.from("fee_dues").update({ status: "REMINDED_1", reminder_1_at: nowIso }).eq("id", due.id).then(() => undefined, () => undefined);
        reminder1Sent++;
        details.push(`Reminder 1 sent to ${pEmail} for ${due.studentName} ($${due.amountDollars})`);
      }
    }

    // Case 2: Day -7 (between 7 and 1 days before due date) & status REMINDED_1
    else if (diffDays <= 7 && diffDays > 0 && due.status === "REMINDED_1" && !due.reminder2At) {
      if (hasValidEmail) {
        const subject = `Urgent Fee Reminder: Tuition Due in ${diffDays} Days (${due.studentName} - ${due.invoiceRef})`;
        const body =
          `Dear Parent / Guardian,\n\n` +
          `This is the second reminder regarding the upcoming tuition fee for ${due.studentName} (${due.courseName}), due in ${diffDays} days on ${due.dueDate}.\n\n` +
          `Invoice Ref:  ${due.invoiceRef}\n` +
          `Amount:       $${due.amountDollars.toFixed(2)} USD\n` +
          `Due Date:     ${due.dueDate}\n\n` +
          `Please send your Zelle payment to ${settings.zelle_email || settings.support_email} with memo "${due.invoiceRef}".\n\n` +
          `If you have already transferred this payment, please disregard this notice.\n\n` +
          `Sincerely,\n${settings.institute_name}`;

        await dispatchMultiChannelNotification({
          eventType: "ADMISSION_APPROVED",
          subject,
          message: body,
          escapeMessage: true,
          recipients: [{ role: "PARENT", email: pEmail, name: due.studentName, phone: "" }],
        }).catch(() => undefined);

        const nowIso = new Date().toISOString();
        due.status = "REMINDED_2";
        due.reminder2At = nowIso;
        const memIdx = inMemoryFeeDues.findIndex(d => d.id === due.id);
        if (memIdx >= 0) {
          const m = inMemoryFeeDues[memIdx];
          if (m) {
            m.status = "REMINDED_2";
            m.reminder2At = nowIso;
          }
        }
        supabaseAdmin.from("fee_dues").update({ status: "REMINDED_2", reminder_2_at: nowIso }).eq("id", due.id).then(() => undefined, () => undefined);
        reminder2Sent++;
        details.push(`Reminder 2 sent to ${pEmail} for ${due.studentName} ($${due.amountDollars})`);
      }
    }

    // Case 3: Due date passed -> Mark OVERDUE
    else if (diffDays <= 0 && due.status !== "OVERDUE") {
      due.status = "OVERDUE";
      const memIdx = inMemoryFeeDues.findIndex(d => d.id === due.id);
      if (memIdx >= 0) {
        const m = inMemoryFeeDues[memIdx];
        if (m) {
          m.status = "OVERDUE";
        }
      }
      supabaseAdmin.from("fee_dues").update({ status: "OVERDUE" }).eq("id", due.id).then(() => undefined, () => undefined);
      overdueCount++;
    }
  }

  return { reminder1Sent, reminder2Sent, overdueCount, details };
}

/**
 * Bank CSV Statement Reconciliation: Parses statement text,
 * detects TG-XXXXXX invoice references in the memo or sender name + amount match,
 * suggests matches for admin confirmation (never auto-confirms).
 */
export async function reconcileBankCsvService(csvContent: string): Promise<{
  totalRows: number;
  matchedCount: number;
  unmatchedCount: number;
  matches: Array<{
    bankRowIndex: number;
    transactionDate: string;
    description: string;
    amount: number;
    matchedFeeDue?: FeeDueRecord;
    matchConfidence: "STRONG_MATCH" | "POSSIBLE_MATCH";
    matchReason: string;
  }>;
  unmatchedRows: Array<{
    bankRowIndex: number;
    transactionDate: string;
    description: string;
    amount: number;
  }>;
}> {
  const dues = await listFeeDuesService({});
  const unpaidDues = dues.filter((d) => d.status !== "PAID" && d.status !== "WAIVED");

  const lines = csvContent.split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
  const matches: any[] = [];
  const unmatchedRows: any[] = [];

  for (let i = 1; i < lines.length; i++) {
    const cols = lines[i]!.split(",").map((c) => c.replace(/^["']|["']$/g, "").trim());
    if (cols.length < 3) continue;

    // Detect date, description, amount
    const dateStr = cols[0] || "";
    const description = cols[1] || "";
    const amountVal = parseFloat(cols[2]?.replace(/[^0-9.-]+/g, "") || "0");

    if (isNaN(amountVal) || amountVal <= 0) continue;

    // 1. Try finding TG-XXXXXX reference in description
    const refMatch = description.match(/TG-[A-Z0-9]{6}/i);
    let matchedDue: FeeDueRecord | undefined;
    let confidence: "STRONG_MATCH" | "POSSIBLE_MATCH" = "POSSIBLE_MATCH";
    let matchReason = "";

    if (refMatch) {
      const foundRef = refMatch[0].toUpperCase();
      matchedDue = unpaidDues.find((d) => d.invoiceRef.toUpperCase() === foundRef);
      if (matchedDue) {
        confidence = Math.abs(matchedDue.amountDollars - amountVal) < 0.01 ? "STRONG_MATCH" : "POSSIBLE_MATCH";
        matchReason = `Exact invoice reference ${foundRef} matched in bank memo`;
      }
    }

    // 2. Fallback: match by student or parent name + exact amount
    if (!matchedDue) {
      matchedDue = unpaidDues.find(
        (d) =>
          Math.abs(d.amountDollars - amountVal) < 0.01 &&
          (description.toLowerCase().includes(d.studentName.toLowerCase()) ||
            description.toLowerCase().includes(d.studentCode.toLowerCase()))
      );
      if (matchedDue) {
        confidence = "POSSIBLE_MATCH";
        matchReason = `Student name and exact amount ($${amountVal}) matched`;
      }
    }

    if (matchedDue) {
      matches.push({
        bankRowIndex: i,
        transactionDate: dateStr,
        description,
        amount: amountVal,
        matchedFeeDue: matchedDue,
        matchConfidence: confidence,
        matchReason,
      });
    } else {
      unmatchedRows.push({
        bankRowIndex: i,
        transactionDate: dateStr,
        description,
        amount: amountVal,
      });
    }
  }

  return {
    totalRows: lines.length - 1,
    matchedCount: matches.length,
    unmatchedCount: unmatchedRows.length,
    matches,
    unmatchedRows,
  };
}
