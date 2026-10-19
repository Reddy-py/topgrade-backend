/**
 * Domain and Email Utilities for Placeholder Accounts
 * Requirement Step 6 & Addendum:
 * - Define one PLACEHOLDER_DOMAIN constant (placeholder.invalid accepted by Supabase Auth).
 * - A placeholder email is used when a person has no real email:
 *   - students: login id = student code (e.g. tg-stu-2026-1234@PLACEHOLDER_DOMAIN)
 *   - parents: parent.<slug-of-name>.<row number>@PLACEHOLDER_DOMAIN (never depends on phone)
 * - Everywhere emails are chosen (studentContactEmails, realEmail, mailer, announcements,
 *   campaigns, digests, unsubscribe), a placeholder address must count as 'no email'.
 * - On every form / display, placeholder emails are shown as empty string "".
 */

export const PLACEHOLDER_DOMAIN = "placeholder.invalid";

export const KNOWN_PLACEHOLDER_DOMAINS = [
  PLACEHOLDER_DOMAIN,
  "placeholder.example.com",
  "topgrade.edu" // legacy placeholder domain
];

export function isPlaceholderEmail(email: unknown): boolean {
  if (!email || typeof email !== "string") return false;
  const clean = email.trim().toLowerCase();
  if (!clean.includes("@")) return false;
  return KNOWN_PLACEHOLDER_DOMAINS.some(domain => clean.endsWith(`@${domain}`));
}

export function isRealEmail(email: unknown): boolean {
  if (!email || typeof email !== "string") return false;
  const clean = email.trim().toLowerCase();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(clean)) return false;
  return !isPlaceholderEmail(clean);
}

export function realEmailOrNull(email: unknown): string | null {
  return isRealEmail(email) ? String(email).trim().toLowerCase() : null;
}

export function displayEmail(email: unknown): string {
  if (!email || typeof email !== "string") return "";
  const clean = email.trim();
  return isPlaceholderEmail(clean) ? "" : clean;
}

export function slugifyName(name: string): string {
  const slug = name
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
  return slug || "parent";
}

export function makeStudentPlaceholderEmail(studentCode: string): string {
  const cleanCode = (studentCode || "").trim().toLowerCase();
  return `${cleanCode}@${PLACEHOLDER_DOMAIN}`;
}

export function makeParentPlaceholderEmail(parentName: string, rowNumber: number): string {
  const slug = slugifyName(parentName);
  return `parent.${slug}.${rowNumber}@${PLACEHOLDER_DOMAIN}`;
}
