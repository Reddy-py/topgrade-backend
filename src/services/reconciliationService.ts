import { supabaseAdmin } from "../supabase.js";

export interface ReconciliationDiscrepancy {
  walletId: string;
  studentId: string;
  courseId: string;
  walletBalance: number;
  ledgerSum: number;
  difference: number;
}

export interface OrphanLedgerEntry {
  id: string;
  studentId: string;
  courseId?: string;
  delta: number;
  reason?: string;
}

export interface ReconciliationResult {
  healthy: boolean;
  totalWallets: number;
  totalLedgerEntries: number;
  discrepancies: ReconciliationDiscrepancy[];
  orphanEntries: OrphanLedgerEntry[];
  checkedAt: string;
}

/**
 * Reconciles token_wallets against token_ledger to ensure single-source mathematical integrity.
 * Rule Part B.4: Sum of ledger rows equals wallet balance for every student and course; no orphan rows.
 */
export async function reconcileLedgerService(): Promise<ReconciliationResult> {
  const checkedAt = new Date().toISOString();

  // 1. Fetch all wallets
  const { data: wallets, error: wErr } = await supabaseAdmin
    .from("token_wallets")
    .select("id, student_id, course_id, balance");

  if (wErr) {
    throw new Error(`Failed to fetch token wallets for reconciliation: ${wErr.message}`);
  }

  // 2. Fetch all ledger rows
  const { data: ledger, error: lErr } = await supabaseAdmin
    .from("token_ledger")
    .select("id, wallet_id, student_id, course_id, delta, event_type, reason");

  if (lErr) {
    throw new Error(`Failed to fetch token ledger for reconciliation: ${lErr.message}`);
  }

  const walletList = wallets || [];
  const ledgerList = ledger || [];

  const walletMap = new Map<string, { id: string; student_id: string; course_id: string; balance: number }>();
  for (const w of walletList) {
    const key = `${w.student_id}:${w.course_id}`;
    walletMap.set(key, w);
    if (w.id) {
      walletMap.set(w.id, w);
    }
  }

  // Group ledger delta sums
  const ledgerSumByWalletId = new Map<string, number>();
  const ledgerSumByStudentCourse = new Map<string, number>();
  const orphanEntries: OrphanLedgerEntry[] = [];

  for (const row of ledgerList) {
    const delta = Number(row.delta) || 0;
    const hasWalletById = row.wallet_id && walletMap.has(row.wallet_id);
    const scKey = `${row.student_id}:${row.course_id}`;
    const hasWalletBySC = walletMap.has(scKey);

    if (!hasWalletById && !hasWalletBySC) {
      orphanEntries.push({
        id: row.id,
        studentId: row.student_id,
        courseId: row.course_id,
        delta,
        reason: row.reason || row.event_type
      });
    }

    if (row.wallet_id) {
      ledgerSumByWalletId.set(row.wallet_id, (ledgerSumByWalletId.get(row.wallet_id) || 0) + delta);
    }
    if (row.student_id && row.course_id) {
      ledgerSumByStudentCourse.set(scKey, (ledgerSumByStudentCourse.get(scKey) || 0) + delta);
    }
  }

  const discrepancies: ReconciliationDiscrepancy[] = [];

  for (const w of walletList) {
    const scKey = `${w.student_id}:${w.course_id}`;
    const walletBalance = Number(w.balance) || 0;
    // Prefer match by wallet_id, fallback to (student_id, course_id)
    const ledgerSum = ledgerSumByWalletId.has(w.id)
      ? (ledgerSumByWalletId.get(w.id) || 0)
      : (ledgerSumByStudentCourse.get(scKey) || 0);

    const diff = Math.round((walletBalance - ledgerSum) * 100) / 100;

    if (Math.abs(diff) > 0.001) {
      discrepancies.push({
        walletId: w.id,
        studentId: w.student_id,
        courseId: w.course_id,
        walletBalance,
        ledgerSum,
        difference: diff
      });
    }
  }

  const healthy = discrepancies.length === 0 && orphanEntries.length === 0;

  return {
    healthy,
    totalWallets: walletList.length,
    totalLedgerEntries: ledgerList.length,
    discrepancies,
    orphanEntries,
    checkedAt
  };
}
