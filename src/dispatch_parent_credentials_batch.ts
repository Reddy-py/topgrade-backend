import dotenv from "dotenv";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import nodemailer from "nodemailer";

dotenv.config();

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const DATA_DIR = path.join(__dirname, "../data");
const LOG_FILE = path.join(DATA_DIR, "automated_emails_log.json");
const STUDENTS_DB_FILE = path.join(DATA_DIR, "students_db.json");

// Configure Gmail SMTP Transporter
const gmailUser = process.env.GMAIL_USER || process.env.GMAIL_SENDER_EMAIL || "tglbiz101@gmail.com";
const gmailPass = process.env.GMAIL_APP_PASSWORD || "";

if (!gmailUser || !gmailPass) {
  console.error("Missing GMAIL_USER or GMAIL_APP_PASSWORD in environment.");
  process.exit(1);
}

const transporter = nodemailer.createTransport({
  service: "gmail",
  auth: {
    user: gmailUser,
    pass: gmailPass
  }
});

// Full list of 59 parent emails from the user's image
const emailsFromImage = [
  "tanyeafowls@yahoo.com",
  "missyou1970@yahoo.com",
  "gdulce955@gmail.com",
  "guilloryea@gmail.com",
  "esperanzagarciaovalle@gmail.com",
  "lani.garrido@gmail.com",
  "annasjan@gmail.com",
  "chad8404@gmail.com",
  "yosyaranda18@gmail.com",
  "conner.skuzniar@gmail.com",
  "nloan969@gmail.com",
  "tuhuynh0046@gmail.com",
  "megul41@gmail.com",
  "selenademps@hotmail.com",
  "qunisha.starks1@gmail.com",
  "deeutley@gmail.com",
  "minnybhatty@gmail.com",
  "pmots@yahoo.com",
  "cmotwani10@gmail.com",
  "nair.rekha11@gmail.com",
  "n_pilotte@yahoo.com",
  "umanutritionist@gmail.com",
  "barbarajaycacho@yahoo.com",
  "alexisszielinski@gmail.com",
  "marisol.maldonado96@icloud.com",
  "pabloymili2023@gmail.com",
  "chanthavorng@icloud.com",
  "dhara.6n@gmail.com",
  "rashmi.esq@gmail.com",
  "duggaljd14@gmail.com",
  "duggalmd@aol.com",
  "anvita512@gmail.com",
  "nwadhwa78@gmail.com",
  "kimmonscare@gmail.com",
  "kaushalya.amunugama@gmail.com",
  "monpara@gmail.com",
  "mykix3@gmail.com",
  "smayala79@yahoo.com",
  "gayathri.sathiamoorthy@gmail.com",
  "shiva90@gmail.com",
  "chaitu900@gmail.com",
  "ggrantl@renewedstrength.biz",
  "vondeahgrant@yahoo.com",
  "o.elizabeth@icloud.com",
  "ulayshagibbs@gmail.com",
  "carterae2020@gmail.com",
  "flossied@gmail.com",
  "jcothorn@gmail.com",
  "gerijosie@yahoo.com",
  "soosanmathai@yahoo.com",
  "lakeshiamorgan880@gmail.com", // Normalized domain for lakeshiamorgan880
  "chardaeevans1@gmail.com",
  "brindha.biotek@gmail.com",
  "annieb@cgsfs.com",
  "ke.li@outlook.com",
  "wesdmurdock@hotmail.com",
  "rosieflopez@yahoo.com",
  "ftfern24@yahoo.com",
  "elizabethannrodwell@gmail.com"
];

// Helper delay to avoid SMTP rate limiting
const delay = (ms: number) => new Promise(res => setTimeout(res, ms));

function buildParentCredentialHtml(params: {
  parentName: string;
  parentEmail: string;
  children: Array<{ name: string; code: string; grade?: string; school?: string; course?: string }>;
  loginUrl: string;
}): string {
  const childrenRows = params.children
    .map(
      c => `
      <tr style="border-bottom: 1px solid #e2e8f0;">
        <td style="padding: 10px 14px; font-weight: 700; color: #0d1c2f;">${c.name}</td>
        <td style="padding: 10px 14px; font-family: monospace; font-weight: 800; color: #004ac6;">${c.code}</td>
        <td style="padding: 10px 14px; color: #434655;">${c.grade || "General"}</td>
        <td style="padding: 10px 14px; color: #166534; font-weight: 600;">${c.course || "Academic Curriculum"}</td>
      </tr>
    `
    )
    .join("");

  return `
    <!DOCTYPE html>
    <html>
    <head>
      <meta charset="utf-8">
      <style>
        body { font-family: 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif; background-color: #f4f6fb; margin: 0; padding: 20px; color: #0d1c2f; }
        .container { max-width: 600px; margin: 0 auto; background: #ffffff; border-radius: 16px; overflow: hidden; box-shadow: 0 10px 25px rgba(0,0,0,0.06); border: 1px solid #e2e8f0; }
        .header { background: linear-gradient(135deg, #004ac6 0%, #1e40af 100%); padding: 30px 20px; text-align: center; color: #ffffff; }
        .header h1 { margin: 0; font-size: 22px; font-weight: 900; letter-spacing: 0.5px; }
        .header p { margin: 6px 0 0 0; font-size: 12px; opacity: 0.9; font-weight: 600; text-transform: uppercase; letter-spacing: 1px; }
        .content { padding: 30px 25px; line-height: 1.6; font-size: 14px; color: #334155; }
        .badge { display: inline-block; background: #e0e7ff; color: #3730a3; padding: 4px 12px; border-radius: 9999px; font-size: 11px; font-weight: 700; text-transform: uppercase; margin-bottom: 15px; }
        .cred-card { background: #f8fafc; border: 2px solid #004ac6; border-radius: 12px; padding: 18px 20px; margin: 20px 0; }
        .cred-row { display: flex; justify-content: space-between; padding: 6px 0; border-bottom: 1px dashed #cbd5e1; font-size: 13.5px; }
        .cred-row:last-child { border-bottom: none; }
        .cred-label { font-weight: 700; color: #64748b; }
        .cred-val { font-weight: 900; color: #0d1c2f; }
        .btn-container { text-align: center; margin: 25px 0 15px 0; }
        .btn { display: inline-block; background: #004ac6; color: #ffffff !important; padding: 13px 32px; text-decoration: none; border-radius: 12px; font-weight: 800; font-size: 14px; box-shadow: 0 4px 15px rgba(0,74,198,0.3); }
        .security-box { background: #f0fdf4; border-left: 4px solid #16a34a; padding: 12px 16px; border-radius: 6px; font-size: 12px; color: #166534; margin: 20px 0; }
        .footer { background: #f8fafc; border-top: 1px solid #e2e8f0; padding: 20px; text-align: center; font-size: 11px; color: #64748b; }
      </style>
    </head>
    <body>
      <div class="container">
        <div class="header">
          <h1>🎓 Top Grade Learning</h1>
          <p>Official Parent Portal Access Credentials</p>
        </div>
        <div class="content">
          <span class="badge">Official Parent Account</span>
          <p style="margin-top:0;">Dear <strong>${params.parentName}</strong>,</p>
          <p>Welcome to <strong>Top Grade Learning</strong>! Your dedicated Parent Portal account is active and ready for secure login. As part of our privacy isolation architecture, your login grants you direct visibility exclusively into your child's academic journey.</p>

          <div class="cred-card">
            <h3 style="margin: 0 0 12px 0; font-size: 14px; color: #004ac6; text-transform: uppercase; letter-spacing: 0.5px;">🔑 Your Sign-In Credentials</h3>
            <table style="width: 100%; font-size: 13px;">
              <tr>
                <td style="padding: 5px 0; color: #64748b; font-weight: 600;">Parent Login Email:</td>
                <td style="padding: 5px 0; font-weight: 800; color: #004ac6; text-align: right; font-family: monospace;">${params.parentEmail}</td>
              </tr>
              <tr>
                <td style="padding: 5px 0; color: #64748b; font-weight: 600;">Default Password:</td>
                <td style="padding: 5px 0; font-weight: 900; color: #0d1c2f; text-align: right; font-family: monospace;">Parent@TopGrade2026</td>
              </tr>
              <tr>
                <td style="padding: 5px 0; color: #64748b; font-weight: 600;">Portal Access Role:</td>
                <td style="padding: 5px 0; font-weight: 800; color: #16a34a; text-align: right;">PARENT</td>
              </tr>
            </table>
          </div>

          <h4 style="margin: 20px 0 8px 0; font-size: 13px; color: #0d1c2f;">👨‍🎓 Linked Student Dossier(s):</h4>
          <table style="width: 100%; border-collapse: collapse; margin-bottom: 20px; font-size: 12px; border: 1px solid #e2e8f0; border-radius: 8px; overflow: hidden;">
            <thead>
              <tr style="background: #f8fafc; color: #64748b; font-size: 11px; text-transform: uppercase;">
                <th style="padding: 8px 14px; text-align: left;">Student Name</th>
                <th style="padding: 8px 14px; text-align: left;">Student ID</th>
                <th style="padding: 8px 14px; text-align: left;">Grade</th>
                <th style="padding: 8px 14px; text-align: left;">Course Track</th>
              </tr>
            </thead>
            <tbody>
              ${childrenRows}
            </tbody>
          </table>

          <div class="btn-container">
            <a href="${params.loginUrl}" class="btn">Sign In to Parent Portal &rarr;</a>
          </div>

          <div class="security-box">
            <strong>🔒 Security &amp; Features:</strong>
            <ul style="margin: 5px 0 0 0; padding-left: 18px; font-size: 12px;">
              <li>Real-time attendance tracking and 1:1 prepaid hour token balances.</li>
              <li>View assigned weekly schedules, faculty instructors, and classroom locations.</li>
              <li>You may update your password at any time in the portal profile settings.</li>
            </ul>
          </div>

          <p style="font-size: 12px; color: #64748b; margin-top: 25px;">
            If you have any questions or require assistance, please reply directly to this email or contact us at <a href="mailto:tglbiz101@gmail.com" style="color: #004ac6; text-decoration: none;">tglbiz101@gmail.com</a>.
          </p>
          <p style="margin-top: 15px; font-weight: bold; color: #004ac6;">
            Warmest Regards,<br/>
            <strong>Top Grade Learning Administration</strong>
          </p>
        </div>
        <div class="footer">
          <p>&copy; ${new Date().getFullYear()} Top Grade Learning CRM. All rights reserved.</p>
        </div>
      </div>
    </body>
    </html>
  `;
}

async function main() {
  console.log("================================================================================");
  console.log("       TOPGRADE CRM: BATCH DISPATCH OF AUTOMATED PARENT CREDENTIALS             ");
  console.log("================================================================================\n");

  // Load students_db.json
  let studentsDb: any[] = [];
  if (fs.existsSync(STUDENTS_DB_FILE)) {
    studentsDb = JSON.parse(fs.readFileSync(STUDENTS_DB_FILE, "utf-8"));
  }

  // Load existing log file
  let emailLogs: any[] = [];
  if (fs.existsSync(LOG_FILE)) {
    emailLogs = JSON.parse(fs.readFileSync(LOG_FILE, "utf-8"));
  }

  // Deduplicate emails from image
  const uniqueEmails = Array.from(new Set(emailsFromImage.map(e => e.toLowerCase().trim())));
  console.log(`Prepared ${uniqueEmails.length} unique parent emails for automated credential dispatch.\n`);

  const loginUrl = (process.env.FRONTEND_URL || "http://localhost:5174").replace(/\/$/, "") + "/login";

  let successCount = 0;
  let failureCount = 0;
  const failureList: string[] = [];

  for (let i = 0; i < uniqueEmails.length; i++) {
    const parentEmail = uniqueEmails[i]!;
    
    // Find all linked students in studentsDb
    const linkedStudents = studentsDb.filter((s: any) => {
      const pEmails = (s.parentEmails || []).map((e: string) => e.toLowerCase().trim());
      const sEmails = (s.studentEmails || []).map((e: string) => e.toLowerCase().trim());
      const rawEmail = (s.email || "").toLowerCase().trim();
      return pEmails.includes(parentEmail) || sEmails.includes(parentEmail) || rawEmail === parentEmail;
    });

    const parentName = linkedStudents[0]?.fatherName || linkedStudents[0]?.motherName || linkedStudents[0]?.guardianName || "Parent / Guardian";
    const childrenData = linkedStudents.map((s: any) => ({
      name: s.fullName || "Student",
      code: s.studentCode || s.id,
      grade: s.grade || "General",
      school: s.school || "Top Grade Academy",
      course: (s.allocatedCourses && s.allocatedCourses[0]?.courseName) || s.program || "Academic Course Track"
    }));

    // If no student found (e.g. secondary parent mapped by family), provide general family reference
    if (childrenData.length === 0) {
      childrenData.push({
        name: "Enrolled Student",
        code: "TopGrade-2026",
        grade: "Academic Program",
        school: "Top Grade Academy",
        course: "Official Curriculum"
      });
    }

    const studentNamesList = childrenData.map((c: any) => c.name).join(", ");
    const subject = `🔑 TopGrade CRM — Parent Portal Access Credentials for ${studentNamesList}`;
    const html = buildParentCredentialHtml({
      parentName,
      parentEmail,
      children: childrenData,
      loginUrl
    });

    console.log(`[${i + 1}/${uniqueEmails.length}] Dispatching credentials to: ${parentEmail} (Student: ${studentNamesList})...`);

    try {
      await transporter.sendMail({
        from: `"Top Grade Learning" <${gmailUser}>`,
        to: parentEmail,
        subject,
        html
      });

      console.log(`  ✓ SUCCESS: Email delivered to ${parentEmail}`);
      successCount++;

      // Log in automated_emails_log.json
      emailLogs.push({
        studentId: childrenData[0]?.code || "parent-login",
        studentCode: childrenData[0]?.code || "parent-login",
        type: "PARENT_CREDENTIALS",
        dateSent: new Date().toISOString().split("T")[0],
        year: new Date().getFullYear(),
        recipientEmails: [parentEmail]
      });

      // Small delay between emails
      await delay(400);
    } catch (err: any) {
      console.error(`  ✗ FAILED: ${parentEmail} - ${err.message}`);
      failureCount++;
      failureList.push(`${parentEmail} (${err.message})`);
      await delay(800);
    }
  }

  // Save updated logs
  fs.writeFileSync(LOG_FILE, JSON.stringify(emailLogs, null, 2), "utf-8");

  console.log("\n================================================================================");
  console.log(`DISPATCH COMPLETED:`);
  console.log(`• Successfully Dispatched: ${successCount} emails`);
  console.log(`• Failed: ${failureCount} emails`);
  if (failureList.length > 0) {
    console.log(`• Failures:`, failureList);
  }
  console.log("================================================================================\n");
}

main();
