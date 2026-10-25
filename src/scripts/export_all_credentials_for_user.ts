import { supabaseAdmin } from "../supabase.js";
import { OFFICIAL_TEACHERS } from "../constants/officialCatalog.js";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

async function exportCredentials() {
  console.log("Fetching all credentials from database...");

  // 1. Admin
  const adminCredentials = [
    {
      role: "ADMIN",
      name: "System Administrator",
      email: "admin@topgrade.edu",
      password: "TopGrade2026!",
      portalUrl: "http://localhost:5174/login"
    }
  ];

  // 2. Teachers
  const teacherPassword = "TopGrade@2026!";
  // Ensure Jamie Dawson is also set to TopGrade@2026!
  try {
    const { data: userList } = await supabaseAdmin.auth.admin.listUsers({ page: 1, perPage: 1000 });
    const jamie = userList?.users?.find(u => u.email?.toLowerCase() === "jldaeb1000@gmail.com");
    if (jamie) {
      await supabaseAdmin.auth.admin.updateUserById(jamie.id, { password: teacherPassword });
    }
  } catch (err: any) {
    console.warn("Notice updating Jamie:", err.message);
  }

  const teachers = OFFICIAL_TEACHERS.map((t, idx) => ({
    sl: idx + 1,
    role: "TEACHER",
    code: t.teacher_id_code,
    name: `${t.title} ${t.name}`.trim(),
    email: t.email,
    password: teacherPassword,
    phone: t.phone,
    specialization: t.specialization,
    city: t.city
  }));

  // Add generic teacher test account
  teachers.unshift({
    sl: 0,
    role: "TEACHER",
    code: "TG-TEST-TEACHER",
    name: "Vikram Teacher (Demo)",
    email: "teacher@topgrade.edu",
    password: "TopGrade2026!",
    phone: "+1 555-019-2834",
    specialization: "General Demo Faculty",
    city: "Pearland"
  });

  // 3. Students
  const { data: dbStudents } = await supabaseAdmin.from("students").select("*");
  const { data: studentProfiles } = await supabaseAdmin
    .from("profiles")
    .select("id, email, full_name, phone, role, status")
    .eq("role", "STUDENT");

  const studentMapByEmail = new Map<string, any>();
  for (const s of (dbStudents || [])) {
    if (s.email) {
      studentMapByEmail.set(s.email.toLowerCase().trim(), s);
    }
  }

  const studentDefaultPassword = "Student@TopGrade2026";
  const processedEmails = new Set<string>();
  const studentsList: any[] = [];

  // Add all from student profiles first
  for (const p of (studentProfiles || [])) {
    if (!p.email) continue;
    const lowerEmail = p.email.toLowerCase().trim();
    processedEmails.add(lowerEmail);

    const dbRecord = studentMapByEmail.get(lowerEmail);
    let pass = studentDefaultPassword;
    if (lowerEmail === "student@topgrade.edu" || lowerEmail === "accountant@topgrade.edu") {
      pass = "TopGrade2026!";
    }

    studentsList.push({
      role: "STUDENT",
      studentId: dbRecord?.student_id_code || dbRecord?.student_code || "TG-STU",
      name: p.full_name || dbRecord?.name || "Student",
      email: p.email,
      password: pass,
      phone: p.phone || dbRecord?.phone || "N/A",
      program: dbRecord?.program || "General Academic Track",
      grade: dbRecord?.grade || "N/A"
    });
  }

  // Add any remaining students from students table
  for (const s of (dbStudents || [])) {
    if (!s.email) continue;
    const lowerEmail = s.email.toLowerCase().trim();
    if (processedEmails.has(lowerEmail)) continue;
    processedEmails.add(lowerEmail);

    studentsList.push({
      role: "STUDENT",
      studentId: s.student_id_code || s.student_code || "TG-STU",
      name: s.name || "Student",
      email: s.email,
      password: studentDefaultPassword,
      phone: s.phone || "N/A",
      program: s.program || "General Academic Track",
      grade: s.grade || "N/A"
    });
  }

  // Sort by studentId / name
  studentsList.sort((a, b) => (a.studentId || "").localeCompare(b.studentId || ""));
  studentsList.forEach((s, idx) => { s.sl = idx + 1; });

  // 4. Parents
  const { data: parentProfiles } = await supabaseAdmin
    .from("profiles")
    .select("email, full_name, phone, status")
    .eq("role", "PARENT")
    .order("full_name", { ascending: true });

  const parentDefaultPassword = "Parent@TopGrade2026";
  const parentsList = (parentProfiles || []).map((p, idx) => {
    let pass = parentDefaultPassword;
    if (p.email === "parent@topgrade.edu") pass = "TopGrade2026!";
    if (p.email === "demo.parent@topgradelearning.com") pass = "TopGradeDemo2026!";

    return {
      sl: idx + 1,
      role: "PARENT",
      name: p.full_name || "Parent",
      email: p.email,
      password: pass,
      phone: p.phone || "N/A",
      status: p.status || "Active"
    };
  });

  const exportData = {
    admin: adminCredentials,
    teachers,
    students: studentsList,
    parents: parentsList
  };

  const outPath = path.resolve(__dirname, "../../all_credentials_export.json");
  fs.writeFileSync(outPath, JSON.stringify(exportData, null, 2), "utf-8");
  console.log(`Saved credentials export to ${outPath}`);
  console.log(`Summary: Admin: ${adminCredentials.length}, Teachers: ${teachers.length}, Students: ${studentsList.length}, Parents: ${parentsList.length}`);
}

exportCredentials().catch(console.error);
