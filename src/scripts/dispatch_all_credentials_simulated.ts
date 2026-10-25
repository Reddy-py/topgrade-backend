/**
 * Batch Dispatcher for Secure Set-Password Links across all Students, Teachers, and Parents.
 * Runs strictly with SIMULATE_EMAILS=true (logging to email_log table, no external SMTP calls).
 * Never prints passwords or personal secrets.
 */

import dotenv from "dotenv";
dotenv.config();

// Ensure simulated email mode is strictly enforced
process.env.SIMULATE_EMAILS = "true";

import { supabaseAdmin } from "../supabase.js";
import { emailSetPasswordLink } from "../services/studentAccounts.js";
import type { LoginRole } from "../services/studentAccounts.js";

async function main() {
  console.log("================================================================================");
  console.log("TOPGRADE CRM: DISPATCH SECURE LOGIN INVITATIONS (SIMULATED MODE)");
  console.log(`Safety check: SIMULATE_EMAILS=${process.env.SIMULATE_EMAILS}`);
  console.log("================================================================================");

  // Fetch all profiles across the 3 roles
  const { data: profiles, error } = await supabaseAdmin
    .from("profiles")
    .select("id, email, full_name, role, status")
    .in("role", ["PARENT", "TEACHER", "STUDENT"])
    .order("role", { ascending: true });

  if (error || !profiles) {
    console.error("Failed to query profiles:", error?.message);
    process.exit(1);
  }

  const stats = {
    PARENT: { total: 0, sent: 0, skipped: 0, failed: 0 },
    TEACHER: { total: 0, sent: 0, skipped: 0, failed: 0 },
    STUDENT: { total: 0, sent: 0, skipped: 0, failed: 0 },
  };

  for (const prof of profiles) {
    const role = (prof.role || "").toUpperCase() as "PARENT" | "TEACHER" | "STUDENT";
    if (!stats[role]) continue;
    stats[role].total++;

    const email = (prof.email || "").trim().toLowerCase();

    // Check for placeholder email
    if (
      !email ||
      !email.includes("@") ||
      email.endsWith("@placeholder.topgrade.edu") ||
      email.endsWith("@topgrade.local") ||
      email.includes("placeholder")
    ) {
      stats[role].skipped++;
      continue;
    }

    try {
      const dispatched = await emailSetPasswordLink({
        email,
        name: prof.full_name || "Valued Member",
        role: role as LoginRole,
      });

      if (dispatched) {
        stats[role].sent++;
      } else {
        stats[role].failed++;
      }
    } catch (err: any) {
      stats[role].failed++;
    }
  }

  console.log("\nDISPATCH SUMMARY (SIMULATED):");
  console.log("--------------------------------------------------------------------------------");
  console.log(`Parents:  ${stats.PARENT.sent} simulated emails generated | ${stats.PARENT.skipped} placeholders skipped | ${stats.PARENT.failed} failed (Total: ${stats.PARENT.total})`);
  console.log(`Teachers: ${stats.TEACHER.sent} simulated emails generated | ${stats.TEACHER.skipped} placeholders skipped | ${stats.TEACHER.failed} failed (Total: ${stats.TEACHER.total})`);
  console.log(`Students: ${stats.STUDENT.sent} simulated emails generated | ${stats.STUDENT.skipped} placeholders skipped | ${stats.STUDENT.failed} failed (Total: ${stats.STUDENT.total})`);
  console.log("--------------------------------------------------------------------------------");
  const totalSent = stats.PARENT.sent + stats.TEACHER.sent + stats.STUDENT.sent;
  console.log(`Total Simulated Invitations Recorded in email_log: ${totalSent}`);
  console.log("================================================================================\n");
}

main().catch(err => {
  console.error("Batch dispatch fatal error:", err?.message);
  process.exit(1);
});
