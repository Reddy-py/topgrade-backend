import { Router, type Request, type Response } from "express";
import { supabaseAdmin } from "../supabase.js";
import type { AuthenticatedRequest } from "../middleware/auth.js";
import {
  applyTokens,
  createOrder,
  findCourse,
  findStudent,
  fulfillOrder,
  getBalances,
} from "../services/tokenService.js";
import { getAccessScope, allowsStudent } from "../services/accessScope.js";
import { dispatchMultiChannelNotification } from "../services/notificationService.js";
import { isRealEmail } from "../constants/domains.js";

const router = Router();

/**
 * POST /api/tokens/purchase
 * Built-in self-serve token checkout ($1/token default per course rate).
 * Student (for self) or Parent (for child) buys custom tokens (2, 3, 5, 10, etc.) for a specific course.
 */
router.post("/purchase", async (req: Request, res: Response) => {
  const authReq = req as AuthenticatedRequest;
  const user = authReq.user;
  if (!user) {
    return res.status(401).json({ success: false, message: "Unauthorized: sign in to buy tokens." });
  }

  try {
    const rawQty = req.body?.quantity ?? req.body?.tokens ?? req.body?.hours;
    const quantity = Math.floor(Number(rawQty));
    const courseId = String(req.body?.course_id || "").trim();
    const note = req.body?.note ? String(req.body.note).trim().slice(0, 300) : "Instant Course Token Checkout";

    if (!courseId) {
      return res.status(400).json({ success: false, message: "Course selection is required." });
    }
    if (!Number.isFinite(quantity) || quantity < 1 || quantity > 500) {
      return res.status(400).json({ success: false, message: "Please enter a valid token quantity between 1 and 500." });
    }

    let targetStudentId = String(req.body?.student_id || "").trim();
    if (!targetStudentId && user.role === "STUDENT") {
      const scope = await getAccessScope(user);
      const uuidRe = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
      const myUuid = Array.from(scope.studentKeys).find(k => uuidRe.test(k));
      if (myUuid) targetStudentId = myUuid;
    }

    if (!targetStudentId) {
      return res.status(400).json({ success: false, message: "Student ID is required." });
    }

    if (user.role !== "ADMIN") {
      const scope = await getAccessScope(user);
      if (!allowsStudent(scope, targetStudentId)) {
        return res.status(403).json({ success: false, message: "Forbidden: You can only buy tokens for yourself or your child." });
      }
    }

    const { order, student, course } = await createOrder({
      studentIdOrCode: targetStudentId,
      courseIdOrName: courseId,
      quantity,
      plan: "HOURS",
      provider: "OTHER",
      providerRef: "INSTANT_TOKEN_PORTAL",
      status: "PENDING_PAYMENT",
      payerEmail: user.email || studentFallbackEmail(user.role),
      note,
      by: user.id || user.email || "portal",
    });

    const fulfillment = await fulfillOrder(order, user.id || user.email || "portal");

    return res.status(201).json({
      success: true,
      message: `Purchased ${order.quantity} token(s) ($${Number(order.amount_total).toFixed(2)}) for '${course.name}'. New balance: ${fulfillment.balance} token(s).`,
      order: {
        ...order,
        status: "PAID",
        student_name: student.name,
        student_code: student.code,
      },
      balance: fulfillment.balance,
      credited: fulfillment.credited,
    });
  } catch (err: any) {
    return res.status(400).json({ success: false, message: err?.message || "Failed to purchase course tokens." });
  }
});

function studentFallbackEmail(role: string): string {
  return role === "ADMIN" ? (process.env.ADMIN_EMAIL || "tglbiz101@gmail.com") : "";
}

/**
 * POST /api/tokens/grant
 * Admin manually grants course hours (tokens) to a student.
 */
router.post("/grant", async (req: Request, res: Response) => {
  const authReq = req as AuthenticatedRequest;
  const adminEmail = authReq.user?.email || "Admin";

  try {
    const { student_id, course_id, hours, quantity, package_id, validity_days, note } = req.body || {};
    const numHours = Number(hours ?? quantity);

    if (!student_id || !course_id) {
      return res.status(400).json({ success: false, message: "Student ID and Course ID are required." });
    }

    if (isNaN(numHours) || numHours <= 0) {
      return res.status(400).json({ success: false, message: "Tokens/hours must be a positive number." });
    }

    const student = await findStudent(String(student_id));
    if (!student) {
      return res.status(404).json({ success: false, message: "Student not found." });
    }

    const course = await findCourse(String(course_id));
    if (!course) {
      return res.status(404).json({ success: false, message: "Course not found." });
    }

    let expiresAt: string | null = null;
    if (validity_days) {
      const days = parseInt(String(validity_days), 10);
      if (!isNaN(days) && days > 0) {
        const d = new Date();
        d.setDate(d.getDate() + days);
        expiresAt = d.toISOString();
      }
    }

    const grantNote = note ? String(note).trim() : `Manual token credit by ${adminEmail}`;
    const grantRef = `MANUAL-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;

    const applied = await applyTokens({
      studentId: student.id,
      courseId: course.id,
      delta: Math.round(numHours),
      reason: "MANUAL_CREDIT",
      ref: grantRef,
      note: grantNote,
      by: adminEmail,
    });

    // Preserve ref_package_id / expires_at on ledger if supplied
    if (package_id || expiresAt) {
      try {
        await supabaseAdmin
          .from("token_ledger")
          .update({
            ...(package_id ? { ref_package_id: package_id } : {}),
            ...(expiresAt ? { expires_at: expiresAt } : {}),
          })
          .eq("ref", grantRef);
      } catch {}
    }

    // Notify student & all parents via email (non-blocking)
    const adminNotify = process.env.ADMIN_EMAIL || process.env.GMAIL_SENDER_EMAIL || "tglbiz101@gmail.com";
    const recipients: Array<{ role: "STUDENT" | "PARENT" | "ADMIN"; email: string; name: string }> = [
      { role: "ADMIN", email: adminNotify, name: "System Administrator" },
    ];
    if (isRealEmail(student.email)) {
      recipients.push({ role: "STUDENT", email: student.email, name: student.name });
    }
    for (const pEmail of student.parentEmails || []) {
      if (isRealEmail(pEmail)) {
        recipients.push({ role: "PARENT", email: pEmail, name: `Parent of ${student.name}` });
      }
    }
    void dispatchMultiChannelNotification({
      eventType: "PAYMENT_COMPLETED",
      subject: `🎟️ Course Tokens Credited — +${numHours} Token(s) for ${course.name}`,
      message: `Hello ${student.name},\n\nAn administrator has manually credited +${numHours} course token(s) to your wallet for '${course.name}'.\n\nUpdated Course Balance: ${applied.balance} token(s)\nNote: ${grantNote}\n\nYou can now register for matching class schedules on the TopGrade Schedule page.\n\nBest Regards,\nTopGrade Administration`,
      recipients,
    }).catch(e => console.warn("Manual token grant email notice:", e?.message));

    return res.status(201).json({
      success: true,
      message: `Successfully credited ${numHours} token(s) for '${course.name}' to ${student.name}.`,
      available_tokens: applied.balance,
      balance: applied.balance,
    });
  } catch (err: any) {
    return res.status(500).json({ success: false, message: err?.message || "Failed to grant tokens." });
  }
});

/**
 * GET /api/tokens/student/:studentId/balance
 * Returns course-by-course available tokens and nearest expiry for a student
 */
router.get("/student/:studentId/balance", async (req: Request, res: Response) => {
  const studentId = String(req.params.studentId || "");

  try {
    const [wallets, { data: coursesData }] = await Promise.all([
      getBalances(studentId),
      supabaseAdmin.from("courses").select("id, name, course_code, status, hourly_rate"),
    ]);

    const courseMeta = new Map<string, any>();
    for (const c of (coursesData || []) as any[]) {
      courseMeta.set(String(c.id), c);
    }

    const { data: expiryRows } = await supabaseAdmin
      .from("token_ledger")
      .select("course_id, expires_at")
      .eq("student_id", studentId)
      .eq("type", "grant")
      .not("expires_at", "is", null)
      .gt("expires_at", new Date().toISOString())
      .order("expires_at", { ascending: true });

    const nearestExpiryByCourse = new Map<string, string>();
    if (expiryRows) {
      for (const row of expiryRows) {
        if (!nearestExpiryByCourse.has(row.course_id)) {
          nearestExpiryByCourse.set(row.course_id, row.expires_at);
        }
      }
    }

    const balances = wallets.map((w) => {
      const meta = courseMeta.get(w.courseId);
      return {
        course_id: w.courseId,
        course_name: w.courseName || meta?.name || "Course",
        course_code: meta?.course_code || "",
        hourly_rate: w.pricePerToken || Number(meta?.hourly_rate || 1) || 1,
        available_tokens: w.balance,
        balance: w.balance,
        total_purchased: w.totalPurchased,
        total_used: w.totalUsed,
        nearest_expiry: nearestExpiryByCourse.get(w.courseId) || null,
      };
    });

    return res.json({ success: true, balances, data: balances });
  } catch (err: any) {
    return res.status(500).json({ success: false, message: err?.message || "Failed to fetch balances." });
  }
});

/**
 * GET /api/tokens/student/:studentId/ledger
 * Full append-only ledger transaction history for a student
 */
router.get("/student/:studentId/ledger", async (req: Request, res: Response) => {
  const { studentId } = req.params;
  const { course_id } = req.query;

  try {
    let query = supabaseAdmin
      .from("token_ledger")
      .select(`
        id,
        student_id,
        course_id,
        hours,
        delta,
        type,
        reason,
        ref,
        ref_booking_id,
        ref_package_id,
        expires_at,
        note,
        created_by,
        created_at,
        courses (
          id,
          name,
          course_code
        )
      `)
      .eq("student_id", studentId)
      .order("created_at", { ascending: false });

    if (course_id) {
      query = query.eq("course_id", course_id);
    }

    const { data, error } = await query;
    if (error) {
      return res.status(500).json({ success: false, message: error.message });
    }

    const ledger = (data || []).map((row: any) => ({
      ...row,
      course_name: row.courses?.name || "Unknown Course",
      hours: parseFloat(row.hours ?? row.delta ?? 0)
    }));

    return res.json({ success: true, ledger });
  } catch (err: any) {
    return res.status(500).json({ success: false, message: err?.message || "Failed to fetch ledger." });
  }
});

/**
 * POST /api/tokens/adjust
 * Admin balance adjustment (+ or -)
 */
router.post("/adjust", async (req: Request, res: Response) => {
  const authReq = req as AuthenticatedRequest;
  const adminEmail = authReq.user?.email || "Admin";

  try {
    const { student_id, course_id, hours, note } = req.body || {};
    if (!student_id || !course_id || hours === undefined) {
      return res.status(400).json({ success: false, message: "Student ID, Course ID, and adjustment hours required." });
    }

    const numHours = Number(hours);
    if (isNaN(numHours) || numHours === 0) {
      return res.status(400).json({ success: false, message: "Adjustment hours cannot be zero." });
    }

    const applied = await applyTokens({
      studentId: String(student_id),
      courseId: String(course_id),
      delta: Math.round(numHours),
      reason: "ADJUSTMENT",
      note: note ? String(note).trim() : `Manual balance adjustment by ${adminEmail}`,
      by: adminEmail,
    });

    return res.json({
      success: true,
      message: `Adjusted balance by ${numHours > 0 ? "+" : ""}${numHours} token(s).`,
      available_tokens: applied.balance,
      balance: applied.balance,
    });
  } catch (err: any) {
    return res.status(500).json({ success: false, message: err?.message || "Failed to adjust balance." });
  }
});

/**
 * GET /api/tokens/expiring
 * Tokens expiring within N days (default 14 days)
 */
router.get("/expiring", async (req: Request, res: Response) => {
  try {
    const days = parseInt(String(req.query.days || "14"), 10);
    const now = new Date();
    const thresholdDate = new Date();
    thresholdDate.setDate(thresholdDate.getDate() + days);

    const { data: expiringGrants, error } = await supabaseAdmin
      .from("token_ledger")
      .select(`
        id,
        student_id,
        course_id,
        hours,
        expires_at,
        created_at,
        students (
          id,
          name,
          student_id_code,
          email
        ),
        courses (
          id,
          name
        )
      `)
      .eq("type", "grant")
      .not("expires_at", "is", null)
      .gt("expires_at", now.toISOString())
      .lte("expires_at", thresholdDate.toISOString())
      .order("expires_at", { ascending: true });

    if (error) {
      return res.status(500).json({ success: false, message: error.message });
    }

    return res.json({
      success: true,
      days,
      count: expiringGrants?.length || 0,
      items: expiringGrants || []
    });
  } catch (err: any) {
    return res.status(500).json({ success: false, message: err?.message || "Failed to fetch expiring tokens." });
  }
});

export default router;

