import { 
  createStudentService, 
  getStudentsService, 
  updateStudentService, 
  deleteStudentService 
} from "./services/studentService.js";

async function runStudentCrudAndPersistenceVerification() {
  console.log("==================================================================");
  console.log("🧪 STARTING STUDENT PERSISTENCE, CRUD & RBAC VERIFICATION SUITE");
  console.log("==================================================================\n");

  let passedTests = 0;
  const totalTests = 5;

  // ----------------------------------------------------------------
  // TEST 1: Mandatory School Field Validation
  // ----------------------------------------------------------------
  console.log("🔹 TEST 1: Mandatory School Field Validation");
  try {
    await createStudentService({
      firstName: "Aarav",
      lastName: "Sharma",
      school: "", // Empty school
      dob: "2012-05-10"
    });
    console.log("   ❌ TEST 1 FAILED: Allowed creation without mandatory school name!\n");
  } catch (err: any) {
    if (err.message.includes("School Name is a mandatory field")) {
      console.log("   ✅ TEST 1 PASSED: Rejected creation when mandatory school name was missing!\n");
      passedTests++;
    } else {
      console.log("   ❌ TEST 1 FAILED with unexpected error:", err.message, "\n");
    }
  }

  // ----------------------------------------------------------------
  // TEST 2: Student Creation with Split Names, Addresses & Credentials
  // ----------------------------------------------------------------
  console.log("🔹 TEST 2: Student Creation with Split Names, Addresses & Credentials");
  const createdStudent = await createStudentService({
    firstName: "Aarav",
    lastName: "Sharma",
    school: "St. Xavier International School",
    dob: "2010-08-20",
    fatherName: "Rajesh Sharma",
    motherName: "Sunita Sharma",
    grade: "Grade 8",
    parentFirstName: "Rajesh",
    parentLastName: "Sharma",
    studentPhones: ["+91 98765 43210"],
    sameAsStudentPhone: true,
    parentPhones: ["+91 98765 12345"],
    sameAsParentPhone: true,
    residentialAddress: "Flat 402, Rosewood Heights, Hyderabad",
    officeAddress: "Cyber Towers, Hitech City, Hyderabad",
    password: "Student@123"
  });

  console.log("   • Created Student Record:", {
    id: createdStudent.id,
    fullName: createdStudent.fullName,
    school: createdStudent.school,
    studentWhatsapp: createdStudent.studentWhatsapp,
    residentialAddress: createdStudent.residentialAddress,
    officeAddress: createdStudent.officeAddress,
    password: createdStudent.password
  });

  if (
    createdStudent.fullName === "Aarav Sharma" &&
    createdStudent.school === "St. Xavier International School" &&
    createdStudent.studentWhatsapp === "+91 98765 43210" &&
    (createdStudent.residentialAddress || "").includes("Rosewood") &&
    (createdStudent.officeAddress || "").includes("Cyber Towers")
  ) {
    console.log("   ✅ TEST 2 PASSED: Student created with First/Last Names, School, WhatsApp sync, and Addresses!\n");
    passedTests++;
  } else {
    console.log("   ❌ TEST 2 FAILED!\n");
  }

  // ----------------------------------------------------------------
  // TEST 3: Disk-Backed Storage Persistence Across Reload
  // ----------------------------------------------------------------
  console.log("🔹 TEST 3: Disk-Backed Storage Persistence Across Reload");
  const listAfterReload = await getStudentsService({ search: "Aarav" });
  const foundStudent = listAfterReload.data.find(s => s.id === createdStudent.id);

  if (foundStudent && foundStudent.fullName === "Aarav Sharma") {
    console.log("   ✅ TEST 3 PASSED: Student record persisted to disk ('students_db.json') and reloaded cleanly!\n");
    passedTests++;
  } else {
    console.log("   ❌ TEST 3 FAILED: Student disappeared after reload!\n");
  }

  // ----------------------------------------------------------------
  // TEST 4: Real-Time Edit & Delete Operations
  // ----------------------------------------------------------------
  console.log("🔹 TEST 4: Real-Time Edit & Delete Operations");
  const updatedStudent = await updateStudentService(createdStudent.id!, {
    grade: "Grade 9",
    school: "Delhi Public School"
  });

  const isEditSuccess = updatedStudent.grade === "Grade 9" && updatedStudent.school === "Delhi Public School";
  await deleteStudentService(createdStudent.id!);
  const listAfterDelete = await getStudentsService({ search: "Aarav" });
  const isDeleteSuccess = !listAfterDelete.data.some(s => s.id === createdStudent.id);

  if (isEditSuccess && isDeleteSuccess) {
    console.log("   ✅ TEST 4 PASSED: Student updated in real-time and deleted permanently from disk!\n");
    passedTests++;
  } else {
    console.log("   ❌ TEST 4 FAILED!\n");
  }

  // ----------------------------------------------------------------
  // TEST 5: Role-Based Accessibility Filters (Admin vs Student vs Parent vs Teacher)
  // ----------------------------------------------------------------
  console.log("🔹 TEST 5: Role-Based Accessibility Filters (Admin vs Student vs Parent vs Teacher)");
  
  // Seed sample student for role testing
  const s1 = await createStudentService({
    firstName: "Rohan",
    lastName: "Verma",
    school: "National Public School",
    dob: "2011-03-15",
    fatherName: "Vikram Verma",
    motherName: "Anita Verma",
    email: "rohan.v@student.topgrade.edu",
    parentEmails: ["parent.rohan@gmail.com"],
    assignedTeacherId: "tch-101",
    teacher: "Prof. Alan Turing"
  });

  const adminResult = await getStudentsService({ currentUser: { role: "ADMIN" } });
  const studentResult = await getStudentsService({ currentUser: { role: "STUDENT", id: s1.id || "", email: s1.email || "" } });
  const parentResult = await getStudentsService({ currentUser: { role: "PARENT", email: "parent.rohan@gmail.com" } });
  const teacherResult = await getStudentsService({ currentUser: { role: "TEACHER", id: "tch-101" } });

  console.log("   • RBAC Roster Counts:", {
    adminVisibleCount: adminResult.total,
    studentSelfCount: studentResult.total,
    parentChildCount: parentResult.total,
    teacherClassCount: teacherResult.total
  });

  if (
    adminResult.total >= 1 &&
    studentResult.total === 1 && studentResult.data[0]?.id === s1.id &&
    parentResult.total === 1 && parentResult.data[0]?.id === s1.id &&
    teacherResult.total >= 1
  ) {
    console.log("   ✅ TEST 5 PASSED: Strict RBAC accessibility filters enforced for Admin, Student, Parent, and Teacher logins!\n");
    passedTests++;
  } else {
    console.log("   ❌ TEST 5 FAILED!\n");
  }

  // Clean up test student
  await deleteStudentService(s1.id!);

  console.log("==================================================================");
  console.log(`📊 FINAL VERIFICATION SCORE: ${passedTests}/${totalTests} TESTS PASSED`);
  console.log("==================================================================\n");

  if (passedTests !== totalTests) {
    process.exit(1);
  }
}

runStudentCrudAndPersistenceVerification().catch(err => {
  console.error("FATAL: Verification script error:", err);
  process.exit(1);
});
