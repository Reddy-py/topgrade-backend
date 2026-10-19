/**
 * TASK 13: Create Admin Accounts for New Supabase Project
 *
 * Rules:
 * - Creates admin@topgrade.edu and tglbiz101@gmail.com.
 * - Reads ADMIN_INITIAL_PASSWORD from local .env (never logs or prints it).
 * - Sets role = 'ADMIN', must_change_password = true.
 * - NEVER emails admin@topgrade.edu.
 * - Refuses to run against the old project ref (zznzmzwiewsnmykcbcni).
 * - Requires --apply to make changes (dry-run first by default).
 */

import path from "path";
import { fileURLToPath } from "url";
import dotenv from "dotenv";
import pg from "pg";
import { createClient } from "@supabase/supabase-js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const BACKEND_ROOT = path.resolve(__dirname, "../..");

dotenv.config({ path: path.join(BACKEND_ROOT, ".env"), override: true });

const OLD_PROJECT_REF = "zznzmzwiewsnmykcbcni";

const ADMIN_TARGETS = [
  {
    email: "admin@topgrade.edu",
    name: "System Administrator",
    role: "ADMIN"
  },
  {
    email: "tglbiz101@gmail.com",
    name: "Institute Administrator",
    role: "ADMIN"
  }
];

export async function main() {
  const args = process.argv.slice(2);
  const isApply = args.includes("--apply");
  const isDryRun = !isApply;

  console.log("================================================================================");
  console.log("TOPGRADE CRM: CREATE INITIAL ADMIN LOGINS");
  console.log(`Execution Mode: ${isDryRun ? "DRY-RUN (Default — no accounts created)" : "APPLY (Creating admin accounts)"}`);
  console.log("================================================================================\n");

  const databaseUrl = process.env.DATABASE_URL || "";
  const supabaseUrl = process.env.SUPABASE_URL || "";
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY || "";
  const adminPassword = process.env.ADMIN_INITIAL_PASSWORD || "";

  // 1. Safety check
  if (databaseUrl.includes(OLD_PROJECT_REF) || supabaseUrl.includes(OLD_PROJECT_REF)) {
    console.error("🛑 CRITICAL SAFETY ABORT: Target database matches the OLD project ref (zznzmzwiewsnmykcbcni).");
    console.error("Aborting immediately to protect the old database.");
    process.exit(1);
  }

  // 2. Validate ADMIN_INITIAL_PASSWORD is set
  if (!adminPassword) {
    console.error("❌ Configuration Error: ADMIN_INITIAL_PASSWORD is not defined in local .env.");
    console.error("Please specify ADMIN_INITIAL_PASSWORD in .env before running this script.");
    process.exit(1);
  }

  if (isDryRun) {
    console.log("▶ [DRY-RUN PLAN]");
    console.log("Will create/update the following ADMIN logins with must_change_password = true:\n");
    console.log("┌──────────────────────────┬──────────────────────────┬──────────┬──────────────────────┐");
    console.log("│ Email                    │ Display Name             │ Role     │ must_change_password │");
    console.log("├──────────────────────────┼──────────────────────────┼──────────┼──────────────────────┤");
    for (const a of ADMIN_TARGETS) {
      console.log(`│ ${a.email.padEnd(24, " ")} │ ${a.name.padEnd(24, " ")} │ ${a.role.padEnd(8, " ")} │ true                 │`);
    }
    console.log("└──────────────────────────┴──────────────────────────┴──────────┴──────────────────────┘");
    console.log("\nSafety Note: admin@topgrade.edu will NEVER be emailed.");
    console.log("To execute creation on the NEW project, run: npm run create:admins -- --apply\n");
    return;
  }

  // 3. Apply execution
  if (!supabaseUrl || !serviceKey) {
    if (!databaseUrl) {
      throw new Error("Either (SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY) or DATABASE_URL must be provided.");
    }
  }

  console.log("▶ [APPLY] Provisioning admin accounts on NEW Supabase project...");

  // Primary approach: Supabase Auth Admin API
  if (supabaseUrl && serviceKey) {
    const adminClient = createClient(supabaseUrl, serviceKey, {
      auth: { autoRefreshToken: false, persistSession: false }
    });

    for (const target of ADMIN_TARGETS) {
      console.log(`  ▶ Provisioning ${target.email}...`);

      // Check existing user
      let userId: string | null = null;
      const { data: listData } = await adminClient.auth.admin.listUsers({ page: 1, perPage: 100 });
      const existingUser = listData?.users?.find(u => u.email?.toLowerCase() === target.email.toLowerCase());

      if (existingUser) {
        userId = existingUser.id;
        await adminClient.auth.admin.updateUserById(userId, {
          password: adminPassword,
          email_confirm: true,
          user_metadata: {
            full_name: target.name,
            role: target.role
          }
        });
        console.log(`    ✓ Updated existing auth user (${target.email}).`);
      } else {
        const { data: newUser, error: createErr } = await adminClient.auth.admin.createUser({
          email: target.email,
          password: adminPassword,
          email_confirm: true,
          user_metadata: {
            full_name: target.name,
            role: target.role
          }
        });

        if (createErr || !newUser?.user) {
          throw new Error(`Failed creating auth user ${target.email}: ${createErr?.message}`);
        }
        userId = newUser.user.id;
        console.log(`    ✓ Created auth user (${target.email}).`);
      }

      // Upsert profile with must_change_password = true
      const { error: profErr } = await adminClient
        .from("profiles")
        .upsert({
          id: userId,
          email: target.email,
          full_name: target.name,
          role: target.role,
          status: "Active",
          must_change_password: true,
          updated_at: new Date().toISOString()
        }, { onConflict: "id" });

      if (profErr) {
        throw new Error(`Failed saving profile for ${target.email}: ${profErr.message}`);
      }
      console.log(`    ✓ Upserted profile with role = 'ADMIN', must_change_password = true.`);
      console.log(`    🔒 [SAFETY CONFIRMED] Zero emails dispatched to ${target.email}.`);
    }
  } else if (databaseUrl) {
    // Fallback: Direct PostgreSQL
    const pool = new pg.Pool({ connectionString: databaseUrl, ssl: { rejectUnauthorized: false } });
    try {
      for (const target of ADMIN_TARGETS) {
        console.log(`  ▶ Provisioning via SQL: ${target.email}...`);
        const sql = `
          INSERT INTO auth.users (
            id, instance_id, aud, role, email, encrypted_password, email_confirmed_at,
            raw_app_meta_data, raw_user_meta_data, created_at, updated_at
          ) VALUES (
            gen_random_uuid(),
            '00000000-0000-0000-0000-000000000000',
            'authenticated',
            'authenticated',
            '${target.email}',
            crypt($1, gen_salt('bf')),
            NOW(),
            '{"provider":"email","providers":["email"]}'::jsonb,
            '{"role":"ADMIN","full_name":"${target.name}"}'::jsonb,
            NOW(),
            NOW()
          )
          ON CONFLICT (email) DO UPDATE SET
            encrypted_password = crypt($1, gen_salt('bf')),
            raw_user_meta_data = '{"role":"ADMIN","full_name":"${target.name}"}'::jsonb,
            updated_at = NOW();

          INSERT INTO public.profiles (id, email, full_name, role, status, must_change_password)
          SELECT id, email, '${target.name}', 'ADMIN', 'Active', true
          FROM auth.users WHERE email = '${target.email}'
          ON CONFLICT (id) DO UPDATE SET
            role = 'ADMIN',
            status = 'Active',
            must_change_password = true,
            updated_at = NOW();
        `;
        await pool.query(sql, [adminPassword]);
        console.log(`    ✓ Created/updated auth user and profile via SQL (${target.email}).`);
        console.log(`    🔒 [SAFETY CONFIRMED] Zero emails dispatched to ${target.email}.`);
      }
    } finally {
      await pool.end();
    }
  }

  console.log("\n================================================================================");
  console.log("🎉 VERDICT: PASS — ADMIN ACCOUNTS CREATED SUCCESSFULLY ON NEW SUPABASE PROJECT!");
  console.log("• admin@topgrade.edu (must_change_password = true, 0 emails sent)");
  console.log("• tglbiz101@gmail.com (must_change_password = true)");
  console.log("================================================================================\n");
}

if (process.argv[1]?.includes("createAdminAccounts")) {
  main()
    .then(() => process.exit(0))
    .catch(err => {
      console.error("\n❌ Admin creation failed:", err.message);
      process.exit(1);
    });
}
