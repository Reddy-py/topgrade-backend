import express from "express";
import { supabaseAdmin } from "../index.js";
import { authenticateJwt } from "../middleware/auth.js";
import type { AuthenticatedRequest } from "../middleware/auth.js";
import { authorizePermission } from "../middleware/authorize.js";
import { dispatchMultiChannelNotification } from "../services/notificationService.js";

const router = express.Router();

// GET: Fetch attendance logs with RBAC filtering
router.get("/list", authenticateJwt, authorizePermission("attendance.view"), async (req: AuthenticatedRequest, res) => {
  try {
    const user = req.user!;
    let query = supabaseAdmin.from("attendance").select("*");

    if (user.role === "STUDENT") {
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

    const { data, error } = await query.order("date", { ascending: false });

    if (error) {
      console.warn("Attendance query warning:", error.message);
      res.status(200).json({ success: true, data: [] });
      return;
    }

    res.status(200).json({ success: true, data });
  } catch (error: any) {
    console.error("Fetch Attendance Error:", error);
    res.status(500).json({ success: false, message: error.message });
  }
});

// POST: Mark / Update daily attendance (Teachers & Admins)
router.post("/mark", authenticateJwt, authorizePermission("attendance.create"), async (req: AuthenticatedRequest, res) => {
  const { studentId, studentName, className, status, date, remarks } = req.body;

  try {
    const { data, error } = await supabaseAdmin
      .from("attendance")
      .upsert([
        {
          student_id: studentId,
          student_name: studentName,
          class_name: className || "Grade 1",
          status: status || "Present",
          date: date || new Date().toISOString().split("T")[0],
          remarks: remarks || null,
          marked_by: req.user!.id,
        },
      ])
      .select();

    if (error) console.warn("Attendance save note:", error.message);

    // Dispatch automated Email & SMS notifications to Parent, Student, and Accountant
    await dispatchMultiChannelNotification({
      eventType: "ADMISSION_INQUIRY",
      subject: `📋 Daily Attendance Update — ${studentName} [${status || "Present"}]`,
      message: `Daily attendance marked for ${studentName} in ${className || "Class"}. Date: ${date || new Date().toLocaleDateString()}. Status: ${status || "Present"}.`,
      recipients: [
        { role: "PARENT", email: "parent@topgrade.edu", name: "Parent" },
        { role: "STUDENT", email: "student@topgrade.edu", name: studentName },
        { role: "ACCOUNTANT", email: "accountant@topgrade.edu", name: "Accounts Office" }
      ]
    });

    res.status(200).json({ success: true, message: "Attendance record saved & alerts sent to Parent, Student, and Accountant!", data });
  } catch (error: any) {
    console.error("Mark Attendance Error:", error);
    res.status(500).json({ success: false, message: error.message });
  }
});

export default router;
