import { supabaseAdmin } from "../supabase.js";

export type EmailKind = "BIRTHDAY" | "TEACHER_BIRTHDAY" | "EXAM_GOOD_LUCK" | "STUDENT_ADDED" | "STUDENT_UPDATED";
export type EmailStatus = "sending" | "sent" | "failed" | "simulated";

const STUCK_AFTER_MS = 15 * 60 * 1000; // a "sending" row older than this means the server stopped mid-send

export interface EmailLogRow {
  id: string;
  kind: EmailKind;
  subject_key: string;
  send_date: string;
  recipients: string[];
  subject: string | null;
  status: EmailStatus;
  error: string | null;
  created_at: string;
}

/**
 * For once-a-day emails: reserves "this email, about this person, on this day".
 * Returns the log id when you may send, or null when it was already sent (or is being sent) today.
 * A failed or stuck earlier attempt is taken over so it is retried.
 */
export async function claimEmail(
  kind: EmailKind,
  subjectKey: string,
  sendDate: string,
  recipients: string[],
  subject: string
): Promise<string | null> {
  const { data, error } = await supabaseAdmin
    .from("email_log")
    .insert({ kind, subject_key: subjectKey, send_date: sendDate, recipients, subject, status: "sending" })
    .select("id")
    .single();
  if (!error && data) return data.id as string;

  if (error?.code !== "23505") {
    throw new Error(`email_log is not available (run migration 20261012_email_log.sql): ${error?.message}`);
  }

  // Already has a row for today: retry only if that attempt failed or got stuck.
  const { data: existing } = await supabaseAdmin
    .from("email_log")
    .select("id, status, updated_at")
    .eq("kind", kind).eq("subject_key", subjectKey).eq("send_date", sendDate)
    .maybeSingle();
  if (!existing) return null;
  const stuck = existing.status === "sending" && Date.now() - new Date(existing.updated_at as string).getTime() > STUCK_AFTER_MS;
  if (existing.status !== "failed" && !stuck) return null;

  const { data: taken } = await supabaseAdmin
    .from("email_log")
    .update({ status: "sending", error: null, recipients, subject, updated_at: new Date().toISOString() })
    .eq("id", existing.id)
    .in("status", ["failed", "sending"])
    .select("id")
    .maybeSingle();
  return taken ? (taken.id as string) : null;
}

export async function finishEmail(id: string, status: Exclude<EmailStatus, "sending">, error?: string): Promise<void> {
  const { error: upErr } = await supabaseAdmin
    .from("email_log")
    .update({ status, error: error ?? null, updated_at: new Date().toISOString() })
    .eq("id", id);
  if (upErr) console.warn("email_log update notice:", upErr.message);
}

/** For emails that may be sent many times a day (added / updated). Never throws. */
export async function logEmail(
  kind: EmailKind,
  subjectKey: string,
  sendDate: string,
  recipients: string[],
  subject: string,
  status: Exclude<EmailStatus, "sending">,
  error?: string
): Promise<void> {
  const { error: insErr } = await supabaseAdmin
    .from("email_log")
    .insert({ kind, subject_key: subjectKey, send_date: sendDate, recipients, subject, status, error: error ?? null });
  if (insErr) console.warn("email_log insert notice:", insErr.message);
}

export async function listEmailLog(limit = 200): Promise<EmailLogRow[]> {
  const { data, error } = await supabaseAdmin
    .from("email_log")
    .select("*")
    .order("created_at", { ascending: false })
    .limit(limit);
  if (error) throw new Error(error.message);
  return (data || []) as EmailLogRow[];
}

/** Result of one dispatch, turned into a log status. */
export function statusFromDispatch(result: { sent: number; failed: number; simulated: number }): Exclude<EmailStatus, "sending"> {
  if (result.failed > 0) return "failed";
  if (result.sent > 0) return "sent";
  return "simulated";
}
