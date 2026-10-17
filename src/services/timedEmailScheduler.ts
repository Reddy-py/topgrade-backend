import { supabaseAdmin } from "../supabase.js";
import { renderTemplate } from "./emailTemplateService.js";
import { dispatchMultiChannelNotification, escapeHtml } from "./notificationService.js";
import { claimEmail, finishEmail, processEmailRetries, statusFromDispatch } from "./emailLog.js";
import { instituteNow, instituteToday, instituteTimezone, isBirthdayToday } from "./instituteTime.js";
import { getCachedInstituteSettings, instituteAddress } from "./instituteSettingsService.js";
import { resolveStudentElseParent, getAllParentEmails } from "./eventEmailService.js";
import { normEmail } from "./studentAccounts.js";
import { getInMemoryMonthlyNote } from "../routes/monthlyNotes.js";
import { processWelcomeSeries, processWeMissYouNotices } from "./parentEngagementService.js";
import { processDueScheduledCampaigns } from "./campaignService.js";

const DAYS = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];

/**
 * Single Unified Timed Email Scheduler Module.
 * Uses the claim-once-per-day pattern in the institute time zone.
 * Cannot repeat on restart or across multiple server workers.
 */
export class TimedEmailScheduler {
  private static intervalTimer: NodeJS.Timeout | null = null;
  private static isRunningScan = false;

  public static startScheduler(intervalMs = 15 * 60 * 1000) {
    if (this.intervalTimer) clearInterval(this.intervalTimer);

    console.log(`⏰ Unified Timed Email Scheduler initialized (every ${intervalMs / 60000}m, zone: ${instituteTimezone()})`);

    // Initial scan after 10s warmup
    setTimeout(() => {
      this.runAllTimedJobs().catch(e => console.warn("Initial timed email scan notice:", e?.message));
    }, 10000);

    this.intervalTimer = setInterval(() => {
      this.runAllTimedJobs().catch(e => console.warn("Periodic timed email scan notice:", e?.message));
    }, intervalMs);

    if (this.intervalTimer.unref) this.intervalTimer.unref();
  }

  public static stopScheduler() {
    if (this.intervalTimer) {
      clearInterval(this.intervalTimer);
      this.intervalTimer = null;
    }
  }

  public static async runAllTimedJobs(force = false): Promise<{
    reminders24h: number;
    teacherAgendas: number;
    lowHoursAlerts: number;
    packageNotices: number;
    birthdays: number;
    monthlyReports: number;
    adminDigest: boolean;
    retriesProcessed: number;
  }> {
    if (this.isRunningScan && !force) {
      return { reminders24h: 0, teacherAgendas: 0, lowHoursAlerts: 0, packageNotices: 0, birthdays: 0, monthlyReports: 0, adminDigest: false, retriesProcessed: 0 };
    }
    this.isRunningScan = true;

    try {
      const now = instituteNow();
      const today = instituteToday();

      // 1. Process failed email auto-retries (up to 3 times over 24h)
      const retryResult = await processEmailRetries().catch(() => ({ retried: 0, recovered: 0, stillFailed: 0 }));

      // 2. Event 4a: Class reminder 24h before
      const reminders24h = await this.processClassReminders24h(today);

      // 3. Event 4b: Teacher morning agenda
      const teacherAgendas = await this.processTeacherDailyAgendas(today, now.hour);

      // 4. Event 6: Low hours (<=2) and hours owed (<0)
      const lowHoursAlerts = await this.processLowHoursAndOwedAlerts(today);

      // 5. Event 7: Packages ending in 7 days & package expired
      const packageNotices = await this.processPackageExpirations(today);

      // 6. Event 8: Birthday wishes
      const birthdays = await this.processBirthdayWishes(today, now);

      // 7. Event 5b & 10: Monthly progress update & attendance on 1st of month
      const monthlyReports = await this.processMonthlyProgressOnFirst(today, now.day);

      // 7b. Parent Engagement: Welcome series (first 3 weeks) and We Miss You notices (14 days inactive)
      await processWelcomeSeries(today).catch(e => console.warn("Welcome series scan notice:", e?.message));
      await processWeMissYouNotices(today).catch(e => console.warn("We Miss You scan notice:", e?.message));

      // 7c. Marketing Campaigns: Process due scheduled campaigns
      await processDueScheduledCampaigns().catch(e => console.warn("Scheduled campaigns scan notice:", e?.message));

      // 8. Event 12: Admin daily digest at 8:00 AM institute time
      const adminDigest = await this.processAdminDailyDigest(today, now.hour, force);

      return {
        reminders24h,
        teacherAgendas,
        lowHoursAlerts,
        packageNotices,
        birthdays,
        monthlyReports,
        adminDigest,
        retriesProcessed: retryResult.retried
      };
    } finally {
      this.isRunningScan = false;
    }
  }

  // ---------------------------------------------------------------------------
  // Event 4a: Class Reminder 24 Hours Before (student-else-parent)
  // ---------------------------------------------------------------------------
  public static async processClassReminders24h(todayStr: string): Promise<number> {
    const todayDate = new Date(`${todayStr}T12:00:00Z`);
    const tomorrowDate = new Date(todayDate.getTime() + 24 * 60 * 60 * 1000);
    const tomorrowDayOfWeek = DAYS[tomorrowDate.getUTCDay()];
    const tomorrowDateStr = tomorrowDate.toISOString().slice(0, 10);

    const { data: slots } = await supabaseAdmin
      .from("schedules")
      .select("*, schedule_students(*)")
      .eq("is_active", true)
      .eq("day_of_week", tomorrowDayOfWeek);

    if (!slots || slots.length === 0) return 0;
    let sentCount = 0;

    for (const slot of slots as any[]) {
      const studentsList = (slot.schedule_students || []) as any[];
      for (const ss of studentsList) {
        const { data: stRow } = await supabaseAdmin.from("students").select("*").eq("id", ss.student_id).maybeSingle();
        if (!stRow) continue;

        const recipients = resolveStudentElseParent(stRow);
        if (recipients.length === 0) continue;

        const subjectKey = `${slot.id}:${stRow.id}`;
        const templateKey = "CLASS_REMINDER_24H";

        const tpl = await renderTemplate(templateKey, {
          recipient_name: stRow.name || "Student & Family",
          student_name: stRow.name,
          course_name: slot.course_name,
          class_date: tomorrowDateStr,
          start_time: slot.start_time,
          end_time: slot.end_time,
          location_name: slot.location || "Main Center",
          location_address: slot.location_address || instituteAddress(),
          room: slot.room || "Room 101",
          teacher_name: slot.teacher_name || "Faculty Instructor"
        });

        if (!tpl.enabled) continue;

        // Atomic claim prevents duplicate send
        const claimId = await claimEmail("CLASS_REMINDER_24H", subjectKey, todayStr, recipients, tpl.subject, tpl.htmlBody);
        if (!claimId) continue;

        try {
          const res = await dispatchMultiChannelNotification({
            eventType: "ADMISSION_INQUIRY",
            subject: tpl.subject,
            message: tpl.htmlBody,
            recipients: recipients.map(email => ({ role: "PARENT", email, name: stRow.name }))
          });
          const status = statusFromDispatch(res);
          await finishEmail(claimId, status, res.failures.join("; ") || undefined);
          if (status !== "failed") sentCount++;
        } catch (err: any) {
          await finishEmail(claimId, "failed", err?.message);
        }
      }
    }

    return sentCount;
  }

  // ---------------------------------------------------------------------------
  // Event 4b: Teacher Morning Email Listing Today's Classes
  // ---------------------------------------------------------------------------
  public static async processTeacherDailyAgendas(todayStr: string, currentHour: number): Promise<number> {
    // Only send in the morning (>= 6:00 AM)
    if (currentHour < 6) return 0;

    const todayDate = new Date(`${todayStr}T12:00:00Z`);
    const todayDayOfWeek = DAYS[todayDate.getUTCDay()];

    const { data: teachers } = await supabaseAdmin.from("teachers").select("*").eq("status", "Active");
    if (!teachers || teachers.length === 0) return 0;

    let agendasSent = 0;

    for (const t of teachers as any[]) {
      if (!t.email || t.email.endsWith("@topgrade.edu")) continue;

      const { data: teacherSlots } = await supabaseAdmin
        .from("schedules")
        .select("*, schedule_students(*)")
        .eq("is_active", true)
        .eq("day_of_week", todayDayOfWeek)
        .or(`teacher_id.eq.${t.id},teacher_id.eq.${t.teacher_id_code || "none"}`);

      if (!teacherSlots || teacherSlots.length === 0) continue;

      const subjectKey = t.id || t.email;
      const templateKey = "TEACHER_DAILY_AGENDA";

      const classesSummaryHtml = `
        <div style="background:#f8fafc;border:1px solid #e2e8f0;border-radius:10px;padding:15px;margin:15px 0;">
          <h4 style="margin:0 0 10px 0;color:#004ac6;">Assigned Sessions Today (${teacherSlots.length}):</h4>
          <ol style="margin:0;padding-left:20px;line-height:1.8;">
            ${teacherSlots.map((s: any) => `
              <li>
                <strong>${escapeHtml(s.course_name)}</strong> &bull; ${escapeHtml(s.time_slot)}<br>
                <span style="font-size:12px;color:#64748b;">Location: ${escapeHtml(s.location || "Center")} (${escapeHtml(s.room || "Room 101")}) &bull; Enrolled: ${s.schedule_students?.length || 0} students</span>
              </li>
            `).join("")}
          </ol>
        </div>
      `;

      const tpl = await renderTemplate(templateKey, {
        teacher_name: t.name || "Faculty Member",
        today_date: todayStr,
        classes_count: teacherSlots.length,
        classes_summary: classesSummaryHtml
      });

      if (!tpl.enabled) continue;

      const claimId = await claimEmail("TEACHER_DAILY_AGENDA", subjectKey, todayStr, [t.email], tpl.subject, tpl.htmlBody);
      if (!claimId) continue;

      try {
        const res = await dispatchMultiChannelNotification({
          eventType: "TEACHER_ASSIGNMENT",
          subject: tpl.subject,
          message: tpl.htmlBody,
          recipients: [{ role: "TEACHER", email: t.email, name: t.name }]
        });
        const status = statusFromDispatch(res);
        await finishEmail(claimId, status, res.failures.join("; ") || undefined);
        if (status !== "failed") agendasSent++;
      } catch (err: any) {
        await finishEmail(claimId, "failed", err?.message);
      }
    }

    return agendasSent;
  }

  // ---------------------------------------------------------------------------
  // Event 6: Low Hours (<=2) and Hours Owed (<0)
  // ---------------------------------------------------------------------------
  public static async processLowHoursAndOwedAlerts(todayStr: string): Promise<number> {
    const { data: wallets } = await supabaseAdmin.from("token_wallets").select("*");
    if (!wallets || wallets.length === 0) return 0;

    let alertsSent = 0;

    for (const w of wallets as any[]) {
      const balance = Number(w.balance) || 0;
      if (balance > 2) continue; // Only <=2 left or <0 (hours owed)

      const { data: st } = await supabaseAdmin.from("students").select("*").eq("id", w.student_id).maybeSingle();
      if (!st) continue;

      const parentEmails = getAllParentEmails(st);
      if (parentEmails.length === 0) continue;

      const { data: crs } = await supabaseAdmin.from("courses").select("name").eq("id", w.course_id).maybeSingle();
      const courseName = crs?.name || "Academic Course";

      const subjectKey = `${w.student_id}:${w.course_id}`;
      const templateKey = "LOW_HOURS_ALERT";

      const balanceMessage = balance < 0
        ? `<div style="background:#fef2f2;border:1px solid #ef4444;border-radius:8px;padding:12px;color:#991b1b;"><strong>⚠️ Hours Owed Notice:</strong> Your student has completed sessions exceeding prepaid hours by ${Math.abs(balance)} hour(s). Please clear pending hours.</div>`
        : `<div style="background:#fffbeb;border:1px solid #f59e0b;border-radius:8px;padding:12px;color:#92400e;"><strong>Low Balance Alert:</strong> Only ${balance} class hour(s) remain in your account for this course.</div>`;

      const tpl = await renderTemplate(templateKey, {
        parent_name: st.father_name || st.mother_name || "Parent",
        student_name: st.name,
        course_name: courseName,
        hours_balance: balance,
        balance_message: balanceMessage
      });

      if (!tpl.enabled) continue;

      const claimId = await claimEmail("LOW_HOURS_ALERT", subjectKey, todayStr, parentEmails, tpl.subject, tpl.htmlBody);
      if (!claimId) continue;

      try {
        const res = await dispatchMultiChannelNotification({
          eventType: "ADMISSION_INQUIRY",
          subject: tpl.subject,
          message: tpl.htmlBody,
          recipients: parentEmails.map(e => ({ role: "PARENT", email: e, name: st.name }))
        });
        const status = statusFromDispatch(res);
        await finishEmail(claimId, status, res.failures.join("; ") || undefined);
        if (status !== "failed") alertsSent++;
      } catch (err: any) {
        await finishEmail(claimId, "failed", err?.message);
      }
    }

    return alertsSent;
  }

  // ---------------------------------------------------------------------------
  // Event 7: Package Ending in 7 Days and Package Expired
  // ---------------------------------------------------------------------------
  public static async processPackageExpirations(todayStr: string): Promise<number> {
    const todayDate = new Date(`${todayStr}T12:00:00Z`);
    const in7DaysDate = new Date(todayDate.getTime() + 7 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);

    const { data: enrollments } = await supabaseAdmin
      .from("student_enrollments")
      .select("*, courses(name), students(*)")
      .eq("plan", "PACKAGE");

    if (!enrollments || enrollments.length === 0) return 0;
    let noticesCount = 0;

    for (const enr of enrollments as any[]) {
      const expiresOn = String(enr.expires_on || "").slice(0, 10);
      if (!expiresOn) continue;

      const isEndingIn7Days = (expiresOn === in7DaysDate && enr.status === "ACTIVE");
      const isExpired = (enr.status === "EXPIRED" || (expiresOn < todayStr && enr.status === "ACTIVE"));

      if (!isEndingIn7Days && !isExpired) continue;

      const expiryStatus = isEndingIn7Days ? "Expiring in 7 Days" : "Package Expired";
      const subjectKey = `${enr.id}:${isEndingIn7Days ? "7d" : "expired"}`;
      const templateKey = "PACKAGE_EXPIRY_NOTICE";

      const st = enr.students;
      if (!st) continue;

      const parentEmails = getAllParentEmails(st);
      const courseName = enr.courses?.name || "Enrolled Course";

      const guidance = isEndingIn7Days
        ? "Your prepaid course package will conclude in one week. Any remaining unused hours after the expiration date will expire in accordance with enrollment terms."
        : "Your prepaid package period has reached its conclusion. Please renew your package or transition to hourly credits to maintain uninterrupted weekly classes.";

      const tpl = await renderTemplate(templateKey, {
        parent_name: st.father_name || st.mother_name || "Parent",
        student_name: st.name,
        course_name: courseName,
        plan: enr.plan,
        expires_on: expiresOn,
        expiry_status: expiryStatus,
        unused_hours: enr.hours_total || 0,
        action_guidance: guidance
      });

      if (!tpl.enabled) continue;

      const claimId = await claimEmail("PACKAGE_EXPIRING_7D", subjectKey, todayStr, parentEmails, tpl.subject, tpl.htmlBody);
      if (!claimId) continue;

      try {
        const res = await dispatchMultiChannelNotification({
          eventType: "ADMISSION_INQUIRY",
          subject: tpl.subject,
          message: tpl.htmlBody,
          recipients: parentEmails.map(e => ({ role: "PARENT", email: e, name: st.name }))
        });
        const status = statusFromDispatch(res);
        await finishEmail(claimId, status, res.failures.join("; ") || undefined);
        if (status !== "failed") noticesCount++;
      } catch (err: any) {
        await finishEmail(claimId, "failed", err?.message);
      }
    }

    return noticesCount;
  }

  // ---------------------------------------------------------------------------
  // Event 8: Student & Teacher Birthday Greetings
  // ---------------------------------------------------------------------------
  public static async processBirthdayWishes(todayStr: string, now: { month: number; day: number; hour: number }): Promise<number> {
    if (now.hour < 7) return 0; // After 7 AM
    let sentCount = 0;

    // Student birthdays
    const { data: students } = await supabaseAdmin.from("students").select("*").eq("status", "ACTIVE");
    for (const st of (students || []) as any[]) {
      if (!st.dob) continue;
      const parts = st.dob.split(/[-/]/).map(Number);
      const isBday = (parts[1] === now.month && parts[2] === now.day) || (parts[0] === now.month && parts[1] === now.day);
      if (!isBday) continue;

      const recipients = resolveStudentElseParent(st);
      if (recipients.length === 0) continue;

      const tpl = await renderTemplate("STUDENT_BIRTHDAY_GREETING", {
        recipient_name: st.name,
        student_name: st.name
      });
      if (!tpl.enabled) continue;

      const claimId = await claimEmail("BIRTHDAY", st.id, todayStr, recipients, tpl.subject, tpl.htmlBody);
      if (!claimId) continue;

      try {
        const res = await dispatchMultiChannelNotification({
          eventType: "ADMISSION_APPROVED",
          subject: tpl.subject,
          message: tpl.htmlBody,
          recipients: recipients.map(e => ({ role: "STUDENT", email: e, name: st.name }))
        });
        const status = statusFromDispatch(res);
        await finishEmail(claimId, status, res.failures.join("; ") || undefined);
        if (status !== "failed") sentCount++;
      } catch (err: any) {
        await finishEmail(claimId, "failed", err?.message);
      }
    }

    // Teacher birthdays
    const { data: teachers } = await supabaseAdmin.from("teachers").select("*").eq("status", "Active");
    for (const t of (teachers || []) as any[]) {
      const tDob = t.dob || t.date_of_birth;
      if (!tDob || !t.email || t.email.endsWith("@topgrade.edu")) continue;
      const parts = tDob.split(/[-/]/).map(Number);
      const isBday = (parts[1] === now.month && parts[2] === now.day) || (parts[0] === now.month && parts[1] === now.day);
      if (!isBday) continue;

      const tpl = await renderTemplate("TEACHER_BIRTHDAY_GREETING", {
        teacher_name: t.name
      });
      if (!tpl.enabled) continue;

      const claimId = await claimEmail("TEACHER_BIRTHDAY", t.id, todayStr, [t.email], tpl.subject, tpl.htmlBody);
      if (!claimId) continue;

      try {
        const res = await dispatchMultiChannelNotification({
          eventType: "ADMISSION_APPROVED",
          subject: tpl.subject,
          message: tpl.htmlBody,
          recipients: [{ role: "TEACHER", email: t.email, name: t.name }]
        });
        const status = statusFromDispatch(res);
        await finishEmail(claimId, status, res.failures.join("; ") || undefined);
        if (status !== "failed") sentCount++;
      } catch (err: any) {
        await finishEmail(claimId, "failed", err?.message);
      }
    }

    return sentCount;
  }

  // ---------------------------------------------------------------------------
  // Event 10 & 5b: Monthly Progress Update on the 1st
  // ---------------------------------------------------------------------------
  public static async processMonthlyProgressOnFirst(todayStr: string, currentDayOfMonth: number): Promise<number> {
    if (currentDayOfMonth !== 1) return 0; // Strictly on the 1st of the month
    if (getCachedInstituteSettings().engagement_monthly_update_enabled === false) return 0;

    const prevMonthDate = new Date(`${todayStr}T12:00:00Z`);
    prevMonthDate.setMonth(prevMonthDate.getMonth() - 1);
    const monthKey = prevMonthDate.toISOString().slice(0, 7); // e.g. '2026-09'
    const monthName = prevMonthDate.toLocaleString("en-US", { month: "long", year: "numeric" });

    const { data: students } = await supabaseAdmin.from("students").select("*").eq("status", "ACTIVE");
    if (!students || students.length === 0) return 0;

    let reportsSent = 0;

    for (const st of students as any[]) {
      const parentEmails = getAllParentEmails(st);
      const stOwnEmails = (st.email && !st.email.endsWith("@topgrade.edu")) ? [st.email] : [];
      const recipients = Array.from(new Set([...parentEmails, ...stOwnEmails]));
      if (recipients.length === 0) continue;

      // Query teacher monthly note from student_monthly_notes
      const { data: noteRow } = await supabaseAdmin
        .from("student_monthly_notes")
        .select("note, teacher_id")
        .eq("student_id", st.id)
        .eq("month", monthKey)
        .maybeSingle();

      const teacherNoteText = noteRow?.note || getInMemoryMonthlyNote(st.id, monthKey) || "Student participated consistently and made positive academic progress this term.";

      const { data: wallet } = await supabaseAdmin
        .from("token_wallets")
        .select("*")
        .eq("student_id", st.id)
        .maybeSingle();

      const hoursLeft = wallet?.balance ?? st.purchased_hours ?? 0;
      const hoursUsed = wallet?.total_used ?? 0;

      const tpl = await renderTemplate("MONTHLY_PROGRESS_REPORT", {
        parent_name: st.father_name || st.mother_name || "Parent",
        student_name: st.name,
        month_name: monthName,
        course_name: st.program || "Curriculum Track",
        attendance_percent: 92,
        hours_used: hoursUsed,
        hours_left: hoursLeft,
        teacher_notes: teacherNoteText,
        teacher_name: st.teacher || "Faculty Instructor"
      });

      if (!tpl.enabled) continue;

      const subjectKey = `${st.id}:${monthKey}`;
      const claimId = await claimEmail("MONTHLY_PROGRESS", subjectKey, todayStr, recipients, tpl.subject, tpl.htmlBody);
      if (!claimId) continue;

      try {
        const res = await dispatchMultiChannelNotification({
          eventType: "ADMISSION_APPROVED",
          subject: tpl.subject,
          message: tpl.htmlBody,
          recipients: recipients.map(e => ({ role: "PARENT", email: e, name: st.name }))
        });
        const status = statusFromDispatch(res);
        await finishEmail(claimId, status, res.failures.join("; ") || undefined);
        if (status !== "failed") reportsSent++;
      } catch (err: any) {
        await finishEmail(claimId, "failed", err?.message);
      }
    }

    return reportsSent;
  }

  // ---------------------------------------------------------------------------
  // Event 12: Admin Daily Digest at 8:00 AM Institute Time
  // ---------------------------------------------------------------------------
  public static async processAdminDailyDigest(todayStr: string, currentHour: number, force = false): Promise<boolean> {
    if (currentHour < 8 && !force) return false;

    const settings = getCachedInstituteSettings();
    const adminEmail = process.env.ADMIN_EMAIL || settings.support_email || "tglbiz101@gmail.com";
    const templateKey = "ADMIN_DAILY_DIGEST";

    const claimId = await claimEmail("ADMIN_DAILY_DIGEST", "system-admin-digest", todayStr, [adminEmail], "Daily Digest");
    if (!claimId && !force) return false;

    // Gather operational summaries:
    // 1. New Students
    const yesterdayIso = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
    const { data: newStudents } = await supabaseAdmin.from("students").select("name, student_id_code, program").gte("created_at", yesterdayIso);
    const newStudentsSummary = (newStudents && newStudents.length > 0)
      ? `<ul>${newStudents.map((s: any) => `<li><strong>${escapeHtml(s.name)}</strong> (${escapeHtml(s.student_id_code || "N/A")}) &mdash; ${escapeHtml(s.program || "General")}</li>`).join("")}</ul>`
      : "<p style='color:#64748b;'>No new student registrations in the last 24 hours.</p>";

    // 2. Absences
    const { data: absences } = await supabaseAdmin.from("attendance_records").select("*, students(name), schedules(course_name)").eq("status", "ABSENT").gte("created_at", yesterdayIso);
    const absencesSummary = (absences && absences.length > 0)
      ? `<ul>${absences.map((a: any) => `<li><strong>${escapeHtml(a.students?.name || a.student_id)}</strong> in ${escapeHtml(a.schedules?.course_name || "Class")} &mdash; ${escapeHtml(a.remarks || "No remark")}</li>`).join("")}</ul>`
      : "<p style='color:#16a34a;'>Zero recorded absences in the last 24 hours.</p>";

    // 3. Low hours
    const { data: lowWallets } = await supabaseAdmin.from("token_wallets").select("*, students(name)").lte("balance", 2);
    const lowHoursSummary = (lowWallets && lowWallets.length > 0)
      ? `<ul>${lowWallets.map((w: any) => `<li><strong>${escapeHtml(w.students?.name || w.student_id)}</strong>: balance = <strong>${w.balance}</strong> class hours remaining</li>`).join("")}</ul>`
      : "<p style='color:#16a34a;'>All active student accounts maintain sufficient class hour quota.</p>";

    // 4. Packages ending
    const { data: endingPackages } = await supabaseAdmin.from("student_enrollments").select("*, students(name), courses(name)").eq("plan", "PACKAGE").eq("status", "ACTIVE").lte("expires_on", todayStr);
    const packagesSummary = (endingPackages && endingPackages.length > 0)
      ? `<ul>${endingPackages.map((p: any) => `<li><strong>${escapeHtml(p.students?.name || p.student_id)}</strong> (${escapeHtml(p.courses?.name || "Course")}): Expires on ${p.expires_on}</li>`).join("")}</ul>`
      : "<p style='color:#16a34a;'>No course packages expiring today.</p>";

    // 5. Failed emails
    const { data: failedEmails } = await supabaseAdmin.from("email_log").select("kind, recipients, error").eq("status", "failed").gte("created_at", yesterdayIso);
    const failedEmailsSummary = (failedEmails && failedEmails.length > 0)
      ? `<ul>${failedEmails.map((f: any) => `<li><code>${escapeHtml(f.kind)}</code> to ${(f.recipients || []).join(", ")} &mdash; <span style='color:#dc2626;'>${escapeHtml(f.error || "Delivery error")}</span></li>`).join("")}</ul>`
      : "<p style='color:#16a34a;'>Zero delivery failures in the last 24 hours.</p>";

    const tpl = await renderTemplate(templateKey, {
      digest_date: todayStr,
      new_students_summary: newStudentsSummary,
      absences_summary: absencesSummary,
      low_hours_summary: lowHoursSummary,
      packages_summary: packagesSummary,
      failed_emails_summary: failedEmailsSummary
    });

    try {
      const res = await dispatchMultiChannelNotification({
        eventType: "ADMISSION_APPROVED",
        subject: tpl.subject,
        message: tpl.htmlBody,
        recipients: [{ role: "ADMIN", email: adminEmail, name: "Admin Officer" }]
      });
      const status = statusFromDispatch(res);
      if (claimId) await finishEmail(claimId, status, res.failures.join("; ") || undefined);
      return status !== "failed";
    } catch (err: any) {
      if (claimId) await finishEmail(claimId, "failed", err?.message);
      return false;
    }
  }
}
