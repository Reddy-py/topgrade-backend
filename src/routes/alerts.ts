import express from "express";
import { AlertsService } from "../services/alertsService.js";

const router = express.Router();

// 1. GET ALL ALERT LOGS & HISTORY (GET /api/alerts/logs)
router.get("/logs", (req, res) => {
  try {
    const triggerType = req.query.triggerType ? String(req.query.triggerType) : undefined;
    const recipientId = req.query.recipientId ? String(req.query.recipientId) : undefined;

    const logs = AlertsService.getAlertLogs({ triggerType, recipientId });
    res.status(200).json({
      success: true,
      count: logs.length,
      data: logs
    });
  } catch (err: any) {
    res.status(500).json({ success: false, message: err.message });
  }
});

// 2. GET ACTIVE AUTOMATION WORKFLOWS (GET /api/alerts/workflows)
router.get("/workflows", (_req, res) => {
  try {
    const workflows = AlertsService.getWorkflows();
    res.status(200).json({
      success: true,
      count: workflows.length,
      data: workflows
    });
  } catch (err: any) {
    res.status(500).json({ success: false, message: err.message });
  }
});

// 3. TOGGLE AUTOMATION WORKFLOW STATUS (PATCH /api/alerts/workflows/:id/toggle)
router.patch("/workflows/:id/toggle", (req, res) => {
  try {
    const { id } = req.params;
    const { isActive } = req.body;
    const updated = AlertsService.toggleWorkflow(id, Boolean(isActive));

    if (!updated) {
      return res.status(404).json({ success: false, message: "Workflow not found." });
    }

    res.status(200).json({
      success: true,
      message: `Workflow '${updated.name}' is now ${updated.isActive ? 'Active' : 'Paused'}.`,
      data: updated
    });
  } catch (err: any) {
    res.status(500).json({ success: false, message: err.message });
  }
});

// 4. TRIGGER AUTOMATED ALERT WORKFLOW (POST /api/alerts/trigger)
router.post("/trigger", async (req, res) => {
  try {
    const { triggerType, studentId, targetCohort, customSubject, customMessage, metadata } = req.body;

    if (!triggerType) {
      return res.status(400).json({ success: false, message: "triggerType is required." });
    }

    const result = await AlertsService.executeAlertTrigger({
      triggerType,
      studentId,
      targetCohort,
      customSubject,
      customMessage,
      metadata
    });

    res.status(200).json(result);
  } catch (err: any) {
    res.status(500).json({ success: false, message: err.message });
  }
});

// 5. DISPATCH CUSTOM ANNOUNCEMENT BROADCAST (POST /api/alerts/broadcast)
router.post("/broadcast", async (req, res) => {
  try {
    const { subject, message, targetCohort, studentId } = req.body;

    if (!subject || !message) {
      return res.status(400).json({ success: false, message: "subject and message are required." });
    }

    const result = await AlertsService.executeAlertTrigger({
      triggerType: "CUSTOM_ANNOUNCEMENT",
      studentId,
      targetCohort: targetCohort || "ALL",
      customSubject: subject,
      customMessage: message
    });

    res.status(200).json(result);
  } catch (err: any) {
    res.status(500).json({ success: false, message: err.message });
  }
});

export default router;
