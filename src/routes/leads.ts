import express from "express";
import { LeadService, leadsStore as inMemoryLeads } from "../services/leadService.js";

export { inMemoryLeads };

const router = express.Router();

// 1. INGESTION ENDPOINTS (POST /api/leads/webhook & POST /api/leads/public)
const handleLeadIngestion = async (req: express.Request, res: express.Response) => {
  try {
    const rawBody = req.body || {};
    
    const payload = {
      fullName: rawBody.fullName || rawBody.student_name || rawBody.name || "Prospective Student",
      email: rawBody.email || rawBody.studentEmail || "",
      phone: rawBody.phone || rawBody.contact_number || rawBody.student_number || "",
      targetGrade: rawBody.targetGrade || rawBody.academic_grade || rawBody.courseInterested || "General Enrollment",
      source: rawBody.source || "WEBSITE",
      utmParameters: rawBody.utmParameters || rawBody.campaign_id || null,
      notes: rawBody.notes || rawBody.message || "",
      parentName: rawBody.parentName || rawBody.father_name || ""
    };

    if (!payload.email && !payload.phone) {
      return res.status(400).json({
        success: false,
        message: "Missing contact credentials. At least one of 'email' or 'phone' is required."
      });
    }

    const result = await LeadService.ingestAndDeduplicateLead(payload);

    res.status(result.isDuplicate ? 200 : 201).json({
      success: true,
      message: result.message,
      isDuplicate: result.isDuplicate,
      data: result.lead
    });
  } catch (err: any) {
    res.status(500).json({
      success: false,
      message: "Failed to process lead ingestion.",
      error: err.message
    });
  }
};

router.post("/webhook", handleLeadIngestion);
router.post("/public", handleLeadIngestion);

// 2. GET LEADS (Filtered by status or source)
router.get("/", (req, res) => {
  const { status, source } = req.query;
  let filtered = inMemoryLeads;

  if (status) {
    filtered = filtered.filter((l: any) => l.status === String(status).toUpperCase());
  }

  if (source) {
    filtered = filtered.filter((l: any) => l.source === String(source).toUpperCase());
  }

  res.json({
    success: true,
    count: filtered.length,
    data: filtered
  });
});

// 3. LOG COUNSELOR INTERACTION (POST /api/leads/:id/interactions)
router.post("/:id/interactions", (req, res) => {
  try {
    const { id } = req.params;
    const { counselorId, interactionType, outcome, notes, scheduledFollowUpAt } = req.body;

    if (!interactionType || !outcome || !notes) {
      return res.status(400).json({
        success: false,
        message: "Missing mandatory fields (interactionType, outcome, notes)."
      });
    }

    const result = LeadService.logInteraction({
      leadId: id,
      counselorId,
      interactionType,
      outcome,
      notes,
      scheduledFollowUpAt
    });

    res.status(201).json({
      success: true,
      message: `Interaction '${interactionType}' logged successfully.`,
      data: result
    });
  } catch (err: any) {
    res.status(400).json({
      success: false,
      message: err.message
    });
  }
});

// 4. GET DUE & OVERDUE FOLLOW-UPS (GET /api/leads/follow-ups/due)
router.get("/follow-ups/due", (_req, res) => {
  const dueData = LeadService.getDueFollowUps();
  res.json({
    success: true,
    ...dueData
  });
});

// 5. 1-CLICK CONVERSION TO ENROLLMENT (POST /api/leads/:id/convert)
router.post("/:id/convert", (req, res) => {
  try {
    const { id } = req.params;
    const result = LeadService.convertLeadToEnrollment(id);

    res.json({
      success: true,
      message: `Lead '${result.lead.fullName}' successfully converted to Enrollment record (FORM_SUBMITTED).`,
      data: result
    });
  } catch (err: any) {
    res.status(400).json({
      success: false,
      message: err.message
    });
  }
});

// 6. STALE LEAD AUTO-ARCHIVING ROUTINE (POST /api/leads/archive-stale)
router.post("/archive-stale", (req, res) => {
  try {
    const staleDays = req.body?.staleDaysThreshold ? Number(req.body.staleDaysThreshold) : 30;
    const result = LeadService.archiveStaleLeads(staleDays);

    res.json({
      success: true,
      message: `Auto-archival routine complete. ${result.archivedCount} leads marked as INACTIVE_ARCHIVED.`,
      archivedCount: result.archivedCount,
      data: result.archivedLeads
    });
  } catch (err: any) {
    res.status(500).json({
      success: false,
      message: err.message
    });
  }
});

// GET LEAD SOURCES SUMMARY
router.get("/sources", (_req, res) => {
  res.status(200).json({
    success: true,
    sources: ["WEBSITE", "META", "GOOGLE_ADS", "MANUAL"]
  });
});

export default router;
