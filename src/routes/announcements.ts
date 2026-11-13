import { Router } from "express";
import type { Request, Response } from "express";
import type { AuthenticatedRequest } from "../middleware/auth.js";
import { broadcastAnnouncement, type BroadcastAnnouncementInput } from "../services/eventEmailService.js";
import { supabaseAdmin } from "../supabase.js";
import { isRealEmail } from "../constants/domains.js";

const router = Router();

/**
 * Helper to resolve recipients and group by role
 */
async function resolveAudienceRecipients(
  audience: string,
  customEmail?: string,
  targetFilter?: string
): Promise<Array<{ email: string; name: string; role: string }>> {
  const result: Array<{ email: string; name: string; role: string }> = [];
  const seenEmails = new Set<string>();

  const add = (email: string, name: string, role: string) => {
    const norm = String(email || "").trim().toLowerCase();
    if (isRealEmail(norm) && !seenEmails.has(norm)) {
      seenEmails.add(norm);
      result.push({ email: norm, name: name || norm, role });
    }
  };

  const aud = String(audience || "").toUpperCase();

  // 1. Custom Single Email
  if (aud === "CUSTOM_EMAIL" || aud === "SINGLE_EMAIL" || aud === "CUSTOM") {
    const raw = (customEmail || targetFilter || "").trim();
    if (raw && raw.includes("@")) {
      add(raw, "Direct Recipient", "CUSTOM");
    }
    return result;
  }

  // 2. Teachers
  if (aud === "ALL_TEACHERS" || aud === "TEACHERS" || aud === "EVERYONE" || aud === "ALL") {
    const { data: teachers } = await supabaseAdmin
      .from("teachers")
      .select("email, name, status")
      .eq("status", "Active");

    for (const t of teachers || []) {
      if (t.email) add(t.email, t.name || "Faculty Member", "TEACHER");
    }
  }

  // 3. Students and Parents
  if (
    aud === "ALL_STUDENTS" || aud === "STUDENTS" ||
    aud === "ALL_PARENTS" || aud === "PARENTS" ||
    aud === "EVERYONE" || aud === "ALL" ||
    aud === "COURSE" || aud === "PROGRAM"
  ) {
    let q = supabaseAdmin
      .from("students")
      .select("id, name, email, parent_emails, status, program")
      .eq("status", "ACTIVE");

    if (aud === "PROGRAM" && targetFilter) {
      q = q.ilike("program", `%${targetFilter}%`);
    }

    const { data: students } = await q;

    for (const s of students || []) {
      // Student email
      if (aud === "ALL_STUDENTS" || aud === "STUDENTS" || aud === "EVERYONE" || aud === "ALL") {
        if (s.email) add(s.email, s.name || "Student", "STUDENT");
      }
      // Parent emails
      if (aud === "ALL_PARENTS" || aud === "PARENTS" || aud === "EVERYONE" || aud === "ALL" || aud === "PROGRAM") {
        if (Array.isArray(s.parent_emails)) {
          for (const pe of s.parent_emails) {
            if (pe) add(pe, `Parent of ${s.name || "Student"}`, "PARENT");
          }
        }
      }
    }
  }

  // 4. Admins
  if (aud === "ADMINS" || aud === "EVERYONE" || aud === "ALL") {
    const { data: admins } = await supabaseAdmin
      .from("profiles")
      .select("email, full_name, role")
      .in("role", ["ADMIN", "SUPER_ADMIN", "DIRECTOR"]);

    for (const a of admins || []) {
      if (a.email) add(a.email, a.full_name || "Admin", "ADMIN");
    }
  }

  return result;
}

/**
 * POST /api/emails/announcements/preview
 * Resolves recipients count and list grouped by role without sending anything.
 */
router.post("/preview", async (req: Request, res: Response): Promise<any> => {
  try {
    const { audience, customEmail, targetFilter } = req.body || {};
    const recipients = await resolveAudienceRecipients(audience, customEmail, targetFilter);

    // Group counts by role
    const groupedCounts: Record<string, number> = {};
    for (const r of recipients) {
      groupedCounts[r.role] = (groupedCounts[r.role] || 0) + 1;
    }

    return res.json({
      success: true,
      totalCount: recipients.length,
      groupedCounts,
      recipients: recipients.slice(0, 100) // preview first 100
    });
  } catch (err: any) {
    return res.status(500).json({ success: false, message: err?.message || "Failed to preview recipients." });
  }
});

/**
 * POST /api/emails/announcements
 * Broadcasts an announcement message to the specified audience.
 * Stores announcement and individual delivery rows in Supabase.
 */
router.post("/", async (req: Request, res: Response): Promise<any> => {
  try {
    const authReq = req as AuthenticatedRequest;
    if (authReq.user?.role !== "ADMIN") {
      return res.status(403).json({ success: false, message: "Only administrators can broadcast announcements." });
    }

    const { title, body, audience, targetFilter, customEmail, isTest } = req.body || {};

    if (!title || !title.trim()) {
      return res.status(400).json({ success: false, message: "Announcement title is required." });
    }
    if (!body || !body.trim()) {
      return res.status(400).json({ success: false, message: "Announcement message body is required." });
    }

    const effectiveTargetFilter = (customEmail || targetFilter ? String(customEmail || targetFilter).trim() : undefined);
    const resolvedAudience = String(audience || "CUSTOM_EMAIL").toUpperCase();

    if ((resolvedAudience === "CUSTOM_EMAIL" || resolvedAudience === "SINGLE_EMAIL" || resolvedAudience === "CUSTOM") && (!effectiveTargetFilter || !effectiveTargetFilter.includes("@"))) {
      return res.status(400).json({
        success: false,
        message: "A valid recipient email address is required for custom single email announcements."
      });
    }

    const recipients = await resolveAudienceRecipients(resolvedAudience, effectiveTargetFilter, effectiveTargetFilter);

    if (recipients.length === 0) {
      return res.status(400).json({
        success: false,
        message: "No valid deliverable recipients found for the selected audience."
      });
    }

    // Insert into public.announcements
    let announcementId: string | null = null;
    try {
      const audType = ["ALL", "PARENTS", "TEACHERS", "STUDENTS", "ADMINS"].includes(resolvedAudience)
        ? resolvedAudience
        : "CUSTOM";

      const { data: annData } = await supabaseAdmin
        .from("announcements")
        .insert({
          title: (isTest ? "[TEST] " : "") + title.trim(),
          body: body.trim(),
          audience_type: audType,
          created_by: authReq.user?.email || "Admin"
        })
        .select("id")
        .single();

      if (annData) announcementId = annData.id;
    } catch (annErr) {
      console.warn("Notice: Failed to insert public.announcements record:", annErr);
    }

    const result = await broadcastAnnouncement({
      title: (isTest ? "[TEST] " : "") + title.trim(),
      body: body.trim(),
      audience: (resolvedAudience as any),
      customEmail: effectiveTargetFilter,
      targetFilter: effectiveTargetFilter,
      senderAdminEmail: authReq.user?.email,
      recipients: recipients.map(r => ({ email: r.email, name: r.name }))
    });

    if (result.blockedCanSpam) {
      return res.status(422).json({
        success: false,
        blockedCanSpam: true,
        message: result.reason || "CAN-SPAM check failed. Physical postal address is required before sending announcements."
      });
    }

    // Record deliveries in public.announcement_deliveries
    if (announcementId) {
      try {
        const deliveryRows = recipients.map(r => ({
          announcement_id: announcementId,
          recipient_email: r.email,
          recipient_name: r.name,
          recipient_role: r.role,
          status: result.success ? "sent" : "failed",
          sent_at: new Date().toISOString()
        }));

        await supabaseAdmin.from("announcement_deliveries").insert(deliveryRows);
      } catch (delErr) {
        console.warn("Notice: Failed to insert announcement_deliveries:", delErr);
      }
    }

    return res.json({
      success: true,
      message: `Announcement broadcast complete. Dispatched to ${result.sentCount} recipient(s). ${result.skippedUnsubscribed} skipped due to unsubscribe preference.`,
      stats: {
        totalRecipients: result.totalRecipients,
        sentCount: result.sentCount,
        skippedUnsubscribed: result.skippedUnsubscribed
      }
    });
  } catch (err: any) {
    return res.status(500).json({ success: false, message: err?.message || "Failed to broadcast announcement." });
  }
});

export default router;
