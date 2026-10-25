import { supabaseAdmin } from "../supabase.js";
import { findStudent, type OrderRow } from "./tokenService.js";
import { BankReconciliationService } from "./bankReconciliationService.js";

export interface ExpiryJobResult {
  expiredCount: number;
  remindersSentCount: number;
  pendingOlderThan2DaysCount: number;
  pendingOlderThan2DaysDetails: Array<{ orderNumber: string; studentName: string; amount: number; daysOld: number }>;
}

/**
 * Runs pending order expiry and reminder automation.
 * - Expires orders where expires_at <= now()
 * - Sends reminder on Day 3 of pending status
 * - Aggregates pending items older than 2 days for admin daily morning digest
 */
export async function runOrderExpiryJob(): Promise<ExpiryJobResult> {
  const now = new Date();
  const nowIso = now.toISOString();

  // 1. Fetch pending orders
  const { data: pendingOrders, error } = await supabaseAdmin
    .from("token_orders")
    .select("*")
    .in("status", ["PENDING_PAYMENT", "PENDING"])
    .order("created_at", { ascending: true });

  if (error || !pendingOrders) {
    return { expiredCount: 0, remindersSentCount: 0, pendingOlderThan2DaysCount: 0, pendingOlderThan2DaysDetails: [] };
  }

  let expiredCount = 0;
  let remindersSentCount = 0;
  const pendingOlderThan2DaysDetails: Array<{ orderNumber: string; studentName: string; amount: number; daysOld: number }> = [];

  for (const order of pendingOrders as OrderRow[]) {
    const createdAt = new Date(order.created_at);
    const ageDays = (now.getTime() - createdAt.getTime()) / (1000 * 60 * 60 * 24);
    const expiresAt = order.expires_at ? new Date(order.expires_at) : new Date(createdAt.getTime() + 7 * 24 * 60 * 60 * 1000);

    const student = await findStudent(order.student_id);
    const studentName = student?.name || "Student";

    // A. Check for Expiry
    if (expiresAt.getTime() <= now.getTime()) {
      await supabaseAdmin
        .from("token_orders")
        .update({ status: "EXPIRED", mismatch_note: "Expired: payment not verified within validity window." })
        .eq("id", order.id);

      expiredCount++;
      if (student) {
        void BankReconciliationService.dispatchExpiryEmail(order, student);
      }
      continue;
    }

    // B. Check for Day 3 Reminder (age >= 3 days, reminder not yet recorded in note)
    const note = String(order.note || "");
    if (ageDays >= 3 && !note.includes("[REMINDER_SENT]")) {
      const updatedNote = note ? `${note} [REMINDER_SENT]` : "[REMINDER_SENT]";
      await supabaseAdmin
        .from("token_orders")
        .update({ note: updatedNote })
        .eq("id", order.id);

      remindersSentCount++;
      if (student) {
        void BankReconciliationService.dispatchReminderEmail(order, student);
      }
    }

    // C. Check for items older than 2 days (for Admin Digest line)
    if (ageDays >= 2) {
      pendingOlderThan2DaysDetails.push({
        orderNumber: order.reference_code || order.order_number,
        studentName,
        amount: Number(order.amount_total),
        daysOld: Math.floor(ageDays),
      });
    }
  }

  return {
    expiredCount,
    remindersSentCount,
    pendingOlderThan2DaysCount: pendingOlderThan2DaysDetails.length,
    pendingOlderThan2DaysDetails,
  };
}
