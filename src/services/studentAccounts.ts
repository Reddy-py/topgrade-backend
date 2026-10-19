import crypto from "crypto";
import { supabaseAdmin } from "../supabase.js";
import { dispatchMultiChannelNotification } from "./notificationService.js";
import { isRealEmail } from "../constants/domains.js";
import { parseEnv } from "../utils/parseEnv.js";
import { invalidateProfileCache } from "../middleware/auth.js";
import { inMemoryStudentStore } from "./studentService.js";

/**
 * Logins for students, parents, teachers, and admins.
 *  - One login per email address.
 *  - A parent with several children keeps ONE login: the same email is reused for each child.
 *  - Supports initial password with must_change_password flag, or random password with set-password email.
 */

export type LoginRole = "STUDENT" | "PARENT" | "TEACHER" | "ADMIN";

export const normEmail = (e: unknown): string => String(e ?? "").trim().toLowerCase();
export const isValidEmail = (e: string): boolean => /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(e);

const frontendUrl = (): string => (parseEnv("FRONTEND_URL", "http://localhost:5173")!).replace(/\/+$/, "");

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
  created: boolean; // false = this email already had a login of the same role
}

/** Makes sure one login exists for this email and role. Throws if the email belongs to a different role. */
export async function ensureLogin(params: {
  email: string;
  fullName: string;
  role: LoginRole;
  phone?: string | undefined;
  initialPassword?: string | undefined;
  mustChangePassword?: boolean | undefined;
  metadata?: Record<string, unknown>;
}): Promise<EnsuredLogin> {
  const email = normEmail(params.email);

  const { data: existing } = await supabaseAdmin
    .from("profiles")
    .select("id, role, must_change_password")
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
  const initialPw = params.initialPassword || randomPassword();
  const { data: createdUser, error: createErr } = await supabaseAdmin.auth.admin.createUser({
    email,
    password: initialPw,
    email_confirm: true,
    user_metadata: {
      full_name: params.fullName,
      role: params.role,
      ...(params.phone ? { phone: params.phone } : {}),
      ...(params.metadata || {})
    },
  });

  if (createdUser?.user) {
    userId = createdUser.user.id;
    created = true;
  } else {
    userId = await findAuthUserIdByEmail(email);
    if (!userId) throw new Error(`Could not create a login for ${email}: ${createErr?.message || "unknown error"}`);
  }

  const { error: profErr } = await supabaseAdmin.from("profiles").upsert(
    {
      id: userId,
      email,
      full_name: params.fullName,
      role: params.role,
      status: "Active",
      phone: params.phone || null,
      must_change_password: params.mustChangePassword ?? false,
      updated_at: new Date().toISOString()
    },
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
  const cleanEmail = normEmail(params.email);
  if (!isRealEmail(cleanEmail)) {
    return false; // Never send email to placeholder domains
  }

  const link = await createSetPasswordLink(cleanEmail);
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
      `Your login email: ${cleanEmail}\n\nIf you were not expecting this email, you can ignore it.`,
    smsMessage: "Your TopGrade login was created. Check your email to set your password.",
    escapeMessage: true,
    actionUrl: link,
    recipients: [{ role: params.role, email: cleanEmail, name: params.name, phone: "" }],
  });
  return true;
}

/**
 * Validates password rules:
 * - 8 or more characters
 * - at least one letter and at least one number
 * - must differ from initial password
 */
export function validateNewPassword(newPassword: string, currentPassword?: string): { valid: boolean; error?: string } {
  if (!newPassword || typeof newPassword !== "string") {
    return { valid: false, error: "New password is required." };
  }
  const clean = newPassword.trim();
  if (clean.length < 8) {
    return { valid: false, error: "Password must be at least 8 characters long." };
  }
  if (!/[a-zA-Z]/.test(clean)) {
    return { valid: false, error: "Password must contain at least one letter." };
  }
  if (!/[0-9]/.test(clean)) {
    return { valid: false, error: "Password must contain at least one number." };
  }

  const forbiddenInitialPasswords = [
    (currentPassword || "").trim(),
    (parseEnv("ADMIN_INITIAL_PASSWORD") || "").trim(),
    (parseEnv("DEFAULT_INITIAL_PASSWORD") || "").trim(),
    "TopGrade2026!"
  ].filter(p => p.length > 0);

  for (const forbidden of forbiddenInitialPasswords) {
    if (clean === forbidden) {
      return { valid: false, error: "New password must differ from the initial password." };
    }
  }

  return { valid: true };
}

/**
 * Universal password change service for ANY authenticated role.
 * Updates password in Supabase Auth, clears must_change_password flag in profiles,
 * and invalidates cached profile.
 */
export async function changeUserPassword(params: {
  userId?: string | undefined;
  email?: string | undefined;
  newPassword: string;
  currentPassword?: string | undefined;
}): Promise<{ success: boolean; message: string }> {
  const { newPassword, currentPassword } = params;
  const validation = validateNewPassword(newPassword, currentPassword);
  if (!validation.valid) {
    throw new Error(validation.error || "Password validation failed.");
  }

  const queryEmail = normEmail(params.email);
  let profile: any = null;

  if (params.userId) {
    const { data } = await supabaseAdmin.from("profiles").select("*").eq("id", params.userId).maybeSingle();
    profile = data;
  }
  if (!profile && queryEmail) {
    const { data } = await supabaseAdmin.from("profiles").select("*").eq("email", queryEmail).maybeSingle();
    profile = data;
  }

  if (!profile) {
    throw new Error("User profile not found. Please verify your login credentials.");
  }

  const { error: pwErr } = await supabaseAdmin.auth.admin.updateUserById(profile.id, {
    password: newPassword.trim()
  });
  if (pwErr) {
    throw new Error(`Failed to update password in authentication system: ${pwErr.message}`);
  }

  // Clear must_change_password flag
  await supabaseAdmin
    .from("profiles")
    .update({
      must_change_password: false,
      updated_at: new Date().toISOString()
    })
    .eq("id", profile.id);

  invalidateProfileCache(profile.id);

  // If student dossier exists in memory or DB, update flag
  const inMem = inMemoryStudentStore.find(
    s => s.id === profile.id ||
         (queryEmail && (s.email || "").toLowerCase() === queryEmail) ||
         (s.studentEmails || []).some(e => e.toLowerCase() === queryEmail)
  );
  if (inMem) {
    inMem.hasChangedPassword = true;
    inMem.passwordChangedCount = (inMem.passwordChangedCount || 0) + 1;
    inMem.passwordUpdatedAt = new Date().toISOString();
  }

  return { success: true, message: "Password updated successfully. Forced change requirement cleared." };
}

/**
 * Step 5 Bulk Admin Action: 'Send secure login link' for selected parents and students with a REAL email.
 * Sets a random password (invalidating the shared one), clears nothing else, and sends set-password email.
 */
export async function bulkSendSecureLoginLinks(targets: string[]): Promise<{
  total: number;
  sent: number;
  skippedPlaceholder: number;
  failed: number;
  details: Array<{ email: string; status: "SENT" | "SKIPPED_PLACEHOLDER" | "FAILED"; message?: string }>;
}> {
  let sent = 0;
  let skippedPlaceholder = 0;
  let failed = 0;
  const details: Array<{ email: string; status: "SENT" | "SKIPPED_PLACEHOLDER" | "FAILED"; message?: string }> = [];

  for (const t of targets) {
    const clean = normEmail(t);
    if (!clean) continue;

    // Look up profile
    const { data: prof } = await supabaseAdmin
      .from("profiles")
      .select("id, email, full_name, role")
      .or(`email.eq.${clean},id.eq.${clean}`)
      .maybeSingle();

    if (!prof) {
      failed++;
      details.push({ email: clean, status: "FAILED", message: "Account not found." });
      continue;
    }

    const email = normEmail(prof.email);
    if (!isRealEmail(email)) {
      skippedPlaceholder++;
      details.push({ email, status: "SKIPPED_PLACEHOLDER", message: "Placeholder email cannot receive set-password links." });
      continue;
    }

    try {
      // Invalidate the shared password with a random secure password
      const randPw = randomPassword();
      await supabaseAdmin.auth.admin.updateUserById(prof.id, { password: randPw });

      // Send the official set-password link
      const emailed = await emailSetPasswordLink({
        email,
        name: prof.full_name || "Valued Member",
        role: (prof.role || "PARENT").toUpperCase() as LoginRole
      });

      if (emailed) {
        sent++;
        details.push({ email, status: "SENT" });
      } else {
        failed++;
        details.push({ email, status: "FAILED", message: "Mailer dispatch failed." });
      }
    } catch (err: any) {
      failed++;
      details.push({ email, status: "FAILED", message: err.message || "Unknown error." });
    }
  }

  return { total: targets.length, sent, skippedPlaceholder, failed, details };
}

/**
 * Step 5 Admin List: 'Never signed in' (accounts that have must_change_password = true).
 */
export async function listNeverSignedInAccounts(): Promise<{ count: number; accounts: any[] }> {
  const { data, error } = await supabaseAdmin
    .from("profiles")
    .select("id, email, full_name, role, status, phone, must_change_password, created_at, updated_at")
    .eq("must_change_password", true)
    .order("created_at", { ascending: false });

  if (error) {
    throw new Error(`Failed to list accounts requiring password change: ${error.message}`);
  }

  const accounts = (data || []).map(a => ({
    ...a,
    is_placeholder: !isRealEmail(a.email)
  }));

  return { count: accounts.length, accounts };
}

/**
 * Step 6: When admin later enters a real parent or student email on the edit form,
 * RENAME the existing login (auth email and profile) instead of creating a second one,
 * keep all links, and show placeholder emails as empty on every form.
 */
export async function renameUserLogin(
  oldEmailOrUserId: string,
  newRealEmail: string
): Promise<{ success: boolean; userId: string; oldEmail: string; newEmail: string }> {
  const cleanTarget = normEmail(oldEmailOrUserId);
  const cleanNewEmail = normEmail(newRealEmail);

  if (!cleanNewEmail || !isRealEmail(cleanNewEmail)) {
    throw new Error(`'${newRealEmail}' is not a valid real email address.`);
  }

  // Find profile
  const { data: profile } = await supabaseAdmin
    .from("profiles")
    .select("*")
    .or(`id.eq.${cleanTarget},email.eq.${cleanTarget}`)
    .maybeSingle();

  if (!profile) {
    throw new Error(`User account '${oldEmailOrUserId}' not found.`);
  }

  const oldEmail = normEmail(profile.email);
  if (oldEmail === cleanNewEmail) {
    return { success: true, userId: profile.id, oldEmail, newEmail: cleanNewEmail };
  }

  // Check if another profile already owns this new email
  const { data: conflict } = await supabaseAdmin
    .from("profiles")
    .select("id")
    .eq("email", cleanNewEmail)
    .maybeSingle();

  if (conflict && conflict.id !== profile.id) {
    throw new Error(`The email '${cleanNewEmail}' is already registered to another account.`);
  }

  // 1. Rename email in Supabase Auth
  const { error: authErr } = await supabaseAdmin.auth.admin.updateUserById(profile.id, {
    email: cleanNewEmail,
    email_confirm: true
  });
  if (authErr) {
    throw new Error(`Failed to update authentication login email: ${authErr.message}`);
  }

  // 2. Rename email in profiles
  const { error: profErr } = await supabaseAdmin
    .from("profiles")
    .update({
      email: cleanNewEmail,
      updated_at: new Date().toISOString()
    })
    .eq("id", profile.id);

  if (profErr) {
    throw new Error(`Failed to update profile email: ${profErr.message}`);
  }

  // 3. Update links based on role
  const role = String(profile.role || "").toUpperCase();
  if (role === "PARENT") {
    // Update students where parent_emails includes oldEmail
    const { data: studentsWithParent } = await supabaseAdmin
      .from("students")
      .select("id, parent_emails");

    for (const st of (studentsWithParent || []) as any[]) {
      const peList = Array.isArray(st.parent_emails) ? st.parent_emails : [];
      if (peList.includes(oldEmail)) {
        const updatedList = peList.map((e: string) => (e === oldEmail ? cleanNewEmail : e));
        await supabaseAdmin
          .from("students")
          .update({ parent_emails: updatedList })
          .eq("id", st.id);
      }
    }

    // Update in-memory store
    for (const memSt of inMemoryStudentStore) {
      if (Array.isArray(memSt.parentEmails) && memSt.parentEmails.includes(oldEmail)) {
        memSt.parentEmails = memSt.parentEmails.map(e => (e === oldEmail ? cleanNewEmail : e));
      }
    }
  } else if (role === "STUDENT") {
    await supabaseAdmin
      .from("students")
      .update({ email: cleanNewEmail })
      .or(`user_id.eq.${profile.id},email.eq.${oldEmail}`);

    for (const memSt of inMemoryStudentStore) {
      if (memSt.id === profile.id || normEmail(memSt.email) === oldEmail) {
        memSt.email = cleanNewEmail;
      }
    }
  } else if (role === "TEACHER") {
    await supabaseAdmin
      .from("teachers")
      .update({ email: cleanNewEmail })
      .or(`user_id.eq.${profile.id},email.eq.${oldEmail}`);
  }

  invalidateProfileCache(profile.id);

  return {
    success: true,
    userId: profile.id,
    oldEmail,
    newEmail: cleanNewEmail
  };
}
