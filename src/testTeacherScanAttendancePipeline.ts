import { SessionAttendanceService } from "./services/sessionAttendanceService.js";
import { studentCourseBalancesStore } from "./services/courseHoursService.js";
import { demoStudentsPool, DemoDataService } from "./services/demoDataService.js";

async function runTeacherScanAttendancePipelineVerification() {
  console.log("==================================================================");
  console.log("🧪 STARTING TEACHER QR SCAN & MULTI-PARTY EMAIL VERIFICATION SUITE");
  console.log("==================================================================\n");

  let passedTests = 0;
  const totalTests = 4;

  // Hydrate demo pool first
  await DemoDataService.seedBulkDemoDataset();

  // ----------------------------------------------------------------
  // TEST 1: Session Roster Retrieval via Session ID
  // ----------------------------------------------------------------
  console.log("🔹 TEST 1: Session Roster Retrieval via Session ID");
  const rosterData = SessionAttendanceService.getSessionRoster("sess-physics-101");

  console.log("   • Session Roster Result:", {
    classSessionId: rosterData.classSessionId,
    courseName: rosterData.courseName,
    teacherName: rosterData.teacherName,
    enrolledRosterCount: rosterData.enrolledRoster.length
  });

  if (rosterData.enrolledRoster && rosterData.enrolledRoster.length > 0) {
    console.log("   ✅ TEST 1 PASSED: Enrolled roster and student credit balances retrieved cleanly!\n");
    passedTests++;
  } else {
    console.log("   ❌ TEST 1 FAILED!\n");
  }

  // Record initial balances before submission
  const s1Id = rosterData.enrolledRoster[0]?.studentId || "std-demo-101";
  const s2Id = rosterData.enrolledRoster[1]?.studentId || "std-demo-102";
  const s3Id = rosterData.enrolledRoster[2]?.studentId || "std-demo-103";

  const initialBalS1 = studentCourseBalancesStore.find(b => b.studentId === s1Id)?.availableHours || 20;
  const initialBalS2 = studentCourseBalancesStore.find(b => b.studentId === s2Id)?.availableHours || 20;
  const initialBalS3 = studentCourseBalancesStore.find(b => b.studentId === s3Id)?.availableHours || 20;

  // ----------------------------------------------------------------
  // TEST 2: Batch Attendance Submission (PRESENT, ABSENT, LATE)
  // ----------------------------------------------------------------
  console.log("🔹 TEST 2: Batch Attendance Submission (PRESENT, ABSENT, LATE)");
  const submitResult = await SessionAttendanceService.submitTeacherSessionAttendance({
    classSessionId: "sess-physics-101",
    teacherId: "tchr-demo-1",
    entries: [
      { studentId: s1Id, studentName: "Student One", status: "PRESENT", notes: "Scanned in class" },
      { studentId: s2Id, studentName: "Student Two", status: "ABSENT", notes: "Unexcused absence" },
      { studentId: s3Id, studentName: "Student Three", status: "LATE", notes: "10 mins late" }
    ]
  });

  console.log("   • Submission Result:", submitResult);

  if (
    submitResult.success &&
    submitResult.presentCount === 2 &&
    submitResult.absentCount === 1
  ) {
    console.log("   ✅ TEST 2 PASSED: Batch attendance submitted & processed cleanly!\n");
    passedTests++;
  } else {
    console.log("   ❌ TEST 2 FAILED!\n");
  }

  // ----------------------------------------------------------------
  // TEST 3: Selective Hour Credit Deduction Verification
  // ----------------------------------------------------------------
  console.log("🔹 TEST 3: Selective Hour Credit Deduction Verification");
  const postBalS1 = studentCourseBalancesStore.find(b => b.studentId === s1Id)?.availableHours || 0;
  const postBalS2 = studentCourseBalancesStore.find(b => b.studentId === s2Id)?.availableHours || 0;
  const postBalS3 = studentCourseBalancesStore.find(b => b.studentId === s3Id)?.availableHours || 0;

  console.log("   • Balance Verification:", {
    s1_PRESENT: { initial: initialBalS1, post: postBalS1, deducted: initialBalS1 - postBalS1 === 1 },
    s2_ABSENT: { initial: initialBalS2, post: postBalS2, untouched: initialBalS2 === postBalS2 },
    s3_LATE: { initial: initialBalS3, post: postBalS3, deducted: initialBalS3 - postBalS3 === 1 }
  });

  if (
    postBalS1 === initialBalS1 - 1 &&
    postBalS2 === initialBalS2 &&
    postBalS3 === initialBalS3 - 1
  ) {
    console.log("   ✅ TEST 3 PASSED: Present/Late students lost 1 credit hour; Absent student balance untouched!\n");
    passedTests++;
  } else {
    console.log("   ❌ TEST 3 FAILED!\n");
  }

  // ----------------------------------------------------------------
  // TEST 4: Multi-Party 4-Way Email Dispatch Log Verification
  // ----------------------------------------------------------------
  console.log("🔹 TEST 4: Multi-Party 4-Way Email Dispatch Log Verification");
  
  if (submitResult.emailsDispatchedCount >= 4) {
    console.log("   ✅ TEST 4 PASSED: 4-Party automated emails dispatched (Student, Parent, Teacher, Accountant)!\n");
    passedTests++;
  } else {
    console.log("   ❌ TEST 4 FAILED!\n");
  }

  console.log("==================================================================");
  console.log(`📊 FINAL VERIFICATION SCORE: ${passedTests}/${totalTests} TESTS PASSED`);
  console.log("==================================================================\n");

  if (passedTests !== totalTests) {
    process.exit(1);
  }
}

runTeacherScanAttendancePipelineVerification().catch(err => {
  console.error("FATAL: Verification script error:", err);
  process.exit(1);
});
