import { test, describe, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { generateTemporaryPassword, ensureLogin, normEmail, isValidEmail } from "./studentAccounts.js";
import { supabaseAdmin } from "../supabase.js";
import { createStudentService, inMemoryStudentStore } from "./studentService.js";

describe("TASK 17 - PART C: Student Accounts, Logins, and Duplicate Guarantees", () => {
  test("generateTemporaryPassword generates 14+ characters of high-entropy temporary passwords", () => {
    const pw1 = generateTemporaryPassword(16);
    const pw2 = generateTemporaryPassword(16);

    assert.ok(pw1.length >= 14, "Password must be at least 14 characters");
    assert.ok(pw2.length >= 14, "Password must be at least 14 characters");
    assert.notEqual(pw1, pw2, "Passwords must be unique and never shared");

    // Checks presence of character variety
    assert.ok(/[A-Z]/.test(pw1), "Must contain uppercase letter");
    assert.ok(/[a-z]/.test(pw1), "Must contain lowercase letter");
    assert.ok(/[0-9]/.test(pw1), "Must contain number");
    assert.ok(/[!@#$%*?]/.test(pw1), "Must contain symbol");
  });

  test("email normalization and validation properly rejects bad formats", () => {
    assert.equal(normEmail("  Parent.ONE@Example.COM  "), "parent.one@example.com");
    assert.equal(isValidEmail("parent.one@example.com"), true);
    assert.equal(isValidEmail("not-an-email"), false);
    assert.equal(isValidEmail("@missinguser.com"), false);
  });

  test("sibling duplicate detection warns and requires confirmation when same first name, parent and grade or DOB match", async () => {
    // Seed in-memory store with an existing student
    inMemoryStudentStore.length = 0;
    inMemoryStudentStore.push({
      id: "std-orig-1",
      studentCode: "TG-STU-001",
      firstName: "Leo",
      lastName: "Messi",
      fullName: "Leo Messi",
      dob: "2012-06-24",
      grade: "Grade 6",
      school: "Rosario Academy",
      email: "leo.original@test.com",
      parentEmails: ["jorge.messi@test.com"],
      studentEmails: ["leo.original@test.com"],
      status: "ACTIVE"
    });

    const warnRes = await createStudentService({
      firstName: "leo",
      lastName: "Messi Jr",
      dob: "2012-06-24",
      grade: "Grade 6",
      email: "leo.second@test.com",
      parentEmails: ["jorge.messi@test.com"]
    });

    assert.equal((warnRes as any).requiresConfirmation, true, "Must flag duplicate requiring confirmation");
    assert.ok((warnRes as any).duplicateWarning.includes("Leo Messi"), "Must cite conflicting sibling name");
    assert.ok((warnRes as any).duplicateWarning.includes("date of birth"), "Must cite collision factor");
  });

  test("validation enforces student email and parent 1 email for new student", async () => {
    // Missing student email
    await assert.rejects(
      async () => {
        await createStudentService({
          firstName: "Samantha",
          parentEmails: ["parent@test.com"]
        });
      },
      /Student email is mandatory for a new student registration/
    );

    // Missing parent email
    await assert.rejects(
      async () => {
        await createStudentService({
          firstName: "Samantha",
          email: "samantha@test.com",
          parentEmails: []
        });
      },
      /Parent email is mandatory/
    );

    // Student email equals parent email
    await assert.rejects(
      async () => {
        await createStudentService({
          firstName: "Samantha",
          email: "shared@test.com",
          parentEmails: ["shared@test.com"]
        });
      },
      /parent email must be different from the student's own email/
    );
  });
});
