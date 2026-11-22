import { dispatchMultiChannelNotification } from "./notificationService.js";
import { logEmail, statusFromDispatch } from "./emailLog.js";
import { normEmail, isValidEmail } from "./studentAccounts.js";
import { instituteNow } from "./instituteTime.js";
import type { StudentDossier } from "./studentService.js";
import { isRealEmail } from "../constants/domains.js";

/**
 * Who gets a student's automatic emails: the student's own email; if the student has none, the parent emails.
 * (Placeholder emails, including @placeholder.invalid and legacy @topgrade.edu, count as "no email".)
 */
const realEmail = (e: unknown): string | null => {
  const v = normEmail(e);
  return v && isRealEmail(v) ? v : null;
};

export function studentOwnEmails(student: Pick<StudentDossier, "email" | "studentEmails">): string[] {
  return Array.from(new Set([...(student.studentEmails || []), student.email].map(realEmail).filter((e): e is string => !!e)));
}

export function studentContactEmails(student: Pick<StudentDossier, "email" | "studentEmails" | "parentEmails">): string[] {
  const own = studentOwnEmails(student);
  if (own.length > 0) return own;
  return Array.from(new Set((student.parentEmails || []).map(realEmail).filter((e): e is string => !!e)));
}

/**
 * Returns all real emails for a student dossier: the student's own email(s) AND parent email(s).
 * Used when a profile update must notify both the client/student and all linked parents.
 */
export function allStudentAndParentEmails(student: Pick<StudentDossier, "email" | "studentEmails" | "parentEmails">): string[] {
  const own = studentOwnEmails(student);
  const parents = (student.parentEmails || []).map(realEmail).filter((e): e is string => !!e);
  return Array.from(new Set([...own, ...parents]));
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

import { renderTemplate } from "./emailTemplateService.js";
import { getAdminNotificationEmails } from "./instituteSettingsService.js";

/** "Your details were registered" email to both student, all parents, and admin. */
export async function sendStudentAddedEmail(student: StudentDossier): Promise<void> {
  const to = allStudentAndParentEmails(student);
  const key = student.id || student.studentCode || "";
  const { dateStr } = instituteNow();
  const adminEmail = (process.env.ADMIN_EMAIL || "tglbiz101@gmail.com").trim();
  if ((to.length === 0 && !adminEmail) || !key) return;

  try {
    let subject = `Registration confirmed: ${student.fullName} (${student.studentCode || ""})`;
    let message = `${student.fullName} is now registered at TopGrade Learning${student.studentCode ? ` (student ID ${student.studentCode})` : ""}.`;

    try {
      const tpl = await renderTemplate("NEW_STUDENT_REGISTRATION_SUMMARY", {
        recipient_name: student.fullName || "Student & Family",
        student_name: student.fullName,
        student_code: student.studentCode || "",
        school: student.school || "N/A",
        grade: student.grade || "N/A",
        program: student.program || "Standard Curriculum",
        courses: Array.isArray(student.allocatedCourses) ? student.allocatedCourses.map((c: any) => c.courseName).join(", ") : (student.program || "Standard Curriculum")
      });
      if (tpl && tpl.enabled) {
        subject = tpl.subject;
        message = tpl.htmlBody;
      }
    } catch {
      // Fallback to default text
    }

    const recipients = recipientsFor(student, to);

    // Guarantee admin is always included
    const adminEmails = await getAdminNotificationEmails();
    const allAdmins = Array.from(new Set([adminEmail, ...adminEmails, "tglbiz101@gmail.com"].filter(Boolean)));
    for (const ae of allAdmins) {
      if (isRealEmail(ae) && !recipients.some(r => r.email.toLowerCase() === ae.toLowerCase())) {
        recipients.push({ role: "ADMIN" as any, email: ae, name: "Administrator", phone: "" });
      }
    }

    const result = await dispatchMultiChannelNotification({
      eventType: "ADMISSION_APPROVED",
      subject,
      message,
      escapeMessage: false,
      recipients,
    });
    await logEmail("NEW_STUDENT_REGISTERED", key, dateStr, to, subject, statusFromDispatch(result), result.failures.join("; ") || undefined, message);
  } catch (err: any) {
    await logEmail("NEW_STUDENT_REGISTERED", key, dateStr, to, `Registration: ${student.fullName}`, "failed", err?.message);
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
  const to = allStudentAndParentEmails(after);
  const oldOwn = realEmail(before.email);
  const newOwn = realEmail(after.email);
  const oldEmailNotice = oldOwn && newOwn && oldOwn !== newOwn ? oldOwn : null;
  const adminEmail = (process.env.ADMIN_EMAIL || "tglbiz101@gmail.com").trim();
  let subject = `Your details were updated: ${after.fullName}`;
  if ((to.length === 0 && !oldEmailNotice && !adminEmail) || !key) return;

  try {
    const listHtml = `
      <ul style="margin:8px 0;padding-left:20px;line-height:1.6;">
        ${changes.map(c => `<li><strong>${c.label}:</strong> <span style="text-decoration:line-through;color:#94a3b8;">${c.before || "(empty)"}</span> &rarr; <span style="color:#004ac6;font-weight:600;">${c.after || "(empty)"}</span></li>`).join("")}
      </ul>
    `;
    let message = `The details of ${after.fullName} at TopGrade Learning were updated on ${dateStr}.\n\nWhat changed:\n${changes.map(c => `• ${c.label}: ${c.before} → ${c.after}`).join("\n")}`;

    try {
      const tpl = await renderTemplate("STUDENT_DETAILS_UPDATED", {
        recipient_name: after.fullName || "Student & Family",
        student_name: after.fullName,
        student_code: after.studentCode || "",
        changes_list: listHtml
      });
      if (tpl && tpl.enabled) {
        subject = tpl.subject;
        message = tpl.htmlBody;
      }
    } catch {
      // Fallback
    }

    // Merge recipient emails from after AND before to guarantee no contact email is dropped
    const combinedEmails = Array.from(new Set([
      ...allStudentAndParentEmails(after),
      ...allStudentAndParentEmails(before),
      ...((after.studentEmails || []).map(realEmail).filter(Boolean) as string[]),
      ...((before.studentEmails || []).map(realEmail).filter(Boolean) as string[]),
      ...((after.parentEmails || []).map(realEmail).filter(Boolean) as string[]),
      ...((before.parentEmails || []).map(realEmail).filter(Boolean) as string[]),
      ...(after.email && isRealEmail(after.email) ? [normEmail(after.email)!] : []),
      ...(before.email && isRealEmail(before.email) ? [normEmail(before.email)!] : []),
    ]));

    const recipients = recipientsFor(after, combinedEmails);

    // Guarantee student email is always included if valid
    const cleanStudentEmail = realEmail(after.email) || realEmail(before.email);
    if (cleanStudentEmail && !recipients.some(r => r.email.toLowerCase() === cleanStudentEmail.toLowerCase())) {
      recipients.push({ role: "STUDENT", email: cleanStudentEmail, name: after.fullName, phone: after.primaryMobile || "" });
    }

    // Guarantee parent email(s) are always included if valid
    const effectiveParents = [
      ...((after.parentEmails || []).map(realEmail).filter(Boolean) as string[]),
      ...((before.parentEmails || []).map(realEmail).filter(Boolean) as string[])
    ];
    for (const pe of effectiveParents) {
      if (isRealEmail(pe) && !recipients.some(r => r.email.toLowerCase() === pe.toLowerCase())) {
        recipients.push({ role: "PARENT", email: pe, name: `Parent of ${after.fullName}`, phone: "" });
      }
    }

    // Guarantee admin email(s) are always included
    const adminEmails = await getAdminNotificationEmails();
    const allAdmins = Array.from(new Set([adminEmail, ...adminEmails, "tglbiz101@gmail.com"].filter(Boolean)));
    for (const ae of allAdmins) {
      if (isRealEmail(ae) && !recipients.some(r => r.email.toLowerCase() === ae.toLowerCase())) {
        recipients.push({ role: "ADMIN" as any, email: ae, name: "Administrator", phone: "" });
      }
    }

    const main = recipients.length > 0
      ? await dispatchMultiChannelNotification({
          eventType: "ADMISSION_APPROVED",
          subject,
          message,
          escapeMessage: false,
          recipients,
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
    await logEmail("STUDENT_UPDATED", key, dateStr, [...to, ...(oldEmailNotice ? [oldEmailNotice] : [])], subject, status, main?.failures.join("; ") || undefined, message);
  } catch (err: any) {
    await logEmail("STUDENT_UPDATED", key, dateStr, to, subject, "failed", err?.message);
  }
}
