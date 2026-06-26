import express from "express";
import cors from "cors";
import * as dotenv from "dotenv";
dotenv.config();

const app = express();
const PORT = process.env.PORT || 5000;

// CRITICAL FOR VERCEL: Permissive CORS during development, we update this later
app.use(cors());
app.use(express.json());

// Base Verification Route
app.get("/api/health", (req, res) => {
  res.json({ status: "healthy", message: "TopGrade Core API Engine Online" });
});

// Example Secure Route passing through to Supabase
app.get("/api/system-status", (req, res) => {
  res.json({ 
    environment: process.env.NODE_ENV || "development",
    version: "1.0.0" 
  });
});

// Simple metadata route for testing frontend connectivity
app.get("/api/crm-info", (req, res) => {
  res.json({
    systemName: "TopGrade CRM Engine",
    status: "Operational",
    database: "Supabase Connected",
    activeAdmin: "Dr. Alex Sterling"
  });
});

app.listen(PORT, () => {
  console.log(`🚀 TopGrade Backend humming on port ${PORT}`);
});