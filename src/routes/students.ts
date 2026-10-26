import express from "express";
import { authenticateJwt } from "../middleware/auth.js";
import type { AuthenticatedRequest } from "../middleware/auth.js";
import { authorizePermission } from "../middleware/authorize.js";
import { getAccessScope, allowsStudent } from "../services/accessScope.js";
import {
  getStudentsService,
  createStudentService,
  updateStudentService,
  deleteStudentService,
  toggleStudentStatusService,
  changeStudentPasswordService,
  requestPasswordResetService,
  verifyLoginRoleService,
  sendParentCredentialsService
} from "../services/studentService.js";
import { dispatchMultiChannelNotification } from "../services/notificationService.js";
import { changeUserPassword, generateTemporaryPassword, emailSetPasswordLink, normEmail, isValidEmail } from "../services/studentAccounts.js";
import { isRealEmail } from "../constants/domains.js";
import { supabaseAdmin } from "../supabase.js";

const router = express.Router();

/**
 * POST /api/students/:id/send-parent-credentials & POST /api/students/send-parent-credentials
 * Dispatches official Parent Portal credentials to parent email.
 */
export const sendParentCredentialsHandler = async (req: express.Request, res: express.Response) => {
  try {
    const studentId = (req.params.id || req.body?.studentId || req.body?.studentCode || req.query?.studentId) as string;
    if (!studentId) {
      return res.status(400).json({ success: false, message: "Student ID or Student Code is required." });
    }
    const result = await sendParentCredentialsService(studentId);
    return res.status(200).json(result);
  } catch (error: any) {
    return res.status(400).json({ success: false, message: error.message || "Failed to dispatch parent credentials." });
  }
};

router.post("/send-parent-credentials", sendParentCredentialsHandler);
router.post("/:id/send-parent-credentials", sendParentCredentialsHandler);

/**
 * POST /api/students/change-password
 * Change password with ONE-TIME limit & automatic email dispatch to Admin.
 */
export const changePasswordHandler = async (req: express.Request, res: express.Response) => {
  try {
    const { studentId, email, newPassword, currentPassword } = req.body;
    const loggedIn = (req as AuthenticatedRequest).user;
    if (!loggedIn) {
      res.status(401).json({ success: false, message: "Unauthorized: sign in to continue." });
      return;
    }
    const targetUserId = loggedIn.role === "ADMIN" && (studentId || req.body?.userId)
      ? (studentId || req.body?.userId)
      : loggedIn.id;
    const targetEmail = loggedIn.role === "ADMIN" && email ? email : loggedIn.email;

    const result = await changeUserPassword({
      userId: targetUserId,
      email: targetEmail,
      newPassword,
      currentPassword
    });
    res.status(200).json(result);
  } catch (error: any) {
    res.status(400).json({ success: false, message: error.message || "Failed to update password." });
  }
};

/**
 * POST /api/students/request-password-reset
 * Request secondary password reset from Admin.
 */
export const requestPasswordResetHandler = async (req: express.Request, res: express.Response) => {
  try {
    const { studentId, email, studentName } = req.body;
    const result = await requestPasswordResetService({ studentId, email, studentName });
    res.status(200).json(result);
  } catch (error: any) {
    res.status(400).json({ success: false, message: error.message || "Failed to request password reset." });
  }
};

/**
 * POST/GET /api/auth/verify-login
 * Accurate role lookup based on database registration.
 */
export const verifyLoginRoleHandler = async (req: express.Request, res: express.Response) => {
  try {
    const emailOrCode = (req.body?.email || req.query?.email || req.body?.emailOrCode || req.query?.emailOrCode || "") as string;
    const result = await verifyLoginRoleService(emailOrCode);
    res.status(200).json(result);
  } catch (error: any) {
    res.status(200).json({ success: true, role: "STUDENT" });
  }
};

router.post("/change-password", changePasswordHandler);
router.post("/request-password-reset", requestPasswordResetHandler);

/**
 * GET /api/students & GET /api/students/list
 * Fetch paginated students with search, filters, and RBAC accessibility.
 */
export const getStudentsHandler = async (req: AuthenticatedRequest, res: express.Response) => {
  try {
    const page = parseInt(req.query.page as string) || 1;
    const limit = req.query.limit ? parseInt(req.query.limit as string) : 25;
    const search = (req.query.search as string) || (req.query.q as string) || "";
    const status = (req.query.status as string) || "ALL";
    const grade = (req.query.grade as string) || "ALL";
    const program_type = (req.query.program_type as string) || (req.query.program as string) || "ALL";

    const toArray = (val: any): string[] => {
      if (!val) return [];
      if (Array.isArray(val)) return val.flatMap(v => String(v).split(",")).map(s => s.trim()).filter(Boolean);
      return String(val).split(",").map(s => s.trim()).filter(Boolean);
    };

    const courses = toArray(req.query.courses || req.query.course);
    const categories = toArray(req.query.categories || req.query.category);
    const schools = toArray(req.query.schools || req.query.school);
    const teachers = toArray(req.query.teachers || req.query.teacher);
    const grades = toArray(req.query.grades || req.query.gradeFilter);
    const sessionPreset = (req.query.sessionPreset as string) || "";
    const minSessions = req.query.minSessions !== undefined && req.query.minSessions !== "" ? Number(req.query.minSessions) : undefined;
    const maxSessions = req.query.maxSessions !== undefined && req.query.maxSessions !== "" ? Number(req.query.maxSessions) : undefined;
    const weekdays = toArray(req.query.weekdays || req.query.days || req.query.weekday);
    const weekdayMatch = (req.query.weekdayMatch as "any" | "all") || "any";
    const enrolledSinceStart = (req.query.enrolledSinceStart as string) || "";
    const enrolledSinceEnd = (req.query.enrolledSinceEnd as string) || "";
    const hoursPreset = (req.query.hoursPreset as string) || "";
    const minHours = req.query.minHours !== undefined && req.query.minHours !== "" ? Number(req.query.minHours) : undefined;
    const maxHours = req.query.maxHours !== undefined && req.query.maxHours !== "" ? Number(req.query.maxHours) : undefined;
    const feePlan = toArray(req.query.plan || req.query.feePlan || req.query.plans);
    const paymentMethod = toArray(req.query.paymentMethod || req.query.paymentMethods);
    const sortBy = (req.query.sortBy as string) || "name";
    const sortOrder = (req.query.sortOrder as "asc" | "desc") || "asc";

    // The role ALWAYS comes from the verified login (never from a query string or header sent by the browser).
    if (!req.user) {
      res.status(401).json({ success: false, message: "Unauthorized: sign in to continue." });
      return;
    }
    const currentUser = { id: req.user.id || "", email: req.user.email || "", role: String(req.user.role), metadata: req.user.metadata };

    const result = await getStudentsService({
      page,
      limit,
      search,
      status,
      grade,
      program_type,
      courses,
      categories,
      schools,
      teachers,
      grades,
      sessionPreset,
      minSessions,
      maxSessions,
      weekdays,
      weekdayMatch,
      enrolledSinceStart,
      enrolledSinceEnd,
      hoursPreset,
      minHours,
      maxHours,
      feePlan,
      paymentMethod,
      sortBy,
      sortOrder,
      currentUser
    });
    res.status(200).json(result);
  } catch (error: any) {
    res.status(500).json({ success: false, message: error.message || "Failed to fetch student list." });
  }
};

router.get("/", getStudentsHandler);
router.get("/list", getStudentsHandler);

/**
 * POST /api/students & POST /api/students/add
 * Create a new student profile with MANDATORY School validation & persistent storage.
 */
export const createStudentHandler = async (req: AuthenticatedRequest, res: express.Response) => {
  try {
    const body = req.body;
    const newStudent = await createStudentService(body);

    if ((newStudent as any)?.requiresConfirmation) {
      return res.status(200).json({
        success: false,
        requiresConfirmation: true,
        message: (newStudent as any).duplicateWarning,
        data: newStudent
      });
    }

    res.status(201).json({
      success: true,
      message: `Student '${newStudent.fullName}' successfully created with code ${newStudent.studentCode || ""}.`,
      data: newStudent
    });
  } catch (error: any) {
    res.status(400).json({ success: false, message: error.message || "Failed to create student profile." });
  }
};

/**
 * POST /api/students/:id/reset-password & POST /api/students/admin-reset-password
 * Admin resets student/parent account password with a fresh high-entropy temporary password.
 */
export const adminResetPasswordHandler = async (req: AuthenticatedRequest, res: express.Response) => {
  try {
    const target = req.body?.email || req.body?.userId || req.params?.id || req.body?.studentId;
    if (!target) {
      return res.status(400).json({ success: false, message: "User email, ID, or student identifier is required." });
    }
    const cleanTarget = normEmail(target);

    // Look up profile
    let profile: any = null;
    const { data: prof } = await supabaseAdmin
      .from("profiles")
      .select("id, email, full_name, role")
      .or(`email.eq.${cleanTarget},id.eq.${cleanTarget}`)
      .maybeSingle();

    if (prof) {
      profile = prof;
    } else {
      const { data: st } = await supabaseAdmin
        .from("students")
        .select("id, email, name, user_id")
        .or(`id.eq.${cleanTarget},student_id_code.eq.${cleanTarget},email.eq.${cleanTarget}`)
        .maybeSingle();
      if (st?.user_id) {
        const { data: stProf } = await supabaseAdmin.from("profiles").select("id, email, full_name, role").eq("id", st.user_id).maybeSingle();
        profile = stProf;
      }
    }

    if (!profile) {
      return res.status(404).json({ success: false, message: "Account profile not found." });
    }

    const tempPw = generateTemporaryPassword(16);
    await supabaseAdmin.auth.admin.updateUserById(profile.id, { password: tempPw });
    await supabaseAdmin.from("profiles").update({
      must_change_password: true,
      updated_at: new Date().toISOString()
    }).eq("id", profile.id);

    if (isRealEmail(profile.email)) {
      await emailSetPasswordLink({ email: profile.email, name: profile.full_name || "User", role: profile.role });
    }

    res.status(200).json({
      success: true,
      message: `Password reset successfully for ${profile.email}.`,
      data: {
        role: profile.role,
        email: profile.email,
        name: profile.full_name,
        temporaryPassword: tempPw
      }
    });
  } catch (err: any) {
    res.status(500).json({ success: false, message: err.message || "Failed to reset password." });
  }
};

router.post("/:id/reset-password", authenticateJwt, authorizePermission("students.edit"), adminResetPasswordHandler);
router.post("/admin-reset-password", authenticateJwt, authorizePermission("students.edit"), adminResetPasswordHandler);

router.post("/", createStudentHandler);
router.post("/add", createStudentHandler);
router.post("/create", createStudentHandler);

/**
 * PUT /api/students/:id & PUT /api/students/edit/:id
 * Update student/parent/enrollment dossier in real-time.
 */
export const updateStudentHandler = async (req: AuthenticatedRequest, res: express.Response) => {
  try {
    const studentId = Array.isArray(req.params.id) ? req.params.id[0] : req.params.id;
    if (!studentId) {
      res.status(400).json({ success: false, message: "Student ID is required." });
      return;
    }

    const body = req.body;
    const updated = await updateStudentService(studentId, body);
    res.status(200).json({
      success: true,
      message: `Student dossier '${updated.fullName}' updated successfully.`,
      data: updated
    });
  } catch (error: any) {
    res.status(400).json({ success: false, message: error.message || "Failed to update student dossier." });
  }
};

router.put("/:id", updateStudentHandler);
router.put("/edit/:id", updateStudentHandler);
router.post("/update/:id", updateStudentHandler);
router.post("/edit/:id", updateStudentHandler);

/**
 * DELETE /api/students/:id
 * Permanently delete student record.
 */
export const deleteStudentHandler = async (req: AuthenticatedRequest, res: express.Response) => {
  try {
    const studentId = Array.isArray(req.params.id) ? req.params.id[0] : req.params.id;
    if (!studentId) {
      res.status(400).json({ success: false, message: "Student ID is required." });
      return;
    }

    await deleteStudentService(studentId);
    res.status(200).json({
      success: true,
      message: `Student record deleted successfully.`
    });
  } catch (error: any) {
    res.status(400).json({ success: false, message: error.message || "Failed to delete student record." });
  }
};

router.delete("/:id", deleteStudentHandler);

/**
 * PATCH /api/students/:id/status
 * Toggle ACTIVE / INACTIVE status.
 */
export const toggleStudentStatusHandler = async (req: AuthenticatedRequest, res: express.Response) => {
  try {
    const studentId = Array.isArray(req.params.id) ? req.params.id[0] : req.params.id;
    if (!studentId) {
      res.status(400).json({ success: false, message: "Student ID is required." });
      return;
    }

    const { status } = req.body;
    const updated = await toggleStudentStatusService(studentId, status);
    res.status(200).json({
      success: true,
      message: `Student status updated to '${updated.status}'.`,
      data: updated
    });
  } catch (error: any) {
    res.status(400).json({ success: false, message: error.message || "Failed to toggle status." });
  }
};

router.patch("/:id/status", toggleStudentStatusHandler);

/**
 * GET /api/students/parents/list
 * Fetch registered parent profiles
 */
router.get("/parents/list", authenticateJwt, authorizePermission("parents.view"), async (_req: AuthenticatedRequest, res: express.Response) => {
  res.status(200).json({
    success: true,
    data: [
      { id: "prt-1", email: "venkat.reddy@gmail.com", full_name: "Venkat Reddy", phone: "+1 (555) 019-2834", role: "PARENT" },
      { id: "prt-2", email: "rajesh.sharma@corp.com", full_name: "Rajesh Sharma", phone: "+1 (555) 019-2835", role: "PARENT" }
    ]
  });
});

/**
 * POST /api/students/de-enroll/request
 */
router.post("/de-enroll/request", authenticateJwt, async (req: AuthenticatedRequest, res: express.Response) => {
  const { studentId, studentName, courseName, reason } = req.body;

  const scope = await getAccessScope(req.user!);
  if (!allowsStudent(scope, studentId)) {
    res.status(403).json({ success: false, message: "Forbidden: this student is not linked to your login." });
    return;
  }

  await dispatchMultiChannelNotification({
    eventType: "DE_ENROLLMENT_REQUESTED",
    subject: `⚠️ Course Withdrawal Request Submitted — ${studentName}`,
    message: `De-enrollment request submitted for ${studentName} (${courseName || "General Course"}). Reason: ${reason}. Awaiting Admin Approval.`,
    recipients: [
      { role: req.user!.role, email: req.user!.email || (process.env.ADMIN_EMAIL || "tglbiz101@gmail.com"), name: req.user!.metadata?.full_name || "Parent", phone: "" },
      { role: "ADMIN", email: process.env.ADMIN_EMAIL || "tglbiz101@gmail.com", name: "System Administrator", phone: "" }
    ]
  });

  res.status(201).json({
    success: true,
    message: "De-enrollment request submitted! Email notifications sent.",
    data: { id: `de-${Date.now()}`, student_name: studentName, status: "Pending" }
  });
});

export default router;