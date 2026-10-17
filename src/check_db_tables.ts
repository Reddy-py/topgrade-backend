import { supabaseAdmin } from "./supabase.js";

async function testTables() {
  const tables = [
    "profiles", "roles", "role_permissions", "students", "teachers", "courses",
    "attendance", "fees", "parent_students", "admission_requests", "de_enrollment_requests",
    "token_wallets", "token_ledger", "token_orders", "teacher_slot_claims",
    "attendance_records", "student_dossiers", "email_logs",
    "schedules", "schedule_students", "teacher_availability", "student_history",
    "leads", "enrollments", "lead_interactions", "campaigns", "alert_logs",
    "tutoring_past_records", "afterschool_past_records",
    "locations", "institute_settings", "student_enrollments"
  ];

  console.log("Checking table accessibility in remote Supabase...");
  for (const t of tables) {
    const { count, error } = await supabaseAdmin.from(t).select("*", { count: "exact", head: true });
    if (error) {
      console.log(`  ❌ ${t}: ${error.message} (${error.code || 'NO_CODE'})`);
    } else {
      console.log(`  ✓ ${t}: accessible, count = ${count}`);
    }
  }
}

testTables().then(() => { process.exitCode = 0; });
