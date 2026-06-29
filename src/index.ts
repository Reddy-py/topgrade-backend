import express from "express";
import cors from "cors";
import dotenv from "dotenv";
import { createClient } from "@supabase/supabase-js";
import scheduleRouter from "./routes/schedule.js";
import searchRouter from "./routes/search.js";

dotenv.config();

const app = express();
const PORT = process.env.PORT || 5000;

// Middleware configuration
app.use(cors());
app.use(express.json());
app.use("/api/schedules", scheduleRouter);
app.use("/api/search", searchRouter);

// Establish connection to Supabase instance
export const supabaseAdmin = createClient(
  process.env.SUPABASE_URL || "",
  process.env.SUPABASE_SERVICE_ROLE_KEY || ""
);

// Base Health Check endpoint
app.get("/", (req, res) => {
  res.json({ status: "online", system: "Topgrade CRM API Engine v1.0.0" });
});

app.listen(PORT, () => {
  console.log(`🚀 Topgrade Express core layer engine running on port ${PORT}`);
});