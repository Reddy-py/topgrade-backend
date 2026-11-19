/**
 * Verification test for Part 5: Personal 1-to-1 Exam Wishes & student_exam_dates isolation
 */

import dotenv from "dotenv";
dotenv.config();

process.env.SIMULATE_EMAILS = "true";

import {
  upsertStudentExamDateService,
  getStudentExamDatesService,
  sendSingleStudentExamWishService
} from "../services/examDateService.js";
import { inMemoryStudentStore } from "../services/studentService.js";

async function runTest() {
  console.log("=================================================================");
  console.log("TESTING PART 5: PERSONAL EXAM WISHES & COURSE EXAM DATES");
  console.log("=================================================================");

  const testStudent = {
    id: "syn-exam-stu-001",
    studentCode: "TG-EXAM-001",
    fullName: "Maya Lin",
    email: "maya.lin@testschool.edu",
    studentEmails: ["maya.lin@testschool.edu"],
    parentEmails: ["david.lin@parentcorp.com"],
    fatherName: "David Lin",
    status: "ACTIVE",
    examDate: "2026-11-28"
  };

  const idx = inMemoryStudentStore.findIndex(s => s.id === testStudent.id);
  if (idx >= 0) inMemoryStudentStore[idx] = testStudent;
  else inMemoryStudentStore.push(testStudent);

  console.log("\n--- TEST 1: ISOLATED COURSE EXAM DATES ---");
  // Set date for SAT Math
  const rec1 = await upsertStudentExamDateService({
    studentId: testStudent.id,
    courseId: "SAT_MATH",
    examDate: "2026-12-05",
    notes: "Official SAT Math December Test"
  });
  console.log(`✓ Saved SAT Math date: ${rec1.examDate}`);

  // Set date for Coding Python (must NOT overwrite SAT Math)
  const rec2 = await upsertStudentExamDateService({
    studentId: testStudent.id,
    courseId: "CODING_PYTHON",
    examDate: "2026-12-18",
    notes: "Python Final Project Evaluation"
  });
  console.log(`✓ Saved Coding Python date: ${rec2.examDate}`);

  // Fetch all exam dates
  const dates = await getStudentExamDatesService(testStudent.id);
  console.log(`Total exam dates for student: ${dates.length}`);

  const mathDate = dates.find(d => d.courseId === "SAT_MATH");
  const pythonDate = dates.find(d => d.courseId === "CODING_PYTHON");

  if (!mathDate || mathDate.examDate !== "2026-12-05") {
    throw new Error(`SAT_MATH exam date mismatch or missing: ${mathDate?.examDate}`);
  }
  if (!pythonDate || pythonDate.examDate !== "2026-12-18") {
    throw new Error(`CODING_PYTHON exam date mismatch or missing: ${pythonDate?.examDate}`);
  }
  console.log("✓ Course exam dates isolation verified: Setting Python exam date preserved SAT Math date!");

  console.log("\n--- TEST 2: 1-TO-1 EXAM WISH DISPATCH ---");
  const sendRes = await sendSingleStudentExamWishService({
    studentId: testStudent.id,
    courseId: "SAT Math",
    examDate: "2026-12-05",
    recipientTypes: ["STUDENT", "PARENT"],
    customMessage: "You have reviewed all formula sheets. Stay confident!",
    forceResend: true
  });

  console.log(`Sent result:`, sendRes);
  if (!sendRes.success || sendRes.sentCount !== 2) {
    throw new Error(`Expected success with 2 recipients, got ${sendRes.sentCount}`);
  }
  console.log(`✓ 1-to-1 exam wish dispatched to: ${sendRes.recipients.join(", ")}`);

  console.log("\n=================================================================");
  console.log("ALL PART 5 EXAM WISHES AND DATES TESTS PASSED SUCCESSFULLY!");
  console.log("=================================================================");
}

runTest().catch(err => {
  console.error("Test failed:", err);
  process.exit(1);
});
