import express from "express";
import { AttendanceService, markAttendance } from "../services/attendanceService.js";
import { listAttendance, statsFor, normalizeStatus } from "../services/attendanceRepo.js";
import { instituteNow } from "../services/instituteTime.js";
import { SessionAttendanceService, classSessionQrStore, type ClassSessionQRRecord } from "../services/sessionAttendanceService.js";
import { inMemoryStudentStore } from "../services/studentService.js";
import { supabaseAdmin } from "../supabase.js";
import { sendDailyAttendanceRollCallEmail, sendMonthlyAttendanceSummaryEmail } from "../services/notificationService.js";
import { findStudent, isUuid } from "../services/tokenService.js";
import { ScheduleDataService } from "../services/scheduleDataService.js";
import type { AuthenticatedRequest } from "../middleware/auth.js";
import { getAccessScope, allowsStudent, scopeSessions, slotBelongsToTeacher } from "../services/accessScope.js";

const router = express.Router();

// ==============================================================
// NODE 6: SCHEDULE-DRIVEN DAILY ATTENDANCE SYSTEM (NO QR CODE)
// ==============================================================

/**
 * Daily roll-call for one class. A teacher can submit only their own classes and only students in that class.
 * Saved in Supabase: one row per student, per class, per day (saving again updates it). PRESENT uses one class token.
 */
router.post("/daily-rollcall", async (req, res): Promise<any> => {
  try {
    const user = (req as AuthenticatedRequest).user!;
    const { scheduleId, date, entries } = req.body || {};

    if (!Array.isArray(entries) || entries.length === 0) {
      return res.status(400).json({ success: false, message: "Missing 'entries' array in daily attendance submission payload." });
    }
    if (!scheduleId) return res.status(400).json({ success: false, message: "scheduleId (the class) is required." });

    const slot = (await ScheduleDataService.listSchedules()).find(sl => sl.id === scheduleId);
    if (!slot) return res.status(404).json({ success: false, message: "This class was not found." });

    const scope = await getAccessScope(user);
    if (user.role === "TEACHER" && !slotBelongsToTeacher(slot, scope)) {
      return res.status(403).json({ success: false, message: "This class is not yours." });
    }

    const rollDate = String(date || instituteNow().dateStr).slice(0, 10);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(rollDate)) return res.status(400).json({ success: false, message: "date must be YYYY-MM-DD." });

    const recordedBy = (user.metadata as any)?.full_name || user.email || "Faculty";
    const courseName = slot.course_name;
    const classStudents = new Set(
      (slot.students || []).flatMap(st => [st.student_id, st.student_code].filter(Boolean).map(k => String(k).toLowerCase()))
    );

    const processedRecords: any[] = [];
    const rejected: Array<{ studentId: string; reason: string }> = [];
    let presentCount = 0;
    let absentCount = 0;
    let excusedCount = 0;

    for (const entry of entries) {
      const studentKey = String(entry.studentId || entry.student_id || "");
      const remarks = entry.remarks || "";
      try {
        if (user.role !== "ADMIN" && !classStudents.has(studentKey.toLowerCase()) && !allowsStudent(scope, studentKey)) {
          rejected.push({ studentId: studentKey, reason: "This student is not in your class." });
          continue;
        }
        const status = normalizeStatus(entry.status);
        const saved = await markAttendance({
          studentIdOrCode: studentKey, status, courseId: slot.course_id, courseName, scheduleId,
          date: rollDate, remarks, scanMethod: "TEACHER_ROLLCALL", markedByUserId: user.id, markedByName: recordedBy,
        });
        if (status === "PRESENT" || status === "LATE") presentCount++;
        else if (status === "ABSENT") absentCount++;
        else excusedCount++;

        const stats = await statsFor(saved.record.studentId);
        const studentName = saved.record.studentName;

        // Student history ledger
        ScheduleDataService.appendHistoryItem({
          student_id: saved.record.studentId,
          student_name: studentName,
          event_type: "ATTENDANCE_RECORD",
          title: `Daily Attendance: ${status}`,
          description: `Marked ${status} for '${courseName}' on ${rollDate}. Marked by: ${recordedBy}.${remarks ? ` Note: ${remarks}` : ""}`,
          metadata: { attendance_id: saved.record.id, schedule_id: scheduleId, date: rollDate, status, course_name: courseName, marked_by: recordedBy, remarks, attendance_percentage: stats.attendancePercentage },
          actor: recordedBy
        });

        // Parent email
        const student = await findStudent(studentKey);
        const parentEmail = student?.parentEmails?.[0] || student?.email;
        if (parentEmail) {
          sendDailyAttendanceRollCallEmail({
            parentEmail, studentName, courseName, date: rollDate, status, remarks,
            attendancePercentage: stats.attendancePercentage, markedBy: recordedBy
          }).catch(err => console.warn("Roll-call parent email warning:", err));
        }

        processedRecords.push({
          studentId: saved.record.studentId,
          studentName,
          status,
          attendancePercentage: stats.attendancePercentage,
          tokens_remaining: saved.token.remaining,
          isLowQuotaWarning: saved.token.low,
          warningMessage: saved.token.warning
        });
      } catch (entryErr: any) {
        rejected.push({ studentId: studentKey, reason: entryErr?.message || "Could not save." });
      }
    }

    const allFailed = processedRecords.length === 0;
    return res.status(allFailed ? 400 : 200).json({
      success: !allFailed,
      message: allFailed
        ? "Nothing was saved. " + (rejected[0]?.reason || "")
        : `Attendance saved for ${processedRecords.length} students.${rejected.length ? ` ${rejected.length} could not be saved.` : ""}`,
      data: {
        date: rollDate, courseName, total: processedRecords.length,
        present: presentCount, absent: absentCount, excused: excusedCount,
        records: processedRecords, rejected
      }
    });
  } catch (err: any) {
    return res.status(500).json({ success: false, message: "Failed to submit daily class attendance.", error: err.message });
  }
});

/**
 * Node 8: Dispatch Monthly Attendance Summary Email
 */
router.post("/monthly-summary-email", async (req, res): Promise<any> => {
  try {
    const { studentId, studentName, parentEmail, month, courseName } = req.body;

    if (!studentId || !parentEmail) {
      return res.status(400).json({ success: false, message: "studentId and parentEmail are required." });
    }

    // Pull student attendance counts
    const { data: records } = await supabaseAdmin
      .from("attendance")
      .select("status")
      .or(`student_id.eq.${studentId},student_name.ilike.%${studentName}%`);

    const totalClasses = records?.length || 1;
    const attendedClasses = records?.filter((r: any) => r.status === "PRESENT").length || 1;
    const percentage = Math.round((attendedClasses / totalClasses) * 100);

    const sent = await sendMonthlyAttendanceSummaryEmail({
      parentEmail,
      studentName: studentName || "Student",
      month: month || new Date().toLocaleString("default", { month: "long", year: "numeric" }),
      courseName,
      totalClasses,
      attendedClasses,
      percentage
    });

    return res.status(200).json({
      success: true,
      message: `Monthly attendance report dispatched to ${parentEmail}`,
      sent
    });
  } catch (err: any) {
    return res.status(500).json({ success: false, error: err.message });
  }
});

// 1. TEACHER SESSION ROSTER UNLOCK (GET /api/attendance/session/:sessionId/roster)
router.get("/session/:sessionId/roster", async (req, res) => {
  try {
    const { sessionId } = req.params;
    const scope = await getAccessScope((req as AuthenticatedRequest).user!);
    if (!scope.unrestricted) {
      const all = await SessionAttendanceService.getLiveSessionsFromSupabase();
      const sess = all.find((s: any) => s.id === sessionId || s.classSessionId === sessionId);
      if (!sess || scopeSessions([sess], scope).length === 0) {
        res.status(403).json({ success: false, message: "Forbidden: this class is not yours." });
        return;
      }
    }
    const rosterData = await SessionAttendanceService.getSessionRoster(sessionId);
    res.status(200).json({
      success: true,
      data: rosterData,
      students: rosterData.roster,
      studentsCount: rosterData.studentsCount
    });
  } catch (err: any) {
    res.status(500).json({
      success: false,
      message: "Failed to fetch session roster.",
      error: err.message
    });
  }
});

// 2. TEACHER BATCH ATTENDANCE SUBMIT & 4-PARTY EMAIL DISPATCH (POST /api/attendance/session/:sessionId/submit)
router.post("/session/:sessionId/submit", async (req, res) => {
  try {
    const { sessionId } = req.params;
    const { teacherId } = req.body;
    const rawEntries = req.body.entries || req.body.records || [];

    if (!Array.isArray(rawEntries) || rawEntries.length === 0) {
      return res.status(400).json({
        success: false,
        message: "Missing 'entries' or 'records' array in submission payload."
      });
    }

    const entries = rawEntries.map((r: any) => ({
      studentId: r.studentId || r.student_id,
      studentName: r.studentName || r.student_name,
      studentEmail: r.studentEmail || r.student_email,
      status: r.status,
      notes: r.notes || r.remarks
    }));

    const authUser = (req as AuthenticatedRequest).user!;
    const result = await SessionAttendanceService.submitTeacherSessionAttendance({
      classSessionId: sessionId,
      teacherId,
      entries,
      date: req.body.date,
      auditNote: req.body.auditNote
    }, { id: authUser.id, role: authUser.role, ...(authUser.email ? { email: authUser.email } : {}), name: (authUser.metadata as any)?.full_name || authUser.email || "Faculty" });

    res.status(200).json({
      success: true,
      message: result.message,
      data: result,
      results: result
    });
  } catch (err: any) {
    res.status(err?.status || 500).json({
      success: false,
      message: err?.status ? err.message : "Failed to submit class attendance.",
      error: err.message
    });
  }
});

// 3. QR CODE SCANNER CHECK-IN / CHECK-OUT (POST /api/attendance/scan-qr)
router.post("/scan-qr", async (req, res) => {
  try {
    const { studentQrCode, courseId, scanMethod } = req.body;

    if (!studentQrCode) {
      return res.status(400).json({
        success: false,
        message: "Missing 'studentQrCode' parameter for scanning."
      });
    }

    const authUser = (req as AuthenticatedRequest).user!;
    const result = await AttendanceService.scanQrCodeCheckInCheckOut({
      studentQrCode,
      courseId,
      scanMethod: scanMethod || "QR_CODE_SCANNER"
    }, { id: authUser.id, name: (authUser.metadata as any)?.full_name || authUser.email || "QR scanner" });

    res.status(200).json({
      success: true,
      message: result.message,
      data: result
    });
  } catch (err: any) {
    res.status(err?.status || 500).json({
      success: false,
      message: err?.status ? err.message : "Failed to process QR code attendance scan.",
      error: err.message
    });
  }
});

// 4. TEACHER BATCH ATTENDANCE MARKING (POST /api/attendance/mark-batch)
router.post("/mark-batch", async (req, res) => {
  try {
    const { courseId, date, entries } = req.body;

    if (!courseId || !Array.isArray(entries) || entries.length === 0) {
      return res.status(400).json({
        success: false,
        message: "Missing mandatory fields (courseId, entries array)."
      });
    }

    const authUser = (req as AuthenticatedRequest).user!;
    const scope = await getAccessScope(authUser);
    const notYours = entries.find((e: any) => !allowsStudent(scope, e.studentId));
    if (notYours) {
      return res.status(403).json({ success: false, message: "One of these students is not in your classes." });
    }
    const result = await AttendanceService.markBatchAttendance({
      courseId,
      date: date || instituteNow().dateStr,
      entries
    }, { id: authUser.id, name: (authUser.metadata as any)?.full_name || authUser.email || "Teacher" });

    res.status(200).json({
      success: true,
      message: `Batch attendance logged for ${result.records.length} students successfully.`,
      data: result
    });
  } catch (err: any) {
    res.status(500).json({
      success: false,
      message: "Failed to log batch attendance.",
      error: err.message
    });
  }
});

// 5. STUDENT ATTENDANCE STATS & LOW ATTENDANCE ANALYTICS (GET /api/attendance/student-stats/:studentId)
router.get("/student-stats/:studentId", async (req, res) => {
  try {
    const { studentId } = req.params;
    const scope = await getAccessScope((req as AuthenticatedRequest).user!);
    if (!allowsStudent(scope, studentId)) {
      res.status(403).json({ success: false, message: "Forbidden: this student is not linked to your login." });
      return;
    }
    const threshold = req.query.threshold ? Number(req.query.threshold) : 75;

    const stats = await AttendanceService.getStudentAttendanceStats(studentId, threshold);

    res.status(200).json({
      success: true,
      data: stats
    });
  } catch (err: any) {
    res.status(500).json({
      success: false,
      message: err.message
    });
  }
});

// 6. GET STUDENT QR CODE PASS (GET /api/attendance/qr-code/:studentId)
router.get("/qr-code/:studentId", async (req, res) => {
  const { studentId } = req.params;
  const scope = await getAccessScope((req as AuthenticatedRequest).user!);
  if (!allowsStudent(scope, studentId)) {
    res.status(403).json({ success: false, message: "Forbidden: this student is not linked to your login." });
    return;
  }
  const sMatch = inMemoryStudentStore.find(s => s.id === studentId || s.studentCode === studentId);
  const match = {
    studentId: sMatch?.id || studentId,
    studentName: sMatch?.fullName || "Student",
    studentCode: sMatch?.studentCode || `TG-STU-${studentId}`,
    courseName: "Enrolled Course"
  };

  const qrCodeData = `TG-QR-${match.studentCode}`;

  res.status(200).json({
    success: true,
    studentQrPass: {
      studentId: match.studentId,
      studentName: match.studentName,
      studentCode: match.studentCode,
      courseName: match.courseName,
      qrCodeData,
      qrImageMockUrl: `https://api.qrserver.com/v1/create-qr-code/?size=250x250&data=${encodeURIComponent(qrCodeData)}`
    }
  });
});

// 7. GET ALL ATTENDANCE LOGS (GET /api/attendance/list)
router.get("/list", async (req, res) => {
  try {
    const { studentId, courseId, date } = req.query;
    const scope = await getAccessScope((req as AuthenticatedRequest).user!);
    const studentIds = scope.unrestricted ? undefined : Array.from(scope.studentKeys).filter(isUuid);
    let rows = await listAttendance({
      ...(studentIds ? { studentIds } : {}),
      ...(courseId ? { courseId: String(courseId) } : {}),
      ...(date ? { date: String(date) } : {}),
    });
    if (studentId) rows = rows.filter(a => a.studentId === String(studentId) || a.studentCode === String(studentId));
    res.status(200).json({ success: true, count: rows.length, data: rows });
  } catch (err: any) {
    res.status(500).json({ success: false, message: err.message });
  }
});

// 7b. GET ORPHAN ATTENDANCE RECORDS REPORT (GET /api/attendance/orphans)
router.get("/orphans", async (_req, res) => {
  try {
    const report = await SessionAttendanceService.getOrphanAttendanceCount();
    res.status(200).json({
      success: true,
      orphanCount: report.orphanCount,
      totalCount: report.totalCount,
      message: `Database scan found ${report.orphanCount} attendance rows that do not belong to an active schedule class.`
    });
  } catch (err: any) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// 8. GET ALL SCHEDULED COURSE ATTENDANCE SESSIONS BY DAY & SLOT (GET /api/attendance/sessions)
router.get("/sessions", async (req, res) => {
  try {
    const { courseId, day, slot } = req.query;
    const liveSessions = await SessionAttendanceService.getLiveSessionsFromSupabase();

    let list = liveSessions.map(s => {
      const timeGate = SessionAttendanceService.checkSessionQrTimeGate(s);
      return {
        ...s,
        isUnlocked: timeGate.isUnlocked,
        statusBadgeText: timeGate.statusBadgeText,
        qrMockUrl: `https://api.qrserver.com/v1/create-qr-code/?size=250x250&data=${encodeURIComponent(s.qrToken)}`
      };
    });

    if (courseId) {
      list = list.filter(s => s.courseId === String(courseId));
    }
    if (day && day !== "ALL") {
      list = list.filter(s => (s as any).dayOfWeek === String(day) || s.courseName.toLowerCase().includes(String(day).toLowerCase()));
    }
    if (slot && slot !== "ALL") {
      list = list.filter(s => (s as any).slotName === String(slot) || (s as any).slotName?.toLowerCase().includes(String(slot).toLowerCase()));
    }

    // Login-based limits: teacher sees own classes; parent / student see only the classes their child attends.
    list = scopeSessions(list, await getAccessScope((req as AuthenticatedRequest).user!));

    res.status(200).json({
      success: true,
      count: list.length,
      data: list
    });
  } catch (err: any) {
    res.status(500).json({
      success: false,
      message: "Failed to retrieve attendance sessions.",
      error: err.message
    });
  }
});

// 9. SCHEDULE DYNAMIC ATTENDANCE SESSION FOR ANY COURSE (POST /api/attendance/sessions/create)
router.post("/sessions/create", (req, res) => {
  try {
    const { courseId, courseName, teacherId, teacherName, dayOfWeek, slotName, startTimeIso, endTimeIso, graceMinutes } = req.body;

    if (!courseName) {
      return res.status(400).json({ success: false, message: "Course Name is required." });
    }

    const sessionId = `sess-${(courseId || 'crs').toLowerCase().replace(/[^a-z0-9]/g, '-')}-${Date.now().toString().slice(-4)}`;
    const nowIso = new Date().toISOString();
    const start = startTimeIso || nowIso;
    const end = endTimeIso || new Date(Date.now() + 7200000).toISOString();

    const newSession = SessionAttendanceService.generateSessionQrToken({
      classSessionId: sessionId,
      courseId: courseId || `crs-${Date.now()}`,
      courseName: courseName,
      teacherId: teacherId || "tchr-gen-1",
      teacherName: teacherName || "Assigned Faculty",
      startTimeIso: start,
      endTimeIso: end,
      graceMinutes: parseInt(graceMinutes) || 15
    });

    (newSession as any).dayOfWeek = dayOfWeek || "Today";
    (newSession as any).slotName = slotName || "Standard Class Slot";

    res.status(201).json({
      success: true,
      message: `Live Attendance Session for '${courseName}' scheduled for ${dayOfWeek || 'Today'} (${slotName || 'Active Slot'}) with QR Code!`,
      data: {
        ...newSession,
        qrMockUrl: `https://api.qrserver.com/v1/create-qr-code/?size=250x250&data=${encodeURIComponent(newSession.qrToken)}`
      }
    });
  } catch (err: any) {
    res.status(500).json({
      success: false,
      message: "Failed to schedule course attendance session.",
      error: err.message
    });
  }
});

export default router;
