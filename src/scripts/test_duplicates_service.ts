import dotenv from "dotenv";
dotenv.config({ path: "./.env" });
process.env.SIMULATE_EMAILS = "true";

import assert from "assert";
import { inMemoryStudentStore } from "../services/studentService.js";
import { scanDuplicatesService, mergeRecordsService } from "../services/duplicatesService.js";

async function testDuplicates() {
  console.log("=================================================================");
  console.log("TESTING DUPLICATE DETECTION AND MERGE SERVICE");
  console.log("=================================================================");

  // 1. Seed two duplicate students in memory
  const primaryStudent: any = {
    id: "dup-test-primary-001",
    studentCode: "TG-STU-DUP-01",
    fullName: "Ethan Wright",
    firstName: "Ethan",
    lastName: "Wright",
    email: "ethan.wright@example.com",
    dob: "2010-05-15",
    grade: "Grade 8",
    parentEmails: ["sarah.wright@example.com"],
    status: "ACTIVE"
  };

  const duplicateStudent: any = {
    id: "dup-test-secondary-002",
    studentCode: "TG-STU-DUP-02",
    fullName: "Ethan Wright",
    firstName: "Ethan",
    lastName: "Wright",
    email: "ethan.wright.alt@example.com",
    dob: "2010-05-15",
    grade: "Grade 8",
    parentEmails: ["sarah.wright@example.com"],
    status: "ACTIVE"
  };

  inMemoryStudentStore.push(primaryStudent, duplicateStudent);

  // 2. Scan duplicates
  const clusters = await scanDuplicatesService();
  console.log(`Scan completed. Found ${clusters.length} duplicate cluster(s).`);
  const matchingCluster = clusters.find(c =>
    (c.recordA.id === primaryStudent.id && c.recordB.id === duplicateStudent.id) ||
    (c.recordA.id === duplicateStudent.id && c.recordB.id === primaryStudent.id)
  );

  assert(matchingCluster, "Expected matching cluster for Ethan Wright duplicates to be found.");
  console.log(`✓ Detected cluster: "${matchingCluster.reason}" with confidence "${matchingCluster.confidence}"`);

  // 3. Dry-run Merge
  const dryRun = await mergeRecordsService({
    primaryId: primaryStudent.id,
    duplicateId: duplicateStudent.id,
    type: "STUDENT",
    dryRun: true
  });
  assert(dryRun.dryRun === true, "Dry-run flag must be true in preview mode");
  console.log(`✓ Dry-run preview summary: ${dryRun.summary}`);

  // 4. Real Merge Execution
  const realMerge = await mergeRecordsService({
    primaryId: primaryStudent.id,
    duplicateId: duplicateStudent.id,
    type: "STUDENT",
    dryRun: false,
    adminEmail: "admin@topgrade.org"
  });
  assert(realMerge.dryRun === false, "Real merge must execute");

  // Verify duplicate is archived
  const archivedDup = inMemoryStudentStore.find(s => s.id === duplicateStudent.id);
  assert.strictEqual(archivedDup?.status, "ARCHIVED", "Duplicate student must be ARCHIVED");
  console.log(`✓ Real merge executed. Duplicate student status is: ${archivedDup?.status}`);

  console.log("=================================================================");
  console.log("ALL DUPLICATES TESTS PASSED!");
  console.log("=================================================================");
}

testDuplicates()
  .then(() => process.exit(0))
  .catch(err => {
    console.error("TEST FAILED:", err);
    process.exit(1);
  });
