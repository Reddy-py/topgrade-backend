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

dotenv.config();

const app = express();
const PORT = process.env.PORT || 5000;

// Middleware configuration
app.use(cors());
app.use(express.json());

// Establish connection to Supabase instance
export const supabaseAdmin = createClient(
  process.env.SUPABASE_URL || "",
  process.env.SUPABASE_SERVICE_ROLE_KEY || ""
);

// API Routers
app.use("/api/schedules", scheduleRouter);
app.use("/api/search", searchRouter);
app.use("/api/students", studentsRouter);
app.use("/api/teachers", teachersRouter);
app.use("/api/courses", coursesRouter);
app.use("/api/fees", feesRouter);
app.use("/api/attendance", attendanceRouter);
app.use("/api/admissions", admissionsRouter);

// Operational System Metrics Endpoint
app.get("/api/crm-info", (req, res) => {
  res.json({
    success: true,
    systemName: "TopGrade CRM Engine",
    status: "Operational",
    database: "Supabase PostgreSQL (Connected)"
  });
});

// Base Health Check endpoint
app.get("/", (req, res) => {
  res.json({ status: "online", system: "Topgrade CRM API Engine v1.0.0" });
});

// Start listening
app.listen(PORT, () => {
  console.log(`🚀 Topgrade Express core layer engine running on port ${PORT}`);
});