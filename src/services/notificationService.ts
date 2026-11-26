import nodemailer from "nodemailer";
import dotenv from "dotenv";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { getCachedInstituteSettings, getAdminNotificationEmails, emailFooter } from "./instituteSettingsService.js";
import { renderTemplate } from "./emailTemplateService.js";
import { logEmail, statusFromDispatch } from "./emailLog.js";
import { instituteToday } from "./instituteTime.js";
import { isPlaceholderEmail, isRealEmail } from "../constants/domains.js";
import { parseEnv } from "../utils/parseEnv.js";
export { emailFooter } from "./instituteSettingsService.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const backendEnvPath = path.resolve(__dirname, "../../.env");
dotenv.config({ path: backendEnvPath });
dotenv.config();

export interface NotificationPayload {
  escapeMessage?: boolean;
  recipients: Array<{
    role: "STUDENT" | "PARENT" | "TEACHER" | "ADMIN";
    email?: string;
    phone?: string;
    name?: string;
  }>;
  subject: string;
  message: string;
  smsMessage?: string;
  eventType: "ADMISSION_INQUIRY" | "ADMISSION_APPROVED" | "PAYMENT_COMPLETED" | "DE_ENROLLMENT_REQUESTED" | "DE_ENROLLMENT_APPROVED" | "ATTENDANCE_ALERT" | "TEACHER_ASSIGNMENT" | "PASSWORD_CHANGE_ALERT" | "PASSWORD_RESET_REQUEST";
  actionUrl?: string;
  unsubLink?: string;
  attachments?: Array<{
    filename: string;
    content: Buffer | string;
    contentType?: string;
  }> | undefined;
}

export function htmlToPlainText(html: string): string {
  return html
    .replace(/<style[^>]*>[\s\S]*?<\/style>/gi, "")
    .replace(/<script[^>]*>[\s\S]*?<\/script>/gi, "")
    .replace(/<br\s*[\/]?>/gi, "\n")
    .replace(/<\/p>/gi, "\n\n")
    .replace(/<\/div>/gi, "\n")
    .replace(/<\/h[1-6]>/gi, "\n\n")
    .replace(/<li>/gi, "• ")
    .replace(/<\/li>/gi, "\n")
    .replace(/<[^>]+>/g, "")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

let cachedTransporter: any = null;
let lastTransporterCreds = "";
let authRateLimitCooldownUntil = 0;

function getTransporter(): { transporter: any; gmailUser: string } {
  if (process.env.SIMULATE_EMAILS === "true" || process.env.NODE_ENV === "test" || process.env.SIMULATE_MAILER === "true") {
    return { transporter: null, gmailUser: "simulated-mailer@topgrade.edu" };
  }
  dotenv.config({ path: backendEnvPath });
  const gmailUser = (process.env.GMAIL_USER || process.env.GMAIL_SENDER_EMAIL || "tglbiz101@gmail.com").trim();
  const gmailPass = (process.env.GMAIL_APP_PASSWORD || "").trim();
  const cleanPass = gmailPass.replace(/\s+/g, "");

  if (authRateLimitCooldownUntil > Date.now()) {
    const waitSec = Math.round((authRateLimitCooldownUntil - Date.now()) / 1000);
    console.warn(`[NOTIFICATION] Google SMTP rate-limit cooldown active (${waitSec}s remaining). Pausing SMTP attempts so Google resets the lock.`);
    return { transporter: null, gmailUser };
  }

  if (gmailUser && cleanPass) {
    const credKey = `${gmailUser}:${cleanPass}`;
    if (cachedTransporter && lastTransporterCreds === credKey) {
      return { transporter: cachedTransporter, gmailUser };
    }

    try {
      cachedTransporter = nodemailer.createTransport({
        host: "smtp.gmail.com",
        port: 465,
        secure: true,
        auth: {
          user: gmailUser,
          pass: cleanPass,
        },
        connectionTimeout: 6000,
        greetingTimeout: 6000,
        socketTimeout: 8000,
      });
      lastTransporterCreds = credKey;
      return { transporter: cachedTransporter, gmailUser };
    } catch (err: any) {
      console.error("[NOTIFICATION] Failed to initialize Gmail transporter:", err?.message);
    }
  }
  console.warn(`[NOTIFICATION] Transporter offline: user=${gmailUser}, pass=${cleanPass ? 'PRESENT' : 'MISSING'}`);
  return { transporter: null, gmailUser };
}

/**
 * Builds responsive, modern HTML email templates tailored to Top Grade Learning branding
 */
export function escapeHtml(value: unknown): string {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

export function buildHtmlEmailTemplate(subject: string, message: string, role: string, recipientNameRaw: string, actionUrl?: string, plainText = false): string {
  const recipientName = escapeHtml(recipientNameRaw);
  if (plainText) message = escapeHtml(message).replace(/\n/g, "<br>");
  if (actionUrl) actionUrl = escapeHtml(actionUrl);
  return `
    <!DOCTYPE html>
    <html>
    <head>
      <meta charset="utf-8">
      <style>
        body { font-family: 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif; background-color: #f4f6fb; margin: 0; padding: 20px; color: #0d1c2f; }
        .container { max-width: 600px; margin: 0 auto; background: #ffffff; border-radius: 16px; overflow: hidden; box-shadow: 0 10px 25px rgba(0,0,0,0.05); border: 1px solid #e2e8f0; }
        .header { background: linear-gradient(135deg, #004ac6 0%, #1e40af 100%); padding: 30px 20px; text-align: center; color: #ffffff; }
        .header h1 { margin: 0; font-size: 22px; font-weight: 900; letter-spacing: 0.5px; }
        .header p { margin: 5px 0 0 0; font-size: 12px; opacity: 0.85; font-weight: 600; text-transform: uppercase; }
        .content { padding: 30px 25px; line-height: 1.6; font-size: 14px; color: #334155; }
        .badge { display: inline-block; background: #e0e7ff; color: #3730a3; padding: 4px 12px; border-radius: 9999px; font-size: 11px; font-weight: 700; text-transform: uppercase; margin-bottom: 15px; }
        .message-box { background: #f8fafc; border-left: 4px solid #004ac6; padding: 15px 20px; border-radius: 8px; margin: 20px 0; font-size: 13.5px; white-space: pre-line; }
        .btn-container { text-align: center; margin: 25px 0 10px 0; }
        .btn { display: inline-block; background: #004ac6; color: #ffffff !important; padding: 12px 28px; text-decoration: none; border-radius: 12px; font-weight: 700; font-size: 13px; shadow: 0 4px 12px rgba(0,74,198,0.3); }
        .footer { background: #f8fafc; border-top: 1px solid #e2e8f0; padding: 20px; text-align: center; font-size: 11px; color: #64748b; }
      </style>
    </head>
    <body>
      <div class="container">
        <div class="header">
          <h1>🎓 Top Grade Learning</h1>
          <p>Smart Tutoring Management Engine</p>
        </div>
        <div class="content">
          <span class="badge">Notification for ${role}</span>
          <p style="margin-top:0;">Hello <strong>${recipientName}</strong>,</p>
          <div class="message-box">
            ${message}
          </div>
          ${actionUrl ? `
            <div class="btn-container">
              <a href="${actionUrl}" class="btn">Take Action in Portal &rarr;</a>
            </div>
          ` : ''}
          <p style="font-size: 12px; color: #64748b; margin-top: 25px;">If you have any questions or need assistance, please reply directly to this email or contact your center administrator.</p>
        </div>
        <div class="footer">
          <div style="margin-bottom: 8px; font-weight: 600; color: #475569; font-size: 11px; line-height: 1.5;">
            ${escapeHtml(emailFooter()).replace(/\n/g, "<br>")}
          </div>
          <p>&copy; ${new Date().getFullYear()} ${escapeHtml(getCachedInstituteSettings().institute_name || "Top Grade Learning CRM")}. All rights reserved.</p>
        </div>
      </div>
    </body>
    </html>
  `;
}

/**
 * Central Multi-Channel Notification Dispatcher (Real Gmail SMTP + SMS Simulator)
 */
export interface DispatchResult {
  success: boolean;          // true only when no email failed
  dispatchedLogs: string[];
  sent: number;              // really delivered to Gmail
  failed: number;            // Gmail refused or was unreachable
  simulated: number;         // no Gmail configured (development)
  failures: string[];
}

export async function dispatchMultiChannelNotification(payload: NotificationPayload): Promise<DispatchResult> {
  const dispatchedLogs: string[] = [];
  let sent = 0;
  let failed = 0;
  let simulated = 0;
  const failures: string[] = [];
  const { transporter, gmailUser } = getTransporter();

  for (const recipient of payload.recipients) {
    let emailTarget = recipient.email;
    if (emailTarget && (emailTarget.toLowerCase() === "admin@topgrade.edu" || emailTarget.endsWith("@topgrade.edu"))) {
      emailTarget = parseEnv("ADMIN_EMAIL", "tglbiz101@gmail.com")!;
    } else if (isPlaceholderEmail(emailTarget)) {
      simulated++;
      dispatchedLogs.push(`[SIMULATED-PLACEHOLDER] Skipped dispatch to placeholder address ${recipient.email}`);
      continue;
    } else if (!emailTarget) {
      emailTarget = parseEnv("ADMIN_EMAIL", "tglbiz101@gmail.com")!;
    }

    const phoneTarget = recipient.phone || "+1 555 019 9999";
    const recipientName = recipient.name || recipient.role;

    // Real Gmail Send if Transporter configured
    if (transporter && emailTarget) {
      try {
        const senderAddress = process.env.GMAIL_SENDER_EMAIL || "tglbiz101@gmail.com";
        const isRawHtml = (payload.message || "").trim().startsWith("<");
        let htmlContent = isRawHtml ? payload.message : buildHtmlEmailTemplate(
          payload.subject,
          payload.message,
          recipient.role,
          recipientName,
          payload.actionUrl,
          payload.escapeMessage === true
        );

        if (isRawHtml) {
          const footerText = emailFooter();
          const cleanFooter = escapeHtml(footerText).replace(/\n/g, "<br>");
          if (!htmlContent.includes(cleanFooter) && !htmlContent.includes(footerText)) {
            htmlContent += `
              <div style="font-family: 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif; text-align: center; padding: 15px 20px; font-size: 11px; color: #64748b; border-top: 1px solid #e2e8f0; margin-top: 20px;">
                <p style="margin: 0; font-weight: 600; color: #475569;">${cleanFooter}</p>
                <p style="margin: 4px 0 0 0;">&copy; ${new Date().getFullYear()} ${escapeHtml(getCachedInstituteSettings().institute_name || "Top Grade Learning")}. All rights reserved.</p>
              </div>
            `;
          }
        }

        const mailHeaders: Record<string, string> = {};
        if (payload.unsubLink) {
          mailHeaders["List-Unsubscribe-Post"] = "List-Unsubscribe=One-Click";
          mailHeaders["List-Unsubscribe"] = `<${payload.unsubLink}>`;
        }

        const sendPromise = transporter.sendMail({
          from: `"${escapeHtml(getCachedInstituteSettings().institute_name || "Top Grade Learning")}" <${senderAddress}>`,
          replyTo: getCachedInstituteSettings().support_email || senderAddress,
          to: emailTarget,
          subject: payload.subject,
          text: htmlToPlainText(htmlContent),
          html: htmlContent,
          attachments: payload.attachments,
          headers: Object.keys(mailHeaders).length > 0 ? mailHeaders : undefined
        });

        const timeoutPromise = new Promise((_, reject) =>
          setTimeout(() => reject(new Error("SMTP socket timeout after 7 seconds")), 7000)
        );

        await Promise.race([sendPromise, timeoutPromise]);

        sent++;
        const liveLog = `✅ [REAL GMAIL SENT] To: ${recipient.role} <${emailTarget}> | Subject: "${payload.subject}"`;
        console.log(liveLog);
        dispatchedLogs.push(liveLog);
      } catch (err: any) {
        console.error(`❌ [GMAIL SMTP FAILURE] Could not send to ${emailTarget}:`, err.message);
        if (err.message?.includes("454") || err.message?.includes("Too many login attempts")) {
          authRateLimitCooldownUntil = Date.now() + 15 * 60 * 1000;
          console.warn(`[NOTIFICATION] Triggered 15-minute cooldown to allow Google SMTP authentication rate-limit to clear.`);
        }
        failed++;
        failures.push(`${emailTarget}: ${err.message}`);
        const fallbackLog = `⚠️ [GMAIL FAILED, NOT SENT] To: ${recipient.role} <${emailTarget}> | Subject: "${payload.subject}"`;
        console.log(fallbackLog);
        dispatchedLogs.push(fallbackLog);
      }
    } else {
      // Simulation Log
      simulated++;
      const emailLog = `📧 [SIMULATED EMAIL] Event: ${payload.eventType} | To: ${recipient.role} (${recipientName}) <${emailTarget}> | Subject: "${payload.subject}"`;
      console.log(emailLog);
      dispatchedLogs.push(emailLog);
    }

    // SMS Dispatch Log
    if (recipient.role === "PARENT" || recipient.role === "STUDENT" || recipient.phone) {
      const smsContent = payload.smsMessage || payload.message;
      const smsLog = `📱 [SMS SENT] Event: ${payload.eventType} | To: ${recipient.role} (${phoneTarget}) | Message: "${smsContent.substring(0, 120)}..."`;
      console.log(smsLog);
      dispatchedLogs.push(smsLog);
    }
  }

  return { success: failed === 0, dispatchedLogs, sent, failed, simulated, failures };
}

/**
 * Node 8: Class Schedule Confirmation Email to Parents
 */
export async function sendClassScheduleEmail(params: {
  parentEmail: string;
  studentName: string;
  courseName: string;
  dayOfWeek: string;
  timeSlot: string;
  room?: string;
  teacherName?: string;
  location?: string;
}): Promise<boolean> {
  const subject = `📅 Class Schedule Confirmed: ${params.courseName} (${params.dayOfWeek})`;
  const room = params.room || "Room 101";
  const teacher = params.teacherName || "Assigned Faculty";
  const location = params.location || "Top Grade Learning Main Campus";

  const message = `We are pleased to confirm that ${params.studentName} has been enrolled into the weekly class schedule for ${params.courseName}.\n\n` +
    `• Day: Every ${params.dayOfWeek}\n` +
    `• Time Slot: ${params.timeSlot}\n` +
    `• Classroom: ${room}\n` +
    `• Instructor: ${teacher}\n` +
    `• Location: ${location}\n\n` +
    `Please ensure ${params.studentName} arrives 5–10 minutes prior to session start.`;

  const result = await dispatchMultiChannelNotification({
    eventType: "ADMISSION_INQUIRY",
    subject,
    message,
    recipients: [
      {
        role: "PARENT",
        email: params.parentEmail,
        name: `Parent of ${params.studentName}`
      }
    ]
  });

  return result.success;
}

/**
 * Node 8: Daily Attendance Roll-Call Summary Email to Student & Parents (1-Click Notification)
 */
export async function sendDailyAttendanceRollCallEmail(params: {
  parentEmail?: string;
  studentEmail?: string | null;
  parentEmails?: string[];
  recipients?: Array<{ role: "STUDENT" | "PARENT"; email: string; name?: string }>;
  studentName: string;
  courseName: string;
  date: string;
  status: "PRESENT" | "ABSENT" | "EXCUSED" | string;
  remarks?: string;
  attendancePercentage?: number | string;
  markedBy?: string;
}): Promise<boolean> {
  const normStatus = params.status.toUpperCase();
  const statusEmoji = normStatus === "PRESENT" ? "✅" : normStatus === "ABSENT" ? "🚨" : "ℹ️";
  let subject = `${statusEmoji} Attendance Notice: ${params.studentName} — ${normStatus} (${params.courseName})`;
  let message = `Daily Attendance Notice: ${params.studentName} was marked ${normStatus} for ${params.courseName} on ${params.date}.`;

  try {
    const tpl = await renderTemplate("ATTENDANCE_DAILY_SUMMARY", {
      parent_name: "Student / Parent",
      student_name: params.studentName,
      course_name: params.courseName,
      attendance_date: params.date,
      status: normStatus,
      teacher_name: params.markedBy || "Course Faculty",
      remarks_block: params.remarks ? `<strong>Instructor Notes:</strong> ${escapeHtml(params.remarks)}<br>` : "",
      attendance_percent: params.attendancePercentage ?? 100
    });
    if (!tpl.enabled) return false;
    subject = tpl.subject;
    message = tpl.htmlBody;
  } catch {
    // Fallback
  }

  const resolvedRecipients: Array<{ role: "STUDENT" | "PARENT"; email: string; name: string }> = [];
  const seen = new Set<string>();
  const addRec = (role: "STUDENT" | "PARENT", email?: string | null, name?: string) => {
    const clean = String(email || "").trim();
    if (!isRealEmail(clean)) return;
    const key = clean.toLowerCase();
    if (seen.has(key)) return;
    seen.add(key);
    resolvedRecipients.push({
      role,
      email: clean,
      name: name || (role === "STUDENT" ? params.studentName : `Parent of ${params.studentName}`),
    });
  };

  for (const r of params.recipients || []) {
    addRec(r.role, r.email, r.name);
  }
  addRec("STUDENT", params.studentEmail, params.studentName);
  addRec("PARENT", params.parentEmail);
  for (const pe of params.parentEmails || []) {
    addRec("PARENT", pe);
  }

  if (resolvedRecipients.length === 0) return false;

  const result = await dispatchMultiChannelNotification({
    eventType: "ATTENDANCE_ALERT",
    subject,
    message,
    escapeMessage: false,
    recipients: resolvedRecipients
  });

  await logEmail(
    "ATTENDANCE_DAILY",
    params.studentName,
    params.date || instituteToday(),
    resolvedRecipients.map(r => r.email),
    subject,
    statusFromDispatch(result),
    result.failures.join("; ") || undefined,
    message
  );

  return result.success;
}

/**
 * Node 8: Monthly Progress Attendance Summary Email
 */
export async function sendMonthlyAttendanceSummaryEmail(params: {
  parentEmail: string;
  studentName: string;
  month: string;
  courseName?: string;
  totalClasses: number;
  attendedClasses: number;
  percentage: number;
}): Promise<boolean> {
  const statusText = params.percentage >= 85 ? "Excellent Attendance! Keep up the great work." : params.percentage >= 75 ? "Satisfactory Attendance." : "Attention Needed: Attendance is below 75%.";
  let subject = `📊 Monthly Attendance Report — ${params.studentName} (${params.month})`;
  let message = `Monthly Attendance: ${params.studentName} attended ${params.attendedClasses}/${params.totalClasses} classes.`;

  try {
    const tpl = await renderTemplate("ATTENDANCE_MONTHLY_SUMMARY", {
      parent_name: "Parent",
      student_name: params.studentName,
      month_name: params.month,
      course_name: params.courseName || "All Enrolled Courses",
      total_conducted: params.totalClasses,
      total_attended: params.attendedClasses,
      attendance_percent: params.percentage,
      attendance_evaluation: statusText
    });
    if (!tpl.enabled) return false;
    subject = tpl.subject;
    message = tpl.htmlBody;
  } catch {
    // Fallback
  }

  const result = await dispatchMultiChannelNotification({
    eventType: "ATTENDANCE_ALERT",
    subject,
    message,
    escapeMessage: false,
    recipients: [
      {
        role: "PARENT",
        email: params.parentEmail,
        name: `Parent of ${params.studentName}`
      }
    ]
  });

  await logEmail(
    "ATTENDANCE_MONTHLY",
    params.studentName,
    instituteToday(),
    [params.parentEmail],
    subject,
    statusFromDispatch(result),
    result.failures.join("; ") || undefined,
    message
  );

  return result.success;
}

/**
 * Node 8: Payment Confirmation Receipt Email to Parents
 */
export async function sendPaymentConfirmationReceiptEmail(params: {
  parentEmail: string;
  parentName?: string;
  studentName: string;
  courseName: string;
  tokensPurchased: number;
  tokensRemaining: number;
  amountUsd: number;
  paymentMethod: string;
  transactionId: string;
  receiptDate?: string;
}): Promise<boolean> {
  const subject = `🧾 Payment Receipt: ${params.tokensPurchased} Class Hours Credited for ${params.studentName}`;
  const nowStr = params.receiptDate || new Date().toLocaleString("en-US", { timeZone: "America/New_York" });

  const message = `Dear ${params.parentName || "Parent"},\n\n` +
    `Thank you for your payment! We have successfully credited ${params.tokensPurchased} Class Hour${params.tokensPurchased > 1 ? "s" : ""} to ${params.studentName}'s account for ${params.courseName}.\n\n` +
    `• Student: ${params.studentName}\n` +
    `• Course: ${params.courseName}\n` +
    `• Hours Credited: +${params.tokensPurchased} Hour${params.tokensPurchased > 1 ? "s" : ""}\n` +
    `• Available Balance: ${params.tokensRemaining} Class Hours\n` +
    `• Amount Paid: $${params.amountUsd.toFixed(2)} USD\n` +
    `• Payment Channel: ${params.paymentMethod}\n` +
    `• Transaction / Reference ID: ${params.transactionId}\n` +
    `• Timestamp: ${nowStr}\n\n` +
    `Class Hour Consumption Policy: Each time ${params.studentName} is marked PRESENT during roll call, 1 hour is deducted. An automated low-quota alert will notify you when the hour balance falls to 2 or fewer hours.\n\n` +
    `Warm regards,\nTop Grade Learning Accounts Division\ntglbiz101@gmail.com`;

  const result = await dispatchMultiChannelNotification({
    eventType: "PAYMENT_COMPLETED",
    subject,
    message,
    recipients: [
      {
        role: "PARENT",
        email: params.parentEmail,
        name: params.parentName || `Parent of ${params.studentName}`
      }
    ]
  });

  return result.success;
}

/**
 * Completed Class Attendance Roster Report Email dispatched to BOTH the Teacher and Admin email.
 */
export async function sendCompletedClassAttendanceReportEmail(params: {
  courseName: string;
  date: string;
  timeSlot?: string;
  room?: string;
  teacherName: string;
  teacherEmail?: string | null;
  scheduleId?: string;
  entries: Array<{
    studentName: string;
    studentCode?: string;
    status: string;
    remarks?: string;
    tokensRemaining?: number;
  }>;
}): Promise<boolean> {
  const rows = params.entries || [];
  if (rows.length === 0) return false;

  const presentCount = rows.filter(r => String(r.status || "").toUpperCase() === "PRESENT" || String(r.status || "").toUpperCase() === "LATE").length;
  const absentCount = rows.filter(r => String(r.status || "").toUpperCase() === "ABSENT").length;
  const totalCount = rows.length;
  const ratePct = totalCount > 0 ? Math.round((presentCount / totalCount) * 100) : 0;

  const recipients: Array<{ role: "TEACHER" | "ADMIN"; email: string; name: string }> = [];
  const seen = new Set<string>();

  if (isRealEmail(params.teacherEmail)) {
    const tClean = String(params.teacherEmail).trim();
    seen.add(tClean.toLowerCase());
    recipients.push({ role: "TEACHER", email: tClean, name: params.teacherName || "Course Instructor" });
  }

  let adminEmails: string[] = [];
  try {
    adminEmails = await getAdminNotificationEmails();
  } catch {}
  if (adminEmails.length === 0) {
    const fallbackAdmin = (process.env.ADMIN_EMAIL || process.env.GMAIL_SENDER_EMAIL || "tglbiz101@gmail.com").trim();
    if (fallbackAdmin) adminEmails = [fallbackAdmin];
  }
  for (const ae of adminEmails) {
    const clean = String(ae || "").trim();
    if (!clean || !clean.includes("@")) continue;
    if (seen.has(clean.toLowerCase())) continue;
    seen.add(clean.toLowerCase());
    recipients.push({ role: "ADMIN", email: clean, name: "System Administrator" });
  }

  if (recipients.length === 0) return false;

  const subject = `📋 Class Attendance Report: ${params.courseName} — ${params.date} (${presentCount}/${totalCount} Present)`;
  const tableRowsHtml = rows.map((r, i) => {
    const st = String(r.status || "PRESENT").toUpperCase();
    const badgeColor = st === "PRESENT" || st === "LATE"
      ? "background:#ecfdf5;color:#047857;border:1px solid #a7f3d0;"
      : st === "ABSENT"
      ? "background:#fef2f2;color:#b91c1c;border:1px solid #fecaca;"
      : "background:#fffbeb;color:#b45309;border:1px solid #fde68a;";
    return `
      <tr>
        <td style="padding:10px;border-bottom:1px solid #e2e8f0;font-size:12px;color:#475569;">${i + 1}</td>
        <td style="padding:10px;border-bottom:1px solid #e2e8f0;font-size:12px;font-weight:700;color:#0f172a;">${escapeHtml(r.studentName)}</td>
        <td style="padding:10px;border-bottom:1px solid #e2e8f0;font-size:11px;font-family:monospace;color:#475569;">${escapeHtml(r.studentCode || "—")}</td>
        <td style="padding:10px;border-bottom:1px solid #e2e8f0;"><span style="display:inline-block;padding:3px 10px;border-radius:999px;font-size:11px;font-weight:800;${badgeColor}">${escapeHtml(st)}</span></td>
        <td style="padding:10px;border-bottom:1px solid #e2e8f0;font-size:12px;color:#334155;">${r.tokensRemaining !== undefined ? `${r.tokensRemaining} left` : "—"}</td>
        <td style="padding:10px;border-bottom:1px solid #e2e8f0;font-size:11px;color:#64748b;">${escapeHtml(r.remarks || "—")}</td>
      </tr>`;
  }).join("");

  const htmlMessage = `
    <div style="font-family:'Segoe UI',Helvetica,Arial,sans-serif;max-width:720px;margin:0 auto;background:#ffffff;border:1px solid #cbd5e1;border-radius:14px;overflow:hidden;">
      <div style="background:linear-gradient(135deg,#0d1c2f,#004ac6);padding:22px 24px;color:#ffffff;">
        <div style="font-size:11px;font-weight:800;letter-spacing:1px;text-transform:uppercase;color:#93c5fd;">Completed Class Attendance Summary</div>
        <h2 style="margin:6px 0 4px 0;font-size:20px;font-weight:900;">${escapeHtml(params.courseName)}</h2>
        <div style="font-size:12px;color:#e2e8f0;">
          Date: <strong>${escapeHtml(params.date)}</strong>${params.timeSlot ? ` &nbsp;•&nbsp; Slot: <strong>${escapeHtml(params.timeSlot)}</strong>` : ""}${params.room ? ` &nbsp;•&nbsp; Room: <strong>${escapeHtml(params.room)}</strong>` : ""}<br>
          Instructor: <strong>${escapeHtml(params.teacherName || "Course Faculty")}</strong>
        </div>
      </div>

      <div style="padding:20px 24px;">
        <table width="100%" cellspacing="0" cellpadding="0" style="margin-bottom:18px;">
          <tr>
            <td style="width:25%;padding:10px;background:#f8fafc;border:1px solid #e2e8f0;border-radius:10px;text-align:center;">
              <div style="font-size:10px;text-transform:uppercase;font-weight:800;color:#64748b;">Total Students</div>
              <div style="font-size:20px;font-weight:900;color:#0f172a;margin-top:2px;">${totalCount}</div>
            </td>
            <td style="width:4%"></td>
            <td style="width:25%;padding:10px;background:#ecfdf5;border:1px solid #a7f3d0;border-radius:10px;text-align:center;">
              <div style="font-size:10px;text-transform:uppercase;font-weight:800;color:#047857;">Present</div>
              <div style="font-size:20px;font-weight:900;color:#047857;margin-top:2px;">${presentCount}</div>
            </td>
            <td style="width:4%"></td>
            <td style="width:25%;padding:10px;background:#fef2f2;border:1px solid #fecaca;border-radius:10px;text-align:center;">
              <div style="font-size:10px;text-transform:uppercase;font-weight:800;color:#b91c1c;">Absent</div>
              <div style="font-size:20px;font-weight:900;color:#b91c1c;margin-top:2px;">${absentCount}</div>
            </td>
            <td style="width:4%"></td>
            <td style="width:13%;padding:10px;background:#eff6ff;border:1px solid #bfdbfe;border-radius:10px;text-align:center;">
              <div style="font-size:10px;text-transform:uppercase;font-weight:800;color:#1d4ed8;">Rate</div>
              <div style="font-size:18px;font-weight:900;color:#1d4ed8;margin-top:2px;">${ratePct}%</div>
            </td>
          </tr>
        </table>

        <table width="100%" cellspacing="0" cellpadding="0" style="border-collapse:collapse;border:1px solid #e2e8f0;border-radius:10px;overflow:hidden;">
          <thead>
            <tr style="background:#f1f5f9;text-align:left;font-size:11px;text-transform:uppercase;color:#475569;">
              <th style="padding:10px;">#</th>
              <th style="padding:10px;">Student</th>
              <th style="padding:10px;">ID</th>
              <th style="padding:10px;">Status</th>
              <th style="padding:10px;">Tokens</th>
              <th style="padding:10px;">Remarks</th>
            </tr>
          </thead>
          <tbody>
            ${tableRowsHtml}
          </tbody>
        </table>
      </div>
      ${emailFooter()}
    </div>
  `;

  const result = await dispatchMultiChannelNotification({
    eventType: "ATTENDANCE_ALERT",
    subject,
    message: htmlMessage,
    escapeMessage: false,
    recipients
  });

  const summaryPreview = `Completed class attendance (${presentCount}/${totalCount} present): ` +
    rows.map(r => `${r.studentName} (${String(r.status || "PRESENT").toUpperCase()})`).join(", ");

  await logEmail(
    "ATTENDANCE_CLASS_REPORT",
    params.courseName,
    params.date || instituteToday(),
    recipients.map(r => r.email),
    subject,
    statusFromDispatch(result),
    result.failures.join("; ") || undefined,
    summaryPreview
  );

  return result.success;
}

