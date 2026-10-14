import { dispatchMultiChannelNotification, escapeHtml } from "./notificationService.js";
import { inMemoryStudentStore, getStudentsService } from "./studentService.js";
import type { StudentDossier } from "./studentService.js";
import { supabaseAdmin } from "../supabase.js";
import { claimEmail, finishEmail, logEmail, listEmailLog, statusFromDispatch } from "./emailLog.js";
import { instituteNow, instituteTimezone, isBirthdayToday } from "./instituteTime.js";
import { studentContactEmails, studentOwnEmails } from "./studentNotices.js";

// The log of what was sent lives in the Supabase table email_log (see migration 20261012_email_log.sql).
// Nothing is kept on disk, so a restart, a redeploy or a second server can never repeat a birthday wish.

/**
 * Builds HTML template for Birthday greetings from Top Grade Learning
 */
function buildBirthdayHtml(studentName: string): string {
  studentName = escapeHtml(studentName);
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
          <span style="font-size: 12px; color: #64748b; font-weight: normal;">tglbiz101@gmail.com</span>
        </p>
      </div>
    </div>
  `;
}

/**
 * Builds HTML template for Exam Good Luck greetings
 */
function buildExamGoodLuckHtml(studentName: string, examDate: string, courseName?: string): string {
  studentName = escapeHtml(studentName);
  examDate = escapeHtml(examDate);
  courseName = courseName ? escapeHtml(courseName) : courseName;
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
          <span style="font-size: 12px; color: #64748b; font-weight: normal;">tglbiz101@gmail.com</span>
        </p>
      </div>
    </div>
  `;
}

function buildExamScheduledHtml(studentName: string, examDate: string, courseName: string): string {
  studentName = escapeHtml(studentName);
  examDate = escapeHtml(examDate);
  courseName = escapeHtml(courseName);
  return `
    <div style="font-family: 'Segoe UI', Tahoma, sans-serif; background: #f0fdf4; padding: 25px; border-radius: 18px; border: 2px solid #22c55e;">
      <div style="text-align: center; margin-bottom: 20px;">
        <span style="font-size: 48px;">📅 📝 🎓</span>
        <h1 style="color: #15803d; margin: 10px 0 5px 0; font-size: 26px;">Exam Date Scheduled: ${courseName}</h1>
        <p style="color: #166534; font-weight: 700; text-transform: uppercase; letter-spacing: 1px; font-size: 12px; margin: 0;">Official Academic Notification</p>
      </div>
      <div style="background: #ffffff; padding: 25px; border-radius: 14px; box-shadow: 0 4px 15px rgba(0,0,0,0.05); color: #334155; line-height: 1.7; font-size: 14px;">
        <p>Dear <strong>${studentName}</strong> and Family,</p>
        <p>This is an official academic notice from <strong>Top Grade Learning</strong> that your examination for <strong>${courseName}</strong> has been officially scheduled:</p>
        <div style="margin: 20px 0; padding: 18px; background: #f0fdf4; border-left: 4px solid #16a34a; border-radius: 8px; font-size: 16px; font-weight: bold; color: #14532d;">
          🗓️ Official Exam Date: ${examDate}
        </div>
        <p>Please review your course materials, attend your weekly practice slots, and reach out to your faculty instructor if you have any questions or require additional support.</p>
        <p style="margin-top: 25px; font-weight: bold; color: #004ac6;">
          Sincerely,<br/>
          <strong>Top Grade Learning Administration</strong><br/>
          <span style="font-size: 12px; color: #64748b; font-weight: normal;">tglbiz101@gmail.com</span>
        </p>
      </div>
    </div>
  `;
}

/**
 * Dispatches an automated exam schedule notice to student and parents
 */
export async function sendCourseExamNotification(student: StudentDossier, examDate: string, courseName: string): Promise<boolean> {
  const recipientEmails = [
    ...(student.studentEmails || []),
    student.email,
    ...(student.parentEmails || [])
  ].filter(Boolean) as string[];

  const uniqueRecipients = Array.from(new Set(recipientEmails.map(e => e.trim().toLowerCase())));
  if (uniqueRecipients.length === 0) return false;

  const recipients: any[] = uniqueRecipients.map(e => ({
    role: "STUDENT",
    email: e,
    name: student.fullName,
    phone: student.primaryMobile || ""
  }));

  const adminEmail = (process.env.ADMIN_EMAIL || process.env.GMAIL_USER || "tglbiz101@gmail.com").trim().toLowerCase();
  if (adminEmail && !uniqueRecipients.includes(adminEmail)) {
    recipients.push({
      role: "ADMIN",
      email: adminEmail,
      name: "System Administrator",
      phone: ""
    });
  }

  try {
    await dispatchMultiChannelNotification({
      eventType: "ADMISSION_APPROVED" as any,
      subject: `📅 Exam Date Scheduled: ${courseName} on ${examDate} — Top Grade Learning`,
      message: buildExamScheduledHtml(student.fullName, examDate, courseName),
      recipients
    });
    return true;
  } catch (err: any) {
    console.error(`Failed to send exam notification email for ${student.fullName}:`, err.message);
    return false;
  }
}

/**
 * Birthday wish. Goes to the student's email; if the student has none, to the parent email(s).
 * Sent at most once per student per day (checked in the email_log table). force = admin pressed "send now".
 * Returns true when the email went out (or was simulated because Gmail is not configured).
 */
export async function sendBirthdayGreetings(student: StudentDossier, opts: { force?: boolean } = {}): Promise<boolean> {
  const to = studentContactEmails(student);
  const key = student.id || student.studentCode || "";
  if (to.length === 0 || !key) return false;

  const { dateStr } = instituteNow();
  const subject = `🎂 Happy Birthday, ${student.fullName}! Best Wishes from Top Grade Learning 🎉`;

  let claimId: string | null = null;
  if (!opts.force) {
    claimId = await claimEmail("BIRTHDAY", key, dateStr, to, subject);
    if (!claimId) return false; // already sent (or being sent) today
  }

  try {
    const own = new Set(studentOwnEmails(student));
    const result = await dispatchMultiChannelNotification({
      eventType: "ADMISSION_APPROVED",
      subject,
      message: buildBirthdayHtml(student.fullName),
      recipients: to.map(e => ({
        role: (own.has(e) ? "STUDENT" : "PARENT") as "STUDENT" | "PARENT",
        email: e,
        name: own.has(e) ? student.fullName : `Parent of ${student.fullName}`,
        phone: "",
      })),
    });
    const status = statusFromDispatch(result);
    const err = result.failures.join("; ") || undefined;
    if (claimId) await finishEmail(claimId, status, err);
    else await logEmail("BIRTHDAY", key, dateStr, to, subject, status, err);
    return status !== "failed";
  } catch (err: any) {
    if (claimId) await finishEmail(claimId, "failed", err?.message);
    console.error(`Failed to dispatch birthday email for ${student.fullName}:`, err?.message);
    return false;
  }
}

/**
 * Dispatches an automated exam good luck email to student and parents. Once per student per day.
 */
export async function sendExamGoodLuckWishes(student: StudentDossier, examDate: string): Promise<boolean> {
  const { dateStr } = instituteNow();
  const key = student.id || student.studentCode || "";
  const recipientEmails = [
    ...(student.studentEmails || []),
    student.email,
    ...(student.parentEmails || [])
  ].filter(Boolean) as string[];

  const uniqueRecipients = Array.from(new Set(recipientEmails.map(e => e.trim().toLowerCase())));
  if (uniqueRecipients.length === 0 || !key) return false;

  const recipients: Array<{ role: any; email: string; name: string; phone: string }> = uniqueRecipients.map(e => ({
    role: "STUDENT" as const,
    email: e,
    name: student.fullName,
    phone: student.primaryMobile || ""
  }));

  const adminEmail = (process.env.ADMIN_EMAIL || process.env.GMAIL_USER || "tglbiz101@gmail.com").trim().toLowerCase();
  if (adminEmail && !uniqueRecipients.includes(adminEmail)) {
    recipients.push({ role: "ADMIN", email: adminEmail, name: "System Administrator", phone: "" });
  }

  const subject = `🌟 Best of Luck on Your Exam, ${student.fullName}! — Top Grade Learning 🍀`;
  const claimId = await claimEmail("EXAM_GOOD_LUCK", key, dateStr, uniqueRecipients, subject);
  if (!claimId) return false;

  try {
    const result = await dispatchMultiChannelNotification({
      eventType: "ADMISSION_APPROVED",
      subject,
      message: buildExamGoodLuckHtml(student.fullName, examDate, student.program),
      recipients
    });
    const status = statusFromDispatch(result);
    await finishEmail(claimId, status, result.failures.join("; ") || undefined);
    return status !== "failed";
  } catch (err: any) {
    await finishEmail(claimId, "failed", err?.message);
    console.error(`Failed to dispatch exam good luck email for ${student.fullName}:`, err?.message);
    return false;
  }
}

export function parseDobMonthAndDay(dobStr?: string): { month: number; day: number } | null {
  if (!dobStr || typeof dobStr !== "string") return null;
  const clean = dobStr.trim();
  if (!clean) return null;

  // 1. Try YYYY-MM-DD or YYYY/MM/DD
  const isoMatch = clean.match(/^(\d{4})[-/](\d{1,2})[-/](\d{1,2})/);
  if (isoMatch && isoMatch[2] && isoMatch[3]) {
    const month = parseInt(isoMatch[2], 10);
    const day = parseInt(isoMatch[3], 10);
    if (month >= 1 && month <= 12 && day >= 1 && day <= 31) {
      return { month, day };
    }
  }

  // 2. Try MM/DD/YYYY or MM-DD-YYYY
  const usMatch = clean.match(/^(\d{1,2})[-/](\d{1,2})[-/](\d{4})/);
  if (usMatch && usMatch[1] && usMatch[2]) {
    const month = parseInt(usMatch[1], 10);
    const day = parseInt(usMatch[2], 10);
    if (month >= 1 && month <= 12 && day >= 1 && day <= 31) {
      return { month, day };
    }
  }

  // 3. Fallback: JS Date parsing
  const parsed = new Date(clean);
  if (!isNaN(parsed.getTime())) {
    return { month: parsed.getUTCMonth() + 1, day: parsed.getUTCDate() };
  }

  return null;
}

/**
 * Builds HTML template for Teacher Birthday greetings
 */
function buildTeacherBirthdayHtml(teacherName: string): string {
  teacherName = escapeHtml(teacherName);
  return `
    <div style="font-family: 'Segoe UI', Tahoma, sans-serif; background: #f0fdf4; padding: 25px; border-radius: 18px; border: 2px solid #4ade80;">
      <div style="text-align: center; margin-bottom: 20px;">
        <span style="font-size: 48px;">🎉 🎂 💐</span>
        <h1 style="color: #15803d; margin: 10px 0 5px 0; font-size: 26px;">Happy Birthday, ${teacherName}!</h1>
        <p style="color: #166534; font-weight: 700; text-transform: uppercase; letter-spacing: 1px; font-size: 12px; margin: 0;">Warmest Wishes from the Top Grade Learning Family</p>
      </div>
      <div style="background: #ffffff; padding: 25px; border-radius: 14px; box-shadow: 0 4px 15px rgba(0,0,0,0.05); color: #334155; line-height: 1.7; font-size: 14px;">
        <p>Dear <strong>${teacherName}</strong>,</p>
        <p>Today, all of us at <strong>Top Grade Learning</strong> celebrate you! 🌟 Thank you for your tireless dedication, passion for education, and the extraordinary inspiration you bring to your students each and every day.</p>
        <p>May this new year of your life bring you abundant happiness, health, fulfillment, and great success in all your personal and professional endeavors.</p>
        <div style="margin: 20px 0; padding: 16px; background: #f0fdf4; border-left: 4px solid #22c55e; border-radius: 8px; font-style: italic; color: #14532d;">
          "A great teacher inspires hope, ignites the imagination, and instills a love of learning." — We are honored to have you on our team!
        </div>
        <p>Enjoy your special day to the fullest!</p>
        <p style="margin-top: 25px; font-weight: bold; color: #004ac6;">
          With Deep Gratitude & Warm Regards,<br/>
          <strong>Top Grade Learning Leadership Team</strong><br/>
          <span style="font-size: 12px; color: #64748b; font-weight: normal;">tglbiz101@gmail.com</span>
        </p>
      </div>
    </div>
  `;
}

/**
 * Dispatches an automated birthday email to a teacher. Once per teacher per day.
 */
export async function sendTeacherBirthdayGreetings(teacher: { id: string; name: string; email: string; phone?: string }): Promise<boolean> {
  if (!teacher.email || !teacher.id) return false;
  const { dateStr } = instituteNow();
  const subject = `🎂 Happy Birthday, ${teacher.name}! Warmest Wishes from Top Grade Learning 🎉`;
  const claimId = await claimEmail("TEACHER_BIRTHDAY", teacher.id, dateStr, [teacher.email], subject);
  if (!claimId) return false;

  try {
    const result = await dispatchMultiChannelNotification({
      eventType: "ADMISSION_APPROVED",
      subject,
      message: buildTeacherBirthdayHtml(teacher.name),
      recipients: [{ role: "TEACHER", email: teacher.email, name: teacher.name, phone: teacher.phone || "" }]
    });
    const status = statusFromDispatch(result);
    await finishEmail(claimId, status, result.failures.join("; ") || undefined);
    return status !== "failed";
  } catch (err: any) {
    await finishEmail(claimId, "failed", err?.message);
    console.error(`Failed to dispatch teacher birthday email for ${teacher.name}:`, err?.message);
    return false;
  }
}

/** Recent automatic emails (birthdays, exam wishes, student added / updated), newest first. */
export async function getBirthdayLogs() {
  const rows = await listEmailLog(500);
  return rows.map(r => ({
    studentId: r.subject_key,
    type: r.kind,
    dateSent: r.send_date,
    year: Number(String(r.send_date).slice(0, 4)),
    recipientEmails: r.recipients,
    status: r.status,
    error: r.error,
    subject: r.subject,
    createdAt: r.created_at,
  }));
}

/**
 * Scans active students and teachers and sends the automatic emails that are due today in the institute's time zone:
 *  - birthdays (to the student's email, or the parent's if the student has none)
 *  - exam good-luck wishes (exam within 2 days)
 * Wishes go out from BIRTHDAY_SEND_HOUR (default 7) local time. Safe to run as often as you like:
 * the email_log table guarantees one email per person per day.
 */
export async function runAutomatedEmailScan(
  opts: { ignoreSendHour?: boolean } = {}
): Promise<{ birthdaysSent: number; examWishesSent: number; details: string[] }> {
  const now = instituteNow();
  const sendHour = Number(process.env.BIRTHDAY_SEND_HOUR ?? 7);
  const details: string[] = [];
  let birthdaysSent = 0;
  let examWishesSent = 0;

  if (!opts.ignoreSendHour && now.hour < sendHour) {
    details.push(`Waiting until ${sendHour}:00 (${instituteTimezone()}) to send today's wishes.`);
    return { birthdaysSent, examWishesSent, details };
  }

  // Always read the latest students from Supabase.
  await getStudentsService({
    refresh: true, page: 1, limit: 100000, status: "ALL", grade: "ALL",
    currentUser: { id: "system", email: "", role: "ADMIN" },
  });

  for (const student of [...inMemoryStudentStore]) {
    if ((student.status || "").toUpperCase() !== "ACTIVE") continue;

    // A. Birthday
    const dob = parseDobMonthAndDay(student.dob);
    if (dob && isBirthdayToday(dob, now)) {
      try {
        if (await sendBirthdayGreetings(student)) {
          birthdaysSent++;
          details.push(`🎂 Birthday email sent for ${student.fullName} (${student.studentCode}) to ${studentContactEmails(student).join(", ")}`);
        }
      } catch (e: any) {
        details.push(`⚠️ Birthday for ${student.fullName} could not be processed: ${e?.message}`);
      }
    }

    // B. Exam good luck
    if (student.examDate) {
      const examDt = new Date(student.examDate);
      if (!isNaN(examDt.getTime())) {
        const diffDays = Math.ceil((examDt.getTime() - Date.now()) / (1000 * 60 * 60 * 24));
        if (diffDays >= 0 && diffDays <= 2) {
          try {
            if (await sendExamGoodLuckWishes(student, student.examDate)) {
              examWishesSent++;
              details.push(`🍀 Exam good luck email sent for ${student.fullName} (exam ${student.examDate})`);
            }
          } catch (e: any) {
            details.push(`⚠️ Exam wishes for ${student.fullName} could not be processed: ${e?.message}`);
          }
        }
      }
    }
  }

  // Teachers' birthdays
  try {
    const { data: teachersData } = await supabaseAdmin.from("teachers").select("*");
    for (const t of (teachersData || []) as any[]) {
      const teacherDob = t.dob || t.date_of_birth || t.birth_date;
      const parsed = parseDobMonthAndDay(teacherDob);
      if (parsed && t.email && isBirthdayToday(parsed, now)) {
        if (await sendTeacherBirthdayGreetings({ id: t.id, name: t.name || "Faculty Member", email: t.email, phone: t.phone || "" })) {
          birthdaysSent++;
          details.push(`🎉 Birthday email sent to teacher ${t.name} (${t.email})`);
        }
      }
    }
  } catch (tErr: any) {
    console.warn("Notice scanning teacher birthdays:", tErr?.message);
  }

  return { birthdaysSent, examWishesSent, details };
}

// The scan runs every 30 minutes. It is safe to repeat: email_log allows one wish per person per day,
// and a restart simply continues. Nothing depends on how long the server has been running.
let scanInterval: NodeJS.Timeout | null = null;
export function initializeAutomatedEmailScheduler() {
  if (scanInterval) clearInterval(scanInterval);

  console.log(`⏰ Automated birthday & exam email scan started (every 30 minutes, institute time zone ${instituteTimezone()}, from ${Number(process.env.BIRTHDAY_SEND_HOUR ?? 7)}:00)...`);
  setTimeout(() => {
    runAutomatedEmailScan().catch(err => console.warn("Initial automated email scan notice:", err?.message));
  }, 15_000);

  scanInterval = setInterval(() => {
    runAutomatedEmailScan().catch(err => console.warn("Automated email scan notice:", err?.message));
  }, 30 * 60 * 1000);
}
