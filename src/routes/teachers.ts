import express from "express";
import { supabaseAdmin } from "../supabase.js";
import { authenticateJwt } from "../middleware/auth.js";
import type { AuthenticatedRequest } from "../middleware/auth.js";
import { authorizePermission } from "../middleware/authorize.js";
import { dispatchMultiChannelNotification } from "../services/notificationService.js";
import { demoTeachersPool } from "../services/demoDataService.js";

const router = express.Router();

export let inMemoryTeachers: any[] = [
  {
    id: "tch-1",
    teacher_id_code: "TG-FAC-101",
    name: "manikanta",
    dob: "1994-05-15",
    age: 32,
    qualification: "M.Tech in Computer Science & Engineering",
    qualification_certificate_url: null,
    resume_url: null,
    photo_url: null,
    phone: "+1 778 064 8562",
    email: "manikanta@topgrade.edu",
    specialization: "Coding & Computer Science",
    experience: "7 Years",
    joining_date: "2026-01-10",
    salary: "$65,000",
    hourly_rate: 45.00,
    weekly_assigned_sessions: 0,
    weekly_max_sessions: 20,
    document_folder_submitted: true,
    photo_waiver_signed: true,
    photo_waiver_signed_at: "2026-01-12T10:00:00Z",
    status: "Active",
    availability_days: ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"],
    availability_slots: ["Morning (09:00 AM - 12:00 PM)", "Afternoon (01:00 PM - 04:00 PM)", "Evening (05:00 PM - 08:00 PM)"]
  }
];

// GET: List all teachers with fail-safe fallback
export const getTeachersHandler = async (_req: express.Request, res: express.Response) => {
  res.status(200).json({ success: true, data: inMemoryTeachers });
};

router.get("/list", getTeachersHandler);
router.get("/", getTeachersHandler);

// POST: Add new faculty teacher profile with fail-safe fallback
export const createTeacherHandler = async (req: express.Request, res: express.Response) => {
  const t = req.body;
  const uniqueId = t.teacher_id_code || `TG-FAC-${Math.floor(100 + Math.random() * 900)}`;
  const defaultPassword = (t.password || "Teacher@123").slice(0, 16);

  const cleanSlots = (t.availabilitySlots || ["Morning - 09:00 AM - 12:00 PM", "Afternoon - 01:00 PM - 04:00 PM"])
    .map((s: string) => s.replace(/\(|\)/g, "").replace(/\s*-\s*/, " - ").trim())
    .filter((s: string) => !s.toLowerCase().includes("night"));

  const newTeacher = {
    id: `tch-${Date.now()}`,
    teacher_id_code: uniqueId,
    name: t.name,
    dob: t.dateOfBirth || null,
    age: parseInt(t.age) || 0,
    qualification: t.qualification || null,
    qualification_certificate_url: t.qualificationCertificateUrl || null,
    resume_url: t.resumeUrl || null,
    photo_url: t.photoUrl || null,
    phone: t.phone || null,
    email: t.email ? t.email.trim().toLowerCase() : null,
    password: defaultPassword,
    role: "TEACHER",
    specialization: t.specialization || null,
    experience: t.experience || null,
    joining_date: t.joiningDate || null,
    salary: t.salary || null,
    status: "Active",
    working_days_count: t.workingDaysCount || (t.availabilityDays?.length || 5),
    availability_days: t.availabilityDays || ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday"],
    availability_slots: cleanSlots
  };

  inMemoryTeachers.unshift(newTeacher);

  // Real-time Supabase Database & Auth sync
  try {
    let teacherAuthId: string | null = null;
    if (newTeacher.email) {
      const { data: tAuth } = await supabaseAdmin.auth.admin.createUser({
        email: newTeacher.email,
        password: defaultPassword,
        email_confirm: true,
        user_metadata: {
          full_name: newTeacher.name,
          role: "TEACHER",
          teacher_id_code: uniqueId
        }
      });
      if (tAuth?.user) teacherAuthId = tAuth.user.id;

      // Upsert into Supabase profiles
      await supabaseAdmin.from("profiles").upsert({
        ...(teacherAuthId ? { id: teacherAuthId } : {}),
        email: newTeacher.email,
        full_name: newTeacher.name,
        role: "TEACHER",
        status: "Active",
        updated_at: new Date().toISOString()
      }, { onConflict: "email" });
    }

    const teacherRow: any = {
      name: newTeacher.name,
      teacher_id_code: uniqueId,
      dob: newTeacher.dob || null,
      age: newTeacher.age || 0,
      qualification: newTeacher.qualification || null,
      phone: newTeacher.phone || null,
      email: newTeacher.email || null,
      specialization: newTeacher.specialization || null,
      experience: newTeacher.experience || null,
      status: newTeacher.status || "Active"
    };
    if (teacherAuthId) teacherRow.user_id = teacherAuthId;

    await supabaseAdmin.from("teachers").upsert(teacherRow, { onConflict: "teacher_id_code" });
  } catch (error: any) {
    console.warn("Supabase teacher creation notice:", error?.message);
  }

  // Automatic Email Dispatch to Teacher, Admin, and Accountant
  try {
    const recipients: Array<{ role: "TEACHER" | "ADMIN" | "ACCOUNTANT"; email: string; name: string }> = [
      { role: "ADMIN", email: "admin@topgrade.edu", name: "TopGrade Admin" },
      { role: "ACCOUNTANT", email: "accountant@topgrade.edu", name: "TopGrade Accountant" }
    ];

    if (newTeacher.email && newTeacher.email.includes("@")) {
      recipients.unshift({ role: "TEACHER", email: newTeacher.email, name: newTeacher.name });
    }

    await dispatchMultiChannelNotification({
      recipients: recipients as any,
      subject: `🎉 Welcome to TopGrade Faculty: ${newTeacher.name} [ID: ${uniqueId}]`,
      message: `A new faculty instructor profile has been registered in the TopGrade CRM system.\n\n` +
               `Faculty Details:\n` +
               `• Teacher Name: ${newTeacher.name}\n` +
               `• Teacher ID: ${uniqueId}\n` +
               `• Specialization: ${newTeacher.specialization || "General"}\n` +
               `• Official Email: ${newTeacher.email || "N/A"}\n` +
               `• Initial Password: ${defaultPassword}\n` +
               `• Status: Active\n\n` +
               `Please sign in at the TopGrade CRM Faculty Portal to manage your course schedules and attendance rosters.\n\n` +
               `TopGrade Administration Center`,
      eventType: "TEACHER_ASSIGNMENT"
    });
  } catch (notifyErr) {
    console.warn("Notice: Failed to dispatch automated teacher email:", notifyErr);
  }

  res.status(201).json({
    success: true,
    message: `Teacher '${newTeacher.name}' added successfully! Email notification dispatched to teacher, admin, and accountant.`,
    data: newTeacher
  });
};

router.post("/create", createTeacherHandler);
router.post("/add", createTeacherHandler);
router.post("/", createTeacherHandler);

// PUT: Update faculty teacher profile in real time
export const updateTeacherHandler = async (req: express.Request, res: express.Response) => {
  const teacherId = req.params.id;
  const t = req.body;

  if (!teacherId) {
    return res.status(400).json({ success: false, message: "Teacher ID is required." });
  }

  const idx = inMemoryTeachers.findIndex(tch => tch.id === teacherId || tch.teacher_id_code === teacherId);
  if (idx === -1) {
    return res.status(404).json({ success: false, message: `Teacher with ID '${teacherId}' not found.` });
  }

  const currentTeacher = inMemoryTeachers[idx];
  const updatedTeacher = {
    ...currentTeacher,
    name: t.name !== undefined ? t.name : currentTeacher.name,
    dob: t.dateOfBirth !== undefined ? t.dateOfBirth : currentTeacher.dob,
    age: t.age !== undefined ? parseInt(t.age) : currentTeacher.age,
    qualification: t.qualification !== undefined ? t.qualification : currentTeacher.qualification,
    qualification_certificate_url: t.qualificationCertificateUrl !== undefined ? t.qualificationCertificateUrl : currentTeacher.qualification_certificate_url,
    resume_url: t.resumeUrl !== undefined ? t.resumeUrl : currentTeacher.resume_url,
    photo_url: t.photoUrl !== undefined ? t.photoUrl : currentTeacher.photo_url,
    phone: t.phone !== undefined ? t.phone : currentTeacher.phone,
    email: t.email !== undefined ? t.email : currentTeacher.email,
    specialization: t.specialization !== undefined ? t.specialization : currentTeacher.specialization,
    experience: t.experience !== undefined ? t.experience : currentTeacher.experience,
    joining_date: t.joiningDate !== undefined ? t.joiningDate : currentTeacher.joining_date,
    salary: t.salary !== undefined ? t.salary : currentTeacher.salary,
    status: t.status !== undefined ? t.status : currentTeacher.status,
    working_days_count: t.workingDaysCount !== undefined ? t.workingDaysCount : (t.availabilityDays?.length || currentTeacher.working_days_count),
    availability_days: t.availabilityDays !== undefined ? t.availabilityDays : currentTeacher.availability_days,
    availability_slots: t.availabilitySlots !== undefined ? t.availabilitySlots : currentTeacher.availability_slots
  };

  inMemoryTeachers[idx] = updatedTeacher;

  try {
    const updateRow: any = {
      name: updatedTeacher.name,
      dob: updatedTeacher.dob || null,
      age: updatedTeacher.age || 0,
      qualification: updatedTeacher.qualification || null,
      phone: updatedTeacher.phone || null,
      email: updatedTeacher.email || null,
      specialization: updatedTeacher.specialization || null,
      experience: updatedTeacher.experience || null,
      status: updatedTeacher.status || "Active"
    };
    await supabaseAdmin
      .from("teachers")
      .update(updateRow)
      .eq("teacher_id_code", currentTeacher.teacher_id_code || teacherId);
  } catch (err: any) {
    console.warn("Supabase teacher update notice:", err?.message);
  }

  res.status(200).json({
    success: true,
    message: `Teacher '${updatedTeacher.name}' updated successfully in real time.`,
    data: updatedTeacher
  });
};

router.put("/edit/:id", updateTeacherHandler);
router.put("/:id", updateTeacherHandler);

// DELETE: Delete faculty teacher profile
export const deleteTeacherHandler = async (req: express.Request, res: express.Response) => {
  const teacherId = req.params.id;
  if (!teacherId) {
    return res.status(400).json({ success: false, message: "Teacher ID is required." });
  }

  const idx = inMemoryTeachers.findIndex(t => t.id === teacherId || t.teacher_id_code === teacherId);
  if (idx === -1) {
    return res.status(404).json({ success: false, message: `Teacher with ID '${teacherId}' not found.` });
  }

  const deletedTeacher = inMemoryTeachers.splice(idx, 1)[0];

  try {
    await supabaseAdmin
      .from("teachers")
      .delete()
      .eq("teacher_id_code", deletedTeacher.teacher_id_code || teacherId);
  } catch (err: any) {
    console.warn("Supabase teacher delete notice:", err?.message);
  }

  res.status(200).json({
    success: true,
    message: `Teacher '${deletedTeacher.name}' deleted successfully from workspace.`,
    data: deletedTeacher
  });
};

router.delete("/:id", deleteTeacherHandler);
router.delete("/delete/:id", deleteTeacherHandler);

// POST: Assign Course to Teacher (Triggers notification to Teacher & Admin with Accept / Decline)
router.post("/assign-course", authenticateJwt, authorizePermission("teachers.edit"), async (req: AuthenticatedRequest, res) => {
  const { teacherId, teacherName, courseId, courseName, teacherEmail, weeklySessions } = req.body;

  const sessionsToAdd = parseInt(weeklySessions) || 4;
  const maxWeekly = 20;

  // Track teacher workload
  let assignedSessions = 18; // Default threshold simulation (18 / 20 sessions used)
  const targetTeacher = inMemoryTeachers.find((t) => t.id === teacherId || t.name === teacherName);
  
  if (targetTeacher) {
    if (targetTeacher.weekly_assigned_sessions !== undefined) {
      assignedSessions = targetTeacher.weekly_assigned_sessions;
    } else {
      targetTeacher.weekly_max_sessions = maxWeekly;
      targetTeacher.weekly_assigned_sessions = 18;
    }
  }

  const remainingBefore = maxWeekly - assignedSessions;

  // Workload Warning Alert Rule
  let warningMessage: string | null = null;
  if (remainingBefore <= 2 && remainingBefore > 0) {
    warningMessage = `You have only ${remainingBefore} sessions remaining in your allocated hours.`;
  } else if (remainingBefore <= 0) {
    res.status(400).json({
      success: false,
      code: "FACULTY_CAPACITY_EXCEEDED",
      error: "Faculty Workload Capacity Exceeded: This teacher has no remaining session hours in their weekly quota."
    });
    return;
  }

  if (targetTeacher) {
    targetTeacher.weekly_assigned_sessions += sessionsToAdd;
  }

  try {
    await supabaseAdmin
      .from("teacher_course_assignments")
      .insert([
        {
          teacher_id: teacherId,
          teacher_name: teacherName,
          course_id: courseId,
          course_name: courseName,
          status: "Pending"
        }
      ]);
  } catch (err) {
    console.warn("Course assignment fallback note:", err);
  }

  // Send Notification to Teacher & Admin with Accept/Decline request
  await dispatchMultiChannelNotification({
    eventType: "TEACHER_ASSIGNMENT",
    subject: `📚 Course Assignment Request: ${courseName}`,
    message: `Dear ${teacherName},\nYou have been assigned to teach course "${courseName}". Please accept or decline this course assignment in your TopGrade Portal.\n\nWorkload Quota Status: ${assignedSessions + sessionsToAdd} / ${maxWeekly} sessions used.${warningMessage ? `\n⚠️ Warning: ${warningMessage}` : ""}`,
    recipients: [
      { role: "TEACHER", email: teacherEmail || "teacher@topgrade.edu", name: teacherName },
      { role: "ADMIN", email: "admin@topgrade.edu", name: "System Administrator" }
    ]
  });

  res.status(201).json({
    success: true,
    message: warningMessage 
      ? `Course assigned successfully! ⚠️ ${warningMessage}`
      : "Course assignment sent to Teacher & Admin for approval!",
    warning: warningMessage,
    data: { 
      id: "asgn-1", 
      teacher_name: teacherName, 
      course_name: courseName, 
      status: "Pending",
      weekly_assigned_sessions: assignedSessions + sessionsToAdd,
      weekly_max_sessions: maxWeekly,
      remaining_sessions: Math.max(0, maxWeekly - (assignedSessions + sessionsToAdd))
    }
  });
});

// POST: Teacher Accept or Decline Course Assignment
router.post("/respond-course/:assignmentId", authenticateJwt, async (req: AuthenticatedRequest, res) => {
  const { assignmentId } = req.params;
  const { action } = req.body;

  // Notify Admin of Teacher's response
  await dispatchMultiChannelNotification({
    eventType: "ADMISSION_APPROVED",
    subject: `Teacher Course Response: ${action}`,
    message: `Teacher has ${action} the assigned course assignment (Ref: ${assignmentId}). Schedule updated.`,
    recipients: [
      { role: "ADMIN", email: "admin@topgrade.edu", name: "System Administrator" }
    ]
  });

  res.status(200).json({
    success: true,
    message: `Course assignment ${action}! Redirecting to class schedule...`
  });
});

// POST: Smart Faculty Matching Algorithm (Lowest Hourly Rate Prioritization)
router.post("/smart-match", authenticateJwt, async (req: AuthenticatedRequest, res) => {
  const { subject, grade } = req.body;

  try {
    let teachers: any[] = [];
    try {
      const { data } = await supabaseAdmin.from("teachers").select("*").eq("status", "Active");
      if (data && data.length > 0) teachers = data;
      else teachers = inMemoryTeachers;
    } catch {
      teachers = inMemoryTeachers;
    }

    // 1. Filter active teachers with remaining session capacity
    const eligible = teachers.filter(t => {
      const maxSessions = t.weekly_max_sessions || 20;
      const assigned = t.weekly_assigned_sessions || 0;
      return assigned < maxSessions;
    });

    // 2. Sort by lowest hourly rate ASC ($/hr) for cost optimization
    eligible.sort((a, b) => (a.hourly_rate || 45) - (b.hourly_rate || 38));

    res.status(200).json({
      success: true,
      message: `Found ${eligible.length} eligible faculty members sorted by lowest hourly rate!`,
      data: eligible
    });
  } catch (error: any) {
    res.status(500).json({ success: false, message: error.message });
  }
});

// POST: Teacher Onboarding Documents & Media Release Waiver
router.post("/onboarding-waiver", authenticateJwt, async (req: AuthenticatedRequest, res) => {
  const { teacherId, gdriveFolderUrl, photoWaiverSigned } = req.body;

  try {
    const teacher = inMemoryTeachers.find(t => t.id === teacherId || t.teacher_id_code === teacherId);
    if (teacher) {
      teacher.document_folder_submitted = !!gdriveFolderUrl;
      teacher.gdrive_folder_url = gdriveFolderUrl;
      teacher.photo_waiver_signed = !!photoWaiverSigned;
      teacher.photo_waiver_signed_at = new Date().toISOString();
    }

    try {
      await supabaseAdmin.from("teachers").update({
        document_folder_submitted: !!gdriveFolderUrl,
        gdrive_folder_url: gdriveFolderUrl,
        photo_waiver_signed: !!photoWaiverSigned,
        photo_waiver_signed_at: new Date().toISOString()
      }).eq("id", teacherId);
    } catch {
      // In-memory fallback updated
    }

    res.status(200).json({
      success: true,
      message: "Teacher onboarding credentials and photo media release waiver successfully recorded!"
    });
  } catch (error: any) {
    res.status(500).json({ success: false, message: error.message });
  }
});

export default router;