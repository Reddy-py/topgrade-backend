import crypto from "crypto";
import { supabaseAdmin } from "../supabase.js";
import { dispatchMultiChannelNotification } from "./notificationService.js";

/**
 * Logins for students and parents.
 *  - One login per email address. A parent email always makes a PARENT login (father and mother = two logins).
 *  - A parent with several children keeps ONE login: the same email is reused for each child.
 *  - Nobody gets a default password. Every new login gets a random password nobody sees, plus an email with a
 *    one-time "set your password" link.
 */

export type LoginRole = "STUDENT" | "PARENT" | "TEACHER" | "ADMIN";

export const normEmail = (e: unknown): string => String(e ?? "").trim().toLowerCase();
export const isValidEmail = (e: string): boolean => /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(e);

const frontendUrl = (): string => (process.env.FRONTEND_URL || "http://localhost:5173").replace(/\/+$/, "");

export const randomPassword = (): string => crypto.randomBytes(24).toString("base64url");

async function findAuthUserIdByEmail(email: string): Promise<string | null> {
  for (let page = 1; page <= 20; page++) {
    const { data, error } = await supabaseAdmin.auth.admin.listUsers({ page, perPage: 1000 });
    if (error || !data?.users?.length) return null;
    const hit = data.users.find(u => normEmail(u.email) === email);
    if (hit) return hit.id;
    if (data.users.length < 1000) return null;
  }
  return null;
}

export interface EnsuredLogin {
  userId: string;
  created: boolean; // false = this email already had a login of the same role (for example a parent's second child)
}

/** Makes sure one login exists for this email and role. Throws if the email belongs to a different role. */
export async function ensureLogin(params: {
  email: string;
  fullName: string;
  role: LoginRole;
  metadata?: Record<string, unknown>;
}): Promise<EnsuredLogin> {
  const email = normEmail(params.email);

  const { data: existing } = await supabaseAdmin
    .from("profiles")
    .select("id, role")
    .eq("email", email)
    .maybeSingle();
  if (existing) {
    if (String(existing.role).toUpperCase() !== params.role) {
      throw new Error(`${email} is already used by a ${String(existing.role).toLowerCase()} login. Use a different email.`);
    }
    return { userId: existing.id as string, created: false };
  }

  let userId: string | null = null;
  let created = false;
  const { data: createdUser, error: createErr } = await supabaseAdmin.auth.admin.createUser({
    email,
    password: randomPassword(),
    email_confirm: true,
    user_metadata: { full_name: params.fullName, role: params.role, ...(params.metadata || {}) },
  });
  if (createdUser?.user) {
    userId = createdUser.user.id;
    created = true;
  } else {
    userId = await findAuthUserIdByEmail(email);
    if (!userId) throw new Error(`Could not create a login for ${email}: ${createErr?.message || "unknown error"}`);
  }

  const { error: profErr } = await supabaseAdmin.from("profiles").upsert(
    { id: userId, email, full_name: params.fullName, role: params.role, status: "Active", updated_at: new Date().toISOString() },
    { onConflict: "id" }
  );
  if (profErr) {
    if (created) await supabaseAdmin.auth.admin.deleteUser(userId).catch(() => undefined);
    throw new Error(`Could not save the profile for ${email}: ${profErr.message}`);
  }
  return { userId, created };
}

export async function deleteLogin(userId: string): Promise<void> {
  await supabaseAdmin.auth.admin.deleteUser(userId).catch(() => undefined);
}

/** One-time link that lets the person choose their own password. Expiry follows the Supabase email OTP setting. */
export async function createSetPasswordLink(email: string): Promise<string | null> {
  const { data, error } = await supabaseAdmin.auth.admin.generateLink({
    type: "recovery",
    email: normEmail(email),
    options: { redirectTo: `${frontendUrl()}/set-password` },
  });
  if (error) {
    console.warn("generateLink notice:", error.message);
    return null;
  }
  return data?.properties?.action_link ?? null;
}

/** Emails the set-password link. Returns false if the link could not be created. The link is never logged. */
export async function emailSetPasswordLink(params: {
  email: string;
  name: string;
  role: LoginRole;
  childName?: string;
}): Promise<boolean> {
  const link = await createSetPasswordLink(params.email);
  if (!link) return false;

  const account = params.role === "PARENT"
    ? `your parent login${params.childName ? ` for ${params.childName}` : ""}`
    : params.role === "TEACHER" ? "your teacher login"
    : params.role === "ADMIN" ? "your administrator login"
    : "your student login";
  const roleWord = params.role.toLowerCase();

  await dispatchMultiChannelNotification({
    eventType: "ADMISSION_APPROVED",
    subject: `Set your password: TopGrade ${roleWord} login`,
    message:
      `Dear ${params.name},\n\nWelcome to TopGrade Learning. We created ${account}.\n\n` +
      `Please choose your own password using this link. It can be used once and it expires, ` +
      `so if it no longer works, ask the institute to send a new one:\n${link}\n\n` +
      `Your login email: ${normEmail(params.email)}\n\nIf you were not expecting this email, you can ignore it.`,
    smsMessage: "Your TopGrade login was created. Check your email to set your password.",
    escapeMessage: true,
    actionUrl: link,
    recipients: [{ role: params.role, email: normEmail(params.email), name: params.name, phone: "" }],
  });
  return true;
}
