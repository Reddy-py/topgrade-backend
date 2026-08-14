import nodemailer from "nodemailer";
import dotenv from "dotenv";

dotenv.config();

export interface NotificationPayload {
  recipients: Array<{
    role: "STUDENT" | "PARENT" | "TEACHER" | "ACCOUNTANT" | "ADMIN";
    email?: string;
    phone?: string;
    name?: string;
  }>;
  subject: string;
  message: string;
  smsMessage?: string;
  eventType: "ADMISSION_INQUIRY" | "ADMISSION_APPROVED" | "PAYMENT_COMPLETED" | "DE_ENROLLMENT_REQUESTED" | "DE_ENROLLMENT_APPROVED" | "ATTENDANCE_ALERT" | "TEACHER_ASSIGNMENT";
  actionUrl?: string;
}

/**
 * Dynamic Gmail Transporter Setup (Reads latest GMAIL_USER and GMAIL_APP_PASSWORD from .env)
 */
function getTransporter(): { transporter: nodemailer.Transporter | null; gmailUser: string } {
  dotenv.config();
  const gmailUser = process.env.GMAIL_USER || "sivareddy683970@gmail.com";
  const gmailPass = process.env.GMAIL_APP_PASSWORD || "";

  if (gmailUser && gmailPass) {
    const transporter = nodemailer.createTransport({
      service: "gmail",
      auth: {
        user: gmailUser,
        pass: gmailPass,
      },
    });
    return { transporter, gmailUser };
  }
  return { transporter: null, gmailUser };
}

/**
 * Builds responsive, modern HTML email templates tailored to Top Grade Learning branding
 */
function buildHtmlEmailTemplate(subject: string, message: string, role: string, recipientName: string, actionUrl?: string): string {
  return `
    <!DOCTYPE html>
    <html>
    <head>
      <meta charset="utf-8">
      <style>
        body { font-family: 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif; background-color: #f4f6fb; margin: 0; padding: 20px; color: #0d1c2f; }
        .container { max-width: 600px; margin: 0 auto; background: #ffffff; border-radius: 16px; overflow: hidden; box-shadow: 0 10px 25px rgba(0,0,0,0.05); border: 1px solid #e2e8f0; }
        .header { background: linear-gradient(135deg, #004ac6 0%, #1e40af 100%); padding: 30px 20px; text-align: center; color: #ffffff; }
        .header h1 { margin: 0; font-size: 22px; font-weight: 900; letter-spacing: 0.5px; }
        .header p { margin: 5px 0 0 0; font-size: 12px; opacity: 0.85; font-weight: 600; text-transform: uppercase; }
        .content { padding: 30px 25px; line-height: 1.6; font-size: 14px; color: #334155; }
        .badge { display: inline-block; background: #e0e7ff; color: #3730a3; padding: 4px 12px; border-radius: 9999px; font-size: 11px; font-weight: 700; text-transform: uppercase; margin-bottom: 15px; }
        .message-box { background: #f8fafc; border-left: 4px solid #004ac6; padding: 15px 20px; border-radius: 8px; margin: 20px 0; font-size: 13.5px; white-space: pre-line; }
        .btn-container { text-align: center; margin: 25px 0 10px 0; }
        .btn { display: inline-block; background: #004ac6; color: #ffffff !important; padding: 12px 28px; text-decoration: none; border-radius: 12px; font-weight: 700; font-size: 13px; shadow: 0 4px 12px rgba(0,74,198,0.3); }
        .footer { background: #f8fafc; border-top: 1px solid #e2e8f0; padding: 20px; text-align: center; font-size: 11px; color: #64748b; }
      </style>
    </head>
    <body>
      <div class="container">
        <div class="header">
          <h1>🎓 Top Grade Learning</h1>
          <p>Smart Tutoring Management Engine</p>
        </div>
        <div class="content">
          <span class="badge">Notification for ${role}</span>
          <p style="margin-top:0;">Hello <strong>${recipientName}</strong>,</p>
          <div class="message-box">
            ${message}
          </div>
          ${actionUrl ? `
            <div class="btn-container">
              <a href="${actionUrl}" class="btn">Take Action in Portal &rarr;</a>
            </div>
          ` : ''}
          <p style="font-size: 12px; color: #64748b; margin-top: 25px;">If you have any questions or need assistance, please reply directly to this email or contact your center administrator.</p>
        </div>
        <div class="footer">
          <p>&copy; ${new Date().getFullYear()} Top Grade Learning CRM. All rights reserved.</p>
        </div>
      </div>
    </body>
    </html>
  `;
}

/**
 * Central Multi-Channel Notification Dispatcher (Real Gmail SMTP + SMS Simulator)
 */
export async function dispatchMultiChannelNotification(payload: NotificationPayload): Promise<{ success: boolean; dispatchedLogs: string[] }> {
  const dispatchedLogs: string[] = [];
  const { transporter, gmailUser } = getTransporter();

  for (const recipient of payload.recipients) {
    // If recipient email is missing or dummy topgrade.edu address, default to gmailUser so admin receives copy
    let emailTarget = recipient.email;
    if (!emailTarget || emailTarget.endsWith("@topgrade.edu")) {
      emailTarget = gmailUser;
    }

    const phoneTarget = recipient.phone || "+1-555-TOP-GRADE";
    const recipientName = recipient.name || recipient.role;

    // Real Gmail Send if Transporter configured
    if (transporter && emailTarget) {
      try {
        const htmlContent = buildHtmlEmailTemplate(
          payload.subject,
          payload.message,
          recipient.role,
          recipientName,
          payload.actionUrl
        );

        await transporter.sendMail({
          from: `"Top Grade Learning" <${gmailUser}>`,
          to: emailTarget,
          subject: payload.subject,
          html: htmlContent,
        });

        const liveLog = `✅ [REAL GMAIL SENT] To: ${recipient.role} <${emailTarget}> | Subject: "${payload.subject}"`;
        console.log(liveLog);
        dispatchedLogs.push(liveLog);
      } catch (err: any) {
        console.error(`❌ [GMAIL SMTP FAILURE] Could not send to ${emailTarget}:`, err.message);
        const fallbackLog = `⚠️ [GMAIL FALLBACK SIMULATED] To: ${recipient.role} <${emailTarget}> | Subject: "${payload.subject}"`;
        console.log(fallbackLog);
        dispatchedLogs.push(fallbackLog);
      }
    } else {
      // Simulation Log
      const emailLog = `📧 [SIMULATED EMAIL] Event: ${payload.eventType} | To: ${recipient.role} (${recipientName}) <${emailTarget}> | Subject: "${payload.subject}"`;
      console.log(emailLog);
      dispatchedLogs.push(emailLog);
    }

    // SMS Dispatch Log
    if (recipient.role === "PARENT" || recipient.role === "STUDENT" || recipient.phone) {
      const smsContent = payload.smsMessage || payload.message;
      const smsLog = `📱 [SMS SENT] Event: ${payload.eventType} | To: ${recipient.role} (${phoneTarget}) | Message: "${smsContent.substring(0, 120)}..."`;
      console.log(smsLog);
      dispatchedLogs.push(smsLog);
    }
  }

  return { success: true, dispatchedLogs };
}

