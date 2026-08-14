import express from "express";
import { supabaseAdmin } from "../index.js";
import { authenticateJwt } from "../middleware/auth.js";
import type { AuthenticatedRequest } from "../middleware/auth.js";
import { authorizePermission } from "../middleware/authorize.js";

const router = express.Router();

// GET: Fetch fee records with RBAC & ownership filtering
router.get("/list", authenticateJwt, authorizePermission("fees.view"), async (req: AuthenticatedRequest, res) => {
  try {
    const user = req.user!;
    let query = supabaseAdmin.from("fees").select("*");

    if (user.role === "STUDENT") {
      // Find student record linked to this user_id
      const { data: studentRecord } = await supabaseAdmin
        .from("students")
        .select("id")
        .eq("user_id", user.id)
        .single();

      if (!studentRecord) {
        res.status(200).json({ success: true, data: [] });
        return;
      }
      query = query.eq("student_id", studentRecord.id);
    } else if (user.role === "PARENT") {
      const { data: links } = await supabaseAdmin
        .from("parent_students")
        .select("student_id")
        .eq("parent_id", user.id);

      const studentIds = links?.map((l) => l.student_id) || [];
      if (studentIds.length === 0) {
        res.status(200).json({ success: true, data: [] });
        return;
      }
      query = query.in("student_id", studentIds);
    }

    const { data, error } = await query.order("created_at", { ascending: false });

    if (error) {
      // If table doesn't exist yet or query fails, return clean structure
      console.warn("Fees query warning:", error.message);
      res.status(200).json({ success: true, data: [] });
      return;
    }

    res.status(200).json({ success: true, data });
  } catch (error: any) {
    console.error("Fetch Fees Error:", error);
    res.status(500).json({ success: false, message: error.message });
  }
});

// POST: Add a new fee invoice or record payment
router.post("/pay", authenticateJwt, authorizePermission("fees.pay"), async (req: AuthenticatedRequest, res) => {
  const p = req.body;

  try {
    const receiptNumber = `REC-2026-${Math.floor(100000 + Math.random() * 900000)}`;

    const { data, error } = await supabaseAdmin
      .from("payments")
      .insert([
        {
          receipt_number: receiptNumber,
          student_id: p.studentId,
          student_name: p.studentName,
          amount_paid: parseFloat(p.amountPaid) || 0,
          payment_method: p.paymentMethod || "Online Transfer",
          fee_type: p.feeType || "Tuition Fee",
          transaction_ref: p.transactionRef || `TXN-${Date.now()}`,
          payment_date: new Date().toISOString(),
          status: "Completed",
          recorded_by: req.user!.id,
        },
      ])
      .select()
      .single();

    if (error) throw error;

    res.status(201).json({ success: true, message: "Payment processed successfully", data });
  } catch (error: any) {
    console.error("Payment Processing Error:", error);
    res.status(500).json({ success: false, message: error.message });
  }
});

export default router;
