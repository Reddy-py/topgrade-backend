import dotenv from "dotenv";
import { createClient } from "@supabase/supabase-js";
import path from "path";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

dotenv.config({ path: path.resolve(__dirname, "../.env") });

const supabaseUrl = process.env.SUPABASE_URL || "";
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY || "";

console.log("Connecting to Supabase at:", supabaseUrl);
const supabase = createClient(supabaseUrl, supabaseKey, {
  auth: { autoRefreshToken: false, persistSession: false }
});

async function main() {
  // 1. Check students table columns by querying a single row
  const { data: sampleStudent, error: err } = await supabase.from("students").select("*").limit(1);
  if (err) {
    console.error("Error reading students table:", err.message);
  } else {
    console.log("Sample student keys:", Object.keys(sampleStudent?.[0] || {}));
  }

  // 2. Check if exam_date column exists or try updating a dummy test or query
  const { data: testCol, error: testColErr } = await supabase.from("students").select("exam_date").limit(1);
  if (testColErr) {
    console.log("exam_date column status:", testColErr.message);
  } else {
    console.log("exam_date column already exists and is queryable! Data:", testCol);
  }

  // 3. Confirm all unconfirmed users in auth.users
  console.log("Fetching Supabase Auth users to ensure all are confirmed...");
  let page = 1;
  let hasMore = true;
  let confirmedCount = 0;
  let totalUsers = 0;

  while (hasMore) {
    const { data: usersData, error: uErr } = await supabase.auth.admin.listUsers({ page, perPage: 100 });
    if (uErr || !usersData?.users || usersData.users.length === 0) {
      hasMore = false;
      break;
    }

    totalUsers += usersData.users.length;
    for (const u of usersData.users) {
      if (!u.email_confirmed_at) {
        try {
          await supabase.auth.admin.updateUserById(u.id, { email_confirm: true });
          confirmedCount++;
          console.log(`  Confirmed email for user: ${u.email}`);
        } catch (confErr: any) {
          console.warn(`  Could not confirm ${u.email}:`, confErr.message);
        }
      }
    }

    if (usersData.users.length < 100) {
      hasMore = false;
    } else {
      page++;
    }
  }

  console.log(`Processed ${totalUsers} auth users. Confirmed ${confirmedCount} previously unconfirmed accounts.`);
}

main().catch(console.error);
