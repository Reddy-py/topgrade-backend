import { Router, type Request, type Response } from "express";
import { supabaseAdmin } from "../supabase.js";
import type { AuthenticatedRequest } from "../middleware/auth.js";

const router = Router();

/**
 * POST /api/tokens/grant
 * Admin manually grants course hours (tokens) to a student.
 */
router.post("/grant", async (req: Request, res: Response) => {
  const authReq = req as AuthenticatedRequest;
  const adminEmail = authReq.user?.email || "Admin";

  try {
    const { student_id, course_id, hours, package_id, validity_days, note } = req.body || {};

    if (!student_id || !course_id) {
      return res.status(400).json({ success: false, message: "Student ID and Course ID are required." });
    }

    const numHours = Number(hours);
    if (isNaN(numHours) || numHours <= 0) {
      return res.status(400).json({ success: false, message: "Hours must be a positive number." });
    }

    // Verify student exists and is active
    const { data: student, error: stuErr } = await supabaseAdmin
      .from("students")
      .select("id, name, status")
      .eq("id", student_id)
      .maybeSingle();

    if (stuErr || !student) {
      return res.status(404).json({ success: false, message: "Student not found." });
    }

    // Verify course exists
    const { data: course, error: crsErr } = await supabaseAdmin
      .from("courses")
      .select("id, name, status")
      .eq("id", course_id)
      .maybeSingle();

    if (crsErr || !course) {
      return res.status(404).json({ success: false, message: "Course not found." });
    }

    // Calculate expiry date if validity_days provided
    let expiresAt: string | null = null;
    if (validity_days) {
      const days = parseInt(validity_days, 10);
      if (!isNaN(days) && days > 0) {
        const d = new Date();
        d.setDate(d.getDate() + days);
        expiresAt = d.toISOString();
      }
    }

    // Insert append-only grant row into token_ledger
    const { data: ledgerRow, error: ledgerErr } = await supabaseAdmin
      .from("token_ledger")
      .insert({
        student_id,
        course_id,
        hours: numHours,
        type: "grant",
        ref_package_id: package_id || null,
        expires_at: expiresAt,
        note: note ? String(note).trim() : `Manual grant by ${adminEmail}`,
        created_by: adminEmail
      })
      .select()
      .single();

    if (ledgerErr) {
      return res.status(500).json({ success: false, message: `Failed to insert token grant: ${ledgerErr.message}` });
    }

    // Fetch updated balance via RPC
    const { data: updatedBalance } = await supabaseAdmin.rpc("get_available_tokens", {
      p_student_id: student_id,
      p_course_id: course_id
    });

    return res.status(201).json({
      success: true,
      message: `Successfully granted ${numHours} hour(s) for '${course.name}' to ${student.name}.`,
      transaction: ledgerRow,
      available_tokens: updatedBalance ?? numHours
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
  const { studentId } = req.params;

  try {
    // 1. Fetch balance summary from view or RPC
    const { data: balanceRows, error: balErr } = await supabaseAdmin
      .from("student_course_balance")
      .select(`
        course_id,
        available_tokens,
        courses (
          id,
          name,
          course_code,
          status
        )
      `)
      .eq("student_id", studentId);

    if (balErr) {
      return res.status(500).json({ success: false, message: balErr.message });
    }

    // 2. Fetch nearest unexpired grant expiry date per course
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

    const balances = (balanceRows || []).map((row: any) => ({
      course_id: row.course_id,
      course_name: row.courses?.name || "Unknown Course",
      course_code: row.courses?.course_code || "",
      available_tokens: parseFloat(row.available_tokens || 0),
      nearest_expiry: nearestExpiryByCourse.get(row.course_id) || null
    }));

    return res.json({ success: true, balances });
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
        type,
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
      hours: parseFloat(row.hours)
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

    const { data: ledgerRow, error: ledgerErr } = await supabaseAdmin
      .from("token_ledger")
      .insert({
        student_id,
        course_id,
        hours: numHours,
        type: "adjustment",
        note: note ? String(note).trim() : `Manual balance adjustment by ${adminEmail}`,
        created_by: adminEmail
      })
      .select()
      .single();

    if (ledgerErr) {
      return res.status(500).json({ success: false, message: ledgerErr.message });
    }

    const { data: updatedBalance } = await supabaseAdmin.rpc("get_available_tokens", {
      p_student_id: student_id,
      p_course_id: course_id
    });

    return res.json({
      success: true,
      message: `Adjusted balance by ${numHours > 0 ? "+" : ""}${numHours} hours.`,
      transaction: ledgerRow,
      available_tokens: updatedBalance ?? 0
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

