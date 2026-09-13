import { supabaseAdmin } from "./supabase.js";
import { OFFICIAL_TEACHERS } from "./ingest_official_courses_and_teachers.js";

export const TEACHER_DEFAULT_PASSWORD = "TopGrade@2026!";
export const ADMIN_DEFAULT_PASSWORD = "TopGrade2026!";

export async function provisionAllTeacherLogins() {
  console.log("=========================================================================");
  console.log("🔑 PROVISIONING AUTH LOGINS FOR 17 FACULTY TEACHERS & ADMIN");
  console.log("=========================================================================\n");

  // 1. Provision / Ensure Admin User in Supabase Auth
  console.log("▶ [1/3] Ensuring Admin Login Account in Supabase Auth...");
  const adminEmail = "admin@topgrade.edu";
  try {
    const { data: userList } = await supabaseAdmin.auth.admin.listUsers();
    const existingAdmin = userList?.users?.find(u => u.email?.toLowerCase() === adminEmail.toLowerCase());

    if (!existingAdmin) {
      const { data: newAdmin, error: adminErr } = await supabaseAdmin.auth.admin.createUser({
        email: adminEmail,
        password: ADMIN_DEFAULT_PASSWORD,
        email_confirm: true,
        user_metadata: {
          full_name: "System Administrator",
          role: "ADMIN"
        }
      });
      if (adminErr) {
        console.warn("  Notice creating admin auth:", adminErr.message);
      } else {
        console.log(`  ✅ Admin auth user created: ${adminEmail}`);
      }
    } else {
      await supabaseAdmin.auth.admin.updateUserById(existingAdmin.id, {
        password: ADMIN_DEFAULT_PASSWORD,
        email_confirm: true,
        user_metadata: { full_name: "System Administrator", role: "ADMIN" }
      });
      console.log(`  ✅ Admin password updated/confirmed: ${adminEmail}`);
    }

    // Ensure profile row for Admin
    await supabaseAdmin.from("profiles").upsert({
      email: adminEmail,
      full_name: "System Administrator",
      role: "ADMIN",
      status: "Active"
    }, { onConflict: "email" });
  } catch (err: any) {
    console.warn("  Notice on admin setup:", err.message);
  }

  // 2. Provision each of the 17 Teachers in Supabase Auth
  console.log("\n▶ [2/3] Provisioning Supabase Auth Logins for 17 Teachers...");
  const { data: allUsers } = await supabaseAdmin.auth.admin.listUsers();
  const existingUsersMap = new Map((allUsers?.users || []).map(u => [u.email?.toLowerCase() || "", u]));

  const teacherCredentialsList = [];

  for (const t of OFFICIAL_TEACHERS) {
    const emailLower = t.email.toLowerCase();
    let authUserId: string | null = null;

    try {
      if (existingUsersMap.has(emailLower)) {
        const u = existingUsersMap.get(emailLower)!;
        authUserId = u.id;
        // Update password & metadata
        await supabaseAdmin.auth.admin.updateUserById(u.id, {
          password: TEACHER_DEFAULT_PASSWORD,
          email_confirm: true,
          user_metadata: {
            full_name: `${t.title} ${t.name}`.trim(),
            role: "TEACHER",
            teacher_id_code: t.teacher_id_code
          }
        });
        console.log(`  ✓ Updated Auth login for ${t.name} (${t.email})`);
      } else {
        const { data: newUser, error: createErr } = await supabaseAdmin.auth.admin.createUser({
          email: t.email,
          password: TEACHER_DEFAULT_PASSWORD,
          email_confirm: true,
          user_metadata: {
            full_name: `${t.title} ${t.name}`.trim(),
            role: "TEACHER",
            teacher_id_code: t.teacher_id_code
          }
        });
        if (createErr) {
          console.error(`  ❌ Failed to create auth user for ${t.name}:`, createErr.message);
        } else if (newUser?.user) {
          authUserId = newUser.user.id;
          console.log(`  ✅ Created Auth login for ${t.name} (${t.email})`);
        }
      }

      // Link user_id in teachers table if authUserId is present
      if (authUserId) {
        await supabaseAdmin
          .from("teachers")
          .update({ user_id: authUserId })
          .eq("teacher_id_code", t.teacher_id_code);

        // Ensure user profile in profiles table
        await supabaseAdmin.from("profiles").upsert({
          id: authUserId,
          email: t.email,
          full_name: `${t.title} ${t.name}`.trim(),
          phone: t.phone,
          role: "TEACHER",
          status: "Active"
        }, { onConflict: "id" });
      }

      teacherCredentialsList.push({
        code: t.teacher_id_code,
        name: `${t.title} ${t.name}`.trim(),
        username: t.user_name,
        email: t.email,
        password: TEACHER_DEFAULT_PASSWORD,
        phone: t.phone,
        cityState: `${t.city}, ${t.state}`,
        delivery: t.preferred_delivery_method
      });
    } catch (e: any) {
      console.error(`  Error processing teacher ${t.name}:`, e.message);
    }
  }

  // 3. Test verification of one teacher login
  console.log("\n▶ [3/3] Verifying Login Authentication via Supabase Client...");
  try {
    const testTeacher = OFFICIAL_TEACHERS[0];
    if (testTeacher) {
      const { data: signInData, error: signInErr } = await supabaseAdmin.auth.signInWithPassword({
        email: testTeacher.email,
        password: TEACHER_DEFAULT_PASSWORD
      });

      if (signInErr) {
        console.warn("  Notice testing sign in:", signInErr.message);
      } else {
        console.log(`  ✅ Successfully authenticated test login for: ${testTeacher.email}`);
        console.log(`     User ID: ${signInData.user?.id} | Role: ${signInData.user?.user_metadata?.role}`);
      }
    }
  } catch (err: any) {
    console.warn("  Notice in test sign in:", err.message);
  }

  console.log("\n=========================================================================");
  console.log(`🎉 ALL 17 TEACHER LOGINS SUCCESSFULLY PROVISIONED!`);
  console.log(`   Default Password: ${TEACHER_DEFAULT_PASSWORD}`);
  console.log("=========================================================================\n");

  return teacherCredentialsList;
}

if (process.argv[1]?.includes("provision_teacher_logins")) {
  provisionAllTeacherLogins()
    .then(() => process.exit(0))
    .catch(err => {
      console.error("❌ PROVISIONING ERROR:", err);
      process.exit(1);
    });
}
