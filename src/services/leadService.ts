import { supabaseAdmin } from "../supabase.js";
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

function mapLeadRow(row: any, interactions: LeadInteractionRecord[] = []): LeadRecord {
  return {
    id: row.id,
    source: (row.source || "WEBSITE") as LeadSourceType,
    fullName: row.full_name || row.student_name || "Prospective Student",
    studentName: row.student_name || row.full_name || "Prospective Student",
    parentName: row.parent_name || "",
    contactNumber: row.contact_number || row.phone || "",
    phone: row.phone || row.contact_number || "",
    email: row.email || "",
    academicGrade: row.academic_grade || row.target_grade || "General Enrollment",
    targetGrade: row.target_grade || row.academic_grade || "General Enrollment",
    message: row.message || "",
    notes: row.notes || "",
    utmParameters: row.utm_parameters || null,
    status: (row.status || "PENDING") as LeadStatusType,
    isConverted: Boolean(row.is_converted),
    convertedAt: row.converted_at || undefined,
    lastInteractionAt: row.last_interaction_at || undefined,
    createdAt: row.created_at || new Date().toISOString(),
    updatedAt: row.updated_at || new Date().toISOString(),
    interactions
  };
}

function mapInteractionRow(row: any): LeadInteractionRecord {
  return {
    id: row.id,
    leadId: row.lead_id,
    counselorId: row.counselor_id || undefined,
    interactionType: row.interaction_type as InteractionTypeEnum,
    outcome: row.outcome as InteractionOutcomeEnum,
    notes: row.notes || "",
    scheduledFollowUpAt: row.scheduled_follow_up_at || undefined,
    createdAt: row.created_at
  };
}

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
   * 1. Lead Ingestion & Deduplication Logic in Supabase
   * Checks existing records by email and phone. Appends note if duplicate, creates new record if fresh.
   */
  public static async ingestAndDeduplicateLead(payload: IngestLeadPayload): Promise<{ lead: LeadRecord; isDuplicate: boolean; message: string }> {
    const cleanEmail = (payload.email || "").toLowerCase().trim();
    const cleanPhone = (payload.phone || "").replace(/\D/g, "");
    const source = this.normalizeSource(payload.source);
    const fullName = payload.fullName || "Prospective Student";
    const targetGrade = payload.targetGrade || "General Enrollment";
    const nowIso = new Date().toISOString();

    // Check existing leads for deduplication by email or phone
    let existingQuery = supabaseAdmin.from("leads").select("*");
    if (cleanEmail && cleanPhone) {
      existingQuery = existingQuery.or(`email.ilike.${cleanEmail},phone.ilike.%${cleanPhone}%`);
    } else if (cleanEmail) {
      existingQuery = existingQuery.ilike("email", cleanEmail);
    } else if (cleanPhone) {
      existingQuery = existingQuery.ilike("phone", `%${cleanPhone}%`);
    }

    const { data: existingRows } = await existingQuery.limit(1);
    const existing = existingRows?.[0];

    if (existing) {
      const newNote = `\n[Ingestion (${source}) - ${new Date().toLocaleDateString()}]: ${payload.notes || "New inquiry received."}`;
      const updatedNotes = existing.notes ? `${existing.notes}${newNote}` : newNote;

      const { data: updatedRows, error: updateErr } = await supabaseAdmin
        .from("leads")
        .update({
          notes: updatedNotes,
          updated_at: nowIso
        })
        .eq("id", existing.id)
        .select()
        .single();

      if (updateErr) throw new Error(`Failed to update duplicate lead: ${updateErr.message}`);

      return {
        lead: mapLeadRow(updatedRows),
        isDuplicate: true,
        message: `Existing lead identified for '${existing.full_name || existing.student_name}'. Appended inquiry note and updated timestamp.`
      };
    }

    // Create New Lead Record in Supabase
    const utmStr = typeof payload.utmParameters === "object" ? JSON.stringify(payload.utmParameters) : payload.utmParameters || null;
    const newId = `lead-${Date.now()}-${Math.floor(Math.random() * 1000)}`;

    const { data: inserted, error: insertErr } = await supabaseAdmin
      .from("leads")
      .insert({
        id: newId,
        source,
        full_name: fullName,
        student_name: fullName,
        parent_name: payload.parentName || "",
        contact_number: payload.phone,
        phone: payload.phone,
        email: cleanEmail,
        academic_grade: targetGrade,
        target_grade: targetGrade,
        message: payload.notes || "New lead inquiry.",
        notes: payload.notes || "",
        utm_parameters: utmStr,
        status: "PENDING",
        is_converted: false,
        created_at: nowIso,
        updated_at: nowIso
      })
      .select()
      .single();

    if (insertErr) throw new Error(`Failed to create lead in Supabase: ${insertErr.message}`);

    // Non-blocking welcome dispatch
    const adminEmail = process.env.ADMIN_EMAIL || process.env.GMAIL_SENDER_EMAIL || "tglbiz101@gmail.com";
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
      lead: mapLeadRow(inserted),
      isDuplicate: false,
      message: `New lead created successfully for '${fullName}' via ${source}.`
    };
  }

  /**
   * 2. Log Counselor Follow-Up Interaction in Supabase
   */
  public static async logInteraction(input: LeadInteractionInput): Promise<{ interaction: LeadInteractionRecord; lead: LeadRecord }> {
    const { data: leadRow, error: findErr } = await supabaseAdmin
      .from("leads")
      .select("*")
      .eq("id", input.leadId)
      .maybeSingle();

    if (findErr || !leadRow) {
      throw new Error(`Lead with ID '${input.leadId}' not found.`);
    }

    const nowIso = new Date().toISOString();
    const interactionId = `intr-${Date.now()}-${Math.floor(Math.random() * 1000)}`;

    const { data: interactionRow, error: intrErr } = await supabaseAdmin
      .from("lead_interactions")
      .insert({
        id: interactionId,
        lead_id: input.leadId,
        counselor_id: input.counselorId || "counselor-admin",
        interaction_type: input.interactionType,
        outcome: input.outcome,
        notes: input.notes,
        scheduled_follow_up_at: input.scheduledFollowUpAt || null,
        created_at: nowIso
      })
      .select()
      .single();

    if (intrErr) throw new Error(`Failed to record interaction: ${intrErr.message}`);

    // Update lead status based on outcome
    let nextStatus = leadRow.status;
    if (input.outcome === "NOT_INTERESTED") {
      nextStatus = "INACTIVE_ARCHIVED";
    } else if (leadRow.status === "PENDING") {
      nextStatus = "CONTACTED";
    }

    const { data: updatedLead, error: leadUpdateErr } = await supabaseAdmin
      .from("leads")
      .update({
        status: nextStatus,
        last_interaction_at: nowIso,
        updated_at: nowIso
      })
      .eq("id", input.leadId)
      .select()
      .single();

    if (leadUpdateErr) throw new Error(`Failed to update lead interaction timestamp: ${leadUpdateErr.message}`);

    return {
      interaction: mapInteractionRow(interactionRow),
      lead: mapLeadRow(updatedLead)
    };
  }

  /**
   * 3. Get Due & Overdue Follow-Ups from Supabase
   */
  public static async getDueFollowUps(): Promise<{ count: number; data: any[] }> {
    const nowIso = new Date().toISOString();

    const { data: interactions, error } = await supabaseAdmin
      .from("lead_interactions")
      .select(`
        *,
        leads!inner (
          id,
          student_name,
          full_name,
          email,
          phone,
          target_grade,
          status,
          is_converted
        )
      `)
      .lte("scheduled_follow_up_at", nowIso)
      .neq("leads.status", "INACTIVE_ARCHIVED")
      .eq("leads.is_converted", false)
      .order("scheduled_follow_up_at", { ascending: true });

    if (error) {
      console.warn("Could not query due follow-ups:", error.message);
      return { count: 0, data: [] };
    }

    const now = new Date();
    const formatted = (interactions || []).map((intr: any) => {
      const parentLead = intr.leads;
      return {
        interactionId: intr.id,
        leadId: intr.lead_id,
        studentName: parentLead?.student_name || parentLead?.full_name,
        email: parentLead?.email,
        phone: parentLead?.phone,
        targetGrade: parentLead?.target_grade,
        interactionType: intr.interaction_type,
        outcome: intr.outcome,
        notes: intr.notes,
        scheduledFollowUpAt: intr.scheduled_follow_up_at,
        isOverdue: intr.scheduled_follow_up_at ? new Date(intr.scheduled_follow_up_at) < now : false
      };
    });

    return {
      count: formatted.length,
      data: formatted
    };
  }

  /**
   * 4. 1-Click Conversion Pipeline
   * Transitions Lead data into an Enrollment record (FORM_SUBMITTED) in Supabase
   */
  public static async convertLeadToEnrollment(leadId: string): Promise<{ enrollment: any; lead: LeadRecord }> {
    const { data: lead, error: leadErr } = await supabaseAdmin
      .from("leads")
      .select("*")
      .eq("id", leadId)
      .maybeSingle();

    if (leadErr || !lead) {
      throw new Error(`Lead with ID '${leadId}' not found.`);
    }

    if (lead.is_converted) {
      throw new Error(`Lead '${lead.full_name || lead.student_name}' has already been converted to an enrollment.`);
    }

    const nowIso = new Date().toISOString();
    const enrollmentId = `enr-${Date.now()}`;

    // Create Enrollment Record in Supabase
    const { data: enrollment, error: enrErr } = await supabaseAdmin
      .from("enrollments")
      .insert({
        id: enrollmentId,
        lead_id: lead.id,
        student_name: lead.full_name || lead.student_name,
        email: lead.email,
        primary_mobile: lead.phone || lead.contact_number,
        academic_grade: lead.target_grade || lead.academic_grade || "General Enrollment",
        status: "FORM_SUBMITTED",
        submitted_at: nowIso,
        financial_waiver: true,
        transport_waiver: true,
        media_waiver: true
      })
      .select()
      .single();

    if (enrErr) throw new Error(`Failed to create enrollment record: ${enrErr.message}`);

    // Update Lead State in Supabase
    const { data: updatedLead, error: upErr } = await supabaseAdmin
      .from("leads")
      .update({
        is_converted: true,
        converted_at: nowIso,
        status: "CONVERTED",
        updated_at: nowIso
      })
      .eq("id", leadId)
      .select()
      .single();

    if (upErr) throw new Error(`Failed to update lead converted state: ${upErr.message}`);

    return { enrollment, lead: mapLeadRow(updatedLead) };
  }

  /**
   * 5. Lead Sanitization & Auto-Archiving Routine in Supabase
   * Marks leads with no interaction for > 30 days or marked NOT_INTERESTED as INACTIVE_ARCHIVED
   */
  public static async archiveStaleLeads(staleDaysThreshold = 30): Promise<{ archivedCount: number; archivedLeads: LeadRecord[] }> {
    const thresholdDate = new Date(Date.now() - staleDaysThreshold * 24 * 3600 * 1000).toISOString();
    const nowIso = new Date().toISOString();

    const { data: staleRows, error: findErr } = await supabaseAdmin
      .from("leads")
      .select("*")
      .neq("status", "INACTIVE_ARCHIVED")
      .eq("is_converted", false)
      .or(`last_interaction_at.lt.${thresholdDate},and(last_interaction_at.is.null,created_at.lt.${thresholdDate})`);

    if (findErr) throw new Error(`Failed to find stale leads: ${findErr.message}`);

    if (!staleRows || staleRows.length === 0) {
      return { archivedCount: 0, archivedLeads: [] };
    }

    const ids = staleRows.map(r => r.id);
    const { data: updatedRows, error: updateErr } = await supabaseAdmin
      .from("leads")
      .update({ status: "INACTIVE_ARCHIVED", updated_at: nowIso })
      .in("id", ids)
      .select();

    if (updateErr) throw new Error(`Failed to archive stale leads: ${updateErr.message}`);

    return {
      archivedCount: (updatedRows || []).length,
      archivedLeads: (updatedRows || []).map(r => mapLeadRow(r))
    };
  }

  /**
   * 6. List leads with optional filtering and attached interactions
   */
  public static async listLeads(filters?: { status?: string; source?: string }): Promise<LeadRecord[]> {
    let query = supabaseAdmin.from("leads").select("*").order("created_at", { ascending: false });

    if (filters?.status) {
      query = query.eq("status", filters.status.toUpperCase());
    }
    if (filters?.source) {
      query = query.eq("source", filters.source.toUpperCase());
    }

    const { data: leads, error } = await query;
    if (error) {
      console.warn("Could not list leads:", error.message);
      return [];
    }

    return (leads || []).map(l => mapLeadRow(l));
  }
}
