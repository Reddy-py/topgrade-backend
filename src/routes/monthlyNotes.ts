import { Router } from "express";
import type { Request, Response } from "express";
import type { AuthenticatedRequest } from "../middleware/auth.js";
import { supabaseAdmin } from "../supabase.js";
import { instituteToday } from "../services/instituteTime.js";

const router = Router();

// In-memory fallback map for monthly notes
const inMemoryNotes = new Map<string, { id?: string; student_id: string; course_id: string; month: string; note: string; teacher_id: string; created_at: string; updated_at: string }>();

export function getInMemoryMonthlyNote(studentId: string, month: string): string | undefined {
  for (const item of inMemoryNotes.values()) {
    if (item.student_id === studentId && item.month === month && item.note) {
      return item.note;
    }
  }
  return undefined;
}

/**
 * GET /api/monthly-notes
 * Fetches notes for a specific student or batch for a course/month roster.
 */
router.get("/", async (req: Request, res: Response): Promise<any> => {
  try {
    const studentId = req.query.studentId ? String(req.query.studentId).trim() : undefined;
    const courseId = req.query.courseId ? String(req.query.courseId).trim() : undefined;
    const month = req.query.month ? String(req.query.month).trim() : instituteToday().slice(0, 7); // 'YYYY-MM'

    let dbNotes: any[] = [];
    try {
      let q = supabaseAdmin.from("student_monthly_notes").select("*").eq("month", month);
      if (studentId) q = q.eq("student_id", studentId);
      if (courseId) q = q.eq("course_id", courseId);
      const { data, error } = await q;
      if (!error && data) dbNotes = data;
    } catch (err: any) {
      console.warn("Notice querying student_monthly_notes DB:", err?.message);
    }

    // Merge in-memory notes
    const seen = new Set(dbNotes.map(n => `${n.student_id}:${n.course_id}:${n.month}`));
    const merged = [...dbNotes];

    for (const mem of inMemoryNotes.values()) {
      const k = `${mem.student_id}:${mem.course_id}:${mem.month}`;
      if (seen.has(k)) continue;
      if (mem.month !== month) continue;
      if (studentId && mem.student_id !== studentId) continue;
      if (courseId && mem.course_id !== courseId) continue;
      seen.add(k);
      merged.push(mem);
    }

    return res.json({ success: true, notes: merged, month });
  } catch (err: any) {
    return res.status(500).json({ success: false, message: err?.message || "Failed to fetch monthly notes." });
  }
});

/**
 * POST /api/monthly-notes
 * Upserts a teacher's monthly note for a student in a course for a given month.
 */
router.post("/", async (req: Request, res: Response): Promise<any> => {
  try {
    const authReq = req as AuthenticatedRequest;
    const teacherId = authReq.user?.id || authReq.user?.email || "faculty";
    const { studentId, courseId, month, note } = req.body || {};

    if (!studentId) {
      return res.status(400).json({ success: false, message: "studentId is required." });
    }
    if (!courseId) {
      return res.status(400).json({ success: false, message: "courseId is required." });
    }

    const targetMonth = String(month || instituteToday().slice(0, 7)).trim();
    const cleanNote = String(note || "").trim();
    const noteKey = `${studentId}:${courseId}:${targetMonth}`;

    const noteRecord = {
      id: `note-${Date.now()}`,
      student_id: String(studentId),
      course_id: String(courseId),
      month: targetMonth,
      teacher_id: String(teacherId),
      note: cleanNote,
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString()
    };

    inMemoryNotes.set(noteKey, noteRecord);

    // Try DB upsert
    let savedRow = noteRecord;
    try {
      const { data: existing } = await supabaseAdmin
        .from("student_monthly_notes")
        .select("id")
        .eq("student_id", String(studentId))
        .eq("course_id", String(courseId))
        .eq("month", targetMonth)
        .maybeSingle();

      if (existing) {
        const { data } = await supabaseAdmin
          .from("student_monthly_notes")
          .update({
            note: cleanNote,
            teacher_id: String(teacherId),
            updated_at: new Date().toISOString()
          })
          .eq("id", existing.id)
          .select("*")
          .maybeSingle();
        if (data) savedRow = data;
      } else {
        const { data } = await supabaseAdmin
          .from("student_monthly_notes")
          .insert({
            student_id: String(studentId),
            course_id: String(courseId),
            month: targetMonth,
            teacher_id: String(teacherId),
            note: cleanNote
          })
          .select("*")
          .maybeSingle();
        if (data) savedRow = data;
      }
    } catch (dbErr: any) {
      console.warn("Notice persisting monthly note in DB:", dbErr?.message);
    }

    return res.json({
      success: true,
      note: savedRow,
      message: "Monthly note saved successfully."
    });
  } catch (err: any) {
    return res.status(500).json({ success: false, message: err?.message || "Failed to save monthly note." });
  }
});

export default router;
