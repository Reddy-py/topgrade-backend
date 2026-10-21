import { supabaseAdmin } from "../supabase.js";

async function main() {
  const loginRes = await fetch("http://localhost:5000/api/auth/login", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ identifier: "admin@topgrade.edu", password: "TopGrade2026!" })
  });
  const loginData = await loginRes.json();
  const adminToken = loginData.session?.access_token;

  const teacherLoginRes = await fetch("http://localhost:5000/api/auth/login", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ identifier: "teacher@topgrade.edu", password: "TopGrade2026!" })
  });
  const teacherLoginData = await teacherLoginRes.json();
  const teacherToken = teacherLoginData.session?.access_token;
  console.log("Teacher logged in:", teacherLoginData.success);

  const singleParentPayload = {
    firstName: "Aria",
    lastName: "Montgomery",
    fullName: "Aria Montgomery",
    gender: "Female",
    dob: "2014-05-12",
    age: 12,
    school: "Edison Middle School",
    grade: "Grade 7",
    status: "ACTIVE",
    fatherName: "Byron Montgomery",
    parentPhones: ["+1 555-019-8801"],
    parentEmails: ["byron.montgomery@example.com"],
    email: "", // Optional student email omitted!
    residentialAddress: "400 Oak Street, Edison, NJ 08817",
    program: "Robotics Fundamentals",
    program_type: "TUTORING",
    feePlan: "Monthly",
    purchasedHours: 20
  };

  const addRes = await fetch("http://localhost:5000/api/students/add", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: "Bearer " + adminToken
    },
    body: JSON.stringify(singleParentPayload)
  });
  console.log("Students add status:", addRes.status);
  const addJson = await addRes.json();
  console.log("Add response:", JSON.stringify(addJson));
}

main().catch(console.error);
