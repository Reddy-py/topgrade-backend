import { RazorpayService } from "./services/razorpayService.js";
import { CourseHoursService, studentCourseBalancesStore } from "./services/courseHoursService.js";
import { ReceiptPdfService } from "./services/receiptPdfService.js";

async function runPaymentHoursPipelineVerification() {
  console.log("==================================================================");
  console.log("🧪 STARTING COURSE PAYMENT, RAZORPAY & CLASS HOUR SYNC VERIFICATION");
  console.log("==================================================================\n");

  let passedTests = 0;
  const totalTests = 4;

  // ----------------------------------------------------------------
  // TEST 1: Razorpay Order Creation & HMAC SHA256 Signature Verification
  // ----------------------------------------------------------------
  console.log("🔹 TEST 1: Razorpay Order Creation & HMAC SHA256 Signature Verification");
  const orderObj = RazorpayService.createOrder({
    amount: 250,
    studentId: "std-demo-1",
    courseId: "crs-sec-103",
    pricingModel: "HOURLY_CREDIT_PACKAGE",
    purchasedHours: 10
  });

  console.log("   • Razorpay Order Created:", {
    orderId: orderObj.razorpayOrderId,
    amountInPaise: orderObj.amount,
    currency: orderObj.currency
  });

  const validSigCheck = RazorpayService.verifySignature({
    razorpayOrderId: orderObj.razorpayOrderId,
    razorpayPaymentId: "pay_test_908122",
    razorpaySignature: "sig_valid_test_2026"
  });

  console.log("   • HMAC SHA256 Verification Result:", validSigCheck);

  if (orderObj.success && orderObj.razorpayOrderId && validSigCheck) {
    console.log("   ✅ TEST 1 PASSED: Razorpay Order & Signature Verification clean!\n");
    passedTests++;
  } else {
    console.log("   ❌ TEST 1 FAILED!\n");
  }

  // ----------------------------------------------------------------
  // TEST 2: Hourly Credit Package Settlement & Hour Allocation
  // ----------------------------------------------------------------
  console.log("🔹 TEST 2: Hourly Credit Package Settlement & Hour Allocation");
  const initialBalanceObj = studentCourseBalancesStore.find(b => b.studentId === "std-demo-1");
  const initialAvailable = initialBalanceObj ? initialBalanceObj.availableHours : 0;

  const settlement = await CourseHoursService.allocateCourseHoursAndSyncRoster({
    studentId: "std-demo-1",
    studentName: "Rahul Kumar",
    studentCode: "TG-2026-9081",
    studentEmail: "rahul.k@topgrade.edu",
    parentEmail: "parent@topgrade.edu",
    parentName: "Rajesh Kumar",
    courseId: "crs-sec-103",
    courseName: "Full-Stack Coding & Web Dev",
    pricingModel: "HOURLY_CREDIT_PACKAGE",
    purchasedHours: 10,
    grossAmount: 250,
    paymentMethod: "CREDIT_CARD",
    payerClassification: "FATHERS_CARD",
    razorpayOrderId: orderObj.razorpayOrderId,
    razorpayPaymentId: "pay_test_908122"
  });

  console.log("   • Settlement Allocation Summary:", {
    orderNumber: settlement.order.orderNumber,
    receiptNumber: settlement.order.receiptNumber,
    totalPurchasedHours: settlement.balance.totalPurchasedHours,
    availableHours: settlement.balance.availableHours,
    payerClassification: settlement.order.payerClassification
  });

  if (
    settlement.order.status === "PAID" &&
    settlement.balance.availableHours === initialAvailable + 10 &&
    settlement.order.payerClassification === "FATHERS_CARD"
  ) {
    console.log("   ✅ TEST 2 PASSED: 10 Class Hour credits allocated successfully!\n");
    passedTests++;
  } else {
    console.log("   ❌ TEST 2 FAILED!\n");
  }

  // ----------------------------------------------------------------
  // TEST 3: Teacher Session Roster Sync & Low Quota Warning Alert (<= 2 Hours)
  // ----------------------------------------------------------------
  console.log("🔹 TEST 3: Teacher Roster Sync & Low Quota Warning Trigger (<= 2 Hours)");
  // Check Ananya Sharma's balance (preset at 2 remaining hours)
  const rosterView = CourseHoursService.getTeacherRosterView();
  const lowQuotaStudent = rosterView.find(s => s.availableHours <= 2);

  console.log("   • Low Quota Roster Check:", {
    studentName: lowQuotaStudent?.studentName,
    availableHours: lowQuotaStudent?.availableHours,
    isLowQuotaWarning: lowQuotaStudent?.isLowQuotaWarning,
    warningMessage: lowQuotaStudent?.teacherWarningMessage
  });

  if (lowQuotaStudent && lowQuotaStudent.isLowQuotaWarning && lowQuotaStudent.teacherWarningMessage?.includes("Quota Warning")) {
    console.log("   ✅ TEST 3 PASSED: Low Quota Warning correctly triggered for remaining sessions <= 2!\n");
    passedTests++;
  } else {
    console.log("   ❌ TEST 3 FAILED!\n");
  }

  // ----------------------------------------------------------------
  // TEST 4: Institutional PDF Receipt Engine & Double-Entry Ledger
  // ----------------------------------------------------------------
  console.log("🔹 TEST 4: Institutional PDF Receipt Engine & Double-Entry Ledger Posting");
  const receiptHtml = ReceiptPdfService.generateReceiptHtml({
    receiptNumber: settlement.order.receiptNumber,
    orderNumber: settlement.order.orderNumber,
    studentName: "Rahul Kumar",
    studentCode: "TG-2026-9081",
    studentEmail: "rahul.k@topgrade.edu",
    parentName: "Rajesh Kumar",
    parentEmail: "parent@topgrade.edu",
    courseName: "Full-Stack Coding & Web Dev",
    pricingModel: "HOURLY_CREDIT_PACKAGE",
    purchasedHours: 10,
    grossAmount: 250,
    taxAmount: 45,
    totalPayable: 295,
    paymentMethod: "CREDIT_CARD",
    payerClassification: "FATHERS_CARD",
    paymentDate: new Date().toISOString()
  });

  const containsHeader = receiptHtml.includes("TopGrade Learning Institute") && receiptHtml.toLowerCase().includes("official fee payment receipt");
  const containsLedgerDebit = settlement.debitLedger && settlement.debitLedger.amount === 250;
  const containsLedgerCredit = settlement.creditLedger && settlement.creditLedger.amount === 295;

  console.log("   • Receipt HTML Verification:", {
    containsHeader,
    containsLedgerDebit: !!containsLedgerDebit,
    containsLedgerCredit: !!containsLedgerCredit
  });

  if (containsHeader && containsLedgerDebit && containsLedgerCredit) {
    console.log("   ✅ TEST 4 PASSED: Institutional Receipt PDF & Double-Entry Ledger verified!\n");
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

runPaymentHoursPipelineVerification().catch(err => {
  console.error("FATAL: Verification script error:", err);
  process.exit(1);
});
