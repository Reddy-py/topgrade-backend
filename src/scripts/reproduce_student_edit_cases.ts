import dotenv from "dotenv";
dotenv.config({ path: "./.env" });
process.env.SIMULATE_EMAILS = "true";

import { updateStudentService, inMemoryStudentStore } from "../services/studentService.js";
import { supabaseAdmin } from "../supabase.js";

async function runReproduction() {
  console.log("=================================================================");
  console.log("REPRODUCING STUDENT EDIT CASES AGAINST LOCAL BACKEND SERVICE");
  console.log("=================================================================");

  // Let's seed a base synthetic imported-style student in memory and Supabase
  const testStudentId = "00000000-0000-0000-0000-000000000001";
  const testStudentCode = "TG-STU-IMPORT-001";

  const baseStudent: any = {
    id: testStudentId,
    studentCode: testStudentCode,
    fullName: "Alex",
    firstName: "Alex",
    lastName: "", // missing last name
    email: "imported_placeholder@topgrade.internal",
    dob: "", // missing DOB
    age: 0,
    school: "", // missing school
    grade: "", // missing grade
    status: "ACTIVE",
    primaryMobile: "",
    studentPhones: [],
    parentPhones: ["+1 555-0100"],
    studentEmails: [],
    parentEmails: ["parent.smith@example.com"],
    fatherName: "John Smith",
    motherName: "",
    guardianName: "",
    program: "Math",
    teacher: "Unassigned",
    residentialAddress: "",
    studentAddress: "",
    alternateAddress: "",
    purchasedHours: 10,
    feePlan: "Standard",
    allocatedCourses: [],
    updatedAt: "2026-11-01T00:00:00.000Z"
  };

  inMemoryStudentStore.length = 0;
  inMemoryStudentStore.push({ ...baseStudent });

  const cases = [
    {
      name: "Case 1: Missing Last Name (only firstName provided)",
      id: testStudentId,
      payload: { firstName: "Alexander", lastName: "", school: "Lincoln High", grade: "Grade 9" }
    },
    {
      name: "Case 2: Missing Date of Birth (empty string / undefined)",
      id: testStudentId,
      payload: { firstName: "Alexander", lastName: "Smith", dob: "" }
    },
    {
      name: "Case 3: Missing Grade or School (empty strings)",
      id: testStudentId,
      payload: { firstName: "Alexander", lastName: "Smith", grade: "", school: "" }
    },
    {
      name: "Case 4: Placeholder Email (placeholder_tg101@domain or invalid format)",
      id: testStudentId,
      payload: { firstName: "Alexander", lastName: "Smith", email: "placeholder_none_123" }
    },
    {
      name: "Case 5: Student Code used instead of UUID in route lookup",
      id: testStudentCode,
      payload: { firstName: "Alexander", lastName: "Smith", school: "West High" }
    },
    {
      name: "Case 6: Siblings Sharing a Parent Email (parent.smith@example.com already exists)",
      id: testStudentId,
      payload: { firstName: "Alexander", lastName: "Smith", parentEmails: ["parent.smith@example.com", "second.parent@example.com"] }
    },
    {
      name: "Case 7: Student Email that belongs to another login (conflict)",
      id: testStudentId,
      payload: { firstName: "Alexander", lastName: "Smith", email: "parent.smith@example.com" } // matching parent email
    },
    {
      name: "Case 8: Two editors saving at once (concurrency updated_at mismatch)",
      id: testStudentId,
      payload: { firstName: "Alexander", lastName: "Smith", expectedUpdatedAt: "2020-01-01T00:00:00.000Z" }
    }
  ];

  for (const c of cases) {
    console.log(`\n--- Testing ${c.name} ---`);
    console.log(`Request ID: ${c.id}`);
    console.log(`Request Payload:`, JSON.stringify(c.payload));
    try {
      const result = await updateStudentService(c.id, c.payload as any);
      console.log(`Response: SUCCESS`);
      console.log(`Saved fullName: "${result.fullName}", dob: "${result.dob}", school: "${result.school}", grade: "${result.grade}", email: "${result.email}"`);
    } catch (err: any) {
      console.log(`Response: FAILURE - ${err.message}`);
    }
  }
}

runReproduction()
  .then(() => process.exit(0))
  .catch(err => {
    console.error("FATAL ERROR:", err);
    process.exit(1);
  });
