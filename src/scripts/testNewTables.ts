import { supabaseAdmin } from "../supabase.js";

async function test() {
  const tables = ["schedules", "student_enrollments", "course_packages", "announcements", "announcement_deliveries", "institute_settings"];
  for (const t of tables) {
    const { data, error } = await supabaseAdmin.from(t).select("*").limit(1);
    console.log(`${t}:`, error ? `❌ ${error.message}` : `✅ exists (${data?.length} rows)`);
  }
}

test().then(() => process.exit(0)).catch(console.error);

