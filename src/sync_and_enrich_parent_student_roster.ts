import dotenv from "dotenv";
import { createClient } from "@supabase/supabase-js";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

dotenv.config();

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const DATA_DIR = path.join(__dirname, "../data");
const DB_FILE_PATH = path.join(DATA_DIR, "students_db.json");

const supabaseUrl = process.env.SUPABASE_URL || "";
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY || "";

if (!supabaseUrl || !supabaseKey) {
  console.error("Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY");
  process.exit(1);
}

const supabase = createClient(supabaseUrl, supabaseKey, {
  auth: { autoRefreshToken: false, persistSession: false }
});

const DEFAULT_STUDENT_PASS = "Student@TopGrade2026";
const DEFAULT_PARENT_PASS = "Parent@TopGrade2026";

// Complete 60 PNG Rows + Foundational records
interface MasterStudentEntry {
  studentCode: string;
  fullName: string;
  grade: string;
  school: string;
  rawCourse: string;
  allocatedCourses: Array<{ courseName: string; duration: string }>;
  parentName: string;
  parentEmails: string[];
  parentPhones: string[];
  studentLoginEmail: string;
  studentPhones: string[];
}

// Clean phone formatting
function cleanPhone(p: string): string {
  const num = p.replace(/[^0-9]/g, "");
  if (num.length === 10) return `+1 ${num.slice(0, 3)} ${num.slice(3, 6)} ${num.slice(6)}`;
  if (num.length === 11 && num.startsWith("1")) return `+1 ${num.slice(1, 4)} ${num.slice(4, 7)} ${num.slice(7)}`;
  return p.trim() ? `+1 ${num}` : "";
}

// Secondary parent mapping: links parents with blank rows to their family
const secondaryParentFamilies: Record<string, { childCodes: string[]; childNames: string[]; parentEmail: string; parentPhone: string; familyName: string }> = {
  "duggalmd@aol.com": {
    childCodes: ["TG-STU-2026-5032"],
    childNames: ["Deven"],
    parentEmail: "duggalmd@aol.com",
    parentPhone: "+1 832 314 3626",
    familyName: "Sandeep Duggal"
  },
  "conner.skuzniar@gmail.com": {
    childCodes: ["TG-STU-2026-5010"],
    childNames: ["Ethan Kuzniar"],
    parentEmail: "conner.skuzniar@gmail.com",
    parentPhone: "+1 713 208 0947",
    familyName: "Conner Kuzniar"
  },
  "cmotwani10@gmail.com": {
    childCodes: ["TG-STU-2026-5020"],
    childNames: ["Chirag"],
    parentEmail: "cmotwani10@gmail.com",
    parentPhone: "+1 304 767 2676",
    familyName: "Chirag Motwani"
  },
  "vondeahgrant@yahoo.com": {
    childCodes: ["TG-STU-2026-5049"],
    childNames: ["Brooke"],
    parentEmail: "vondeahgrant@yahoo.com",
    parentPhone: "+1 713 725 3665",
    familyName: "Vondeah Grant"
  },
  "ulayshagibbs@gmail.com": {
    childCodes: ["TG-STU-2026-5051"],
    childNames: ["Ulaysha"],
    parentEmail: "ulayshagibbs@gmail.com",
    parentPhone: "+1 713 820 0792",
    familyName: "Ulaysha Gibbs"
  },
  "chaitu900@gmail.com": {
    childCodes: ["TG-STU-2026-5048"],
    childNames: ["Chaitanya Gundapaneni"],
    parentEmail: "chaitu900@gmail.com",
    parentPhone: "+1 281 614 9093",
    familyName: "Chaitanya Gundapaneni"
  },
  "parent.kirtida.monpara.5040@parents.topgrade.edu": {
    childCodes: ["TG-STU-2026-5039"],
    childNames: ["Anushka"],
    parentEmail: "parent.kirtida.monpara.5040@parents.topgrade.edu",
    parentPhone: "+1 781 353 1272",
    familyName: "Kirtida Monpara"
  },
  "parent.kaleb.smith.5042@parents.topgrade.edu": {
    childCodes: ["TG-STU-2026-5041"],
    childNames: ["Kaleb Smith"],
    parentEmail: "parent.kaleb.smith.5042@parents.topgrade.edu",
    parentPhone: "+1 908 340 2976",
    familyName: "Kaleb Smith"
  },
  "parent.serena.iii.5044@parents.topgrade.edu": {
    childCodes: ["TG-STU-2026-5043"],
    childNames: ["Serena"],
    parentEmail: "parent.serena.iii.5044@parents.topgrade.edu",
    parentPhone: "+1 979 900 7400",
    familyName: "Serena III"
  },
  "tuhuynh0046@gmail.com": {
    childCodes: ["TG-STU-2026-5013"],
    childNames: ["Tu Hyunh"],
    parentEmail: "tuhuynh0046@gmail.com",
    parentPhone: "+1 714 261 6170",
    familyName: "Tu Hyunh"
  }
};

// Course Normalizer: maps course text from PNG into structured allocatedCourses
function mapAllocatedCourses(courseStr: string): Array<{ courseName: string; duration: string }> {
  const c = (courseStr || "").trim();
  if (!c) return [{ courseName: "General Academic Track", duration: "Academic Year" }];

  const courses: Array<{ courseName: string; duration: string }> = [];

  if (c.includes("AP Chem") && c.includes("SAT")) {
    courses.push({ courseName: "AP Chemistry", duration: "3 Months" });
    courses.push({ courseName: "SAT Prep", duration: "3 Months" });
  } else if (c.includes("PAP Chemistry") || c.includes("PAP Alge 2")) {
    courses.push({ courseName: "AP Chemistry", duration: "3 Months" });
    courses.push({ courseName: "Algebra 1 & PAP Algebra 2", duration: "3 Months" });
  } else if (c.includes("SAT prep") && c.includes("College Essay")) {
    courses.push({ courseName: "SAT Prep", duration: "3 Months" });
    courses.push({ courseName: "College Essay Workshop & Writing", duration: "2 Months" });
  } else if (c.includes("Math & Reading") || c.includes("Math, writing, reading") || c.includes("Reading & Math")) {
    courses.push({ courseName: "Math & Reading Foundations", duration: "3 Months" });
  } else if (c.includes("GT prep")) {
    courses.push({ courseName: "GT Prep (Gifted & Talented)", duration: "3 Months" });
    courses.push({ courseName: "Math & Reading Foundations", duration: "3 Months" });
  } else if (c.toLowerCase().includes("summer camp")) {
    courses.push({ courseName: "Summer Camp & Academic Tutoring", duration: "Summer Session" });
  } else if (c.toLowerCase().includes("afterschool")) {
    courses.push({ courseName: "After School Program", duration: "Academic Year" });
  } else if (c.toLowerCase().includes("reading comp")) {
    courses.push({ courseName: "Reading Comprehension", duration: "3 Months" });
  } else if (c.toLowerCase() === "reading") {
    courses.push({ courseName: "Reading", duration: "3 Months" });
  } else if (c.toLowerCase().includes("reading writing") || c.toLowerCase().includes("reading, handwriting")) {
    courses.push({ courseName: "Reading Comprehension", duration: "3 Months" });
    courses.push({ courseName: "Writing Skills & Handwriting", duration: "3 Months" });
  } else if (c.toLowerCase().includes("writing")) {
    courses.push({ courseName: "Writing Skills & Handwriting", duration: "3 Months" });
  } else if (c.toLowerCase().includes("ap physics")) {
    courses.push({ courseName: "AP Physics", duration: "3 Months" });
  } else if (c.toLowerCase().includes("pap geometry") || c.toLowerCase() === "geometry") {
    courses.push({ courseName: "Geometry", duration: "3 Months" });
  } else if (c.toLowerCase().includes("college essay")) {
    courses.push({ courseName: "College Essay Workshop & Writing", duration: "2 Months" });
  } else if (c.toLowerCase().includes("sat prep")) {
    courses.push({ courseName: "SAT Prep", duration: "3 Months" });
  } else if (c.toLowerCase().includes("pap spanish")) {
    courses.push({ courseName: "PAP Spanish", duration: "3 Months" });
  } else if (c.toLowerCase().includes("hindi")) {
    courses.push({ courseName: "Hindi Language", duration: "3 Months" });
  } else if (c.toLowerCase().includes("math")) {
    courses.push({ courseName: "Math", duration: "3 Months" });
  } else if (c.toLowerCase().includes("alge 1") || c.toLowerCase().includes("algebra")) {
    courses.push({ courseName: "Algebra 1 & PAP Algebra 2", duration: "3 Months" });
  } else if (c.toLowerCase().includes("staar")) {
    courses.push({ courseName: "STAAR Prep", duration: "3 Months" });
  } else if (c.toLowerCase().includes("tsi")) {
    courses.push({ courseName: "TSI Prep", duration: "2 Months" });
  } else if (c.toLowerCase().includes("esl")) {
    courses.push({ courseName: "ESL (English as a Second Language)", duration: "3 Months" });
  } else if (c.toLowerCase().includes("python") || c.toLowerCase().includes("coding")) {
    courses.push({ courseName: "Coding", duration: "3 Months" });
  } else if (c.toLowerCase().includes("english")) {
    courses.push({ courseName: "English", duration: "3 Months" });
  } else {
    courses.push({ courseName: c, duration: "3 Months" });
  }

  return courses;
}

async function main() {
  console.log("=========================================================");
  console.log("  TOPGRADE CRM - COMPLETE ROSTER & CREDENTIALS SYNC");
  console.log("=========================================================");

  // 1. Fetch current users in auth
  const { data: authData } = await supabase.auth.admin.listUsers({ page: 1, perPage: 1000 });
  const authByEmail = new Map((authData?.users || []).map(u => [u.email?.toLowerCase().trim() || "", u]));
  console.log(`Current Supabase Auth users count: ${authByEmail.size}`);

  // 2. Fetch existing students from Supabase table
  const { data: sbStudents } = await supabase.from("students").select("*");
  const sbStudentByCode = new Map((sbStudents || []).map(s => [s.student_id_code, s]));
  console.log(`Current Supabase Students count: ${sbStudentByCode.size}`);

  // Load existing students_db.json
  let localStudents: any[] = [];
  if (fs.existsSync(DB_FILE_PATH)) {
    try {
      localStudents = JSON.parse(fs.readFileSync(DB_FILE_PATH, "utf-8"));
    } catch {}
  }
  const localByCode = new Map(localStudents.map(s => [s.studentCode, s]));

  // Read student_and_parent_credentials.csv to get canonical baseline
  const csvPath = path.resolve(__dirname, "../../student_and_parent_credentials.csv");
  if (!fs.existsSync(csvPath)) {
    console.error("Missing student_and_parent_credentials.csv");
    process.exit(1);
  }

  const csvLines = fs.readFileSync(csvPath, "utf-8").split("\n").filter(Boolean);
  const header = csvLines[0];
  const rows = csvLines.slice(1);
  console.log(`Loaded ${rows.length} records from student_and_parent_credentials.csv`);

  const updatedStudentsStore: any[] = [];
  const parentAccountsToEnsure: Array<{
    email: string;
    fullName: string;
    phone: string;
    childCodes: string[];
    childNames: string[];
  }> = [];

  const studentAccountsToEnsure: Array<{
    email: string;
    fullName: string;
    studentCode: string;
    phone: string;
  }> = [];

  // Track parent -> children mappings
  const parentChildrenMap = new Map<string, { email: string; fullName: string; phone: string; childCodes: Set<string>; childNames: Set<string> }>();

  function registerParentChild(email: string, fullName: string, phone: string, childCode: string, childName: string) {
    const cleanEmail = email.toLowerCase().trim();
    if (!cleanEmail || !cleanEmail.includes("@")) return;

    if (!parentChildrenMap.has(cleanEmail)) {
      parentChildrenMap.set(cleanEmail, {
        email: cleanEmail,
        fullName,
        phone,
        childCodes: new Set([childCode]),
        childNames: new Set([childName])
      });
    } else {
      const entry = parentChildrenMap.get(cleanEmail)!;
      entry.childCodes.add(childCode);
      entry.childNames.add(childName);
      if (fullName && (!entry.fullName || entry.fullName.includes("Parent"))) entry.fullName = fullName;
      if (phone && !entry.phone) entry.phone = phone;
    }
  }

  // Secondary parent student codes that should not exist as separate students
  const secondaryParentCodesToExclude = new Set([
    "TG-STU-2026-5011", // Conner Kuzniar -> parent of Ethan Kuzniar (5010)
    "TG-STU-2026-5021", // Chirag Motwani -> parent of Chirag (5020)
    "TG-STU-2026-5033", // Sandeep Duggal -> parent of Deven (5032)
    "TG-STU-2026-5040", // Kirtida Monpara -> parent of Anushka (5039)
    "TG-STU-2026-5042", // Kaleb Smith Sr -> parent of Kaleb Smith (5041)
    "TG-STU-2026-5044", // Serena III -> parent of Serena (5043)
    "TG-STU-2026-5050", // Vondeah Grant -> parent of Brooke (5049)
    "TG-STU-2026-5052", // Ulaysha Gibbs -> parent of Ulaysha (5051)
  ]);

  // 3. Process each student row
  for (const line of rows) {
    if (!line.trim()) continue;
    const parts: string[] = [];
    let cur = "";
    let inQuotes = false;
    for (let i = 0; i < line.length; i++) {
      const c = line[i];
      if (c === '"') inQuotes = !inQuotes;
      else if (c === ',' && !inQuotes) {
        parts.push(cur.trim());
        cur = "";
      } else {
        cur += c;
      }
    }
    parts.push(cur.trim());

    const sl = parts[0]?.replace(/^"|"$/g, "");
    const studentCode = parts[1]?.replace(/^"|"$/g, "") || "";
    const studentName = parts[2]?.replace(/^"|"$/g, "") || "";
    const studentLoginEmail = parts[3]?.replace(/^"|"$/g, "") || "";
    const studentPassword = parts[4]?.replace(/^"|"$/g, "") || DEFAULT_STUDENT_PASS;
    const studentPhone = cleanPhone(parts[5]?.replace(/^"|"$/g, "") || "");
    const rawGrade = parts[6]?.replace(/^"|"$/g, "").replace("Grade: ", "").trim() || "";
    const rawSchool = parts[7]?.replace(/^"|"$/g, "").replace("School: ", "").trim() || "";
    const rawCourse = parts[8]?.replace(/^"|"$/g, "") || "";
    const parentName = parts[10]?.replace(/^"|"$/g, "") || "";
    const parentLoginEmail = parts[11]?.replace(/^"|"$/g, "") || "";
    const parentPhone = cleanPhone(parts[13]?.replace(/^"|"$/g, "") || studentPhone);

    if (!studentCode || !studentLoginEmail) continue;

    // Skip creating redundant fake student records for secondary parents
    if (secondaryParentCodesToExclude.has(studentCode)) {
      continue;
    }

    const allocatedCourses = mapAllocatedCourses(rawCourse);

    // Build complete list of parent emails for this child
    const parentEmailList: string[] = [];

    // System email e.g. parent.tanyea.fowls.5001@parents.topgrade.edu
    if (parentLoginEmail && parentLoginEmail.includes("@")) {
      parentEmailList.push(parentLoginEmail.toLowerCase().trim());
    }

    // Also look up if there's a primary PNG email (e.g. from existing DB or metadata)
    const existingStu = sbStudentByCode.get(studentCode) || localByCode.get(studentCode);
    const existingLocal = localByCode.get(studentCode);

    // Find PNG personal email from user metadata or known mapping
    for (const [authEmail, authUser] of authByEmail.entries()) {
      const meta = authUser.user_metadata || {};
      const metaChildCodes = [meta.student_id_code, meta.child_code, ...(meta.child_codes || [])].filter(Boolean).join(", ");
      if (metaChildCodes.includes(studentCode) && authEmail.includes("@") && !authEmail.includes("@student.topgrade.edu")) {
        if (!parentEmailList.includes(authEmail)) {
          parentEmailList.push(authEmail);
        }
      }
    }

    // Also check secondary parents linked to this child
    for (const [secEmail, secInfo] of Object.entries(secondaryParentFamilies)) {
      if (secInfo.childCodes.includes(studentCode)) {
        if (!parentEmailList.includes(secEmail.toLowerCase())) {
          parentEmailList.push(secEmail.toLowerCase());
        }
      }
    }

    // Register with parentChildrenMap for all parent emails
    for (const pEmail of parentEmailList) {
      registerParentChild(pEmail, parentName, parentPhone, studentCode, studentName);
    }

    // Register student account to ensure
    studentAccountsToEnsure.push({
      email: studentLoginEmail.toLowerCase().trim(),
      fullName: studentName,
      studentCode,
      phone: studentPhone
    });

    const splitName = studentName.split(" ");
    const firstName = splitName[0] || studentName;
    const lastName = splitName.slice(1).join(" ") || "";

    const dossier = {
      id: existingStu?.id || existingLocal?.id || `std-${studentCode.toLowerCase()}`,
      studentCode,
      fullName: studentName,
      firstName,
      lastName,
      email: studentLoginEmail.toLowerCase().trim(),
      dob: existingStu?.dob || existingLocal?.dob || "2010-01-01",
      age: existingStu?.age || existingLocal?.age || 14,
      school: rawSchool || "Top Grade Academy",
      grade: rawGrade || "Grade 10",
      status: "ACTIVE",
      primaryMobile: studentPhone || parentPhone,
      studentPhones: studentPhone ? [studentPhone] : [],
      parentPhones: parentPhone ? [parentPhone] : [],
      studentWhatsapp: studentPhone,
      parentWhatsapp: parentPhone ? [parentPhone] : [],
      studentEmails: [studentLoginEmail.toLowerCase().trim()],
      parentEmails: parentEmailList,
      fatherName: parentName,
      motherName: "",
      guardianName: "",
      program: rawCourse || "General Academic Track",
      teacher: existingStu?.teacher || existingLocal?.teacher || "Unassigned",
      residentialAddress: existingLocal?.residentialAddress || "",
      studentAddress: existingLocal?.studentAddress || "",
      alternateAddress: existingLocal?.alternateAddress || "",
      examDate: existingLocal?.examDate || "",
      purchasedHours: 0,
      hoursLeft: 0,
      daysLeft: 0,
      feePlan: "Standard Plan",
      allocatedCourses
    };

    updatedStudentsStore.push(dossier);
  }

  // Also include secondary parents in parentChildrenMap
  for (const [secEmail, secInfo] of Object.entries(secondaryParentFamilies)) {
    const cleanEmail = secEmail.toLowerCase().trim();
    if (!parentChildrenMap.has(cleanEmail)) {
      parentChildrenMap.set(cleanEmail, {
        email: cleanEmail,
        fullName: secInfo.familyName,
        phone: secInfo.parentPhone,
        childCodes: new Set(secInfo.childCodes),
        childNames: new Set(secInfo.childNames)
      });
    } else {
      const e = parentChildrenMap.get(cleanEmail)!;
      secInfo.childCodes.forEach(c => e.childCodes.add(c));
      secInfo.childNames.forEach(n => e.childNames.add(n));
    }
  }

  // 4. Save clean data to students_db.json
  console.log(`\nSaving ${updatedStudentsStore.length} students to ${DB_FILE_PATH}...`);
  fs.writeFileSync(DB_FILE_PATH, JSON.stringify(updatedStudentsStore, null, 2), "utf-8");
  console.log("✓ students_db.json successfully updated.");

  // 5. Ensure All Student Auth Accounts exist & have Student@TopGrade2026 password
  console.log("\nEnsuring all Student Auth Accounts in Supabase...");
  let studentsUpdated = 0;
  for (const s of studentAccountsToEnsure) {
    try {
      const existingAuth = authByEmail.get(s.email);
      if (!existingAuth) {
        const { data: created, error: crErr } = await supabase.auth.admin.createUser({
          email: s.email,
          password: DEFAULT_STUDENT_PASS,
          email_confirm: true,
          user_metadata: {
            role: "STUDENT",
            full_name: s.fullName,
            student_code: s.studentCode,
            student_id_code: s.studentCode,
            phone: s.phone
          }
        });
        if (!crErr && created?.user) {
          authByEmail.set(s.email, created.user);
          await supabase.from("profiles").upsert({
            id: created.user.id,
            email: s.email,
            full_name: s.fullName,
            phone: s.phone,
            role: "STUDENT",
            status: "Active"
          });
          studentsUpdated++;
        }
      } else {
        // Update password and metadata to guarantee login works
        await supabase.auth.admin.updateUserById(existingAuth.id, {
          password: DEFAULT_STUDENT_PASS,
          email_confirm: true,
          user_metadata: {
            ...existingAuth.user_metadata,
            role: "STUDENT",
            full_name: s.fullName,
            student_code: s.studentCode,
            student_id_code: s.studentCode,
            phone: s.phone
          }
        });
        await supabase.from("profiles").upsert({
          id: existingAuth.id,
          email: s.email,
          full_name: s.fullName,
          phone: s.phone,
          role: "STUDENT",
          status: "Active"
        });
        studentsUpdated++;
      }
    } catch (e: any) {
      console.warn(`  ! Student ${s.email} note:`, e.message);
    }
  }
  console.log(`✓ Synchronized ${studentsUpdated} student auth credentials.`);

  // 6. Ensure All Parent Auth Accounts exist & have Parent@TopGrade2026 password
  console.log("\nEnsuring all Parent Auth Accounts in Supabase...");
  let parentsUpdated = 0;
  for (const [pEmail, pInfo] of parentChildrenMap.entries()) {
    try {
      const childCodesArr = Array.from(pInfo.childCodes);
      const childNamesArr = Array.from(pInfo.childNames);
      const childCodesStr = childCodesArr.join(", ");
      const childNamesStr = childNamesArr.join(", ");

      const existingAuth = authByEmail.get(pEmail);
      if (!existingAuth) {
        const { data: created, error: crErr } = await supabase.auth.admin.createUser({
          email: pEmail,
          password: DEFAULT_PARENT_PASS,
          email_confirm: true,
          user_metadata: {
            role: "PARENT",
            full_name: pInfo.fullName,
            father_name: pInfo.fullName,
            child_code: childCodesStr,
            child_codes: childCodesArr,
            student_id_code: childCodesStr,
            child_name: childNamesStr,
            children: childNamesArr,
            phone: pInfo.phone
          }
        });
        if (!crErr && created?.user) {
          authByEmail.set(pEmail, created.user);
          await supabase.from("profiles").upsert({
            id: created.user.id,
            email: pEmail,
            full_name: pInfo.fullName,
            phone: pInfo.phone,
            role: "PARENT",
            status: "Active"
          });
          parentsUpdated++;
        }
      } else {
        await supabase.auth.admin.updateUserById(existingAuth.id, {
          password: DEFAULT_PARENT_PASS,
          email_confirm: true,
          user_metadata: {
            ...existingAuth.user_metadata,
            role: "PARENT",
            full_name: pInfo.fullName,
            father_name: pInfo.fullName,
            child_code: childCodesStr,
            child_codes: childCodesArr,
            student_id_code: childCodesStr,
            child_name: childNamesStr,
            children: childNamesArr,
            phone: pInfo.phone
          }
        });
        await supabase.from("profiles").upsert({
          id: existingAuth.id,
          email: pEmail,
          full_name: pInfo.fullName,
          phone: pInfo.phone,
          role: "PARENT",
          status: "Active"
        });
        parentsUpdated++;
      }
    } catch (e: any) {
      console.warn(`  ! Parent ${pEmail} note:`, e.message);
    }
  }
  console.log(`✓ Synchronized ${parentsUpdated} parent auth credentials.`);

  console.log("\n=========================================================");
  console.log("  ALL PARENT & STUDENT LOGINS SYNCHRONIZED SUCCESSFULLY!");
  console.log("=========================================================");
}

main();
