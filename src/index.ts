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
import sessionQrRouter from "./routes/sessionQr.js";
import reportsRouter from "./routes/reports.js";
import historyRouter from "./routes/history.js";
import alertsRouter from "./routes/alerts.js";
import notificationsRouter from "./routes/notifications.js";
import settingsRouter from "./routes/settings.js";
import locationsRouter from "./routes/locations.js";
import emailTemplatesRouter from "./routes/emailTemplates.js";
import emailLogsRouter from "./routes/emailLogs.js";
import announcementsRouter from "./routes/announcements.js";
import unsubscribeRouter from "./routes/unsubscribe.js";
import monthlyNotesRouter from "./routes/monthlyNotes.js";
import referralsRouter from "./routes/referrals.js";
import engagementRouter from "./routes/engagement.js";
import upsellRouter from "./routes/upsell.js";
import performanceRouter from "./routes/performance.js";
import { TimedEmailScheduler } from "./services/timedEmailScheduler.js";
import { initializeAutomatedEmailScheduler } from "./services/automatedEmailService.js";
import { authenticateJwt } from "./middleware/auth.js";
import { authorizePermission } from "./middleware/authorize.js";
import { routeGuard, requireOwnStudent, requireOwnOrder } from "./middleware/guard.js";
import { rateLimit } from "./middleware/rateLimit.js";
import {
  ensureLogin,
  emailSetPasswordLink,
  normEmail,
  isValidEmail,
  bulkSendSecureLoginLinks,
  listNeverSignedInAccounts,
  renameUserLogin,
  changeUserPassword,
  type LoginRole
} from "./services/studentAccounts.js";
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
import helmet from "helmet";
import authLoginRouter from "./routes/authLogin.js";
import {
  validateProductionEnvironment,
  piiSafeStructuredLogger,
  getCorsOptions,
  databaseHealthHandler,
  adminSystemHealthHandler,
  centralizedErrorHandler,
  registerGracefulShutdown
} from "./config/productionChecks.js";

// Enforce required production configuration and lock out demo switches
validateProductionEnvironment();

const app = express();
const PORT = process.env.PORT || 5000;

// Security, compression, and structured PII-scrubbed logging
app.use(helmet({ contentSecurityPolicy: false, crossOriginEmbedderPolicy: false }));
app.use(compression());
app.use(cors(getCorsOptions()));
app.use(piiSafeStructuredLogger);
app.use(
  express.json({
    limit: "10mb",
    verify: (req: any, _res, buf) => {
      req.rawBody = buf;
    }
  })
);
app.use(express.urlencoded({ extended: true, limit: "10mb" }));

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
import { getCoursesHandler, createCourseHandler, editCourseHandler, deleteCourseHandler } from "./routes/courses.js";
import { getTeachersHandler, createTeacherHandler, updateTeacherHandler, deleteTeacherHandler } from "./routes/teachers.js";
import { classSessionQrStore } from "./services/sessionAttendanceService.js";
import {
  getNeedsAttentionHandler,
  getNeedsAttentionSummaryHandler,
  exportNeedsAttentionCsvHandler
} from "./routes/needsAttention.js";


// ============================================================================
// LOGIN-BASED ACCESS: every API route needs a signed-in user with the right role.
// Only these stay public: payment/lead webhooks, public admission forms, forgot-password, login lookup.
// Admin holds every permission. Teacher / parent / student limits are in constants/rolePermissions.ts,
// and the records each one may see are limited again inside the handlers (services/accessScope.ts).
// ============================================================================
const PUBLIC_FORM_LIMIT = rateLimit(20, 60_000);
const WEBHOOK_LIMIT = rateLimit(120, 60_000);
const AUTH_RATE_LIMIT = rateLimit(15, 60_000);

app.post("/api/students/request-password-reset", AUTH_RATE_LIMIT);
app.post("/api/leads/webhook", WEBHOOK_LIMIT);
app.post("/api/leads/public", PUBLIC_FORM_LIMIT);
app.post("/api/admissions/inquiry", PUBLIC_FORM_LIMIT);
app.post("/api/admissions/register", PUBLIC_FORM_LIMIT);
app.post("/api/payments/stripe/webhook", WEBHOOK_LIMIT);
app.use("/api/unsubscribe", PUBLIC_FORM_LIMIT, unsubscribeRouter);

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
app.use(["/api/schedules", "/api/schedule"], routeGuard("classes", [
  { method: "GET", path: /^\/existing-courses\/?$/, permission: "classes.create" },
  { method: "GET", path: /^\/teacher\/[^/]+\/roster\/?$/, permission: "attendance.create" },
  { method: "GET", path: /^\/open\/?$/, permission: "attendance.create" },
  { method: "POST", path: /^\/[^/]+\/(claim|release)\/?$/, permission: "attendance.create" },
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
  { method: "POST", path: /^\/(stripe\/create-checkout-session|zelle-request)\/?$/, permission: "fees.pay" },
  { method: "GET", path: /^\/stripe\/verify-session\/?$/, permission: "fees.pay" },
  { method: "GET", path: /^\/teacher-roster\/?$/, permission: "attendance.create" },
  { method: "GET", path: /^\/receipt\//, permission: "receipts.view" },
  { method: "GET", path: /^\/(balance|ledger)\//, permission: "fees.view" },
  { method: "GET", path: /^\/orders\/?$/, permission: "fees.view" },
  // manual-credit, adjust, orders/:id/confirm and /reject use the default: payments.create (admin only)
]));
app.use("/api/session-qr", routeGuard("attendance", [
  { method: "POST", path: /^\/student-scan\/?$/, permission: "attendance.view" },
  { method: "GET", path: /^\/live-roster\//, permission: "attendance.create" },
]));
app.use("/api/enrollments", routeGuard("students.create", [
  { method: "GET", path: /^\/student\/[^/]+\/?$/, permission: "students.view" },
  { method: "POST", path: /^\/quote\/?$/, permission: "students.view" },
  { method: "GET", path: /^\/?$/, permission: "students.view" },
]));
app.use("/api/search", routeGuard("users.view"));
app.use("/api/reports", routeGuard("reports.view"));
app.use("/api/history", routeGuard("history.view", [
  { method: "GET", path: /^\/student\/[^/]+\/?$/, permission: "students.view" }
]));
app.use("/api/alerts", routeGuard("alerts.manage"));
app.use("/api/notifications", routeGuard("alerts.manage"));
app.use("/api/campaigns", routeGuard("students.edit"));
app.use("/api/leads", routeGuard("students.create", [
  { method: "POST", path: /^\/(webhook|public)\/?$/, permission: "PUBLIC" },
]));
app.use("/api/settings", routeGuard("settings.view", [
  { method: "GET", path: /^\/public-contact\/?$/, permission: "PUBLIC" },
  { method: "GET", path: /^\/institute\/?$/, permission: "dashboard.view" },
  { method: "GET", path: /^\/program-types\/?$/, permission: "dashboard.view" },
  { method: "GET", path: /^\/course-categories\/?$/, permission: "dashboard.view" },
]));
app.use("/api/settings", settingsRouter);
app.use("/api/locations", routeGuard("classes", [
  { method: "GET", path: /^\/?$/, permission: "dashboard.view" },
  { method: "GET", path: /^\/[^/]+\/?$/, permission: "dashboard.view" },
]));
app.use("/api/locations", locationsRouter);

// A parent may pay only for their own child; a student only scans for themselves.
app.post(["/api/payments/stripe/create-checkout-session", "/api/payments/zelle-request"], requireOwnStudent("student_id"));
app.get("/api/payments/ledger/:studentId", requireOwnStudent("param:studentId"));
app.post("/api/fees/pay", requireOwnStudent("studentId"));
app.post("/api/session-qr/student-scan", requireOwnStudent("studentId"));
app.get("/api/payments/balance/:studentId", requireOwnStudent("param:studentId"));
app.get("/api/payments/receipt/:orderId/html", requireOwnOrder("orderId"));

// Unified server-side login endpoint: POST /api/auth/login
// Resolves email/student ID/teacher ID/phone internally, authenticates with Supabase,
// never logs/returns resolved email, applies lockout after 5 failures, returns session.
app.use("/api/auth", authLoginRouter);

// Standalone change-password endpoint accessible during forced password change
app.post("/api/auth/change-password", changePasswordHandler);

// Step 5: Bulk admin action 'Send secure login link' for selected parents and students with a real email
app.post("/api/auth/bulk-send-secure-login-links", authenticateJwt, authorizePermission("users.create"), async (req, res) => {
  try {
    const targets = Array.isArray(req.body?.targets) ? req.body.targets : (req.body?.target ? [req.body.target] : []);
    if (targets.length === 0) {
      return res.status(400).json({ success: false, message: "At least one target email or account ID is required." });
    }
    const result = await bulkSendSecureLoginLinks(targets);
    return res.status(200).json({ success: true, ...result });
  } catch (err: any) {
    return res.status(500).json({ success: false, message: err?.message || "Failed to dispatch secure login links." });
  }
});

// Step 5: Admin list 'Never signed in' (accounts that have not changed their initial password)
app.get("/api/auth/never-signed-in", authenticateJwt, authorizePermission("users.view"), async (_req, res) => {
  try {
    const result = await listNeverSignedInAccounts();
    return res.status(200).json({ success: true, ...result });
  } catch (err: any) {
    return res.status(500).json({ success: false, message: err?.message || "Failed to fetch accounts requiring password change." });
  }
});

// Step 6: Rename login (auth email and profile) when admin enters a real email
app.post("/api/auth/rename-login", authenticateJwt, authorizePermission("users.edit"), async (req, res) => {
  try {
    const { oldIdentifier, newEmail } = req.body || {};
    if (!oldIdentifier || !newEmail) {
      return res.status(400).json({ success: false, message: "Both oldIdentifier and newEmail are required." });
    }
    const result = await renameUserLogin(oldIdentifier, newEmail);
    return res.status(200).json(result);
  } catch (err: any) {
    return res.status(400).json({ success: false, message: err?.message || "Failed to rename account login." });
  }
});

// Step 8: 'Needs attention' admin report routes (Admin only)
app.get("/api/reports/needs-attention", authenticateJwt, authorizePermission("users.view"), getNeedsAttentionHandler);
app.get("/api/reports/needs-attention/summary", authenticateJwt, authorizePermission("users.view"), getNeedsAttentionSummaryHandler);
app.get("/api/reports/needs-attention/csv", authenticateJwt, authorizePermission("users.view"), exportNeedsAttentionCsvHandler);

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

// Creates (or re-sends) a login for any of the four roles. Admin only.
// A password is never accepted from the browser: a new login gets a random password nobody sees, and the person
// receives a one-time set-password link by email. An existing login keeps its password and gets a fresh link.
app.post("/api/auth/provision-credentials", authenticateJwt, authorizePermission("users.create"), async (req, res) => {
  try {
    const { email, role, fullName, metadata } = req.body || {};
    const cleanEmail = normEmail(email);
    if (!cleanEmail || !isValidEmail(cleanEmail)) {
      return res.status(400).json({ success: false, message: "A valid email is required." });
    }
    const assignedRole = String(role || "STUDENT").toUpperCase();
    if (!(USER_ROLES as readonly string[]).includes(assignedRole)) {
      return res.status(400).json({ success: false, message: `Role must be one of: ${USER_ROLES.join(", ")}.` });
    }
    const name = String(fullName || cleanEmail.split("@")[0]);
    const login = await ensureLogin({ email: cleanEmail, fullName: name, role: assignedRole as LoginRole, metadata: metadata || {} });
    const emailed = await emailSetPasswordLink({ email: cleanEmail, name, role: assignedRole as LoginRole });
    return res.status(200).json({
      success: true,
      created: login.created,
      emailed,
      message: emailed
        ? `${login.created ? "Login created" : "Login already existed"}. A set-password link was emailed to ${cleanEmail}.`
        : `${login.created ? "Login created" : "Login already existed"}, but the set-password email could not be sent.`
    });
  } catch (err: any) {
    return res.status(409).json({ success: false, message: err?.message || "Could not create the login." });
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
app.use(["/api/schedules", "/api/schedule"], scheduleRouter);
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
app.use("/api/session-qr", sessionQrRouter);
app.use("/api/reports", reportsRouter);
app.use("/api/history", historyRouter);
app.use("/api/alerts", alertsRouter);
app.use("/api/notifications", notificationsRouter);
app.use("/api/email-templates", routeGuard("settings.view"), emailTemplatesRouter);
app.use("/api/email-logs", routeGuard("dashboard.view"), emailLogsRouter);
app.use("/api/emails/announcements", routeGuard("settings.view"), announcementsRouter);
app.use("/api/monthly-notes", routeGuard("attendance.create"), monthlyNotesRouter);
app.use("/api/referrals", referralsRouter);
app.use("/api/engagement", engagementRouter);
app.use("/api/upsell", upsellRouter);
app.use("/api/performance", performanceRouter);
app.get("/api/crm-info", routeGuard("dashboard.view"), async (_req, res) => {
  const [
    { count: totalStudents },
    { count: activeStudents },
    { count: activeCourses },
    { count: teachersAvailable }
  ] = await Promise.all([
    supabaseAdmin.from("students").select("id", { count: "exact", head: true }),
    supabaseAdmin.from("students").select("id", { count: "exact", head: true }).eq("status", "Active"),
    supabaseAdmin.from("courses").select("id", { count: "exact", head: true }),
    supabaseAdmin.from("teachers").select("id", { count: "exact", head: true })
  ]);
  const todayClasses = classSessionQrStore.length;

  res.json({
    success: true,
    systemName: "TopGrade CRM Engine",
    status: "Operational",
    database: "Supabase PostgreSQL (Connected)",
    liveMetrics: {
      totalStudents: totalStudents || inMemoryStudentStore.length,
      newAdmissions: activeStudents || inMemoryStudentStore.filter(s => (s.status || "").toUpperCase() === "ACTIVE").length,
      activeCourses: activeCourses || 0,
      teachersAvailable: teachersAvailable || 0,
      todayClasses
    }
  });
});

// Active Database Health Check endpoints (cached 30s, returns strictly { status })
app.get("/", databaseHealthHandler);
app.get("/health", databaseHealthHandler);
app.get("/api/health", databaseHealthHandler);

// Admin-only detailed diagnostics endpoint: latency, uptime, memory, database connection
app.get("/api/admin/system-health", authenticateJwt, authorizePermission("dashboard.view"), adminSystemHealthHandler);

// Centralized error reporting hook
app.use(centralizedErrorHandler);

import { runDailyPackageExpiryJob } from "./services/enrollmentExpiryService.js";
import { startInstituteSettingsBackgroundRefresh } from "./services/instituteSettingsService.js";

// Start listening
if (process.env.NODE_ENV !== "test") {
  const server = app.listen(PORT, () => {
    console.log(`🚀 TopGrade Backend Engine active on port ${PORT}`);
    registerGracefulShutdown(server);
    startInstituteSettingsBackgroundRefresh();
    initializeAutomatedEmailScheduler();
    TimedEmailScheduler.startScheduler();
    runDailyPackageExpiryJob("startup-claim").catch(e => console.warn("Initial daily expiry job notice:", e?.message));
    // Check every hour; atomic claim ensures it only runs once per calendar day
    setInterval(() => {
      runDailyPackageExpiryJob("hourly-check").catch(e => console.warn("Periodic daily expiry job notice:", e?.message));
    }, 3600000);
  });

  server.on("error", (err: any) => {
    if (err.code === "EADDRINUSE") {
      console.warn(`⚠️ Port ${PORT} is in use. Falling back to port 5001...`);
      const fallbackServer = app.listen(5001, () => {
        console.log(`🚀 TopGrade Backend Engine active on port 5001`);
        registerGracefulShutdown(fallbackServer);
      });
    } else {
      console.error("Server startup error:", err);
    }
  });
}

export default app;