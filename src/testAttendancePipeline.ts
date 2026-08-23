import { AttendanceService } from "./services/attendanceService.js";
import { studentCourseBalancesStore } from "./services/courseHoursService.js";

async function runAttendancePipelineVerification() {
  console.log("==================================================================");
  console.log("🧪 STARTING LIVE ATTENDANCE TRACKER & PARENT ALERT VERIFICATION");
  console.log("==================================================================\n");

  let passedTests = 0;
  const totalTests = 4;

  // ----------------------------------------------------------------
  // TEST 1: QR Code Check-In Scan & Parent Notification Dispatch
  // ----------------------------------------------------------------
  console.log("🔹 TEST 1: QR Code Check-In Scan & Parent Notification Dispatch");
  const checkInResult = await AttendanceService.scanQrCodeCheckInCheckOut({
    studentQrCode: "std-qr-rahul",
    scanMethod: "QR_CODE_SCANNER"
  });

  console.log("   • Check-In Result:", {
    action: checkInResult.action,
    studentName: checkInResult.record.studentName,
    checkInTime: checkInResult.record.checkInTime,
    parentNotificationSent: checkInResult.parentNotificationSent
  });

  if (
    checkInResult.action === "CHECK_IN" &&
    checkInResult.record.status === "PRESENT" &&
    checkInResult.parentNotificationSent
  ) {
    console.log("   ✅ TEST 1 PASSED: QR Check-In scan logged & parent notification dispatched!\n");
    passedTests++;
  } else {
    console.log("   ❌ TEST 1 FAILED!\n");
  }

  // ----------------------------------------------------------------
  // TEST 2: Prepaid Class Credit Hour Balance Deduction
  // ----------------------------------------------------------------
  console.log("🔹 TEST 2: Prepaid Class Credit Hour Balance Deduction");
  const balanceObj = studentCourseBalancesStore.find(b => b.studentId === "std-demo-1");

  console.log("   • Updated Class Credit Balance:", {
    studentId: balanceObj?.studentId,
    totalPurchasedHours: balanceObj?.totalPurchasedHours,
    availableHours: balanceObj?.availableHours,
    usedHours: balanceObj?.usedHours
  });

  if (balanceObj && balanceObj.usedHours >= 1) {
    console.log("   ✅ TEST 2 PASSED: 1 Paid class hour credit deducted cleanly!\n");
    passedTests++;
  } else {
    console.log("   ❌ TEST 2 FAILED!\n");
  }

  // ----------------------------------------------------------------
  // TEST 3: QR Code Check-Out Departure Scan
  // ----------------------------------------------------------------
  console.log("🔹 TEST 3: QR Code Check-Out Departure Scan");
  const checkOutResult = await AttendanceService.scanQrCodeCheckInCheckOut({
    studentQrCode: "std-qr-rahul",
    scanMethod: "QR_CODE_SCANNER"
  });

  console.log("   • Check-Out Result:", {
    action: checkOutResult.action,
    studentName: checkOutResult.record.studentName,
    checkOutTime: checkOutResult.record.checkOutTime,
    parentNotificationSent: checkOutResult.parentNotificationSent
  });

  if (
    checkOutResult.action === "CHECK_OUT" &&
    checkOutResult.record.checkOutTime &&
    checkOutResult.parentNotificationSent
  ) {
    console.log("   ✅ TEST 3 PASSED: Check-OUT departure scan logged & parent alert sent!\n");
    passedTests++;
  } else {
    console.log("   ❌ TEST 3 FAILED!\n");
  }

  // ----------------------------------------------------------------
  // TEST 4: Attendance Analytics & Low Attendance Risk Warning (<75%)
  // ----------------------------------------------------------------
  console.log("🔹 TEST 4: Attendance Analytics & Low Attendance Risk Warning (<75%)");
  const stats = AttendanceService.getStudentAttendanceStats("std-demo-2", 75);

  console.log("   • Student Attendance Analytics:", {
    studentName: stats.studentName,
    totalSessions: stats.totalSessions,
    presentCount: stats.presentCount,
    absentCount: stats.absentCount,
    attendancePercent: stats.attendancePercent,
    lowAttendanceWarning: stats.lowAttendanceWarning,
    warningMessage: stats.warningMessage
  });

  if (
    stats.lowAttendanceWarning &&
    stats.attendancePercent < 75 &&
    stats.warningMessage?.includes("Low Attendance Risk Warning")
  ) {
    console.log("   ✅ TEST 4 PASSED: Low Attendance Risk Warning correctly triggered for < 75%!\n");
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

runAttendancePipelineVerification().catch(err => {
  console.error("FATAL: Verification script error:", err);
  process.exit(1);
});
