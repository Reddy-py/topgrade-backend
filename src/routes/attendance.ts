import express from "express";
import { AttendanceService, attendanceStore } from "../services/attendanceService.js";
import { SessionAttendanceService, classSessionQrStore, type ClassSessionQRRecord } from "../services/sessionAttendanceService.js";
import { inMemoryStudentStore } from "../services/studentService.js";
import { supabaseAdmin } from "../supabase.js";
import { sendDailyAttendanceRollCallEmail, sendMonthlyAttendanceSummaryEmail } from "../services/notificationService.js";
import { ScheduleDataService } from "../services/scheduleDataService.js";

const router = express.Router();

// ==============================================================
// NODE 6: SCHEDULE-DRIVEN DAILY ATTENDANCE SYSTEM (NO QR CODE)
// ==============================================================

/**
 * Submit Daily Class Attendance Roll-Call for a Scheduled Slot
 * Saves to Supabase `attendance`, recalculates attendance %, dispatches emails, and writes to student history.
 */
router.post("/daily-rollcall", async (req, res): Promise<any> => {
  try {
    const { scheduleId, courseName, date, markedBy, entries } = req.body;

    if (!Array.isArray(entries) || entries.length === 0) {
      return res.status(400).json({
        success: false,
        message: "Missing 'entries' array in daily attendance submission payload."
      });
    }

    const rollDate = date || new Date().toISOString().slice(0, 10);
    const recordedBy = markedBy || "Course Faculty";
    const processedRecords: any[] = [];
    let presentCount = 0;
    let absentCount = 0;
    let excusedCount = 0;

    for (const entry of entries) {
      const studentId = entry.studentId || entry.student_id;
      const studentName = entry.studentName || entry.student_name || "Student";
      const status = (entry.status || "PRESENT").toUpperCase();
      const remarks = entry.remarks || "";

      if (status === "PRESENT") presentCount++;
      else if (status === "ABSENT") absentCount++;
      else if (status === "EXCUSED") excusedCount++;

      // 1. Insert into Supabase `attendance` table
      let insertedId = `att-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
      try {
        const { data: dbAtt, error: attErr } = await supabaseAdmin
          .from("attendance")
          .insert([
            {
              student_id: studentId,
              student_name: studentName,
              class_name: courseName || "Scheduled Class",
              status,
              date: rollDate,
              remarks,
              marked_by: recordedBy
            }
          ])
          .select();

        if (!attErr && dbAtt && dbAtt.length > 0) {
          insertedId = dbAtt[0].id;
        }
      } catch (err) {
        console.warn("Supabase attendance insert note:", err);
      }

      // Also record in attendanceStore memory for backward compatibility
      attendanceStore.push({
        id: insertedId,
        studentId,
        studentName,
        studentCode: entry.studentCode || entry.student_code || `TG-STU-${studentId.slice(0, 6)}`,
        courseId: scheduleId || "scheduled-slot",
        courseName: courseName || "Scheduled Class",
        date: rollDate,
        status: status as any,
        checkInTime: status === "PRESENT" ? `${rollDate}T10:00:00Z` : undefined,
        scanMethod: "TEACHER_BATCH",
        notes: remarks,
        createdAt: new Date().toISOString()
      });

      // 2. Calculate updated overall attendance % for this student
      let attendancePercentage = 100;
      try {
        const { data: allStudentAtt } = await supabaseAdmin
          .from("attendance")
          .select("status")
          .or(`student_id.eq.${studentId},student_name.ilike.%${studentName}%`);

        if (allStudentAtt && allStudentAtt.length > 0) {
          const totalSessions = allStudentAtt.length;
          const presentSessions = allStudentAtt.filter((a: any) => a.status === "PRESENT").length;
          attendancePercentage = Math.round((presentSessions / totalSessions) * 100);
        }
      } catch (e) {
        console.warn("Attendance percentage compute note:", e);
      }

      // 3. Append to Node 10: Student History Ledger
      ScheduleDataService.appendHistoryItem({
        student_id: studentId,
        student_name: studentName,
        event_type: "ATTENDANCE_RECORD",
        title: `Daily Attendance: ${status}`,
        description: `Marked ${status} for '${courseName || "Class"}' on ${rollDate}. Marked by: ${recordedBy}.${remarks ? ` Note: ${remarks}` : ""}`,
        metadata: {
          attendance_id: insertedId,
          schedule_id: scheduleId,
          date: rollDate,
          status,
          course_name: courseName,
          marked_by: recordedBy,
          remarks,
          attendance_percentage: attendancePercentage
        },
        actor: recordedBy
      });

      // 4. Node 8: Dispatch Immediate Daily Attendance Summary Email to Parent
      let parentEmail = entry.parentEmail || entry.parent_email;
      if (!parentEmail) {
        try {
          const { data: stRec } = await supabaseAdmin
            .from("students")
            .select("email, parent_emails, father_phone")
            .eq("id", studentId)
            .maybeSingle();

          if (stRec) {
            parentEmail = stRec.parent_emails?.[0] || stRec.email;
          }
        } catch (e) {}
      }

      if (parentEmail) {
        sendDailyAttendanceRollCallEmail({
          parentEmail,
          studentName,
          courseName: courseName || "Scheduled Class",
          date: rollDate,
          status,
          remarks,
          attendancePercentage,
          markedBy: recordedBy
        }).catch(err => console.warn("Roll-call parent email warning:", err));
      }

      processedRecords.push({
        studentId,
        studentName,
        status,
        attendancePercentage
      });
    }

    return res.status(200).json({
      success: true,
      message: `Daily attendance for ${processedRecords.length} students submitted successfully! Parent emails dispatched.`,
      data: {
        date: rollDate,
        courseName,
        total: processedRecords.length,
        present: presentCount,
        absent: absentCount,
        excused: excusedCount,
        records: processedRecords
      }
    });
  } catch (err: any) {
    return res.status(500).json({
      success: false,
      message: "Failed to submit daily class attendance.",
      error: err.message
    });
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
    const rosterData = await SessionAttendanceService.getSessionRoster(sessionId);
    res.status(200).json({
      success: true,
      data: rosterData
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
    const { teacherId, entries } = req.body;

    if (!Array.isArray(entries) || entries.length === 0) {
      return res.status(400).json({
        success: false,
        message: "Missing 'entries' array in submission payload."
      });
    }

    const result = await SessionAttendanceService.submitTeacherSessionAttendance({
      classSessionId: sessionId,
      teacherId,
      entries
    });

    res.status(200).json({
      success: true,
      message: result.message,
      data: result
    });
  } catch (err: any) {
    res.status(500).json({
      success: false,
      message: "Failed to submit class attendance.",
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

    const result = await AttendanceService.scanQrCodeCheckInCheckOut({
      studentQrCode,
      courseId,
      scanMethod: scanMethod || "QR_CODE_SCANNER"
    });

    res.status(200).json({
      success: true,
      message: result.message,
      data: result
    });
  } catch (err: any) {
    res.status(500).json({
      success: false,
      message: "Failed to process QR code attendance scan.",
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

    const result = await AttendanceService.markBatchAttendance({
      courseId,
      date: date || new Date().toISOString().slice(0, 10),
      entries
    });

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
router.get("/student-stats/:studentId", (req, res) => {
  try {
    const { studentId } = req.params;
    const threshold = req.query.threshold ? Number(req.query.threshold) : 75;

    const stats = AttendanceService.getStudentAttendanceStats(studentId, threshold);

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
router.get("/qr-code/:studentId", (req, res) => {
  const { studentId } = req.params;
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
router.get("/list", (req, res) => {
  const { studentId, courseId } = req.query;
  let filtered = attendanceStore;

  if (studentId) {
    filtered = filtered.filter(a => a.studentId === String(studentId));
  }

  if (courseId) {
    filtered = filtered.filter(a => a.courseId === String(courseId));
  }

  res.status(200).json({
    success: true,
    count: filtered.length,
    data: filtered
  });
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
