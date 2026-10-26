import express from "express";
import { supabaseAdmin } from "../supabase.js";
import { authenticateJwt, requireRoles } from "../middleware/auth.js";
import { getAccessScope, allowsTeacher, scopeSchedules, publicTeacherView } from "../services/accessScope.js";
import type { AuthenticatedRequest } from "../middleware/auth.js";
import { authorizePermission } from "../middleware/authorize.js";
import { dispatchMultiChannelNotification } from "../services/notificationService.js";
import { ScheduleDataService } from "../services/scheduleDataService.js";
import { resolveTeacherIdentity } from "../services/teacherIdentity.js";
import { ensureLogin, emailSetPasswordLink, generateTemporaryPassword, isValidEmail, normEmail } from "../services/studentAccounts.js";
import { isRealEmail } from "../constants/domains.js";

const router = express.Router();

// GET: List teachers strictly from Supabase.
// Admin: all details.
// Teacher: own record only.
// Parent / student: only the teachers of their own classes (publicTeacherView: name and subject only).
export const getTeachersHandler = async (req: express.Request, res: express.Response) => {
  let list: any[] = [];
  try {
    const { data, error } = await supabaseAdmin
      .from("teachers")
      .select("*")
      .order("name", { ascending: true });

    if (!error && data && data.length > 0) {
      list = [...data];
    }
  } catch (err) {
    console.warn("Notice querying Supabase teachers in getTeachersHandler:", err);
  }
  list.sort((a: any, b: any) => (a.name || "").localeCompare(b.name || "", undefined, { sensitivity: "base" }));

  const user = (req as AuthenticatedRequest).user;
  if (!user) {
    return res.status(401).json({ success: false, message: "Unauthorized: sign in to continue." });
  }

  if (user.role === "TEACHER") {
    const scope = await getAccessScope(user);
    list = list.filter(t => allowsTeacher(scope, t.id, t.teacher_id_code, t.email, t.user_id));
  } else if (user.role === "PARENT" || user.role === "STUDENT") {
    const scope = await getAccessScope(user);
    const slots = scopeSchedules(await ScheduleDataService.listSchedules(), scope);
    const ids = new Set<string>();
    const names = new Set<string>();
    for (const s of slots as any[]) {
      if (s.teacher_id) ids.add(String(s.teacher_id).trim().toLowerCase());
      if (s.teacher_name) names.add(String(s.teacher_name).trim().toLowerCase());
    }
    list = list
      .filter(t =>
        ids.has(String(t.id ?? "").toLowerCase()) ||
        ids.has(String(t.teacher_id_code ?? "").toLowerCase()) ||
        names.has(String(t.name ?? "").trim().toLowerCase())
      )
      .map(publicTeacherView);
  }

  return res.status(200).json({ success: true, count: list.length, data: list });
};

/** A teacher may open only their own records; the admin may open anyone's. */
async function teacherSelfOrAdmin(req: express.Request, res: express.Response, teacherKey: string): Promise<boolean> {
  const user = (req as AuthenticatedRequest).user;
  if (!user) {
    res.status(401).json({ success: false, message: "Unauthorized: sign in to continue." });
    return false;
  }
  if (user.role === "ADMIN") return true;
  if (user.role === "TEACHER") {
    const scope = await getAccessScope(user);
    if (allowsTeacher(scope, teacherKey)) return true;
  }
  res.status(403).json({ success: false, message: "Forbidden: you can only open your own teacher records." });
  return false;
}

router.get("/list", getTeachersHandler);
router.get("/", getTeachersHandler);

// POST: Add new faculty teacher profile in Supabase
export const createTeacherHandler = async (req: express.Request, res: express.Response) => {
  const t = req.body;
  const uniqueId = t.teacher_id_code || `TG-FAC-${Math.floor(100 + Math.random() * 900)}`;

  if (!t.name || !t.name.trim()) {
    return res.status(400).json({ success: false, message: "Teacher name is required." });
  }

  const cleanEmail = normEmail(t.email);
  if (!cleanEmail || !isValidEmail(cleanEmail)) {
    return res.status(400).json({ success: false, message: "Teacher official email is mandatory and must be a valid email format." });
  }

  const cleanSlots = (t.availabilitySlots || ["Morning - 09:00 AM - 12:00 PM", "Afternoon - 01:00 PM - 04:00 PM"])
    .map((s: string) => s.replace(/\(|\)/g, "").replace(/\s*-\s*/, " - ").trim())
    .filter((s: string) => !s.toLowerCase().includes("night"));

  const newTeacher: any = {
    teacher_id_code: uniqueId,
    name: t.name.trim(),
    dob: t.dateOfBirth || null,
    age: parseInt(t.age) || 0,
    qualification: t.qualification || null,
    qualification_certificate_url: t.qualificationCertificateUrl || null,
    resume_url: t.resumeUrl || null,
    photo_url: t.photoUrl || null,
    phone: t.phone || null,
    email: cleanEmail,
    specialization: t.specialization || null,
    experience: t.experience || null,
    joining_date: t.joiningDate || new Date().toISOString().split("T")[0],
    salary: t.salary || "$55,000",
    status: "Active",
    working_days_count: t.workingDaysCount || (t.availabilityDays?.length || 5),
    availability_days: t.availabilityDays || ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday"],
    availability_slots: cleanSlots
  };

  let savedTeacher: any = newTeacher;
  let createdLogins: Array<{ role: string; email: string; name: string; temporaryPassword: string }> = [];

  // Supabase Database & Auth sync using ensureLogin
  try {
    const loginRes = await ensureLogin({
      email: cleanEmail,
      fullName: newTeacher.name,
      role: "TEACHER",
      phone: newTeacher.phone,
      mustChangePassword: true,
      metadata: { teacher_id_code: uniqueId }
    });

    if (loginRes.userId) newTeacher.user_id = loginRes.userId;

    if (loginRes.created && loginRes.temporaryPassword) {
      createdLogins.push({
        role: "TEACHER",
        email: cleanEmail,
        name: newTeacher.name,
        temporaryPassword: loginRes.temporaryPassword
      });
      // Send set-password link without logging or printing password
      await emailSetPasswordLink({ email: cleanEmail, name: newTeacher.name, role: "TEACHER" });
    }

    const { data: inserted, error: tUpsertErr } = await supabaseAdmin
      .from("teachers")
      .upsert(newTeacher, { onConflict: "teacher_id_code" })
      .select()
      .single();

    if (tUpsertErr) {
      console.warn("Supabase teacher upsert error:", tUpsertErr.message);
    } else if (inserted) {
      savedTeacher = inserted;
    }
  } catch (error: any) {
    return res.status(400).json({ success: false, message: error.message || "Failed to add teacher profile." });
  }

  // Automatic Email Dispatch to Teacher and Admin
  try {
    const recipients: Array<{ role: "TEACHER" | "ADMIN"; email: string; name: string }> = [
      { role: "ADMIN", email: process.env.ADMIN_EMAIL || "tglbiz101@gmail.com", name: "TopGrade Admin" },
      { role: "TEACHER", email: cleanEmail, name: newTeacher.name }
    ];

    await dispatchMultiChannelNotification({
      recipients: recipients as any,
      subject: `🎉 Welcome to TopGrade Faculty: ${newTeacher.name} [ID: ${uniqueId}]`,
      message: `A new faculty instructor profile has been registered in the TopGrade CRM system.\n\n` +
               `Faculty Details:\n` +
               `• Teacher Name: ${newTeacher.name}\n` +
               `• Teacher ID: ${uniqueId}\n` +
               `• Specialization: ${newTeacher.specialization || "General"}\n` +
               `• Official Email: ${newTeacher.email}\n` +
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
    message: `Teacher '${newTeacher.name}' added successfully!`,
    data: savedTeacher,
    createdLogins
  });
};

/**
 * POST /api/teachers/:id/reset-password
 * Admin generates new unique temporary password for a faculty teacher.
 */
export const adminResetTeacherPasswordHandler = async (req: AuthenticatedRequest, res: express.Response) => {
  try {
    const teacherId = String(Array.isArray(req.params.id) ? req.params.id[0] : req.params.id || req.body?.id || req.body?.email);
    if (!teacherId) {
      return res.status(400).json({ success: false, message: "Teacher identifier or email is required." });
    }

    const { data: teacher } = await supabaseAdmin
      .from("teachers")
      .select("id, name, email, user_id, teacher_id_code")
      .or(`id.eq.${teacherId},teacher_id_code.eq.${teacherId},email.eq.${teacherId}`)
      .maybeSingle();

    if (!teacher || !teacher.email) {
      return res.status(404).json({ success: false, message: "Teacher account not found." });
    }

    const tempPw = generateTemporaryPassword(16);
    let targetUserId = teacher.user_id;

    if (!targetUserId) {
      const { data: prof } = await supabaseAdmin.from("profiles").select("id").eq("email", normEmail(teacher.email)).maybeSingle();
      targetUserId = prof?.id;
    }

    if (targetUserId) {
      await supabaseAdmin.auth.admin.updateUserById(targetUserId, { password: tempPw });
      await supabaseAdmin.from("profiles").update({
        must_change_password: true,
        updated_at: new Date().toISOString()
      }).eq("id", targetUserId);
    }

    if (isRealEmail(teacher.email)) {
      await emailSetPasswordLink({ email: teacher.email, name: teacher.name, role: "TEACHER" });
    }

    res.status(200).json({
      success: true,
      message: `Password reset successfully for teacher ${teacher.name}.`,
      data: {
        role: "TEACHER",
        email: teacher.email,
        name: teacher.name,
        temporaryPassword: tempPw
      }
    });
  } catch (err: any) {
    res.status(500).json({ success: false, message: err.message || "Failed to reset teacher password." });
  }
};

router.post("/:id/reset-password", authenticateJwt, authorizePermission("teachers.edit"), adminResetTeacherPasswordHandler);
router.post("/create", createTeacherHandler);
router.post("/add", createTeacherHandler);
router.post("/", createTeacherHandler);

// PUT: Update faculty teacher profile in Supabase
export const updateTeacherHandler = async (req: express.Request, res: express.Response) => {
  const teacherId = String(Array.isArray(req.params.id) ? req.params.id[0] : req.params.id);
  const t = req.body;

  if (!teacherId) {
    return res.status(400).json({ success: false, message: "Teacher ID is required." });
  }

  const isUUID = (str?: any): boolean =>
    typeof str === "string" && /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(str);

  const authReq = req as AuthenticatedRequest;
  const loggedInUser = authReq.user;

  let currentTeacher: any = null;
  try {
    let sbQuery = supabaseAdmin.from("teachers").select("*");
    if (isUUID(teacherId)) {
      sbQuery = sbQuery.or(`id.eq.${teacherId},user_id.eq.${teacherId}`);
    } else {
      sbQuery = sbQuery.or(`teacher_id_code.eq.${teacherId},id.eq.${teacherId}`);
    }
    const { data: sbTeacher } = await sbQuery.maybeSingle();
    if (sbTeacher) {
      currentTeacher = sbTeacher;
    } else {
      const targetEmail = t.email || loggedInUser?.email;
      if (targetEmail) {
        const { data: sbByEmail } = await supabaseAdmin.from("teachers").select("*").eq("email", targetEmail).maybeSingle();
        if (sbByEmail) currentTeacher = sbByEmail;
      }
      if (!currentTeacher && loggedInUser?.id) {
        const { data: sbByUid } = await supabaseAdmin.from("teachers").select("*").eq("user_id", loggedInUser.id).maybeSingle();
        if (sbByUid) currentTeacher = sbByUid;
      }
    }
  } catch (sbErr) {
    console.warn("Notice querying teacher for update:", sbErr);
  }

  if (!currentTeacher && loggedInUser?.metadata?.full_name) {
    currentTeacher = {
      name: loggedInUser.metadata.full_name,
      email: loggedInUser.email,
      id: teacherId
    };
  }

  const updateRow: any = {
    updated_at: new Date().toISOString()
  };

  if (t.name !== undefined) updateRow.name = t.name;
  if (t.dateOfBirth !== undefined) updateRow.dob = t.dateOfBirth;
  if (t.age !== undefined) updateRow.age = parseInt(t.age) || 0;
  if (t.qualification !== undefined) updateRow.qualification = t.qualification;
  if (t.qualificationCertificateUrl !== undefined) updateRow.qualification_certificate_url = t.qualificationCertificateUrl;
  if (t.qualification_certificate_url !== undefined) updateRow.qualification_certificate_url = t.qualification_certificate_url;
  if (t.resumeUrl !== undefined) updateRow.resume_url = t.resumeUrl;
  if (t.resume_url !== undefined) updateRow.resume_url = t.resume_url;
  if (t.photoUrl !== undefined) updateRow.photo_url = t.photoUrl;
  if (t.photo_url !== undefined) updateRow.photo_url = t.photo_url;
  if (t.phone !== undefined) updateRow.phone = t.phone;
  if (t.email !== undefined) updateRow.email = t.email;
  if (t.specialization !== undefined) updateRow.specialization = t.specialization;
  if (t.experience !== undefined) updateRow.experience = t.experience;
  if (t.joiningDate !== undefined) updateRow.joining_date = t.joiningDate;
  if (t.joining_date !== undefined) updateRow.joining_date = t.joining_date;
  if (t.salary !== undefined) updateRow.salary = t.salary;
  if (t.status !== undefined) updateRow.status = t.status;
  if (t.workingDaysCount !== undefined) updateRow.working_days_count = t.workingDaysCount;
  if (t.working_days_count !== undefined) updateRow.working_days_count = t.working_days_count;
  if (t.availabilityDays !== undefined) updateRow.availability_days = t.availabilityDays;
  if (t.availability_days !== undefined) updateRow.availability_days = t.availability_days;
  if (t.availabilitySlots !== undefined) updateRow.availability_slots = t.availabilitySlots;
  if (t.availability_slots !== undefined) updateRow.availability_slots = t.availability_slots;

  // Teacher role cannot alter ID, email, salary, or status
  if (authReq.user?.role === "TEACHER") {
    delete updateRow.email;
    delete updateRow.teacher_id_code;
    delete updateRow.id;
    delete updateRow.salary;
    delete updateRow.status;
  }

  let updatedTeacher: any = { ...currentTeacher, ...updateRow };

  try {
    let filterColumn = isUUID(teacherId) ? "id" : "teacher_id_code";
    let filterVal = teacherId;
    if (currentTeacher?.id) {
      filterColumn = "id";
      filterVal = currentTeacher.id;
    }

    const { data: resData, error: updErr } = await supabaseAdmin
      .from("teachers")
      .update(updateRow)
      .eq(filterColumn, filterVal)
      .select()
      .single();

    if (!updErr && resData) {
      updatedTeacher = resData;
    }
  } catch (err: any) {
    console.warn("Notice Supabase teacher update:", err?.message);
  }

  res.status(200).json({
    success: true,
    message: `Teacher '${updatedTeacher?.name || teacherId}' updated successfully!`,
    data: updatedTeacher
  });
};

router.put("/edit/:id", updateTeacherHandler);
router.put("/:id", updateTeacherHandler);

// DELETE: Delete faculty teacher profile
export const deleteTeacherHandler = async (req: express.Request, res: express.Response) => {
  const teacherId = String(req.params.id);
  if (!teacherId) {
    return res.status(400).json({ success: false, message: "Teacher ID is required." });
  }

  const isUUID = (str?: string | null): boolean =>
    !!str && /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(str);

  let deletedTeacher: any = null;
  try {
    const { data: target } = await supabaseAdmin
      .from("teachers")
      .select("*")
      .or(`id.eq.${teacherId},teacher_id_code.eq.${teacherId}`)
      .maybeSingle();

    deletedTeacher = target;

    if (deletedTeacher?.id && isUUID(deletedTeacher.id)) {
      await supabaseAdmin.from("teachers").delete().eq("id", deletedTeacher.id);
    } else if (isUUID(teacherId)) {
      await supabaseAdmin.from("teachers").delete().eq("id", teacherId);
    }

    if (deletedTeacher?.teacher_id_code) {
      await supabaseAdmin.from("teachers").delete().eq("teacher_id_code", deletedTeacher.teacher_id_code);
    }
    if (!isUUID(teacherId)) {
      await supabaseAdmin.from("teachers").delete().eq("teacher_id_code", teacherId);
    }
    if (deletedTeacher?.email) {
      await supabaseAdmin.from("teachers").delete().eq("email", deletedTeacher.email);
      await supabaseAdmin.from("profiles").delete().eq("email", deletedTeacher.email);
    }
  } catch (err: any) {
    console.warn("Supabase teacher delete notice:", err?.message);
  }

  res.status(200).json({
    success: true,
    message: `Teacher '${deletedTeacher?.name || teacherId}' deleted successfully from workspace.`,
    data: deletedTeacher
  });
};

router.delete("/:id", deleteTeacherHandler);
router.delete("/delete/:id", deleteTeacherHandler);

// POST: Assign Course to Teacher
router.post("/assign-course", authenticateJwt, authorizePermission("teachers.edit"), async (req: AuthenticatedRequest, res) => {
  const { teacherId, teacherName, courseId, courseName, teacherEmail, weeklySessions } = req.body;

  const sessionsToAdd = parseInt(weeklySessions) || 4;
  const maxWeekly = 20;

  let assignedSessions = 18;
  const { data: targetTeacher } = await supabaseAdmin
    .from("teachers")
    .select("*")
    .or(`id.eq.${teacherId},name.eq.${teacherName}`)
    .maybeSingle();

  if (targetTeacher && targetTeacher.weekly_assigned_sessions !== undefined) {
    assignedSessions = targetTeacher.weekly_assigned_sessions;
  }

  const remainingBefore = maxWeekly - assignedSessions;

  if (sessionsToAdd > remainingBefore) {
    return res.status(409).json({
      success: false,
      message: `Workload Collision: ${teacherName} has only ${remainingBefore} weekly session(s) available. Cannot assign ${sessionsToAdd} new session(s).`,
      data: {
        teacherName,
        assignedSessions,
        maxWeekly,
        remainingBefore,
        requestedSessions: sessionsToAdd
      }
    });
  }

  const updatedAssigned = assignedSessions + sessionsToAdd;
  if (targetTeacher?.id) {
    await supabaseAdmin
      .from("teachers")
      .update({ weekly_assigned_sessions: updatedAssigned })
      .eq("id", targetTeacher.id);
  }

  const teacherEmailTarget = teacherEmail || targetTeacher?.email || "teacher@topgrade.edu";
  const adminEmail = process.env.ADMIN_EMAIL || "tglbiz101@gmail.com";

  try {
    await dispatchMultiChannelNotification({
      eventType: "TEACHER_ASSIGNMENT",
      subject: `📚 Course Assignment: ${courseName} — Response Required`,
      message: `Dear ${teacherName},\n\nYou have been assigned to teach: ${courseName}.\n\nAssigned Weekly Sessions: ${sessionsToAdd}\nCurrent Workload: ${updatedAssigned} / ${maxWeekly} sessions/week.\n\nPlease confirm your availability and accept this course assignment.\n\nBest Regards,\nTopGrade Learning Administration`,
      recipients: [
        { role: "TEACHER", email: teacherEmailTarget, name: teacherName },
        { role: "ADMIN", email: adminEmail, name: "Administrator" }
      ]
    });
  } catch (emailErr) {
    console.warn("Notice: Course assignment notification error:", emailErr);
  }

  res.status(200).json({
    success: true,
    message: `Course '${courseName}' assigned to ${teacherName} (${sessionsToAdd} sessions/wk). Notifications dispatched!`,
    data: {
      teacherName,
      courseName,
      weeklyAssignedSessions: updatedAssigned,
      weeklyMaxSessions: maxWeekly,
      workloadPercentage: Math.round((updatedAssigned / maxWeekly) * 100)
    }
  });
});

// POST: Teacher Responds to Course Assignment
router.post("/respond-course/:courseId", authenticateJwt, requireRoles("TEACHER"), async (req: AuthenticatedRequest, res) => {
  const { courseId } = req.params;
  const { teacherId, teacherName, action, courseName } = req.body;

  const adminEmail = process.env.ADMIN_EMAIL || "tglbiz101@gmail.com";
  try {
    await dispatchMultiChannelNotification({
      eventType: "TEACHER_ASSIGNMENT",
      subject: `Faculty Course Response: ${teacherName} ${action === "ACCEPT" ? "ACCEPTED" : "DECLINED"} ${courseName || courseId}`,
      message: `Teacher ${teacherName} has ${action === "ACCEPT" ? "ACCEPTED" : "DECLINED"} the assignment for course: ${courseName || courseId}.\n\nStatus recorded at ${new Date().toLocaleString()}.`,
      recipients: [
        { role: "ADMIN", email: adminEmail, name: "Administrator" }
      ]
    });
  } catch (e) {
    console.warn("Assignment response notification error:", e);
  }

  res.status(200).json({
    success: true,
    message: `Course assignment ${action}! Redirecting to class schedule...`
  });
});

// POST: Smart Faculty Matching Algorithm
router.post("/smart-match", authenticateJwt, requireRoles("ADMIN"), async (req: AuthenticatedRequest, res) => {
  try {
    let teachers: any[] = [];
    const { data } = await supabaseAdmin.from("teachers").select("*").eq("status", "Active");
    if (data && data.length > 0) teachers = data;

    const eligible = teachers.filter(t => {
      const maxSessions = t.weekly_max_sessions || 20;
      const assigned = t.weekly_assigned_sessions || 0;
      return assigned < maxSessions;
    });

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
router.post("/onboarding-waiver", authenticateJwt, requireRoles("TEACHER"), async (req: AuthenticatedRequest, res) => {
  const { teacherId, gdriveFolderUrl, photoWaiverSigned } = req.body;

  try {
    await supabaseAdmin.from("teachers").update({
      document_folder_submitted: !!gdriveFolderUrl,
      gdrive_folder_url: gdriveFolderUrl,
      photo_waiver_signed: !!photoWaiverSigned,
      photo_waiver_signed_at: new Date().toISOString()
    }).or(`id.eq.${teacherId},teacher_id_code.eq.${teacherId}`);

    const adminEmail = process.env.ADMIN_EMAIL || "tglbiz101@gmail.com";
    await dispatchMultiChannelNotification({
      eventType: "TEACHER_ASSIGNMENT",
      subject: `📋 Faculty Compliance Update: ${teacherId} Submitted Documents & Photo Waiver`,
      message: `Teacher ${teacherId} has signed the Digital Photo/Media Waiver and provided Google Drive documents:\nFolder URL: ${gdriveFolderUrl || "None provided"}\n\nCompliance records updated.`,
      recipients: [
        { role: "ADMIN", email: adminEmail, name: "Administrator" }
      ]
    });

    res.status(200).json({
      success: true,
      message: "Onboarding documents folder & digital media waiver recorded successfully!"
    });
  } catch (err: any) {
    res.status(500).json({ success: false, message: err.message });
  }
});

// Helper to estimate hours from time slot string (e.g., "04:00 PM - 05:30 PM")
function parseSlotHours(timeSlot?: string): number {
  if (!timeSlot || !timeSlot.includes("-")) return 1.0;
  try {
    const parts = timeSlot.split("-").map(p => p.trim());
    if (parts.length < 2 || !parts[0] || !parts[1]) return 1.0;
    const parseTime = (t: string) => {
      const match = t.match(/(\d+):(\d+)\s*(AM|PM)?/i);
      if (!match || !match[1] || !match[2]) return null;
      let h = parseInt(match[1], 10);
      const m = parseInt(match[2], 10);
      const ampm = match[3]?.toUpperCase();
      if (ampm === "PM" && h < 12) h += 12;
      if (ampm === "AM" && h === 12) h = 0;
      return h + m / 60;
    };
    const start = parseTime(parts[0]);
    const end = parseTime(parts[1]);
    if (start !== null && end !== null && end > start) {
      return Math.round((end - start) * 10) / 10;
    }
  } catch {}
  return 1.0;
}

// GET: Teacher Assigned Students (grouped by course)
router.get("/:id/assigned-students", async (req, res): Promise<any> => {
  try {
    const { id } = req.params;
    if (!(await teacherSelfOrAdmin(req, res, id))) return;

    const all = await ScheduleDataService.listSchedules();
    const { keys, names } = await resolveTeacherIdentity({ id, email: id });
    keys.add(id.toLowerCase());

    const teacherSlots = all.filter(s => {
      const sTeacherId = String(s.teacher_id || "").toLowerCase();
      const sTeacherName = String(s.teacher_name || "").toLowerCase();
      return keys.has(sTeacherId) || names.has(sTeacherName) || keys.has(sTeacherName);
    });

    const courseMap = new Map<string, Map<string, any>>();
    for (const slot of teacherSlots) {
      const courseName = slot.course_name || "General / Unassigned";
      if (!courseMap.has(courseName)) {
        courseMap.set(courseName, new Map());
      }
      const studentMap = courseMap.get(courseName)!;
      for (const st of slot.students || []) {
        const studentKey = st.student_id || st.student_code || st.student_name;
        if (!studentMap.has(studentKey)) {
          studentMap.set(studentKey, {
            student_id: st.student_id,
            student_name: st.student_name,
            student_code: st.student_code,
            slots: []
          });
        }
        studentMap.get(studentKey)!.slots.push({
          schedule_id: slot.id,
          day_of_week: slot.day_of_week,
          time_slot: slot.time_slot,
          room: slot.room,
          location: slot.location
        });
      }
    }

    const grouped: any[] = [];
    const uniqueStudentIds = new Set<string>();

    for (const [courseName, studentMap] of courseMap.entries()) {
      const studentsList = Array.from(studentMap.values()).sort((a, b) =>
        (a.student_name || "").localeCompare(b.student_name || "", undefined, { sensitivity: "base" })
      );
      studentsList.forEach(s => {
        if (s.student_id) uniqueStudentIds.add(s.student_id);
      });
      grouped.push({
        course_name: courseName,
        count: studentsList.length,
        students: studentsList
      });
    }

    grouped.sort((a, b) => a.course_name.localeCompare(b.course_name, undefined, { sensitivity: "base" }));

    return res.status(200).json({
      success: true,
      total_students: uniqueStudentIds.size,
      count: grouped.length,
      courses: grouped,
      data: grouped
    });
  } catch (err: any) {
    return res.status(500).json({ success: false, error: err.message });
  }
});

// GET: Teacher Assigned Students Roster
router.get("/:id/roster", async (req, res): Promise<any> => {
  try {
    const { id } = req.params;
    if (!(await teacherSelfOrAdmin(req, res, id))) return;
    const roster = await ScheduleDataService.getTeacherRoster(id);
    return res.status(200).json({ success: true, count: roster.length, data: roster });
  } catch (err: any) {
    return res.status(500).json({ success: false, error: err.message });
  }
});

// GET: Teacher History (classes taught per month, hours taught, courses taught)
router.get("/:id/history", async (req, res): Promise<any> => {
  try {
    const { id } = req.params;
    if (!(await teacherSelfOrAdmin(req, res, id))) return;

    const { keys, names } = await resolveTeacherIdentity({ id, email: id });
    keys.add(id.toLowerCase());

    // Fetch attendance marked by teacher or belonging to teacher
    let pastSessions: any[] = [];
    try {
      const orClauses: string[] = [];
      keys.forEach(k => orClauses.push(`marked_by.eq.${k}`));
      names.forEach(n => {
        orClauses.push(`marked_by.ilike.%${n}%`);
        orClauses.push(`marked_by_name.ilike.%${n}%`);
      });
      if (orClauses.length > 0) {
        const { data } = await supabaseAdmin
          .from("attendance")
          .select("*")
          .or(orClauses.join(","))
          .order("date", { ascending: false });
        if (data) pastSessions = data;
      }
    } catch {}

    // Fetch teacher slots to cross-reference course durations and courses taught
    const allSlots = await ScheduleDataService.listSchedules();
    const teacherSlots = allSlots.filter(s => {
      const sTeacherId = String(s.teacher_id || "").toLowerCase();
      const sTeacherName = String(s.teacher_name || "").toLowerCase();
      return keys.has(sTeacherId) || names.has(sTeacherName) || keys.has(sTeacherName);
    });

    const slotMap = new Map<string, any>(teacherSlots.map(s => [s.id, s]));
    const coursesTaughtSet = new Set<string>();
    teacherSlots.forEach(s => {
      if (s.course_name) coursesTaughtSet.add(s.course_name);
    });

    const sessions = pastSessions || [];
    const monthlyMap = new Map<string, { count: number; hours: number }>();
    let totalHoursTaught = 0;

    for (const s of sessions) {
      const courseName = s.course_name || s.class_name;
      if (courseName) coursesTaughtSet.add(courseName);

      const dateStr = s.date || s.created_at || new Date().toISOString();
      const monthKey = dateStr.slice(0, 7); // "YYYY-MM"

      let sessionHours = 1.0;
      if (s.check_in_time && s.check_out_time) {
        try {
          const diffMs = new Date(s.check_out_time).getTime() - new Date(s.check_in_time).getTime();
          if (diffMs > 0 && diffMs < 24 * 3600 * 1000) {
            sessionHours = Math.round((diffMs / (3600 * 1000)) * 10) / 10;
          }
        } catch {}
      } else if (s.schedule_id && slotMap.has(s.schedule_id)) {
        sessionHours = parseSlotHours(slotMap.get(s.schedule_id).time_slot);
      }

      totalHoursTaught += sessionHours;

      if (!monthlyMap.has(monthKey)) {
        monthlyMap.set(monthKey, { count: 0, hours: 0 });
      }
      const m = monthlyMap.get(monthKey)!;
      m.count += 1;
      m.hours = Math.round((m.hours + sessionHours) * 10) / 10;
    }

    // If there are schedule slots but no attendance records yet, provide current month projected/scheduled summary
    if (sessions.length === 0 && teacherSlots.length > 0) {
      const currentMonth = new Date().toISOString().slice(0, 7);
      let weeklyHours = 0;
      for (const slot of teacherSlots) {
        weeklyHours += parseSlotHours(slot.time_slot);
      }
      const projectedMonthHours = Math.round(weeklyHours * 4 * 10) / 10;
      const projectedClasses = teacherSlots.length * 4;
      monthlyMap.set(currentMonth, { count: projectedClasses, hours: projectedMonthHours });
      totalHoursTaught = projectedMonthHours;
    }

    const classesPerMonth = Array.from(monthlyMap.entries())
      .map(([month, data]) => ({
        month,
        classes_count: data.count,
        hours_taught: Math.round(data.hours * 10) / 10
      }))
      .sort((a, b) => b.month.localeCompare(a.month));

    const totalClassesTaught = sessions.length > 0 ? sessions.length : (monthlyMap.get(new Date().toISOString().slice(0, 7))?.count || 0);

    const historyPayload = {
      total_classes: totalClassesTaught,
      total_hours: Math.round(totalHoursTaught * 10) / 10,
      total_classes_taught: totalClassesTaught,
      total_hours_taught: Math.round(totalHoursTaught * 10) / 10,
      courses_taught: Array.from(coursesTaughtSet).sort(),
      monthly_breakdown: classesPerMonth,
      classes_per_month: classesPerMonth
    };

    return res.status(200).json({
      success: true,
      history: historyPayload,
      summary: historyPayload,
      data: historyPayload,
      count: sessions.length,
      sessions: sessions
    });
  } catch (err: any) {
    return res.status(500).json({ success: false, error: err.message });
  }
});

// PUT: Update Teacher Working Days & Shift Availability
router.put("/:id/availability", async (req, res): Promise<any> => {
  try {
    const { id } = req.params;
    if (!(await teacherSelfOrAdmin(req, res, id))) return;
    const { availabilityDays, availabilitySlots } = req.body;

    await supabaseAdmin.from("teachers").update({
      availability_days: availabilityDays,
      availability_slots: availabilitySlots
    }).or(`id.eq.${id},teacher_id_code.eq.${id}`);

    return res.status(200).json({
      success: true,
      message: "Teacher availability updated successfully.",
      data: {
        teacherId: id,
        availabilityDays,
        availabilitySlots
      }
    });
  } catch (err: any) {
    return res.status(500).json({ success: false, error: err.message });
  }
});

export default router;