import { supabaseAdmin } from "../supabase.js";
import { getTemplate, renderTemplate } from "./emailTemplateService.js";
import { dispatchMultiChannelNotification, escapeHtml } from "./notificationService.js";
import { claimEmail, finishEmail, logEmail, statusFromDispatch } from "./emailLog.js";
import { instituteNow, instituteToday, instituteTimezone } from "./instituteTime.js";
import { getCachedInstituteSettings, instituteAddress, updateInstituteSettings } from "./instituteSettingsService.js";
import { isUnsubscribed, verifyCanSpamAddress, buildUnsubscribeLink } from "./emailUnsubscribeService.js";
import { getAllParentEmails } from "./eventEmailService.js";
import { normEmail } from "./studentAccounts.js";
import { inMemoryStudentStore, getAllStudentsRaw } from "./studentService.js";

export interface EngagementScanResult {
  welcomeWeek1: number;
  welcomeWeek2: number;
  welcomeWeek3: number;
  weMissYou: number;
  skippedUnsubscribed: number;
  errors: string[];
}

/**
 * Checks if a specific engagement feature is active (both institute settings toggle AND template enabled).
 */
export async function isEngagementFeatureEnabled(
  settingKey: "engagement_welcome_series_enabled" | "engagement_monthly_update_enabled" | "engagement_we_miss_you_enabled",
  templateKey: string
): Promise<boolean> {
  const settings = getCachedInstituteSettings();
  if ((settings as any)[settingKey] === false) {
    return false;
  }
  const tpl = await getTemplate(templateKey);
  if (tpl && !tpl.enabled) {
    return false;
  }
  return true;
}

/**
 * Appends standard CAN-SPAM compliant postal address and one-click unsubscribe footer.
 */
export function appendCanSpamFooter(
  htmlBody: string,
  recipientEmail: string,
  category = "ENGAGEMENT"
): string {
  const address = instituteAddress();
  const unsubUrl = buildUnsubscribeLink(recipientEmail, category);

  return `
    ${htmlBody}
    <div style="margin-top: 35px; padding-top: 18px; border-top: 1px solid #e2e8f0; font-size: 11px; color: #64748b; line-height: 1.6; font-family: sans-serif;">
      <p style="margin: 0 0 6px 0;">This communication was sent by <strong>${escapeHtml(getCachedInstituteSettings().institute_name)}</strong>.</p>
      ${address ? `<p style="margin: 0 0 6px 0;">Postal Address: ${escapeHtml(address)}</p>` : ""}
      <p style="margin: 0;">You are receiving this because your child is enrolled with us. If you prefer not to receive engagement updates, you can <a href="${unsubUrl}" style="color: #004ac6; text-decoration: underline;">Unsubscribe with one click</a>.</p>
    </div>
  `;
}

/**
 * Processes the 3-week Welcome Series for newly admitted students:
 * - Week 1: 7-13 days after registration
 * - Week 2: 14-20 days after registration
 * - Week 3: 21-27 days after registration
 */
export async function processWelcomeSeries(
  todayStr: string = instituteToday()
): Promise<{ week1: number; week2: number; week3: number; skippedUnsubscribed: number }> {
  let week1 = 0;
  let week2 = 0;
  let week3 = 0;
  let skippedUnsubscribed = 0;

  const isEnabled = await isEngagementFeatureEnabled(
    "engagement_welcome_series_enabled",
    "WELCOME_SERIES_WEEK_1"
  );
  if (!isEnabled) {
    return { week1, week2, week3, skippedUnsubscribed };
  }

  const canSpam = verifyCanSpamAddress();
  if (!canSpam.allowed) {
    console.warn("CAN-SPAM check blocked welcome series:", canSpam.reason);
    return { week1, week2, week3, skippedUnsubscribed };
  }

  // Load students from database/service
  const students = await getAllStudentsRaw().catch(() => inMemoryStudentStore);
  const nowMs = new Date(todayStr).getTime();

  for (const stu of students) {
    if (stu.status?.toUpperCase() !== "ACTIVE") continue;

    const createdAtStr = (stu as any).created_at || (stu as any).admissionDate || (stu as any).admission_date;
    if (!createdAtStr) continue;

    const createdMs = new Date(createdAtStr).getTime();
    if (isNaN(createdMs)) continue;

    const daysSinceCreated = Math.floor((nowMs - createdMs) / (1000 * 60 * 60 * 24));
    if (daysSinceCreated < 7) continue;

    const parentEmails = getAllParentEmails(stu);
    if (parentEmails.length === 0) continue;

    const settings = getCachedInstituteSettings();
    const parentName = (stu as any).parentFirstName
      ? `${(stu as any).parentFirstName} ${(stu as any).parentLastName || ""}`.trim()
      : (stu as any).fatherName || (stu as any).motherName || "Parent";

    // 1. WEEK 1 (Days 7 to 13)
    if (daysSinceCreated >= 7 && daysSinceCreated < 14) {
      for (const email of parentEmails) {
        if (await isUnsubscribed(email, "ENGAGEMENT") || await isUnsubscribed(email, "MARKETING")) {
          skippedUnsubscribed++;
          continue;
        }

        const rendered = await renderTemplate("WELCOME_SERIES_WEEK_1", {
          parent_name: parentName,
          student_name: stu.fullName || "Student",
          institute_name: settings.institute_name,
          support_email: settings.support_email
        });

        const claimId = await claimEmail("WELCOME_SERIES_WEEK_1", `${stu.id || stu.studentCode}-${email}`, todayStr, [email], rendered.subject, rendered.htmlBody);
        if (!claimId) continue;

        const fullHtml = appendCanSpamFooter(rendered.htmlBody, email, "ENGAGEMENT");
        const res = await dispatchMultiChannelNotification({
          eventType: "ADMISSION_APPROVED",
          subject: rendered.subject,
          message: fullHtml,
          recipients: [{ role: "PARENT", email, name: parentName }]
        });

        const status = statusFromDispatch(res);
        await finishEmail(claimId, status, res.failures?.join("; "));
        if (status !== "failed") week1++;
      }
    }

    // 2. WEEK 2 (Days 14 to 20)
    else if (daysSinceCreated >= 14 && daysSinceCreated < 21) {
      for (const email of parentEmails) {
        if (await isUnsubscribed(email, "ENGAGEMENT") || await isUnsubscribed(email, "MARKETING")) {
          skippedUnsubscribed++;
          continue;
        }

        const rendered = await renderTemplate("WELCOME_SERIES_WEEK_2", {
          parent_name: parentName,
          student_name: stu.fullName || "Student",
          institute_name: settings.institute_name,
          support_email: settings.support_email
        });

        const claimId = await claimEmail("WELCOME_SERIES_WEEK_2", `${stu.id || stu.studentCode}-${email}`, todayStr, [email], rendered.subject, rendered.htmlBody);
        if (!claimId) continue;

        const fullHtml = appendCanSpamFooter(rendered.htmlBody, email, "ENGAGEMENT");
        const res = await dispatchMultiChannelNotification({
          eventType: "ADMISSION_APPROVED",
          subject: rendered.subject,
          message: fullHtml,
          recipients: [{ role: "PARENT", email, name: parentName }]
        });

        const status = statusFromDispatch(res);
        await finishEmail(claimId, status, res.failures?.join("; "));
        if (status !== "failed") week2++;
      }
    }

    // 3. WEEK 3 (Days 21 to 30)
    else if (daysSinceCreated >= 21 && daysSinceCreated < 30) {
      for (const email of parentEmails) {
        if (await isUnsubscribed(email, "ENGAGEMENT") || await isUnsubscribed(email, "MARKETING")) {
          skippedUnsubscribed++;
          continue;
        }

        const rendered = await renderTemplate("WELCOME_SERIES_WEEK_3", {
          parent_name: parentName,
          student_name: stu.fullName || "Student",
          institute_name: settings.institute_name,
          support_email: settings.support_email
        });

        const claimId = await claimEmail("WELCOME_SERIES_WEEK_3", `${stu.id || stu.studentCode}-${email}`, todayStr, [email], rendered.subject, rendered.htmlBody);
        if (!claimId) continue;

        const fullHtml = appendCanSpamFooter(rendered.htmlBody, email, "ENGAGEMENT");
        const res = await dispatchMultiChannelNotification({
          eventType: "ADMISSION_APPROVED",
          subject: rendered.subject,
          message: fullHtml,
          recipients: [{ role: "PARENT", email, name: parentName }]
        });

        const status = statusFromDispatch(res);
        await finishEmail(claimId, status, res.failures?.join("; "));
        if (status !== "failed") week3++;
      }
    }
  }

  return { week1, week2, week3, skippedUnsubscribed };
}

/**
 * Checks attendance records for all active students.
 * If 14 or more days have elapsed without attending a class, sends the 'We miss you' email.
 * Respects unsubscribe and postal address rules.
 */
export async function processWeMissYouNotices(
  todayStr: string = instituteToday()
): Promise<{ count: number; skippedUnsubscribed: number }> {
  let count = 0;
  let skippedUnsubscribed = 0;

  const isEnabled = await isEngagementFeatureEnabled(
    "engagement_we_miss_you_enabled",
    "WE_MISS_YOU_14_DAYS"
  );
  if (!isEnabled) {
    return { count, skippedUnsubscribed };
  }

  const canSpam = verifyCanSpamAddress();
  if (!canSpam.allowed) {
    console.warn("CAN-SPAM check blocked We Miss You notices:", canSpam.reason);
    return { count, skippedUnsubscribed };
  }

  const students = await getAllStudentsRaw().catch(() => inMemoryStudentStore);
  const nowMs = new Date(todayStr).getTime();
  const settings = getCachedInstituteSettings();

  // Fetch recent attendance records to find last attended date per student
  let attendanceRows: Array<{ student_id?: string; student_code?: string; student_name?: string; date?: string; status?: string }> = [];
  try {
    const { data } = await supabaseAdmin
      .from("attendance")
      .select("student_id, student_code, student_name, date, status");
    if (data) attendanceRows = data;
  } catch (err: any) {
    console.warn("Notice querying attendance for we-miss-you scan:", err?.message);
  }

  for (const stu of students) {
    if (stu.status?.toUpperCase() !== "ACTIVE") continue;

    const parentEmails = getAllParentEmails(stu);
    if (parentEmails.length === 0) continue;

    // Find latest attendance for this student
    const studentRecords = attendanceRows.filter(
      r =>
        (r.student_id && stu.id && r.student_id === stu.id) ||
        (r.student_code && stu.studentCode && r.student_code.toLowerCase() === stu.studentCode.toLowerCase()) ||
        (r.student_name && stu.fullName && r.student_name.toLowerCase() === stu.fullName.toLowerCase())
    );

    let lastAttendedMs: number | null = null;
    for (const rec of studentRecords) {
      if (rec.date && (rec.status?.toUpperCase() === "PRESENT" || rec.status?.toUpperCase() === "LATE")) {
        const d = new Date(rec.date).getTime();
        if (!isNaN(d) && (!lastAttendedMs || d > lastAttendedMs)) {
          lastAttendedMs = d;
        }
      }
    }

    const createdAtStr = (stu as any).created_at || (stu as any).admissionDate;
    const admissionMs = createdAtStr ? new Date(createdAtStr).getTime() : nowMs - (20 * 86400000);

    // If never attended, measure from admission date; otherwise measure from last attended class
    const referenceDateMs = lastAttendedMs || admissionMs;
    const daysWithoutClass = Math.floor((nowMs - referenceDateMs) / (1000 * 60 * 60 * 24));

    if (daysWithoutClass >= 14) {
      // Claim once per 30 days per student to avoid daily email fatigue
      const claimMonth = todayStr.slice(0, 7);
      for (const email of parentEmails) {
        if (await isUnsubscribed(email, "ENGAGEMENT") || await isUnsubscribed(email, "MARKETING")) {
          skippedUnsubscribed++;
          continue;
        }

        const parentName = (stu as any).parentFirstName
          ? `${(stu as any).parentFirstName} ${(stu as any).parentLastName || ""}`.trim()
          : (stu as any).fatherName || (stu as any).motherName || "Parent";

        const rendered = await renderTemplate("WE_MISS_YOU_14_DAYS", {
          parent_name: parentName,
          student_name: stu.fullName || "Student",
          institute_name: settings.institute_name,
          support_email: settings.support_email,
          days_inactive: String(daysWithoutClass)
        });

        const claimId = await claimEmail("WE_MISS_YOU_14_DAYS", `${stu.id || stu.studentCode}-${claimMonth}-${email}`, todayStr, [email], rendered.subject, rendered.htmlBody);
        if (!claimId) continue;

        const fullHtml = appendCanSpamFooter(rendered.htmlBody, email, "ENGAGEMENT");
        const res = await dispatchMultiChannelNotification({
          eventType: "ATTENDANCE_ALERT",
          subject: rendered.subject,
          message: fullHtml,
          recipients: [{ role: "PARENT", email, name: parentName }]
        });

        const status = statusFromDispatch(res);
        await finishEmail(claimId, status, res.failures?.join("; "));
        if (status !== "failed") count++;
      }
    }
  }

  return { count, skippedUnsubscribed };
}

/**
 * Runs all engagement scans (welcome series, we miss you).
 */
export async function runEngagementScan(): Promise<EngagementScanResult> {
  const today = instituteToday();
  const errors: string[] = [];

  let welcomeWeek1 = 0;
  let welcomeWeek2 = 0;
  let welcomeWeek3 = 0;
  let skippedWelcome = 0;

  try {
    const res = await processWelcomeSeries(today);
    welcomeWeek1 = res.week1;
    welcomeWeek2 = res.week2;
    welcomeWeek3 = res.week3;
    skippedWelcome = res.skippedUnsubscribed;
  } catch (err: any) {
    errors.push(`Welcome series error: ${err.message}`);
  }

  let weMissYou = 0;
  let skippedMissYou = 0;

  try {
    const res = await processWeMissYouNotices(today);
    weMissYou = res.count;
    skippedMissYou = res.skippedUnsubscribed;
  } catch (err: any) {
    errors.push(`We Miss You error: ${err.message}`);
  }

  return {
    welcomeWeek1,
    welcomeWeek2,
    welcomeWeek3,
    weMissYou,
    skippedUnsubscribed: skippedWelcome + skippedMissYou,
    errors
  };
}
