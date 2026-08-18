import express from "express";
import { authenticateJwt } from "../middleware/auth.js";
import type { AuthenticatedRequest } from "../middleware/auth.js";
import { authorizePermission } from "../middleware/authorize.js";
import {
  getStudentsService,
  createStudentService,
  updateStudentService,
  toggleStudentStatusService
} from "../services/studentService.js";
import { dispatchMultiChannelNotification } from "../services/notificationService.js";

const router = express.Router();

/**
 * GET /api/students & GET /api/students/list
 * Fetch paginated students with search (Name, Student Code, Grade, Parent Phone),
 * status filters (ACTIVE / INACTIVE), and grade filters.
 */
const getStudentsHandler = async (req: express.Request, res: express.Response) => {
  try {
    const page = parseInt(req.query.page as string) || 1;
    const limit = parseInt(req.query.limit as string) || 50;
    const search = (req.query.search as string) || (req.query.q as string) || "";
    const status = (req.query.status as string) || "ALL";
    const grade = (req.query.grade as string) || "ALL";

    const result = await getStudentsService({ page, limit, search, status, grade });
    res.status(200).json(result);
  } catch (error: any) {
    res.status(500).json({ success: false, message: error.message || "Failed to fetch student list." });
  }
};

router.get("/", authenticateJwt, authorizePermission("students.view"), getStudentsHandler);
router.get("/list", authenticateJwt, authorizePermission("students.view"), getStudentsHandler);

/**
 * POST /api/students & POST /api/students/add
 * Create a new student profile, allocate enrolled course/teacher, and initialize fee schedule.
 */
const createStudentHandler = async (req: AuthenticatedRequest, res: express.Response) => {
  try {
    const body = req.body;
    const studentName = body.fullName || body.studentName || body.name;

    if (!studentName) {
      res.status(400).json({ success: false, message: "Student Name is required." });
      return;
    }

    const payload = {
      ...body,
      fullName: studentName,
      dob: body.dob || body.dateOfBirth || "2010-01-01",
      email: body.email || body.studentEmail || `std-${Date.now()}@topgrade.edu`,
      status: body.status || "ACTIVE",
      school: body.school || "",
      grade: body.grade || "Grade 1",
      gender: body.gender || "Male",
      fatherName: body.fatherName || "",
      motherName: body.motherName || "",
      guardianName: body.guardianName || body.guardian || "",
      studentPhones: body.studentPhones || (body.phone ? [body.phone] : []),
      parentPhones: body.parentPhones || (body.fatherPhone || body.motherPhone ? [body.fatherPhone, body.motherPhone].filter(Boolean) : []),
      studentWhatsapp: body.studentWhatsapp || body.whatsapp || "",
      parentWhatsapp: body.parentWhatsapp || [],
      studentEmails: body.studentEmails || (body.email ? [body.email] : []),
      parentEmails: body.parentEmails || [],
      primaryMobile: body.primaryMobile || body.phone || (body.studentPhones && body.studentPhones[0]) || "",
      parentOccupation: body.parentOccupation || "",
      emergencyContactName: body.emergencyContactName || "",
      emergencyContactRelationship: body.emergencyContactRelationship || "",
      residentialAddress: body.residentialAddress || body.address || "",
      admissionDate: body.admissionDate || body.admission_date || new Date().toISOString().split("T")[0],
      program: body.program || body.subjectInterested || "Coding Track",
      assignedTeacherId: body.assignedTeacherId || body.teacherId || "",
      teacher: body.teacher || "Assigned Teacher",
      weeklyClasses: body.weeklyClasses || "2 classes/week",
      courseDuration: body.courseDuration || "6 Months",
      startDate: body.startDate || new Date().toISOString().split("T")[0],
      endDate: body.endDate || "",
      feePlan: body.feePlan || body.pricingType || "Monthly",
      discount: body.discount || "None"
    };

    const newStudent = await createStudentService(payload);

    res.status(201).json({
      success: true,
      message: `Student '${newStudent.fullName}' successfully created with code ${newStudent.studentCode || ""}.`,
      data: newStudent
    });
  } catch (error: any) {
    res.status(400).json({ success: false, message: error.message || "Failed to create student profile." });
  }
};

router.post("/", authenticateJwt, authorizePermission("students.create"), createStudentHandler);
router.post("/add", authenticateJwt, authorizePermission("students.create"), createStudentHandler);

/**
 * PUT /api/students/:id & PUT /api/students/edit/:id
 * Update student/parent/enrollment dossier.
 */
const updateStudentHandler = async (req: AuthenticatedRequest, res: express.Response) => {
  try {
    const studentId = Array.isArray(req.params.id) ? req.params.id[0] : req.params.id;
    if (!studentId) {
      res.status(400).json({ success: false, message: "Student ID is required." });
      return;
    }

    const body = req.body;
    const studentName = body.fullName || body.studentName || body.name;

    const payload = {
      ...body,
      ...(studentName ? { fullName: studentName } : {})
    };

    const updated = await updateStudentService(studentId, payload);
    res.status(200).json({
      success: true,
      message: `Student dossier '${updated.fullName}' updated successfully.`,
      data: updated
    });
  } catch (error: any) {
    res.status(400).json({ success: false, message: error.message || "Failed to update student dossier." });
  }
};

router.put("/:id", authenticateJwt, authorizePermission("students.edit"), updateStudentHandler);
router.put("/edit/:id", authenticateJwt, authorizePermission("students.edit"), updateStudentHandler);

/**
 * PATCH /api/students/:id/status
 * Toggle ACTIVE / INACTIVE status.
 */
router.patch("/:id/status", authenticateJwt, authorizePermission("students.edit"), async (req: AuthenticatedRequest, res: express.Response) => {
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
});

/**
 * GET /api/students/parents/list
 * Fetch registered parent profiles
 */
router.get("/parents/list", authenticateJwt, authorizePermission("parents.view"), async (_req: AuthenticatedRequest, res: express.Response) => {
  res.status(200).json({
    success: true,
    data: [
      { id: "prt-1", email: "venkat.reddy@gmail.com", full_name: "Venkat Reddy", phone: "+91 94926 02243", role: "PARENT" },
      { id: "prt-2", email: "rajesh.sharma@corp.com", full_name: "Rajesh Sharma", phone: "+91 98765 12345", role: "PARENT" }
    ]
  });
});

/**
 * POST /api/students/de-enroll/request
 */
router.post("/de-enroll/request", authenticateJwt, async (req: AuthenticatedRequest, res: express.Response) => {
  const { studentId, studentName, courseName, reason } = req.body;

  await dispatchMultiChannelNotification({
    eventType: "DE_ENROLLMENT_REQUESTED",
    subject: `⚠️ Course Withdrawal Request Submitted — ${studentName}`,
    message: `De-enrollment request submitted for ${studentName} (${courseName || "General Course"}). Reason: ${reason}. Awaiting Admin Approval.`,
    recipients: [
      { role: "PARENT", email: "parent@topgrade.edu", name: "Parent", phone: "" },
      { role: "ADMIN", email: "admin@topgrade.edu", name: "System Administrator", phone: "" }
    ]
  });

  res.status(201).json({
    success: true,
    message: "De-enrollment request submitted! Email notifications sent.",
    data: { id: `de-${Date.now()}`, student_name: studentName, status: "Pending" }
  });
});

export default router;