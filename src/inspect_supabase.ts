import dotenv from "dotenv";
import { createClient } from "@supabase/supabase-js";

dotenv.config();

const supabaseUrl = process.env.SUPABASE_URL || "https://zznzmzwiewsnmykcbcni.supabase.co";
const supabaseServiceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY || "";

const supabase = createClient(supabaseUrl, supabaseServiceRoleKey, {
  auth: { autoRefreshToken: false, persistSession: false }
});

async function main() {
  console.log("=== SUPABASE STATUS CHECK ===");
  console.log("URL:", supabaseUrl);

  try {
    const { data: usersData, error: uErr } = await supabase.auth.admin.listUsers();
    if (uErr) {
      console.log("Auth error:", uErr.message);
    } else {
      console.log(`Auth users count: ${usersData?.users?.length || 0}`);
      usersData?.users?.forEach(u => {
        console.log(` - Email: ${u.email} | Role: ${u.user_metadata?.role} | ID: ${u.id}`);
      });
    }
  } catch (err: any) {
    console.log("Auth Exception:", err.message);
  }

  const tableNames = ["students", "teachers", "courses", "profiles", "admission_requests", "users"];
  for (const table of tableNames) {
    try {
      const { data, error } = await supabase.from(table).select("*").limit(5);
      if (error) {
        console.log(`Table '${table}' -> Status: ERROR (${error.message}, Code: ${error.code})`);
      } else {
        console.log(`Table '${table}' -> Status: EXISTS, Records count: ${data?.length || 0}`);
        if (data && data.length > 0) {
          console.log(`   Sample:`, JSON.stringify(data[0]).slice(0, 100));
        }
      }
    } catch (e: any) {
      console.log(`Table '${table}' -> Exception: ${e.message}`);
    }
  }
}

main();
