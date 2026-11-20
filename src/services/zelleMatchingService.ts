import crypto from "crypto";
import { supabaseAdmin } from "../supabase.js";
import {
  getCachedInstituteSettings,
  isAutomationEnabled,
  type InstituteSettings,
} from "./instituteSettingsService.js";
import {
  inMemoryPaymentRequests,
  fulfillPaymentRequestService,
  getChicagoTodayStr,
  type PaymentRequestRecord,
} from "./paymentRequestService.js";
import { inMemoryStudentStore } from "./studentService.js";

export type MatchStatus =
  | "UNMATCHED"
  | "SUGGESTED"
  | "MATCHED_AUTO"
  | "MATCHED_ADMIN"
  | "IGNORED"
  | "FLAGGED";

export interface BankTransactionRecord {
  id: string;
  source: "CSV" | "FEED";
  bankTxnId?: string | undefined;
  postedDate: string;
  amountCents: number;
  amountDollars: number;
  direction: "CREDIT" | "DEBIT";
  description: string;
  counterpartyName?: string | undefined;
  memo?: string | undefined;
  accountLast4?: string | undefined;
  hash: string;
  matchedRequestId?: string | undefined;
  matchStatus: MatchStatus;
  matchReasons?: string[] | undefined;
  matchScore: number;
  isStrongMatch?: boolean | undefined;
  createdAt: string;
}

export interface PayerAliasRecord {
  id: string;
  parentId: string;
  aliasName: string;
  source: "ADMIN" | "LEARNED";
  createdAt: string;
}

export interface BankFeedProvider {
  name: string;
  listTransactions(since?: Date): Promise<BankTransactionRecord[]>;
  verifyWebhook(signature: string, payload: any): boolean;
}

// In-memory fallback stores for offline development and synthetic tests
export const inMemoryBankTransactions: BankTransactionRecord[] = [];
export const inMemoryPayerAliases: PayerAliasRecord[] = [];

/**
 * Normalizes an alias or counterparty name for matching (lowercase, alphanumeric only).
 */
export function normalizeAliasName(name: string): string {
  return (name || "").toLowerCase().replace(/[^a-z0-9]/g, "").trim();
}

/**
 * Computes a unique deterministic hash for a bank transaction to prevent duplicates.
 */
export function computeBankTransactionHash(params: {
  bankTxnId?: string;
  postedDate: string;
  amountCents: number;
  direction: string;
  counterpartyName?: string;
  description: string;
}): string {
  if (params.bankTxnId && params.bankTxnId.trim()) {
    return crypto.createHash("sha256").update(params.bankTxnId.trim()).digest("hex");
  }
  const raw = `${params.postedDate}_${params.amountCents}_${params.direction}_${(params.counterpartyName || "").trim().toLowerCase()}_${params.description.trim().toLowerCase()}`;
  return crypto.createHash("sha256").update(raw).digest("hex");
}

/**
 * Registers or learns a payer alias for a parent account.
 */
export async function registerPayerAliasService(params: {
  parentId: string;
  aliasName: string;
  source?: "ADMIN" | "LEARNED";
}): Promise<PayerAliasRecord> {
  const norm = normalizeAliasName(params.aliasName);
  if (!norm) {
    throw new Error("Alias name cannot be empty.");
  }

  const existing = inMemoryPayerAliases.find(
    a => a.parentId === params.parentId && normalizeAliasName(a.aliasName) === norm
  );
  if (existing) {
    return existing;
  }

  const record: PayerAliasRecord = {
    id: `alias-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
    parentId: params.parentId,
    aliasName: params.aliasName.trim(),
    source: params.source || "ADMIN",
    createdAt: new Date().toISOString(),
  };

  inMemoryPayerAliases.push(record);

  try {
    await supabaseAdmin.from("payer_aliases").insert({
      id: record.id,
      parent_id: record.parentId,
      alias_name: record.aliasName,
      source: record.source,
      created_at: record.createdAt,
    });
  } catch {}

  return record;
}

/**
 * Retrieves all registered payer aliases for a parent.
 */
export async function getPayerAliasesService(parentId: string): Promise<PayerAliasRecord[]> {
  try {
    const { data } = await supabaseAdmin.from("payer_aliases").select("*").eq("parent_id", parentId);
    if (data && data.length > 0) {
      return data.map((d: any) => ({
        id: d.id,
        parentId: d.parent_id,
        aliasName: d.alias_name,
        source: d.source,
        createdAt: d.created_at,
      }));
    }
  } catch {}

  return inMemoryPayerAliases.filter(a => a.parentId === parentId);
}

/**
 * Ingests a raw bank statement CSV text safely:
 * - Maps columns based on configuration or headers.
 * - Enforces row and file size limits.
 * - Prevents CSV formula injection (strips =, +, -, @ prefixes).
 * - Deduplicates transactions using cryptographic hash.
 * - Never stores the raw CSV file on disk or database.
 */
export async function ingestBankCsvService(params: {
  csvContent: string;
  columnMapping?: {
    dateCol?: string;
    amountCol?: string;
    descCol?: string;
    memoCol?: string;
    counterpartyCol?: string;
    txnIdCol?: string;
  };
}): Promise<{
  totalRows: number;
  importedCount: number;
  duplicateCount: number;
  transactions: BankTransactionRecord[];
}> {
  const { csvContent, columnMapping } = params;

  if (!csvContent || !csvContent.trim()) {
    throw new Error("Empty CSV content provided.");
  }

  const lines = csvContent
    .split(/\r?\n/)
    .map(l => l.trim())
    .filter(l => l.length > 0);

  if (lines.length < 2) {
    throw new Error("CSV must contain a header line and at least one transaction row.");
  }

  const MAX_ROWS = 1000;
  if (lines.length > MAX_ROWS + 1) {
    throw new Error(`CSV exceeds maximum limit of ${MAX_ROWS} rows.`);
  }

  const rawHeader = lines[0];
  if (!rawHeader) throw new Error("Missing header in CSV");
  const headers = rawHeader.split(",").map(h => h.trim().replace(/^["']|["']$/g, "").toLowerCase());

  // Find column indexes
  const dateIdx = headers.findIndex(h => h.includes("date") || h === columnMapping?.dateCol?.toLowerCase());
  const amountIdx = headers.findIndex(h => h.includes("amount") || h === columnMapping?.amountCol?.toLowerCase());
  const descIdx = headers.findIndex(h => h.includes("desc") || h.includes("narrative") || h === columnMapping?.descCol?.toLowerCase());
  const memoIdx = headers.findIndex(h => h.includes("memo") || h.includes("note") || h === columnMapping?.memoCol?.toLowerCase());
  const counterpartyIdx = headers.findIndex(h => h.includes("name") || h.includes("sender") || h.includes("counterparty") || h === columnMapping?.counterpartyCol?.toLowerCase());
  const txnIdIdx = headers.findIndex(h => h.includes("id") || h.includes("ref") || h === columnMapping?.txnIdCol?.toLowerCase());

  if (dateIdx === -1 || amountIdx === -1 || descIdx === -1) {
    throw new Error("CSV missing required columns: Date, Amount, Description.");
  }

  const newTransactions: BankTransactionRecord[] = [];
  let duplicateCount = 0;

  for (let i = 1; i < lines.length; i++) {
    const line = lines[i];
    if (!line) continue;
    // Basic CSV cell extraction respecting quotes
    const cells = line.split(/,(?=(?:(?:[^"]*"){2})*[^"]*$)/).map(c => {
      let v = c.trim().replace(/^["']|["']$/g, "");
      // Formula injection defense: strip leading =, +, -, @
      if (v.startsWith("=") || v.startsWith("+") || v.startsWith("-") || v.startsWith("@")) {
        v = `'${v}`;
      }
      return v;
    });

    const rawDate = cells[dateIdx] || "";
    const rawAmount = (cells[amountIdx] || "").replace(/[\$,]/g, "");
    const rawDesc = cells[descIdx] || "";
    const rawMemo = memoIdx >= 0 ? cells[memoIdx] || "" : "";
    const rawCounterparty = counterpartyIdx >= 0 ? cells[counterpartyIdx] || "" : "";
    const rawTxnId = txnIdIdx >= 0 ? cells[txnIdIdx] || "" : "";

    const parsedNum = parseFloat(rawAmount);
    if (isNaN(parsedNum)) continue;

    const amountCents = Math.round(Math.abs(parsedNum) * 100);
    const direction: "CREDIT" | "DEBIT" = parsedNum >= 0 ? "CREDIT" : "DEBIT";

    let postedDate = rawDate;
    try {
      const d = new Date(rawDate);
      if (!isNaN(d.getTime())) {
        postedDate = d.toISOString().split("T")[0] || rawDate;
      }
    } catch {}

    const hash = computeBankTransactionHash({
      bankTxnId: rawTxnId,
      postedDate,
      amountCents,
      direction,
      counterpartyName: rawCounterparty,
      description: rawDesc,
    });

    // Check duplicate hash
    const isDupInMemory = inMemoryBankTransactions.some(t => t.hash === hash);
    if (isDupInMemory) {
      duplicateCount++;
      continue;
    }

    const isZelle =
      rawDesc.toUpperCase().includes("ZELLE") ||
      rawMemo.toUpperCase().includes("ZELLE") ||
      rawDesc.toUpperCase().includes("TRANSFER") ||
      rawDesc.toUpperCase().includes("P2P");

    const matchStatus: MatchStatus = direction === "DEBIT" ? "FLAGGED" : isZelle ? "UNMATCHED" : "UNMATCHED";

    const txn: BankTransactionRecord = {
      id: `bt-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
      source: "CSV",
      bankTxnId: rawTxnId || undefined,
      postedDate,
      amountCents,
      amountDollars: amountCents / 100,
      direction,
      description: rawDesc,
      counterpartyName: rawCounterparty || undefined,
      memo: rawMemo || undefined,
      hash,
      matchStatus,
      matchScore: 0,
      createdAt: new Date().toISOString(),
    };

    inMemoryBankTransactions.unshift(txn);
    newTransactions.push(txn);

    try {
      await supabaseAdmin.from("bank_transactions").insert({
        id: txn.id,
        source: txn.source,
        bank_txn_id: txn.bankTxnId || null,
        posted_date: txn.postedDate,
        amount_cents: txn.amountCents,
        direction: txn.direction,
        description: txn.description,
        counterparty_name: txn.counterpartyName || null,
        memo: txn.memo || null,
        hash: txn.hash,
        match_status: txn.matchStatus,
        match_score: txn.matchScore,
        created_at: txn.createdAt,
      });
    } catch {}
  }

  // Automatically execute matching engine for the new batch
  await runBankTransactionMatchingService();

  return {
    totalRows: lines.length - 1,
    importedCount: newTransactions.length,
    duplicateCount,
    transactions: newTransactions,
  };
}

/**
 * Simulated Bank Feed Provider for local development, synthetic tests, and webhooks.
 */
export class SimulatedBankFeedProvider implements BankFeedProvider {
  name = "SimulatedBankFeedProvider";

  async listTransactions(_since?: Date): Promise<BankTransactionRecord[]> {
    return inMemoryBankTransactions.filter(t => t.source === "FEED");
  }

  verifyWebhook(signature: string, _payload: any): boolean {
    const expected = process.env.BANK_FEED_WEBHOOK_SECRET || "simulated_bank_webhook_secret_key";
    return signature === expected || signature === "test-valid-sig";
  }
}

/**
 * ZELLE MATCHING ENGINE:
 * Matches UNMATCHED or SUGGESTED bank transactions against candidate OPEN or CLAIMED payment requests.
 * Evaluates:
 * 1. Exact amount match (amount_cents === req.amount_cents)
 * 2. Reference code in memo or description (TG-XXXXXX)
 * 3. Counterparty name matching a payer alias or parent name
 * 4. Date within matching window (default 10 days)
 * 5. Single candidate uniqueness
 *
 * If institute_settings.bank_auto_confirm is ON and match is STRONG and amount <= auto_confirm_limit:
 * Automatically confirms payment via fulfillPaymentRequestService.
 */
export async function runBankTransactionMatchingService(): Promise<{
  autoConfirmedCount: number;
  suggestedCount: number;
  unmatchedCount: number;
}> {
  const settings = getCachedInstituteSettings();
  const autoConfirmEnabled = isAutomationEnabled("bank_auto_confirm", settings);
  const autoConfirmLimitCents = (settings.auto_confirm_limit || 500) * 100;
  const windowDays = settings.matching_date_window_days || 10;

  let autoConfirmedCount = 0;
  let suggestedCount = 0;
  let unmatchedCount = 0;

  // Filter bank transactions needing evaluation (CREDIT direction only)
  const candidateTxns = inMemoryBankTransactions.filter(
    t => t.direction === "CREDIT" && (t.matchStatus === "UNMATCHED" || t.matchStatus === "SUGGESTED")
  );

  // Candidates: OPEN or CLAIMED payment requests that have not been paid
  const openRequests = inMemoryPaymentRequests.filter(r => r.status === "OPEN" || r.status === "CLAIMED");

  for (const txn of candidateTxns) {
    const textToSearch = `${txn.description} ${txn.memo || ""} ${txn.counterpartyName || ""}`.toUpperCase();
    const counterpartyNorm = normalizeAliasName(txn.counterpartyName || "");

    const scoredCandidates: Array<{
      request: PaymentRequestRecord;
      score: number;
      reasons: string[];
      hasRefMatch: boolean;
      hasAliasMatch: boolean;
      hasExactAmount: boolean;
    }> = [];

    for (const req of openRequests) {
      let score = 0;
      const reasons: string[] = [];
      let hasRefMatch = false;
      let hasAliasMatch = false;
      let hasExactAmount = false;

      // 1. Exact amount match
      if (txn.amountCents === req.amountCents) {
        score += 50;
        hasExactAmount = true;
        reasons.push(`Exact amount match: $${txn.amountDollars.toFixed(2)}`);
      } else {
        const diff = Math.abs(txn.amountCents - req.amountCents);
        if (diff < 1000) {
          // within $10 difference
          score += 10;
          reasons.push(`Close amount (mismatch by $${(diff / 100).toFixed(2)})`);
        }
      }

      // 2. Reference code match (TG-XXXXXX)
      if (textToSearch.includes(req.referenceCode.toUpperCase())) {
        score += 40;
        hasRefMatch = true;
        reasons.push(`Reference code ${req.referenceCode} found in transaction memo/description`);
      }

      // 3. Counterparty name vs Parent name or Registered Payer Alias
      if (counterpartyNorm) {
        // Check registered aliases for student's parents
        const matchingAlias = inMemoryPayerAliases.find(
          a => normalizeAliasName(a.aliasName) === counterpartyNorm
        );
        if (matchingAlias) {
          score += 30;
          hasAliasMatch = true;
          reasons.push(`Sender name matches registered payer alias: "${matchingAlias.aliasName}"`);
        } else if (req.studentName && counterpartyNorm.includes(normalizeAliasName(req.studentName))) {
          score += 25;
          hasAliasMatch = true;
          reasons.push(`Sender name matches student name: "${req.studentName}"`);
        }
      }

      // 4. Date window check
      const txnDate = new Date(txn.postedDate).getTime();
      const reqDate = new Date(req.createdAt).getTime();
      const daysDiff = Math.abs((txnDate - reqDate) / (1000 * 60 * 60 * 24));
      if (daysDiff <= windowDays) {
        score += 10;
        reasons.push(`Posted date within ${windowDays}-day matching window`);
      }

      if (score > 30) {
        scoredCandidates.push({
          request: req,
          score,
          reasons,
          hasRefMatch,
          hasAliasMatch,
          hasExactAmount,
        });
      }
    }

    scoredCandidates.sort((a, b) => b.score - a.score);

    if (scoredCandidates.length === 0) {
      txn.matchStatus = "UNMATCHED";
      txn.matchScore = 0;
      txn.matchReasons = ["No matching payment requests found for this amount or reference."];
      unmatchedCount++;
      continue;
    }

    const top = scoredCandidates[0];
    if (!top) continue;

    // Strong match definition:
    // Exact amount AND (reference code OR registered alias) AND exactly one dominant candidate
    const isSingleCandidate = scoredCandidates.length === 1 || (top.score - (scoredCandidates[1]?.score || 0) >= 30);
    const isStrongMatch = top.hasExactAmount && (top.hasRefMatch || top.hasAliasMatch) && isSingleCandidate;

    txn.matchScore = top.score;
    txn.matchReasons = top.reasons;
    txn.isStrongMatch = isStrongMatch;

    // AUTO-CONFIRMATION CHECK
    if (
      autoConfirmEnabled &&
      isStrongMatch &&
      txn.amountCents <= autoConfirmLimitCents &&
      !txn.matchedRequestId &&
      top.request.status !== "PAID"
    ) {
      // Auto-confirm
      txn.matchStatus = "MATCHED_AUTO";
      txn.matchedRequestId = top.request.id;

      await fulfillPaymentRequestService({
        referenceCodeOrId: top.request.referenceCode,
        confirmedBy: "AUTO",
        confirmationSource: txn.source === "FEED" ? "BANK_FEED" : "BANK_FILE",
        bankTransactionId: txn.id,
        adminNote: `Auto-confirmed via Zelle matching engine (Score: ${top.score})`,
      });

      autoConfirmedCount++;
    } else {
      // Goes to Needs Review as a SUGGESTION for admin confirmation
      txn.matchStatus = "SUGGESTED";
      txn.matchedRequestId = top.request.id;
      suggestedCount++;
    }

    try {
      await supabaseAdmin.from("bank_transactions").update({
        matched_request_id: txn.matchedRequestId || null,
        match_status: txn.matchStatus,
        match_score: txn.matchScore,
        match_reasons: txn.matchReasons,
      }).eq("id", txn.id);
    } catch {}
  }

  return { autoConfirmedCount, suggestedCount, unmatchedCount };
}
