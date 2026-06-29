import express from "express";
import cors from "cors";
import dotenv from "dotenv";
import { createClient } from "@supabase/supabase-js";
import scheduleRouter from "./routes/schedule.js";
import searchRouter from "./routes/search.js";

dotenv.config();

const app = express();
const PORT = process.env.PORT || 5000;

// 1. Middleware configuration
app.use(cors());
app.use(express.json());

// 2. Establish connection to Supabase instance
export const supabaseAdmin = createClient(
  process.env.SUPABASE_URL || "",
  process.env.SUPABASE_SERVICE_ROLE_KEY || ""
);

// 3. API Routers
app.use("/api/schedules", scheduleRouter);
app.use("/api/search", searchRouter);

// 4. Operational System Metrics Endpoint
app.get("/api/crm-info", (req, res) => {
  res.json({
    success: true,
    systemName: "TopGrade CRM Engine",
    status: "Operational",
    database: "Supabase PostgreSQL (Connected)"
  });
});

// 5. Base Health Check endpoint
app.get("/", (req, res) => {
  res.json({ status: "online", system: "Topgrade CRM API Engine v1.0.0" });
});

// 6. Start listening (Always keep this at the very bottom)
app.listen(PORT, () => {
  console.log(`🚀 Topgrade Express core layer engine running on port ${PORT}`);
});