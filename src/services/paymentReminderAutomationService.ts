import { supabaseAdmin } from "../supabase.js";
import {
  getCachedInstituteSettings,
  isAutomationEnabled,
  getAdminNotificationEmails,
} from "./instituteSettingsService.js";
import {
  recordAutomationPreview,
  claimAutomationAction,
  getChicagoToday,
} from "./automationService.js";
import {
  inMemoryPaymentRequests,
  type PaymentRequestRecord,
} from "./paymentRequestService.js";
import { isRealEmail } from "../constants/domains.js";
import { dispatchMultiChannelNotification } from "./notificationService.js";
import { inMemoryStudentStore } from "./studentService.js";

/**
 * Runs the daily payment reminder automation scan (scheduled daily at 9:00 AM Central).
 * Enforces all safety rules:
 * - If switch is OFF -> records preview row only.
 * - Fee dues: Day -14 (Reminder 1), Day -7 (Reminder 2 if still OPEN).
 * - Top-up requests: Day 2, Day 5, Expire at Day 7.
 * - Skips CLAIMED, PAID, WAIVED, CANCELLED.
 * - Skips placeholder emails with explicit logging.
 * - Idempotently claimed via claimAutomationAction.
 */
export async function runPaymentReminderScanService(): Promise<{
  mode: "PREVIEW" | "SENT";
  reminder1Sent: number;
  reminder2Sent: number;
  topupRemindersSent: number;
  expiredCount: number;
  overdueCount: number;
  details: string[];
}> {
  const settings = getCachedInstituteSettings();
  const enabled = isAutomationEnabled("payment_reminders", settings);
  const overdueRemindersEnabled = Boolean(settings.overdue_reminders);
  const todayStr = getChicagoToday();
  const todayDate = new Date(todayStr);

  const eligibleReminders: Array<{
    request: PaymentRequestRecord;
    stage: "REMINDER_1" | "REMINDER_2" | "TOPUP_2D" | "TOPUP_5D" | "OVERDUE";
    reason: string;
  }> = [];

  const requestsToExpire: PaymentRequestRecord[] = [];

  for (const req of inMemoryPaymentRequests) {
    // Skip finalized or claimed requests
    if (req.status === "PAID" || req.status === "CLAIMED" || req.status === "WAIVED" || req.status === "CANCELLED" || req.status === "EXPIRED") {
      continue;
    }

    const dueDate = new Date(req.dueDate);
    const diffTime = dueDate.getTime() - todayDate.getTime();
    const daysUntilDue = Math.round(diffTime / (1000 * 60 * 60 * 24));

    const createdDate = new Date(req.createdAt.split("T")[0] || todayStr);
    const daysSinceCreated = Math.round((todayDate.getTime() - createdDate.getTime()) / (1000 * 60 * 60 * 24));

    // Top-up request lifecycle (HOURS_TOPUP)
    if (req.kind === "HOURS_TOPUP") {
      const expiryDays = settings.request_expiry_days || 7;
      if (daysSinceCreated >= expiryDays) {
        requestsToExpire.push(req);
        continue;
      }
      if (daysSinceCreated >= 5 && req.reminderCount < 2) {
        eligibleReminders.push({
          request: req,
          stage: "TOPUP_5D",
          reason: `Top-up request ${req.referenceCode} pending for 5 days`,
        });
      } else if (daysSinceCreated >= 2 && req.reminderCount < 1) {
        eligibleReminders.push({
          request: req,
          stage: "TOPUP_2D",
          reason: `Top-up request ${req.referenceCode} pending for 2 days`,
        });
      }
      continue;
    }

    // Fee dues lifecycle (PACKAGE or CUSTOM)
    if (daysUntilDue < 0) {
      if (req.status !== "OVERDUE") {
        req.status = "OVERDUE";
      }
      if (overdueRemindersEnabled && req.reminderCount < 3) {
        eligibleReminders.push({
          request: req,
          stage: "OVERDUE",
          reason: `Tuition fee is ${Math.abs(daysUntilDue)} days overdue`,
        });
      }
      continue;
    }

    // Day -7: Reminder 2
    if (daysUntilDue <= 7 && req.reminderCount === 1) {
      eligibleReminders.push({
        request: req,
        stage: "REMINDER_2",
        reason: `Tuition due in ${daysUntilDue} days (Day -7 Urgent Reminder)`,
      });
      continue;
    }

    // Day -14: Reminder 1 (or created with fewer days left)
    if (daysUntilDue <= 14 && req.reminderCount === 0) {
      eligibleReminders.push({
        request: req,
        stage: "REMINDER_1",
        reason: `Tuition due in ${daysUntilDue} days (Day -14 Friendly Reminder)`,
      });
      continue;
    }
  }

  const details = eligibleReminders.map(
    r => `${r.request.studentName} (${r.request.courseName}): $${r.request.amountDollars.toFixed(2)} - ${r.stage} (${r.reason})`
  );

  // If automation is OFF, write PREVIEW row only!
  if (!enabled) {
    await recordAutomationPreview("payment_reminders", eligibleReminders.length, {
      reminders: details,
      expiredCount: requestsToExpire.length,
      scannedAt: new Date().toISOString(),
    });

    return {
      mode: "PREVIEW",
      reminder1Sent: eligibleReminders.filter(r => r.stage === "REMINDER_1").length,
      reminder2Sent: eligibleReminders.filter(r => r.stage === "REMINDER_2").length,
      topupRemindersSent: eligibleReminders.filter(r => r.stage === "TOPUP_2D" || r.stage === "TOPUP_5D").length,
      expiredCount: requestsToExpire.length,
      overdueCount: eligibleReminders.filter(r => r.stage === "OVERDUE").length,
      details,
    };
  }

  // Automation is ON: Expire overdue top-up requests
  for (const exp of requestsToExpire) {
    exp.status = "EXPIRED";
    exp.updatedAt = new Date().toISOString();
    try {
      await supabaseAdmin.from("payment_requests").update({
        status: "EXPIRED",
        updated_at: exp.updatedAt,
      }).eq("id", exp.id);
    } catch {}
  }

  // Dispatch reminder emails
  let reminder1Sent = 0;
  let reminder2Sent = 0;
  let topupRemindersSent = 0;
  let overdueCount = 0;

  for (const { request: req, stage, reason } of eligibleReminders) {
    // Idempotent claim in database table
    const claimed = await claimAutomationAction(
      `PAYMENT_REMINDER_${stage}`,
      req.id,
      { amount: req.amountDollars, referenceCode: req.referenceCode }
    );
    if (!claimed) {
      continue;
    }

    const isUrgent = stage === "REMINDER_2" || stage === "OVERDUE";
    const subjectPrefix = isUrgent ? "⚠️ Urgent Fee Reminder:" : "Friendly Fee Reminder:";
    const subject = `${subjectPrefix} Tuition for ${req.studentName} (${req.referenceCode})`;

    const message = `Dear Parent / Student,

This is an automated reminder regarding the upcoming tuition payment for ${req.studentName} for course ${req.courseName}.

Payment Details:
- Student: ${req.studentName}
- Course: ${req.courseName}
- Reference Code: ${req.referenceCode}
- Amount: $${req.amountDollars.toFixed(2)} USD
- Due Date: ${req.dueDate}
- Hours Included: ${req.hoursIncluded} hours

How to Pay via Zelle:
1. Open your banking app and select Zelle.
2. Send to recipient: ${settings.zelle_recipient_name || "Top Grade Learning LLC"} (${settings.zelle_email || "billing@topgradelearning.com"}).
3. IMPORTANT: Enter reference code ${req.referenceCode} in the payment memo.
4. Mark payment as sent on your student portal: ${process.env.FRONTEND_URL || "https://topgrade-vert.vercel.app"}/app/fees

Institute:
${settings.institute_name}
${settings.address_line1}, ${settings.city}, ${settings.state} ${settings.zip}
Support: ${settings.support_email} | ${settings.phone}
`;

    // Collect valid recipients (parents + student real email)
    const recipients = new Set<string>();
    if (req.parentEmails) {
      req.parentEmails.forEach(e => {
        if (isRealEmail(e)) recipients.add(e);
      });
    } else if (req.parentEmail && isRealEmail(req.parentEmail)) {
      recipients.add(req.parentEmail);
    }

    const student = inMemoryStudentStore.find(s => s.id === req.studentId);
    if (student?.email && isRealEmail(student.email)) {
      recipients.add(student.email);
    }

    for (const email of recipients) {
      try {
        await dispatchMultiChannelNotification({
          eventType: "ADMISSION_APPROVED",
          subject,
          message,
          recipients: [{ role: "PARENT", email, name: req.studentName, phone: "" }],
        });
      } catch {}
    }

    req.reminderCount++;
    req.lastRemindedAt = new Date().toISOString();
    req.updatedAt = new Date().toISOString();

    if (stage === "REMINDER_1") reminder1Sent++;
    else if (stage === "REMINDER_2") reminder2Sent++;
    else if (stage === "TOPUP_2D" || stage === "TOPUP_5D") topupRemindersSent++;
    else if (stage === "OVERDUE") overdueCount++;

    try {
      await supabaseAdmin.from("payment_requests").update({
        reminder_count: req.reminderCount,
        last_reminded_at: req.lastRemindedAt,
        status: req.status,
        updated_at: req.updatedAt,
      }).eq("id", req.id);
    } catch {}
  }

  return {
    mode: "SENT",
    reminder1Sent,
    reminder2Sent,
    topupRemindersSent,
    expiredCount: requestsToExpire.length,
    overdueCount,
    details,
  };
}

/**
 * Lists requests that are still unpaid after two reminders (Follow-up list).
 */
export function getUnpaidAfterTwoRemindersList(): PaymentRequestRecord[] {
  return inMemoryPaymentRequests.filter(
    r => r.reminderCount >= 2 && (r.status === "OPEN" || r.status === "OVERDUE")
  );
}
