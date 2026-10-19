/**
 * TASK 14: Seed DEMO Family for Client Presentation
 *
 * Requirements:
 * - "Demo Parent" with placeholder-free demo email (demo.parent@topgradelearning.com)
 * - Two children in different grades ("Demo Alice", "Demo Bob")
 * - Two enrollments
 * - One schedule slot at a school location ("Demo Heritage Elementary School")
 * - Three days of attendance
 * - Some hours credited (token wallets and ledger)
 * - Prefix EVERYTHING with 'Demo '
 * - Refuses to touch old Supabase project (zznzmzwiewsnmykcbcni)
 * - Never prints secrets or passwords
 * - No email sent
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

export async function seedDemoFamily() {
  const args = process.argv.slice(2);
  const isApply = args.includes("--apply");
  const isDryRun = !isApply;

  const dbUrl = process.env.DATABASE_URL || "";
  const sbUrl = process.env.SUPABASE_URL || "";
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY || "";
  const demoParentPassword = process.env.TEST_DEMO_PARENT_PASSWORD || process.env.DEFAULT_INITIAL_PASSWORD || "TopGradeDemo2026!";

  checkSafetyAgainstOldProject(dbUrl, sbUrl);

  console.log("================================================================================");
  console.log("TOPGRADE CRM: SEED DEMO FAMILY FOR CLIENT PRESENTATION");
  console.log(`Execution Mode: ${isDryRun ? "DRY-RUN (Default — no records written)" : "APPLY (Writing demo records)"}`);
  console.log("================================================================================\n");

  if (!sbUrl || !serviceKey) {
    throw new Error("SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY must be provided in .env.");
  }

  const supabase = createClient(sbUrl, serviceKey, {
    auth: { autoRefreshToken: false, persistSession: false }
  });

  if (isDryRun) {
    console.log("▶ [DRY-RUN PLAN]");
    console.log("The following records will be created with the 'Demo ' prefix:\n");
    console.log("1. Demo Parent Account:");
    console.log("   - Name: Demo Parent");
    console.log("   - Email: demo.parent@topgradelearning.com");
    console.log("   - Role: PARENT");
    console.log("   - must_change_password: true");
    console.log("2. Two Demo Children in Different Grades:");
    console.log("   - Demo Alice: 4th Grade, Math Track (demo.alice@topgradelearning.com)");
    console.log("   - Demo Bob: 8th Grade, Robotics Track (demo.bob@topgradelearning.com)");
    console.log("3. Two Demo Courses:");
    console.log("   - Demo Math Enrichment (TUTORING, $45/hr)");
    console.log("   - Demo Robotics Afterschool (AFTERSCHOOL, $55/hr)");
    console.log("4. Two Student Enrollments:");
    console.log("   - Demo Alice: Demo Math Enrichment (20 hours total)");
    console.log("   - Demo Bob: Demo Robotics Afterschool (15 hours total)");
    console.log("5. One Demo School Location & Faculty:");
    console.log("   - Demo Location: Demo Heritage Elementary School (SCHOOL)");
    console.log("   - Demo Teacher: Demo Teacher (Faculty)");
    console.log("6. One Schedule Slot at School Location:");
    console.log("   - Demo Heritage Elementary Afterschool Slot (Mondays 04:00 PM - 05:30 PM)");
    console.log("7. Three Days of Attendance Records:");
    console.log("   - 2026-10-12, 2026-10-14, 2026-10-16 marked PRESENT for Demo Alice");
    console.log("8. Token Wallets & Hours Ledger:");
    console.log("   - 20 hours purchased, 3 hours attended, 17 hours remaining balance");
    console.log("\nTo apply these changes, run: npm run demo:seed -- --apply\n");
    return;
  }

  console.log("▶ [APPLY] Writing Demo Family records to database...");

  // 1. Create or update Demo Parent in Supabase Auth & Profiles
  console.log("  1. Setting up Demo Parent (demo.parent@topgradelearning.com)...");
  let parentUserId: string | null = null;
  const { data: usersPage } = await supabase.auth.admin.listUsers({ page: 1, perPage: 100 });
  const existingParent = usersPage?.users?.find(u => (u.email || "").toLowerCase() === "demo.parent@topgradelearning.com");

  if (existingParent) {
    parentUserId = existingParent.id;
    await supabase.auth.admin.updateUserById(parentUserId, {
      password: demoParentPassword,
      email_confirm: true,
      user_metadata: { full_name: "Demo Parent", role: "PARENT" }
    });
  } else {
    const { data: created, error: createErr } = await supabase.auth.admin.createUser({
      email: "demo.parent@topgradelearning.com",
      password: demoParentPassword,
      email_confirm: true,
      user_metadata: { full_name: "Demo Parent", role: "PARENT" }
    });
    if (createErr || !created.user) {
      throw new Error(`Failed to create Demo Parent auth user: ${createErr?.message}`);
    }
    parentUserId = created.user.id;
  }

  await supabase.from("profiles").upsert({
    id: parentUserId,
    email: "demo.parent@topgradelearning.com",
    full_name: "Demo Parent",
    role: "PARENT",
    status: "Active",
    phone: "+1 (555) 019-9001",
    must_change_password: true,
    updated_at: new Date().toISOString()
  });

  // 2. Demo Location
  console.log("  2. Setting up Demo School Location...");
  const demoLocationId = "loc-demo-school";
  await supabase.from("locations").upsert({
    id: demoLocationId,
    name: "Demo Heritage Elementary School",
    type: "SCHOOL",
    address: "450 Demo Heritage Way, Frisco, TX 75034",
    updated_at: new Date().toISOString()
  });

  // 3. Demo Teacher
  console.log("  3. Setting up Demo Teacher...");
  const demoTeacherId = "tch-demo-1";
  await supabase.from("teachers").upsert({
    id: demoTeacherId,
    name: "Demo Teacher",
    email: "demo.teacher@topgradelearning.com",
    phone: "+1 (555) 019-9002",
    subject: "Demo Math & Robotics",
    status: "Active"
  });

  // 4. Demo Courses
  console.log("  4. Setting up Demo Courses...");
  const demoMathCourseId = "crs-demo-math";
  const demoRoboticsCourseId = "crs-demo-robotics";

  await supabase.from("courses").upsert([
    {
      id: demoMathCourseId,
      name: "Demo Math Enrichment",
      code: "DEMO-MTH-101",
      category: "Math",
      grade: "4th Grade",
      fee: 900,
      hourly_rate: 45,
      package_hours: 20,
      duration: "6 Months",
      duration_months: 6,
      status: "Active"
    },
    {
      id: demoRoboticsCourseId,
      name: "Demo Robotics Afterschool",
      code: "DEMO-ROB-201",
      category: "Robotics",
      grade: "8th Grade",
      fee: 825,
      hourly_rate: 55,
      package_hours: 15,
      duration: "3 Months",
      duration_months: 3,
      status: "Active"
    }
  ]);

  // 5. Demo Children (Students)
  console.log("  5. Setting up Two Demo Children in Different Grades...");
  // Check if students already exist
  const { data: existingAlice } = await supabase.from("students").select("id").eq("student_id_code", "TG-DEMO-001").maybeSingle();
  let aliceId = existingAlice?.id;

  if (!aliceId) {
    const { data: insertedAlice, error: aliceErr } = await supabase.from("students").insert({
      student_id_code: "TG-DEMO-001",
      name: "Demo Alice",
      gender: "Female",
      dob: "2016-04-15",
      age: 10,
      grade: "4th Grade",
      nationality: "4th Grade",
      school: "Demo Heritage Elementary School",
      address: "100 Demo Oak Ave, Frisco, TX | School: Demo Heritage Elementary School",
      email: "demo.alice@topgradelearning.com",
      phone: "+1 (555) 019-9003",
      father_name: "Demo Parent",
      parent_emails: ["demo.parent@topgradelearning.com"],
      program: "Demo Math Enrichment",
      program_type: "TUTORING",
      teacher: "Demo Teacher",
      purchased_hours: 20,
      status: "ACTIVE"
    }).select("id").single();
    if (aliceErr || !insertedAlice) throw new Error(`Failed to create Demo Alice: ${aliceErr?.message}`);
    aliceId = insertedAlice.id;
  }

  const { data: existingBob } = await supabase.from("students").select("id").eq("student_id_code", "TG-DEMO-002").maybeSingle();
  let bobId = existingBob?.id;

  if (!bobId) {
    const { data: insertedBob, error: bobErr } = await supabase.from("students").insert({
      student_id_code: "TG-DEMO-002",
      name: "Demo Bob",
      gender: "Male",
      dob: "2012-08-20",
      age: 14,
      grade: "8th Grade",
      nationality: "8th Grade",
      school: "Demo Heritage Middle School",
      address: "100 Demo Oak Ave, Frisco, TX | School: Demo Heritage Middle School",
      email: "demo.bob@topgradelearning.com",
      phone: "+1 (555) 019-9004",
      father_name: "Demo Parent",
      parent_emails: ["demo.parent@topgradelearning.com"],
      program: "Demo Robotics Afterschool",
      program_type: "AFTERSCHOOL",
      teacher: "Demo Teacher",
      purchased_hours: 15,
      status: "ACTIVE"
    }).select("id").single();
    if (bobErr || !insertedBob) throw new Error(`Failed to create Demo Bob: ${bobErr?.message}`);
    bobId = insertedBob.id;
  }

  // 6. Two Student Enrollments
  console.log("  6. Setting up Two Enrollments in student_enrollments...");
  await supabase.from("student_enrollments").upsert([
    {
      id: "enr-demo-1",
      student_id: aliceId,
      course_id: demoMathCourseId,
      plan: "HOURS",
      hours_total: 20,
      quoted_amount: 900,
      currency: "usd",
      starts_on: "2026-10-01",
      status: "ACTIVE"
    },
    {
      id: "enr-demo-2",
      student_id: bobId,
      course_id: demoRoboticsCourseId,
      plan: "PACKAGE",
      hours_total: 15,
      quoted_amount: 825,
      currency: "usd",
      starts_on: "2026-10-01",
      status: "ACTIVE"
    }
  ]);

  // 7. One Schedule Slot at School Location
  console.log("  7. Setting up Schedule Slot at School Location...");
  const demoScheduleId = "sched-demo-slot";
  await supabase.from("schedules").upsert({
    id: demoScheduleId,
    course_id: demoMathCourseId,
    course_name: "Demo Math Enrichment",
    teacher_id: demoTeacherId,
    teacher_name: "Demo Teacher",
    day_of_week: "Monday",
    start_time: "04:00 PM",
    end_time: "05:30 PM",
    time_slot: "04:00 PM - 05:30 PM",
    room: "Demo Room 101",
    location: "Demo Heritage Elementary School",
    location_id: demoLocationId,
    location_address: "450 Demo Heritage Way, Frisco, TX 75034",
    program_type: "TUTORING",
    max_capacity: 15,
    is_active: true
  });

  // Map Demo Alice into the schedule
  await supabase.from("schedule_students").delete().eq("schedule_id", demoScheduleId);
  await supabase.from("schedule_students").insert([
    {
      schedule_id: demoScheduleId,
      student_id: aliceId,
      student_name: "Demo Alice",
      student_code: "TG-DEMO-001"
    }
  ]);

  // 8. Three Days of Attendance Records
  console.log("  8. Setting up Three Days of Attendance...");
  const dates = ["2026-10-12", "2026-10-14", "2026-10-16"];
  for (const d of dates) {
    await supabase.from("attendance").upsert({
      student_id: aliceId,
      student_code: "TG-DEMO-001",
      course_id: demoMathCourseId,
      course_name: "Demo Math Enrichment",
      schedule_id: demoScheduleId,
      class_key: demoScheduleId,
      date: d,
      status: "PRESENT",
      check_in_time: `${d}T16:00:00Z`,
      check_out_time: `${d}T17:30:00Z`,
      marked_by_name: "Demo Teacher",
      scan_method: "MANUAL_ROLLCALL"
    }, { onConflict: "student_id,class_key,date" });
  }

  // 9. Token Wallets & Hours Ledger
  console.log("  9. Crediting Hours & Setting up Token Wallet...");
  await supabase.from("token_wallets").upsert({
    student_id: aliceId,
    course_id: demoMathCourseId,
    balance: 17,
    total_purchased: 20,
    total_used: 3,
    updated_at: new Date().toISOString()
  }, { onConflict: "student_id,course_id" });

  await supabase.from("token_wallets").upsert({
    student_id: bobId,
    course_id: demoRoboticsCourseId,
    balance: 15,
    total_purchased: 15,
    total_used: 0,
    updated_at: new Date().toISOString()
  }, { onConflict: "student_id,course_id" });

  // Ledger entries
  await supabase.from("token_ledger").delete().in("student_id", [aliceId, bobId]);
  await supabase.from("token_ledger").insert([
    {
      student_id: aliceId,
      course_id: demoMathCourseId,
      delta: 20,
      reason: "PURCHASE",
      ref: "demo-package-initial",
      note: "Initial package of 20 hours for Demo Alice"
    },
    {
      student_id: aliceId,
      course_id: demoMathCourseId,
      delta: -1,
      reason: "CLASS_ATTENDED",
      ref: `demo-att-${aliceId}:2026-10-12`,
      note: "Class attended: Demo Math Enrichment (2026-10-12)"
    },
    {
      student_id: aliceId,
      course_id: demoMathCourseId,
      delta: -1,
      reason: "CLASS_ATTENDED",
      ref: `demo-att-${aliceId}:2026-10-14`,
      note: "Class attended: Demo Math Enrichment (2026-10-14)"
    },
    {
      student_id: aliceId,
      course_id: demoMathCourseId,
      delta: -1,
      reason: "CLASS_ATTENDED",
      ref: `demo-att-${aliceId}:2026-10-16`,
      note: "Class attended: Demo Math Enrichment (2026-10-16)"
    },
    {
      student_id: bobId,
      course_id: demoRoboticsCourseId,
      delta: 15,
      reason: "PURCHASE",
      ref: "demo-package-initial-bob",
      note: "Initial package of 15 hours for Demo Bob"
    }
  ]);

  console.log("\n✅ Demo Family successfully seeded with all required relations!");
  console.log("   - Demo Parent: demo.parent@topgradelearning.com");
  console.log("   - Demo Children: Demo Alice (4th Grade), Demo Bob (8th Grade)");
  console.log("   - Location: Demo Heritage Elementary School");
  console.log("   - Schedule: Demo Heritage Elementary Afterschool Slot");
  console.log("   - Attendance: 3 sessions marked PRESENT");
  console.log("   - Hours: 17 hours remaining balance for Alice, 15 hours for Bob");
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  seedDemoFamily().catch(err => {
    console.error("❌ Seed Demo Family error:", err);
    process.exit(1);
  });
}
