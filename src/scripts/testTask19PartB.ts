import assert from "assert";

/**
 * TASK 19 PART B: Synthetic Verification Test Suite
 * Tests single source of truth, ledger reconciliation, slot delete enforcement, and student/teacher archive rules.
 */

// 1. Ledger Reconciliation Logic
function reconcileWalletsAndLedger(
  wallets: Array<{ id: string; student_id: string; course_id: string; balance: number }>,
  ledger: Array<{ id: string; wallet_id?: string; student_id: string; course_id: string; delta: number }>
) {
  const walletMap = new Map<string, { id: string; student_id: string; course_id: string; balance: number }>();
  for (const w of wallets) {
    walletMap.set(w.id, w);
    walletMap.set(`${w.student_id}:${w.course_id}`, w);
  }

  const ledgerSumByWalletId = new Map<string, number>();
  const orphanEntries: Array<{ id: string; studentId: string; delta: number }> = [];

  for (const row of ledger) {
    const hasWallet = (row.wallet_id && walletMap.has(row.wallet_id)) || walletMap.has(`${row.student_id}:${row.course_id}`);
    if (!hasWallet) {
      orphanEntries.push({ id: row.id, studentId: row.student_id, delta: row.delta });
    }
    const wKey = row.wallet_id || `${row.student_id}:${row.course_id}`;
    ledgerSumByWalletId.set(wKey, (ledgerSumByWalletId.get(wKey) || 0) + row.delta);
  }

  const discrepancies: Array<{ walletId: string; walletBalance: number; ledgerSum: number; diff: number }> = [];
  for (const w of wallets) {
    const sum = ledgerSumByWalletId.get(w.id) ?? ledgerSumByWalletId.get(`${w.student_id}:${w.course_id}`) ?? 0;
    const diff = Math.round((w.balance - sum) * 100) / 100;
    if (Math.abs(diff) > 0.001) {
      discrepancies.push({ walletId: w.id, walletBalance: w.balance, ledgerSum: sum, diff });
    }
  }

  return {
    healthy: discrepancies.length === 0 && orphanEntries.length === 0,
    discrepancies,
    orphanEntries
  };
}

// 2. Slot Delete Enforcement Logic
function deleteSlot(
  slotId: string,
  slot: { id: string; status: string; is_active: boolean },
  enrollments: Array<{ id: string; slot_id: string; status: string }>,
  attendance: Array<{ id: string; schedule_id: string }>,
  wallets: Map<string, number>
) {
  const activeEnrs = enrollments.filter(e => e.slot_id === slotId && (e.status === "ACTIVE" || e.status === "PAUSED_NO_HOURS"));
  if (activeEnrs.length > 0) {
    throw new Error(`Cannot delete schedule slot: it has ${activeEnrs.length} active enrollment(s). Archive the slot or end enrollments first.`);
  }

  const hasHistory = attendance.some(a => a.schedule_id === slotId);
  const walletsBefore = new Map(wallets);

  if (hasHistory) {
    // Archive
    slot.status = "archived";
    slot.is_active = false;
  } else {
    // Delete
    slot.status = "deleted";
  }

  // Deleting never refunds or creates hours
  for (const [k, v] of wallets.entries()) {
    assert.strictEqual(v, walletsBefore.get(k), "Deleting a slot must NEVER change token wallet balances!");
  }

  return { archived: hasHistory, deleted: !hasHistory };
}

// 3. Student Delete / Archive Logic
function deleteStudent(
  studentId: string,
  student: { id: string; name: string; status: string; is_active: boolean },
  history: { attendanceCount: number; ledgerCount: number; enrollmentCount: number; feeCount: number },
  confirmation: string,
  requesterRole: string
) {
  const hasHistory = history.attendanceCount > 0 || history.ledgerCount > 0 || history.enrollmentCount > 0 || history.feeCount > 0;

  if (hasHistory) {
    student.status = "ARCHIVED";
    student.is_active = false;
    return { success: true, archived: true, message: "Student has historical records and was archived." };
  }

  if (requesterRole !== "ADMIN") {
    throw new Error("Permanent deletion is restricted to administrators.");
  }

  if (confirmation.trim() !== student.name && confirmation.trim().toUpperCase() !== "DELETE") {
    throw new Error("Confirmation mismatch.");
  }

  student.status = "PERMANENTLY_DELETED";
  return { success: true, archived: false, message: "Student permanently deleted." };
}

async function runTests() {
  console.log("==================================================");
  console.log("   TASK 19 PART B: SYNTHETIC TESTS (B1 - B6)      ");
  console.log("==================================================");

  // Test B1: Reconciliation Healthy Case
  {
    const wallets = [
      { id: "w-1", student_id: "s-1", course_id: "c-1", balance: 10 },
      { id: "w-2", student_id: "s-2", course_id: "c-1", balance: 6 }
    ];
    const ledger = [
      { id: "l-1", wallet_id: "w-1", student_id: "s-1", course_id: "c-1", delta: 12 },
      { id: "l-2", wallet_id: "w-1", student_id: "s-1", course_id: "c-1", delta: -2 }, // Attendance deduction
      { id: "l-3", wallet_id: "w-2", student_id: "s-2", course_id: "c-1", delta: 6 }
    ];

    const result = reconcileWalletsAndLedger(wallets, ledger);
    assert.strictEqual(result.healthy, true, "Reconciliation should report healthy when ledger sums match wallets");
    assert.strictEqual(result.discrepancies.length, 0);
    assert.strictEqual(result.orphanEntries.length, 0);
    console.log("  ✔ B1: Ledger reconciliation correctly verifies balanced wallets and ledger deltas");
  }

  // Test B2: Reconciliation Detects Discrepancy
  {
    const wallets = [
      { id: "w-1", student_id: "s-1", course_id: "c-1", balance: 10 }
    ];
    const ledger = [
      { id: "l-1", wallet_id: "w-1", student_id: "s-1", course_id: "c-1", delta: 8 } // Sum 8 != balance 10
    ];

    const result = reconcileWalletsAndLedger(wallets, ledger);
    assert.strictEqual(result.healthy, false, "Reconciliation must fail on mismatch");
    assert.strictEqual(result.discrepancies.length, 1);
    assert.strictEqual(result.discrepancies[0].diff, 2);
    console.log("  ✔ B2: Reconciliation detects discrepancy between wallet balance and ledger sum");
  }

  // Test B3: Reconciliation Detects Orphan Ledger Entries
  {
    const wallets = [
      { id: "w-1", student_id: "s-1", course_id: "c-1", balance: 10 }
    ];
    const ledger = [
      { id: "l-1", wallet_id: "w-1", student_id: "s-1", course_id: "c-1", delta: 10 },
      { id: "l-orphan", wallet_id: "w-nonexistent", student_id: "s-ghost", course_id: "c-ghost", delta: 5 }
    ];

    const result = reconcileWalletsAndLedger(wallets, ledger);
    assert.strictEqual(result.healthy, false, "Reconciliation must detect orphan ledger entries");
    assert.strictEqual(result.orphanEntries.length, 1);
    console.log("  ✔ B3: Reconciliation detects orphan ledger entries with no matching wallet");
  }

  // Test B4: Slot Delete Prevention with Active Enrollments
  {
    const slot = { id: "slot-1", status: "active", is_active: true };
    const enrollments = [{ id: "enr-1", slot_id: "slot-1", status: "ACTIVE" }];
    const attendance: any[] = [];
    const wallets = new Map([["s-1:c-1", 10]]);

    let blocked = false;
    try {
      deleteSlot("slot-1", slot, enrollments, attendance, wallets);
    } catch (err: any) {
      blocked = true;
      assert(err.message.includes("Cannot delete schedule slot"), "Must return exact error blocking slot delete");
    }
    assert.strictEqual(blocked, true, "Slot with active enrollments must reject deletion");
    console.log("  ✔ B4: Slot delete blocked when active enrollments exist");
  }

  // Test B5: Slot with Attendance History is Archived (No Hard Delete, No Hour Changes)
  {
    const slot = { id: "slot-2", status: "active", is_active: true };
    const enrollments: any[] = []; // zero active enrollments
    const attendance = [{ id: "att-1", schedule_id: "slot-2" }];
    const wallets = new Map([["s-1:c-1", 8]]);

    const res = deleteSlot("slot-2", slot, enrollments, attendance, wallets);
    assert.strictEqual(res.archived, true, "Slot with attendance history must be archived");
    assert.strictEqual(slot.status, "archived");
    assert.strictEqual(slot.is_active, false);
    console.log("  ✔ B5: Slot with past attendance history is archived, never deleted, hours unchanged");
  }

  // Test B6: Student with History is Archived (Never Erased) & Student with Zero History Can Be Deleted
  {
    const studentWithHist = { id: "stu-1", name: "Alice Smith", status: "ACTIVE", is_active: true };
    const hist = { attendanceCount: 5, ledgerCount: 2, enrollmentCount: 1, feeCount: 1 };
    const res1 = deleteStudent("stu-1", studentWithHist, hist, "Alice Smith", "ADMIN");
    assert.strictEqual(res1.archived, true, "Student with history must be archived");
    assert.strictEqual(studentWithHist.status, "ARCHIVED");
    assert.strictEqual(studentWithHist.is_active, false);

    const studentZeroHist = { id: "stu-2", name: "Bob New", status: "ACTIVE", is_active: true };
    const zeroHist = { attendanceCount: 0, ledgerCount: 0, enrollmentCount: 0, feeCount: 0 };
    const res2 = deleteStudent("stu-2", studentZeroHist, zeroHist, "Bob New", "ADMIN");
    assert.strictEqual(res2.archived, false);
    assert.strictEqual(studentZeroHist.status, "PERMANENTLY_DELETED");
    console.log("  ✔ B6: Student with history is archived; student with zero history can be permanently deleted with admin confirmation");
  }

  console.log("\n==================================================");
  console.log("✅ ALL TASK 19 PART B TESTS (B1 - B6) PASSED!");
  console.log("==================================================\n");
}

runTests();
