import express from "express";
import {
  listFeeDuesService,
  createFeeDueService,
  markFeeDuePaidService,
  unmarkFeeDuePaidService,
  recordParentZelleClaimService,
  runAutomaticFeeReminderScanService,
  reconcileBankCsvService,
  type PaymentMethod
} from "../services/feeDueService.js";
import { type AuthenticatedRequest } from "../middleware/auth.js";

const router = express.Router();

/**
 * GET /api/fee-dues
 * List dues with filters
 */
router.get("/", async (req: express.Request, res: express.Response): Promise<any> => {
  try {
    const {
      status,
      studentId,
      courseId,
      overdueOnly,
      dueInDays,
      search,
      notPaidAfter2Reminders,
      noReminderYet,
    } = req.query;

    const dues = await listFeeDuesService({
      status: (status as string) || undefined,
      studentId: (studentId as string) || undefined,
      courseId: (courseId as string) || undefined,
      overdueOnly: overdueOnly === "true",
      dueInDays: dueInDays ? parseInt(dueInDays as string, 10) : undefined,
      search: (search as string) || undefined,
      notPaidAfter2Reminders: notPaidAfter2Reminders === "true",
      noReminderYet: noReminderYet === "true",
    });

    return res.status(200).json({ success: true, count: dues.length, data: dues });
  } catch (err: any) {
    return res.status(500).json({ success: false, message: err.message });
  }
});

/**
 * POST /api/fee-dues
 * Create a new fee due
 */
router.post("/", async (req: AuthenticatedRequest, res: express.Response): Promise<any> => {
  try {
    const {
      studentId,
      courseId,
      courseName,
      amountDollars,
      dueDate,
      hoursIncluded,
      hourlyRateDollars,
      notes,
    } = req.body || {};

    if (!studentId || !amountDollars || !dueDate) {
      return res.status(400).json({
        success: false,
        message: "studentId, amountDollars, and dueDate are required.",
      });
    }

    const created = await createFeeDueService({
      studentId,
      courseId: courseId || "GENERAL",
      courseName: courseName || undefined,
      amountDollars: parseFloat(amountDollars),
      dueDate,
      hoursIncluded: hoursIncluded ? parseFloat(hoursIncluded) : 0,
      hourlyRateDollars: hourlyRateDollars ? parseFloat(hourlyRateDollars) : 0,
      notes: notes || undefined,
      createdBy: req.user?.id || undefined,
    });

    return res.status(201).json({ success: true, data: created });
  } catch (err: any) {
    return res.status(400).json({ success: false, message: err.message });
  }
});

/**
 * POST /api/fee-dues/:id/pay
 * Mark a due as paid with method -> Credits hours to lesson wallet!
 */
router.post("/:id/pay", async (req: AuthenticatedRequest, res: express.Response): Promise<any> => {
  try {
    const feeDueId = (req.params.id as string) || "";
    const { paymentMethod, bankReference, receiptNo, notes } = req.body || {};

    if (!paymentMethod) {
      return res.status(400).json({
        success: false,
        message: "Payment method (cash, cheque, bank_transfer_neft, zelle, or other) is required.",
      });
    }

    const updated = await markFeeDuePaidService({
      feeDueId,
      paymentMethod: paymentMethod as PaymentMethod,
      bankReference: bankReference || undefined,
      receiptNo: receiptNo || undefined,
      notes: notes || undefined,
      adminUserId: req.user?.id || undefined,
    });

    return res.status(200).json({
      success: true,
      message: `Fee marked as PAID. ${updated.hoursCredited} lesson hours credited to ${updated.studentName}!`,
      data: updated,
    });
  } catch (err: any) {
    return res.status(400).json({ success: false, message: err.message });
  }
});

/**
 * POST /api/fee-dues/:id/unpay
 * Reverse payment with mandatory reason -> Reverses hours from lesson wallet!
 */
router.post("/:id/unpay", async (req: AuthenticatedRequest, res: express.Response): Promise<any> => {
  try {
    const feeDueId = (req.params.id as string) || "";
    const { reason } = req.body || {};

    if (!reason || !reason.trim()) {
      return res.status(400).json({
        success: false,
        message: "A mandatory reason is required to reverse a fee payment.",
      });
    }

    const updated = await unmarkFeeDuePaidService({
      feeDueId,
      reason,
      adminUserId: req.user?.id || undefined,
    });

    return res.status(200).json({
      success: true,
      message: `Payment reversed. Lesson hours reversed from wallet.`,
      data: updated,
    });
  } catch (err: any) {
    return res.status(400).json({ success: false, message: err.message });
  }
});

/**
 * POST /api/fee-dues/:id/claim-zelle
 * Parent reports Zelle payment submitted
 */
router.post("/:id/claim-zelle", async (req: AuthenticatedRequest, res: express.Response): Promise<any> => {
  try {
    const feeDueId = (req.params.id as string) || "";
    const { studentId, parentEmail, amount, zelleMemo, notes } = req.body || {};

    const claim = await recordParentZelleClaimService({
      feeDueId,
      studentId: studentId || (req.user?.id || "parent"),
      parentEmail: parentEmail || (req.user?.email || "parent@topgrade.org"),
      amount: amount ? parseFloat(amount) : 0,
      zelleMemo: zelleMemo || undefined,
      notes: notes || undefined,
    });

    return res.status(200).json({
      success: true,
      message: "Zelle payment claim submitted. Awaiting administrative verification.",
      data: claim,
    });
  } catch (err: any) {
    return res.status(400).json({ success: false, message: err.message });
  }
});

/**
 * POST /api/fee-dues/trigger-reminders
 * Scan and send Day -14 and Day -7 fee reminders
 */
router.post("/trigger-reminders", async (req: express.Request, res: express.Response): Promise<any> => {
  try {
    const { forceRun, referenceDateStr } = req.body || {};
    const result = await runAutomaticFeeReminderScanService({ forceRun: !!forceRun, referenceDateStr });
    return res.status(200).json({ success: true, data: result });
  } catch (err: any) {
    return res.status(500).json({ success: false, message: err.message });
  }
});

/**
 * POST /api/fee-dues/reconcile-csv
 * Bank statement reconciliation
 */
router.post("/reconcile-csv", async (req: express.Request, res: express.Response): Promise<any> => {
  try {
    const { csvContent } = req.body || {};
    if (!csvContent) {
      return res.status(400).json({ success: false, message: "csvContent is required." });
    }
    const report = await reconcileBankCsvService(csvContent);
    return res.status(200).json({ success: true, data: report });
  } catch (err: any) {
    return res.status(400).json({ success: false, message: err.message });
  }
});

export default router;
