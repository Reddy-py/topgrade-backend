import express, { type Request, type Response } from "express";
import { authenticateJwt } from "../middleware/auth.js";
import { routeGuard } from "../middleware/guard.js";
import {
  createPaymentRequestService,
  getPaymentRequestsService,
  recordPaymentClaimService,
  fulfillPaymentRequestService,
  unpayPaymentRequestService,
  calculateServerPrice,
  inMemoryPaymentRequests,
  type PaymentRequestKind,
} from "../services/paymentRequestService.js";
import {
  ingestBankCsvService,
  runBankTransactionMatchingService,
  registerPayerAliasService,
  getPayerAliasesService,
  inMemoryBankTransactions,
} from "../services/zelleMatchingService.js";
import {
  getLatestAutomationPreviews,
  enableAutomationWithBaseline,
  toggleGlobalEmailKillSwitch,
  type AutomationPreviewRow,
} from "../services/automationService.js";
import {
  captureLowHoursBaselineService,
  runLowHoursScanService,
} from "../services/lowHoursAutomationService.js";
import {
  runPaymentReminderScanService,
  getUnpaidAfterTwoRemindersList,
} from "../services/paymentReminderAutomationService.js";
import {
  getAdmissionsAndFinancialReportsService,
  runAdminMorningDigestService,
  bookTrialClassService,
  joinWaitlistService,
  runOnboardingChaserService,
  inMemoryTrialBookings,
  inMemoryWaitlistEntries,
} from "../services/admissionsAutomationService.js";
import { getCachedInstituteSettings } from "../services/instituteSettingsService.js";

const router = express.Router();

/**
 * GET /api/payment-requests
 * Scoped by user role:
 * - Admin: sees all
 * - Parent: sees only own children
 * - Student: sees only own
 * - Teacher: none
 */
router.get("/", authenticateJwt, async (req: Request, res: Response): Promise<any> => {
  try {
    const user = (req as any).user;
    const role = user?.role || "ADMIN";
    const userEmail = user?.email || "";

    if (role === "TEACHER") {
      return res.status(403).json({ success: false, message: "Teachers do not have access to payment records." });
    }

    const { status, kind, courseId, search, studentId } = req.query;

    const filters: any = {
      status: status as string,
      kind: kind as string,
      courseId: courseId as string,
      search: search as string,
      studentId: studentId as string,
      role,
    };

    if (role === "PARENT") {
      filters.parentEmail = userEmail;
    } else if (role === "STUDENT") {
      filters.studentId = user?.studentId || user?.id;
    }

    const list = await getPaymentRequestsService(filters);
    res.json({ success: true, count: list.length, data: list });
  } catch (err: any) {
    res.status(500).json({ success: false, message: err.message || "Failed to fetch payment requests." });
  }
});

/**
 * POST /api/payment-requests/calculate-price
 * Server calculates exact price for course + hours + kind, plus package savings comparison.
 */
router.post("/calculate-price", authenticateJwt, async (req: Request, res: Response): Promise<any> => {
  try {
    const { courseId, kind, hours } = req.body;
    if (!courseId) {
      return res.status(400).json({ success: false, message: "courseId is required." });
    }

    const pricing = await calculateServerPrice({
      courseId,
      kind: kind || "HOURS_TOPUP",
      hours: Number(hours || 2),
    });

    res.json({ success: true, data: pricing });
  } catch (err: any) {
    res.status(500).json({ success: false, message: err.message });
  }
});

/**
 * POST /api/payment-requests
 * Creates a payment request (Admin or Parent top-up).
 */
router.post("/", authenticateJwt, async (req: Request, res: Response): Promise<any> => {
  try {
    const user = (req as any).user;
    const role = user?.role || "ADMIN";

    const { studentId, courseId, kind, hours, customAmountDollars, customHours, dueDate, notes } = req.body;

    if (!studentId || !courseId) {
      return res.status(400).json({ success: false, message: "studentId and courseId are required." });
    }

    const createdBy = role === "PARENT" ? "PARENT" : role === "STUDENT" ? "STUDENT" : "ADMIN";

    const request = await createPaymentRequestService({
      studentIdOrCode: studentId,
      courseId,
      kind: kind || "HOURS_TOPUP",
      hours: hours !== undefined ? Number(hours) : undefined,
      customAmountDollars: customAmountDollars !== undefined ? Number(customAmountDollars) : undefined,
      customHours: customHours !== undefined ? Number(customHours) : undefined,
      dueDate,
      notes,
      createdBy,
      createdByUserId: user?.id,
    });

    res.status(201).json({ success: true, data: request });
  } catch (err: any) {
    res.status(500).json({ success: false, message: err.message || "Failed to create payment request." });
  }
});

/**
 * POST /api/payment-requests/:id/claim
 * Parent or student records "I have sent payment". Sets CLAIMED, halts reminders. NEVER MARKS PAID.
 */
router.post("/:id/claim", authenticateJwt, async (req: Request, res: Response): Promise<any> => {
  try {
    const user = (req as any).user;
    const id = req.params.id as string;
    const { claimNote } = req.body;

    const request = await recordPaymentClaimService({
      referenceCodeOrId: id,
      claimNote,
      claimedByEmail: user?.email,
    });

    res.json({ success: true, message: "Payment claim recorded. Status updated to CLAIMED.", data: request });
  } catch (err: any) {
    res.status(500).json({ success: false, message: err.message || "Failed to record payment claim." });
  }
});

/**
 * POST /api/payment-requests/:id/fulfill
 * Admin manual fulfillment. Marks PAID, credits hours through hours service, resumes paused enrollment, emails receipt.
 */
router.post("/:id/fulfill", authenticateJwt, routeGuard("fees.view"), async (req: Request, res: Response): Promise<any> => {
  try {
    const user = (req as any).user;
    const id = req.params.id as string;
    const { paymentMethod, adminNote } = req.body;

    const result = await fulfillPaymentRequestService({
      referenceCodeOrId: id,
      confirmedBy: user?.id || "ADMIN",
      confirmationSource: "ADMIN_MANUAL",
      paymentMethod,
      adminNote,
    });

    res.json({ success: true, message: "Payment fulfilled and lesson hours credited.", data: result.request });
  } catch (err: any) {
    res.status(500).json({ success: false, message: err.message || "Failed to fulfill payment request." });
  }
});

/**
 * POST /api/payment-requests/:id/unpay
 * Admin reversal. Requires mandatory reason, writes negative ledger row, restores status.
 */
router.post("/:id/unpay", authenticateJwt, routeGuard("fees.view"), async (req: Request, res: Response): Promise<any> => {
  try {
    const user = (req as any).user;
    const id = req.params.id as string;
    const { reason } = req.body;

    const result = await unpayPaymentRequestService({
      referenceCodeOrId: id,
      reason,
      adminUserId: user?.id,
    });

    res.json({ success: true, message: "Payment reversed and lesson hours deducted.", data: result.request });
  } catch (err: any) {
    res.status(500).json({ success: false, message: err.message || "Failed to reverse payment request." });
  }
});

/**
 * GET /api/payment-requests/bank-transactions
 * Lists bank transactions for Admin Payments page.
 */
router.get("/bank-transactions", authenticateJwt, routeGuard("fees.view"), async (_req: Request, res: Response): Promise<any> => {
  try {
    res.json({ success: true, count: inMemoryBankTransactions.length, data: inMemoryBankTransactions });
  } catch (err: any) {
    res.status(500).json({ success: false, message: err.message });
  }
});

/**
 * POST /api/payment-requests/ingest-csv
 * Ingests bank CSV file safely without formula injection, rejects duplicates, and runs matching.
 */
router.post("/ingest-csv", authenticateJwt, routeGuard("fees.view"), async (req: Request, res: Response): Promise<any> => {
  try {
    const { csvContent, columnMapping } = req.body;
    if (!csvContent) {
      return res.status(400).json({ success: false, message: "csvContent is required." });
    }

    const result = await ingestBankCsvService({ csvContent, columnMapping });
    res.json({ success: true, data: result });
  } catch (err: any) {
    res.status(500).json({ success: false, message: err.message });
  }
});

/**
 * POST /api/payment-requests/trigger-matching
 * Runs Zelle matching engine on unmatched transactions.
 */
router.post("/trigger-matching", authenticateJwt, routeGuard("fees.view"), async (_req: Request, res: Response): Promise<any> => {
  try {
    const result = await runBankTransactionMatchingService();
    res.json({ success: true, data: result });
  } catch (err: any) {
    res.status(500).json({ success: false, message: err.message });
  }
});

/**
 * GET /api/payment-requests/reports
 * KPI analytics for reports tab on Admin Payments page.
 */
router.get("/reports", authenticateJwt, routeGuard("fees.view"), async (_req: Request, res: Response): Promise<any> => {
  try {
    const reports = await getAdmissionsAndFinancialReportsService();
    res.json({ success: true, data: reports });
  } catch (err: any) {
    res.status(500).json({ success: false, message: err.message });
  }
});

/**
 * GET /api/payment-requests/automations/previews
 * Lists dry-run previews for automations.
 */
router.get("/automations/previews", authenticateJwt, routeGuard("fees.view"), async (req: Request, res: Response): Promise<any> => {
  try {
    const { key } = req.query;
    const previews = await getLatestAutomationPreviews(key as any);
    res.json({ success: true, data: previews });
  } catch (err: any) {
    res.status(500).json({ success: false, message: err.message });
  }
});

/**
 * POST /api/payment-requests/automations/enable
 * Enables an automation switch with verified recipient count confirmation and baseline capture.
 */
router.post("/automations/enable", authenticateJwt, routeGuard("fees.view"), async (req: Request, res: Response): Promise<any> => {
  try {
    const { key, confirmedCount } = req.body;
    if (!key || confirmedCount === undefined) {
      return res.status(400).json({ success: false, message: "key and confirmedCount are required." });
    }

    const result = await enableAutomationWithBaseline({
      key,
      confirmedCount: Number(confirmedCount),
      captureBaselineFn: async () => {
        if (key === "low_hours_emails") {
          return await captureLowHoursBaselineService();
        }
        return 0;
      },
    });

    res.json({ success: true, data: result });
  } catch (err: any) {
    res.status(400).json({ success: false, message: err.message });
  }
});

/**
 * POST /api/payment-requests/automations/kill-switch
 * Toggles the global kill switch 'Pause all automatic emails'.
 */
router.post("/automations/kill-switch", authenticateJwt, routeGuard("fees.view"), async (req: Request, res: Response): Promise<any> => {
  try {
    const { pause } = req.body;
    const active = await toggleGlobalEmailKillSwitch(Boolean(pause));
    res.json({ success: true, paused: active });
  } catch (err: any) {
    res.status(500).json({ success: false, message: err.message });
  }
});

/**
 * POST /api/payment-requests/trials/book
 * Public or parent booking for a free trial class.
 */
router.post("/trials/book", async (req: Request, res: Response): Promise<any> => {
  try {
    const { scheduleId, courseId, studentName, parentName, parentEmail, parentPhone, bookingDate, notes } = req.body;
    if (!scheduleId || !courseId || !studentName || !parentName || !parentEmail || !bookingDate) {
      return res.status(400).json({ success: false, message: "Missing required booking details." });
    }

    const booking = await bookTrialClassService({
      scheduleId,
      courseId,
      studentName,
      parentName,
      parentEmail,
      parentPhone,
      bookingDate,
      notes,
    });

    res.status(201).json({ success: true, data: booking });
  } catch (err: any) {
    res.status(500).json({ success: false, message: err.message });
  }
});

/**
 * POST /api/payment-requests/waitlist/join
 * Join waitlist when a slot is full.
 */
router.post("/waitlist/join", authenticateJwt, async (req: Request, res: Response): Promise<any> => {
  try {
    const { scheduleId, studentId } = req.body;
    if (!scheduleId || !studentId) {
      return res.status(400).json({ success: false, message: "scheduleId and studentId are required." });
    }

    const entry = await joinWaitlistService({ scheduleId, studentId });
    res.status(201).json({ success: true, data: entry });
  } catch (err: any) {
    res.status(500).json({ success: false, message: err.message });
  }
});

export default router;
