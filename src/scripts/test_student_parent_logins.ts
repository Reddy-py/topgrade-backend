import { supabaseAdmin } from "../supabase.js";

async function run() {
  const { data: users, error } = await supabaseAdmin.from("profiles").select("id, email, full_name, role, status");
  if (error) {
    console.error("Error:", error);
    process.exit(1);
  }
  console.log("Total profiles:", users.length);
  const byRole: Record<string, number> = {};
  users.forEach(u => {
    byRole[u.role] = (byRole[u.role] || 0) + 1;
  });
  console.log("Profiles by role:", JSON.stringify(byRole));

  const sampleStudents = users.filter(u => u.role === "STUDENT").slice(0, 3);
  const sampleParents = users.filter(u => u.role === "PARENT").slice(0, 3);

  const passwordsToTry = [
    "Student@TopGrade2026",
    "Parent@TopGrade2026",
    "TopGrade2026!",
    "Password123!"
  ];

  console.log("\n--- TESTING STUDENT LOGINS ---");
  for (const s of sampleStudents) {
    let matched = false;
    for (const p of passwordsToTry) {
      const { data, error: signInErr } = await supabaseAdmin.auth.signInWithPassword({
        email: s.email,
        password: p
      });
      if (!signInErr && data.user) {
        console.log(`✅ Student ${s.email} matched password: ${p}`);
        matched = true;
        break;
      }
    }
    if (!matched) {
      console.log(`❌ Student ${s.email} failed with tried passwords`);
    }
  }

  console.log("\n--- TESTING PARENT LOGINS ---");
  for (const pr of sampleParents) {
    let matched = false;
    for (const p of passwordsToTry) {
      const { data, error: signInErr } = await supabaseAdmin.auth.signInWithPassword({
        email: pr.email,
        password: p
      });
      if (!signInErr && data.user) {
        console.log(`✅ Parent ${pr.email} matched password: ${p}`);
        matched = true;
        break;
      }
    }
    if (!matched) {
      console.log(`❌ Parent ${pr.email} failed with tried passwords`);
    }
  }

  process.exit(0);
}

run();
