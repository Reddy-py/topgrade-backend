/**
 * One-time clean-up: old accounts were created with shared default passwords that appear in old documents.
 * This replaces each password with a random one nobody knows and emails the person a one-time set-password link.
 *
 *   npm run reset:passwords                       -> dry run: only counts who would be reset
 *   npm run reset:passwords -- --send             -> students, parents and teachers (default)
 *   npm run reset:passwords -- --send --roles=PARENT
 *
 * Admin logins are NOT included by default (an undelivered email would lock the admin out).
 * Admins should use "Forgot password?" on the sign-in page instead.
 * Gmail limits how many emails one account can send per day, so run it in parts with --roles if you have many people.
 */
import { supabaseAdmin } from "./supabase.js";
import { randomPassword, emailSetPasswordLink, type LoginRole } from "./services/studentAccounts.js";

const send = process.argv.includes("--send");
const rolesArg = process.argv.find(a => a.startsWith("--roles="));
const roles = (rolesArg ? rolesArg.slice("--roles=".length) : "STUDENT,PARENT,TEACHER")
  .split(",").map(r => r.trim().toUpperCase()).filter(Boolean);
const sleep = (ms: number) => new Promise(r => setTimeout(r, ms));

async function main() {
  const { data, error } = await supabaseAdmin
    .from("profiles")
    .select("id, email, full_name, role, status")
    .in("role", roles)
    .eq("status", "Active");
  if (error) throw new Error(error.message);
  const people = (data || []) as any[];
  console.log(`${people.length} active logins in roles: ${roles.join(", ")}`);
  if (!send) {
    console.log("Dry run. Nothing was changed. Add --send to reset these passwords and email the links.");
    return;
  }

  let done = 0;
  const failed: string[] = [];
  for (const p of people) {
    try {
      const { error: upErr } = await supabaseAdmin.auth.admin.updateUserById(p.id, { password: randomPassword() });
      if (upErr) throw new Error(upErr.message);
      const ok = await emailSetPasswordLink({ email: p.email, name: p.full_name || p.email, role: p.role as LoginRole });
      if (!ok) throw new Error("link could not be created");
      done++;
      await sleep(400);
    } catch (e: any) {
      failed.push(`${p.email}: ${e?.message}`);
    }
  }
  console.log(`Reset and emailed: ${done} of ${people.length}.`);
  if (failed.length) console.log("Failed:\n - " + failed.join("\n - "));
}

main().catch(e => { console.error(e); process.exit(1); });
