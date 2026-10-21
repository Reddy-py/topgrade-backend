import dotenv from "dotenv";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
dotenv.config({ path: path.resolve(__dirname, "../../.env") });

async function main() {
  const API = "http://localhost:5000";
  
  // 1. Login as admin
  const loginRes = await fetch(`${API}/api/auth/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ identifier: "admin@topgrade.edu", password: "TopGrade2026!" })
  });
  const loginData = await loginRes.json() as any;
  console.log("Login status:", loginRes.status, loginData.success);
  const token = loginData.session?.access_token || loginData.token;

  // 2. Test Add Student with one parent email, optional fields empty
  console.log("\n--- Testing Add Student (one parent email, father only) ---");
  const stuRes = await fetch(`${API}/api/students/add`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${token}`
    },
    body: JSON.stringify({
      firstName: "TestStudentOne",
      lastName: "Doe",
      dob: "2015-05-15",
      school: "Rogers Middle School",
      fatherName: "John Doe",
      parentEmails: ["johndoe.parent@example.com"]
    })
  });
  const stuData = await stuRes.json();
  console.log("Add student status:", stuRes.status, JSON.stringify(stuData));

  // 3. Test Add Course
  console.log("\n--- Testing Add Course ---");
  const crsRes = await fetch(`${API}/api/courses/add`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${token}`
    },
    body: JSON.stringify({
      name: "Robotics 101 Test",
      category: "STEM & Technology",
      duration_months: 6,
      package_hours: 24,
      package_price: 600,
      hourly_rate: 30
    })
  });
  const crsData = await crsRes.json();
  console.log("Add course status:", crsRes.status, JSON.stringify(crsData));

  // 4. Test Campaigns endpoint
  console.log("\n--- Testing Campaigns GET ---");
  const campRes = await fetch(`${API}/api/campaigns`, {
    headers: { Authorization: `Bearer ${token}` }
  });
  let campData: any = null;
  try { campData = await campRes.json(); } catch (e) { campData = await campRes.text(); }
  console.log("Campaigns GET status:", campRes.status, JSON.stringify(campData));

  // 4b. Test Engagement settings
  console.log("\n--- Testing Engagement settings GET ---");
  const engRes = await fetch(`${API}/api/engagement/settings`, {
    headers: { Authorization: `Bearer ${token}` }
  });
  let engData: any = null;
  try { engData = await engRes.json(); } catch (e) { engData = await engRes.text(); }
  console.log("Engagement settings GET status:", engRes.status, JSON.stringify(engData));
  console.log("\n--- Testing frontend Courses.tsx direct insert via anon Supabase client ---");
  const { createClient } = await import("@supabase/supabase-js");
  const anonClient = createClient(process.env.SUPABASE_URL || "", process.env.SUPABASE_ANON_KEY || "");
  const { data: directCrs, error: directCrsErr } = await anonClient.from("courses").insert([{
    course_code: `CRS-${Date.now()}`,
    name: "Direct Anon Course Test",
    description: "Testing anon insert",
    age_group: "Grade 6",
    duration: "6 Months",
    duration_months: 6,
    package_hours: 24,
    package_price: 600,
    hourly_rate: 30,
    fee: 499,
    max_students: 20,
    required_teacher_skills: "STEM & Technology",
    course_material: "{}",
    status: "Active"
  }]).select().single();
  console.log("Anon Supabase course insert result:", { directCrs, error: directCrsErr?.message });
}

main().catch(console.error);
