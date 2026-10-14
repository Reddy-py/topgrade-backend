import { dispatchMultiChannelNotification } from "./notificationService.js";
import { logEmail, statusFromDispatch } from "./emailLog.js";
import { normEmail, isValidEmail } from "./studentAccounts.js";
import { instituteNow } from "./instituteTime.js";
import type { StudentDossier } from "./studentService.js";

/**
 * Who gets a student's automatic emails: the student's own email; if the student has none, the parent emails.
 * (An address ending in @topgrade.edu is a placeholder from the old system and counts as "no email".)
 */
const realEmail = (e: unknown): string | null => {
  const v = normEmail(e);
  return v && isValidEmail(v) && !v.endsWith("@topgrade.edu") ? v : null;
};

export function studentOwnEmails(student: Pick<StudentDossier, "email" | "studentEmails">): string[] {
  return Array.from(new Set([...(student.studentEmails || []), student.email].map(realEmail).filter((e): e is string => !!e)));
}

export function studentContactEmails(student: Pick<StudentDossier, "email" | "studentEmails" | "parentEmails">): string[] {
  const own = studentOwnEmails(student);
  if (own.length > 0) return own;
  return Array.from(new Set((student.parentEmails || []).map(realEmail).filter((e): e is string => !!e)));
}

const join = (v?: string[]): string => (v || []).map(x => String(x ?? "").trim()).filter(Boolean).join(", ");

const FIELDS: Array<{ label: string; get: (s: StudentDossier) => string }> = [
  { label: "Full name", get: s => s.fullName },
  { label: "Date of birth", get: s => s.dob },
  { label: "Gender", get: s => s.gender || "" },
  { label: "School", get: s => s.school },
  { label: "Grade", get: s => s.grade || "" },
  { label: "Student email", get: s => s.email },
  { label: "Student phone", get: s => s.primaryMobile || join(s.studentPhones) },
  { label: "Father's name", get: s => s.fatherName || "" },
  { label: "Mother's name", get: s => s.motherName || "" },
  { label: "Guardian", get: s => s.guardianName || "" },
  { label: "Parent email(s)", get: s => join(s.parentEmails) },
  { label: "Parent phone(s)", get: s => join(s.parentPhones) },
  { label: "Home address", get: s => s.residentialAddress || "" },
  { label: "Program", get: s => s.program || "" },
  { label: "Courses", get: s => (s.allocatedCourses || []).map((c: any) => c.courseName || c.name || "").filter(Boolean).join(", ") },
  { label: "Teacher", get: s => s.teacher || "" },
  { label: "Weekly classes", get: s => s.weeklyClasses || "" },
  { label: "Start date", get: s => s.startDate || "" },
  { label: "End date", get: s => s.endDate || "" },
  { label: "Exam date", get: s => s.examDate || "" },
  { label: "Status", get: s => s.status },
];

export interface FieldChange { label: string; before: string; after: string }

const clean = (v: string): string => String(v ?? "").replace(/\s+/g, " ").trim();
const show = (v: string): string => (v ? v : "(empty)");

/** What changed between two versions of a student record, in plain words. Fees and payment details are never listed. */
export function diffStudent(before: StudentDossier, after: StudentDossier): FieldChange[] {
  const changes: FieldChange[] = [];
  for (const f of FIELDS) {
    const b = clean(f.get(before));
    const a = clean(f.get(after));
    if (b.toLowerCase() !== a.toLowerCase()) changes.push({ label: f.label, before: show(b), after: show(a) });
  }
  return changes;
}

function recipientsFor(student: StudentDossier, emails: string[]) {
  const own = new Set(studentOwnEmails(student));
  return emails.map(e => ({
    role: (own.has(e) ? "STUDENT" : "PARENT") as "STUDENT" | "PARENT",
    email: e,
    name: own.has(e) ? student.fullName : `Parent of ${student.fullName}`,
    phone: "",
  }));
}

/** "Your details were registered" email to the student (or the parent if the student has no email). */
export async function sendStudentAddedEmail(student: StudentDossier): Promise<void> {
  const to = studentContactEmails(student);
  const key = student.id || student.studentCode || "";
  const subject = `Registration confirmed: ${student.fullName} (${student.studentCode || ""})`;
  const { dateStr } = instituteNow();
  if (to.length === 0 || !key) return;
  try {
    const lines = FIELDS
      .map(f => ({ label: f.label, value: clean(f.get(student)) }))
      .filter(x => x.value && !["Status"].includes(x.label))
      .map(x => `• ${x.label}: ${x.value}`);
    const result = await dispatchMultiChannelNotification({
      eventType: "ADMISSION_APPROVED",
      subject,
      message:
        `${student.fullName} is now registered at TopGrade Learning${student.studentCode ? ` (student ID ${student.studentCode})` : ""}.\n\n` +
        `The details we have on record:\n${lines.join("\n")}\n\n` +
        `If anything here is wrong, please tell the institute so we can correct it.`,
      escapeMessage: true,
      recipients: recipientsFor(student, to),
    });
    await logEmail("STUDENT_ADDED", key, dateStr, to, subject, statusFromDispatch(result), result.failures.join("; ") || undefined);
  } catch (err: any) {
    await logEmail("STUDENT_ADDED", key, dateStr, to, subject, "failed", err?.message);
  }
}

/**
 * "Your details were updated" email. Lists exactly which fields changed (before and after).
 * Goes to the student's email, or to the parent emails if the student has none.
 * If the student's own email address was changed, the old address also gets a security notice.
 * Sends nothing when none of the listed fields changed.
 */
export async function sendStudentUpdatedEmail(before: StudentDossier, after: StudentDossier): Promise<void> {
  const changes = diffStudent(before, after);
  if (changes.length === 0) return;

  const key = after.id || after.studentCode || "";
  const { dateStr } = instituteNow();
  const to = studentContactEmails(after);
  const oldOwn = realEmail(before.email);
  const newOwn = realEmail(after.email);
  const oldEmailNotice = oldOwn && newOwn && oldOwn !== newOwn ? oldOwn : null;
  const subject = `Your details were updated: ${after.fullName}`;
  if ((to.length === 0 && !oldEmailNotice) || !key) return;

  try {
    const list = changes.map(c => `• ${c.label}: ${c.before}  →  ${c.after}`).join("\n");
    const main = to.length > 0
      ? await dispatchMultiChannelNotification({
          eventType: "ADMISSION_APPROVED",
          subject,
          message:
            `The details of ${after.fullName} at TopGrade Learning were updated on ${dateStr}.\n\n` +
            `What changed:\n${list}\n\n` +
            `If you did not expect these changes, please contact the institute.`,
          escapeMessage: true,
          recipients: recipientsFor(after, to),
        })
      : null;
    if (oldEmailNotice) {
      await dispatchMultiChannelNotification({
        eventType: "ADMISSION_APPROVED",
        subject: `The email address on the account of ${after.fullName} was changed`,
        message:
          `The email address for ${after.fullName} at TopGrade Learning was changed from ${before.email} to ${after.email} on ${dateStr}.\n\n` +
          `If you did not expect this, please contact the institute right away.`,
        escapeMessage: true,
        recipients: [{ role: "STUDENT", email: oldEmailNotice, name: before.fullName, phone: "" }],
      });
    }
    const status = main ? statusFromDispatch(main) : "sent";
    await logEmail("STUDENT_UPDATED", key, dateStr, [...to, ...(oldEmailNotice ? [oldEmailNotice] : [])], subject, status, main?.failures.join("; ") || undefined);
  } catch (err: any) {
    await logEmail("STUDENT_UPDATED", key, dateStr, to, subject, "failed", err?.message);
  }
}
