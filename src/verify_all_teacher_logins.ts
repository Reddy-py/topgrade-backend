import { supabaseAdmin } from "./supabase.js";
import { OFFICIAL_TEACHERS } from "./ingest_official_courses_and_teachers.js";
import { TEACHER_DEFAULT_PASSWORD, ADMIN_DEFAULT_PASSWORD } from "./provision_teacher_logins.js";

async function verifyAllLogins() {
  console.log("-------------------------------------------------------------------------");
  console.log("TESTING AUTHENTICATION FOR ADMIN AND ALL 17 TEACHERS");
  console.log("-------------------------------------------------------------------------\n");

  // 1. Admin
  const { data: adminAuth, error: adminErr } = await supabaseAdmin.auth.signInWithPassword({
    email: "admin@topgrade.edu",
    password: ADMIN_DEFAULT_PASSWORD
  });
  if (adminErr) {
    console.error(`❌ Admin Auth Failed:`, adminErr.message);
  } else {
    console.log(`✅ Admin Auth OK: admin@topgrade.edu (User ID: ${adminAuth.user?.id})`);
  }

  // 2. 17 Teachers
  let successCount = 0;
  for (const t of OFFICIAL_TEACHERS) {
    const { data: teacherAuth, error: tErr } = await supabaseAdmin.auth.signInWithPassword({
      email: t.email,
      password: TEACHER_DEFAULT_PASSWORD
    });

    if (tErr) {
      console.error(`❌ Teacher Auth Failed: ${t.name} (${t.email}):`, tErr.message);
    } else {
      successCount++;
      console.log(`✅ [${t.teacher_id_code}] ${t.name} -> ${t.email} (Auth OK)`);
    }
  }

  console.log(`\nVerified: ${successCount} / ${OFFICIAL_TEACHERS.length} teachers authenticated successfully!`);
}

verifyAllLogins().catch(console.error);
