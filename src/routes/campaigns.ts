import express from "express";
import { supabaseAdmin } from "../supabase.js";
import { authenticateJwt } from "../middleware/auth.js";
import type { AuthenticatedRequest } from "../middleware/auth.js";
import { authorizePermission } from "../middleware/authorize.js";
import { dispatchMultiChannelNotification } from "../services/notificationService.js";
import { inMemoryLeads } from "./leads.js";

const router = express.Router();

export let inMemoryCampaigns: any[] = [
  {
    id: "cmp-2026-01",
    title: "🚀 Fall STEM Olympiad Special 20% Discount Offer",
    subject: "Exclusive 20% Tuition Waiver for TopGrade STEM Track",
    target_source: "whatsapp",
    target_grade: "ALL",
    recipients_count: 5,
    status: "Completed",
    sent_at: new Date(Date.now() - 86400000).toISOString()
  }
];

// 1. POST /api/campaigns/broadcast — Send Targeted Promotional Emails
router.post("/broadcast", authenticateJwt, authorizePermission("students.edit"), async (req: AuthenticatedRequest, res) => {
  const { title, subject, message, target_source, target_grade } = req.body;

  try {
    // 1. Fetch leads from database or in-memory leads array
    let leads: any[] = [];
    try {
      const { data } = await supabaseAdmin.from("admission_requests").select("*");
      if (data && data.length > 0) {
        leads = data;
      } else {
        leads = inMemoryLeads;
      }
    } catch (err) {
      leads = inMemoryLeads;
    }

    // 2. Apply Segmentation Filtering Rules
    const filteredLeads = leads.filter((lead) => {
      const src = (lead.source || "external_website").toLowerCase();
      const grade = (lead.grade_level || lead.course_interested || "").toLowerCase();

      if (target_source && target_source !== "ALL") {
        if (!src.includes(target_source.toLowerCase())) return false;
      }

      if (target_grade && target_grade !== "ALL") {
        if (!grade.includes(target_grade.toLowerCase())) return false;
      }

      return true;
    });

    // 3. Resolve Target Email Addresses
    const adminEmail = process.env.GMAIL_USER || "sivareddy683970@gmail.com";
    const targetEmails: Array<{ role: "STUDENT" | "PARENT" | "ADMIN"; email: string; name: string }> = [
      { role: "ADMIN", email: adminEmail, name: "Campaign Administrator" }
    ];

    filteredLeads.forEach((lead) => {
      const pEmail = lead.parent_email || lead.email;
      if (pEmail && !targetEmails.some((t) => t.email === pEmail)) {
        targetEmails.push({
          role: "PARENT",
          email: pEmail,
          name: lead.student_name || "Prospective Parent"
        });
      }
    });

    // 4. Dispatch Email Campaign via Nodemailer Gmail Engine
    await dispatchMultiChannelNotification({
      eventType: "ADMISSION_INQUIRY",
      subject: subject || `📣 ${title || "Special Promotional Update from TopGrade CRM"}`,
      message: `Dear Prospective Student / Parent,\n\n${message || "We are pleased to share an exciting promotional course update with you!"}\n\n• Campaign: ${title}\n• Target Segment: ${target_source || "All Sources"} (${target_grade || "All Grades"})\n\nContact TopGrade Admissions Office for instant enrollment assistance.`,
      recipients: targetEmails
    });

    const campaignRecord = {
      id: `cmp-${Date.now()}`,
      title: title || "Promotional Campaign",
      subject: subject || "TopGrade Course Update",
      target_source: target_source || "ALL",
      target_grade: target_grade || "ALL",
      recipients_count: targetEmails.length,
      status: "Completed",
      sent_at: new Date().toISOString()
    };

    inMemoryCampaigns.unshift(campaignRecord);

    res.status(200).json({
      success: true,
      message: `Campaign broadcast successfully delivered to ${targetEmails.length} recipients via Gmail SMTP!`,
      data: campaignRecord
    });
  } catch (error: any) {
    console.error("Campaign Broadcast Error:", error);
    res.status(500).json({ success: false, message: error.message });
  }
});

// 2. GET /api/campaigns/history — Fetch Past Delivered Campaigns
router.get("/history", authenticateJwt, async (_req: AuthenticatedRequest, res) => {
  res.status(200).json({
    success: true,
    data: inMemoryCampaigns
  });
});

export default router;
