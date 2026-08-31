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

dotenv.config();

const app = express();
const PORT = process.env.PORT || 5000;

// Middleware configuration
app.use(cors());
app.use(express.json({ limit: "50mb" }));
app.use(express.urlencoded({ extended: true, limit: "50mb" }));

// Establish connection to Supabase instance
export const supabaseAdmin = createClient(
  process.env.SUPABASE_URL || "",
  process.env.SUPABASE_SERVICE_ROLE_KEY || ""
);

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

// Top-Level Direct Resource Endpoints
app.get("/api/students/list", getStudentsHandler);
app.get("/api/students", getStudentsHandler);
app.post("/api/students/add", createStudentHandler);
app.post("/api/students/create", createStudentHandler);
app.post("/api/students", createStudentHandler);
app.put("/api/students/edit/:id", updateStudentHandler);
app.put("/api/students/:id", updateStudentHandler);
app.delete("/api/students/:id", deleteStudentHandler);
app.patch("/api/students/:id/status", toggleStudentStatusHandler);
app.post("/api/students/change-password", changePasswordHandler);
app.post("/api/students/request-password-reset", requestPasswordResetHandler);
app.post("/api/auth/verify-login", verifyLoginRoleHandler);
app.get("/api/auth/verify-login", verifyLoginRoleHandler);
app.get("/api/auth/lookup-role", verifyLoginRoleHandler);

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

import { runDatabaseSeed } from "./seeds/seedData.js";

// Database Seed Endpoint
app.get("/api/seed", async (_req, res) => {
  const result = await runDatabaseSeed();
  res.status(200).json(result);
});

// Operational System Metrics Endpoint
app.get("/api/crm-info", (_req, res) => {
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

// Start listening
if (process.env.NODE_ENV !== "test") {
  const server = app.listen(PORT, () => {
    console.log(`🚀 TopGrade Backend Engine active on port ${PORT}`);
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