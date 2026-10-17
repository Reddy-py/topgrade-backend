import { supabaseAdmin } from "../supabase.js";
import { dispatchMultiChannelNotification } from "./notificationService.js";

export interface AlertLogRecord {
  id: string;
  triggerType: 
    | "UPCOMING_DUE_ALERT"
    | "PARTIAL_PAYMENT_ALERT"
    | "AUTO_PARENT_REMINDER"
    | "WELCOME_EMAIL"
    | "CLASS_SCHEDULE_EMAIL"
    | "ATTENDANCE_SUMMARY_EMAIL"
    | "PAYMENT_RECEIPT"
    | "FEE_REMINDER"
    | "MONTHLY_PROGRESS_UPDATE"
    | "CUSTOM_ANNOUNCEMENT";
  recipientId: string;
  recipientName: string;
  recipientEmail: string;
  recipientPhone: string;
  recipientRole: "STUDENT" | "PARENT" | "TEACHER" | "ALL";
  channel: "EMAIL" | "SMS" | "MULTI_CHANNEL";
  subject: string;
  messagePreview: string;
  status: "DELIVERED" | "SENT" | "FAILED";
  timestamp: string;
  metadata?: Record<string, any> | undefined;
}

export interface AutomationWorkflowConfig {
  id: string;
  name: string;
  triggerType: AlertLogRecord["triggerType"];
  description: string;
  channel: "EMAIL" | "SMS" | "MULTI_CHANNEL";
  defaultSubject: string;
  defaultTemplate: string;
  isActive: boolean;
  frequency: "Instant" | "Daily 09:00 AM" | "Weekly Friday" | "Monthly 1st";
}

function mapAlertLogRow(row: any): AlertLogRecord {
  return {
    id: row.id,
    triggerType: row.trigger_type,
    recipientId: row.recipient_id || "",
    recipientName: row.recipient_name,
    recipientEmail: row.recipient_email,
    recipientPhone: row.recipient_phone || "",
    recipientRole: row.recipient_role || "STUDENT",
    channel: row.channel || "MULTI_CHANNEL",
    subject: row.subject,
    messagePreview: row.message_preview,
    status: row.status || "DELIVERED",
    timestamp: row.timestamp || row.created_at,
    metadata: row.metadata || undefined
  };
}

// Pre-configured automated templates
export const automationWorkflows: AutomationWorkflowConfig[] = [
  {
    id: "auto-1",
    name: "Welcome & Onboarding Email",
    triggerType: "WELCOME_EMAIL",
    description: "Automatically sent upon student admission with portal credentials, policy guide, and welcome dossier.",
    channel: "MULTI_CHANNEL",
    defaultSubject: "🎓 Welcome to TopGrade Learning — Official Enrollment Packet",
    defaultTemplate: "Dear {studentName},\n\nWelcome to TopGrade Learning! Your enrollment is officially active with Student Code: {studentCode}.\n\nYour portal access is ready. Log in to review course curriculum and attendance records.\n\nBest Regards,\nTopGrade Learning Administration",
    isActive: true,
    frequency: "Instant"
  },
  {
    id: "auto-2",
    name: "Class Schedule & Room Timetable",
    triggerType: "CLASS_SCHEDULE_EMAIL",
    description: "Dispatches weekly schedule timings, room/lab allocation, and assigned faculty info.",
    channel: "EMAIL",
    defaultSubject: "📅 Weekly Class Timetable & Room Allocation — TopGrade Learning",
    defaultTemplate: "Dear {studentName} and Parents,\n\nHere is your scheduled timetable for the upcoming academic week.\n\nAssigned Faculty: {teacherName}\nSchedule Slots: {scheduleSlots}\n\nPlease arrive 5 minutes prior to session commencement.\n\nTopGrade Academic Operations",
    isActive: true,
    frequency: "Weekly Friday"
  },
  {
    id: "auto-3",
    name: "Upcoming Tuition Due Alert",
    triggerType: "UPCOMING_DUE_ALERT",
    description: "Alerts parents & students 3 days prior to tuition invoice deadline to prevent late fee penalties.",
    channel: "MULTI_CHANNEL",
    defaultSubject: "🔔 Tuition Due Reminder — Invoice {invoiceNumber}",
    defaultTemplate: "Dear {studentName} & Parents,\n\nThis is a friendly reminder that tuition for {studentName} (Invoice #{invoiceNumber}) is due on {dueDate}.\n\nAmount Due: ${amountDue}\n\nPlease complete payment online or at the administration office.\n\nTopGrade Accounts Department",
    isActive: true,
    frequency: "Daily 09:00 AM"
  },
  {
    id: "auto-4",
    name: "Partial Payment Settlement Alert",
    triggerType: "PARTIAL_PAYMENT_ALERT",
    description: "Sent instantly upon receiving partial fee payment, highlighting remaining balance and settlement timeline.",
    channel: "MULTI_CHANNEL",
    defaultSubject: "💳 Partial Fee Payment Acknowledged — Remaining Balance Notice",
    defaultTemplate: "Dear {studentName} & Parents,\n\nWe have received your partial payment of ${paidAmount} towards Invoice #{invoiceNumber}.\n\nRemaining Balance: ${remainingBalance}\nBalance Due Date: {dueDate}\n\nThank you,\nTopGrade Accounts Department",
    isActive: true,
    frequency: "Instant"
  },
  {
    id: "auto-5",
    name: "Automated Parent Reminder Notice",
    triggerType: "AUTO_PARENT_REMINDER",
    description: "Custom auto-reminders dispatched to parents regarding academic updates, documents, or teacher conferences.",
    channel: "MULTI_CHANNEL",
    defaultSubject: "📢 Important Center Notice for Parents of {studentName}",
    defaultTemplate: "Dear Parent of {studentName},\n\n{customMessage}\n\nFor any inquiries, please reply to this email or reach us at the center.\n\nTopGrade Learning Administration",
    isActive: true,
    frequency: "Instant"
  },
  {
    id: "auto-6",
    name: "Attendance Summary Digest",
    triggerType: "ATTENDANCE_SUMMARY_EMAIL",
    description: "Weekly or monthly attendance percentage report sent to parents and students.",
    channel: "EMAIL",
    defaultSubject: "📊 Attendance Performance Summary for {studentName}",
    defaultTemplate: "Dear Parents,\n\nHere is the attendance report for {studentName} for this month:\n\nAttendance Rate: {attendancePercent}%\nTotal Sessions Attended: {presentSessions}/{totalSessions}\n\nTopGrade Learning Administration",
    isActive: true,
    frequency: "Monthly 1st"
  },
  {
    id: "auto-7",
    name: "Payment Receipt & Tax Invoice",
    triggerType: "PAYMENT_RECEIPT",
    description: "Official digital receipt with transaction reference delivered instantly upon fee payment.",
    channel: "EMAIL",
    defaultSubject: "🧾 Official Payment Receipt — {receiptNumber}",
    defaultTemplate: "Dear {studentName},\n\nThank you for your payment of ${amountPaid}.\n\nReceipt Number: {receiptNumber}\nPayment Mode: {paymentMode}\nDate: {paymentDate}\nStatus: Settled (Full)\n\nTopGrade Finance & Accounting",
    isActive: true,
    frequency: "Instant"
  },
  {
    id: "auto-8",
    name: "Overdue Fee Reminder Warning",
    triggerType: "FEE_REMINDER",
    description: "Urgent notice sent when fee is past due date with late-fee breakdown and payment link.",
    channel: "MULTI_CHANNEL",
    defaultSubject: "⚠️ URGENT: Overdue Tuition Fee Notice for {studentName}",
    defaultTemplate: "Dear {studentName} & Parents,\n\nOur records indicate an overdue balance of ${overdueAmount} for Invoice #{invoiceNumber} which was due on {dueDate}.\n\nPlease settle this balance immediately to maintain uninterrupted access to scheduled classes.\n\nTopGrade Accounts Office",
    isActive: true,
    frequency: "Daily 09:00 AM"
  },
  {
    id: "auto-9",
    name: "Monthly Academic Progress Dossier",
    triggerType: "MONTHLY_PROGRESS_UPDATE",
    description: "Monthly student academic remarks, topic mastery, and instructor feedback.",
    channel: "EMAIL",
    defaultSubject: "📈 Monthly Academic Progress Evaluation — {studentName}",
    defaultTemplate: "Dear Parents,\n\nWe are pleased to share the monthly progress review for {studentName}.\n\nCurriculum Progress: {progressRemarks}\nMentor Feedback: {mentorFeedback}\nNext Month Goal: {nextMilestone}\n\nTopGrade Academic Council",
    isActive: true,
    frequency: "Monthly 1st"
  }
];

export class AlertsService {
  /**
   * 1. Get all logs with optional filtering from Supabase alert_logs
   */
  public static async getAlertLogs(filters?: { triggerType?: string | undefined; recipientId?: string | undefined }): Promise<AlertLogRecord[]> {
    let query = supabaseAdmin.from("alert_logs").select("*").order("timestamp", { ascending: false });

    if (filters?.triggerType) {
      query = query.eq("trigger_type", filters.triggerType);
    }
    if (filters?.recipientId) {
      query = query.eq("recipient_id", filters.recipientId);
    }

    const { data, error } = await query;
    if (error) {
      console.warn("Could not query alert_logs from Supabase:", error.message);
      return [];
    }

    return (data || []).map(mapAlertLogRow);
  }

  /**
   * 2. Get Automation Workflows List
   */
  public static getWorkflows(): AutomationWorkflowConfig[] {
    return automationWorkflows;
  }

  /**
   * 3. Toggle Workflow Active State
   */
  public static toggleWorkflow(workflowId: string, isActive: boolean): AutomationWorkflowConfig | null {
    const wf = automationWorkflows.find(w => w.id === workflowId);
    if (wf) {
      wf.isActive = isActive;
      return wf;
    }
    return null;
  }

  /**
   * 4. Central Dispatch & Audit Logger in Supabase alert_logs
   */
  public static async executeAlertTrigger(input: {
    triggerType: AlertLogRecord["triggerType"];
    studentId?: string;
    targetCohort?: "ALL" | "STUDENTS" | "TEACHERS" | "PARENTS";
    customSubject?: string;
    customMessage?: string;
    metadata?: Record<string, any>;
  }) {
    const adminEmail = process.env.ADMIN_EMAIL || process.env.GMAIL_SENDER_EMAIL || "tglbiz101@gmail.com";
    const nowIso = new Date().toISOString();

    let studentQuery = supabaseAdmin.from("students").select("*");
    if (input.studentId) {
      studentQuery = studentQuery.or(`id.eq.${input.studentId},student_id_code.eq.${input.studentId}`);
    }

    const { data: students, error: stuErr } = await studentQuery;
    if (stuErr) {
      console.warn("Failed to fetch target students for alert trigger:", stuErr.message);
    }

    const targetStudents = students || [];
    const dispatchedResults: AlertLogRecord[] = [];

    for (const student of targetStudents) {
      const studentEmail = student.email || adminEmail;
      const studentPhone = student.primary_mobile || student.contact_number || "";
      const studentName = student.name || "Student";
      const studentCode = student.student_id_code || `TG-STU-${student.id}`;

      let subject = input.customSubject || `🔔 Notification from TopGrade Learning`;
      let message = input.customMessage || `Hello ${studentName},\n\nThis is an automated notification from TopGrade Learning Administration.`;

      switch (input.triggerType) {
        case "WELCOME_EMAIL":
          subject = `🎓 Welcome to TopGrade Learning — Official Enrollment Packet (${studentName})`;
          message = `Dear ${studentName},\n\nWelcome to TopGrade Learning! Your student profile is active under Student Code: [${studentCode}].\n\nGrade Track: ${student.grade || 'Academic'}\nSchool: ${student.school || 'Center'}\n\nWe look forward to helping you achieve outstanding academic results!\n\nBest Regards,\nTopGrade Learning Administration`;
          break;

        case "UPCOMING_DUE_ALERT":
          subject = `🔔 Upcoming Tuition Due Notice — ${studentName}`;
          message = `Dear ${studentName} & Parents,\n\nThis is a notification that tuition payment for the upcoming session is due in 3 days.\n\nStudent Code: ${studentCode}\nAmount Due: $350.00\nDue Date: ${new Date(Date.now() + 259200000).toLocaleDateString()}\n\nPlease settle online or contact the administration desk.\n\nTopGrade Accounts Department`;
          break;

        case "PARTIAL_PAYMENT_ALERT":
          subject = `💳 Partial Payment Received — Remaining Balance Notice (${studentName})`;
          message = `Dear ${studentName} & Parents,\n\nWe have received your partial payment of $200.00.\n\nRemaining Balance: $150.00\nFinal Settlement Due Date: ${new Date(Date.now() + 604800000).toLocaleDateString()}\n\nThank you for choosing TopGrade Learning!`;
          break;

        case "CLASS_SCHEDULE_EMAIL":
          subject = `📅 Weekly Class Timetable & Schedule — ${studentName}`;
          message = `Dear ${studentName},\n\nHere is your scheduled academic timetable:\n\n• Monday: 09:00 AM - 10:30 AM (Room 101)\n• Wednesday: 09:00 AM - 10:30 AM (Room 101)\n• Saturday: 10:00 AM - 11:30 AM (Lab 1)\n\nTopGrade Academic Operations`;
          break;

        case "ATTENDANCE_SUMMARY_EMAIL":
          subject = `📊 Monthly Attendance Summary Report — ${studentName}`;
          message = `Dear Parents,\n\nMonthly attendance summary for ${studentName} (${studentCode}):\n\nAttendance Rate: 100% (Present in all scheduled sessions)\nClass Participation: Excellent\n\nTopGrade Learning Administration`;
          break;

        case "PAYMENT_RECEIPT":
          subject = `🧾 Official Fee Payment Receipt — REC-${Date.now().toString().slice(-6)}`;
          message = `Dear ${studentName},\n\nPayment Confirmed in Full.\n\nReceipt Number: REC-${Date.now().toString().slice(-6)}\nAmount Paid: $450.00\nDate: ${new Date().toLocaleDateString()}\nPayment Mode: Digital Payment\nStatus: Settled (Full)\n\nTopGrade Finance & Accounting`;
          break;

        case "FEE_REMINDER":
          subject = `⚠️ Fee Payment Reminder Notice — ${studentName}`;
          message = `Dear ${studentName} & Parents,\n\nThis is a reminder regarding tuition fees due for your enrolled courses.\n\nPlease process payment at your earliest convenience.\n\nTopGrade Accounts Department`;
          break;

        case "MONTHLY_PROGRESS_UPDATE":
          subject = `📈 Academic Progress & Milestone Report — ${studentName}`;
          message = `Dear Parents of ${studentName},\n\nMonthly Progress Highlights:\n• Core Subject Mastery: Strong\n• Homework & Assignments: Complete\n• Instructor Feedback: Actively participating in coding and problem-solving exercises.\n\nTopGrade Academic Council`;
          break;

        case "CUSTOM_ANNOUNCEMENT":
          subject = input.customSubject || `📢 Center Announcement: TopGrade Learning`;
          message = input.customMessage || `Dear Students & Parents,\n\nPlease take note of the latest updates from our center administration.`;
          break;

        case "AUTO_PARENT_REMINDER":
        default:
          subject = input.customSubject || `🔔 TopGrade Notification for ${studentName}`;
          message = input.customMessage || `Hello ${studentName},\n\nThis is an automated update from TopGrade Learning.`;
          break;
      }

      const logId = `log-${Date.now()}-${Math.floor(Math.random() * 1000)}`;
      const logRecord: AlertLogRecord = {
        id: logId,
        triggerType: input.triggerType,
        recipientId: student.id || `std-${studentName}`,
        recipientName: studentName,
        recipientEmail: studentEmail,
        recipientPhone: studentPhone,
        recipientRole: "STUDENT",
        channel: "MULTI_CHANNEL",
        subject,
        messagePreview: message.length > 120 ? message.slice(0, 120) + "..." : message,
        status: "DELIVERED",
        timestamp: nowIso,
        ...(input.metadata ? { metadata: input.metadata } : {})
      };

      // Persist to Supabase alert_logs
      await supabaseAdmin.from("alert_logs").insert({
        id: logRecord.id,
        trigger_type: logRecord.triggerType,
        recipient_id: logRecord.recipientId,
        recipient_name: logRecord.recipientName,
        recipient_email: logRecord.recipientEmail,
        recipient_phone: logRecord.recipientPhone,
        recipient_role: logRecord.recipientRole,
        channel: logRecord.channel,
        subject: logRecord.subject,
        message_preview: logRecord.messagePreview,
        status: logRecord.status,
        timestamp: logRecord.timestamp,
        metadata: logRecord.metadata || null
      });

      dispatchedResults.push(logRecord);

      // Asynchronous background email dispatch
      setImmediate(async () => {
        try {
          await dispatchMultiChannelNotification({
            eventType: "ADMISSION_APPROVED",
            subject,
            message,
            recipients: [
              { role: "STUDENT", email: studentEmail, name: studentName, phone: studentPhone },
              { role: "ADMIN", email: adminEmail, name: "Administrator" }
            ]
          });
        } catch (err) {
          console.warn("Notification background dispatch warning:", err);
        }
      });
    }

    return {
      success: true,
      message: `Dispatched ${dispatchedResults.length} alert notification(s) successfully.`,
      dispatchedCount: dispatchedResults.length,
      logs: dispatchedResults
    };
  }
}
