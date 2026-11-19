import { supabaseAdmin } from "../supabase.js";
import { normEmail, isValidEmail, ensureLogin, createSetPasswordLink } from "./studentAccounts.js";
import { isRealEmail } from "../constants/domains.js";
import { dispatchMultiChannelNotification } from "./notificationService.js";
import { getStudentsService, inMemoryStudentStore, resolveStudent } from "./studentService.js";

export interface ParentDispatchRecipient {
  parentEmail: string;
  parentName: string;
  studentIds: string[];
  childrenNames: string[];
  status: "READY" | "ALREADY_SENT_TODAY" | "PLACEHOLDER" | "INVALID";
  skipReason?: string;
}

export interface ParentDispatchPreviewResult {
  totalStudents: number;
  uniqueParentsCount: number;
  recipients: ParentDispatchRecipient[];
  summary: {
    ready: number;
    alreadySentToday: number;
    placeholders: number;
    invalid: number;
  };
  sampleEmail: {
    subject: string;
    bodyText: string;
    sender: string;
  };
}

export interface ParentDispatchItemResult {
  parentEmail: string;
  parentName: string;
  childrenNames: string[];
  status: "SENT" | "FAILED" | "SKIPPED";
  reason?: string;
  sentAt?: string;
  actionUrl?: string;
}

export interface ParentDispatchExecuteResult {
  totalProcessed: number;
  sentCount: number;
  skippedCount: number;
  failedCount: number;
  results: ParentDispatchItemResult[];
}

/**
 * Gets today's calendar date in America/Chicago timezone (YYYY-MM-DD)
 */
function getChicagoTodayStr(): string {
  try {
    const formatter = new Intl.DateTimeFormat("en-CA", {
      timeZone: "America/Chicago",
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
    });
    return formatter.format(new Date()); // Returns YYYY-MM-DD
  } catch {
    return new Date().toISOString().split("T")[0] || "2026-11-19";
  }
}

// In-memory local fallback cache for same-day dispatches when DB is unreachable/simulated
const simulatedTodayDispatchedSet = new Set<string>();

/**
 * Checks whether an email has already been sent to this recipient today.
 */
async function hasDispatchedToday(recipientEmail: string): Promise<boolean> {
  const cleanEmail = normEmail(recipientEmail);
  if (simulatedTodayDispatchedSet.has(cleanEmail)) return true;

  const today = getChicagoTodayStr();
  try {
    const timeoutPromise = new Promise<boolean>((resolve) => setTimeout(() => resolve(false), 2000));
    const checkPromise = (async () => {
      const { data, error } = await supabaseAdmin
        .from("email_log")
        .select("id, status, created_at")
        .eq("recipient", cleanEmail)
        .in("event_type", ["PARENT_CREDENTIALS", "ADMISSION_APPROVED"])
        .eq("status", "SENT")
        .gte("created_at", `${today}T00:00:00.000Z`)
        .lte("created_at", `${today}T23:59:59.999Z`)
        .limit(1);

      if (error || !data) return false;
      return data.length > 0;
    })();
    const foundInDb = await Promise.race([checkPromise, timeoutPromise]);
    if (foundInDb) simulatedTodayDispatchedSet.add(cleanEmail);
    return foundInDb;
  } catch {
    return false;
  }
}

/**
 * Collects target students based on scope (SINGLE, SELECTED, ALL)
 */
async function collectStudentsForDispatch(params: {
  scope: "SINGLE" | "SELECTED" | "ALL";
  studentIds?: string[];
}): Promise<any[]> {
  let allStudents = inMemoryStudentStore;
  if (!allStudents || allStudents.length === 0) {
    const fetched = await getStudentsService({ refresh: true, limit: 10000 });
    allStudents = (fetched.data || []) as any[];
  }

  if (params.scope === "SINGLE" && params.studentIds?.[0]) {
    const resolved = await resolveStudent(params.studentIds[0]);
    return resolved ? [resolved] : [];
  }

  if (params.scope === "SELECTED" && Array.isArray(params.studentIds) && params.studentIds.length > 0) {
    const targetSet = new Set(params.studentIds.map(id => id.trim().toLowerCase()));
    return allStudents.filter(s =>
      targetSet.has((s.id || "").toLowerCase()) ||
      targetSet.has((s.studentCode || "").toLowerCase())
    );
  }

  // ALL: filter to ACTIVE students
  return allStudents.filter(s => (s.status || "ACTIVE").toUpperCase() === "ACTIVE");
}

/**
 * Previews parent credential dispatch: groups siblings under single parent email,
 * checks validity, placeholders, and today's dispatch history.
 */
export async function previewParentDispatchService(params: {
  scope: "SINGLE" | "SELECTED" | "ALL";
  studentIds?: string[];
  forceResend?: boolean;
}): Promise<ParentDispatchPreviewResult> {
  const students = await collectStudentsForDispatch(params);

  // Group by normalized parent email
  const parentMap = new Map<string, {
    parentEmail: string;
    parentName: string;
    studentIds: string[];
    childrenNames: string[];
  }>();

  for (const st of students) {
    const pEmails = Array.isArray(st.parentEmails) && st.parentEmails.length > 0
      ? st.parentEmails
      : (st.email ? [st.email] : []);

    for (const rawEmail of pEmails) {
      const clean = normEmail(rawEmail);
      if (!clean) continue;

      const pName = st.fatherName || st.motherName || "Parent / Guardian";
      const childName = st.fullName || "Student";

      if (!parentMap.has(clean)) {
        parentMap.set(clean, {
          parentEmail: clean,
          parentName: pName,
          studentIds: [st.id || st.studentCode],
          childrenNames: [childName],
        });
      } else {
        const existing = parentMap.get(clean)!;
        if (!existing.studentIds.includes(st.id || st.studentCode)) {
          existing.studentIds.push(st.id || st.studentCode);
        }
        if (!existing.childrenNames.includes(childName)) {
          existing.childrenNames.push(childName);
        }
      }
    }
  }

  const recipients: ParentDispatchRecipient[] = [];
  const summary = { ready: 0, alreadySentToday: 0, placeholders: 0, invalid: 0 };

  for (const [_emailKey, item] of parentMap.entries()) {
    const email = item.parentEmail;

    if (!isValidEmail(email)) {
      recipients.push({
        ...item,
        status: "INVALID",
        skipReason: "Invalid email syntax",
      });
      summary.invalid++;
      continue;
    }

    if (!isRealEmail(email)) {
      recipients.push({
        ...item,
        status: "PLACEHOLDER",
        skipReason: "Placeholder or test email domain",
      });
      summary.placeholders++;
      continue;
    }

    if (!params.forceResend) {
      const alreadySent = await hasDispatchedToday(email);
      if (alreadySent) {
        recipients.push({
          ...item,
          status: "ALREADY_SENT_TODAY",
          skipReason: "Already dispatched today (use 'Resend' to force)",
        });
        summary.alreadySentToday++;
        continue;
      }
    }

    recipients.push({
      ...item,
      status: "READY",
    });
    summary.ready++;
  }

  const sampleChildList = recipients[0]?.childrenNames?.join(", ") || "Your Student";
  const sampleEmail = {
    subject: `Set your password: TopGrade parent login`,
    bodyText: `Dear Parent,\n\nWelcome to TopGrade Learning! We have activated your parent account for ${sampleChildList}.\n\nPlease set your password using the secure link below (expires in 24 hours). Never share your password.\n\n[Set Password Link]`,
    sender: "TopGrade Learning System (via verified sender)",
  };

  return {
    totalStudents: students.length,
    uniqueParentsCount: parentMap.size,
    recipients,
    summary,
    sampleEmail,
  };
}

/**
 * Executes parent credentials dispatch: creates logins, generates recovery links,
 * throttles at ~1/sec, logs each transaction into email_log, and returns persistent results.
 */
export async function executeParentDispatchService(params: {
  scope: "SINGLE" | "SELECTED" | "ALL";
  studentIds?: string[];
  forceResend?: boolean;
}): Promise<ParentDispatchExecuteResult> {
  const preview = await previewParentDispatchService(params);
  const results: ParentDispatchItemResult[] = [];
  let sentCount = 0;
  let skippedCount = 0;
  let failedCount = 0;

  for (const recipient of preview.recipients) {
    if (recipient.status !== "READY") {
      results.push({
        parentEmail: recipient.parentEmail,
        parentName: recipient.parentName,
        childrenNames: recipient.childrenNames,
        status: "SKIPPED",
        reason: recipient.skipReason || "Skipped by policy",
        sentAt: new Date().toISOString(),
      });
      skippedCount++;
      continue;
    }

    // Rate limiting: 1 email per second
    await new Promise(resolve => setTimeout(resolve, 1000));

    try {
      // 1. Ensure login exists in Auth & Profiles (timeout-protected for offline resilience)
      await Promise.race([
        ensureLogin({
          email: recipient.parentEmail,
          fullName: recipient.parentName,
          role: "PARENT",
          metadata: {
            children: recipient.childrenNames,
            student_ids: recipient.studentIds,
          },
        }),
        new Promise((_, reject) => setTimeout(() => reject(new Error("Auth timeout")), 3000))
      ]).catch(e => {
        console.warn(`[ParentDispatch] Auth provisioning offline or skipped: ${e.message}`);
      });

      // 2. Generate secure one-time set-password link
      let actionLink: string | null = null;
      try {
        actionLink = await Promise.race([
          createSetPasswordLink(recipient.parentEmail),
          new Promise<null>((resolve) => setTimeout(() => resolve(null), 3000))
        ]);
      } catch {
        actionLink = null;
      }

      if (!actionLink) {
        // Fallback in local/simulated test mode
        const isSim = process.env.SIMULATE_EMAILS === "true" || process.env.NODE_ENV !== "production";
        if (isSim) {
          actionLink = `http://localhost:5173/set-password?type=recovery&email=${encodeURIComponent(recipient.parentEmail)}`;
        } else {
          throw new Error("Unable to generate set-password link from Supabase Auth service.");
        }
      }

      // 3. Dispatch notification
      const childrenPhrase = recipient.childrenNames.length > 1
        ? `your children (${recipient.childrenNames.join(", ")})`
        : `your child (${recipient.childrenNames[0] || "your student"})`;

      const subject = `Set your password: TopGrade parent login for ${recipient.childrenNames.join(", ")}`;
      const message =
        `Dear ${recipient.parentName},\n\n` +
        `Welcome to TopGrade Learning! We have created your official Parent Portal login for ${childrenPhrase}.\n\n` +
        `Please use the secure link below to set your password. This link is single-use and will expire soon:\n` +
        `${actionLink}\n\n` +
        `Login Email: ${recipient.parentEmail}\n\n` +
        `Through the TopGrade Parent Portal, you can track course progress, view schedules, verify attendance, and manage fee dues.\n\n` +
        `Warm regards,\nTopGrade Learning Administration`;

      await dispatchMultiChannelNotification({
        eventType: "ADMISSION_APPROVED", // maps to PARENT_CREDENTIALS in logs
        subject,
        message,
        actionUrl: actionLink,
        escapeMessage: true,
        recipients: [
          {
            role: "PARENT",
            email: recipient.parentEmail,
            name: recipient.parentName,
            phone: "",
          },
        ],
      });

      simulatedTodayDispatchedSet.add(normEmail(recipient.parentEmail));
      results.push({
        parentEmail: recipient.parentEmail,
        parentName: recipient.parentName,
        childrenNames: recipient.childrenNames,
        status: "SENT",
        sentAt: new Date().toISOString(),
        actionUrl: actionLink,
      });
      sentCount++;
    } catch (err: any) {
      console.error(`[ParentDispatch] Error sending to ${recipient.parentEmail}:`, err.message);
      results.push({
        parentEmail: recipient.parentEmail,
        parentName: recipient.parentName,
        childrenNames: recipient.childrenNames,
        status: "FAILED",
        reason: err.message || "Failed to dispatch email",
        sentAt: new Date().toISOString(),
      });
      failedCount++;
    }
  }

  return {
    totalProcessed: preview.recipients.length,
    sentCount,
    skippedCount,
    failedCount,
    results,
  };
}
