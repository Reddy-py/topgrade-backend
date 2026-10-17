import { supabaseAdmin } from "../supabase.js";
import { escapeHtml, dispatchMultiChannelNotification } from "./notificationService.js";
import { getCachedInstituteSettings } from "./instituteSettingsService.js";

export interface EmailTemplateRow {
  key: string;
  name: string;
  audience: string;
  subject: string;
  body: string;
  enabled: boolean;
  updated_by: string | null;
  created_at: string;
  updated_at: string;
}

export const DEFAULT_EMAIL_TEMPLATES: EmailTemplateRow[] = [
  {
    key: "NEW_STUDENT_PARENT_SET_PASSWORD",
    name: "1a. New Student: Parent Account Creation",
    audience: "PARENTS",
    subject: "Welcome to Top Grade Learning: Set Up Your Parent Portal Password",
    body: "Dear {{parent_name}},<br><br>Welcome to <strong>{{institute_name}}</strong>! We have created your official Parent Portal account for <strong>{{student_name}}</strong> (Student Code: <code>{{student_code}}</code>).<br><br>Please use the secure link below to set your password. This link is single-use and will expire:<br><p><a href=\"{{action_url}}\" style=\"display:inline-block;padding:10px 20px;background:#004ac6;color:#ffffff;text-decoration:none;border-radius:6px;font-weight:bold;\">Set Your Password &rarr;</a></p><br>Login Email: <code>{{email}}</code><br><br>Through the Parent Portal, you can track daily attendance, view class schedules, monitor enrolled courses, and manage academic progress.<br><br>Warm regards,<br>{{institute_name}} Administration",
    enabled: true,
    updated_by: "system",
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString()
  },
  {
    key: "NEW_STUDENT_STUDENT_SET_PASSWORD",
    name: "1b. New Student: Student Account Creation",
    audience: "STUDENTS",
    subject: "Welcome to Top Grade Learning: Set Up Your Student Portal Password",
    body: "Dear {{student_name}},<br><br>Welcome to <strong>{{institute_name}}</strong>! Your student portal account has been created.<br><br>Please choose your password using this secure link:<br><p><a href=\"{{action_url}}\" style=\"display:inline-block;padding:10px 20px;background:#004ac6;color:#ffffff;text-decoration:none;border-radius:6px;font-weight:bold;\">Set Your Student Password &rarr;</a></p><br>Student Code: <code>{{student_code}}</code><br>Login Email: <code>{{email}}</code><br><br>Best wishes for your academic journey,<br>{{institute_name}}",
    enabled: true,
    updated_by: "system",
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString()
  },
  {
    key: "NEW_STUDENT_REGISTRATION_SUMMARY",
    name: "1c. New Student: Registration Summary",
    audience: "STUDENT_ELSE_PARENT",
    subject: "Registration Confirmation: {{student_name}} ({{student_code}})",
    body: "Dear {{recipient_name}},<br><br>We are pleased to confirm that <strong>{{student_name}}</strong> has been successfully registered at <strong>{{institute_name}}</strong>.<br><br><strong>Registration Details:</strong><br>&bull; Student Code: <code>{{student_code}}</code><br>&bull; School: {{school}}<br>&bull; Grade: {{grade}}<br>&bull; Program: {{program}}<br>&bull; Enrolled Courses: {{courses}}<br><br>If you need any adjustments or have questions, please reply to this email.<br><br>Warm regards,<br>{{institute_name}} Team",
    enabled: true,
    updated_by: "system",
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString()
  },
  {
    key: "NEW_STUDENT_ADMIN_ALERT",
    name: "1d. New Student: Admin Summary Notification",
    audience: "ADMIN",
    subject: "New Student Registered: {{student_name}} ({{student_code}})",
    body: "Hello Admin,<br><br>A new student profile has been created:<br><br>&bull; Name: <strong>{{student_name}}</strong><br>&bull; Code: <code>{{student_code}}</code><br>&bull; School: {{school}}<br>&bull; Grade: {{grade}}<br>&bull; Program Type: {{program_type}}<br>&bull; Parent Emails: {{parent_emails}}<br>&bull; Student Email: {{student_email}}<br>&bull; Enrolled Courses: {{courses}}<br>&bull; Registered At: {{created_at}}<br><br>Review the full profile in the Administrative Portal.",
    enabled: true,
    updated_by: "system",
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString()
  },
  {
    key: "STUDENT_DETAILS_UPDATED",
    name: "2. Student Details Updated",
    audience: "STUDENT_ELSE_PARENT",
    subject: "Profile Update Notice: {{student_name}}",
    body: "Dear {{recipient_name}},<br><br>This is an automated notification that the academic profile for <strong>{{student_name}}</strong> ({{student_code}}) at <strong>{{institute_name}}</strong> was recently updated.<br><br><strong>Changes recorded:</strong><br>{{changes_list}}<br><br>If you did not request or expect these changes, please contact the institute office immediately.<br><br>Warm regards,<br>{{institute_name}}",
    enabled: true,
    updated_by: "system",
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString()
  },
  {
    key: "CLASS_SCHEDULE_EVENT",
    name: "3. Class Created, Rescheduled, or Cancelled",
    audience: "STUDENT_ELSE_PARENT",
    subject: "Class Update: {{course_name}} &mdash; {{action_type}}",
    body: "Dear {{recipient_name}},<br><br>There is an update to your scheduled class for <strong>{{course_name}}</strong> at <strong>{{institute_name}}</strong>.<br><br><strong>Event:</strong> {{action_type}}<br>&bull; Course: {{course_name}}<br>&bull; Day: {{day_of_week}}<br>&bull; Time Slot: {{time_slot}}<br>&bull; Classroom / Room: {{room}}<br>&bull; Location: {{location_name}} ({{location_address}})<br>&bull; Faculty Instructor: {{teacher_name}}<br><br>{{additional_notes}}<br><br>Please verify your updated schedule in the portal.<br><br>Warm regards,<br>{{institute_name}} Academic Operations",
    enabled: true,
    updated_by: "system",
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString()
  },
  {
    key: "CLASS_REMINDER_24H",
    name: "4a. Class Reminder (24 Hours Prior)",
    audience: "STUDENT_ELSE_PARENT",
    subject: "Reminder: {{course_name}} Tomorrow at {{start_time}}",
    body: "Hello {{recipient_name}},<br><br>This is a friendly reminder that <strong>{{student_name}}</strong> has a scheduled class tomorrow:<br><br>&bull; Course: <strong>{{course_name}}</strong><br>&bull; Date: Tomorrow, {{class_date}}<br>&bull; Time: {{start_time}} - {{end_time}}<br>&bull; Location: {{location_name}} ({{location_address}})<br>&bull; Room: {{room}}<br>&bull; Instructor: {{teacher_name}}<br><br>Please ensure prompt arrival 5&ndash;10 minutes before session start.<br><br>Warm regards,<br>{{institute_name}}",
    enabled: true,
    updated_by: "system",
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString()
  },
  {
    key: "TEACHER_DAILY_AGENDA",
    name: "4b. Teacher Daily Class Agenda (Morning)",
    audience: "TEACHERS",
    subject: "Today's Teaching Schedule: {{today_date}} ({{classes_count}} Classes)",
    body: "Good morning {{teacher_name}},<br><br>Here is your teaching schedule for today, <strong>{{today_date}}</strong>:<br><br>{{classes_summary}}<br><br>Please remember to mark attendance roll-call promptly at the conclusion of each session in your Faculty Portal.<br><br>Have a wonderful teaching day!<br>{{institute_name}}",
    enabled: true,
    updated_by: "system",
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString()
  },
  {
    key: "ATTENDANCE_DAILY_SUMMARY",
    name: "5a. Daily Attendance Roll-Call Notice",
    audience: "PARENTS",
    subject: "Attendance Notice: {{student_name}} &mdash; {{status}} ({{course_name}})",
    body: "Dear {{parent_name}},<br><br>This is your daily attendance update for <strong>{{student_name}}</strong>:<br><br>&bull; Session: <strong>{{course_name}}</strong><br>&bull; Date: {{attendance_date}}<br>&bull; Status: <strong>{{status}}</strong><br>&bull; Faculty: {{teacher_name}}<br>{{remarks_block}}<br>Overall Attendance in this course: <strong>{{attendance_percent}}%</strong>.<br><br>View full attendance records anytime in the Parent Portal.<br><br>Warm regards,<br>{{institute_name}}",
    enabled: true,
    updated_by: "system",
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString()
  },
  {
    key: "ATTENDANCE_MONTHLY_SUMMARY",
    name: "5b. Monthly Attendance Report",
    audience: "PARENTS",
    subject: "Monthly Attendance Report: {{student_name}} ({{month_name}})",
    body: "Dear {{parent_name}},<br><br>Here is the monthly attendance summary for <strong>{{student_name}}</strong> for <strong>{{month_name}}</strong>:<br><br>&bull; Course: {{course_name}}<br>&bull; Total Conducted Classes: {{total_conducted}}<br>&bull; Classes Attended: {{total_attended}}<br>&bull; Monthly Attendance Rate: <strong>{{attendance_percent}}%</strong><br>&bull; Evaluation: {{attendance_evaluation}}<br><br>Thank you for partnering with us in your child's academic progress.<br><br>Warm regards,<br>{{institute_name}}",
    enabled: true,
    updated_by: "system",
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString()
  },
  {
    key: "LOW_HOURS_ALERT",
    name: "6. Low Hours or Hours Owed Notice",
    audience: "PARENTS",
    subject: "Important Notice: Class Hours Update for {{student_name}} ({{course_name}})",
    body: "Dear {{parent_name}},<br><br>This is an automated balance notice regarding <strong>{{student_name}}</strong> in <strong>{{course_name}}</strong>:<br><br><strong>Current Balance: {{hours_balance}} class hours remaining</strong><br><br>{{balance_message}}<br><br>Please sign in to the portal or contact the institute office to replenish class hours.<br><br>Warm regards,<br>{{institute_name}} Academic Accounts",
    enabled: true,
    updated_by: "system",
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString()
  },
  {
    key: "PACKAGE_EXPIRY_NOTICE",
    name: "7. Course Package Expiry / Expired Notice",
    audience: "PARENTS",
    subject: "Course Package Notice: {{student_name}} &mdash; {{course_name}} ({{expiry_status}})",
    body: "Dear {{parent_name}},<br><br>This notice concerns the course package enrollment for <strong>{{student_name}}</strong> in <strong>{{course_name}}</strong>:<br><br>&bull; Plan: {{plan}}<br>&bull; Package Expiry Date: <strong>{{expires_on}}</strong><br>&bull; Status: <strong>{{expiry_status}}</strong><br>&bull; Remaining Unused Hours: {{unused_hours}} hours<br><br>{{action_guidance}}<br><br>Warm regards,<br>{{institute_name}} Enrollment Services",
    enabled: true,
    updated_by: "system",
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString()
  },
  {
    key: "STUDENT_BIRTHDAY_GREETING",
    name: "8a. Student Birthday Greeting",
    audience: "STUDENT_ELSE_PARENT",
    subject: "🎂 Happy Birthday, {{student_name}}! Warmest Wishes from Top Grade Learning",
    body: "<div style=\"text-align:center;padding:20px 0;\"><span style=\"font-size:40px;\">🎂 🎈 🎁</span><h2 style=\"color:#004ac6;margin:10px 0;\">Happy Birthday, {{student_name}}!</h2></div>Dear {{recipient_name}},<br><br>On this special day, your teachers and the entire leadership team at <strong>{{institute_name}}</strong> wish you a fantastic birthday!<br><br>May your upcoming year be filled with exciting learning milestones, creativity, and great success in all your academic endeavors.<br><br>Enjoy your celebration!<br><br>Warmest regards,<br>{{institute_name}} Family",
    enabled: true,
    updated_by: "system",
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString()
  },
  {
    key: "TEACHER_BIRTHDAY_GREETING",
    name: "8b. Teacher Birthday Greeting",
    audience: "TEACHERS",
    subject: "🎉 Happy Birthday, {{teacher_name}}! From Top Grade Learning",
    body: "<div style=\"text-align:center;padding:20px 0;\"><span style=\"font-size:40px;\">🌟 🎂 🎓</span><h2 style=\"color:#004ac6;margin:10px 0;\">Happy Birthday, {{teacher_name}}!</h2></div>Dear {{teacher_name}},<br><br>On behalf of the entire administration, staff, and students at <strong>{{institute_name}}</strong>, we want to wish you a very happy birthday!<br><br>Thank you for your tireless dedication, passion for teaching, and the wonderful mentorship you provide to every student.<br><br>With deep gratitude and appreciation,<br>{{institute_name}} Leadership",
    enabled: true,
    updated_by: "system",
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString()
  },
  {
    key: "TEACHER_ASSIGNMENT_EVENT",
    name: "9. Teacher Assignment, Claim or Schedule Change",
    audience: "TEACHERS",
    subject: "Faculty Assignment: {{course_name}} &mdash; {{event_type}}",
    body: "Dear {{teacher_name}},<br><br>An update has been made to your faculty teaching schedule:<br><br>&bull; Event: <strong>{{event_type}}</strong><br>&bull; Course: {{course_name}}<br>&bull; Day & Time: Every {{day_of_week}}, {{time_slot}}<br>&bull; Location: {{location_name}} ({{location_address}})<br>&bull; Room: {{room}}<br>&bull; Enrolled Students: {{enrolled_count}} students<br><br>Please check your Faculty Schedule Hub for full details.<br><br>Warm regards,<br>{{institute_name}} Faculty Office",
    enabled: true,
    updated_by: "system",
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString()
  },
  {
    key: "MONTHLY_PROGRESS_REPORT",
    name: "10. Monthly Student Academic Progress Update",
    audience: "PARENTS",
    subject: "Monthly Academic Progress Report: {{student_name}} ({{month_name}})",
    body: "Dear {{parent_name}},<br><br>We are pleased to share the monthly progress update for <strong>{{student_name}}</strong> for <strong>{{month_name}}</strong> at <strong>{{institute_name}}</strong>:<br><br><strong>Course: {{course_name}}</strong><br>&bull; Attendance Rate: <strong>{{attendance_percent}}%</strong><br>&bull; Class Hours Used This Month: {{hours_used}} hours<br>&bull; Remaining Available Hours: <strong>{{hours_left}} hours</strong><br><br><strong>Instructor Progress Remarks:</strong><br><div style=\"background:#f8fafc;border-left:4px solid #004ac6;padding:12px 16px;margin:12px 0;font-style:italic;\">\"{{teacher_notes}}\"</div><br>Faculty Instructor: {{teacher_name}}<br><br>Thank you for partnering with us in {{student_name}}'s educational excellence!<br><br>Warm regards,<br>{{institute_name}} Academic Directorate",
    enabled: true,
    updated_by: "system",
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString()
  },
  {
    key: "GENERAL_ANNOUNCEMENT",
    name: "11. Institutional Announcement Broadcast",
    audience: "ALL",
    subject: "Announcement from Top Grade Learning: {{announcement_title}}",
    body: "Dear {{recipient_name}},<br><br>Please find an official announcement from <strong>{{institute_name}}</strong>:<br><br><div style=\"background:#ffffff;padding:18px;border:1px solid #e2e8f0;border-radius:10px;margin:15px 0;line-height:1.7;\">{{announcement_body}}</div><br>For any questions or support, please reply to this email or reach us at {{support_email}}.<br><br>Warm regards,<br>{{institute_name}} Administration",
    enabled: true,
    updated_by: "system",
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString()
  },
  {
    key: "ADMIN_DAILY_DIGEST",
    name: "12. Administrator Morning Daily Digest (8:00 AM)",
    audience: "ADMIN",
    subject: "TopGrade Daily Operations Digest &mdash; {{digest_date}}",
    body: "Good morning Admin,<br><br>Here is your daily operational summary for <strong>{{digest_date}}</strong> at <strong>{{institute_name}}</strong>:<br><br><strong>1. New Student Registrations (Last 24h):</strong><br>{{new_students_summary}}<br><br><strong>2. Yesterday's Absences:</strong><br>{{absences_summary}}<br><br><strong>3. Low Quota & Hours Owed Accounts:</strong><br>{{low_hours_summary}}<br><br><strong>4. Packages Expiring (Next 7 Days) / Expired:</strong><br>{{packages_summary}}<br><br><strong>5. Failed Email Deliveries:</strong><br>{{failed_emails_summary}}<br><br>Have a productive day overseeing operations!<br>{{institute_name}} Automated Engine",
    enabled: true,
    updated_by: "system",
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString()
  },
  {
    key: "RE_ENROLLMENT_INVITE",
    name: "13. Re-Enrollment & Retention Invitation",
    audience: "STUDENT_ELSE_PARENT",
    subject: "🎓 Exclusive Academic Term Re-Enrollment Invitation for {{student_name}} — {{institute_name}}",
    body: "Dear {{recipient_name}},<br><br>We are delighted to invite <strong>{{student_name}}</strong> ({{student_code}}) to re-enroll for our upcoming academic term at <strong>{{institute_name}}</strong>.<br><br>Having reviewed {{student_name}}'s excellent dedication in past studies{{course_mention}}, our academic directorate has reserved a priority seat with an exclusive re-enrollment grant.<br><br><div style=\"background:#f8fafc;border-left:4px solid #004ac6;padding:14px;margin:14px 0;\"><strong>Exclusive Re-Enrollment Promo Code:</strong> <span style=\"font-size:16px;color:#004ac6;font-family:monospace;font-weight:bold;\">{{discount_code}}</span><br>Apply this code during enrollment verification for 15% tuition credit.</div><br>{{custom_note}}<br><br>To confirm your schedule or explore new course offerings, simply reply to this email or sign in to your portal.<br><br>Warm regards,<br>{{institute_name}} Academic Directorate",
    enabled: true,
    updated_by: "system",
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString()
  },
  {
    key: "WELCOME_SERIES_WEEK_1",
    name: "14a. Welcome Series: Week 1 — Getting Started & Faculty Support",
    audience: "PARENTS",
    subject: "Welcome to {{institute_name}} — Week 1: Getting the Most Out of Classes",
    body: "Dear {{parent_name}},<br><br>We are thrilled to complete {{student_name}}'s first week of learning at <strong>{{institute_name}}</strong>!<br><br>Here are three quick tips to support {{student_name}}'s academic success:<br>&bull; <strong>Parent Portal:</strong> Check attendance roll-call and upcoming session times in real-time.<br>&bull; <strong>Dedicated Faculty:</strong> Your teachers prepare individualized learning plans for each student.<br>&bull; <strong>Questions?</strong> Reply directly to this email or reach our support team anytime at {{support_email}}.<br><br>Warm regards,<br>{{institute_name}} Academic Operations",
    enabled: true,
    updated_by: "system",
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString()
  },
  {
    key: "WELCOME_SERIES_WEEK_2",
    name: "14b. Welcome Series: Week 2 — Study Habits & Practice Milestones",
    audience: "PARENTS",
    subject: "{{student_name}}'s Journey at {{institute_name}} — Week 2 Progress Check",
    body: "Dear {{parent_name}},<br><br>As {{student_name}} wraps up week 2 at <strong>{{institute_name}}</strong>, we want to share our appreciation for your partnership in education.<br><br>By maintaining regular attendance and completing practice assignments, students typically accelerate comprehension by up to 40%. You can log into your Parent Portal anytime to review class logs and instructor notes.<br><br>Thank you for being part of our academic family!<br><br>Warm regards,<br>{{institute_name}} Team",
    enabled: true,
    updated_by: "system",
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString()
  },
  {
    key: "WELCOME_SERIES_WEEK_3",
    name: "14c. Welcome Series: Week 3 — Celebrating Milestones & Feedback",
    audience: "PARENTS",
    subject: "Week 3 Milestone: How Is {{student_name}} Enjoying Classes at {{institute_name}}?",
    body: "Dear {{parent_name}},<br><br>{{student_name}} has now completed three weeks at <strong>{{institute_name}}</strong>! We hope the learning experience has been inspiring and enriching.<br><br>We value your feedback immensely. If you have any thoughts, suggestions, or questions regarding {{student_name}}'s curriculum track or faculty mentors, please reply directly to this email.<br><br>Here is to continued academic excellence!<br><br>Warm regards,<br>{{institute_name}} Leadership",
    enabled: true,
    updated_by: "system",
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString()
  },
  {
    key: "WE_MISS_YOU_14_DAYS",
    name: "15. We Miss You Notice (14 Days Inactive)",
    audience: "PARENTS",
    subject: "We Miss You at {{institute_name}}, {{student_name}}!",
    body: "Dear {{parent_name}},<br><br>We noticed it has been over 14 days since <strong>{{student_name}}</strong> attended a scheduled session at <strong>{{institute_name}}</strong>.<br><br>Consistent learning rhythm is key to long-term academic mastery and retention. We would love to welcome {{student_name}} back to the classroom!<br><br>Please sign in to the Parent Portal or reply to this message so we can assist you with scheduling, class rescheduling, or curriculum adjustments.<br><br>Warm regards,<br>{{institute_name}} Student Support Directorate",
    enabled: true,
    updated_by: "system",
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString()
  },
  {
    key: "UPSELL_SUGGESTION",
    name: "16. Academic Growth & Course Upsell Suggestion",
    audience: "PARENTS",
    subject: "Academic Recommendation for {{student_name}}: {{suggestion_title}}",
    body: "Dear {{parent_name}},<br><br>Based on <strong>{{student_name}}</strong>'s recent progress and enrollment at <strong>{{institute_name}}</strong>, our academic advisory team has a tailored recommendation:<br><br><div style=\"background:#f0fdf4;border-left:4px solid #16a34a;padding:16px;margin:16px 0;border-radius:8px;\"><strong>🎯 {{suggestion_title}}</strong><br><p style=\"margin:8px 0 0 0;color:#166534;line-height:1.6;\">{{recommendation_text}}</p></div><br>To confirm this recommendation or explore available class slots, please reply to this email or speak with our academic directorate.<br><br>Warm regards,<br>{{institute_name}} Academic Advisory Team",
    enabled: true,
    updated_by: "system",
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString()
  },
  {
    key: "CAMPAIGN_BROADCAST",
    name: "17. Campaign Broadcast Announcement",
    audience: "ALL",
    subject: "{{subject}}",
    body: "Dear {{recipient_name}},<br><br>{{campaign_body}}<br><br>For any inquiries, please contact {{institute_name}} at {{support_email}}.<br><br>Warm regards,<br>{{institute_name}} Administration",
    enabled: true,
    updated_by: "system",
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString()
  }
];

// Initialize with default seeded templates
let cachedTemplates: Map<string, EmailTemplateRow> = new Map(
  DEFAULT_EMAIL_TEMPLATES.map(t => [t.key, { ...t }])
);
let lastCacheRefresh = 0;
const CACHE_TTL_MS = 60 * 1000;

export async function refreshTemplatesCache(): Promise<Map<string, EmailTemplateRow>> {
  try {
    const { data, error } = await supabaseAdmin.from("email_templates").select("*");
    if (!error && data && data.length > 0) {
      for (const row of data as EmailTemplateRow[]) {
        cachedTemplates.set(row.key, row);
      }
      lastCacheRefresh = Date.now();
    }
  } catch (err: any) {
    console.warn("Notice loading email_templates cache:", err?.message);
  }
  return cachedTemplates;
}

export async function getTemplate(key: string): Promise<EmailTemplateRow | null> {
  if (Date.now() - lastCacheRefresh > CACHE_TTL_MS) {
    await refreshTemplatesCache();
  }
  return cachedTemplates.get(key) || null;
}

export async function listTemplates(): Promise<EmailTemplateRow[]> {
  if (Date.now() - lastCacheRefresh > CACHE_TTL_MS) {
    await refreshTemplatesCache();
  }
  return Array.from(cachedTemplates.values()).sort((a, b) => a.key.localeCompare(b.key));
}

export async function updateTemplate(
  key: string,
  updates: { subject?: string | undefined; body?: string | undefined; enabled?: boolean | undefined; updatedBy?: string | undefined }
): Promise<EmailTemplateRow> {
  const existing = cachedTemplates.get(key) || DEFAULT_EMAIL_TEMPLATES.find(t => t.key === key);
  if (!existing) {
    throw new Error(`Email template with key '${key}' does not exist.`);
  }

  const updated: EmailTemplateRow = {
    ...existing,
    subject: updates.subject !== undefined ? updates.subject.trim() : existing.subject,
    body: updates.body !== undefined ? updates.body : existing.body,
    enabled: updates.enabled !== undefined ? updates.enabled : existing.enabled,
    updated_by: updates.updatedBy !== undefined ? updates.updatedBy : existing.updated_by,
    updated_at: new Date().toISOString()
  };

  cachedTemplates.set(key, updated);

  try {
    const patch: any = {
      updated_at: updated.updated_at
    };
    if (updates.subject !== undefined) patch.subject = updated.subject;
    if (updates.body !== undefined) patch.body = updated.body;
    if (updates.enabled !== undefined) patch.enabled = updated.enabled;
    if (updates.updatedBy !== undefined) patch.updated_by = updated.updated_by;

    await supabaseAdmin.from("email_templates").update(patch).eq("key", key);
  } catch (err: any) {
    console.warn("Notice persisting template to database:", err?.message);
  }

  return updated;
}

/**
 * Safely interpolates {{variables}} into template subject and body.
 * Values are HTML-escaped by default to prevent XSS. Variables named with '_html'
 * or explicitly marked safe are allowed raw HTML.
 */
export function renderString(
  templateStr: string,
  variables: Record<string, any>
): string {
  return templateStr.replace(/\{\{\s*([a-zA-Z0-9_]+)\s*\}\}/g, (match, varName) => {
    if (Object.prototype.hasOwnProperty.call(variables, varName)) {
      const val = variables[varName];
      if (val === null || val === undefined) return "";
      if (varName.endsWith("_html") || varName === "changes_list" || varName === "classes_summary" || varName === "remarks_block") {
        return String(val);
      }
      return escapeHtml(String(val));
    }
    return match;
  });
}

export interface RenderedEmail {
  key: string;
  enabled: boolean;
  subject: string;
  htmlBody: string;
}

/**
 * Renders a full email template with global and per-event variables.
 */
export async function renderTemplate(
  key: string,
  variables: Record<string, any> = {}
): Promise<RenderedEmail> {
  const tpl = await getTemplate(key);
  if (!tpl) {
    throw new Error(`Email template with key '${key}' does not exist.`);
  }

  const settings = getCachedInstituteSettings();
  const globalVars = {
    institute_name: settings.institute_name || "Top Grade Learning",
    support_email: settings.support_email || "support@topgradelearning.com",
    phone: settings.phone || "",
    current_year: new Date().getFullYear(),
    ...variables
  };

  const subject = renderString(tpl.subject, globalVars);
  const htmlBody = renderString(tpl.body, globalVars);

  return {
    key: tpl.key,
    enabled: tpl.enabled,
    subject,
    htmlBody
  };
}

/**
 * Sends a test email to the requested address with sample or provided variables.
 */
export async function sendTemplateTest(
  key: string,
  recipientEmail: string,
  sampleVars: Record<string, any> = {}
): Promise<{ success: boolean; subject: string; message: string }> {
  const rendered = await renderTemplate(key, sampleVars);
  const testSubject = `[TEST PREVIEW] ${rendered.subject}`;
  const testBody = `
    <div style="background:#fef3c7;border:1px solid #f59e0b;padding:12px;border-radius:8px;margin-bottom:16px;color:#92400e;font-size:13px;">
      <strong>⚠️ Test Preview Notification:</strong> This is a sample render of template <code>${key}</code> sent for administrator preview.
    </div>
    ${rendered.htmlBody}
  `;

  const result = await dispatchMultiChannelNotification({
    eventType: "ADMISSION_APPROVED",
    subject: testSubject,
    message: testBody,
    recipients: [{ role: "ADMIN", email: recipientEmail, name: "Admin Test User", phone: "" }]
  });

  return {
    success: result.success,
    subject: testSubject,
    message: result.dispatchedLogs.join("\n") || "Test preview sent"
  };
}
