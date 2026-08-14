import dotenv from "dotenv";
import { createClient } from "@supabase/supabase-js";

dotenv.config();

const supabaseUrl = process.env.SUPABASE_URL || "https://zznzmzwiewsnmykcbcni.supabase.co";
const supabaseServiceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY || "";

const supabaseAdmin = createClient(supabaseUrl, supabaseServiceRoleKey, {
  auth: {
    autoRefreshToken: false,
    persistSession: false
  }
});

const testUsers = [
  { email: "admin@topgrade.edu", password: "TopGrade2026!", name: "Manikanta Admin", role: "ADMIN" },
  { email: "accountant@topgrade.edu", password: "TopGrade2026!", name: "Priya Sharma", role: "ACCOUNTANT" },
  { email: "teacher@topgrade.edu", password: "TopGrade2026!", name: "Vikram Teacher", role: "TEACHER" },
  { email: "parent@topgrade.edu", password: "TopGrade2026!", name: "Suresh Kumar", role: "PARENT" },
  { email: "student@topgrade.edu", password: "TopGrade2026!", name: "Rahul Kumar", role: "STUDENT" },
];

async function seed() {
  console.log("🚀 Starting Supabase Test Account Creation...");

  for (const u of testUsers) {
    try {
      const { data, error } = await supabaseAdmin.auth.admin.createUser({
        email: u.email,
        password: u.password,
        email_confirm: true,
        user_metadata: {
          full_name: u.name,
          role: u.role,
        },
      });

      if (error) {
        console.log(`ℹ️ ${u.email}:`, error.message);
      } else if (data.user) {
        console.log(`✅ Successfully created test user: ${u.email} (${u.role})`);
      }
    } catch (err: any) {
      console.error(`❌ Exception creating ${u.email}:`, err.message);
    }
  }

  console.log("✨ Seeding process complete!");
}

seed();
