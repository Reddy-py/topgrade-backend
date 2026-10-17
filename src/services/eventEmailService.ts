import { supabaseAdmin } from "../supabase.js";
import { renderTemplate, getTemplate } from "./emailTemplateService.js";
import { dispatchMultiChannelNotification, escapeHtml } from "./notificationService.js";
import { logEmail, statusFromDispatch } from "./emailLog.js";
import { isUnsubscribed, verifyCanSpamAddress, buildUnsubscribeLink } from "./emailUnsubscribeService.js";
import { getCachedInstituteSettings, instituteAddress } from "./instituteSettingsService.js";
import { instituteToday, instituteNow } from "./instituteTime.js";
import { normEmail } from "./studentAccounts.js";

/**
 * Resolves 'Student-else-parent' target:
 * Sends to student's own email if valid; otherwise falls back to parent emails.
 */
export function resolveStudentElseParent(student: { email?: string | null | undefined; studentEmails?: string[] | undefined; parentEmails?: string[] | undefined; parent_emails?: string[] | undefined }): string[] {
  const sEmail = normEmail(student.email);
  if (sEmail && !sEmail.endsWith("@topgrade.edu")) {
    return [sEmail];
  }
  const ownList = (student.studentEmails || []).map(normEmail).filter((e): e is string => !!e && !e.endsWith("@topgrade.edu"));
  if (ownList.length > 0) return [ownList[0]!];

  const parentList = (student.parentEmails || student.parent_emails || []).map(normEmail).filter(Boolean);
  return Array.from(new Set(parentList));
}

export function getAllParentEmails(student: { parentEmails?: string[] | undefined; parent_emails?: string[] | undefined }): string[] {
  const pList = (student.parentEmails || student.parent_emails || []).map(normEmail).filter(Boolean);
  return Array.from(new Set(pList));
}

// ---------------------------------------------------------------------------
// EVENT 1: New Student Registered
// ---------------------------------------------------------------------------
export async function sendNewStudentRegistrationSummary(student: any): Promise<boolean> {
  const templateKey = "NEW_STUDENT_REGISTRATION_SUMMARY";
  const recipients = resolveStudentElseParent(student);
  if (recipients.length === 0) return false;

  const tpl = await renderTemplate(templateKey, {
    recipient_name: student.fullName || student.name || "Student & Family",
    student_name: student.fullName || student.name,
    student_code: student.studentCode || student.student_id_code,
    school: student.school || "N/A",
    grade: student.grade || "N/A",
    program: student.program || "Standard Track",
    courses: Array.isArray(student.allocatedCourses) ? student.allocatedCourses.map((c: any) => c.courseName).join(", ") : (student.program || "General Curriculum")
  });

  if (!tpl.enabled) return false;

  const res = await dispatchMultiChannelNotification({
    eventType: "ADMISSION_APPROVED",
    subject: tpl.subject,
    message: tpl.htmlBody,
    recipients: recipients.map(email => ({ role: "PARENT", email, name: student.fullName }))
  });

  await logEmail(
    "NEW_STUDENT_REGISTERED",
    student.id || student.studentCode,
    instituteToday(),
    recipients,
    tpl.subject,
    statusFromDispatch(res),
    res.failures.join("; ") || undefined,
    tpl.htmlBody
  );
  return res.success;
}

export async function sendNewStudentAdminAlert(student: any): Promise<boolean> {
  const templateKey = "NEW_STUDENT_ADMIN_ALERT";
  const settings = getCachedInstituteSettings();
  const adminEmail = process.env.ADMIN_EMAIL || settings.support_email || "tglbiz101@gmail.com";

  const tpl = await renderTemplate(templateKey, {
    student_name: student.fullName || student.name,
    student_code: student.studentCode || student.student_id_code,
    school: student.school || "N/A",
    grade: student.grade || "N/A",
    program_type: student.program_type || "TUTORING",
    parent_emails: (student.parentEmails || student.parent_emails || []).join(", ") || "None",
    student_email: student.email || "None",
    courses: Array.isArray(student.allocatedCourses) ? student.allocatedCourses.map((c: any) => c.courseName).join(", ") : (student.program || "General Curriculum"),
    created_at: new Date().toLocaleString("en-US", { timeZone: settings.timezone || "America/New_York" })
  });

  if (!tpl.enabled) return false;

  const res = await dispatchMultiChannelNotification({
    eventType: "ADMISSION_APPROVED",
    subject: tpl.subject,
    message: tpl.htmlBody,
    recipients: [{ role: "ADMIN", email: adminEmail, name: "Admin Officer" }]
  });

  await logEmail(
    "NEW_STUDENT_REGISTERED",
    student.id || student.studentCode,
    instituteToday(),
    [adminEmail],
    tpl.subject,
    statusFromDispatch(res),
    res.failures.join("; ") || undefined,
    tpl.htmlBody
  );
  return res.success;
}

// ---------------------------------------------------------------------------
// EVENT 2: Student Details Updated (student-else-parent)
// ---------------------------------------------------------------------------
export async function sendStudentDetailsUpdatedNotice(
  student: any,
  changes: Array<{ label: string; before: string; after: string }>
): Promise<boolean> {
  if (!changes || changes.length === 0) return true;
  const templateKey = "STUDENT_DETAILS_UPDATED";
  const recipients = resolveStudentElseParent(student);
  if (recipients.length === 0) return false;

  const changesHtml = `
    <ul style="margin:8px 0;padding-left:20px;line-height:1.6;">
      ${changes.map(c => `<li><strong>${escapeHtml(c.label)}:</strong> <span style="text-decoration:line-through;color:#94a3b8;">${escapeHtml(c.before || "(empty)")}</span> &rarr; <span style="color:#004ac6;font-weight:600;">${escapeHtml(c.after || "(empty)")}</span></li>`).join("")}
    </ul>
  `;

  const tpl = await renderTemplate(templateKey, {
    recipient_name: student.fullName || student.name || "Student & Family",
    student_name: student.fullName || student.name,
    student_code: student.studentCode || student.student_id_code,
    changes_list: changesHtml
  });

  if (!tpl.enabled) return false;

  const res = await dispatchMultiChannelNotification({
    eventType: "ADMISSION_APPROVED",
    subject: tpl.subject,
    message: tpl.htmlBody,
    recipients: recipients.map(email => ({ role: "PARENT", email, name: student.fullName }))
  });

  await logEmail(
    "STUDENT_UPDATED",
    student.id || student.studentCode,
    instituteToday(),
    recipients,
    tpl.subject,
    statusFromDispatch(res),
    res.failures.join("; ") || undefined,
    tpl.htmlBody
  );
  return res.success;
}

// ---------------------------------------------------------------------------
// EVENT 3: Student Enrolled, Class Created, Changed, Cancelled, Rescheduled
// ---------------------------------------------------------------------------
export interface ScheduleEventInput {
  actionType: "CLASS_CREATED" | "CLASS_RESCHEDULED" | "CLASS_CHANGED" | "CLASS_CANCELLED" | "STUDENT_ENROLLED";
  courseName: string;
  dayOfWeek: string;
  timeSlot: string;
  room?: string | undefined;
  locationName?: string | undefined;
  locationAddress?: string | undefined;
  teacherName?: string | undefined;
  teacherEmail?: string | undefined;
  students: Array<{ id: string; name: string; email?: string | undefined; parentEmails?: string[] | undefined }>;
  cancellationReason?: string | undefined;
}

export async function sendScheduleClassEvent(params: ScheduleEventInput): Promise<{ dispatched: number; adminNotified: boolean }> {
  const templateKey = "CLASS_SCHEDULE_EVENT";
  const settings = getCachedInstituteSettings();
  let dispatched = 0;
  let adminNotified = false;

  const actionDisplay =
    params.actionType === "CLASS_CANCELLED" ? "Class Cancelled" :
    params.actionType === "CLASS_RESCHEDULED" ? "Class Rescheduled" :
    params.actionType === "STUDENT_ENROLLED" ? "Student Enrolled in Class" :
    params.actionType === "CLASS_CREATED" ? "New Class Created" : "Class Details Updated";

  // 1. Send to Student-else-parent and Parents
  for (const st of params.students) {
    const parentEmails = getAllParentEmails(st);
    const sepEmails = resolveStudentElseParent(st);
    const targetRecipients = Array.from(new Set([...parentEmails, ...sepEmails]));

    if (targetRecipients.length > 0) {
      const tpl = await renderTemplate(templateKey, {
        recipient_name: st.name || "Student & Family",
        action_type: actionDisplay,
        course_name: params.courseName,
        day_of_week: params.dayOfWeek,
        time_slot: params.timeSlot,
        room: params.room || "Room 101",
        location_name: params.locationName || "Main Center",
        location_address: params.locationAddress || instituteAddress(),
        teacher_name: params.teacherName || "Assigned Faculty",
        additional_notes: params.cancellationReason ? `<strong>Cancellation Note:</strong> ${escapeHtml(params.cancellationReason)}` : ""
      });

      if (tpl.enabled) {
        const res = await dispatchMultiChannelNotification({
          eventType: "ADMISSION_INQUIRY",
          subject: tpl.subject,
          message: tpl.htmlBody,
          recipients: targetRecipients.map(e => ({ role: "PARENT", email: e, name: st.name }))
        });

        await logEmail(
          "CLASS_SCHEDULE_EVENT",
          st.id || params.courseName,
          instituteToday(),
          targetRecipients,
          tpl.subject,
          statusFromDispatch(res),
          res.failures.join("; ") || undefined,
          tpl.htmlBody
        );
        dispatched++;
      }
    }
  }

  // 2. Send to Teacher
  if (params.teacherEmail) {
    const tplTeacher = await renderTemplate(templateKey, {
      recipient_name: params.teacherName || "Faculty Instructor",
      action_type: `Faculty Schedule Notice: ${actionDisplay}`,
      course_name: params.courseName,
      day_of_week: params.dayOfWeek,
      time_slot: params.timeSlot,
      room: params.room || "Room 101",
      location_name: params.locationName || "Main Center",
      location_address: params.locationAddress || instituteAddress(),
      teacher_name: params.teacherName || "You",
      additional_notes: `Enrolled students affected: ${params.students.length}`
    });

    if (tplTeacher.enabled) {
      const res = await dispatchMultiChannelNotification({
        eventType: "TEACHER_ASSIGNMENT",
        subject: `[Faculty] ${tplTeacher.subject}`,
        message: tplTeacher.htmlBody,
        recipients: [{ role: "TEACHER", email: params.teacherEmail, name: params.teacherName || "Teacher" }]
      });

      await logEmail(
        "CLASS_SCHEDULE_EVENT",
        params.teacherEmail,
        instituteToday(),
        [params.teacherEmail],
        `[Faculty] ${tplTeacher.subject}`,
        statusFromDispatch(res),
        res.failures.join("; ") || undefined,
        tplTeacher.htmlBody
      );
      dispatched++;
    }
  }

  // 3. Admin summary on cancellation
  if (params.actionType === "CLASS_CANCELLED") {
    const adminEmail = process.env.ADMIN_EMAIL || settings.support_email || "tglbiz101@gmail.com";
    const subject = `⚠️ Class Cancellation Alert: ${params.courseName} (${params.dayOfWeek} ${params.timeSlot})`;
    const adminMessage = `
      Hello Admin,<br><br>
      A scheduled class session was <strong>CANCELLED</strong>:<br><br>
      &bull; <strong>Course:</strong> ${escapeHtml(params.courseName)}<br>
      &bull; <strong>Day & Time:</strong> ${escapeHtml(params.dayOfWeek)}, ${escapeHtml(params.timeSlot)}<br>
      &bull; <strong>Instructor:</strong> ${escapeHtml(params.teacherName || "Unassigned")}<br>
      &bull; <strong>Affected Students:</strong> ${params.students.length} (${params.students.map(s => escapeHtml(s.name)).join(", ")})<br>
      &bull; <strong>Cancellation Reason:</strong> ${escapeHtml(params.cancellationReason || "No reason specified")}<br><br>
      All enrolled families and faculty have received notification.
    `;

    const resAdmin = await dispatchMultiChannelNotification({
      eventType: "DE_ENROLLMENT_APPROVED",
      subject,
      message: adminMessage,
      recipients: [{ role: "ADMIN", email: adminEmail, name: "Admin Operations" }]
    });

    await logEmail(
      "CLASS_SCHEDULE_EVENT",
      `cancellation-${params.courseName}`,
      instituteToday(),
      [adminEmail],
      subject,
      statusFromDispatch(resAdmin),
      resAdmin.failures.join("; ") || undefined,
      adminMessage
    );
    adminNotified = resAdmin.success;
  }

  return { dispatched, adminNotified };
}

// ---------------------------------------------------------------------------
// EVENT 9: Teacher Course Offered, Class Taken/Released, Schedule Changed
// ---------------------------------------------------------------------------
export async function sendTeacherScheduleActionNotice(params: {
  eventType: "CLASS_TAKEN" | "CLASS_RELEASED" | "COURSE_OFFERED" | "SCHEDULE_CHANGED" | "NEW_STUDENT_ASSIGNED";
  teacherName: string;
  teacherEmail: string;
  courseName: string;
  dayOfWeek: string;
  timeSlot: string;
  room?: string | undefined;
  locationName?: string | undefined;
  locationAddress?: string | undefined;
  enrolledCount?: number | undefined;
}): Promise<{ teacherNotified: boolean; adminNotified: boolean }> {
  const templateKey = "TEACHER_ASSIGNMENT_EVENT";
  const eventLabel =
    params.eventType === "CLASS_TAKEN" ? "Class Claimed by Teacher" :
    params.eventType === "CLASS_RELEASED" ? "Class Released by Teacher" :
    params.eventType === "COURSE_OFFERED" ? "New Course Assigned" :
    params.eventType === "NEW_STUDENT_ASSIGNED" ? "New Student Added to Roster" : "Schedule Updated";

  const tpl = await renderTemplate(templateKey, {
    teacher_name: params.teacherName,
    event_type: eventLabel,
    course_name: params.courseName,
    day_of_week: params.dayOfWeek,
    time_slot: params.timeSlot,
    room: params.room || "Room 101",
    location_name: params.locationName || "Main Center",
    location_address: params.locationAddress || instituteAddress(),
    enrolled_count: params.enrolledCount ?? 0
  });

  let teacherNotified = false;
  if (tpl.enabled && params.teacherEmail) {
    const res = await dispatchMultiChannelNotification({
      eventType: "TEACHER_ASSIGNMENT",
      subject: tpl.subject,
      message: tpl.htmlBody,
      recipients: [{ role: "TEACHER", email: params.teacherEmail, name: params.teacherName }]
    });

    await logEmail(
      "TEACHER_ASSIGNMENT",
      params.teacherEmail,
      instituteToday(),
      [params.teacherEmail],
      tpl.subject,
      statusFromDispatch(res),
      res.failures.join("; ") || undefined,
      tpl.htmlBody
    );
    teacherNotified = res.success;
  }

  // Admin is told when a teacher takes/claims a class
  let adminNotified = false;
  if (params.eventType === "CLASS_TAKEN") {
    const settings = getCachedInstituteSettings();
    const adminEmail = process.env.ADMIN_EMAIL || settings.support_email || "tglbiz101@gmail.com";
    const subject = `Faculty Class Claimed: ${params.teacherName} took ${params.courseName} (${params.dayOfWeek} ${params.timeSlot})`;
    const adminMessage = `
      Hello Admin,<br><br>
      Faculty instructor <strong>${escapeHtml(params.teacherName)}</strong> has claimed the open teaching slot for <strong>${escapeHtml(params.courseName)}</strong>.<br><br>
      &bull; <strong>Time:</strong> Every ${escapeHtml(params.dayOfWeek)}, ${escapeHtml(params.timeSlot)}<br>
      &bull; <strong>Location:</strong> ${escapeHtml(params.locationName || "Main Center")}<br>
      &bull; <strong>Room:</strong> ${escapeHtml(params.room || "Room 101")}<br>
      &bull; <strong>Enrolled Students:</strong> ${params.enrolledCount ?? 0}<br><br>
      The class roster is active and ready for attendance marking.
    `;

    const res = await dispatchMultiChannelNotification({
      eventType: "TEACHER_ASSIGNMENT",
      subject,
      message: adminMessage,
      recipients: [{ role: "ADMIN", email: adminEmail, name: "Admin Office" }]
    });

    await logEmail(
      "TEACHER_ASSIGNMENT",
      `claim-${params.courseName}-${params.teacherName}`,
      instituteToday(),
      [adminEmail],
      subject,
      statusFromDispatch(res),
      res.failures.join("; ") || undefined,
      adminMessage
    );
    adminNotified = res.success;
  }

  return { teacherNotified, adminNotified };
}

// ---------------------------------------------------------------------------
// EVENT 11: Announcements Broadcast (Batch, Audience, CAN-SPAM Unsubscribe)
// ---------------------------------------------------------------------------
export interface BroadcastAnnouncementInput {
  title: string;
  body: string;
  audience: "ALL_PARENTS" | "ALL_STUDENTS" | "ALL_TEACHERS" | "COURSE" | "PROGRAM" | "EVERYONE" | "PARENTS" | "STUDENTS" | "TEACHERS";
  targetFilter?: string | undefined; // course_id or program name
  senderAdminEmail?: string | undefined;
  recipients?: Array<{ email: string; name?: string | undefined }> | undefined;
}

export async function broadcastAnnouncement(input: BroadcastAnnouncementInput): Promise<{
  success: boolean;
  totalRecipients: number;
  sentCount: number;
  skippedUnsubscribed: number;
  blockedCanSpam: boolean;
  reason?: string | undefined;
}> {
  // 1. CAN-SPAM Verification: Block these sends until the institute address is set.
  const canSpam = verifyCanSpamAddress();
  if (!canSpam.allowed) {
    return {
      success: false,
      totalRecipients: 0,
      sentCount: 0,
      skippedUnsubscribed: 0,
      blockedCanSpam: true,
      reason: canSpam.reason
    };
  }

  // 2. Resolve audience email addresses
  const recipientSet = new Set<string>();

  // If explicit recipient list is provided (e.g. targeted announcements or direct dispatch), populate them
  if (input.recipients && Array.isArray(input.recipients)) {
    for (const r of input.recipients) {
      if (r && r.email) recipientSet.add(normEmail(r.email));
    }
  }

  const aud = input.audience;
  if (aud === "ALL_TEACHERS" || aud === "TEACHERS" || aud === "EVERYONE") {
    const { data: teachers } = await supabaseAdmin.from("teachers").select("email").eq("status", "Active");
    for (const t of (teachers || []) as any[]) {
      if (t.email && !t.email.endsWith("@topgrade.edu")) recipientSet.add(normEmail(t.email));
    }
  }

  if (aud === "ALL_PARENTS" || aud === "PARENTS" || aud === "ALL_STUDENTS" || aud === "STUDENTS" || aud === "EVERYONE" || aud === "COURSE" || aud === "PROGRAM") {
    let q = supabaseAdmin.from("students").select("id, email, parent_emails, program, status").eq("status", "ACTIVE");
    if (aud === "PROGRAM" && input.targetFilter) {
      q = q.ilike("program", `%${input.targetFilter}%`);
    }

    let enrolledStudentIds: Set<string> | null = null;
    if (aud === "COURSE" && input.targetFilter) {
      const { data: enrs } = await supabaseAdmin
        .from("student_enrollments")
        .select("student_id")
        .eq("course_id", input.targetFilter);
      enrolledStudentIds = new Set((enrs || []).map((e: any) => String(e.student_id)));
    }

    const { data: students } = await q;

    for (const st of (students || []) as any[]) {
      if (enrolledStudentIds && !enrolledStudentIds.has(String(st.id))) {
        continue;
      }
      if (aud === "ALL_STUDENTS" || aud === "STUDENTS" || aud === "EVERYONE" || aud === "COURSE") {
        if (st.email && !st.email.endsWith("@topgrade.edu")) recipientSet.add(normEmail(st.email));
      }
      if (aud === "ALL_PARENTS" || aud === "PARENTS" || aud === "EVERYONE" || aud === "PROGRAM" || aud === "COURSE") {
        for (const pe of (st.parent_emails || []) as string[]) {
          if (pe) recipientSet.add(normEmail(pe));
        }
      }
    }
  }

  const allCandidateEmails = Array.from(recipientSet).filter(Boolean);
  let sentCount = 0;
  let skippedUnsubscribed = 0;

  // 3. Dispatch in batches with individual CAN-SPAM footer + one-click signed unsubscribe link
  const templateKey = "GENERAL_ANNOUNCEMENT";
  const settings = getCachedInstituteSettings();

  for (const email of allCandidateEmails) {
    // Check unsubscribe preference
    if (await isUnsubscribed(email, "ANNOUNCEMENTS")) {
      skippedUnsubscribed++;
      continue;
    }

    const unsubLink = buildUnsubscribeLink(email, "ANNOUNCEMENTS");
    const canSpamFooter = `
      <div style="margin-top:25px;padding-top:15px;border-top:1px solid #e2e8f0;font-size:11px;color:#64748b;line-height:1.6;text-align:center;">
        <p style="margin:0;"><strong>${escapeHtml(settings.institute_name || "Top Grade Learning")}</strong> &bull; ${escapeHtml(canSpam.instituteAddress)}</p>
        <p style="margin:6px 0 0 0;">You received this announcement as an enrolled family or faculty member. <a href="${unsubLink}" style="color:#004ac6;text-decoration:underline;">Click here to unsubscribe</a> from general announcements.</p>
      </div>
    `;

    const tpl = await renderTemplate(templateKey, {
      recipient_name: "Valued Member",
      announcement_title: input.title,
      announcement_body: escapeHtml(input.body).replace(/\n/g, "<br>") + canSpamFooter
    });

    if (tpl.enabled) {
      const res = await dispatchMultiChannelNotification({
        eventType: "ADMISSION_INQUIRY",
        subject: tpl.subject,
        message: tpl.htmlBody,
        recipients: [{ role: "PARENT", email, name: "Community Member" }]
      });

      if (res.success) sentCount++;

      await logEmail(
        "ANNOUNCEMENT",
        input.title.slice(0, 50),
        instituteToday(),
        [email],
        tpl.subject,
        statusFromDispatch(res),
        res.failures.join("; ") || undefined,
        input.body
      );
    }
  }

  return {
    success: true,
    totalRecipients: allCandidateEmails.length,
    sentCount,
    skippedUnsubscribed,
    blockedCanSpam: false
  };
}
