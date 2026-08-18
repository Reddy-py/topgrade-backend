import { dispatchMultiChannelNotification } from "./notificationService.js";

export type LeadSourceType = "WEBSITE" | "META" | "GOOGLE_ADS" | "MANUAL";
export type LeadStatusType = "PENDING" | "CONTACTED" | "CONVERTED" | "INACTIVE_ARCHIVED";
export type InteractionTypeEnum = "CALL" | "EMAIL" | "MEETING" | "NOTE";
export type InteractionOutcomeEnum = "INTERESTED" | "CALLBACK_REQUESTED" | "NOT_INTERESTED" | "NO_ANSWER";

export interface IngestLeadPayload {
  fullName: string;
  email: string;
  phone: string;
  targetGrade: string;
  source?: string;
  utmParameters?: any;
  notes?: string;
  parentName?: string;
}

export interface LeadInteractionInput {
  leadId: string;
  counselorId?: string;
  interactionType: InteractionTypeEnum;
  outcome: InteractionOutcomeEnum;
  notes: string;
  scheduledFollowUpAt?: string;
}

export interface LeadRecord {
  id: string;
  source: LeadSourceType;
  fullName: string;
  studentName: string;
  parentName?: string;
  contactNumber: string;
  phone: string;
  email: string;
  academicGrade: string;
  targetGrade: string;
  message?: string;
  notes?: string;
  utmParameters?: string;
  status: LeadStatusType;
  isConverted: boolean;
  convertedAt?: string;
  lastInteractionAt?: string;
  createdAt: string;
  updatedAt: string;
  interactions?: LeadInteractionRecord[];
}

export interface LeadInteractionRecord {
  id: string;
  leadId: string;
  counselorId?: string;
  interactionType: InteractionTypeEnum;
  outcome: InteractionOutcomeEnum;
  notes: string;
  scheduledFollowUpAt?: string | undefined;
  createdAt: string;
}

// In-Memory store for fast execution & fallback
export const leadsStore: LeadRecord[] = [];
export const leadInteractionsStore: LeadInteractionRecord[] = [];
export const enrollmentsStore: any[] = [];

export class LeadService {
  /**
   * Normalizes incoming lead source tag to standard LeadSource enum
   */
  public static normalizeSource(src?: string): LeadSourceType {
    if (!src) return "WEBSITE";
    const lower = src.toLowerCase().trim();
    if (lower.includes("meta") || lower.includes("facebook") || lower.includes("instagram") || lower.includes("fb") || lower.includes("ig")) {
      return "META";
    }
    if (lower.includes("google") || lower.includes("g_ads") || lower.includes("adwords")) {
      return "GOOGLE_ADS";
    }
    if (lower.includes("manual") || lower.includes("walkin") || lower.includes("phone")) {
      return "MANUAL";
    }
    return "WEBSITE";
  }

  /**
   * 1. Lead Ingestion & Deduplication Logic
   * Checks existing records by email and phone. Appends note if duplicate, creates new record if fresh.
   */
  public static async ingestAndDeduplicateLead(payload: IngestLeadPayload): Promise<{ lead: LeadRecord; isDuplicate: boolean; message: string }> {
    const cleanEmail = (payload.email || "").toLowerCase().trim();
    const cleanPhone = (payload.phone || payload.phone || "").replace(/\D/g, "");
    const source = this.normalizeSource(payload.source);
    const fullName = payload.fullName || "Prospective Student";
    const targetGrade = payload.targetGrade || "General Enrollment";
    const nowIso = new Date().toISOString();

    // Check existing leads for deduplication by email or phone
    const existingLead = leadsStore.find(l => 
      (cleanEmail && l.email.toLowerCase() === cleanEmail) ||
      (cleanPhone && l.phone.replace(/\D/g, "") === cleanPhone)
    );

    if (existingLead) {
      // Append inquiry note & touch updatedAt
      const newNote = `\n[Ingestion (${source}) - ${new Date().toLocaleDateString()}]: ${payload.notes || "New inquiry received."}`;
      existingLead.notes = existingLead.notes ? `${existingLead.notes}${newNote}` : newNote;
      existingLead.updatedAt = nowIso;

      return {
        lead: existingLead,
        isDuplicate: true,
        message: `Existing lead identified for '${existingLead.fullName}'. Appended inquiry note and updated timestamp.`
      };
    }

    // Create New Lead Record
    const utmStr = typeof payload.utmParameters === "object" ? JSON.stringify(payload.utmParameters) : payload.utmParameters || null;

    const newLead: LeadRecord = {
      id: `lead-${Date.now()}-${Math.floor(Math.random() * 1000)}`,
      source,
      fullName,
      studentName: fullName,
      parentName: payload.parentName || "",
      contactNumber: payload.phone,
      phone: payload.phone,
      email: cleanEmail,
      academicGrade: targetGrade,
      targetGrade,
      message: payload.notes || "New lead inquiry.",
      notes: payload.notes || "",
      utmParameters: utmStr,
      status: "PENDING",
      isConverted: false,
      createdAt: nowIso,
      updatedAt: nowIso,
      interactions: []
    };

    leadsStore.unshift(newLead);

    // Event Hook: Trigger Automated Welcome Email/SMS & Counselor Alert (Non-blocking async dispatch)
    const adminEmail = process.env.GMAIL_USER || "sivareddy683970@gmail.com";
    dispatchMultiChannelNotification({
      eventType: "ADMISSION_INQUIRY",
      subject: `🎉 Welcome to TopGrade Learning — Inquiry Received [${source}]`,
      message: `Dear ${fullName},\n\nThank you for reaching out to TopGrade Learning Center! We have received your inquiry for ${targetGrade}.\n\nOur Academic Counselor will contact you shortly to schedule a consultation.\n\nBest Regards,\nTopGrade Admissions Team`,
      recipients: [
        { role: "STUDENT", email: cleanEmail || adminEmail, name: fullName },
        { role: "ADMIN", email: adminEmail, name: "System Administrator" }
      ]
    }).catch(err => console.warn("Welcome notification event hook note:", err));

    return {
      lead: newLead,
      isDuplicate: false,
      message: `New lead created successfully for '${fullName}' via ${source}.`
    };
  }

  /**
   * 2. Log Counselor Follow-Up Interaction
   */
  public static logInteraction(input: LeadInteractionInput): { interaction: LeadInteractionRecord; lead: LeadRecord } {
    const lead = leadsStore.find(l => l.id === input.leadId);
    if (!lead) {
      throw new Error(`Lead with ID '${input.leadId}' not found.`);
    }

    const nowIso = new Date().toISOString();
    const interaction: LeadInteractionRecord = {
      id: `intr-${Date.now()}-${Math.floor(Math.random() * 1000)}`,
      leadId: input.leadId,
      counselorId: input.counselorId || "counselor-admin",
      interactionType: input.interactionType,
      outcome: input.outcome,
      notes: input.notes,
      scheduledFollowUpAt: input.scheduledFollowUpAt || undefined,
      createdAt: nowIso
    };

    leadInteractionsStore.unshift(interaction);
    if (!lead.interactions) lead.interactions = [];
    lead.interactions.unshift(interaction);
    lead.lastInteractionAt = nowIso;
    lead.updatedAt = nowIso;

    // Update lead status based on outcome
    if (input.outcome === "NOT_INTERESTED") {
      lead.status = "INACTIVE_ARCHIVED";
    } else if (lead.status === "PENDING") {
      lead.status = "CONTACTED";
    }

    return { interaction, lead };
  }

  /**
   * 3. Get Due & Overdue Follow-Ups
   */
  public static getDueFollowUps(): { count: number; data: any[] } {
    const now = new Date();

    const dueList = leadInteractionsStore.filter(intr => {
      if (!intr.scheduledFollowUpAt) return false;
      const followUpDate = new Date(intr.scheduledFollowUpAt);
      const parentLead = leadsStore.find(l => l.id === intr.leadId);
      
      // Filter leads that have follow-ups scheduled for today or overdue
      return followUpDate <= now && parentLead && parentLead.status !== "INACTIVE_ARCHIVED" && !parentLead.isConverted;
    }).map(intr => {
      const parentLead = leadsStore.find(l => l.id === intr.leadId);
      return {
        interactionId: intr.id,
        leadId: intr.leadId,
        studentName: parentLead?.studentName,
        email: parentLead?.email,
        phone: parentLead?.phone,
        targetGrade: parentLead?.targetGrade,
        interactionType: intr.interactionType,
        outcome: intr.outcome,
        notes: intr.notes,
        scheduledFollowUpAt: intr.scheduledFollowUpAt,
        isOverdue: new Date(intr.scheduledFollowUpAt!) < now
      };
    });

    return {
      count: dueList.length,
      data: dueList
    };
  }

  /**
   * 4. 1-Click Conversion Pipeline
   * Transitions Lead data into an Enrollment record (FORM_SUBMITTED)
   */
  public static convertLeadToEnrollment(leadId: string): { enrollment: any; lead: LeadRecord } {
    const lead = leadsStore.find(l => l.id === leadId);
    if (!lead) {
      throw new Error(`Lead with ID '${leadId}' not found.`);
    }

    if (lead.isConverted) {
      throw new Error(`Lead '${lead.fullName}' has already been converted to an enrollment.`);
    }

    const nowIso = new Date().toISOString();

    // Create Enrollment Record (FORM_SUBMITTED)
    const enrollment = {
      id: `enr-${Date.now()}`,
      leadId: lead.id,
      studentName: lead.fullName,
      email: lead.email,
      primaryMobile: lead.phone,
      academicGrade: lead.targetGrade,
      status: "FORM_SUBMITTED",
      submittedAt: nowIso,
      financialWaiver: true,
      transportWaiver: true,
      mediaWaiver: true
    };

    enrollmentsStore.unshift(enrollment);

    // Update Lead State
    lead.isConverted = true;
    lead.convertedAt = nowIso;
    lead.status = "CONVERTED";
    lead.updatedAt = nowIso;

    return { enrollment, lead };
  }

  /**
   * 5. Lead Sanitization & Auto-Archiving Routine
   * Marks leads with no interaction for > 30 days or marked NOT_INTERESTED as INACTIVE_ARCHIVED
   */
  public static archiveStaleLeads(staleDaysThreshold = 30): { archivedCount: number; archivedLeads: LeadRecord[] } {
    const now = new Date();
    const thresholdMs = staleDaysThreshold * 24 * 3600 * 1000;
    const archived: LeadRecord[] = [];

    leadsStore.forEach(lead => {
      if (lead.status === "INACTIVE_ARCHIVED" || lead.isConverted) return;

      const lastTouchTime = lead.lastInteractionAt ? new Date(lead.lastInteractionAt).getTime() : new Date(lead.createdAt).getTime();
      const inactivityMs = now.getTime() - lastTouchTime;

      if (inactivityMs > thresholdMs) {
        lead.status = "INACTIVE_ARCHIVED";
        lead.updatedAt = now.toISOString();
        archived.push(lead);
      }
    });

    return {
      archivedCount: archived.length,
      archivedLeads: archived
    };
  }
}
