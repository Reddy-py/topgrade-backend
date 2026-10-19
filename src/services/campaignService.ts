import { supabaseAdmin } from "../supabase.js";
import { dispatchMultiChannelNotification, escapeHtml } from "./notificationService.js";
import { getCachedInstituteSettings, instituteAddress } from "./instituteSettingsService.js";
import { isUnsubscribed, verifyCanSpamAddress, buildUnsubscribeLink } from "./emailUnsubscribeService.js";
import { getAllParentEmails } from "./eventEmailService.js";
import { getAllStudentsRaw, inMemoryStudentStore } from "./studentService.js";
import { logEmail } from "./emailLog.js";
import { appendCanSpamFooter } from "./parentEngagementService.js";
import { isRealEmail } from "../constants/domains.js";

export interface CampaignRecord {
  id: string;
  title: string;
  subject: string;
  body: string;
  target_audience: string; // 'ALL_PARENTS' | 'ALL_STUDENTS' | 'ALL_FAMILIES' | 'ACTIVE_ONLY' | 'LEADS_ONLY' | 'COURSE_SPECIFIC' | 'LOW_HOURS'
  target_course?: string;
  target_source?: string;
  target_grade?: string;
  scheduled_at?: string | null;
  sent_at?: string | null;
  status: "Draft" | "Scheduled" | "Sending" | "Completed" | "Failed" | "Cancelled";
  recipients_count: number;
  sent_count: number;
  failed_count: number;
  skipped_unsubscribed_count: number;
  created_by: string;
  created_at: string;
  updated_at: string;
}

const inMemoryCampaigns = new Map<string, CampaignRecord>();

/**
 * Resolves recipient audience based on segmentation rules.
 */
export async function resolveAudienceRecipients(
  targetAudience: string,
  options?: { targetCourse?: string; targetGrade?: string; targetSource?: string }
): Promise<Array<{ role: "PARENT" | "STUDENT" | "ADMIN"; email: string; name: string }>> {
  const recipientsMap = new Map<string, { role: "PARENT" | "STUDENT" | "ADMIN"; email: string; name: string }>();

  // 1. Fetch Students
  const students = await getAllStudentsRaw().catch(() => inMemoryStudentStore);

  // 2. Fetch Leads & Admissions if applicable
  let leads: any[] = [];
  let admissions: any[] = [];
  if (targetAudience === "LEADS_ONLY" || targetAudience === "ALL_FAMILIES") {
    try {
      const { data: leadData } = await supabaseAdmin.from("leads").select("*");
      if (leadData) leads = leadData;
      const { data: admData } = await supabaseAdmin.from("admission_requests").select("*");
      if (admData) admissions = admData;
    } catch (err: any) {
      console.warn("Notice querying leads/admissions for campaign audience:", err?.message);
    }
  }

  // Audience matching logic
  for (const stu of students) {
    const isStuActive = stu.status?.toUpperCase() === "ACTIVE";

    if (targetAudience === "ACTIVE_ONLY" && !isStuActive) continue;

    if (options?.targetGrade && options.targetGrade !== "ALL") {
      const stuGrade = (stu.grade || (stu as any).nationality || "").toLowerCase();
      if (!stuGrade.includes(options.targetGrade.toLowerCase())) continue;
    }

    if (options?.targetCourse && options.targetCourse !== "ALL") {
      const stuProg = (stu.program || "").toLowerCase();
      const hasAlloc = Array.isArray(stu.allocatedCourses) &&
        stu.allocatedCourses.some((c: any) => (c.courseName || "").toLowerCase().includes(options.targetCourse!.toLowerCase()));
      if (!stuProg.includes(options.targetCourse.toLowerCase()) && !hasAlloc) continue;
    }

    if (targetAudience === "LOW_HOURS") {
      const hours = (stu as any).hoursLeft ?? (stu as any).hours_left ?? 99;
      if (hours > 3) continue;
    }

    // Add Parents
    if (targetAudience !== "ALL_STUDENTS" && targetAudience !== "LEADS_ONLY") {
      const parentEmails = getAllParentEmails(stu);
      const parentName = (stu as any).parentFirstName
        ? `${(stu as any).parentFirstName} ${(stu as any).parentLastName || ""}`.trim()
        : (stu as any).fatherName || (stu as any).motherName || "Parent";

      for (const email of parentEmails) {
        const clean = email.toLowerCase().trim();
        if (clean && !recipientsMap.has(clean)) {
          recipientsMap.set(clean, { role: "PARENT", email: clean, name: parentName });
        }
      }
    }

    // Add Students
    if (targetAudience === "ALL_STUDENTS" || targetAudience === "ALL_FAMILIES") {
      const stuEmail = (stu.email || (stu.studentEmails ? stu.studentEmails[0] : "") || "").toLowerCase().trim();
      if (stuEmail && isRealEmail(stuEmail) && !recipientsMap.has(stuEmail)) {
        recipientsMap.set(stuEmail, { role: "STUDENT", email: stuEmail, name: stu.fullName || "Student" });
      }
    }
  }

  // Leads & Inquiries
  if (targetAudience === "LEADS_ONLY" || targetAudience === "ALL_FAMILIES") {
    for (const l of leads) {
      const email = (l.email || "").toLowerCase().trim();
      if (email && !recipientsMap.has(email)) {
        recipientsMap.set(email, {
          role: "PARENT",
          email,
          name: l.full_name || l.student_name || "Prospective Family"
        });
      }
    }
    for (const adm of admissions) {
      const email = (adm.parent_email || adm.email || "").toLowerCase().trim();
      if (email && !recipientsMap.has(email)) {
        recipientsMap.set(email, {
          role: "PARENT",
          email,
          name: adm.parent_name || adm.student_name || "Prospective Parent"
        });
      }
    }
  }

  return Array.from(recipientsMap.values());
}

/**
 * Lists all marketing email campaigns.
 */
export async function listCampaigns(): Promise<CampaignRecord[]> {
  let list: CampaignRecord[] = [];

  try {
    const { data, error } = await supabaseAdmin
      .from("campaigns")
      .select("*")
      .order("created_at", { ascending: false });

    if (!error && data && data.length > 0) {
      list = data.map((d: any) => ({
        id: d.id,
        title: d.title,
        subject: d.subject,
        body: d.body || "",
        target_audience: d.target_audience || d.target_source || "ALL",
        target_course: d.target_course || "ALL",
        target_source: d.target_source || "ALL",
        target_grade: d.target_grade || "ALL",
        scheduled_at: d.scheduled_at,
        sent_at: d.sent_at,
        status: d.status || "Draft",
        recipients_count: d.recipients_count || 0,
        sent_count: d.sent_count || 0,
        failed_count: d.failed_count || 0,
        skipped_unsubscribed_count: d.skipped_unsubscribed_count || 0,
        created_by: d.created_by || "admin",
        created_at: d.created_at,
        updated_at: d.updated_at || d.created_at
      }));
    }
  } catch (err: any) {
    console.warn("Notice reading campaigns from DB:", err?.message);
  }

  // Merge in-memory campaigns
  for (const c of inMemoryCampaigns.values()) {
    if (!list.some(item => item.id === c.id)) {
      list.push(c);
    }
  }

  return list.sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime());
}

/**
 * Dispatches a campaign to resolved recipients.
 * Enforces CAN-SPAM physical postal address and skips unsubscribed addresses.
 */
export async function dispatchCampaign(campaign: CampaignRecord): Promise<{
  sentCount: number;
  failedCount: number;
  skippedUnsubscribed: number;
}> {
  // 1. CAN-SPAM physical postal address verification
  const canSpam = verifyCanSpamAddress();
  if (!canSpam.allowed) {
    throw new Error(canSpam.reason || "CAN-SPAM Violation: Institute physical postal address must be configured in Settings.");
  }

  // 2. Resolve target recipients
  const filterOpts: { targetCourse?: string; targetGrade?: string; targetSource?: string } = {};
  if (campaign.target_course) filterOpts.targetCourse = campaign.target_course;
  if (campaign.target_grade) filterOpts.targetGrade = campaign.target_grade;
  if (campaign.target_source) filterOpts.targetSource = campaign.target_source;

  const allTargets = await resolveAudienceRecipients(campaign.target_audience, filterOpts);

  let sentCount = 0;
  let failedCount = 0;
  let skippedUnsubscribed = 0;

  const validRecipients: Array<{ role: "PARENT" | "STUDENT" | "ADMIN"; email: string; name: string }> = [];

  // Filter out unsubscribed recipients efficiently with a single preloaded query
  const unsubscribedSet = new Set<string>();
  try {
    const { data: unsubRows } = await supabaseAdmin.from("email_unsubscribes").select("email, category");
    if (unsubRows) {
      unsubRows.forEach((r: any) => {
        if (r.email && r.category) {
          unsubscribedSet.add(`${r.email.toLowerCase().trim()}:${r.category.toUpperCase().trim()}`);
        }
      });
    }
  } catch (err: any) {
    console.warn("Notice querying email_unsubscribes for campaign dispatch:", err?.message);
  }

  for (const target of allTargets) {
    const cleanEmail = (target.email || "").toLowerCase().trim();
    if (!cleanEmail) continue;

    if (
      unsubscribedSet.has(`${cleanEmail}:MARKETING`) ||
      unsubscribedSet.has(`${cleanEmail}:ANNOUNCEMENTS`)
    ) {
      skippedUnsubscribed++;
      continue;
    }
    validRecipients.push(target);
  }

  if (validRecipients.length > 0) {
    // Dispatch in parallel batches of 25 to respect SMTP limits while maximizing throughput
    const BATCH_SIZE = 25;
    for (let i = 0; i < validRecipients.length; i += BATCH_SIZE) {
      const batch = validRecipients.slice(i, i + BATCH_SIZE);

      const batchResults = await Promise.all(
        batch.map(async recipient => {
          try {
            const bodyWithUnsub = appendCanSpamFooter(campaign.body, recipient.email, "MARKETING");

            const res = await dispatchMultiChannelNotification({
              eventType: "ADMISSION_APPROVED",
              subject: campaign.subject,
              message: bodyWithUnsub,
              recipients: [recipient]
            });

            return res.success && res.failed === 0 ? "sent" : "failed";
          } catch {
            return "failed";
          }
        })
      );

      for (const r of batchResults) {
        if (r === "sent") sentCount++;
        else failedCount++;
      }
    }
  }

  const nowIso = new Date().toISOString();
  campaign.status = failedCount > 0 && sentCount === 0 ? "Failed" : "Completed";
  campaign.sent_at = nowIso;
  campaign.sent_count = sentCount;
  campaign.failed_count = failedCount;
  campaign.skipped_unsubscribed_count = skippedUnsubscribed;
  campaign.recipients_count = allTargets.length;
  campaign.updated_at = nowIso;

  inMemoryCampaigns.set(campaign.id, { ...campaign });

  // Update DB
  try {
    await supabaseAdmin
      .from("campaigns")
      .upsert({
        id: campaign.id,
        title: campaign.title,
        subject: campaign.subject,
        body: campaign.body,
        target_audience: campaign.target_audience,
        target_source: campaign.target_source,
        target_grade: campaign.target_grade,
        scheduled_at: campaign.scheduled_at,
        sent_at: campaign.sent_at,
        status: campaign.status,
        recipients_count: campaign.recipients_count,
        sent_count: campaign.sent_count,
        failed_count: campaign.failed_count,
        skipped_unsubscribed_count: campaign.skipped_unsubscribed_count,
        created_by: campaign.created_by,
        updated_at: campaign.updated_at
      });
  } catch (err: any) {
    console.warn("Notice updating campaign in DB:", err?.message);
  }

  return { sentCount, failedCount, skippedUnsubscribed };
}

export interface CreateCampaignParams {
  title: string;
  subject: string;
  body: string;
  targetAudience?: string | undefined;
  target_audience?: string | undefined;
  targetCourse?: string | undefined;
  target_course?: string | undefined;
  targetGrade?: string | undefined;
  target_grade?: string | undefined;
  targetSource?: string | undefined;
  target_source?: string | undefined;
  scheduledAt?: string | null | undefined;
  scheduled_at?: string | null | undefined;
  status?: "Draft" | "Scheduled" | "Sending" | "Completed" | "Failed" | "Cancelled" | undefined;
  autoSend?: boolean | undefined;
  createdBy?: string | undefined;
}

/**
 * Creates and either immediately sends or schedules a marketing email campaign.
 */
export async function createAndScheduleCampaign(
  params: CreateCampaignParams,
  createdByArg?: string
): Promise<CampaignRecord> {
  // Validate CAN-SPAM physical postal address before allowing creation
  const canSpam = verifyCanSpamAddress();
  if (!canSpam.allowed) {
    throw new Error(canSpam.reason || "CAN-SPAM Violation: The institute physical postal address is not configured in Settings.");
  }

  const nowIso = new Date().toISOString();
  const campaignId = `cmp-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;

  const scheduledTime = params.scheduledAt !== undefined ? params.scheduledAt : params.scheduled_at;
  const isFuture = !!scheduledTime && new Date(scheduledTime).getTime() > Date.now();

  const campaign: CampaignRecord = {
    id: campaignId,
    title: params.title.trim(),
    subject: params.subject.trim(),
    body: params.body.trim(),
    target_audience: params.targetAudience || params.target_audience || "ALL_FAMILIES",
    target_course: params.targetCourse || params.target_course || "ALL",
    target_source: params.targetSource || params.target_source || "ALL",
    target_grade: params.targetGrade || params.target_grade || "ALL",
    scheduled_at: isFuture && scheduledTime ? scheduledTime : null,
    sent_at: null,
    status: isFuture ? "Scheduled" : (params.autoSend ? "Sending" : (params.status || "Draft")),
    recipients_count: 0,
    sent_count: 0,
    failed_count: 0,
    skipped_unsubscribed_count: 0,
    created_by: params.createdBy || createdByArg || "admin",
    created_at: nowIso,
    updated_at: nowIso
  };

  inMemoryCampaigns.set(campaignId, campaign);

  if (isFuture) {
    try {
      await supabaseAdmin.from("campaigns").insert({
        id: campaign.id,
        title: campaign.title,
        subject: campaign.subject,
        body: campaign.body,
        target_audience: campaign.target_audience,
        target_source: campaign.target_source,
        target_grade: campaign.target_grade,
        scheduled_at: campaign.scheduled_at,
        status: "Scheduled",
        recipients_count: 0,
        created_by: campaign.created_by,
        created_at: campaign.created_at,
        updated_at: campaign.updated_at
      });
    } catch (err: any) {
      console.warn("Notice inserting scheduled campaign in DB:", err?.message);
    }
  }

  // If explicit immediate send requested
  if (params.autoSend && !isFuture) {
    await dispatchCampaign(campaign);
  }

  return inMemoryCampaigns.get(campaignId) || campaign;
}

/**
 * Triggers immediate dispatch of a scheduled campaign.
 */
export async function sendScheduledCampaignNow(campaignId: string): Promise<CampaignRecord & {
  success: boolean;
  message: string;
  sent: number;
  failed: number;
  skipped_unsubscribed: number;
}> {
  const campaign = inMemoryCampaigns.get(campaignId) || (await listCampaigns()).find(c => c.id === campaignId);

  if (!campaign) {
    throw new Error(`Campaign with ID '${campaignId}' not found.`);
  }

  const { sentCount, failedCount, skippedUnsubscribed } = await dispatchCampaign(campaign);
  const updated = inMemoryCampaigns.get(campaignId) || campaign;

  return {
    ...updated,
    success: true,
    message: `Campaign executed successfully. Sent: ${sentCount}, Failed: ${failedCount}, Skipped: ${skippedUnsubscribed}`,
    sent: sentCount,
    failed: failedCount,
    skipped_unsubscribed: skippedUnsubscribed
  };
}

/**
 * Cancels a scheduled campaign.
 */
export async function cancelScheduledCampaign(campaignId: string): Promise<CampaignRecord> {
  const campaigns = await listCampaigns();
  const campaign = campaigns.find(c => c.id === campaignId);

  if (!campaign) {
    throw new Error(`Campaign with ID '${campaignId}' not found.`);
  }

  campaign.status = "Cancelled";
  campaign.updated_at = new Date().toISOString();
  inMemoryCampaigns.set(campaignId, { ...campaign });

  try {
    await supabaseAdmin
      .from("campaigns")
      .update({ status: "Cancelled", updated_at: campaign.updated_at })
      .eq("id", campaignId);
  } catch (err: any) {
    console.warn("Notice cancelling campaign in DB:", err?.message);
  }

  return campaign;
}

/**
 * Checks for pending scheduled campaigns due to be sent.
 * Called automatically by TimedEmailScheduler.
 */
export async function processDueScheduledCampaigns(): Promise<number> {
  const campaigns = await listCampaigns();
  const nowMs = Date.now();
  let dispatched = 0;

  for (const c of campaigns) {
    if (c.status === "Scheduled" && c.scheduled_at) {
      const schedMs = new Date(c.scheduled_at).getTime();
      if (!isNaN(schedMs) && schedMs <= nowMs) {
        try {
          await dispatchCampaign(c);
          dispatched++;
        } catch (err: any) {
          console.warn(`Notice dispatching scheduled campaign '${c.id}':`, err?.message);
        }
      }
    }
  }

  return dispatched;
}

export const createCampaign = createAndScheduleCampaign;
export const sendCampaignNow = sendScheduledCampaignNow;
export const cancelCampaign = cancelScheduledCampaign;

export const campaignService = {
  createCampaign: createAndScheduleCampaign,
  createAndScheduleCampaign,
  listCampaigns,
  dispatchCampaign,
  sendCampaignNow: sendScheduledCampaignNow,
  sendScheduledCampaignNow,
  cancelCampaign: cancelScheduledCampaign,
  cancelScheduledCampaign,
  resolveAudienceRecipients,
  processDueScheduledCampaigns
};
