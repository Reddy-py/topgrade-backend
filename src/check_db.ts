import { supabaseAdmin } from "./supabase.js";

async function main() {
  console.log("Checking tables in database...");
  const tpl = await supabaseAdmin.from("email_templates").select("key, name, enabled").limit(5);
  console.log("email_templates:", tpl.data?.length, "error:", tpl.error?.message);

  const log = await supabaseAdmin.from("email_log").select("id, retry_count, next_retry_at").limit(1);
  console.log("email_log columns:", log.data, "error:", log.error?.message);

  const unsub = await supabaseAdmin.from("email_unsubscribes").select("id").limit(1);
  console.log("email_unsubscribes:", unsub.data, "error:", unsub.error?.message);

  const notes = await supabaseAdmin.from("student_monthly_notes").select("id").limit(1);
  console.log("student_monthly_notes:", notes.data, "error:", notes.error?.message);
}

main().catch(console.error);
