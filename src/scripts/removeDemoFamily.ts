/**
 * TASK 14: Remove DEMO Family Records
 *
 * Requirements:
 * - Deletes exactly those records created for the demo:
 *   - Attendance records for demo students / demo courses
 *   - Token wallets & ledger entries for demo students / demo courses
 *   - Enrollments for demo students / demo courses
 *   - Schedule students mapping and demo schedule slot
 *   - Demo location
 *   - Demo teacher
 *   - Demo courses
 *   - Demo students (Alice, Bob)
 *   - Demo profiles and Supabase auth users
 * - Refuses to run against old Supabase project (zznzmzwiewsnmykcbcni)
 */

import path from "path";
import { fileURLToPath } from "url";
import dotenv from "dotenv";
import { createClient } from "@supabase/supabase-js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const BACKEND_ROOT = path.resolve(__dirname, "../..");

dotenv.config({ path: path.join(BACKEND_ROOT, ".env"), override: true });

const OLD_PROJECT_REF = "zznzmzwiewsnmykcbcni";

export function checkSafetyAgainstOldProject(dbUrl: string, sbUrl: string): void {
  if (dbUrl.includes(OLD_PROJECT_REF) || sbUrl.includes(OLD_PROJECT_REF)) {
    console.error("\n================================================================================");
    console.error("🛑 CRITICAL SAFETY ABORT: OLD SUPABASE PROJECT DETECTED!");
    console.error(`Target contains '${OLD_PROJECT_REF}'. Refusing to proceed.`);
    console.error("================================================================================\n");
    throw new Error(`ABORT: Target is old project ref '${OLD_PROJECT_REF}'. Operations blocked.`);
  }
}

export async function removeDemoFamily() {
  const dbUrl = process.env.DATABASE_URL || "";
  const sbUrl = process.env.SUPABASE_URL || "";
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY || "";

  checkSafetyAgainstOldProject(dbUrl, sbUrl);

  console.log("================================================================================");
  console.log("TOPGRADE CRM: REMOVE DEMO FAMILY RECORDS");
  console.log("================================================================================\n");

  if (!sbUrl || !serviceKey) {
    throw new Error("SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY must be provided in .env.");
  }

  const supabase = createClient(sbUrl, serviceKey, {
    auth: { autoRefreshToken: false, persistSession: false }
  });

  // 1. Find Demo Student IDs
  const { data: demoStudents } = await supabase
    .from("students")
    .select("id, name, student_id_code")
    .or("name.ilike.Demo %,student_id_code.in.(TG-DEMO-001,TG-DEMO-002)");

  const studentIds = (demoStudents || []).map(s => s.id);
  console.log(`Found ${studentIds.length} demo student(s) to remove.`);

  const demoCourseIds = ["crs-demo-math", "crs-demo-robotics"];
  const demoScheduleId = "sched-demo-slot";
  const demoLocationId = "loc-demo-school";
  const demoTeacherId = "tch-demo-1";
  const demoEmails = [
    "demo.parent@topgradelearning.com",
    "demo.alice@topgradelearning.com",
    "demo.bob@topgradelearning.com",
    "demo.teacher@topgradelearning.com"
  ];

  // 2. Delete attendance records
  if (studentIds.length > 0) {
    const { count: attCount } = await supabase
      .from("attendance")
      .delete({ count: "exact" })
      .or(`student_id.in.(${studentIds.map(id => `"${id}"`).join(",")}),course_name.ilike.Demo %`);
    console.log(`✓ Deleted ${attCount || 0} demo attendance record(s).`);
  }

  // 3. Delete token ledger & wallets
  if (studentIds.length > 0) {
    const { count: ledCount } = await supabase
      .from("token_ledger")
      .delete({ count: "exact" })
      .in("student_id", studentIds);
    console.log(`✓ Deleted ${ledCount || 0} demo token ledger entry/entries.`);

    const { count: walCount } = await supabase
      .from("token_wallets")
      .delete({ count: "exact" })
      .in("student_id", studentIds);
    console.log(`✓ Deleted ${walCount || 0} demo token wallet(s).`);
  }

  // 4. Delete student enrollments
  if (studentIds.length > 0) {
    const { count: enrCount } = await supabase
      .from("student_enrollments")
      .delete({ count: "exact" })
      .in("student_id", studentIds);
    console.log(`✓ Deleted ${enrCount || 0} demo student enrollment(s).`);
  }

  // 5. Delete schedule students & schedule slot
  await supabase.from("schedule_students").delete().eq("schedule_id", demoScheduleId);
  const { count: schedCount } = await supabase
    .from("schedules")
    .delete({ count: "exact" })
    .or(`id.eq.${demoScheduleId},course_name.ilike.Demo %`);
  console.log(`✓ Deleted ${schedCount || 0} demo schedule slot(s).`);

  // 6. Delete demo teacher
  const { count: tchCount } = await supabase
    .from("teachers")
    .delete({ count: "exact" })
    .or(`id.eq.${demoTeacherId},name.ilike.Demo %`);
  console.log(`✓ Deleted ${tchCount || 0} demo teacher(s).`);

  // 7. Delete demo courses
  const { count: crsCount } = await supabase
    .from("courses")
    .delete({ count: "exact" })
    .or(`id.in.(${demoCourseIds.map(id => `"${id}"`).join(",")}),name.ilike.Demo %`);
  console.log(`✓ Deleted ${crsCount || 0} demo course(s).`);

  // 8. Delete demo school location
  const { count: locCount } = await supabase
    .from("locations")
    .delete({ count: "exact" })
    .or(`id.eq.${demoLocationId},name.ilike.Demo %`);
  console.log(`✓ Deleted ${locCount || 0} demo location(s).`);

  // 9. Delete demo students
  if (studentIds.length > 0) {
    const { count: stuCount } = await supabase
      .from("students")
      .delete({ count: "exact" })
      .in("id", studentIds);
    console.log(`✓ Deleted ${stuCount || 0} demo student record(s).`);
  }

  // 10. Delete demo profiles and Auth users
  const { data: usersPage } = await supabase.auth.admin.listUsers({ page: 1, perPage: 100 });
  const authUsersToDelete = (usersPage?.users || []).filter(u =>
    demoEmails.includes((u.email || "").toLowerCase())
  );

  for (const u of authUsersToDelete) {
    await supabase.from("profiles").delete().eq("id", u.id);
    await supabase.auth.admin.deleteUser(u.id);
    console.log(`✓ Deleted demo auth user and profile (${u.email}).`);
  }

  // Extra safety: clean any remaining profiles matching demo emails
  await supabase.from("profiles").delete().in("email", demoEmails);

  console.log("\n✅ All Demo Family records removed cleanly!");
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  removeDemoFamily().catch(err => {
    console.error("❌ Remove Demo Family error:", err);
    process.exit(1);
  });
}
