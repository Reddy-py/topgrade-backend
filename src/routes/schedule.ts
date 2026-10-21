import { Router } from "express";
import type { Request, Response } from "express";
import { supabaseAdmin } from "../supabase.js";
import { dispatchMultiChannelNotification, sendClassScheduleEmail } from "../services/notificationService.js";
import { sendScheduleClassEvent } from "../services/eventEmailService.js";
import { ScheduleDataService, getSlotDurationMinutes } from "../services/scheduleDataService.js";
import type { AuthenticatedRequest } from "../middleware/auth.js";
import { getAccessScope, allowsStudent, allowsTeacher, scopeSchedules } from "../services/accessScope.js";
import { listOpenSlots, claimSlot, releaseSlot } from "../services/slotClaimService.js";

const router = Router();

// In-memory reschedule tracking state fallback
let inMemoryReschedules: Record<string, { count: number; lastSessionTime?: string }> = {};

// ==========================================
// NODE 4 & 5: WEEKLY SCHEDULE ENGINE ROUTES
// ==========================================

// 1. List all active schedule slots with mapped students
router.get(["/", "/list"], async (req, res): Promise<any> => {
  try {
    const scope = await getAccessScope((req as AuthenticatedRequest).user!);
    let schedules = scopeSchedules(await ScheduleDataService.listSchedules(), scope);

    // Apply query filters: course, teacher, location, program, day
    const { course, teacher, location, location_id, program, program_type, day } = req.query as Record<string, string>;

    if (course && course !== "ALL") {
      const cLower = course.toLowerCase().trim();
      schedules = schedules.filter(s =>
        s.course_id.toLowerCase() === cLower || s.course_name.toLowerCase().includes(cLower)
      );
    }

    if (teacher && teacher !== "ALL") {
      const tLower = teacher.toLowerCase().trim();
      schedules = schedules.filter(s =>
        s.teacher_id.toLowerCase() === tLower || s.teacher_name.toLowerCase().includes(tLower)
      );
    }

    const locFilter = (location_id || location || "").toLowerCase().trim();
    if (locFilter && locFilter !== "ALL") {
      schedules = schedules.filter(s =>
        (s.location_id && s.location_id.toLowerCase() === locFilter) ||
        (s.location && s.location.toLowerCase().includes(locFilter))
      );
    }

    const prog = (program_type || program || "").toUpperCase().trim();
    if (prog && prog !== "ALL") {
      schedules = schedules.filter(s => {
        const sp = (s.program_type || s.program || "").toUpperCase();
        return sp === prog || sp.includes(prog);
      });
    }

    if (day && day !== "ALL") {
      const dayLower = day.toLowerCase().trim();
      schedules = schedules.filter(s => s.day_of_week.toLowerCase() === dayLower);
    }

    return res.status(200).json({ success: true, count: schedules.length, data: schedules });
  } catch (err: any) {
    return res.status(500).json({ success: false, error: err.message });
  }
});

// 1b. Admin report listing existing slots that are not 60 minutes so they can be fixed
router.get("/irregular-slots", async (req, res): Promise<any> => {
  try {
    const user = (req as AuthenticatedRequest).user!;
    if (user?.role !== "ADMIN") {
      return res.status(403).json({ success: false, error: "Only administrators can view the irregular slots report." });
    }
    const report = await ScheduleDataService.getIrregularScheduleSlotsReport();

    return res.status(200).json({
      success: true,
      count: report.irregularCount,
      data: report.irregularSlots
    });
  } catch (err: any) {
    return res.status(500).json({ success: false, error: err.message });
  }
});

// 2. Fetch existing institutional courses strictly from database/CSV
// Requirement 8: open classes a teacher may take, and taking / giving back a class.
const claimFail = (res: Response, err: any) =>
  res.status(err?.status || 500).json({ success: false, error: err?.message || "Could not complete this." });

router.get("/open", async (req, res): Promise<any> => {
  try {
    const user = (req as AuthenticatedRequest).user!;
    if (user.role !== "TEACHER") return res.status(200).json({ success: true, data: [] });
    return res.status(200).json({ success: true, data: await listOpenSlots(user) });
  } catch (err: any) { return claimFail(res, err); }
});

router.post("/:id/claim", async (req, res): Promise<any> => {
  try {
    const user = (req as AuthenticatedRequest).user!;
    if (user.role !== "TEACHER") return res.status(403).json({ success: false, error: "Only a teacher can take a class. The admin assigns classes by editing them." });
    const slot = await claimSlot(user, String(req.params.id));
    return res.status(200).json({ success: true, message: `You are now teaching ${slot.course_name} on ${slot.day_of_week} (${slot.time_slot}).`, data: slot });
  } catch (err: any) { return claimFail(res, err); }
});

router.post("/:id/release", async (req, res): Promise<any> => {
  try {
    await releaseSlot((req as AuthenticatedRequest).user!, String(req.params.id));
    return res.status(200).json({ success: true, message: "The class is open for teachers again." });
  } catch (err: any) { return claimFail(res, err); }
});

router.get("/existing-courses", async (_req, res): Promise<any> => {
  try {
    const courses = await ScheduleDataService.getExistingCourses();
    return res.status(200).json({ success: true, count: courses.length, data: courses });
  } catch (err: any) {
    return res.status(500).json({ success: false, error: err.message });
  }
});

// 2b. Check Conflicts and suggest free slots
router.post("/check-conflicts", async (req: Request, res: Response): Promise<any> => {
  try {
    const {
      scheduleIdToExclude,
      day_of_week,
      start_time,
      end_time,
      teacher_id,
      room,
      student_ids
    } = req.body;

    if (!day_of_week || !start_time || !end_time) {
      return res.status(400).json({ success: false, error: "day_of_week, start_time, and end_time are required." });
    }

    const conflict = await ScheduleDataService.checkCollisions({
      scheduleIdToExclude,
      day_of_week,
      start_time,
      end_time,
      teacher_id: teacher_id || "",
      room: room || "",
      student_ids: Array.isArray(student_ids) ? student_ids : []
    });

    let suggested_free_slots: string[] = [];
    if (conflict.hasConflict || req.body.suggest_free === true) {
      suggested_free_slots = await ScheduleDataService.suggestFreeSlots({
        teacher_id,
        room,
        day_of_week,
        scheduleIdToExclude
      });
    }

    return res.status(200).json({
      success: true,
      hasConflict: conflict.hasConflict,
      error: conflict.error,
      suggested_free_slots
    });
  } catch (err: any) {
    return res.status(500).json({ success: false, error: err.message });
  }
});

// 2c. Suggest free time slots for teacher and room
router.get("/suggest-free-slots", async (req: Request, res: Response): Promise<any> => {
  try {
    const { teacher_id, room, day_of_week, scheduleIdToExclude } = req.query as Record<string, string>;
    if (!day_of_week) {
      return res.status(400).json({ success: false, error: "day_of_week is required." });
    }

    const freeSlots = await ScheduleDataService.suggestFreeSlots({
      teacher_id,
      room,
      day_of_week,
      scheduleIdToExclude
    });

    return res.status(200).json({ success: true, suggested_free_slots: freeSlots });
  } catch (err: any) {
    return res.status(500).json({ success: false, error: err.message });
  }
});

// 3. Create schedule slot with collision detection & student email notification
const createScheduleSlotHandler = async (req: Request, res: Response): Promise<any> => {
  try {
    const {
      course_id,
      course_name,
      teacher_id,
      teacher_name,
      day_of_week,
      start_time,
      end_time,
      room,
      location,
      location_id,
      location_address,
      program,
      program_type,
      max_capacity,
      students
    } = req.body;
    // Requirement 8: a slot with no teacher that teachers can take themselves
    const openForTeachers = req.body.open_for_teachers === true;

    const effectiveStartTime = start_time || (req.body.time_slot ? req.body.time_slot.split("-")[0]?.trim() : "");
    const effectiveEndTime = end_time || (req.body.time_slot ? req.body.time_slot.split("-")[1]?.trim() : "");

    const daysList = Array.isArray(req.body.days_of_week) && req.body.days_of_week.length > 0
      ? req.body.days_of_week
      : (Array.isArray(day_of_week) ? day_of_week : (day_of_week ? [day_of_week] : []));

    if (!course_name || (!openForTeachers && !teacher_name) || daysList.length === 0 || !effectiveStartTime || !effectiveEndTime) {
      return res.status(400).json({
        success: false,
        error: "Missing mandatory schedule fields (course_name, teacher_name, day_of_week / days_of_week, start_time, end_time)."
      });
    }

    // Verify course exists in existing course list
    const existingCourses = await ScheduleDataService.getExistingCourses();
    const courseExists = existingCourses.length === 0 || existingCourses.some(c => 
      c.id === course_id || 
      c.name.trim().toLowerCase() === course_name.trim().toLowerCase() ||
      course_name.toLowerCase().includes(c.name.toLowerCase()) ||
      c.name.toLowerCase().includes(course_name.toLowerCase())
    );

    if (!courseExists) {
      return res.status(400).json({
        success: false,
        error: `Invalid Course: '${course_name}' is not in the enrolled institutional courses. Must bind strictly to existing courses.`
      });
    }

    const duration = getSlotDurationMinutes(effectiveStartTime, effectiveEndTime);
    if (duration !== 60) {
      return res.status(400).json({
        success: false,
        error: `Class slot must be exactly 60 minutes (1 hour). Received ${duration} minutes (${effectiveStartTime} to ${effectiveEndTime}).`
      });
    }

    const effectiveProgram = (program_type || program || "TUTORING").toUpperCase();

    if (daysList.length > 1) {
      const createdSlots = await ScheduleDataService.createMultiDaySchedules({
        course_id: course_id || `crs-${Date.now()}`,
        course_name,
        teacher_id: openForTeachers ? "" : (teacher_id || "tchr-1"),
        teacher_name: openForTeachers ? "" : teacher_name,
        open_for_teachers: openForTeachers,
        days_of_week: daysList,
        start_time: effectiveStartTime,
        end_time: effectiveEndTime,
        room: room || "Room 101",
        location: location || "Main Academic Center",
        location_id,
        location_address,
        program: effectiveProgram,
        program_type: effectiveProgram,
        max_capacity: max_capacity || 15,
        students
      });

      return res.status(201).json({
        success: true,
        message: `Created ${createdSlots.length} weekly schedule slots for '${course_name}' across ${daysList.join(", ")}.`,
        data: createdSlots[0],
        allCreated: createdSlots
      });
    }

    const createdSlot = await ScheduleDataService.createSchedule({
      id: req.body.id,
      course_id: course_id || `crs-${Date.now()}`,
      course_name,
      teacher_id: openForTeachers ? "" : (teacher_id || "tchr-1"),
      teacher_name: openForTeachers ? "" : teacher_name,
      open_for_teachers: openForTeachers,
      day_of_week: daysList[0],
      start_time: effectiveStartTime,
      end_time: effectiveEndTime,
      room: room || "Room 101",
      location: location || "Main Academic Center",
      location_id,
      location_address,
      program: effectiveProgram,
      program_type: effectiveProgram,
      max_capacity: max_capacity || 15,
      students
    });

    // Send Class Schedule Email to Parents and Students
    if (students && Array.isArray(students) && students.length > 0) {
      void sendScheduleClassEvent({
        actionType: "CLASS_CREATED",
        courseName: course_name,
        dayOfWeek: daysList[0],
        timeSlot: createdSlot.time_slot,
        room: createdSlot.room,
        locationName: createdSlot.location,
        locationAddress: createdSlot.location_address,
        teacherName: teacher_name,
        teacherEmail: (createdSlot as any).teacher_email,
        students: students.map((st: any) => ({
          id: st.student_id,
          name: st.student_name,
          email: st.student_email || st.email,
          parentEmails: st.parent_email ? [st.parent_email] : st.parent_emails
        }))
      }).catch(e => console.warn("Email dispatch note:", e));
    }

    return res.status(201).json({
      success: true,
      message: `Weekly schedule slot for '${course_name}' on ${daysList[0]} created successfully.`,
      data: createdSlot
    });
  } catch (err: any) {
    const isBadRequest = err.message?.toLowerCase().includes("collision") ||
                         err.message?.toLowerCase().includes("duration") ||
                         err.message?.toLowerCase().includes("60 minutes");
    return res.status(isBadRequest ? 400 : 500).json({
      success: false,
      error: err.message
    });
  }
};

router.post("/create", createScheduleSlotHandler);
router.post("/create-multi", createScheduleSlotHandler);
router.post("/", createScheduleSlotHandler);

// 4. Update schedule slot
const updateScheduleHandler = async (req: Request, res: Response): Promise<any> => {
  try {
    const id = String(req.params.id);
    const existingSlot = (await ScheduleDataService.listSchedules()).find(s => s.id === id);
    const updated = await ScheduleDataService.updateSchedule(id, req.body);

    if (updated) {
      const isRescheduled = existingSlot && (existingSlot.day_of_week !== updated.day_of_week || existingSlot.time_slot !== updated.time_slot);
      void sendScheduleClassEvent({
        actionType: isRescheduled ? "CLASS_RESCHEDULED" : "CLASS_CHANGED",
        courseName: updated.course_name,
        dayOfWeek: updated.day_of_week,
        timeSlot: updated.time_slot,
        room: updated.room,
        locationName: updated.location,
        locationAddress: updated.location_address,
        teacherName: updated.teacher_name,
        teacherEmail: (updated as any).teacher_email,
        students: (updated.students || []).map((st: any) => ({
          id: st.student_id,
          name: st.student_name,
          email: st.student_email || st.email,
          parentEmails: st.parent_email ? [st.parent_email] : st.parent_emails
        }))
      }).catch(() => undefined);
    }

    return res.status(200).json({
      success: true,
      message: "Schedule slot updated successfully.",
      data: updated
    });
  } catch (err: any) {
    const isBadRequest = err.message?.toLowerCase().includes("collision") ||
                         err.message?.toLowerCase().includes("duration") ||
                         err.message?.toLowerCase().includes("60 minutes");
    return res.status(isBadRequest ? 400 : 500).json({
      success: false,
      error: err.message
    });
  }
};

router.put("/edit/:id", updateScheduleHandler);
router.put("/:id", updateScheduleHandler);

// 5. Delete schedule slot
router.delete("/:id", async (req, res): Promise<any> => {
  try {
    const { id } = req.params;
    const existingSlot = (await ScheduleDataService.listSchedules()).find(s => s.id === id);
    await ScheduleDataService.deleteSchedule(id);

    if (existingSlot) {
      void sendScheduleClassEvent({
        actionType: "CLASS_CANCELLED",
        courseName: existingSlot.course_name,
        dayOfWeek: existingSlot.day_of_week,
        timeSlot: existingSlot.time_slot,
        room: existingSlot.room,
        locationName: existingSlot.location,
        locationAddress: existingSlot.location_address,
        teacherName: existingSlot.teacher_name,
        teacherEmail: (existingSlot as any).teacher_email,
        students: (existingSlot.students || []).map((st: any) => ({
          id: st.student_id,
          name: st.student_name,
          email: st.student_email || st.email,
          parentEmails: st.parent_email ? [st.parent_email] : st.parent_emails
        })),
        cancellationReason: req.body?.reason || (req.query as any)?.reason ? String(req.body?.reason || (req.query as any)?.reason) : "Administrative class cancellation"
      }).catch(() => undefined);
    }

    return res.status(200).json({
      success: true,
      message: "Schedule slot removed successfully."
    });
  } catch (err: any) {
    return res.status(500).json({ success: false, error: err.message });
  }
});

// 6. Get student schedule slots
router.get("/student/:studentId", async (req, res): Promise<any> => {
  try {
    const { studentId } = req.params;
    const scope = await getAccessScope((req as AuthenticatedRequest).user!);
    if (!allowsStudent(scope, studentId)) {
      return res.status(403).json({ success: false, error: "Forbidden: this student is not linked to your login." });
    }
    const schedules = await ScheduleDataService.getStudentSchedules(studentId);
    return res.status(200).json({ success: true, count: schedules.length, data: schedules });
  } catch (err: any) {
    return res.status(500).json({ success: false, error: err.message });
  }
});

// 7. Get teacher roster
router.get("/teacher/:teacherId/roster", async (req, res): Promise<any> => {
  try {
    const { teacherId } = req.params;
    const scope = await getAccessScope((req as AuthenticatedRequest).user!);
    if (!allowsTeacher(scope, teacherId)) {
      return res.status(403).json({ success: false, error: "Forbidden: you can only open your own roster." });
    }
    const roster = await ScheduleDataService.getTeacherRoster(teacherId);
    return res.status(200).json({ success: true, count: roster.length, data: roster });
  } catch (err: any) {
    return res.status(500).json({ success: false, error: err.message });
  }
});

// 8. Assign a student to a specific schedule slot
router.post("/assign-student", async (req: Request, res: Response): Promise<any> => {
  try {
    const { schedule_id, student_id, student_name, student_code, parent_email } = req.body;
    if (!schedule_id || !student_id || !student_name) {
      return res.status(400).json({
        success: false,
        error: "Missing required fields: schedule_id, student_id, and student_name are mandatory."
      });
    }

    const updatedSlot = await ScheduleDataService.assignStudentToSlot({
      schedule_id,
      student_id,
      student_name,
      student_code
    });

    // Optional email dispatch to parent
    let targetParentEmail = parent_email;
    if (!targetParentEmail) {
      try {
        const { data: sRec } = await supabaseAdmin
          .from("students")
          .select("email, parent_emails, father_phone")
          .eq("id", student_id)
          .maybeSingle();
        if (sRec) {
          targetParentEmail = sRec.parent_emails?.[0] || sRec.email;
        }
      } catch (e) {}
    }

    if (targetParentEmail) {
      sendClassScheduleEmail({
        parentEmail: targetParentEmail,
        studentName: student_name,
        courseName: updatedSlot.course_name,
        dayOfWeek: updatedSlot.day_of_week,
        timeSlot: updatedSlot.time_slot,
        room: updatedSlot.room,
        teacherName: updatedSlot.teacher_name,
        location: updatedSlot.location_address
          ? `${updatedSlot.location} (${updatedSlot.location_address})`
          : updatedSlot.location
      }).catch(e => console.warn("Email dispatch note:", e));
    }

    return res.status(200).json({
      success: true,
      message: `Student '${student_name}' successfully assigned to schedule slot '${updatedSlot.course_name} (${updatedSlot.day_of_week} ${updatedSlot.time_slot})'.`,
      data: updatedSlot
    });
  } catch (err: any) {
    return res.status(500).json({ success: false, error: err.message });
  }
});

// 8a-2. Enroll multiple students in a class slot with capacity & collision checks
router.post("/:id/enroll-students", async (req: Request, res: Response): Promise<any> => {
  try {
    const id = String(req.params.id);
    const student_ids = Array.isArray(req.body.student_ids)
      ? req.body.student_ids
      : (req.body.students ? req.body.students.map((s: any) => s.student_id || s.id) : []);

    if (!student_ids || student_ids.length === 0) {
      return res.status(400).json({ success: false, error: "Please select at least one student to enroll." });
    }

    const result = await ScheduleDataService.enrollStudentsInSlot(id, student_ids);
    return res.status(200).json({
      success: true,
      message: `Enrolled student(s) successfully. Class cohort count is now ${result.enrolledCount}.`,
      data: result.slot
    });
  } catch (err: any) {
    const isBad = err.message?.includes("capacity limit") ||
                  err.message?.includes("Collision") ||
                  err.message?.includes("not found");
    return res.status(isBad ? 400 : 500).json({ success: false, error: err.message });
  }
});

// 8b. Unassign a student from a specific schedule slot
router.post("/unassign-student", async (req: Request, res: Response): Promise<any> => {
  try {
    const { schedule_id, student_id, student_code } = req.body;
    if (!schedule_id || !student_id) {
      return res.status(400).json({
        success: false,
        error: "Missing required fields: schedule_id and student_id are required."
      });
    }

    const updatedSlot = await ScheduleDataService.unassignStudentFromSlot({
      schedule_id,
      student_id,
      student_code
    });

    return res.status(200).json({
      success: true,
      message: `Student successfully unassigned from schedule slot.`,
      data: updatedSlot
    });
  } catch (err: any) {
    return res.status(500).json({ success: false, error: err.message });
  }
});

// 8c. Sync all schedule slots for a student
router.post("/sync-student-slots", async (req: Request, res: Response): Promise<any> => {
  try {
    const { student_id, student_name, student_code, parent_email, schedule_ids } = req.body;
    if (!student_id || !student_name) {
      return res.status(400).json({
        success: false,
        error: "Missing required fields: student_id and student_name are required."
      });
    }

    await ScheduleDataService.syncStudentSlots({
      student_id,
      student_name,
      student_code,
      parent_email,
      schedule_ids: Array.isArray(schedule_ids) ? schedule_ids : []
    });

    return res.status(200).json({
      success: true,
      message: `Schedule slots synced successfully for student '${student_name}'.`
    });
  } catch (err: any) {
    return res.status(500).json({ success: false, error: err.message });
  }
});

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
  const adminEmail = process.env.ADMIN_EMAIL || process.env.GMAIL_SENDER_EMAIL || "tglbiz101@gmail.com";
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
    const adminEmail = process.env.ADMIN_EMAIL || process.env.GMAIL_SENDER_EMAIL || "tglbiz101@gmail.com";
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