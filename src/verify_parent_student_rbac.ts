import { getStudentsService } from "./services/studentService.js";

async function verify() {
  console.log("=================================================");
  console.log("  VERIFYING PARENT & STUDENT RBAC ACCESSIBILITY");
  console.log("=================================================");

  // 1. Tanyea Fowls (PNG email)
  console.log("\n[TEST 1] Parent Tanyea Fowls using PNG email (tanyeafowls@yahoo.com)");
  const res1 = await getStudentsService({
    currentUser: { id: "p-1", email: "tanyeafowls@yahoo.com", role: "PARENT" }
  });
  console.log(` -> Found ${res1.data.length} student(s):`, res1.data.map(s => `${s.fullName} (${s.studentCode}) - Course: ${s.program}`));
  if (res1.data.length === 1 && res1.data[0]?.fullName === "Jacob") {
    console.log(" ✅ TEST 1 PASSED: Tanyea Fowls sees ONLY Jacob!");
  } else {
    console.error(" ❌ TEST 1 FAILED!");
  }

  // 2. Tanyea Fowls (Portal email)
  console.log("\n[TEST 2] Parent Tanyea Fowls using Portal email (parent.tanyea.fowls.5001@parents.topgrade.edu)");
  const res2 = await getStudentsService({
    currentUser: { id: "p-2", email: "parent.tanyea.fowls.5001@parents.topgrade.edu", role: "PARENT" }
  });
  console.log(` -> Found ${res2.data.length} student(s):`, res2.data.map(s => `${s.fullName} (${s.studentCode})`));
  if (res2.data.length === 1 && res2.data[0]?.fullName === "Jacob") {
    console.log(" ✅ TEST 2 PASSED: Portal email matches Jacob!");
  } else {
    console.error(" ❌ TEST 2 FAILED!");
  }

  // 3. Multi-child family: Dhara Desai
  console.log("\n[TEST 3] Multi-Child Parent Dhara Desai (dhara.6n@gmail.com)");
  const res3 = await getStudentsService({
    currentUser: { id: "p-3", email: "dhara.6n@gmail.com", role: "PARENT" }
  });
  console.log(` -> Found ${res3.data.length} student(s):`, res3.data.map(s => `${s.fullName} (${s.studentCode})`));
  const dharaNames = res3.data.map(s => s.fullName);
  if (dharaNames.includes("Dhyana Desai") && dharaNames.includes("Aarshiv Desai") && res3.data.length === 2) {
    console.log(" ✅ TEST 3 PASSED: Dhara Desai sees ONLY her 2 children (Dhyana & Aarshiv)!");
  } else {
    console.error(" ❌ TEST 3 FAILED!");
  }

  // 4. Secondary Parent: Sandeep Duggal (duggalmd@aol.com)
  console.log("\n[TEST 4] Secondary Parent Sandeep Duggal (duggalmd@aol.com)");
  const res4 = await getStudentsService({
    currentUser: { id: "p-4", email: "duggalmd@aol.com", role: "PARENT" }
  });
  console.log(` -> Found ${res4.data.length} student(s):`, res4.data.map(s => `${s.fullName} (${s.studentCode})`));
  if (res4.data.length === 1 && res4.data[0]?.fullName === "Deven") {
    console.log(" ✅ TEST 4 PASSED: Secondary Parent Sandeep Duggal sees ONLY Deven!");
  } else {
    console.error(" ❌ TEST 4 FAILED!");
  }

  // 5. Student Jacob
  console.log("\n[TEST 5] Student Jacob (jacob.5001@student.topgrade.edu)");
  const res5 = await getStudentsService({
    currentUser: { id: "s-1", email: "jacob.5001@student.topgrade.edu", role: "STUDENT" }
  });
  console.log(` -> Found ${res5.data.length} student(s):`, res5.data.map(s => `${s.fullName} (${s.studentCode})`));
  if (res5.data.length === 1 && res5.data[0]?.fullName === "Jacob") {
    console.log(" ✅ TEST 5 PASSED: Jacob sees ONLY his own profile!");
  } else {
    console.error(" ❌ TEST 5 FAILED!");
  }
}

verify();
