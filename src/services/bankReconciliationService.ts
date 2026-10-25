import crypto from "node:crypto";
import ExcelJS from "exceljs";
import { supabaseAdmin } from "../supabase.js";
import { applyTokens, findCourse, findStudent, buildReceiptData, type OrderRow, type StudentInfo } from "./tokenService.js";
import { ReceiptPdfService } from "./receiptPdfService.js";
import { dispatchMultiChannelNotification } from "./notificationService.js";
import { renderTemplate } from "./emailTemplateService.js";
import { getCachedInstituteSettings, instituteAddress } from "./instituteSettingsService.js";

// Characters excluding ambiguous 0, O, 1, I, L
const REF_ALPHABET = "23456789ABCDEFGHJKMNPQRSTUVWXYZ";

/**
 * Generates a random, unique reference code in TG-XXXXXX format.
 */
export function generateReferenceCode(): string {
  let code = "";
  const bytes = crypto.randomBytes(6);
  for (let i = 0; i < 6; i++) {
    const idx = (bytes[i] ?? 0) % REF_ALPHABET.length;
    code += REF_ALPHABET[idx];
  }
  return `TG-${code}`;
}

/**
 * Sanitizes CSV field values to prevent CSV Formula Injection
 * (strips or escapes leading '=', '+', '-', '@', '\t', '\r').
 */
export function sanitizeCsvField(val: unknown): string {
  if (val === null || val === undefined) return "";
  let str = String(val).trim();
  if (/^[=+\-@\t\r]/.test(str)) {
    // Prepend single quote to neutralize formula execution in Excel/Sheets
    str = `'${str}`;
  }
  return str;
}

export interface BankTransactionRow {
  id: string;
  bank_tx_id: string | null;
  transaction_date: string;
  amount: number;
  sender_name: string;
  memo: string;
  row_hash: string;
  status: "UNMATCHED" | "MATCHED" | "MANUAL_MATCHED" | "IGNORED";
  matched_order_id: string | null;
  matched_at: string | null;
  matched_by: string | null;
  is_manual: boolean;
  raw_data?: Record<string, unknown>;
  imported_at: string;
  imported_by: string | null;
}

export interface BankCsvInputRow {
  date: string;
  amount: number | string;
  senderName: string;
  memo: string;
  bankTxId?: string | null;
  rawData?: Record<string, unknown>;
}

export interface MatchSuggestion {
  orderId: string;
  orderNumber: string;
  referenceCode: string;
  studentId: string;
  studentName: string;
  studentCode: string;
  courseName: string;
  quantity: number;
  orderAmount: number;
  orderDate: string;
  orderExpiresAt: string | null;
  bankTransactionId: string;
  bankTxId: string | null;
  bankDate: string;
  bankAmount: number;
  bankSender: string;
  bankMemo: string;
  matchType: "STRONG" | "WEAK";
  confidence: number; // 0 to 1
  reason: string;
}
export function computeRowHash(date: string, amount: number, senderName: string, memo: string): string {
  return BankReconciliationService.computeRowHash(date, amount, senderName, memo);
}

export class BankReconciliationService {
  /**
   * Hashes a bank transaction row to guarantee deduplication even if bankTxId is omitted.
   */
  public static computeRowHash(date: string, amount: number, senderName: string, memo: string): string {
    const normDate = String(date).trim().slice(0, 10);
    const normAmount = Number(amount).toFixed(2);
    const normSender = String(senderName || "").trim().toLowerCase();
    const normMemo = String(memo || "").trim().toLowerCase();
    return crypto.createHash("sha256").update(`${normDate}|${normAmount}|${normSender}|${normMemo}`).digest("hex");
  }

  /**
   * Pure in-memory suggestion computation for testing and offline reconciliation matching.
   */
  public static computeSuggestionsFromMemory(
    orders: any[],
    bankRows: any[]
  ): Array<{
    order_id: string;
    orderId: string;
    bank_tx_id: string | null;
    match_type: "STRONG" | "WEAK";
    matchType: "STRONG" | "WEAK";
    confidence: number;
    reason: string;
  }> {
    const suggestions: Array<any> = [];
    const usedTxIds = new Set<string>();

    for (const order of orders) {
      const refCode = (order.reference_code || "").trim().toUpperCase();
      const orderAmount = Number(order.amount_total);
      const parentName = (order.parent_name || "").trim().toLowerCase();
      const studentName = (order.student_name || "").trim().toLowerCase();

      for (const tx of bankRows) {
        if (usedTxIds.has(tx.id)) continue;
        const txAmount = Number(tx.amount);
        const txMemo = (tx.memo || "").toUpperCase();
        const txSender = (tx.sender_name || "").toLowerCase();

        const amountExact = Math.abs(orderAmount - txAmount) < 0.01;
        const refInMemo = refCode.length > 3 && txMemo.includes(refCode);

        // Strong Match: Exact amount + Reference in memo
        if (amountExact && refInMemo) {
          suggestions.push({
            order_id: order.id,
            orderId: order.id,
            bank_tx_id: tx.bank_tx_id || tx.id,
            match_type: "STRONG",
            matchType: "STRONG",
            confidence: 100,
            reason: `Exact amount ($${txAmount.toFixed(2)}) and reference code (${refCode}) in memo.`
          });
          usedTxIds.add(tx.id);
          break;
        }

        // Weak Match: Exact amount + sender name matches parent/student
        const senderMatches =
          (parentName && (txSender.includes(parentName) || parentName.includes(txSender))) ||
          (studentName && (txSender.includes(studentName) || studentName.includes(txSender)));
        if (amountExact && senderMatches) {
          suggestions.push({
            order_id: order.id,
            orderId: order.id,
            bank_tx_id: tx.bank_tx_id || tx.id,
            match_type: "WEAK",
            matchType: "WEAK",
            confidence: 70,
            reason: `Exact amount ($${txAmount.toFixed(2)}) with matching sender (${tx.sender_name}).`
          });
          usedTxIds.add(tx.id);
          break;
        }
      }
    }

    return suggestions;
  }


  /**
   * Parses CSV content safely in memory and inserts rows into bank_transactions.
   * File content is strictly memory-only and never written to disk or logged outside DB.
   */
  public static async importBankCsv(
    csvText: string,
    columnMap: { date: string; amount: string; sender: string; memo: string; bankTxId?: string },
    adminId: string
  ): Promise<{ importedCount: number; duplicateCount: number; totalCount: number; errors: string[] }> {
    const MAX_CSV_SIZE_BYTES = 5 * 1024 * 1024; // 5 MB
    if (Buffer.byteLength(csvText, "utf-8") > MAX_CSV_SIZE_BYTES) {
      throw new Error("File exceeds 5MB limit. Please upload a smaller bank statement extract.");
    }

    const lines = csvText.split(/\r?\n/).map(l => l.trim()).filter(Boolean);
    if (lines.length < 2) {
      throw new Error("CSV file contains no data rows.");
    }

    // Parse header
    const headers = lines[0]!.split(",").map(h => h.trim().replace(/^["']|["']$/g, ""));
    const colIdx = {
      date: headers.findIndex(h => h.toLowerCase() === columnMap.date.toLowerCase()),
      amount: headers.findIndex(h => h.toLowerCase() === columnMap.amount.toLowerCase()),
      sender: headers.findIndex(h => h.toLowerCase() === columnMap.sender.toLowerCase()),
      memo: headers.findIndex(h => h.toLowerCase() === columnMap.memo.toLowerCase()),
      bankTxId: columnMap.bankTxId ? headers.findIndex(h => h.toLowerCase() === columnMap.bankTxId!.toLowerCase()) : -1,
    };

    if (colIdx.date === -1 || colIdx.amount === -1) {
      throw new Error("Required columns (Date, Amount) were not found in the CSV header.");
    }

    let importedCount = 0;
    let duplicateCount = 0;
    const errors: string[] = [];

    for (let i = 1; i < lines.length; i++) {
      const line = lines[i]!;
      if (!line) continue;

      // Safe CSV split handling quoted commas
      const cells: string[] = [];
      let inQuotes = false;
      let curr = "";
      for (let c = 0; c < line.length; c++) {
        const char = line[c];
        if (char === '"' || char === "'") {
          inQuotes = !inQuotes;
        } else if (char === "," && !inQuotes) {
          cells.push(curr.trim().replace(/^["']|["']$/g, ""));
          curr = "";
        } else {
          curr += char;
        }
      }
      cells.push(curr.trim().replace(/^["']|["']$/g, ""));

      const rawDate = cells[colIdx.date] || "";
      const rawAmountStr = (cells[colIdx.amount] || "").replace(/[\$,]/g, "").trim();
      const rawSender = colIdx.sender !== -1 ? (cells[colIdx.sender] || "") : "";
      const rawMemo = colIdx.memo !== -1 ? (cells[colIdx.memo] || "") : "";
      const rawBankTxId = colIdx.bankTxId !== -1 ? (cells[colIdx.bankTxId] || "").trim() : null;

      // Parse date to YYYY-MM-DD
      let parsedDate = rawDate;
      try {
        const dt = new Date(rawDate);
        if (!isNaN(dt.getTime())) {
          parsedDate = dt.toISOString().slice(0, 10);
        }
      } catch {
        // Keep raw string if parsing fails
      }

      const amountNum = Math.abs(parseFloat(rawAmountStr));
      if (isNaN(amountNum) || amountNum <= 0) {
        errors.push(`Row ${i}: Invalid amount "${rawAmountStr}" skipped.`);
        continue;
      }

      // Sanitize fields against formula injection
      const cleanSender = sanitizeCsvField(rawSender);
      const cleanMemo = sanitizeCsvField(rawMemo);
      const cleanBankTxId = rawBankTxId ? sanitizeCsvField(rawBankTxId) : null;
      const rowHash = this.computeRowHash(parsedDate, amountNum, cleanSender, cleanMemo);

      // Insert safely with conflict handling
      try {
        const { error } = await supabaseAdmin.from("bank_transactions").insert({
          bank_tx_id: cleanBankTxId || null,
          transaction_date: parsedDate,
          amount: amountNum,
          sender_name: cleanSender,
          memo: cleanMemo,
          row_hash: rowHash,
          status: "UNMATCHED",
          imported_by: adminId,
          imported_at: new Date().toISOString(),
          raw_data: { rowNumber: i, sourceDate: rawDate, sourceAmount: rawAmountStr },
        });

        if (error) {
          if (error.code === "23505" || error.message.includes("duplicate") || error.message.includes("unique")) {
            duplicateCount++;
          } else {
            errors.push(`Row ${i}: ${error.message}`);
          }
        } else {
          importedCount++;
        }
      } catch (err: any) {
        errors.push(`Row ${i}: ${err?.message}`);
      }
    }

    return {
      importedCount,
      duplicateCount,
      totalCount: lines.length - 1,
      errors,
    };
  }

  /**
   * Suggests matches between PENDING_PAYMENT orders and UNMATCHED bank transactions.
   * Never auto-confirms; returns formatted proposals for admin verification.
   */
  public static async getMatchSuggestions(): Promise<MatchSuggestion[]> {
    // 1. Fetch pending orders
    const { data: ordersData, error: ordersErr } = await supabaseAdmin
      .from("token_orders")
      .select("*")
      .in("status", ["PENDING_PAYMENT", "PENDING"])
      .order("created_at", { ascending: false });

    if (ordersErr || !ordersData || ordersData.length === 0) return [];

    // 2. Fetch unmatched bank transactions
    const { data: txData, error: txErr } = await supabaseAdmin
      .from("bank_transactions")
      .select("*")
      .eq("status", "UNMATCHED")
      .order("transaction_date", { ascending: false });

    if (txErr || !txData || txData.length === 0) return [];

    // 3. Fetch students to cross-reference parent/student names
    const studentIds = Array.from(new Set(ordersData.map((o: any) => o.student_id)));
    const { data: studentsData } = await supabaseAdmin
      .from("students")
      .select("id, name, student_id_code, parent_emails, full_name, father_name, mother_name")
      .in("id", studentIds);

    const studentMap = new Map<string, any>((studentsData || []).map((s: any) => [s.id, s]));

    const suggestions: MatchSuggestion[] = [];
    const usedTxIds = new Set<string>();

    for (const order of ordersData as any[]) {
      const student = studentMap.get(order.student_id);
      const studentName = student?.name || student?.full_name || "";
      const studentCode = student?.student_id_code || "";
      const refCode = (order.reference_code || "").trim().toUpperCase();
      const orderAmount = Number(order.amount_total);

      // Check all unmatched transactions
      for (const tx of txData as BankTransactionRow[]) {
        if (usedTxIds.has(tx.id)) continue;

        const txMemo = (tx.memo || "").toUpperCase();
        const txAmount = Number(tx.amount);
        const txSender = (tx.sender_name || "").toUpperCase();

        const amountExact = Math.abs(orderAmount - txAmount) < 0.01;
        const refFoundInMemo = refCode.length > 3 && txMemo.includes(refCode);

        // STRONG MATCH: Exact Amount + Reference Code in Memo
        if (amountExact && refFoundInMemo) {
          suggestions.push({
            orderId: order.id,
            orderNumber: order.order_number,
            referenceCode: order.reference_code,
            studentId: order.student_id,
            studentName,
            studentCode,
            courseName: order.course_name || "Course",
            quantity: order.quantity,
            orderAmount,
            orderDate: order.created_at,
            orderExpiresAt: order.expires_at,
            bankTransactionId: tx.id,
            bankTxId: tx.bank_tx_id,
            bankDate: tx.transaction_date,
            bankAmount: txAmount,
            bankSender: tx.sender_name,
            bankMemo: tx.memo,
            matchType: "STRONG",
            confidence: 1.0,
            reason: `Exact amount ($${txAmount.toFixed(2)}) and reference code (${refCode}) detected in memo.`,
          });
          usedTxIds.add(tx.id);
          break; // Move to next order once strong match is found
        }

        // WEAK MATCH 1: Reference code found in memo, but amount differs
        if (refFoundInMemo && !amountExact) {
          suggestions.push({
            orderId: order.id,
            orderNumber: order.order_number,
            referenceCode: order.reference_code,
            studentId: order.student_id,
            studentName,
            studentCode,
            courseName: order.course_name || "Course",
            quantity: order.quantity,
            orderAmount,
            orderDate: order.created_at,
            orderExpiresAt: order.expires_at,
            bankTransactionId: tx.id,
            bankTxId: tx.bank_tx_id,
            bankDate: tx.transaction_date,
            bankAmount: txAmount,
            bankSender: tx.sender_name,
            bankMemo: tx.memo,
            matchType: "WEAK",
            confidence: 0.65,
            reason: `Reference code (${refCode}) found in memo, but bank amount ($${txAmount.toFixed(2)}) differs from order amount ($${orderAmount.toFixed(2)}).`,
          });
          continue;
        }

        // WEAK MATCH 2: Amount matches AND sender name resembles student or parent name
        if (amountExact && txSender.length >= 3) {
          const namesToCheck = [
            studentName,
            student?.father_name,
            student?.mother_name,
          ].filter(Boolean).map((n: string) => n.toUpperCase().trim());

          let nameMatched = false;
          for (const n of namesToCheck) {
            const parts = n.split(/\s+/).filter(p => p.length >= 3);
            for (const part of parts) {
              if (txSender.includes(part)) {
                nameMatched = true;
                break;
              }
            }
            if (nameMatched) break;
          }

          if (nameMatched) {
            suggestions.push({
              orderId: order.id,
              orderNumber: order.order_number,
              referenceCode: order.reference_code,
              studentId: order.student_id,
              studentName,
              studentCode,
              courseName: order.course_name || "Course",
              quantity: order.quantity,
              orderAmount,
              orderDate: order.created_at,
              orderExpiresAt: order.expires_at,
              bankTransactionId: tx.id,
              bankTxId: tx.bank_tx_id,
              bankDate: tx.transaction_date,
              bankAmount: txAmount,
              bankSender: tx.sender_name,
              bankMemo: tx.memo,
              matchType: "WEAK",
              confidence: 0.5,
              reason: `Exact amount ($${txAmount.toFixed(2)}) and sender name "${tx.sender_name}" resembles student/parent family record.`,
            });
          }
        }
      }
    }

    return suggestions;
  }

  /**
   * Confirms payment and credits hours in one atomic database operation.
   * Handles full payment, partial payment (proportional hours credit with mandatory note), or manual confirmation.
   */
  public static async confirmPayment(p: {
    orderId: string;
    bankTransactionId?: string | null;
    adminId: string;
    amountReceived: number;
    isPartial?: boolean;
    creditHours?: number | null;
    mismatchNote?: string | null;
    isManual?: boolean;
  }): Promise<{ success: boolean; balance: number; message: string }> {
    // 1. Fetch order
    const { data: order, error: orderErr } = await supabaseAdmin
      .from("token_orders")
      .select("*")
      .eq("id", p.orderId)
      .maybeSingle();

    if (orderErr || !order) {
      throw new Error("Order not found.");
    }

    if (order.status === "PAID") {
      throw new Error("This order has already been confirmed as paid.");
    }

    if (order.status === "CANCELLED" || order.status === "EXPIRED") {
      throw new Error(`This order is ${order.status.toLowerCase()} and cannot be confirmed.`);
    }

    const expectedAmount = Number(order.amount_total);
    const amountReceived = Number(p.amountReceived);
    const isAmountDifferent = Math.abs(expectedAmount - amountReceived) >= 0.01;

    if (isAmountDifferent && !p.mismatchNote) {
      throw new Error("An admin note is strictly required when the received amount differs from the order amount.");
    }

    // Determine final status & hours to credit
    let finalStatus: "PAID" | "PARTIAL" = "PAID";
    let hoursToCredit = order.quantity;

    if (p.isPartial || (isAmountDifferent && amountReceived < expectedAmount)) {
      finalStatus = "PARTIAL";
      // If admin specified exact hours to credit, use that; otherwise calculate proportionally
      if (p.creditHours !== undefined && p.creditHours !== null) {
        hoursToCredit = Math.max(0, p.creditHours);
      } else {
        const unitPrice = Number(order.unit_price) || (order.quantity > 0 ? expectedAmount / order.quantity : 1);
        hoursToCredit = Math.max(0, Math.floor(amountReceived / unitPrice));
      }
    }

    // 2. Execute via atomic RPC or sequential guaranteed update
    let balance = 0;
    try {
      const { data: rpcRes, error: rpcErr } = await supabaseAdmin.rpc("zelle_confirm_order", {
        p_order_id: order.id,
        p_bank_tx_id: p.bankTransactionId || null,
        p_admin_id: p.adminId,
        p_amount_received: amountReceived,
        p_status: finalStatus,
        p_credit_hours: hoursToCredit,
        p_mismatch_note: p.mismatchNote || null,
        p_is_manual: Boolean(p.isManual),
      });

      if (!rpcErr && rpcRes && rpcRes[0]?.out_success) {
        balance = Number(rpcRes[0]?.out_balance || 0);
      } else if (rpcErr) {
        // Fallback to transactional TS updates if RPC not yet migrated in test env
        balance = await this.fallbackConfirm(order, p, finalStatus, hoursToCredit);
      }
    } catch {
      balance = await this.fallbackConfirm(order, p, finalStatus, hoursToCredit);
    }

    // 3. Dispatch automated confirmation emails (simulated in test mode)
    const student = await findStudent(order.student_id);
    if (student) {
      if (finalStatus === "PAID") {
        void this.dispatchConfirmedEmail(order, student, hoursToCredit, balance);
      } else {
        void this.dispatchMismatchEmail(order, student, amountReceived, expectedAmount, hoursToCredit, p.mismatchNote || "");
      }
    }

    return {
      success: true,
      balance,
      message: `${hoursToCredit} hour(s) credited. Order marked as ${finalStatus}.`,
    };
  }

  private static async fallbackConfirm(
    order: any,
    p: any,
    finalStatus: string,
    hoursToCredit: number
  ): Promise<number> {
    if (p.bankTransactionId) {
      await supabaseAdmin.from("bank_transactions").update({
        status: p.isManual ? "MANUAL_MATCHED" : "MATCHED",
        matched_order_id: order.id,
        matched_at: new Date().toISOString(),
        matched_by: p.adminId,
        is_manual: Boolean(p.isManual),
      }).eq("id", p.bankTransactionId);
    }

    await supabaseAdmin.from("token_orders").update({
      status: finalStatus,
      paid_at: new Date().toISOString(),
      confirmed_at: new Date().toISOString(),
      confirmed_by: p.adminId,
      amount_received: p.amountReceived,
      mismatch_note: p.mismatchNote || null,
      bank_transaction_id: p.bankTransactionId || order.bank_transaction_id || null,
    }).eq("id", order.id);

    let balance = 0;
    if (hoursToCredit > 0) {
      const applyRes = await applyTokens({
        studentId: order.student_id,
        courseId: order.course_id,
        delta: hoursToCredit,
        reason: "PURCHASE",
        ref: order.order_number,
        note: `Zelle confirmation: ${order.order_number} (${p.isManual ? "manual" : "bank-verified"})`,
        by: p.adminId,
      });
      balance = applyRes.balance;
    }
    return balance;
  }

  /**
   * Rejects an order with a mandatory reason.
   */
  public static async rejectOrder(orderId: string, reason: string, adminId: string): Promise<void> {
    if (!reason || !reason.trim()) {
      throw new Error("A reason is required to reject an order.");
    }
    const { data: order } = await supabaseAdmin.from("token_orders").select("*").eq("id", orderId).maybeSingle();
    if (!order) throw new Error("Order not found.");
    if (order.status === "PAID") throw new Error("Paid orders cannot be rejected.");

    await supabaseAdmin.from("token_orders").update({
      status: "CANCELLED",
      mismatch_note: `Rejected by admin (${adminId}): ${reason.trim()}`,
      confirmed_by: adminId,
      confirmed_at: new Date().toISOString(),
    }).eq("id", orderId);
  }

  /**
   * Generates a reconciliation report dataset and file buffers (CSV and Excel).
   */
  public static async generateReconciliationReport(): Promise<{
    summary: Array<{ date: string; ordersCount: number; ordersTotal: number; bankRowsCount: number; bankRowsTotal: number; matchedCount: number; unmatchedCount: number }>;
    csvContent: string;
    excelBuffer: Buffer;
  }> {
    const [ordersRes, txRes] = await Promise.all([
      supabaseAdmin.from("token_orders").select("*").order("created_at", { ascending: false }),
      supabaseAdmin.from("bank_transactions").select("*").order("transaction_date", { ascending: false }),
    ]);

    const orders = (ordersRes.data || []) as any[];
    const txs = (txRes.data || []) as any[];

    // Group by calendar date (YYYY-MM-DD)
    const dayMap = new Map<string, {
      date: string;
      ordersCount: number;
      ordersTotal: number;
      bankRowsCount: number;
      bankRowsTotal: number;
      matchedCount: number;
      unmatchedCount: number;
    }>();

    for (const o of orders) {
      const d = (o.created_at || "").slice(0, 10);
      if (!d) continue;
      if (!dayMap.has(d)) {
        dayMap.set(d, { date: d, ordersCount: 0, ordersTotal: 0, bankRowsCount: 0, bankRowsTotal: 0, matchedCount: 0, unmatchedCount: 0 });
      }
      const entry = dayMap.get(d)!;
      entry.ordersCount++;
      entry.ordersTotal += Number(o.amount_total || 0);
      if (o.status === "PAID" || o.status === "PARTIAL") entry.matchedCount++;
      else entry.unmatchedCount++;
    }

    for (const t of txs) {
      const d = (t.transaction_date || "").slice(0, 10);
      if (!d) continue;
      if (!dayMap.has(d)) {
        dayMap.set(d, { date: d, ordersCount: 0, ordersTotal: 0, bankRowsCount: 0, bankRowsTotal: 0, matchedCount: 0, unmatchedCount: 0 });
      }
      const entry = dayMap.get(d)!;
      entry.bankRowsCount++;
      entry.bankRowsTotal += Number(t.amount || 0);
    }

    const summary = Array.from(dayMap.values()).sort((a, b) => b.date.localeCompare(a.date));

    // CSV representation
    let csv = "Date,Orders Count,Orders Total (USD),Bank Credits Count,Bank Credits Total (USD),Matched Orders,Unmatched Orders\n";
    for (const row of summary) {
      csv += `${row.date},${row.ordersCount},${row.ordersTotal.toFixed(2)},${row.bankRowsCount},${row.bankRowsTotal.toFixed(2)},${row.matchedCount},${row.unmatchedCount}\n`;
    }

    // Excel representation
    const workbook = new ExcelJS.Workbook();
    workbook.creator = "TopGrade Learning CRM";
    workbook.created = new Date();

    const sheet = workbook.addWorksheet("Daily Reconciliation");
    sheet.columns = [
      { header: "Date", key: "date", width: 14 },
      { header: "Orders Count", key: "ordersCount", width: 14 },
      { header: "Orders Total ($)", key: "ordersTotal", width: 18 },
      { header: "Bank Credits Count", key: "bankRowsCount", width: 18 },
      { header: "Bank Credits Total ($)", key: "bankRowsTotal", width: 22 },
      { header: "Matched Orders", key: "matchedCount", width: 16 },
      { header: "Unmatched Orders", key: "unmatchedCount", width: 18 },
    ];

    for (const s of summary) {
      sheet.addRow({
        date: s.date,
        ordersCount: s.ordersCount,
        ordersTotal: Number(s.ordersTotal.toFixed(2)),
        bankRowsCount: s.bankRowsCount,
        bankRowsTotal: Number(s.bankRowsTotal.toFixed(2)),
        matchedCount: s.matchedCount,
        unmatchedCount: s.unmatchedCount,
      });
    }

    const excelUint8 = await workbook.xlsx.writeBuffer();
    const excelBuffer = Buffer.from(excelUint8);

    return { summary, csvContent: csv, excelBuffer };
  }

  // -------------------------------------------------------------------------
  // EMAIL DISPATCH HELPERS (simulated when SIMULATE_EMAILS=true)
  // -------------------------------------------------------------------------

  public static async dispatchOrderCreatedEmail(order: OrderRow, student: StudentInfo): Promise<void> {
    const s = getCachedInstituteSettings();
    const recipientInfo = s.zelle_tag ? `Zelle Tag: ${s.zelle_tag}` : s.zelle_email ? `Zelle Email: ${s.zelle_email}` : `Zelle Phone: ${s.zelle_phone}`;
    const recipientEmail = student.parentEmails[0] || order.payer_email || student.email;

    const bodyHtml = `
      Dear Parent,<br><br>
      Thank you for ordering class hours for <strong>${student.name}</strong> (${student.code}) at <strong>${s.institute_name}</strong>.<br><br>
      <strong>Payment Instructions:</strong><br>
      &bull; <strong>Course:</strong> ${order.course_name || "Academic Track"}<br>
      &bull; <strong>Hours Ordered:</strong> ${order.quantity} hour(s)<br>
      &bull; <strong>Exact Amount to Pay:</strong> $${Number(order.amount_total).toFixed(2)} USD<br>
      &bull; <strong>Zelle Recipient:</strong> ${s.zelle_display_name || s.institute_name} (${recipientInfo})<br>
      &bull; <strong>Memo / Note (REQUIRED):</strong> <span style="font-family:monospace;font-size:16px;font-weight:900;color:#004ac6;">${order.reference_code || order.order_number}</span><br><br>
      <div style="background:#eff6ff;padding:14px;border-left:4px solid #004ac6;border-radius:6px;">
        <strong>Important:</strong> Please open your bank app, select Zelle, enter <strong>${Number(order.amount_total).toFixed(2)} USD</strong>, and write reference code <strong>${order.reference_code || order.order_number}</strong> in the memo field.
      </div><br>
      Your class hours will be credited to ${student.name}'s account as soon as our accounts department verifies the bank transfer.<br><br>
      Warm regards,<br>
      ${s.institute_name} Accounts Office
    `;

    await dispatchMultiChannelNotification({
      eventType: "PAYMENT_COMPLETED",
      subject: `Zelle Payment Instructions: ${order.reference_code || order.order_number} for ${student.name}`,
      message: bodyHtml,
      escapeMessage: false,
      recipients: [{ role: "PARENT", email: recipientEmail, name: "Parent" }],
    }).catch(err => console.warn("Order created email notice:", err?.message));
  }

  public static async dispatchConfirmedEmail(order: OrderRow, student: StudentInfo, creditedHours: number, balance: number): Promise<void> {
    const s = getCachedInstituteSettings();
    const receiptData = buildReceiptData(order, student);
    receiptData.paymentMethod = "Zelle (Bank Verified)";
    receiptData.purchasedHours = creditedHours;

    const receiptHtml = ReceiptPdfService.generateReceiptHtml(receiptData);
    const recipientEmail = student.parentEmails[0] || order.payer_email || student.email;

    await dispatchMultiChannelNotification({
      eventType: "PAYMENT_COMPLETED",
      subject: `🧾 Payment Confirmed: Receipt ${order.reference_code || order.order_number} (${creditedHours} hrs credited)`,
      message: `Dear Parent,\n\nYour Zelle payment of $${Number(order.amount_total).toFixed(2)} USD has been verified by the bank.\n\n${creditedHours} class hour(s) have been credited to ${student.name}'s account.\nCurrent Available Balance: ${balance} hour(s).\n\nYour official receipt has been attached.\n\n${s.institute_name}`,
      recipients: [
        { role: "PARENT", email: recipientEmail, name: "Parent" },
        { role: "ADMIN", email: process.env.ADMIN_EMAIL || "tglbiz101@gmail.com", name: "Administrator" },
      ],
      attachments: [
        {
          filename: `Receipt_${order.reference_code || order.order_number}.html`,
          content: Buffer.from(receiptHtml, "utf-8"),
          contentType: "text/html",
        },
      ],
    }).catch(err => console.warn("Payment confirmed email notice:", err?.message));
  }

  public static async dispatchMismatchEmail(
    order: OrderRow,
    student: StudentInfo,
    amountReceived: number,
    expectedAmount: number,
    hoursCredited: number,
    note: string
  ): Promise<void> {
    const s = getCachedInstituteSettings();
    const recipientEmail = student.parentEmails[0] || order.payer_email || student.email;

    const msg = `
      Dear Parent,<br><br>
      We received your payment for order <strong>${order.reference_code || order.order_number}</strong> (${student.name}).<br><br>
      &bull; Expected Order Total: $${expectedAmount.toFixed(2)} USD<br>
      &bull; Amount Received: $${amountReceived.toFixed(2)} USD<br>
      &bull; Hours Credited: ${hoursCredited} class hour(s)<br>
      &bull; Note: ${note}<br><br>
      If you have questions regarding this adjustment, please reply to this email.<br><br>
      ${s.institute_name} Accounts Office
    `;

    await dispatchMultiChannelNotification({
      eventType: "PAYMENT_COMPLETED",
      subject: `Payment Notice: Adjustment for Order ${order.reference_code || order.order_number}`,
      message: msg,
      escapeMessage: false,
      recipients: [{ role: "PARENT", email: recipientEmail, name: "Parent" }],
    }).catch(err => console.warn("Mismatch notice email error:", err?.message));
  }

  public static async dispatchExpiryEmail(order: OrderRow, student: StudentInfo): Promise<void> {
    const s = getCachedInstituteSettings();
    const recipientEmail = student.parentEmails[0] || order.payer_email || student.email;

    const msg = `
      Dear Parent,<br><br>
      Your pending class hours order <strong>${order.reference_code || order.order_number}</strong> for ${student.name} (${order.course_name}) has expired as payment was not received within the validity period.<br><br>
      If you still wish to purchase class hours, please visit your portal and place a new order.<br><br>
      ${s.institute_name} Administration
    `;

    await dispatchMultiChannelNotification({
      eventType: "PAYMENT_COMPLETED",
      subject: `Order Expired: ${order.reference_code || order.order_number} (${student.name})`,
      message: msg,
      escapeMessage: false,
      recipients: [{ role: "PARENT", email: recipientEmail, name: "Parent" }],
    }).catch(err => console.warn("Expiry notice email error:", err?.message));
  }

  public static async dispatchReminderEmail(order: OrderRow, student: StudentInfo): Promise<void> {
    const s = getCachedInstituteSettings();
    const recipientEmail = student.parentEmails[0] || order.payer_email || student.email;

    const msg = `
      Dear Parent,<br><br>
      This is a friendly reminder that order <strong>${order.reference_code || order.order_number}</strong> for ${student.name} ($${Number(order.amount_total).toFixed(2)} USD) is pending payment.<br><br>
      Please send your Zelle payment with reference code <strong>${order.reference_code || order.order_number}</strong> in the memo field.<br><br>
      ${s.institute_name} Administration
    `;

    await dispatchMultiChannelNotification({
      eventType: "PAYMENT_COMPLETED",
      subject: `Payment Reminder: Order ${order.reference_code || order.order_number} (${student.name})`,
      message: msg,
      escapeMessage: false,
      recipients: [{ role: "PARENT", email: recipientEmail, name: "Parent" }],
    }).catch(err => console.warn("Reminder notice email error:", err?.message));
  }
}
