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

  const { data: feesData } = await supabase.from("fees").select("*").limit(1);
  console.log("FEES COLUMNS:", Object.keys(feesData?.[0] || {}));

  const { data: stuData } = await supabase.from("students").select("*").limit(1);
  console.log("STUDENTS COLUMNS:", Object.keys(stuData?.[0] || {}));
}

main();
