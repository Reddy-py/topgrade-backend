import { DemoDataService, demoStudentsPool, demoTeachersPool, demoCoursesPool } from "./services/demoDataService.js";
import { SessionAttendanceService } from "./services/sessionAttendanceService.js";

async function runTimeGatedQrAndStartupSeedVerification() {
  console.log("==================================================================");
  console.log("🧪 STARTING TIME-GATED QR UNLOCK & STARTUP SEED VERIFICATION");
  console.log("==================================================================\n");

  let passedTests = 0;
  const totalTests = 3;

  // ----------------------------------------------------------------
  // TEST 1: Automatic Startup Demo Dataset Hydration (50 Students, 10 Teachers, 50 Courses)
  // ----------------------------------------------------------------
  console.log("🔹 TEST 1: Automatic Startup Demo Dataset Hydration (50 Students, 10 Teachers, 50 Courses)");
  const seedResult = await DemoDataService.seedBulkDemoDataset();

  console.log("   • Hydrated Dataset Stats:", {
    studentsCount: demoStudentsPool.length,
    teachersCount: demoTeachersPool.length,
    coursesCount: demoCoursesPool.length
  });

  if (
    demoStudentsPool.length === 50 &&
    demoTeachersPool.length === 10 &&
    demoCoursesPool.length === 50
  ) {
    console.log("   ✅ TEST 1 PASSED: 50 Students, 10 Teachers, and 50 Courses hydrated automatically on startup!\n");
    passedTests++;
  } else {
    console.log("   ❌ TEST 1 FAILED!\n");
  }

  // ----------------------------------------------------------------
  // TEST 2: Time-Gated QR Code Locking (Before Class Scheduled Start Time)
  // ----------------------------------------------------------------
  console.log("🔹 TEST 2: Time-Gated QR Code Locking (Before Class Scheduled Start Time)");
  const futureSessionQr = SessionAttendanceService.generateSessionQrToken({
    classSessionId: "sess-future-101",
    courseId: "crs-demo-137",
    courseName: "Artificial Intelligence & Machine Learning (AIML)",
    teacherId: "tchr-demo-5",
    teacherName: "Michael Brown",
    startTimeIso: new Date(Date.now() + 7200000).toISOString(), // Unlocks in 2 hours
    graceMinutes: 15
  });

  const lockedGateCheck = SessionAttendanceService.checkSessionQrTimeGate(futureSessionQr);
  console.log("   • Future Class QR Check:", lockedGateCheck);

  if (!lockedGateCheck.isUnlocked && lockedGateCheck.reason === "TOO_EARLY") {
    console.log("   ✅ TEST 2 PASSED: Class QR correctly LOCKED prior to scheduled start time!\n");
    passedTests++;
  } else {
    console.log("   ❌ TEST 2 FAILED!\n");
  }

  // ----------------------------------------------------------------
  // TEST 3: Time-Gated QR Code Unlocking (During Active Scheduled Class Slot)
  // ----------------------------------------------------------------
  console.log("🔹 TEST 3: Time-Gated QR Code Unlocking (During Active Scheduled Class Slot)");
  const activeSessionQr = SessionAttendanceService.generateSessionQrToken({
    classSessionId: "sess-active-101",
    courseId: "crs-demo-101",
    courseName: "AP Physics C & Quantum Mechanics",
    teacherId: "tchr-demo-1",
    teacherName: "Dr. Rajesh Verma",
    startTimeIso: new Date().toISOString(), // Unlocked Now
    graceMinutes: 15
  });

  const unlockedGateCheck = SessionAttendanceService.checkSessionQrTimeGate(activeSessionQr);
  console.log("   • Active Class QR Check:", unlockedGateCheck);

  if (unlockedGateCheck.isUnlocked && unlockedGateCheck.reason === "ACTIVE") {
    console.log("   ✅ TEST 3 PASSED: Class QR correctly UNLOCKED during active scheduled class slot!\n");
    passedTests++;
  } else {
    console.log("   ❌ TEST 3 FAILED!\n");
  }

  console.log("==================================================================");
  console.log(`📊 FINAL VERIFICATION SCORE: ${passedTests}/${totalTests} TESTS PASSED`);
  console.log("==================================================================\n");

  if (passedTests !== totalTests) {
    process.exit(1);
  }
}

runTimeGatedQrAndStartupSeedVerification().catch(err => {
  console.error("FATAL: Verification script error:", err);
  process.exit(1);
});
