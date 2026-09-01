import dotenv from "dotenv";
import { createClient } from "@supabase/supabase-js";

dotenv.config();

const supabase = createClient(
  process.env.SUPABASE_URL || "",
  process.env.SUPABASE_SERVICE_ROLE_KEY || "",
  { auth: { autoRefreshToken: false, persistSession: false } }
);

async function inspect() {
  console.log("=== INSPECTING COLUMNS FOR SUPABASE TABLES ===");

  const tables = ["students", "teachers", "courses", "admission_requests"];

  for (const t of tables) {
    const { data, error } = await supabase.from(t).insert({ __dummy_col_test: 1 }).select();
    console.log(`Table '${t}' response:`, error?.message || data);
  }
}

inspect();
