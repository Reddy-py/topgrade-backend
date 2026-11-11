import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { createClient } from '@supabase/supabase-js';
import dotenv from 'dotenv';
import { execSync } from 'child_process';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
dotenv.config({ path: path.resolve(__dirname, '../.env') });

const exportPath = path.resolve(__dirname, '../all_credentials_export.json');
const rawExport = JSON.parse(fs.readFileSync(exportPath, 'utf8'));

const supabaseUrl = process.env.SUPABASE_URL || '';
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY || '';
const supabase = createClient(supabaseUrl, serviceKey);

async function main() {
  console.log('Fetching active profiles from Supabase...');
  const { data: profiles, error } = await supabase
    .from('profiles')
    .select('id, email, full_name, role, status');

  if (error) {
    console.warn('Could not fetch profiles:', error.message);
  }

  const profileMap = new Map();
  (profiles || []).forEach(p => {
    if (p.email) {
      profileMap.set(p.email.toLowerCase(), p);
    }
  });

  // 1. Process Admins
  const admins = [
    {
      name: 'System Administrator',
      email: 'admin@topgrade.edu',
      password: 'TopGrade2026!',
      role: 'ADMIN',
      status: 'Active',
      notes: 'Primary Master Admin Account'
    },
    {
      name: 'TGL Business Administration',
      email: 'tglbiz101@gmail.com',
      password: 'TopGrade2026!',
      role: 'ADMIN',
      status: 'Active',
      notes: 'Executive Admin & Owner Account'
    }
  ];

  // 2. Process Teachers
  const teachers = (rawExport.teachers || []).map((t: any) => {
    const prof = profileMap.get(t.email.toLowerCase());
    return {
      code: t.code || 'N/A',
      name: t.name || 'Faculty Member',
      email: t.email,
      password: t.password || 'TopGrade@2026!',
      phone: t.phone || 'N/A',
      specialization: t.specialization || 'General Faculty',
      status: prof?.status || 'Active'
    };
  });

  // 3. Process Students
  // Ensure we include dedicated test student + imported active students
  const studentList: any[] = [];
  studentList.push({
    id: 'TG-TEST-STUDENT',
    name: 'Rahul Kumar (Demo Student)',
    email: 'student@topgrade.edu',
    password: 'TopGrade2026!',
    program: 'Demo Academic Track',
    status: 'Active',
    notes: 'Primary Demo Student'
  });
  studentList.push({
    id: 'TG-TEST-SIVA',
    name: 'Siva Reddy (Tester)',
    email: 'sivareddy683970@gmail.com',
    password: 'TopGrade2026!',
    program: 'QA & Testing Track',
    status: 'Active',
    notes: 'Verified QA Student'
  });

  (rawExport.students || []).forEach((s: any) => {
    if (s.email === 'student@topgrade.edu' || s.email === 'accountant@topgrade.edu') return;
    const prof = profileMap.get(s.email?.toLowerCase());
    studentList.push({
      id: s.studentId || 'TG-STU',
      name: s.name || 'Enrolled Student',
      email: s.email,
      password: s.password || 'Student@TopGrade2026',
      program: s.program || 'General Academic Track',
      grade: s.grade || 'N/A',
      status: prof?.status || 'Active',
      notes: 'Imported Enrolled Student'
    });
  });

  // 4. Process Parents
  const parentList: any[] = [];
  (rawExport.parents || []).forEach((p: any) => {
    const prof = profileMap.get(p.email?.toLowerCase());
    parentList.push({
      name: p.name || 'Parent / Guardian',
      email: p.email,
      phone: p.phone || 'N/A',
      password: p.password || 'Parent@TopGrade2026',
      status: prof?.status || 'Active'
    });
  });

  console.log(`Consolidated: ${admins.length} Admins, ${teachers.length} Teachers, ${studentList.length} Students, ${parentList.length} Parents`);

  // Build Markdown Document
  let md = `# TopGrade Learning CRM — Master Credentials Directory\n\n`;
  md += `**Live Production Portal:** [https://topgrade-vert.vercel.app/login](https://topgrade-vert.vercel.app/login)\n\n`;
  md += `**Backend Engine:** Railway Production (${process.env.SUPABASE_URL || 'Supabase Connected'})\n\n`;
  md += `*Generated: ${new Date().toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' })}*\n\n`;
  md += `> **Security Notice:** This confidential document contains active login credentials across all portal roles. Store in a secure vault and share only with authorized personnel.\n\n`;
  md += `---\n\n`;

  // MD Admin Table
  md += `## 1. Institutional Administrator Accounts (${admins.length})\n\n`;
  md += `| Role | Full Name | Email / Login Identifier | Password | Status | Notes |\n`;
  md += `| :--- | :--- | :--- | :--- | :--- | :--- |\n`;
  admins.forEach(a => {
    md += `| \`${a.role}\` | **${a.name}** | \`${a.email}\` | \`${a.password}\` | ${a.status} | ${a.notes} |\n`;
  });
  md += `\n---\n\n`;

  // MD Teacher Table
  md += `## 2. Faculty & Teacher Accounts (${teachers.length})\n\n`;
  md += `| Faculty Code | Teacher Name | Email / Login ID | Password | Phone | Specialization | Status |\n`;
  md += `| :--- | :--- | :--- | :--- | :--- | :--- | :--- |\n`;
  teachers.forEach(t => {
    md += `| \`${t.code}\` | **${t.name}** | \`${t.email}\` | \`${t.password}\` | ${t.phone} | ${t.specialization} | ${t.status} |\n`;
  });
  md += `\n---\n\n`;

  // MD Student Table
  md += `## 3. Enrolled Student Accounts (${studentList.length})\n\n`;
  md += `| Student ID | Student Name | Email / Login ID | Password | Program / Course | Status |\n`;
  md += `| :--- | :--- | :--- | :--- | :--- | :--- |\n`;
  studentList.forEach(s => {
    md += `| \`${s.id}\` | **${s.name}** | \`${s.email}\` | \`${s.password}\` | ${s.program} | ${s.status} |\n`;
  });
  md += `\n---\n\n`;

  // MD Parent Table
  md += `## 4. Parent & Guardian Accounts (${parentList.length})\n\n`;
  md += `| Parent Name | Email / Login ID | Phone Number | Password | Status |\n`;
  md += `| :--- | :--- | :--- | :--- | :--- |\n`;
  parentList.forEach(p => {
    md += `| **${p.name}** | \`${p.email}\` | ${p.phone} | \`${p.password}\` | ${p.status} |\n`;
  });

  const mdPath = path.resolve(__dirname, '../../TOPGRADE_MASTER_CREDENTIALS.md');
  fs.writeFileSync(mdPath, md, 'utf8');
  console.log(`Markdown saved to: ${mdPath}`);

  // Build HTML Document with Professional Executive Styling for PDF Conversion
  const html = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <title>TopGrade Learning CRM — Master Credentials Directory</title>
  <style>
    @page {
      size: A4;
      margin: 1.5cm 1.2cm 1.5cm 1.2cm;
      @bottom-right {
        content: counter(page);
      }
    }
    * {
      box-sizing: border-box;
      -webkit-print-color-adjust: exact;
      print-color-adjust: exact;
    }
    body {
      font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif;
      color: #1e293b;
      background-color: #ffffff;
      line-height: 1.45;
      font-size: 11px;
      margin: 0;
      padding: 24px;
    }
    .header {
      border-bottom: 3px solid #2563eb;
      padding-bottom: 16px;
      margin-bottom: 24px;
      display: flex;
      justify-content: space-between;
      align-items: flex-end;
    }
    .title {
      font-size: 24px;
      font-weight: 800;
      color: #1e3a8a;
      margin: 0 0 6px 0;
    }
    .subtitle {
      font-size: 13px;
      color: #64748b;
      margin: 0;
    }
    .badge {
      display: inline-block;
      padding: 3px 8px;
      border-radius: 4px;
      font-size: 10px;
      font-weight: 700;
      text-transform: uppercase;
      letter-spacing: 0.5px;
    }
    .badge-confidential {
      background-color: #fef2f2;
      color: #991b1b;
      border: 1px solid #fecaca;
    }
    .badge-active {
      background-color: #ecfdf5;
      color: #065f46;
    }
    .badge-role {
      background-color: #eff6ff;
      color: #1e40af;
      font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace;
    }
    .meta-box {
      background-color: #f8fafc;
      border: 1px solid #e2e8f0;
      border-radius: 8px;
      padding: 12px 16px;
      margin-bottom: 24px;
      display: grid;
      grid-template-columns: repeat(3, 1fr);
      gap: 12px;
    }
    .meta-item strong {
      display: block;
      color: #475569;
      font-size: 10px;
      text-transform: uppercase;
      letter-spacing: 0.5px;
      margin-bottom: 2px;
    }
    .meta-item span {
      font-size: 12px;
      font-weight: 600;
      color: #0f172a;
    }
    h2 {
      font-size: 15px;
      font-weight: 700;
      color: #0f172a;
      margin: 28px 0 10px 0;
      padding-bottom: 6px;
      border-bottom: 1.5px solid #e2e8f0;
      page-break-after: avoid;
    }
    table {
      width: 100%;
      border-collapse: collapse;
      margin-bottom: 20px;
      font-size: 10.5px;
      page-break-inside: auto;
    }
    tr {
      page-break-inside: avoid;
      page-break-after: auto;
    }
    thead {
      display: table-header-group;
    }
    th {
      background-color: #f1f5f9;
      color: #334155;
      font-weight: 700;
      text-align: left;
      padding: 6px 8px;
      border-top: 1px solid #cbd5e1;
      border-bottom: 2px solid #cbd5e1;
      font-size: 10px;
      text-transform: uppercase;
      letter-spacing: 0.3px;
    }
    td {
      padding: 5px 8px;
      border-bottom: 1px solid #e2e8f0;
      vertical-align: middle;
    }
    tr:nth-child(even) td {
      background-color: #f8fafc;
    }
    .code {
      font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace;
      background-color: #f1f5f9;
      padding: 2px 4px;
      border-radius: 3px;
      font-size: 10px;
      color: #0f172a;
    }
    .password-field {
      font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace;
      color: #b91c1c;
      font-weight: 600;
      background-color: #fff1f2;
      padding: 2px 6px;
      border-radius: 3px;
      border: 1px solid #ffe4e6;
    }
    .footer {
      margin-top: 32px;
      padding-top: 12px;
      border-top: 1px solid #e2e8f0;
      font-size: 9.5px;
      color: #94a3b8;
      text-align: center;
    }
    .page-break {
      page-break-before: always;
    }
  </style>
</head>
<body>

  <div class="header">
    <div>
      <h1 class="title">TopGrade Learning CRM</h1>
      <p class="subtitle">Unified Master Credentials Directory & Access Provisioning Guide</p>
    </div>
    <div>
      <span class="badge badge-confidential">Confidential & Proprietary</span>
    </div>
  </div>

  <div class="meta-box">
    <div class="meta-item">
      <strong>Production Portal URL</strong>
      <span><a href="https://topgrade-vert.vercel.app/login" style="color: #2563eb; text-decoration: none;">topgrade-vert.vercel.app/login</a></span>
    </div>
    <div class="meta-item">
      <strong>Active Directory Total</strong>
      <span>${admins.length + teachers.length + studentList.length + parentList.length} User Accounts</span>
    </div>
    <div class="meta-item">
      <strong>Export Timestamp</strong>
      <span>${new Date().toLocaleString('en-US', { dateStyle: 'medium', timeStyle: 'short' })}</span>
    </div>
  </div>

  <h2>1. Institutional Administrator Accounts (${admins.length})</h2>
  <table>
    <thead>
      <tr>
        <th style="width: 12%;">Role</th>
        <th style="width: 25%;">Full Name</th>
        <th style="width: 33%;">Login Email / Identifier</th>
        <th style="width: 18%;">Security Password</th>
        <th style="width: 12%;">Status</th>
      </tr>
    </thead>
    <tbody>
      ${admins.map(a => `
        <tr>
          <td><span class="badge badge-role">${a.role}</span></td>
          <td><strong>${a.name}</strong></td>
          <td><span class="code">${a.email}</span></td>
          <td><span class="password-field">${a.password}</span></td>
          <td><span class="badge badge-active">${a.status}</span></td>
        </tr>
      `).join('')}
    </tbody>
  </table>

  <h2>2. Faculty & Teacher Accounts (${teachers.length})</h2>
  <table>
    <thead>
      <tr>
        <th style="width: 14%;">Faculty Code</th>
        <th style="width: 24%;">Instructor Name</th>
        <th style="width: 32%;">Login Email</th>
        <th style="width: 18%;">Security Password</th>
        <th style="width: 12%;">Status</th>
      </tr>
    </thead>
    <tbody>
      ${teachers.map(t => `
        <tr>
          <td><span class="code">${t.code}</span></td>
          <td><strong>${t.name}</strong></td>
          <td><span class="code">${t.email}</span></td>
          <td><span class="password-field">${t.password}</span></td>
          <td><span class="badge badge-active">${t.status}</span></td>
        </tr>
      `).join('')}
    </tbody>
  </table>

  <div class="page-break"></div>

  <h2>3. Enrolled Student Accounts (${studentList.length})</h2>
  <table>
    <thead>
      <tr>
        <th style="width: 18%;">Student Code / ID</th>
        <th style="width: 24%;">Student Name</th>
        <th style="width: 30%;">Login Email</th>
        <th style="width: 18%;">Security Password</th>
        <th style="width: 10%;">Status</th>
      </tr>
    </thead>
    <tbody>
      ${studentList.map(s => `
        <tr>
          <td><span class="code">${s.id}</span></td>
          <td><strong>${s.name}</strong></td>
          <td><span class="code">${s.email}</span></td>
          <td><span class="password-field">${s.password}</span></td>
          <td><span class="badge badge-active">${s.status}</span></td>
        </tr>
      `).join('')}
    </tbody>
  </table>

  <div class="page-break"></div>

  <h2>4. Parent & Guardian Accounts (${parentList.length})</h2>
  <table>
    <thead>
      <tr>
        <th style="width: 22%;">Parent Name</th>
        <th style="width: 36%;">Login Email</th>
        <th style="width: 16%;">Registered Phone</th>
        <th style="width: 16%;">Security Password</th>
        <th style="width: 10%;">Status</th>
      </tr>
    </thead>
    <tbody>
      ${parentList.map(p => `
        <tr>
          <td><strong>${p.name}</strong></td>
          <td><span class="code">${p.email}</span></td>
          <td>${p.phone}</td>
          <td><span class="password-field">${p.password}</span></td>
          <td><span class="badge badge-active">${p.status}</span></td>
        </tr>
      `).join('')}
    </tbody>
  </table>

  <div class="footer">
    TopGrade Learning CRM &copy; ${new Date().getFullYear()} &bull; Strictly Confidential Document &bull; For Authorized Administrative Use Only
  </div>

</body>
</html>`;

  const htmlPath = path.resolve(__dirname, '../../TOPGRADE_MASTER_CREDENTIALS.html');
  fs.writeFileSync(htmlPath, html, 'utf8');
  console.log(`HTML saved to: ${htmlPath}`);

  // Convert HTML to PDF using Chrome or Edge Headless
  const pdfPath = path.resolve(__dirname, '../../TOPGRADE_MASTER_CREDENTIALS.pdf');
  const browserPaths = [
    'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
    'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe'
  ];

  let converted = false;
  for (const b of browserPaths) {
    if (fs.existsSync(b)) {
      try {
        console.log(`Rendering PDF using: ${b}...`);
        const cmd = `"${b}" --headless --disable-gpu --no-pdf-header-footer --print-to-pdf="${pdfPath}" "${htmlPath}"`;
        execSync(cmd, { stdio: 'inherit' });
        converted = true;
        console.log(`SUCCESS: PDF generated at: ${pdfPath}`);
        break;
      } catch (e: any) {
        console.warn(`Browser conversion error with ${b}:`, e.message);
      }
    }
  }

  if (!converted) {
    console.warn('Could not render PDF directly via headless browser. HTML and MD formats are ready.');
  }
}

main().catch(console.error);
