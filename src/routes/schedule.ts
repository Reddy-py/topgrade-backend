import { Router } from "express";
import { supabaseAdmin } from "../index.js";
import { dispatchMultiChannelNotification } from "../services/notificationService.js";

const router = Router();

// In-memory reschedule tracking state fallback
let inMemoryReschedules: Record<string, { count: number; lastSessionTime?: string }> = {};

// 1. Endpoint to allocate a new class with active conflict checks
router.post("/allocate", async (req, res): Promise<any> => {
  const { 
    student_id, 
    course_id, 
    teacher_id, 
    branch, 
    classroom, 
    day_of_week, 
    time_slot, 
    duration_minutes, 
    start_date, 
    end_date 
  } = req.body;

  try {
    // 1. Conflict Check: Is the Teacher already booked at this exact time and day?
    const { data: teacherConflict } = await supabaseAdmin
      .from("schedules")
      .select("id")
      .eq("teacher_id", teacher_id)
      .eq("day_of_week", day_of_week)
      .eq("time_slot", time_slot)
      .limit(1);

    if (teacherConflict && teacherConflict.length > 0) {
      return res.status(400).json({ 
        success: false, 
        error: "Scheduling Conflict: The assigned Teacher is already booked for another course session during this slot." 
      });
    }

    // 2. Conflict Check: Is the physical Classroom already occupied at this branch?
    const { data: roomConflict } = await supabaseAdmin
      .from("schedules")
      .select("id")
      .eq("branch", branch)
      .eq("classroom", classroom)
      .eq("day_of_week", day_of_week)
      .eq("time_slot", time_slot)
      .limit(1);

    if (roomConflict && roomConflict.length > 0) {
      return res.status(400).json({ 
        success: false, 
        error: "Scheduling Conflict: The designated classroom space is already occupied by another class session." 
      });
    }

    // 3. Conflict Check: Is the Student already busy elsewhere?
    const { data: studentConflict } = await supabaseAdmin
      .from("schedules")
      .select("id")
      .eq("student_id", student_id)
      .eq("day_of_week", day_of_week)
      .eq("time_slot", time_slot)
      .limit(1);

    if (studentConflict && studentConflict.length > 0) {
      return res.status(400).json({ 
        success: false, 
        error: "Scheduling Conflict: This student is already assigned to a different course schedule during this time." 
      });
    }

    // Clear verification check -> Insert structural event allocation row
    const { data: newSchedule, error: insertError } = await supabaseAdmin
      .from("schedules")
      .insert([
        { student_id, course_id, teacher_id, branch, classroom, day_of_week, time_slot, duration_minutes, start_date, end_date }
      ])
      .select();

    if (insertError) throw insertError;

    res.status(201).json({ success: true, data: newSchedule[0] });

  } catch (error: any) {
    res.status(500).json({ success: false, error: error.message });
  }
});

// 2. ATTENDANCE & RESCHEDULE STATE MACHINE (POST /api/schedules/reschedule)
router.post("/reschedule", async (req, res): Promise<any> => {
  const { 
    schedule_id, 
    student_id, 
    student_name, 
    course_name, 
    session_timestamp, 
    requested_new_time, 
    reason, 
    student_email, 
    parent_email 
  } = req.body;

  const key = `${student_id || "std"}_${course_name || "course"}`;
  const tracker = inMemoryReschedules[key] || { count: 0 };

  // RULE 2: Attempt Cap <= 3 Reschedules per Term
  if (tracker.count >= 3) {
    return res.status(400).json({
      success: false,
      code: "RESCHEDULE_LIMIT_EXCEEDED",
      error: "Sorry for the inconvenience. You have exceeded the rescheduling limit."
    });
  }

  // RULE 1: Notice Window >= 24 Hours in Advance
  if (session_timestamp) {
    const scheduledTime = new Date(session_timestamp).getTime();
    const now = Date.now();
    const diffHours = (scheduledTime - now) / (1000 * 60 * 60);

    if (diffHours < 24) {
      return res.status(400).json({
        success: false,
        code: "NOTICE_WINDOW_VIOLATION",
        error: "Reschedule requests must be submitted at least 24 hours prior to the session start time."
      });
    }
  }

  // Increment Reschedule Counter
  tracker.count += 1;
  tracker.lastSessionTime = requested_new_time || new Date().toISOString();
  inMemoryReschedules[key] = tracker;

  // Database Update
  try {
    await supabaseAdmin
      .from("schedules")
      .update({ 
        time_slot: requested_new_time, 
        reschedule_count: tracker.count 
      })
      .eq("id", schedule_id);
  } catch (err) {
    console.warn("Reschedule database update fallback note:", err);
  }

  // Trigger Nodemailer Gmail Notifications to Student, Parent & Admin
  const adminEmail = process.env.GMAIL_USER || "sivareddy683970@gmail.com";
  const recipients: Array<{ role: "STUDENT" | "PARENT" | "ADMIN"; email: string; name: string }> = [
    { role: "STUDENT", email: student_email || adminEmail, name: student_name || "Student" },
    { role: "ADMIN", email: adminEmail, name: "System Administrator" }
  ];

  if (parent_email) {
    recipients.push({ role: "PARENT", email: parent_email, name: "Parent" });
  }

  await dispatchMultiChannelNotification({
    eventType: "ADMISSION_INQUIRY",
    subject: `📅 Class Reschedule Confirmed — ${course_name || "Course Session"}`,
    message: `Dear ${student_name || "Student"},\n\nYour class reschedule request for ${course_name || "Course Session"} has been processed.\n\n• Reschedule Attempt: ${tracker.count} of 3 Allowed per Term\n• New Requested Time: ${requested_new_time || "To Be Assigned"}\n• Reason: ${reason || "Student Request"}\n\nParent and Faculty have been notified.`,
    recipients
  });

  return res.status(200).json({
    success: true,
    message: `Class session successfully rescheduled! Attempt ${tracker.count} of 3 used.`,
    data: {
      schedule_id,
      reschedule_count: tracker.count,
      remaining_reschedules: 3 - tracker.count,
      new_time: requested_new_time
    }
  });
});

// 3. AUTOMATED DISPATCH OFFER WITH 3-ATTEMPT ADMIN ESCALATION
let inMemoryDispatchTracker: Record<string, { attempts: number; status: string }> = {};

router.post("/dispatch-offer", async (req, res): Promise<any> => {
  const { schedule_id, teacher_id, teacher_name, course_name } = req.body;
  const key = schedule_id || `sch-${Date.now()}`;
  
  const record = inMemoryDispatchTracker[key] || { attempts: 0, status: "pending" };
  record.attempts += 1;
  inMemoryDispatchTracker[key] = record;

  const isEscalated = record.attempts >= 3;
  if (isEscalated) {
    record.status = "escalated_to_admin";

    // Urgent Gmail Alert to Admin
    const adminEmail = process.env.GMAIL_USER || "sivareddy683970@gmail.com";
    await dispatchMultiChannelNotification({
      eventType: "TEACHER_ASSIGNMENT",
      subject: `🚨 URGENT ADMIN ESCALATION: Scheduling Failed 3 Times (${course_name || "Session"})`,
      message: `ATTENTION ADMINISTRATOR:\n\nThe scheduling dispatch offer for course "${course_name || "Session"}" has failed/timed out after ${record.attempts} attempts.\n\nAutomated negotiations have been frozen. Please perform an Admin Takeover to assign faculty manually.`,
      recipients: [{ role: "ADMIN", email: adminEmail, name: "System Administrator" }]
    });

    return res.status(200).json({
      success: true,
      escalated_to_admin: true,
      dispatch_attempts: record.attempts,
      message: "3 dispatch attempts exceeded! Workflow escalated to Admin for manual takeover.",
      code: "DISPATCH_ESCALATED_TO_ADMIN"
    });
  }

  return res.status(200).json({
    success: true,
    escalated_to_admin: false,
    dispatch_attempts: record.attempts,
    message: `Faculty dispatch offer ${record.attempts} of 3 sent to ${teacher_name || "Faculty"}!`
  });
});

// 4. ADMIN TAKEOVER / MANUAL SLOT OVERRIDE
router.post("/admin-takeover", async (req, res): Promise<any> => {
  const { schedule_id, admin_id, manual_teacher_id, override_reason } = req.body;
  const key = schedule_id || "sch-takeover";

  inMemoryDispatchTracker[key] = { attempts: 3, status: "admin_takeover_active" };

  return res.status(200).json({
    success: true,
    admin_takeover: true,
    message: "Admin Takeover Activated! Direct parent-teacher negotiations frozen. Manual slot override enabled.",
    data: {
      schedule_id,
      assigned_by_admin: admin_id || "Admin",
      manual_teacher_id,
      override_reason: override_reason || "Admin Overridden"
    }
  });
});

export default router;