import { DemoDataService, demoStudentsPool, demoTeachersPool, demoCoursesPool } from "./services/demoDataService.js";
import { SessionAttendanceService, classSessionQrStore } from "./services/sessionAttendanceService.js";
import { studentCourseBalancesStore } from "./services/courseHoursService.js";

async function runSessionAttendanceAndPurgeVerification() {
  console.log("==================================================================");
  console.log("🧪 STARTING SESSION QR ATTENDANCE & DEMO PURGE VERIFICATION SUITE");
  console.log("==================================================================\n");

  let passedTests = 0;
  const totalTests = 5;

  // ----------------------------------------------------------------
  // TEST 1: Massive Demo Seed Dataset Hydration & 1-Click Purge
  // ----------------------------------------------------------------
  console.log("🔹 TEST 1: Massive Demo Seed Dataset Hydration & 1-Click Purge Engine");
  
  // Seed
  const seedResult = await DemoDataService.seedBulkDemoDataset();
  console.log("   • Seeded Stats:", seedResult.stats);

  const initialStudentCount = demoStudentsPool.length;
  const initialTeacherCount = demoTeachersPool.length;
  const initialCourseCount = demoCoursesPool.length;

  // Purge
  const purgeResult = DemoDataService.purgeDemoDataset();
  console.log("   • Purge Stats:", purgeResult.purgedStats);

  const postPurgeStudents = demoStudentsPool.length;

  if (
    initialStudentCount === 50 &&
    initialTeacherCount === 10 &&
    initialCourseCount === 50 &&
    postPurgeStudents === 0
  ) {
    console.log("   ✅ TEST 1 PASSED: Seeded 50 students, 10 teachers, 50 courses & executed 1-Click Purge cleanly!\n");
    passedTests++;
  } else {
    console.log("   ❌ TEST 1 FAILED!\n");
  }

  // Re-seed for remaining tests
  await DemoDataService.seedBulkDemoDataset();

  // ----------------------------------------------------------------
  // TEST 2: Class Session QR Generation & Valid Student Self-Scan
  // ----------------------------------------------------------------
  console.log("🔹 TEST 2: Class Session QR Token Generation & Valid Student Self-Scan");
  const nowIso = new Date().toISOString();

  const sessionQr = SessionAttendanceService.generateSessionQrToken({
    classSessionId: "sess-test-201",
    courseId: "crs-demo-150",
    courseName: "Quantum Computing & Future Tech Lab",
    teacherId: "tchr-demo-1",
    teacherName: "Dr. Rajesh Verma",
    startTimeIso: nowIso,
    graceMinutes: 15
  });

  console.log("   • Generated Class Session QR Token:", sessionQr.qrToken);

  const scanResult = await SessionAttendanceService.processStudentSelfScan({
    studentId: "std-demo-101",
    qrToken: sessionQr.qrToken,
    customScanTimeIso: new Date(Date.now() + 300000).toISOString() // 5 minutes after start (within 15-min grace window)
  });

  console.log("   • Scan Result:", {
    action: scanResult.action,
    studentName: scanResult.record.studentName,
    checkInTime: scanResult.record.checkInTime,
    scanMethod: scanResult.record.scanMethod
  });

  if (
    scanResult.success &&
    scanResult.record.status === "PRESENT" &&
    scanResult.record.scanMethod === "STUDENT_SELF_QR"
  ) {
    console.log("   ✅ TEST 2 PASSED: Valid student self-scan verified within 15-minute grace window!\n");
    passedTests++;
  } else {
    console.log("   ❌ TEST 2 FAILED!\n");
  }

  // ----------------------------------------------------------------
  // TEST 3: Single Class Hour Credit Balance Deduction
  // ----------------------------------------------------------------
  console.log("🔹 TEST 3: Single Class Hour Credit Balance Deduction");
  const balanceObj = studentCourseBalancesStore.find(b => b.studentId === "std-demo-101");

  console.log("   • Updated Student Course Credit Balance:", {
    studentId: balanceObj?.studentId,
    totalPurchasedHours: balanceObj?.totalPurchasedHours,
    usedHours: balanceObj?.usedHours,
    availableHours: balanceObj?.availableHours
  });

  if (balanceObj && balanceObj.usedHours === 11) { // Initial used 10 + 1 self scan
    console.log("   ✅ TEST 3 PASSED: Single class hour credit deducted cleanly!\n");
    passedTests++;
  } else {
    console.log("   ❌ TEST 3 FAILED!\n");
  }

  // ----------------------------------------------------------------
  // TEST 4: Duplicate Scan Prevention (ALREADY_CHECKED_IN)
  // ----------------------------------------------------------------
  console.log("🔹 TEST 4: Duplicate Scan Prevention (ALREADY_CHECKED_IN)");
  let duplicateCaught = false;

  try {
    await SessionAttendanceService.processStudentSelfScan({
      studentId: "std-demo-101",
      qrToken: sessionQr.qrToken
    });
  } catch (err: any) {
    console.log("   • Caught Expected Error:", err);
    if (err.code === "ALREADY_CHECKED_IN") {
      duplicateCaught = true;
    }
  }

  if (duplicateCaught) {
    console.log("   ✅ TEST 4 PASSED: Duplicate scan prevented with ALREADY_CHECKED_IN!\n");
    passedTests++;
  } else {
    console.log("   ❌ TEST 4 FAILED!\n");
  }

  // ----------------------------------------------------------------
  // TEST 5: Rejection After 15-Minute Grace Window Expiration (EXPIRED_SESSION_WINDOW)
  // ----------------------------------------------------------------
  console.log("🔹 TEST 5: Rejection After 15-Minute Grace Window Expiration (EXPIRED_SESSION_WINDOW)");
  let graceExpiredCaught = false;

  const expiredSessionQr = SessionAttendanceService.generateSessionQrToken({
    classSessionId: "sess-test-expired",
    courseId: "crs-demo-102",
    courseName: "Advanced Calculus BC",
    teacherId: "tchr-demo-2",
    teacherName: "Ananya Sengupta",
    startTimeIso: new Date(Date.now() - 1800000).toISOString(), // Started 30 mins ago
    graceMinutes: 15
  });

  try {
    await SessionAttendanceService.processStudentSelfScan({
      studentId: "std-demo-102",
      qrToken: expiredSessionQr.qrToken,
      customScanTimeIso: new Date().toISOString() // Scanning 30 mins late (grace window was 15 mins)
    });
  } catch (err: any) {
    console.log("   • Caught Expected Grace Expiry Error:", err);
    if (err.code === "EXPIRED_SESSION_WINDOW") {
      graceExpiredCaught = true;
    }
  }

  if (graceExpiredCaught) {
    console.log("   ✅ TEST 5 PASSED: Scan rejected with EXPIRED_SESSION_WINDOW after 15-minute grace window expired!\n");
    passedTests++;
  } else {
    console.log("   ❌ TEST 5 FAILED!\n");
  }

  console.log("==================================================================");
  console.log(`📊 FINAL VERIFICATION SCORE: ${passedTests}/${totalTests} TESTS PASSED`);
  console.log("==================================================================\n");

  if (passedTests !== totalTests) {
    process.exit(1);
  }
}

runSessionAttendanceAndPurgeVerification().catch(err => {
  console.error("FATAL: Verification script error:", err);
  process.exit(1);
});
