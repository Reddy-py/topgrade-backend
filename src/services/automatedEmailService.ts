import { dispatchMultiChannelNotification } from "./notificationService.js";
import { inMemoryStudentStore } from "./studentService.js";
import type { StudentDossier } from "./studentService.js";
import { supabaseAdmin } from "../supabase.js";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const DATA_DIR = path.join(__dirname, "../../data");
const SENT_EMAILS_LOG_FILE = path.join(DATA_DIR, "automated_emails_log.json");

interface AutomatedEmailLog {
  studentId: string;
  studentCode: string;
  type: "BIRTHDAY" | "EXAM_GOOD_LUCK";
  dateSent: string; // YYYY-MM-DD
  year: number;
  recipientEmails: string[];
}

let sentLogs: AutomatedEmailLog[] = [];

function loadSentLogs(): AutomatedEmailLog[] {
  try {
    if (fs.existsSync(SENT_EMAILS_LOG_FILE)) {
      return JSON.parse(fs.readFileSync(SENT_EMAILS_LOG_FILE, "utf-8"));
    }
  } catch (err) {
    console.warn("Notice reading automated_emails_log.json:", err);
  }
  return [];
}

function saveSentLogs() {
  try {
    if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
    fs.writeFileSync(SENT_EMAILS_LOG_FILE, JSON.stringify(sentLogs, null, 2), "utf-8");
  } catch (err) {
    console.warn("Notice saving automated_emails_log.json:", err);
  }
}

sentLogs = loadSentLogs();

/**
 * Builds HTML template for Birthday greetings from Top Grade Learning
 */
function buildBirthdayHtml(studentName: string): string {
  return `
    <div style="font-family: 'Segoe UI', Tahoma, sans-serif; background: #fdf2f8; padding: 25px; border-radius: 18px; border: 2px solid #f472b6;">
      <div style="text-align: center; margin-bottom: 20px;">
        <span style="font-size: 48px;">🎂 🎈 🎁</span>
        <h1 style="color: #be185d; margin: 10px 0 5px 0; font-size: 26px;">Happy Birthday, ${studentName}!</h1>
        <p style="color: #9d174d; font-weight: 700; text-transform: uppercase; letter-spacing: 1px; font-size: 12px; margin: 0;">A Special Wish From Top Grade Learning</p>
      </div>
      <div style="background: #ffffff; padding: 25px; border-radius: 14px; box-shadow: 0 4px 15px rgba(0,0,0,0.05); color: #334155; line-height: 1.7; font-size: 14px;">
        <p>Dear <strong>${studentName}</strong> and Family,</p>
        <p>On this very special day, your entire faculty and the leadership team at <strong>Top Grade Learning</strong> wish you the happiest of birthdays! 🌟</p>
        <p>May your year ahead be filled with curiosity, continuous learning, exciting milestones, and outstanding achievements in all your academic endeavors.</p>
        <div style="margin: 20px 0; padding: 16px; background: #fdf4ff; border-left: 4px solid #d946ef; border-radius: 8px; font-style: italic; color: #701a75;">
          "The future belongs to those who believe in the beauty of their dreams." — Keep shining bright and reaching for the stars!
        </div>
        <p>Enjoy your special celebration with family and friends!</p>
        <p style="margin-top: 25px; font-weight: bold; color: #004ac6;">
          Warmest Regards,<br/>
          <strong>Top Grade Learning Team</strong><br/>
          <span style="font-size: 12px; color: #64748b; font-weight: normal;">topgradelearning101@gmail.com</span>
        </p>
      </div>
    </div>
  `;
}

/**
 * Builds HTML template for Exam Good Luck greetings
 */
function buildExamGoodLuckHtml(studentName: string, examDate: string, courseName?: string): string {
  return `
    <div style="font-family: 'Segoe UI', Tahoma, sans-serif; background: #eff6ff; padding: 25px; border-radius: 18px; border: 2px solid #60a5fa;">
      <div style="text-align: center; margin-bottom: 20px;">
        <span style="font-size: 48px;">🌟 🍀 📚</span>
        <h1 style="color: #1d4ed8; margin: 10px 0 5px 0; font-size: 26px;">Best of Luck on Your Exam, ${studentName}!</h1>
        <p style="color: #1e40af; font-weight: 700; text-transform: uppercase; letter-spacing: 1px; font-size: 12px; margin: 0;">Scheduled Exam Date: ${examDate}</p>
      </div>
      <div style="background: #ffffff; padding: 25px; border-radius: 14px; box-shadow: 0 4px 15px rgba(0,0,0,0.05); color: #334155; line-height: 1.7; font-size: 14px;">
        <p>Dear <strong>${studentName}</strong> and Family,</p>
        <p>We want to wish you the very best of luck on your upcoming examination ${courseName ? `for <strong>${courseName}</strong>` : ""} scheduled on <strong>${examDate}</strong>!</p>
        <p>You have worked hard, mastered the material, and prepared diligently with your faculty tutors. Walk in with full confidence knowing that your preparation will carry you through.</p>
        
        <div style="margin: 20px 0; padding: 18px; background: #f0fdf4; border-left: 4px solid #22c55e; border-radius: 8px; color: #166534;">
          <strong>🎯 Quick Exam Day Success Tips:</strong>
          <ul style="margin: 8px 0 0 0; padding-left: 20px; font-size: 13px;">
            <li>Get a solid night's rest beforehand to keep your mind sharp and refreshed.</li>
            <li>Read each question thoroughly before beginning your answer.</li>
            <li>Pace yourself, stay calm, and trust in your preparation.</li>
          </ul>
        </div>

        <p>We are cheering for your success every step of the way!</p>
        <p style="margin-top: 25px; font-weight: bold; color: #004ac6;">
          Believe in Yourself & Good Luck,<br/>
          <strong>Your Faculty & Top Grade Learning Team</strong><br/>
          <span style="font-size: 12px; color: #64748b; font-weight: normal;">topgradelearning101@gmail.com</span>
        </p>
      </div>
    </div>
  `;
}

/**
 * Dispatches an automated birthday email to student and parents
 */
export async function sendBirthdayGreetings(student: StudentDossier): Promise<boolean> {
  const currentYear = new Date().getFullYear();
  const todayStr: string = new Date().toISOString().split("T")[0] || "";
  const recipientEmails = [
    ...(student.studentEmails || []),
    student.email,
    ...(student.parentEmails || [])
  ].filter(Boolean) as string[];

  const uniqueRecipients = Array.from(new Set(recipientEmails.map(e => e.trim().toLowerCase())));
  if (uniqueRecipients.length === 0) return false;

  const recipients = uniqueRecipients.map(e => ({
    role: "STUDENT" as const,
    email: e,
    name: student.fullName,
    phone: student.primaryMobile || ""
  }));

  try {
    await dispatchMultiChannelNotification({
      eventType: "ADMISSION_APPROVED",
      subject: `🎂 Happy Birthday, ${student.fullName}! Best Wishes from Top Grade Learning 🎉`,
      message: buildBirthdayHtml(student.fullName),
      recipients
    });

    sentLogs.push({
      studentId: student.id || student.studentCode || "",
      studentCode: student.studentCode || "",
      type: "BIRTHDAY",
      dateSent: todayStr,
      year: currentYear,
      recipientEmails: uniqueRecipients
    });
    saveSentLogs();
    return true;
  } catch (err: any) {
    console.error(`Failed to dispatch birthday email for ${student.fullName}:`, err.message);
    return false;
  }
}

/**
 * Dispatches an automated exam good luck email to student and parents
 */
export async function sendExamGoodLuckWishes(student: StudentDossier, examDate: string): Promise<boolean> {
  const todayStr: string = new Date().toISOString().split("T")[0] || "";
  const recipientEmails = [
    ...(student.studentEmails || []),
    student.email,
    ...(student.parentEmails || [])
  ].filter(Boolean) as string[];

  const uniqueRecipients = Array.from(new Set(recipientEmails.map(e => e.trim().toLowerCase())));
  if (uniqueRecipients.length === 0) return false;

  const recipients = uniqueRecipients.map(e => ({
    role: "STUDENT" as const,
    email: e,
    name: student.fullName,
    phone: student.primaryMobile || ""
  }));

  try {
    await dispatchMultiChannelNotification({
      eventType: "ADMISSION_APPROVED",
      subject: `🌟 Best of Luck on Your Exam, ${student.fullName}! — Top Grade Learning 🍀`,
      message: buildExamGoodLuckHtml(student.fullName, examDate, student.program),
      recipients
    });

    sentLogs.push({
      studentId: student.id || student.studentCode || "",
      studentCode: student.studentCode || "",
      type: "EXAM_GOOD_LUCK",
      dateSent: todayStr,
      year: new Date().getFullYear(),
      recipientEmails: uniqueRecipients
    });
    saveSentLogs();
    return true;
  } catch (err: any) {
    console.error(`Failed to dispatch exam good luck email for ${student.fullName}:`, err.message);
    return false;
  }
}

/**
 * Scans all student records to trigger automated Birthday and Exam Good Luck greetings
 */
export async function runAutomatedEmailScan(): Promise<{ birthdaysSent: number; examWishesSent: number; details: string[] }> {
  const today = new Date();
  const currentMonth = today.getMonth() + 1; // 1-12
  const currentDay = today.getDate(); // 1-31
  const todayDateStr: string = today.toISOString().split("T")[0] || "";
  const currentYear = today.getFullYear();

  let birthdaysSent = 0;
  let examWishesSent = 0;
  const details: string[] = [];

  // Iterate over inMemoryStudentStore
  for (const student of inMemoryStudentStore) {
    const studentIdentifier = student.id || student.studentCode;
    if (!studentIdentifier) continue;

    // 1. Birthday Check
    if (student.dob) {
      try {
        const dobParts = student.dob.split("-");
        if (dobParts.length === 3 && dobParts[1] && dobParts[2]) {
          const dobMonth = parseInt(dobParts[1], 10);
          const dobDay = parseInt(dobParts[2], 10);

          if (dobMonth === currentMonth && dobDay === currentDay) {
            // Check if already sent this year
            const alreadySent = sentLogs.some(
              l => (l.studentId === studentIdentifier || l.studentCode === student.studentCode) &&
                   l.type === "BIRTHDAY" &&
                   l.year === currentYear
            );

            if (!alreadySent) {
              const ok = await sendBirthdayGreetings(student);
              if (ok) {
                birthdaysSent++;
                details.push(`🎂 Birthday email sent to ${student.fullName} (${student.studentCode})`);
              }
            }
          }
        }
      } catch (e) {}
    }

    // 2. Exam Date Check
    const examDate = student.examDate || (student as any).exam_date;
    if (examDate) {
      try {
        // If exam is today or in the next 1-2 days
        const examDt = new Date(examDate);
        if (!isNaN(examDt.getTime())) {
          const diffDays = Math.ceil((examDt.getTime() - today.getTime()) / (1000 * 60 * 60 * 24));
          // If exam is today (0) or tomorrow (1) or in 2 days
          if (diffDays >= 0 && diffDays <= 2) {
            const alreadySent = sentLogs.some(
              l => (l.studentId === studentIdentifier || l.studentCode === student.studentCode) &&
                   l.type === "EXAM_GOOD_LUCK" &&
                   l.dateSent === todayDateStr
            );

            if (!alreadySent) {
              const ok = await sendExamGoodLuckWishes(student, examDate);
              if (ok) {
                examWishesSent++;
                details.push(`🍀 Exam Good Luck email sent to ${student.fullName} for exam on ${examDate}`);
              }
            }
          }
        }
      } catch (e) {}
    }
  }

  return { birthdaysSent, examWishesSent, details };
}

// Set automated daily check
let scanInterval: NodeJS.Timeout | null = null;
export function initializeAutomatedEmailScheduler() {
  if (scanInterval) clearInterval(scanInterval);

  console.log("⏰ Automated Birthday & Exam Email Scanner initialized (Checking every 12 hours)...");
  // Run once on startup after 5 seconds delay
  setTimeout(() => {
    runAutomatedEmailScan().catch(err => console.warn("Initial automated email scan notice:", err));
  }, 5000);

  // Check every 12 hours
  scanInterval = setInterval(() => {
    runAutomatedEmailScan().catch(err => console.warn("Automated email scan interval notice:", err));
  }, 12 * 60 * 60 * 1000);
}
