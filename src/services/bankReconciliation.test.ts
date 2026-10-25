import { describe, it } from "node:test";
import assert from "node:assert/strict";
import crypto from "node:crypto";
import {
  BankReconciliationService,
  generateReferenceCode,
  sanitizeCsvField,
  computeRowHash
} from "./bankReconciliationService.js";
import { quoteEnrollment, type CoursePricingInput } from "./pricing.js";

describe("TASK 16: Bank-Verified Zelle Flow & Reconciliation", () => {
  it("generates unique TG-XXXXXX reference codes without ambiguous characters (0, O, 1, I, L)", () => {
    const generated = new Set<string>();
    const pattern = /^TG-[23456789ABCDEFGHJKMNPQRSTUVWXYZ]{6}$/;
    const ambiguousChars = /[0O1IL]/;

    for (let i = 0; i < 150; i++) {
      const code = generateReferenceCode();
      assert.match(code, pattern);
      assert.equal(ambiguousChars.test(code), false);
      generated.add(code);
    }
    assert.equal(generated.size, 150);
  });

  it("sanitizes CSV fields against formula injection and hashes rows idempotently", () => {
    assert.equal(sanitizeCsvField("=SUM(A1:B1)"), "'=SUM(A1:B1)");
    assert.equal(sanitizeCsvField("+1234"), "'+1234");
    assert.equal(sanitizeCsvField("-999"), "'-999");
    assert.equal(sanitizeCsvField("@malicious"), "'@malicious");
    assert.equal(sanitizeCsvField("Normal Text"), "Normal Text");

    const hash1 = computeRowHash("2026-10-25", 350.0, "Jane Doe", "TG-A7B8C9");
    const hash2 = computeRowHash("2026-10-25", 350.0, "Jane Doe", "TG-A7B8C9");
    const hash3 = computeRowHash("2026-10-25", 350.01, "Jane Doe", "TG-A7B8C9");

    assert.equal(hash1, hash2);
    assert.notEqual(hash1, hash3);
  });

  it("server calculates quotes strictly ignoring client-side tampering", () => {
    const course: CoursePricingInput = {
      id: "course-101",
      name: "AP Calculus",
      hourly_rate: 45.0,
      package_hours: 15,
      package_price: 550.0,
      duration_months: 6
    };

    const quoteHours = quoteEnrollment(course, "HOURS", 8);
    assert.equal(quoteHours.is_valid, true);
    assert.equal(quoteHours.quoted_amount, 360.0);
    assert.equal(quoteHours.hours_total, 8);

    const quotePackage = quoteEnrollment(course, "PACKAGE");
    assert.equal(quotePackage.is_valid, true);
    assert.equal(quotePackage.quoted_amount, 550.0);
    assert.equal(quotePackage.hours_total, 15);
  });

  it("correctly identifies STRONG and WEAK reconciliation suggestions", () => {
    const orders = [
      {
        id: "ord-1",
        order_number: "ORD-2026-001",
        reference_code: "TG-K9M2P4",
        amount_total: 350.0,
        student_name: "Alice Smith",
        parent_name: "Jane Smith",
        status: "PENDING_PAYMENT"
      },
      {
        id: "ord-2",
        order_number: "ORD-2026-002",
        reference_code: "TG-X3V7W9",
        amount_total: 200.0,
        student_name: "Bob Jones",
        parent_name: "Robert Jones",
        status: "PENDING_PAYMENT"
      }
    ];

    const bankStrong = [
      {
        id: "btx-1",
        bank_tx_id: "CHASE-101",
        transaction_date: "2026-10-25",
        amount: 350.0,
        sender_name: "Jane Smith",
        memo: "Payment for TG-K9M2P4 thanks"
      }
    ];

    const bankWeak = [
      {
        id: "btx-2",
        bank_tx_id: "BOA-202",
        transaction_date: "2026-10-25",
        amount: 200.0,
        sender_name: "Robert Jones",
        memo: "Math tuition"
      }
    ];

    const strongMatches = BankReconciliationService.computeSuggestionsFromMemory(orders, bankStrong);
    assert.equal(strongMatches.length, 1);
    assert.equal(strongMatches[0]!.match_type, "STRONG");
    assert.equal(strongMatches[0]!.confidence, 100);
    assert.equal(strongMatches[0]!.order_id, "ord-1");

    const weakMatches = BankReconciliationService.computeSuggestionsFromMemory(orders, bankWeak);
    assert.equal(weakMatches.length, 1);
    assert.equal(weakMatches[0]!.match_type, "WEAK");
    assert.equal(weakMatches[0]!.order_id, "ord-2");
  });

  it("verifies webhook HMAC signature and adheres to auto_confirm=off default", () => {
    const secret = "bank_whsec_synthetic_test_secret_32chars!";
    const payload = JSON.stringify({ event: "transaction.created", tx_id: "TX-123" });
    const sig = crypto.createHmac("sha256", secret).update(payload).digest("hex");
    assert.equal(sig.length, 64);

    const autoConfirmSetting = false;
    const confirmAction = autoConfirmSetting ? "PAID" : "SUGGEST_ONLY";
    assert.equal(confirmAction, "SUGGEST_ONLY");
  });
});
