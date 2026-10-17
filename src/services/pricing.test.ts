import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { quoteEnrollment, calculatePackageExpiry } from "./pricing.js";
import type { CoursePricingInput } from "./pricing.js";

describe("quoteEnrollment and pricing service", () => {
  it("PACKAGE plan returns package_price and package_hours with expiration date", () => {
    const course: CoursePricingInput = {
      id: "course-1",
      name: "SAT Math Prep",
      package_price: 1200,
      package_hours: 24,
      hourly_rate: 65,
      duration_months: 6
    };

    const quote = quoteEnrollment(course, "PACKAGE", undefined, "2026-10-17");
    assert.equal(quote.is_valid, true);
    assert.equal(quote.plan, "PACKAGE");
    assert.equal(quote.quoted_amount, 1200);
    assert.equal(quote.hours_total, 24);
    assert.equal(quote.currency, "usd");
    assert.equal(quote.starts_on, "2026-10-17");
    assert.equal(quote.expires_on, "2027-04-17");
  });

  it("PACKAGE plan falls back to 6 months if duration_months is missing or 0", () => {
    const course: CoursePricingInput = {
      package_price: 500,
      package_hours: 10
    };

    const quote = quoteEnrollment(course, "PACKAGE", null, "2026-01-15");
    assert.equal(quote.is_valid, true);
    assert.equal(quote.expires_on, "2026-07-15");
  });

  it("HOURS plan returns hours times hourly_rate, rounded to cents, and never expires", () => {
    const course: CoursePricingInput = {
      hourly_rate: 55.55
    };

    const quote = quoteEnrollment(course, "HOURS", 3, "2026-10-17");
    assert.equal(quote.is_valid, true);
    assert.equal(quote.plan, "HOURS");
    assert.equal(quote.hours_total, 3);
    // 3 * 55.55 = 166.65
    assert.equal(quote.quoted_amount, 166.65);
    assert.equal(quote.expires_on, null);
  });

  it("HOURS plan rounds cents properly", () => {
    const course: CoursePricingInput = {
      hourly_rate: 33.333
    };

    // 7 * 33.333 = 233.331 -> 233.33
    const quote = quoteEnrollment(course, "HOURS", 7);
    assert.equal(quote.is_valid, true);
    assert.equal(quote.quoted_amount, 233.33);
    assert.equal(quote.expires_on, null);
  });

  it("PACKAGE rejects when package_price is not set or non-positive", () => {
    const course: CoursePricingInput = {
      package_hours: 20
    };

    const quote = quoteEnrollment(course, "PACKAGE");
    assert.equal(quote.is_valid, false);
    assert.match(quote.error || "", /package price not set/i);
  });

  it("PACKAGE rejects when package_hours is not set or non-positive", () => {
    const course: CoursePricingInput = {
      package_price: 800,
      package_hours: 0
    };

    const quote = quoteEnrollment(course, "PACKAGE");
    assert.equal(quote.is_valid, false);
    assert.match(quote.error || "", /package hours not set/i);
  });

  it("HOURS rejects when hourly_rate is missing or non-positive", () => {
    const course: CoursePricingInput = {
      hourly_rate: 0
    };

    const quote = quoteEnrollment(course, "HOURS", 5);
    assert.equal(quote.is_valid, false);
    assert.match(quote.error || "", /hourly rate not set/i);
  });

  it("HOURS rejects when hours requested is 0 or negative", () => {
    const course: CoursePricingInput = {
      hourly_rate: 50
    };

    const quote = quoteEnrollment(course, "HOURS", 0);
    assert.equal(quote.is_valid, false);
    assert.match(quote.error || "", /positive number of hours/i);
  });

  it("calculatePackageExpiry handles month roll-overs correctly", () => {
    const expiry = calculatePackageExpiry("2026-11-10", 3);
    assert.equal(expiry, "2027-02-10");
  });
});
