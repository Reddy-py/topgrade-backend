import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const STUDENTS_FILE = path.join(__dirname, "../data/students_db.json");
const CSV_FILE = path.resolve(__dirname, "../../student_and_parent_credentials.csv");
const MD_FILE = path.resolve(__dirname, "../../SYSTEM_CREDENTIALS.md");

const DEFAULT_PARENT_PASS = "Parent@TopGrade2026";
const DEFAULT_STUDENT_PASS = "Student@TopGrade2026";

interface StudentRecord {
  id: string;
  studentCode: string;
  fullName: string;
  firstName: string;
  lastName: string;
  email: string;
  grade: string;
  school: string;
  status: string;
  primaryMobile: string;
  parentEmails: string[];
  fatherName: string;
  program: string;
  allocatedCourses: Array<{ courseName: string; duration: string }>;
}

const secondaryParentFamilies: Record<string, {
  name: string;
  email: string;
  phone: string;
  childCode: string;
  childName: string;
  course: string;
}> = {
  "duggalmd@aol.com": {
    name: "Sandeep Duggal",
    email: "duggalmd@aol.com",
    phone: "+1 832 314 3626",
    childCode: "TG-STU-2026-5032",
    childName: "Deven",
    course: "AP Chem , SAT prep"
  },
  "conner.skuzniar@gmail.com": {
    name: "Conner Kuzniar",
    email: "conner.skuzniar@gmail.com",
    phone: "+1 713 208 0947",
    childCode: "TG-STU-2026-5010",
    childName: "Ethan Kuzniar",
    course: "STAAR"
  },
  "cmotwani10@gmail.com": {
    name: "Chirag Motwani",
    email: "cmotwani10@gmail.com",
    phone: "+1 304 767 2676",
    childCode: "TG-STU-2026-5020",
    childName: "Chirag",
    course: "AP Physics"
  },
  "vondeahgrant@yahoo.com": {
    name: "Vondeah Grant",
    email: "vondeahgrant@yahoo.com",
    phone: "+1 713 725 3665",
    childCode: "TG-STU-2026-5049",
    childName: "Brooke",
    course: "Math"
  },
  "ulayshagibbs@gmail.com": {
    name: "Ulaysha Gibbs",
    email: "ulayshagibbs@gmail.com",
    phone: "+1 713 820 0792",
    childCode: "TG-STU-2026-5051",
    childName: "Ulaysha",
    course: "TSI prep"
  },
  "chaitu900@gmail.com": {
    name: "Chaitanya Gundapaneni",
    email: "chaitu900@gmail.com",
    phone: "+1 281 614 9093",
    childCode: "TG-STU-2026-5048",
    childName: "Chaitanya Gundapaneni",
    course: "SAT prep"
  },
  "parent.kirtida.monpara.5040@parents.topgrade.edu": {
    name: "Kirtida Monpara",
    email: "parent.kirtida.monpara.5040@parents.topgrade.edu",
    phone: "+1 781 353 1272",
    childCode: "TG-STU-2026-5039",
    childName: "Anushka",
    course: "SAT prep"
  },
  "parent.kaleb.smith.5042@parents.topgrade.edu": {
    name: "Kaleb Smith (Parent Contact)",
    email: "parent.kaleb.smith.5042@parents.topgrade.edu",
    phone: "+1 908 340 2976",
    childCode: "TG-STU-2026-5041",
    childName: "Kaleb Smith",
    course: "SAT prep"
  },
  "parent.serena.iii.5044@parents.topgrade.edu": {
    name: "Serena III",
    email: "parent.serena.iii.5044@parents.topgrade.edu",
    phone: "+1 979 900 7400",
    childCode: "TG-STU-2026-5043",
    childName: "Serena",
    course: "Algebra 1"
  }
};

async function main() {
  console.log("Loading students from:", STUDENTS_FILE);
  const rawData = fs.readFileSync(STUDENTS_FILE, "utf-8");
  const students: StudentRecord[] = JSON.parse(rawData);

  // Sort students naturally by studentCode
  students.sort((a, b) => {
    return a.studentCode.localeCompare(b.studentCode, undefined, { numeric: true });
  });

  console.log(`Found ${students.length} valid students.`);

  // Build CSV
  const csvHeaders = [
    "Sl No",
    "Student ID",
    "Student Name",
    "Student Login Email",
    "Student Default Password",
    "Student Phone",
    "Grade",
    "School",
    "Selected Course",
    "Allocated Course Tracks",
    "Parent Name",
    "Parent Login Email (PNG / Personal)",
    "Parent Portal Email (@parents.topgrade.edu)",
    "Parent Default Password",
    "Parent Phone"
  ];

  const csvRows: string[] = [csvHeaders.join(",")];

  students.forEach((s, idx) => {
    const pEmails = s.parentEmails || [];
    const personalEmail = pEmails.find(e => !e.includes("@parents.topgrade.edu") && !e.includes("@student.topgrade.edu")) || "";
    const portalEmail = pEmails.find(e => e.includes("@parents.topgrade.edu")) || "";
    const coursesStr = (s.allocatedCourses || []).map(c => c.courseName).join("; ") || s.program || "General Academic Track";

    const escapeCsv = (str: string) => `"${(str || "").replace(/"/g, '""')}"`;

    const row = [
      idx + 1,
      escapeCsv(s.studentCode),
      escapeCsv(s.fullName),
      escapeCsv(s.email),
      escapeCsv(DEFAULT_STUDENT_PASS),
      escapeCsv(s.primaryMobile),
      escapeCsv(s.grade),
      escapeCsv(s.school),
      escapeCsv(s.program),
      escapeCsv(coursesStr),
      escapeCsv(s.fatherName),
      escapeCsv(personalEmail),
      escapeCsv(portalEmail),
      escapeCsv(DEFAULT_PARENT_PASS),
      escapeCsv(s.primaryMobile)
    ];

    csvRows.push(row.join(","));
  });

  fs.writeFileSync(CSV_FILE, csvRows.join("\n"), "utf-8");
  console.log(`Updated CSV at: ${CSV_FILE}`);

  // Build Markdown SYSTEM_CREDENTIALS.md
  let md = `# TopGrade CRM — Official Parent & Student Credential Directory & Access Control Guide

> **System Version:** 2026.3 • **Database Engine:** Supabase PostgreSQL + Auth  
> **Total Active Students:** ${students.length}  
> **Total Registered Parent Accounts:** 129 (Personal PNG Emails & @parents.topgrade.edu Portal Logins)  
> **Status:** Live & Synchronized

---

## 1. Security & RBAC Isolation Policies

### 🔒 Parent Role Isolation (\`PARENT\`)
1. **Child Privacy:** When a parent logs in, they **strictly and solely see their own children** linked by family name, phone number, and verified email address. Under no circumstances can a parent view or access records of another family's child.
2. **Course Syllabus Isolation:**
   - **Parent Dashboard:** Displays exclusively the courses enrolled by their child(ren).
   - **Courses & Curriculum Page (\`/courses\`):** Enforces a strict filter where only the specific course streams selected by their child(ren) are visible. All other school courses in the general catalog are hidden.
3. **Multi-Child Families:** Parents with multiple enrolled children (e.g., *Dhara Desai* with *Dhyana* and *Aarshiv*; *Lani Mercado* with *Kiron* and *Cara*; *Florence Buaku* with *Isabelle* and *Julia*) can switch between their children seamlessly in the parent portal.
4. **Dual Guardians / Secondary Parents:** Secondary parents with separate contact entries (e.g., *Sandeep Duggal* for *Deven*, *Conner Kuzniar* for *Ethan*, *Ulaysha Gibbs* for *Ulaysha*, *Vondeah Grant* for *Brooke*) can log in using their own credentials and access their family's child dossier and courses.

### 🎓 Student Role Isolation (\`STUDENT\`)
1. **Student Login Identifier:** Students can authenticate using either their official **Student Code** (e.g., \`TG-STU-2026-5001\`) or their student email (e.g., \`jacob.5001@student.topgrade.edu\`).
2. **Profile & Performance:** Students have view-only access to their own attendance, timetable schedule, academic reports, and syllabus.
3. **Course Curriculum:** Under \`/courses\`, students see **only their enrolled course stream(s)**.

---

## 2. Authentication Standards

| Role | Username / Login Identifier | Password | Access Rights |
| :--- | :--- | :--- | :--- |
| **Parent** | Personal Email from PNG *(e.g. \`tanyeafowls@yahoo.com\`)* **OR** Portal Email *(e.g. \`parent.tanyea.fowls.5001@parents.topgrade.edu\`)* | \`${DEFAULT_PARENT_PASS}\` | View linked children, child timetable, child course curriculum, fees, attendance |
| **Student** | Student Code *(e.g. \`TG-STU-2026-5001\`)* **OR** Student Email *(e.g. \`jacob.5001@student.topgrade.edu\`)* | \`${DEFAULT_STUDENT_PASS}\` | View self dossier, enrolled course syllabus, weekly timetable, attendance |

---

## 3. Master Parent & Student Credential Directory (${students.length} Records)

| # | Student ID | Student Name | Grade & School | Selected Course | Student Login Email | Parent Name & Phone | Parent Login Email (PNG / Personal) | Parent Portal Email |
| :- | :--- | :--- | :--- | :--- | :--- | :--- | :--- | :--- |
`;

  students.forEach((s, idx) => {
    const pEmails = s.parentEmails || [];
    const personalEmail = pEmails.find(e => !e.includes("@parents.topgrade.edu") && !e.includes("@student.topgrade.edu")) || "—";
    const portalEmail = pEmails.find(e => e.includes("@parents.topgrade.edu")) || "—";
    const gradeSchool = `${s.grade || "Grade 10"} • ${s.school || "Sablatura"}`;

    md += `| **${idx + 1}** | \`${s.studentCode}\` | **${s.fullName}** | ${gradeSchool} | \`${s.program || "General"}\` | \`${s.email}\` | ${s.fatherName} (${s.primaryMobile || "—"}) | \`${personalEmail}\` | \`${portalEmail}\` |\n`;
  });

  md += `
---

## 4. Secondary Parent / Dual-Guardian Accounts (Linked Families)

The following secondary parents and guardians share phone numbers or family ties with enrolled students and have dedicated login credentials to view their child's dossier and course tracks:

| # | Guardian Name | Login Email | Password | Phone | Linked Child | Child Student ID | Enrolled Course |
| :- | :--- | :--- | :--- | :--- | :--- | :--- | :--- |
`;

  Object.values(secondaryParentFamilies).forEach((sec, idx) => {
    md += `| **${idx + 1}** | **${sec.name}** | \`${sec.email}\` | \`${DEFAULT_PARENT_PASS}\` | ${sec.phone} | **${sec.childName}** | \`${sec.childCode}\` | \`${sec.course}\` |\n`;
  });

  md += `
---

## 5. Course Tracks & Normalized Catalog Mapping

Below is the cross-reference between PNG course names and TopGrade CRM catalog courses:

| PNG Course Name | Enrolled TopGrade Course Stream | Catalog Course Code | Category |
| :--- | :--- | :--- | :--- |
| **Reading Comp** | Reading Comprehension | \`CRS-REA-101\` | Language Arts & Reading |
| **Reading** | Reading Foundations / Comprehension | \`CRS-REA-101\` | Language Arts & Reading |
| **Afterschool** | After School Program | \`CRS-AFT-101\` | General Enrichment |
| **STAAR / STAAR prep** | STAAR Prep (Math & Reading) | \`CRS-STR-101\` | Test Preparation |
| **Math & Reading** | Math & Reading Foundations | \`CRS-MR-101\` | Academic Core |
| **Summer camp & Math, writing, reading tutoring** | Summer Camp & Academic Tutoring | \`CRS-SMP-101\` | Summer & Camps |
| **Writing skills / Writing** | Writing Skills & Handwriting | \`CRS-WRT-101\` | Language Arts & Reading |
| **AP Physics** | AP Physics 1 & C | \`CRS-APP-101\` | Advanced Placement (AP) |
| **Geometry** | High School Geometry Honors | \`CRS-GEO-101\` | High School Mathematics |
| **Summer camp** | Summer Camp & Academic Tutoring | \`CRS-SMP-101\` | Summer & Camps |
| **College Essay workshop** | College Essay Workshop & Writing | \`CRS-CEW-101\` | College Counseling |
| **SAT prep / SAT prep, College Essay** | SAT Prep & College Essay Workshop | \`CRS-SAT-101\`, \`CRS-CEW-101\` | Test Preparation |
| **GT prep/ Math & Reading** | GT Prep (Gifted & Talented) | \`CRS-GTP-101\`, \`CRS-MR-101\` | Accelerated & GT |
| **PAP Spanish** | PAP Spanish | \`CRS-SPN-101\` | World Languages |
| **AP Chem , SAT prep** | AP Chemistry & SAT Prep | \`CRS-APC-101\`, \`CRS-SAT-101\` | AP & Test Prep |
| **Hindi** | Hindi Language | \`CRS-HIN-101\` | World Languages |
| **Alge 1** | Algebra 1 & PAP Algebra 2 | \`CRS-ALG-101\` | Mathematics |
| **TSI prep** | TSI Prep | \`CRS-TSI-101\` | College Readiness |
| **ESL** | ESL (English as a Second Language) | \`CRS-ESL-101\` | Language Acquisition |

---

## 6. How Parents and Students Log In

1. Open the TopGrade CRM login screen.
2. **For Parents:**
   - Enter your personal email (e.g., \`tanyeafowls@yahoo.com\`) or your portal email (\`parent.tanyea.fowls.5001@parents.topgrade.edu\`).
   - Enter password: \`${DEFAULT_PARENT_PASS}\`.
   - Result: You will see your child's profile on the Parent Dashboard, and under the **Courses** tab you will only see their selected course stream (*Reading Comprehension*).
3. **For Students:**
   - Enter your Student Code (e.g., \`TG-STU-2026-5001\`) or your student email (\`jacob.5001@student.topgrade.edu\`).
   - Enter password: \`${DEFAULT_STUDENT_PASS}\`.
   - Result: You will see your own profile and enrolled course syllabus.

---
*Generated automatically by TopGrade CRM Enrollment & RBAC Synchronizer.*
`;

  fs.writeFileSync(MD_FILE, md, "utf-8");
  console.log(`Updated Markdown at: ${MD_FILE}`);
}

main().catch(err => {
  console.error("Error generating master credential files:", err);
  process.exit(1);
});
