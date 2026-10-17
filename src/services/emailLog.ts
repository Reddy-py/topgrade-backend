import { supabaseAdmin } from "../supabase.js";
import { dispatchMultiChannelNotification, type DispatchResult } from "./notificationService.js";

export type EmailKind =
  | "NEW_STUDENT_REGISTERED"
  | "STUDENT_ADDED"
  | "STUDENT_UPDATED"
  | "CLASS_SCHEDULE_EVENT"
  | "CLASS_REMINDER_24H"
  | "TEACHER_DAILY_AGENDA"
  | "ATTENDANCE_DAILY"
  | "ATTENDANCE_MONTHLY"
  | "LOW_HOURS_ALERT"
  | "HOURS_OWED_ALERT"
  | "PACKAGE_EXPIRING_7D"
  | "PACKAGE_EXPIRED"
  | "BIRTHDAY"
  | "TEACHER_BIRTHDAY"
  | "TEACHER_ASSIGNMENT"
  | "MONTHLY_PROGRESS"
  | "ANNOUNCEMENT"
  | "ADMIN_DAILY_DIGEST"
  | "EXAM_GOOD_LUCK"
  | string;

export type EmailStatus = "sending" | "sent" | "failed" | "simulated";

const STUCK_AFTER_MS = 15 * 60 * 1000;
export const MAX_AUTO_RETRIES = 3;

export interface EmailLogRow {
  id: string;
  kind: EmailKind;
  subject_key: string;
  send_date: string;
  recipients: string[];
  subject: string | null;
  status: EmailStatus;
  error: string | null;
  retry_count: number;
  next_retry_at: string | null;
  body_preview: string;
  metadata: Record<string, any>;
  created_at: string;
  updated_at: string;
}

/**
 * Calculates exponential backoff for retries over 24 hours:
 * Retry 1: 15 minutes
 * Retry 2: 2 hours
 * Retry 3: 6 hours
 */
function getNextRetryTime(retryCount: number): string {
  const delays = [15 * 60 * 1000, 2 * 60 * 60 * 1000, 6 * 60 * 60 * 1000];
  const delayMs = delays[Math.min(retryCount - 1, delays.length - 1)] || 60 * 60 * 1000;
  return new Date(Date.now() + delayMs).toISOString();
}

/** Helper to generate clean unique IDs */
function generateId(): string {
  try {
    return crypto.randomUUID();
  } catch {
    return `log-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;
  }
}

// Dual-layer store: In-memory tracker ensures atomic guarantees and delivery log access
// even during migrations, testing, or database schema updates.
const inMemoryLogs: EmailLogRow[] = [];
const inMemoryClaims = new Map<string, { id: string; expiresAt: number; status: EmailStatus }>();

/**
 * For once-a-day timed emails: reserves "this email, about this person, on this day".
 * Returns the log id when allowed to send, or null if already sent or successfully claimed.
 */
export async function claimEmail(
  kind: EmailKind,
  subjectKey: string,
  sendDate: string,
  recipients: string[],
  subject: string,
  bodyPreview = "",
  metadata: Record<string, any> = {}
): Promise<string | null> {
  const claimKey = `${kind}:${subjectKey}:${sendDate}`;
  const now = Date.now();

  // 1. Check in-memory claim lock first
  const memClaim = inMemoryClaims.get(claimKey);
  if (memClaim) {
    if (memClaim.status === "sent" || memClaim.status === "simulated") {
      return null; // Already delivered today
    }
    if (memClaim.status === "sending" && now < memClaim.expiresAt) {
      return null; // Concurrently sending right now
    }
  }

  const newId = generateId();
  let dbClaimId: string | null = null;

  // 2. Attempt DB claim
  try {
    const { data, error } = await supabaseAdmin
      .from("email_log")
      .insert({
        id: newId,
        kind,
        subject_key: subjectKey,
        send_date: sendDate,
        recipients,
        subject,
        status: "sending",
        body_preview: bodyPreview.slice(0, 500),
        metadata,
        retry_count: 0
      })
      .select("id")
      .single();

    if (!error && data) {
      dbClaimId = data.id as string;
    } else if (error?.message?.includes("retry_count")) {
      // Baseline table fallback
      const { data: bData } = await supabaseAdmin
        .from("email_log")
        .insert({
          id: newId,
          kind,
          subject_key: subjectKey,
          send_date: sendDate,
          recipients,
          subject,
          status: "sending"
        })
        .select("id")
        .single();
      if (bData) dbClaimId = bData.id as string;
    } else if (error?.code === "23505") {
      // Unique conflict: check if failed or stuck
      const { data: existing } = await supabaseAdmin
        .from("email_log")
        .select("id, status, updated_at")
        .eq("kind", kind)
        .eq("subject_key", subjectKey)
        .eq("send_date", sendDate)
        .maybeSingle();

      if (existing) {
        const stuck = existing.status === "sending" && now - new Date(existing.updated_at as string).getTime() > STUCK_AFTER_MS;
        if (existing.status === "failed" || stuck) {
          const { data: taken } = await supabaseAdmin
            .from("email_log")
            .update({ status: "sending", updated_at: new Date().toISOString() })
            .eq("id", existing.id)
            .select("id")
            .maybeSingle();
          if (taken) dbClaimId = taken.id as string;
        } else {
          return null; // DB confirms already delivered today
        }
      }
    }
  } catch (err: any) {
    console.warn("Notice in claimEmail DB:", err?.message);
  }

  const effectiveId = dbClaimId || newId;

  // Reserve claim in-memory
  inMemoryClaims.set(claimKey, {
    id: effectiveId,
    expiresAt: now + STUCK_AFTER_MS,
    status: "sending"
  });

  // Track in inMemoryLogs
  inMemoryLogs.unshift({
    id: effectiveId,
    kind,
    subject_key: subjectKey,
    send_date: sendDate,
    recipients,
    subject,
    status: "sending",
    error: null,
    retry_count: 0,
    next_retry_at: null,
    body_preview: bodyPreview.slice(0, 500),
    metadata,
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString()
  });
  if (inMemoryLogs.length > 500) inMemoryLogs.pop();

  return effectiveId;
}

/**
 * Completes an email send attempt, handling status transitions and retry scheduling.
 */
export async function finishEmail(
  id: string,
  status: Exclude<EmailStatus, "sending">,
  error?: string
): Promise<void> {
  const retryCount = status === "failed" ? 1 : 0;
  const nextRetry = status === "failed" ? getNextRetryTime(1) : null;

  // Update in-memory claims
  for (const [key, val] of inMemoryClaims.entries()) {
    if (val.id === id) {
      val.status = status;
      break;
    }
  }

  // Update in-memory log
  const memLog = inMemoryLogs.find(l => l.id === id);
  if (memLog) {
    memLog.status = status;
    memLog.error = error ?? null;
    memLog.retry_count = retryCount;
    memLog.next_retry_at = nextRetry;
    memLog.updated_at = new Date().toISOString();
  }

  try {
    const patch: any = {
      status,
      error: error ?? null,
      updated_at: new Date().toISOString()
    };
    if (status === "failed") {
      patch.retry_count = retryCount;
      patch.next_retry_at = nextRetry;
    }
    await supabaseAdmin.from("email_log").update(patch).eq("id", id);
  } catch (err: any) {
    console.warn("Notice updating email_log in DB:", err?.message);
  }
}

/**
 * Direct log entry for instant event-driven emails (e.g. registration, class changes, announcements).
 */
export async function logEmail(
  kind: EmailKind,
  subjectKey: string,
  sendDate: string,
  recipients: string[],
  subject: string,
  status: Exclude<EmailStatus, "sending">,
  error?: string,
  bodyPreview = "",
  metadata: Record<string, any> = {}
): Promise<string | null> {
  const generatedId = generateId();
  const retryCount = status === "failed" ? 1 : 0;
  const nextRetry = status === "failed" ? getNextRetryTime(1) : null;

  const row: EmailLogRow = {
    id: generatedId,
    kind,
    subject_key: subjectKey,
    send_date: sendDate,
    recipients,
    subject: subject || null,
    status,
    error: error ?? null,
    retry_count: retryCount,
    next_retry_at: nextRetry,
    body_preview: bodyPreview.slice(0, 500),
    metadata,
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString()
  };

  inMemoryLogs.unshift(row);
  if (inMemoryLogs.length > 500) inMemoryLogs.pop();

  const claimKey = `${kind}:${subjectKey}:${sendDate}`;
  inMemoryClaims.set(claimKey, { id: generatedId, expiresAt: Date.now() + STUCK_AFTER_MS, status });

  try {
    const { data, error: insErr } = await supabaseAdmin
      .from("email_log")
      .insert({
        id: generatedId,
        kind,
        subject_key: subjectKey,
        send_date: sendDate,
        recipients,
        subject,
        status,
        error: error ?? null,
        body_preview: bodyPreview.slice(0, 500),
        metadata,
        retry_count: retryCount,
        next_retry_at: nextRetry
      })
      .select("id")
      .single();

    if (insErr && insErr.message?.includes("retry_count")) {
      await supabaseAdmin.from("email_log").insert({
        id: generatedId,
        kind,
        subject_key: subjectKey,
        send_date: sendDate,
        recipients,
        subject,
        status,
        error: error ?? null
      });
    }

    return data ? (data.id as string) : generatedId;
  } catch {
    return generatedId;
  }
}

/**
 * Fetches email delivery logs with rich filtering and pagination.
 */
export async function listEmailLogs(params: {
  status?: string | undefined;
  kind?: string | undefined;
  search?: string | undefined;
  limit?: number | undefined;
  offset?: number | undefined;
} = {}): Promise<{ logs: EmailLogRow[]; total: number }> {
  const limit = params.limit || 100;
  const offset = params.offset || 0;

  let dbLogs: EmailLogRow[] = [];
  let dbTotal = 0;

  try {
    let q = supabaseAdmin.from("email_log").select("*", { count: "exact" });

    if (params.status && params.status !== "ALL") {
      q = q.eq("status", params.status.toLowerCase());
    }
    if (params.kind && params.kind !== "ALL") {
      q = q.eq("kind", params.kind);
    }
    if (params.search) {
      const s = params.search.trim().toLowerCase();
      q = q.or(`subject.ilike.%${s}%,recipients.cs.{"${s}"},subject_key.ilike.%${s}%`);
    }

    q = q.order("created_at", { ascending: false }).range(offset, offset + limit - 1);
    const { data, count, error } = await q;
    if (!error && data) {
      dbLogs = data as EmailLogRow[];
      dbTotal = count || 0;
    }
  } catch (err: any) {
    console.warn("Notice in listEmailLogs DB:", err?.message);
  }

  // Merge in-memory logs (preserving most recent and unique IDs)
  const seenIds = new Set(dbLogs.map(l => l.id));
  const merged = [...dbLogs];

  for (const mLog of inMemoryLogs) {
    if (seenIds.has(mLog.id)) continue;

    // Apply filters to in-memory log
    if (params.status && params.status !== "ALL" && mLog.status !== params.status.toLowerCase()) {
      continue;
    }
    if (params.kind && params.kind !== "ALL" && mLog.kind !== params.kind) {
      continue;
    }
    if (params.search) {
      const s = params.search.toLowerCase();
      const matchSubject = (mLog.subject || "").toLowerCase().includes(s);
      const matchKey = (mLog.subject_key || "").toLowerCase().includes(s);
      const matchRecip = (mLog.recipients || []).some(r => r.toLowerCase().includes(s));
      if (!matchSubject && !matchKey && !matchRecip) continue;
    }

    seenIds.add(mLog.id);
    merged.push(mLog);
  }

  // Sort by created_at descending
  merged.sort((a, b) => new Date(b.created_at || 0).getTime() - new Date(a.created_at || 0).getTime());

  const paginated = merged.slice(offset, offset + limit);
  return {
    logs: paginated,
    total: Math.max(dbTotal, merged.length)
  };
}

/**
 * Retries a specific failed email by ID (Admin Manual Retry).
 */
export async function retryEmail(id: string): Promise<{ success: boolean; status: EmailStatus; error?: string | undefined }> {
  let emailRow: EmailLogRow | null = inMemoryLogs.find(l => l.id === id) || null;

  if (!emailRow) {
    const { data: row } = await supabaseAdmin
      .from("email_log")
      .select("*")
      .eq("id", id)
      .maybeSingle();
    if (row) emailRow = row as EmailLogRow;
  }

  if (!emailRow) {
    throw new Error(`Email log record '${id}' not found.`);
  }

  const recipients = (emailRow.recipients || []).map(r => ({
    role: "PARENT" as const,
    email: r,
    name: "Recipient",
    phone: ""
  }));

  if (recipients.length === 0) {
    throw new Error("No recipient addresses found on email log record.");
  }

  // Attempt dispatch
  const result: DispatchResult = await dispatchMultiChannelNotification({
    eventType: "ADMISSION_APPROVED",
    subject: emailRow.subject || "Notification",
    message: emailRow.body_preview || "Notification details",
    recipients
  });

  const newStatus = statusFromDispatch(result);
  const errMessage = result.failures.join("; ") || undefined;
  const updatedRetryCount = (emailRow.retry_count || 0) + 1;
  const nextRetry = newStatus === "failed" && updatedRetryCount < MAX_AUTO_RETRIES ? getNextRetryTime(updatedRetryCount) : null;

  // Update in-memory log
  emailRow.status = newStatus;
  emailRow.error = errMessage ?? null;
  emailRow.retry_count = updatedRetryCount;
  emailRow.next_retry_at = nextRetry;
  emailRow.updated_at = new Date().toISOString();

  // Update DB
  try {
    await supabaseAdmin
      .from("email_log")
      .update({
        status: newStatus,
        error: errMessage ?? null,
        retry_count: updatedRetryCount,
        next_retry_at: nextRetry,
        updated_at: new Date().toISOString()
      })
      .eq("id", id);
  } catch (err: any) {
    console.warn("Notice updating retry in DB:", err?.message);
  }

  return {
    success: newStatus !== "failed",
    status: newStatus,
    error: errMessage
  };
}

/**
 * Background auto-retry job:
 * Scans for failed emails where retry_count < 3 and next_retry_at <= now(), retrying them over the course of a day.
 */
export async function processEmailRetries(): Promise<{ retried: number; recovered: number; stillFailed: number }> {
  const nowIso = new Date().toISOString();
  let candidates: EmailLogRow[] = [];

  try {
    const { data } = await supabaseAdmin
      .from("email_log")
      .select("*")
      .eq("status", "failed")
      .lt("retry_count", MAX_AUTO_RETRIES)
      .lte("next_retry_at", nowIso)
      .limit(50);
    if (data) candidates = data as EmailLogRow[];
  } catch (err: any) {
    console.warn("Notice querying DB retries:", err?.message);
  }

  // Merge in-memory candidates
  for (const m of inMemoryLogs) {
    if (m.status === "failed" && (m.retry_count || 0) < MAX_AUTO_RETRIES) {
      if (!m.next_retry_at || m.next_retry_at <= nowIso) {
        if (!candidates.some(c => c.id === m.id)) {
          candidates.push(m);
        }
      }
    }
  }

  if (candidates.length === 0) {
    return { retried: 0, recovered: 0, stillFailed: 0 };
  }

  let retried = 0;
  let recovered = 0;
  let stillFailed = 0;

  for (const row of candidates) {
    retried++;
    try {
      const res = await retryEmail(row.id);
      if (res.success) {
        recovered++;
      } else {
        stillFailed++;
      }
    } catch (err: any) {
      stillFailed++;
      console.warn(`Retry failed for email ${row.id}:`, err?.message);
    }
  }

  return { retried, recovered, stillFailed };
}

/** Status mapping helper */
export function statusFromDispatch(result: { sent: number; failed: number; simulated: number }): Exclude<EmailStatus, "sending"> {
  if (result.failed > 0) return "failed";
  if (result.sent > 0) return "sent";
  return "simulated";
}

export const listEmailLog = listEmailLogs;
