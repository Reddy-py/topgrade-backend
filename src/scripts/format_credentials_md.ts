import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

async function formatMarkdown() {
  const jsonPath = path.resolve(__dirname, "../../all_credentials_export.json");
  const raw = fs.readFileSync(jsonPath, "utf-8");
  const data = JSON.parse(raw);

  let md = `# TopGrade CRM — System Login Credentials Directory

> **System Instance**: TopGrade CRM Local Development & Staging  
> **Login URL**: [http://localhost:5174/login](http://localhost:5174/login) (or [http://localhost:5173/login](http://localhost:5173/login) / [https://topgrade-vert.vercel.app/login](https://topgrade-vert.vercel.app/login))  
> **Authentication Service**: Supabase Auth (Active)  
> **Accounts Listed**: **1 Administrator** | **18 Faculty & Demo Teachers** | **${data.students.length} Students** | **${data.parents.length} Parents**  

---

## 🔑 Standard Default Passwords Summary

| Role | Standard Default Password | Notes |
| :--- | :--- | :--- |
| **Administrator** | \`TopGrade2026!\` | Full access to settings, user rosters, schedules, billing & reconciliation |
| **Teachers** | \`TopGrade@2026!\` | Faculty access to schedules, classes, student roster & roll call |
| **Students** | \`Student@TopGrade2026\` | Student access to courses, class times, attendance & homework |
| **Parents** | \`Parent@TopGrade2026\` | Parent portal access to their children, tokens, attendance & schedules |
| **Demo Accounts** | \`TopGrade2026!\` / \`TopGradeDemo2026!\` | Pre-configured test accounts |

---

## 1. System Administrator Login

| Role | Name | Login Email | Password | Access Portal |
| :--- | :--- | :--- | :--- | :--- |
| **ADMIN** | System Administrator | \`admin@topgrade.edu\` | \`TopGrade2026!\` | [Login Portal](http://localhost:5174/login) |

---

## 2. Faculty Teachers (18 Accounts)

| # | Code | Teacher Name | Login Email | Password | Phone | Specialization / Campus |
| :-: | :--- | :--- | :--- | :--- | :--- | :--- |
`;

  data.teachers.forEach((t: any) => {
    md += `| ${t.sl} | **${t.code}** | **${t.name}** | \`${t.email}\` | \`${t.password}\` | ${t.phone} | ${t.specialization} (${t.city || 'Texas'}) |\n`;
  });

  md += `\n---\n\n## 3. Students (${data.students.length} Enrolled Accounts)\n\n`;
  md += `| # | Student ID | Student Name | Login Email | Password | Phone | Program / Grade |\n`;
  md += `| :-: | :--- | :--- | :--- | :--- | :--- | :--- |\n`;

  data.students.forEach((s: any) => {
    md += `| ${s.sl} | **${s.studentId}** | **${s.name}** | \`${s.email}\` | \`${s.password}\` | ${s.phone} | ${s.program} (${s.grade}) |\n`;
  });

  md += `\n---\n\n## 4. Parents (${data.parents.length} Active Accounts)\n\n`;
  md += `| # | Parent Name | Login Email | Password | Phone | Status |\n`;
  md += `| :-: | :--- | :--- | :--- | :--- | :--- |\n`;

  data.parents.forEach((p: any) => {
    md += `| ${p.sl} | **${p.name}** | \`${p.email}\` | \`${p.password}\` | ${p.phone} | ${p.status} |\n`;
  });

  const rootMd = path.resolve(__dirname, "../../../CREDENTIALS_DIRECTORY.md");
  fs.writeFileSync(rootMd, md, "utf-8");
  console.log(`Wrote formatted directory to ${rootMd}`);
}

formatMarkdown().catch(console.error);
