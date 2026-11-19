/**
 * Verification test for Part 6 & Part 7: Fee Dues, Automatic Reminders, Token Hours Integration, and Zelle Claims
 */

import dotenv from "dotenv";
dotenv.config();

process.env.SIMULATE_EMAILS = "true";

import {
  createFeeDueService,
  listFeeDuesService,
  markFeeDuePaidService,
  unmarkFeeDuePaidService,
  recordParentZelleClaimService,
  runAutomaticFeeReminderScanService,
  reconcileBankCsvService,
  inMemoryFeeDues
} from "../services/feeDueService.js";
import { inMemoryStudentStore } from "../services/studentService.js";
import { getBalances } from "../services/tokenService.js";

async function runTest() {
  console.log("=================================================================");
  console.log("TESTING PART 6 & 7: FEE DUES, REMINDERS, TOKENS & ZELLE RECONCILIATION");
  console.log("=================================================================");

  // Setup synthetic student
  const testStudent = {
    id: "syn-fee-stu-001",
    studentCode: "TG-FEE-001",
    fullName: "Jordan Lee",
    email: "jordan.lee@testschool.edu",
    studentEmails: ["jordan.lee@testschool.edu"],
    parentEmails: ["pat.lee@parenttest.com"],
    fatherName: "Pat Lee",
    status: "ACTIVE"
  };

  const sIdx = inMemoryStudentStore.findIndex(s => s.id === testStudent.id);
  if (sIdx >= 0) inMemoryStudentStore[sIdx] = testStudent;
  else inMemoryStudentStore.push(testStudent);

  console.log("\n--- TEST 1: CREATE FEE DUE WITH TG-XXXXXX REFERENCE ---");
  const testDueDate = "2026-12-10";
  const due = await createFeeDueService({
    studentId: testStudent.id,
    courseId: "ROBOTICS_ADV",
    courseName: "Advanced Robotics",
    amountDollars: 350.00,
    dueDate: testDueDate,
    hoursIncluded: 10,
    hourlyRateDollars: 35.00,
    notes: "Monthly tuition block"
  });

  console.log(`✓ Created Fee Due: ID=${due.id}, Ref=${due.invoiceRef}, Amount=$${due.amountDollars}, Status=${due.status}`);
  if (!due.invoiceRef.startsWith("TG-") || due.invoiceRef.length !== 9) {
    throw new Error(`Invalid invoice reference format: ${due.invoiceRef}`);
  }

  console.log("\n--- TEST 2: AUTOMATIC REMINDER CYCLE (DAY -14 & DAY -7) ---");
  // Simulate Day -14 (14 days before due date = 2026-11-26)
  const day14Scan = await runAutomaticFeeReminderScanService({
    forceRun: true,
    referenceDateStr: "2026-11-26"
  });
  console.log("Day -14 Scan Results:", day14Scan);
  if (day14Scan.reminder1Sent !== 1) {
    throw new Error(`Expected Reminder 1 to be sent, got ${day14Scan.reminder1Sent}`);
  }

  const afterDay14 = inMemoryFeeDues.find(d => d.id === due.id);
  if (afterDay14?.status !== "REMINDED_1") {
    throw new Error(`Expected status REMINDED_1, got ${afterDay14?.status}`);
  }
  console.log("✓ Fee Due correctly transitioned to REMINDED_1 on Day -14");

  // Simulate Day -7 (7 days before due date = 2026-12-03)
  const day7Scan = await runAutomaticFeeReminderScanService({
    forceRun: true,
    referenceDateStr: "2026-12-03"
  });
  console.log("Day -7 Scan Results:", day7Scan);
  if (day7Scan.reminder2Sent !== 1) {
    throw new Error(`Expected Reminder 2 to be sent, got ${day7Scan.reminder2Sent}`);
  }

  const afterDay7 = inMemoryFeeDues.find(d => d.id === due.id);
  if (afterDay7?.status !== "REMINDED_2") {
    throw new Error(`Expected status REMINDED_2, got ${afterDay7?.status}`);
  }
  console.log("✓ Fee Due correctly transitioned to REMINDED_2 on Day -7");

  console.log("\n--- TEST 3: PARENT ZELLE CLAIM NEVER MARKS DUE AS PAID ---");
  const claim = await recordParentZelleClaimService({
    feeDueId: due.id,
    studentId: testStudent.id,
    parentEmail: "pat.lee@parenttest.com",
    amount: 350.00,
    zelleMemo: due.invoiceRef,
    notes: "Sent from Chase app"
  });
  console.log(`✓ Parent recorded Zelle claim: ID=${claim.id}, Status=${claim.status}`);

  const checkDueAfterClaim = inMemoryFeeDues.find(d => d.id === due.id);
  if (checkDueAfterClaim?.status === "PAID") {
    throw new Error("Fraud vulnerability detected! Parent claim marked due as PAID without admin confirmation.");
  }
  console.log(`✓ Safety verified: Fee Due remains unpaid (${checkDueAfterClaim?.status}) awaiting admin confirmation.`);

  console.log("\n--- TEST 4: ADMIN MARKS PAID & CREDITS LESSON HOURS ---");
  const initialWallets = await getBalances(testStudent.id);
  const initialBalance = initialWallets.find(w => w.courseId === "ROBOTICS_ADV")?.balance || 0;
  console.log(`Student token balance before payment: ${initialBalance} hours`);

  const paidDue = await markFeeDuePaidService({
    feeDueId: due.id,
    paymentMethod: "zelle",
    bankReference: "CHASE-TX-998811",
    receiptNo: `REC-${due.invoiceRef}`,
    adminUserId: "admin-tester"
  });

  if (paidDue.status !== "PAID") {
    throw new Error(`Expected status PAID, got ${paidDue.status}`);
  }

  const postPayWallets = await getBalances(testStudent.id);
  const postPayBalance = postPayWallets.find(w => w.courseId === "ROBOTICS_ADV")?.balance || 0;
  console.log(`Student token balance after payment: ${postPayBalance} hours`);
  if (postPayBalance !== initialBalance + 10) {
    throw new Error(`Expected balance to increase by 10, got from ${initialBalance} to ${postPayBalance}`);
  }
  console.log("✓ Single-source lesson hours credit verified: 10 hours added to wallet upon marking PAID!");

  console.log("\n--- TEST 5: PAYMENT REVERSAL (UNPAY) AND HOURS DEDUCTION ---");
  // Missing reason must throw
  let threwWithoutReason = false;
  try {
    await unmarkFeeDuePaidService({ feeDueId: due.id, reason: "" });
  } catch {
    threwWithoutReason = true;
  }
  if (!threwWithoutReason) throw new Error("Payment reversal allowed without mandatory reason!");
  console.log("✓ Validation verified: Payment reversal requires mandatory reason");

  const unpayResult = await unmarkFeeDuePaidService({
    feeDueId: due.id,
    reason: "Parent bank transfer bounced",
    adminUserId: "admin-tester"
  });
  console.log(`✓ Due unpay processed: Status restored to ${unpayResult.status}, Reason: ${unpayResult.unpaidReason}`);

  const postUnpayWallets = await getBalances(testStudent.id);
  const postUnpayBalance = postUnpayWallets.find(w => w.courseId === "ROBOTICS_ADV")?.balance || 0;
  console.log(`Student token balance after reversal: ${postUnpayBalance} hours`);
  if (postUnpayBalance !== initialBalance) {
    throw new Error(`Expected balance to revert back to ${initialBalance}, got ${postUnpayBalance}`);
  }
  console.log("✓ Single-source lesson hours reversal verified: exactly 10 hours removed from wallet upon unpay!");

  console.log("\n--- TEST 6: BANK CSV STATEMENT RECONCILIATION ---");
  const testCsv =
    `Date,Description,Amount\n` +
    `12/05/2026,"ZELLE TRANSFER FROM PAT LEE MEMO: ${due.invoiceRef}",350.00\n` +
    `12/06/2026,"ATM WITHDRAWAL",100.00\n` +
    `12/07/2026,"CHECK DEPOSIT UNRELATED",50.00\n`;

  const reconReport = await reconcileBankCsvService(testCsv);
  console.log(`CSV Rows: ${reconReport.totalRows}, Matches: ${reconReport.matchedCount}, Unmatched: ${reconReport.unmatchedCount}`);
  if (reconReport.matchedCount !== 1) {
    throw new Error(`Expected 1 matched row, got ${reconReport.matchedCount}`);
  }
  const match = reconReport.matches[0];
  if (match.matchedFeeDue?.invoiceRef !== due.invoiceRef) {
    throw new Error(`Matched wrong fee due: ${match.matchedFeeDue?.invoiceRef}`);
  }
  console.log(`✓ Bank CSV reconciliation verified: Matched ${match.matchedFeeDue.invoiceRef} with confidence ${match.matchConfidence}`);

  console.log("\n=================================================================");
  console.log("ALL PART 6 & 7 FEE DUES AND ZELLE TESTS PASSED SUCCESSFULLY!");
  console.log("=================================================================");
}

runTest().catch(err => {
  console.error("Test failed:", err);
  process.exit(1);
});
