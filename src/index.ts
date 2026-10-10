import dns from "node:dns";
dns.setDefaultResultOrder("ipv4first");
import express from "express";
import cors from "cors";
import dotenv from "dotenv";
import { createClient } from "@supabase/supabase-js";
import scheduleRouter from "./routes/schedule.js";
import searchRouter from "./routes/search.js";
import studentsRouter from "./routes/students.js";
import teachersRouter from "./routes/teachers.js";
import coursesRouter from "./routes/courses.js";
import feesRouter from "./routes/fees.js";
import attendanceRouter from "./routes/attendance.js";
import admissionsRouter from "./routes/admissions.js";
import leadsRouter from "./routes/leads.js";
import campaignsRouter from "./routes/campaigns.js";
import enrollmentsRouter from "./routes/enrollments.js";
import paymentsRouter from "./routes/payments.js";
import demoRouter from "./routes/demo.js";
import sessionQrRouter from "./routes/sessionQr.js";
import reportsRouter from "./routes/reports.js";
import historyRouter from "./routes/history.js";
import alertsRouter from "./routes/alerts.js";
import notificationsRouter from "./routes/notifications.js";
import { initializeAutomatedEmailScheduler } from "./services/automatedEmailService.js";
import { authenticateJwt } from "./middleware/auth.js";
import { authorizePermission } from "./middleware/authorize.js";
import { routeGuard, requireOwnStudent, requireOwnOrder } from "./middleware/guard.js";
import { rateLimit } from "./middleware/rateLimit.js";
import { USER_ROLES } from "./constants/rolePermissions.js";
import { reloadStudentsService } from "./services/studentService.js";
import { dispatchMultiChannelNotification } from "./services/notificationService.js";

import path from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
dotenv.config({ path: path.resolve(__dirname, "../.env") });
dotenv.config();

import compression from "compression";

const app = express();
const PORT = process.env.PORT || 5000;

// Middleware configuration
app.use(compression());
app.use(cors(process.env.CORS_ORIGIN ? { origin: process.env.CORS_ORIGIN.split(",").map(o => o.trim()) } : undefined));
app.use(
  express.json({
    limit: "50mb",
    verify: (req: any, _res, buf) => {
      req.rawBody = buf;
    }
  })
);
app.use(express.urlencoded({ extended: true, limit: "50mb" }));

// Establish connection to Supabase instance
import { supabaseAdmin } from "./supabase.js";
export { supabaseAdmin };

import {
  createStudentHandler,
  getStudentsHandler,
  updateStudentHandler,
  deleteStudentHandler,
  toggleStudentStatusHandler,
  changePasswordHandler,
  requestPasswordResetHandler,
  verifyLoginRoleHandler
} from "./routes/students.js";
import { inMemoryStudentStore } from "./services/studentService.js";
import { inMemoryCourses, getCoursesHandler, createCourseHandler, editCourseHandler, deleteCourseHandler } from "./routes/courses.js";
import { inMemoryTeachers, getTeachersHandler, createTeacherHandler, updateTeacherHandler, deleteTeacherHandler } from "./routes/teachers.js";
import { classSessionQrStore } from "./services/sessionAttendanceService.js";

// ============================================================================
// LOGIN-BASED ACCESS: every API route needs a signed-in user with the right role.
// Only these stay public: payment/lead webhooks, public admission forms, forgot-password, login lookup.
// Admin holds every permission. Teacher / parent / student limits are in constants/rolePermissions.ts,
// and the records each one may see are limited again inside the handlers (services/accessScope.ts).
// ============================================================================
const PUBLIC_LIMIT = rateLimit(30, 60_000);
app.post("/api/students/request-password-reset", PUBLIC_LIMIT);
app.post("/api/leads/webhook", PUBLIC_LIMIT);
app.post("/api/leads/public", PUBLIC_LIMIT);
app.post("/api/admissions/inquiry", PUBLIC_LIMIT);
app.post("/api/admissions/register", PUBLIC_LIMIT);

app.use("/api/students", routeGuard("students", [
  { method: "POST", path: /^\/request-password-reset\/?$/, permission: "PUBLIC" },
  { method: "POST", path: /^\/change-password\/?$/, permission: "dashboard.view" },
  { method: "POST", path: /^\/de-enroll\/request\/?$/, permission: "students.view" },
]));
app.use("/api/teachers", routeGuard("teachers", [
  { method: "GET", path: /^\/[^/]+\/(roster|history)\/?$/, permission: "attendance.create" },
  { method: "PUT", path: /^\/[^/]+\/availability\/?$/, permission: "attendance.edit" },
  { method: "POST", path: /^\/(respond-course\/[^/]+|onboarding-waiver)\/?$/, permission: "dashboard.view" },
]));
app.use("/api/courses", routeGuard("courses"));
app.use("/api/schedules", routeGuard("classes", [
  { method: "GET", path: /^\/existing-courses\/?$/, permission: "classes.create" },
  { method: "GET", path: /^\/teacher\/[^/]+\/roster\/?$/, permission: "attendance.create" },
]));
app.use("/api/attendance", routeGuard("attendance", [
  { method: "GET", path: /^\/session\/[^/]+\/roster\/?$/, permission: "attendance.create" },
  { method: "POST", path: /^\/monthly-summary-email\/?$/, permission: "reports.view" },
  { method: "POST", path: /^\/sessions\/create\/?$/, permission: "classes.create" },
]));
app.use("/api/fees", routeGuard("fees", [
  { method: "POST", path: /^\/pay\/?$/, permission: "fees.pay" },
]));
app.use("/api/payments", routeGuard("payments", [
  { method: "POST", path: /^\/stripe\/webhook\/?$/, permission: "PUBLIC" },
  { method: "GET", path: /^\/stripe\/status\/?$/, permission: "settings.view" },
  { method: "POST", path: /^\/(manual\/zelle-confirm|settle)\/?$/, permission: "payments.create" },
  { method: "POST", path: /^\/(stripe\/create-checkout-session|razorpay\/create-order|razorpay\/verify|upi\/generate-intent|upi\/verify)\/?$/, permission: "fees.pay" },
  { method: "GET", path: /^\/teacher-roster\/?$/, permission: "attendance.create" },
  { method: "GET", path: /^\/receipt\//, permission: "receipts.view" },
  { method: "GET", path: /^\/balance\//, permission: "fees.view" },
]));
app.use("/api/session-qr", routeGuard("attendance", [
  { method: "POST", path: /^\/student-scan\/?$/, permission: "attendance.view" },
  { method: "GET", path: /^\/live-roster\//, permission: "attendance.create" },
]));
app.use("/api/enrollments", routeGuard("students.create"));
app.use("/api/search", routeGuard("users.view"));
app.use("/api/reports", routeGuard("reports.view"));
app.use("/api/history", routeGuard("history.view"));
app.use("/api/alerts", routeGuard("alerts.manage"));
app.use("/api/notifications", routeGuard("alerts.manage"));
app.use("/api/campaigns", routeGuard("students.edit"));
app.use("/api/leads", routeGuard("students.create", [
  { method: "POST", path: /^\/(webhook|public)\/?$/, permission: "PUBLIC" },
]));
app.use("/api/demo", routeGuard("settings.manage"));
if (process.env.NODE_ENV === "production" && process.env.ALLOW_DEMO !== "true") {
  app.use("/api/demo", (_req, res) => res.status(404).json({ success: false, message: "Demo tools are disabled in production." }));
}

// A parent may pay only for their own child; a student only scans for themselves.
app.post(
  ["/api/payments/stripe/create-checkout-session", "/api/payments/razorpay/create-order", "/api/payments/razorpay/verify", "/api/payments/upi/generate-intent", "/api/payments/upi/verify"],
  requireOwnStudent("student_id", "studentId")
);
app.post("/api/fees/pay", requireOwnStudent("studentId"));
app.post("/api/session-qr/student-scan", requireOwnStudent("studentId"));
app.get("/api/payments/balance/:studentId", requireOwnStudent("param:studentId"));
app.get("/api/payments/receipt/:orderId/html", requireOwnOrder("orderId"));

// Login helper for students/teachers who sign in with their ID code instead of an email.
// Public, rate limited, and answers only with the email needed to sign in (the browser can no longer read these tables directly).
app.get("/api/auth/resolve-login", rateLimit(20, 60_000), async (req, res) => {
  try {
    const code = String(req.query.code || "").trim();
    if (!code || code.includes("@") || code.length > 40) {
      return res.status(400).json({ success: false, message: "Enter your registered student or teacher ID." });
    }
    const { data: stu } = await supabaseAdmin.from("students").select("email").eq("student_id_code", code.toUpperCase()).maybeSingle();
    if (stu?.email) return res.json({ success: true, email: String(stu.email).toLowerCase() });
    const { data: tch } = await supabaseAdmin.from("teachers").select("email").eq("teacher_id_code", code.toUpperCase()).maybeSingle();
    if (tch?.email) return res.json({ success: true, email: String(tch.email).toLowerCase() });
    return res.status(404).json({ success: false, message: "No account found for that ID." });
  } catch (err: any) {
    return res.status(500).json({ success: false, message: "Could not look up that ID." });
  }
});

// Top-Level Direct Resource Endpoints
app.get("/api/students/list", getStudentsHandler);
app.get("/api/students", getStudentsHandler);
app.get("/api/students/reload", async (_req, res) => {
  try {
    const data = await reloadStudentsService();
    res.json({ success: true, message: `Reloaded ${data.length} students live from Supabase.`, data });
  } catch (err: any) {
    res.status(500).json({ success: false, error: err.message });
  }
});
app.post("/api/students/reload", async (_req, res) => {
  try {
    const data = await reloadStudentsService();
    res.json({ success: true, message: `Reloaded ${data.length} students live from Supabase.`, data });
  } catch (err: any) {
    res.status(500).json({ success: false, error: err.message });
  }
});
app.post("/api/students/add", createStudentHandler);
app.post("/api/students/create", createStudentHandler);
app.post("/api/students", createStudentHandler);
app.put("/api/students/edit/:id", updateStudentHandler);
app.put("/api/students/:id", updateStudentHandler);
app.delete("/api/students/:id", deleteStudentHandler);
app.patch("/api/students/:id/status", toggleStudentStatusHandler);
app.post("/api/students/change-password", changePasswordHandler);
app.post("/api/students/request-password-reset", requestPasswordResetHandler);
app.post("/api/auth/verify-login", authenticateJwt, authorizePermission("users.view"), verifyLoginRoleHandler);
app.get("/api/auth/verify-login", authenticateJwt, authorizePermission("users.view"), verifyLoginRoleHandler);
app.get("/api/auth/lookup-role", authenticateJwt, authorizePermission("users.view"), verifyLoginRoleHandler);

// Direct Auth & Profile Credential Provisioning for Student, Parent, and Teacher
app.post("/api/auth/provision-credentials", authenticateJwt, authorizePermission("users.create"), async (req, res) => {
  try {
    const { email, password, role, fullName, metadata } = req.body;
    if (!email) {
      return res.status(400).json({ success: false, message: "Email is required" });
    }
    const cleanEmail = email.trim().toLowerCase();
    const cleanPassword = (password || "Topgrade@123").slice(0, 16);
    const assignedRole = (role || "STUDENT").toUpperCase();
    if (!(USER_ROLES as readonly string[]).includes(assignedRole)) {
      return res.status(400).json({ success: false, message: `Role must be one of: ${USER_ROLES.join(", ")}.` });
    }

    let authUserId: string | null = null;
    try {
      const { data: created, error: createErr } = await supabaseAdmin.auth.admin.createUser({
        email: cleanEmail,
        password: cleanPassword,
        email_confirm: true,
        user_metadata: {
          full_name: fullName || "",
          role: assignedRole,
          ...(metadata || {})
        }
      });
      if (created?.user) {
        authUserId = created.user.id;
      } else if (createErr) {
        console.warn("Notice admin.createUser:", createErr.message);

        // If user already exists, update user to ensure email_confirm is true and password is set
        try {
          const { data: usersList } = await supabaseAdmin.auth.admin.listUsers();
          const existingUser = usersList?.users?.find(u => u.email?.toLowerCase() === cleanEmail);
          if (existingUser) {
            authUserId = existingUser.id;
            await supabaseAdmin.auth.admin.updateUserById(existingUser.id, {
              password: cleanPassword,
              email_confirm: true,
              user_metadata: {
                full_name: fullName || existingUser.user_metadata?.full_name || "",
                role: assignedRole,
                ...(metadata || {})
              }
            });
          }
        } catch (updateErr: any) {
          console.warn("Notice updating existing auth user:", updateErr?.message);
        }
      }
    } catch (e: any) {
      console.warn("admin.createUser exception:", e?.message);
    }

    // Upsert into Supabase public.profiles table
    try {
      const profileRow: any = {
        email: cleanEmail,
        full_name: fullName || cleanEmail.split("@")[0],
        role: assignedRole,
        status: "Active",
        updated_at: new Date().toISOString()
      };
      if (authUserId) profileRow.id = authUserId;

      await supabaseAdmin.from("profiles").upsert(profileRow, { onConflict: "email" });
    } catch (pErr: any) {
      console.warn("Profiles upsert notice:", pErr?.message);
    }

    // Dispatch Direct Welcome Credentials Email via Gmail SMTP
    try {
      const appUrl = process.env.APP_URL || "http://localhost:5174/login";
      const htmlEmailMessage = `
        <div style="font-family: 'Segoe UI', Tahoma, sans-serif; color: #1e293b; line-height: 1.6;">
          <p>Dear <strong>${fullName || cleanEmail.split("@")[0]}</strong>,</p>
          <p>Welcome to <strong>Top Grade Learning</strong>! Your official institutional account has been successfully created and verified.</p>
          <div style="background: #f8fafc; border: 1px solid #cbd5e1; border-radius: 12px; padding: 20px; margin: 20px 0;">
            <p style="margin: 0 0 10px 0; font-size: 15px; font-weight: bold; color: #004ac6;">🔑 Account Login Details:</p>
            <p style="margin: 6px 0;"><strong>Role:</strong> <span style="background:#e0e7ff; color:#3730a3; padding:2px 8px; border-radius:6px; font-weight:bold; font-size:12px;">${assignedRole}</span></p>
            <p style="margin: 6px 0;"><strong>Portal Login Email:</strong> <code style="font-size:14px; color:#0f172a;">${cleanEmail}</code></p>
            <p style="margin: 6px 0;"><strong>Password:</strong> <code style="background:#f1f5f9; padding:3px 8px; border-radius:4px; font-weight:bold; color:#0f172a; font-size:14px;">${cleanPassword}</code></p>
            <p style="margin: 6px 0;"><strong>Portal Access Link:</strong> <a href="${appUrl}" style="color:#004ac6; font-weight:bold;">${appUrl}</a></p>
          </div>
          <p>You can immediately log in to access your course schedules, academic reports, and learning resources without waiting for email verification.</p>
          <p style="font-size: 12px; color: #64748b; margin-top: 25px;">For security, please change your password after your first login if desired.</p>
        </div>
      `;

      await dispatchMultiChannelNotification({
        eventType: "ADMISSION_APPROVED",
        subject: `🔐 Your Top Grade Learning Login Credentials (${assignedRole})`,
        message: htmlEmailMessage,
        recipients: [
          { role: assignedRole as any, email: cleanEmail, name: fullName || assignedRole }
        ],
        actionUrl: appUrl
      });
    } catch (emailErr: any) {
      console.warn("Notice dispatching credentials email:", emailErr?.message);
    }

    return res.status(200).json({ success: true, email: cleanEmail, role: assignedRole, authUserId });
  } catch (err: any) {
    return res.status(500).json({ success: false, message: err?.message || "Provisioning error" });
  }
});

app.get("/api/courses/list", getCoursesHandler);
app.get("/api/courses", getCoursesHandler);
app.post("/api/courses/add", createCourseHandler);
app.post("/api/courses/create", createCourseHandler);
app.post("/api/courses", createCourseHandler);
app.put("/api/courses/edit/:id", editCourseHandler);
app.put("/api/courses/:id", editCourseHandler);
app.delete("/api/courses/:id", deleteCourseHandler);

app.get("/api/teachers/list", getTeachersHandler);
app.get("/api/teachers", getTeachersHandler);
app.post("/api/teachers/add", createTeacherHandler);
app.post("/api/teachers/create", createTeacherHandler);
app.post("/api/teachers", createTeacherHandler);
app.put("/api/teachers/edit/:id", updateTeacherHandler);
app.put("/api/teachers/:id", updateTeacherHandler);
app.delete("/api/teachers/:id", deleteTeacherHandler);

// API Routers
app.use("/api/schedules", scheduleRouter);
app.use("/api/search", searchRouter);
app.use("/api/students", studentsRouter);
app.use("/api/teachers", teachersRouter);
app.use("/api/courses", coursesRouter);
app.use("/api/fees", feesRouter);
app.use("/api/attendance", attendanceRouter);
app.use("/api/admissions", admissionsRouter);
app.use("/api/leads", leadsRouter);
app.use("/api/campaigns", campaignsRouter);
app.use("/api/enrollments", enrollmentsRouter);
app.use("/api/payments", paymentsRouter);
app.use("/api/demo", demoRouter);
app.use("/api/session-qr", sessionQrRouter);
app.use("/api/reports", reportsRouter);
app.use("/api/history", historyRouter);
app.use("/api/alerts", alertsRouter);
app.use("/api/notifications", notificationsRouter);

import { runDatabaseSeed } from "./seeds/seedData.js";

// Database Seed Endpoint
app.get("/api/seed", routeGuard("settings.manage"), async (_req, res) => {
  if (process.env.NODE_ENV === "production" && process.env.ALLOW_DEMO !== "true") {
    res.status(404).json({ success: false, message: "Seeding is disabled in production." });
    return;
  }
  const result = await runDatabaseSeed();
  res.status(200).json(result);
});

// Operational System Metrics Endpoint
app.get("/api/crm-info", routeGuard("dashboard.view"), (_req, res) => {
  const totalStudents = inMemoryStudentStore.length;
  const activeStudents = inMemoryStudentStore.filter(s => (s.status || "").toUpperCase() === "ACTIVE").length;
  const activeCourses = inMemoryCourses.length;
  const teachersAvailable = inMemoryTeachers.length;
  const todayClasses = classSessionQrStore.length;

  res.json({
    success: true,
    systemName: "TopGrade CRM Engine",
    status: "Operational",
    database: "Supabase PostgreSQL (Connected)",
    liveMetrics: {
      totalStudents,
      newAdmissions: activeStudents,
      activeCourses,
      teachersAvailable,
      todayClasses
    }
  });
});

// Base Health Check endpoint
app.get("/", (req, res) => {
  res.json({ status: "online", system: "Topgrade CRM API Engine v1.0.0" });
});
app.get("/api/health", (req, res) => {
  res.json({ status: "online", system: "Topgrade CRM API Engine v1.0.0" });
});

// Start listening
if (process.env.NODE_ENV !== "test") {
  const server = app.listen(PORT, () => {
    console.log(`🚀 TopGrade Backend Engine active on port ${PORT}`);
    initializeAutomatedEmailScheduler();
  });

  server.on("error", (err: any) => {
    if (err.code === "EADDRINUSE") {
      console.warn(`⚠️ Port ${PORT} is in use. Falling back to port 5001...`);
      app.listen(5001, () => {
        console.log(`🚀 TopGrade Backend Engine active on port 5001`);
      });
    } else {
      console.error("Server startup error:", err);
    }
  });
}

export default app;