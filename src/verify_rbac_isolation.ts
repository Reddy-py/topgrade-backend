const API_BASE = "http://localhost:5000/api";

async function runTests() {
  console.log("================================================================================");
  console.log("TOPGRADE CRM: ARCHITECTURAL & ROLE ISOLATION VERIFICATION");
  console.log("================================================================================");

  // 1. Parent Role & Scoped Students
  console.log("\n[Test 1] Parent Isolation (Tanyea Fowls / Jacob):");
  try {
    const parentRoleRes = await fetch(`${API_BASE}/auth/verify-login?email=parent.tanyea.fowls.5001@parents.topgrade.edu`);
    const parentRoleData: any = await parentRoleRes.json();
    console.log("Parent Role Verification:", JSON.stringify(parentRoleData));

    const parentStudentsRes = await fetch(`${API_BASE}/students/list?userRole=PARENT&userEmail=parent.tanyea.fowls.5001@parents.topgrade.edu`);
    const parentStudentsData: any = await parentStudentsRes.json();
    const students = parentStudentsData.data || [];
    console.log(`Parent Students Scoped Count: ${students.length}`);
    students.forEach((s: any, idx: number) => {
      console.log(`  ${idx + 1}. ${s.fullName || s.name} (${s.studentCode || s.student_id_code}) - Program: ${s.program || s.grade}`);
    });
    if (students.length === 1 && (students[0].fullName || students[0].name).includes("Jacob")) {
      console.log("  => PASS: Parent only sees her enrolled child (Jacob). Total student count = 1.");
    } else {
      console.log(`  => NOTICE: Unexpected student count: ${students.length}`);
    }
  } catch (err: any) {
    console.error("Parent test error:", err.message);
  }

  // 2. Teacher Role & Scoped Students
  console.log("\n[Test 2] Teacher Isolation (Ms. Jamie Dawson):");
  try {
    const teacherRoleRes = await fetch(`${API_BASE}/auth/verify-login?email=jldaeb1000@gmail.com`);
    const teacherRoleData: any = await teacherRoleRes.json();
    console.log("Teacher Role Verification:", JSON.stringify(teacherRoleData));

    const teacherStudentsRes = await fetch(`${API_BASE}/students/list?userRole=TEACHER&userEmail=jldaeb1000@gmail.com`);
    const teacherStudentsData: any = await teacherStudentsRes.json();
    const students = teacherStudentsData.data || [];
    console.log(`Teacher Students Scoped Count: ${students.length} (out of 71 total in database)`);
    students.slice(0, 5).forEach((s: any, idx: number) => {
      console.log(`  ${idx + 1}. ${s.fullName || s.name} (${s.studentCode || s.student_id_code}) - Teacher: ${s.teacher || "N/A"}`);
    });
    if (students.length < 71) {
      console.log(`  => PASS: Teacher does NOT see all 71 students. Only sees assigned cohort of ${students.length} students.`);
    } else {
      console.log("  => FAIL: Teacher sees all 71 students!");
    }
  } catch (err: any) {
    console.error("Teacher test error:", err.message);
  }

  // 3. Admin Access & Accountant Deprecation
  console.log("\n[Test 3] Admin Access & Accountant Deprecation:");
  try {
    const adminRoleRes = await fetch(`${API_BASE}/auth/verify-login?email=admin@topgrade.edu`);
    const adminRoleData: any = await adminRoleRes.json();
    console.log("Admin Role Verification:", JSON.stringify(adminRoleData));

    const adminStudentsRes = await fetch(`${API_BASE}/students/list?userRole=ADMIN&userEmail=admin@topgrade.edu`);
    const adminStudentsData: any = await adminStudentsRes.json();
    const students = adminStudentsData.data || [];
    console.log(`Admin Students Total Access: ${students.length} students`);

    // Verify Accountant Deprecation
    const accountantRoleRes = await fetch(`${API_BASE}/auth/verify-login?email=accountant@topgrade.edu`);
    const accountantRoleData: any = await accountantRoleRes.json();
    console.log("Accountant Deprecation Check:", JSON.stringify(accountantRoleData));
    if (accountantRoleData.role !== "ACCOUNTANT") {
      console.log("  => PASS: Accountant role completely purged. Does NOT return ACCOUNTANT.");
    } else {
      console.log("  => FAIL: Accountant role still active!");
    }
  } catch (err: any) {
    console.error("Admin / Accountant test error:", err.message);
  }

  console.log("\n================================================================================");
  console.log("VERIFICATION COMPLETE");
  console.log("================================================================================");
}

runTests();
