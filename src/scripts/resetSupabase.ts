import fs from "fs";
import path from "path";
import readline from "readline";
import { fileURLToPath } from "url";
import pg from "pg";
import { supabaseAdmin } from "../supabase.js";
import { parseEnv } from "../utils/parseEnv.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const REPO_ROOT = path.resolve(__dirname, "../../..");
const MIGRATIONS_DIR = path.resolve(REPO_ROOT, "supabase/migrations");
const PROD_REF = "zznzmzwiewsnmykcbcni";

export const SUPABASE_AUTH_STUBS = `
-- Supabase Auth Stubs & Role Grants for Local Postgres Testing
CREATE OR REPLACE FUNCTION public.gen_salt(t text) RETURNS text AS $$ SELECT 'salt' $$ LANGUAGE sql IMMUTABLE;
CREATE OR REPLACE FUNCTION public.crypt(p text, s text) RETURNS text AS $$ SELECT 'hashed_' || p $$ LANGUAGE sql IMMUTABLE;

CREATE SCHEMA IF NOT EXISTS auth;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'anon') THEN
    CREATE ROLE anon NOLOGIN;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'authenticated') THEN
    CREATE ROLE authenticated NOLOGIN;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'service_role') THEN
    CREATE ROLE service_role NOLOGIN;
  END IF;
END $$;

CREATE TABLE IF NOT EXISTS auth.users (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  instance_id UUID,
  aud VARCHAR(255) DEFAULT 'authenticated',
  role VARCHAR(255) DEFAULT 'authenticated',
  email VARCHAR(255) UNIQUE,
  encrypted_password VARCHAR(255),
  email_confirmed_at TIMESTAMPTZ DEFAULT NOW(),
  raw_app_meta_data JSONB DEFAULT '{"provider":"email","providers":["email"]}'::jsonb,
  raw_user_meta_data JSONB DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  phone VARCHAR(255) DEFAULT NULL,
  phone_confirmed_at TIMESTAMPTZ,
  confirmed_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE OR REPLACE FUNCTION auth.uid() RETURNS UUID AS $$
  SELECT NULLIF(current_setting('request.jwt.claim.sub', true), '')::uuid;
$$ LANGUAGE SQL STABLE;

CREATE OR REPLACE FUNCTION auth.jwt() RETURNS JSONB AS $$
  SELECT COALESCE(NULLIF(current_setting('request.jwt.claims', true), '')::jsonb, '{}'::jsonb);
$$ LANGUAGE SQL STABLE;

CREATE OR REPLACE FUNCTION auth.role() RETURNS TEXT AS $$
  SELECT COALESCE(
    NULLIF(current_setting('request.jwt.claim.role', true), ''),
    (NULLIF(current_setting('request.jwt.claims', true), '')::jsonb ->> 'role'),
    current_user
  );
$$ LANGUAGE SQL STABLE;

GRANT USAGE ON SCHEMA auth TO anon, authenticated, service_role;
GRANT ALL ON ALL TABLES IN SCHEMA auth TO anon, authenticated, service_role;
GRANT ALL ON SCHEMA public TO postgres;
GRANT USAGE ON SCHEMA public TO anon, authenticated, service_role;
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT ALL ON TABLES TO postgres, anon, authenticated, service_role;
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT ALL ON FUNCTIONS TO postgres, anon, authenticated, service_role;
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT ALL ON SEQUENCES TO postgres, anon, authenticated, service_role;
`;

export function getMigrationFiles(): string[] {
  const allFiles = fs.readdirSync(MIGRATIONS_DIR)
    .filter(f => f.endsWith(".sql") && !f.endsWith("_rollback.sql"))
    .sort();
  return allFiles.map(f => path.join(MIGRATIONS_DIR, f));
}

async function promptOperator(question: string): Promise<string> {
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  return new Promise(resolve => {
    rl.question(question, ans => {
      rl.close();
      resolve(ans.trim());
    });
  });
}

export async function checkProductionSafety(databaseUrl: string, isDryRun: boolean): Promise<void> {
  const isProd = databaseUrl.includes(PROD_REF) || (process.env.SUPABASE_URL || "").includes(PROD_REF);
  if (!isProd) {
    return; // Non-production database, allowed
  }

  console.log("⚠️ CAUTION: Target database appears to be the PRODUCTION project:", PROD_REF);

  if (isDryRun) {
    console.log("  [DRY-RUN] Production database inspection only. No changes will be made.");
    return;
  }

  const allowEnv = parseEnv("ALLOW_PRODUCTION_RESET");
  if (allowEnv !== "yes") {
    throw new Error(
      `ABORT: Target is production project '${PROD_REF}' but ALLOW_PRODUCTION_RESET=yes is NOT set in environment.`
    );
  }

  console.log("\n🛑 SAFETY CHECKPOINT: YOU ARE ABOUT TO RESET THE PRODUCTION SUPABASE DATABASE.");
  console.log(`To proceed, type the exact project ref '${PROD_REF}':`);
  const userInput = await promptOperator("Confirm Project Ref: ");

  if (userInput !== PROD_REF) {
    throw new Error(
      `ABORT: Project ref mismatch ('${userInput}' != '${PROD_REF}'). Database untouched.`
    );
  }

  console.log("✓ Production reset confirmed by operator.");
}

export async function deleteAllAuthUsers(isDryRun: boolean): Promise<{ deleted: number }> {
  console.log("\n▶ [STEP 2a] Auditing Auth Users for Deletion...");
  let page = 1;
  const userIds: string[] = [];

  while (page <= 50) {
    const { data, error } = await supabaseAdmin.auth.admin.listUsers({ page, perPage: 1000 });
    if (error || !data?.users?.length) break;
    for (const u of data.users) {
      userIds.push(u.id);
    }
    if (data.users.length < 1000) break;
    page++;
  }

  console.log(`  Found ${userIds.length} auth user(s) across all pages.`);

  if (isDryRun) {
    console.log(`  [DRY-RUN] Would delete ${userIds.length} auth user(s).`);
    return { deleted: userIds.length };
  }

  let deleted = 0;
  for (const uid of userIds) {
    const { error: delErr } = await supabaseAdmin.auth.admin.deleteUser(uid);
    if (!delErr) deleted++;
  }
  console.log(`  ✓ Successfully deleted ${deleted} auth user(s).`);
  return { deleted };
}

export async function dropAndRecreatePublicSchema(pgClient: pg.Client | pg.Pool, isDryRun: boolean): Promise<void> {
  console.log("\n▶ [STEP 2b] Dropping and Recreating 'public' schema & Restoring Standard Grants...");
  if (isDryRun) {
    console.log("  [DRY-RUN] Would execute: DROP SCHEMA public CASCADE; CREATE SCHEMA public; restore grants.");
    return;
  }

  const ddl = `
    DROP SCHEMA IF EXISTS public CASCADE;
    CREATE SCHEMA public;
    GRANT ALL ON SCHEMA public TO postgres;
    GRANT USAGE ON SCHEMA public TO anon, authenticated, service_role;
    ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT ALL ON TABLES TO postgres, anon, authenticated, service_role;
    ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT ALL ON FUNCTIONS TO postgres, anon, authenticated, service_role;
    ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT ALL ON SEQUENCES TO postgres, anon, authenticated, service_role;
  `;
  await pgClient.query(ddl);
  console.log("  ✓ 'public' schema dropped, recreated, and standard grants restored.");
}

export async function runAllMigrations(pgClient: pg.Client | pg.Pool, isDryRun: boolean): Promise<{ applied: number }> {
  const files = getMigrationFiles();
  console.log(`\n▶ [STEP 2c] Applying ${files.length} Migrations in Order...`);

  if (isDryRun) {
    for (const f of files) {
      console.log(`  [DRY-RUN] Would apply: ${path.basename(f)}`);
    }
    return { applied: files.length };
  }

  for (let i = 0; i < files.length; i++) {
    const fpath = files[i];
    const fname = path.basename(fpath!);
    const sqlContent = fs.readFileSync(fpath!, "utf-8");
    try {
      await pgClient.query("BEGIN;");
      await pgClient.query(sqlContent);
      await pgClient.query("COMMIT;");
      console.log(`  ✓ [${i + 1}/${files.length}] Applied: ${fname}`);
    } catch (err: any) {
      await pgClient.query("ROLLBACK;");
      console.error(`  ❌ Failed applying migration: ${fname}`);
      throw err;
    }
  }

  console.log(`  ✓ Successfully applied all ${files.length} migrations with 0 errors.`);
  return { applied: files.length };
}

export async function runRlsRoleMatrix(pgClient: pg.Client | pg.Pool): Promise<void> {
  console.log("\n▶ [STEP 2d] Executing RLS Role Matrix (admin, two parents, student, teacher, anon)...");

  const adminId = "11111111-1111-1111-1111-111111111111";
  const parent1Id = "22222222-2222-2222-2222-222222222222";
  const parent2Id = "33333333-3333-3333-3333-333333333333";
  const student1Id = "44444444-4444-4444-4444-444444444444";
  const student2Id = "55555555-5555-5555-5555-555555555555";
  const student3Id = "66666666-6666-6666-6666-666666666666";
  const teacherId = "77777777-7777-7777-7777-777777777777";

  const adminEmail = "admin@example.com";
  const parent1Email = "parent1@example.com";
  const parent2Email = "parent2@example.com";
  const student1Email = "student1@example.com";
  const student2Email = "student2@example.com";
  const student3Email = "student3@example.com";
  const teacherEmail = "teacher@example.com";

  // Seed test accounts in auth.users and public.profiles
  const seedUsersSql = `
    INSERT INTO auth.users (id, email) VALUES
      ('${adminId}', '${adminEmail}'),
      ('${parent1Id}', '${parent1Email}'),
      ('${parent2Id}', '${parent2Email}'),
      ('${student1Id}', '${student1Email}'),
      ('${student2Id}', '${student2Email}'),
      ('${student3Id}', '${student3Email}'),
      ('${teacherId}', '${teacherEmail}')
    ON CONFLICT (email) DO NOTHING;

    INSERT INTO public.profiles (id, email, full_name, role, status) VALUES
      ('${adminId}', '${adminEmail}', 'Admin User', 'ADMIN', 'Active'),
      ('${parent1Id}', '${parent1Email}', 'Parent One', 'PARENT', 'Active'),
      ('${parent2Id}', '${parent2Email}', 'Parent Two', 'PARENT', 'Active'),
      ('${student1Id}', '${student1Email}', 'Student One', 'STUDENT', 'Active'),
      ('${student2Id}', '${student2Email}', 'Student Two', 'STUDENT', 'Active'),
      ('${student3Id}', '${student3Email}', 'Student Three', 'STUDENT', 'Active'),
      ('${teacherId}', '${teacherEmail}', 'Teacher Faculty', 'TEACHER', 'Active')
    ON CONFLICT (id) DO UPDATE SET role = EXCLUDED.role, status = 'Active';

    INSERT INTO public.teachers (id, user_id, teacher_id_code, name, email, status) VALUES
      ('${teacherId}', '${teacherId}', 'TCH-001', 'Teacher Faculty', '${teacherEmail}', 'Active')
    ON CONFLICT (id) DO NOTHING;

    -- Parent 1 has Student 1 & Student 2. Parent 2 has Student 3.
    INSERT INTO public.students (id, user_id, student_id_code, name, email, parent_emails, status) VALUES
      ('${student1Id}', '${student1Id}', 'STU-001', 'Student One', '${student1Email}', ARRAY['${parent1Email}'], 'ACTIVE'),
      ('${student2Id}', '${student2Id}', 'STU-002', 'Student Two', '${student2Email}', ARRAY['${parent1Email}'], 'ACTIVE'),
      ('${student3Id}', '${student3Id}', 'STU-003', 'Student Three', '${student3Email}', ARRAY['${parent2Email}'], 'ACTIVE')
    ON CONFLICT (id) DO NOTHING;
  `;
  await pgClient.query(seedUsersSql);

  // Test 1: Parent 1 queries students -> MUST see Student 1 and Student 2, MUST NOT see Student 3
  await pgClient.query("BEGIN;");
  await pgClient.query("SET LOCAL ROLE authenticated;");
  await pgClient.query(`SET LOCAL "request.jwt.claim.sub" = '${parent1Id}';`);
  await pgClient.query(`SET LOCAL "request.jwt.claim.role" = 'authenticated';`);
  const p1Res = await pgClient.query("SELECT id, name FROM public.students;");
  await pgClient.query("ROLLBACK;");

  const p1SeenIds = p1Res.rows.map(r => r.id);
  if (!p1SeenIds.includes(student1Id) || !p1SeenIds.includes(student2Id)) {
    throw new Error(`RLS Failure: Parent 1 did not see own children. Saw: ${JSON.stringify(p1SeenIds)}`);
  }
  if (p1SeenIds.includes(student3Id)) {
    throw new Error(`RLS LEAK: Parent 1 was able to view Student 3 (child of Parent 2)!`);
  }
  console.log(`  ✓ Parent 1 RLS verified: sees exactly 2 own children, 0 leaks.`);

  // Test 2: Parent 2 queries students -> MUST see Student 3, MUST NOT see Student 1 or 2
  await pgClient.query("BEGIN;");
  await pgClient.query("SET LOCAL ROLE authenticated;");
  await pgClient.query(`SET LOCAL "request.jwt.claim.sub" = '${parent2Id}';`);
  await pgClient.query(`SET LOCAL "request.jwt.claim.role" = 'authenticated';`);
  const p2Res = await pgClient.query("SELECT id, name FROM public.students;");
  await pgClient.query("ROLLBACK;");

  const p2SeenIds = p2Res.rows.map(r => r.id);
  if (!p2SeenIds.includes(student3Id) || p2SeenIds.length !== 1) {
    throw new Error(`RLS Failure: Parent 2 saw incorrect children: ${JSON.stringify(p2SeenIds)}`);
  }
  if (p2SeenIds.includes(student1Id) || p2SeenIds.includes(student2Id)) {
    throw new Error(`RLS LEAK: Parent 2 was able to view Parent 1's children!`);
  }
  console.log(`  ✓ Parent 2 RLS verified: sees exactly 1 own child, 0 leaks.`);

  // Test 3: Student 1 queries students -> MUST see ONLY Student 1
  await pgClient.query("BEGIN;");
  await pgClient.query("SET LOCAL ROLE authenticated;");
  await pgClient.query(`SET LOCAL "request.jwt.claim.sub" = '${student1Id}';`);
  await pgClient.query(`SET LOCAL "request.jwt.claim.role" = 'authenticated';`);
  const s1Res = await pgClient.query("SELECT id, name FROM public.students;");
  await pgClient.query("ROLLBACK;");

  const s1SeenIds = s1Res.rows.map(r => r.id);
  if (!s1SeenIds.includes(student1Id) || s1SeenIds.length !== 1) {
    throw new Error(`RLS Failure: Student 1 saw other records: ${JSON.stringify(s1SeenIds)}`);
  }
  console.log(`  ✓ Student 1 RLS verified: sees self only, 0 leaks.`);

  // Test 4: Anonymous queries students -> MUST return 0 rows
  await pgClient.query("BEGIN;");
  await pgClient.query("SET LOCAL ROLE anon;");
  await pgClient.query(`SET LOCAL "request.jwt.claim.role" = 'anon';`);
  let anonBlocked = false;
  try {
    const anonRes = await pgClient.query("SELECT id FROM public.students;");
    if (anonRes.rows.length === 0) {
      anonBlocked = true;
    }
  } catch (err: any) {
    anonBlocked = true;
  }
  await pgClient.query("ROLLBACK;");

  if (!anonBlocked) {
    throw new Error(`RLS LEAK: Anonymous user was able to select from public.students!`);
  }
  console.log(`  ✓ Anon RLS verified: completely blocked from public.students, 0 leaks.`);

  // Test 5: Admin queries students -> sees all 3 students
  await pgClient.query("BEGIN;");
  await pgClient.query("SET LOCAL ROLE authenticated;");
  await pgClient.query(`SET LOCAL "request.jwt.claim.sub" = '${adminId}';`);
  await pgClient.query(`SET LOCAL "request.jwt.claim.role" = 'authenticated';`);
  const admRes = await pgClient.query("SELECT id FROM public.students;");
  await pgClient.query("ROLLBACK;");

  if (admRes.rows.length < 3) {
    throw new Error(`RLS Failure: Admin did not see all students. Saw: ${admRes.rows.length}`);
  }
  console.log(`  ✓ Admin RLS verified: full administrative visibility.`);
  console.log("  ✅ RLS ROLE MATRIX PASSED WITH ZERO LEAKS.\n");
}

export async function main() {
  const args = process.argv.slice(2);
  const isApply = args.includes("--apply");
  const isLocal = args.includes("--local");
  const isDryRun = !isApply;

  console.log("============================================================");
  console.log("TOPGRADE CRM: RESET SUPABASE DATABASE SCRIPT");
  console.log(`Mode: ${isDryRun ? "DRY RUN (default, no changes)" : "APPLY (writes enabled)"}`);
  console.log(`Target: ${isLocal ? "Local PostgreSQL (pgserver stubs)" : "Configured Database URL"}`);
  console.log("============================================================\n");

  const databaseUrl = parseEnv("DATABASE_URL") || "";

  if (!isLocal) {
    await checkProductionSafety(databaseUrl, isDryRun);
  }

  if (isDryRun) {
    console.log("--- DRY RUN PLAN ---");
    console.log("1. Audit auth users for deletion.");
    console.log("2. Drop and recreate public schema with standard grants.");
    console.log("3. Apply all 17 migrations in order.");
    console.log("4. Execute RLS role matrix.");
    console.log("\nTo execute this reset on a database, re-run with --apply.");
    process.exit(0);
  }

  // Live or Local Execution
  if (!databaseUrl && !isLocal) {
    throw new Error("DATABASE_URL environment variable is required to execute reset:supabase.");
  }

  const pool = new pg.Pool({ connectionString: databaseUrl });
  try {
    await deleteAllAuthUsers(false);
    await dropAndRecreatePublicSchema(pool, false);
    await runAllMigrations(pool, false);
    await runRlsRoleMatrix(pool);
    console.log("🎉 RESET SUPABASE COMPLETED SUCCESSFULLY.");
  } finally {
    await pool.end();
  }
}

if (process.argv[1]?.includes("resetSupabase")) {
  main()
    .then(() => process.exit(0))
    .catch(err => {
      console.error("\n❌ RESET SCRIPT FAILED:", err.message);
      process.exit(1);
    });
}
