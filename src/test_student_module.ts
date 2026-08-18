import {
  calculateAgeFromDOB,
  createStudentService,
  getStudentsService,
  toggleStudentStatusService
} from "./services/studentService.js";

async function runStudentModuleVerification() {
  console.log("=================================================");
  console.log("  TOPGRADE STUDENT MODULE VERIFICATION TEST SUITE  ");
  console.log("=================================================\n");

  let passed = 0;
  let failed = 0;

  function assert(condition: boolean, testName: string) {
    if (condition) {
      console.log(` ✅ PASS: ${testName}`);
      passed++;
    } else {
      console.error(` ❌ FAIL: ${testName}`);
      failed++;
    }
  }

  // 1. Dynamic Age Calculation Test
  console.log("--- 1. Testing Age Calculation from DOB ---");
  const age1 = calculateAgeFromDOB("2010-05-15");
  const expectedAge1 = new Date().getFullYear() - 2010 - (new Date() < new Date(new Date().getFullYear(), 4, 15) ? 1 : 0);
  assert(age1 === expectedAge1, `Age calculated for 2010-05-15 is ${age1} years`);

  const age2 = calculateAgeFromDOB("2000-01-01");
  assert(age2 >= 26, `Age calculated for 2000-01-01 is ${age2} years`);

  // 2. Multi-Course Allocation & 6-letter Promo Code Test
  console.log("\n--- 2. Testing Multi-Course Allocations & 6-Letter Promo Code ---");
  const testPayload = {
    fullName: "Priya Sundaram",
    gender: "Female",
    dob: "2014-03-20",
    school: "Hyderabad Public School",
    grade: "Grade 6",
    status: "ACTIVE",

    fatherName: "Sundaram Ramanathan",
    motherName: "Meenakshi Sundaram",
    studentPhones: ["+91 98888 11111", "+91 98888 22222"],
    parentPhones: ["+91 97777 33333", "+91 97777 44444"],
    studentEmails: ["priya.s@gmail.com", "priya.alt@gmail.com"],
    parentEmails: ["sundaram.r@corp.com", "meenakshi.s@gmail.com"],
    primaryMobile: "+91 98888 11111",
    email: "priya.s@gmail.com",

    allocatedCourses: [
      { courseName: "Python Beginners & Logic", duration: "6 Months" },
      { courseName: "Robotics & STEM Fundamentals", duration: "1 Hr Session" }
    ],
    assignedTeacherId: "tch-201",
    teacher: "Dr. Vikram Sarabhai",
    feePlan: "Annual",
    discount: "SUMMER" // 6-letter alphabetic promo code
  };

  const created = await createStudentService(testPayload);
  assert(!!created.id, "Student record created");
  assert(Boolean(created.studentCode && created.studentCode.startsWith("TG-STU-")), `Student Code generated: ${created.studentCode}`);
  assert(created.allocatedCourses?.length === 2, `Multi-courses allocated (Count: ${created.allocatedCourses?.length})`);
  assert(created.discount === "SUMMER", `6-letter Promo code saved: ${created.discount}`);
  assert(created.parentEmails?.length === 2, `Multiple parent emails stored: [${created.parentEmails?.join(", ")}]`);

  // 3. Search & Filter Query Verification
  console.log("\n--- 3. Testing Paginated Search & Grade / Status Filtering ---");
  const searchByName = await getStudentsService({ search: "Priya" });
  assert(searchByName.data.some(s => s.fullName === "Priya Sundaram"), "Search by student name returns created record");

  // 4. Status Toggling Test
  console.log("\n--- 4. Testing Student Status Toggling ---");
  if (created.id) {
    const toggledToInactive = await toggleStudentStatusService(created.id, "INACTIVE");
    assert(Boolean(toggledToInactive && toggledToInactive.status === "INACTIVE"), "Status successfully toggled to INACTIVE");

    const toggledBack = await toggleStudentStatusService(created.id, "ACTIVE");
    assert(Boolean(toggledBack && toggledBack.status === "ACTIVE"), "Status successfully toggled back to ACTIVE");
  }

  console.log("\n=================================================");
  console.log(`  VERIFICATION RESULTS: ${passed} PASSED, ${failed} FAILED  `);
  console.log("=================================================\n");

  if (failed > 0) {
    process.exit(1);
  }
}

runStudentModuleVerification().catch(err => {
  console.error("Verification script execution error:", err);
  process.exit(1);
});
