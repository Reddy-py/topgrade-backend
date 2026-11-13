import { supabaseAdmin } from "../supabase.js";

async function inspect() {
  console.log("=== INSPECTING EXISTING TABLES AND SAMPLE ROWS ===");

  const tables = [
    "students",
    "teachers",
    "courses",
    "attendance",
    "fees",
    "token_ledger",
    "token_wallets",
    "teacher_slot_claims",
    "parent_students",
    "profiles",
    "enrollments",
    "student_enrollments"
  ];

  for (const t of tables) {
    const { data, error } = await supabaseAdmin.from(t).select("*").limit(1);
    if (error) {
      console.log(`\n--- TABLE: ${t} (ERROR: ${error.message}) ---`);
    } else if (data && data.length > 0) {
      console.log(`\n--- TABLE: ${t} (Keys: ${Object.keys(data[0]).join(", ")}) ---`);
      console.log("Sample row:", JSON.stringify(data[0], null, 2));
    } else {
      console.log(`\n--- TABLE: ${t} (EMPTY, 0 rows) ---`);
      // Try to insert and rollback or select with limit 0
      const { error: emptyErr } = await supabaseAdmin.from(t).select("*").limit(0);
      console.log("Empty check status:", emptyErr ? emptyErr.message : "Table exists");
    }
  }
}

inspect().then(() => process.exit(0)).catch(e => { console.error(e); process.exit(1); });

