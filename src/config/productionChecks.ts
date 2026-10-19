import type { Request, Response, NextFunction } from "express";
import type { Server } from "node:http";
import { supabaseAdmin } from "../supabase.js";

/**
 * Validates that all required environment variables are present in production.
 * In production, the backend MUST refuse to start if any required variable is missing,
 * or if demo/mock switches are active.
 */
export function validateProductionEnvironment(): void {
  const isProd = process.env.NODE_ENV === "production";
  if (!isProd) return;

  const isSimulatedEmail = process.env.SIMULATE_EMAILS === "true";

  const required = [
    { key: "SUPABASE_URL", label: "Supabase Project URL" },
    { key: "SUPABASE_SERVICE_ROLE_KEY", label: "Supabase Service Role Key" },
    { key: "FRONTEND_URL", label: "Frontend Production URL" },
    { key: "CORS_ORIGIN", label: "CORS Allowed Origins" },
    ...(isSimulatedEmail
      ? []
      : [
          { key: "GMAIL_USER", label: "Gmail Dispatch Account" },
          { key: "GMAIL_APP_PASSWORD", label: "Gmail App Password" }
        ])
  ];

  const missing: string[] = [];
  for (const item of required) {
    const val = process.env[item.key];
    if (!val || !val.trim()) {
      missing.push(`${item.key} (${item.label})`);
    }
  }

  if (missing.length > 0) {
    console.error("\n=======================================================");
    console.error("FATAL: PRODUCTION BOOT REFUSED — MISSING REQUIRED ENV:");
    missing.forEach(m => console.error(`  ❌ ${m}`));
    console.error("=======================================================\n");
    process.exit(1);
  }

  // Strictly block demo/mock modes in production
  const demoSwitches = [
    { key: "ALLOW_DEMO", val: process.env.ALLOW_DEMO },
    { key: "ALLOW_MOCK_PAYMENTS", val: process.env.ALLOW_MOCK_PAYMENTS }
  ];

  for (const s of demoSwitches) {
    if (s.val === "true" || s.val === "1") {
      console.error(`\nFATAL: ${s.key} is active. Demo or mock switches are strictly prohibited in production!`);
      process.exit(1);
    }
  }

  console.log("🔒 Production environment validated successfully: Required variables confirmed, demo switches locked out.");
}

/**
 * Masks an email for privacy in logs: "admin@topgrade.edu" -> "a***@topgrade.edu"
 */
function maskEmail(email?: string): string {
  if (!email || typeof email !== "string" || !email.includes("@")) return "[REDACTED_EMAIL]";
  const parts = email.split("@");
  const local = parts[0] || "";
  const domain = parts[1] || "";
  return `${local.charAt(0)}***@${domain}`;
}

/**
 * Structured, PII-scrubbed logger middleware.
 * Logs method, route, status code, and execution time without printing personal student/parent details.
 */
export function piiSafeStructuredLogger(req: Request, res: Response, next: NextFunction): void {
  const startTime = Date.now();
  const reqPath = req.path;

  // Intercept completion to log structured data
  res.on("finish", () => {
    // Skip noisy polling / health checks from cluttering logs
    if (reqPath === "/api/health" || reqPath === "/health" || reqPath === "/") {
      return;
    }

    const durationMs = Date.now() - startTime;
    const statusCode = res.statusCode;
    const method = req.method;

    // Structured metadata without PII
    const logPayload = {
      timestamp: new Date().toISOString(),
      method,
      path: reqPath,
      status: statusCode,
      durationMs,
      ip: req.ip || req.socket.remoteAddress || "unknown",
      userAgent: req.headers["user-agent"] ? req.headers["user-agent"].slice(0, 50) : "unknown"
    };

    if (statusCode >= 500) {
      console.error(JSON.stringify({ level: "ERROR", ...logPayload }));
    } else if (statusCode >= 400) {
      console.warn(JSON.stringify({ level: "WARN", ...logPayload }));
    } else {
      console.log(JSON.stringify({ level: "INFO", ...logPayload }));
    }
  });

  next();
}

/**
 * Configures CORS policy restricting access strictly to production sites.
 */
export function getCorsOptions() {
  const isProd = process.env.NODE_ENV === "production";
  const rawOrigins = [
    "https://topgrade-vert.vercel.app",
    ...(process.env.CORS_ORIGIN || process.env.FRONTEND_URL || "")
      .split(",")
      .map(o => o.trim())
      .filter(Boolean)
  ];

  // Regex strictly matching topgrade-vert and preview URLs of this project only
  // E.g. https://topgrade-vert.vercel.app, https://topgrade-vert-git-main-reddy-pys-projects.vercel.app
  const vercelProjectPreviewRegex = /^https:\/\/topgrade-vert(-[a-zA-Z0-9_\-]+)?\.vercel\.app$/;

  return {
    origin: (origin: string | undefined, callback: (err: Error | null, allow?: boolean) => void) => {
      // Allow requests with no origin (like mobile apps, curl, server-to-server health checks)
      if (!origin) return callback(null, true);

      if (!isProd) {
        // In local/development, permit localhost and configured origins
        if (
          origin.includes("localhost") ||
          origin.includes("127.0.0.1") ||
          rawOrigins.includes(origin) ||
          vercelProjectPreviewRegex.test(origin)
        ) {
          return callback(null, true);
        }
      }

      if (rawOrigins.includes(origin) || vercelProjectPreviewRegex.test(origin)) {
        return callback(null, true);
      }

      callback(new Error(`CORS Policy: Origin ${origin} not allowed.`));
    },
    credentials: true,
    methods: ["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"],
    allowedHeaders: ["Content-Type", "Authorization", "X-Requested-With", "Accept"]
  };
}

// In-memory 30-second cache for database health check
interface HealthCache {
  status: "healthy" | "degraded";
  database: string;
  latencyMs: number;
  lastChecked: number;
  error?: string;
}

let healthCache: HealthCache | null = null;
const HEALTH_CACHE_TTL_MS = 30_000;

async function getOrUpdateHealth(): Promise<HealthCache> {
  const now = Date.now();
  if (healthCache && (now - healthCache.lastChecked) < HEALTH_CACHE_TTL_MS) {
    return healthCache;
  }

  const start = Date.now();
  try {
    const { error } = await supabaseAdmin
      .from("profiles")
      .select("id")
      .limit(1);

    const latencyMs = Date.now() - start;

    if (error) {
      healthCache = {
        status: "degraded",
        database: "error",
        error: error.message,
        latencyMs,
        lastChecked: now
      };
    } else {
      healthCache = {
        status: "healthy",
        database: "connected",
        latencyMs,
        lastChecked: now
      };
    }
  } catch (err: any) {
    healthCache = {
      status: "degraded",
      database: "unreachable",
      error: err?.message || "Connection timeout",
      latencyMs: Date.now() - start,
      lastChecked: now
    };
  }

  return healthCache;
}

/**
 * Public health check: Strictly returns { status: "healthy" | "degraded" }
 * Results are cached for 30 seconds to prevent database load spikes.
 */
export async function databaseHealthHandler(_req: Request, res: Response): Promise<void> {
  const health = await getOrUpdateHealth();
  const statusCode = health.status === "healthy" ? 200 : 503;
  res.status(statusCode).json({ status: health.status });
}

/**
 * Admin-only system health metrics: includes latency, uptime, and detailed diagnostics.
 */
export async function adminSystemHealthHandler(_req: Request, res: Response): Promise<void> {
  const health = await getOrUpdateHealth();
  const statusCode = health.status === "healthy" ? 200 : 503;

  res.status(statusCode).json({
    status: health.status,
    database: health.database,
    latencyMs: health.latencyMs,
    uptime: Math.round(process.uptime()),
    cachedCheckAgeMs: Date.now() - health.lastChecked,
    memoryUsage: process.memoryUsage(),
    timestamp: new Date().toISOString(),
    ...(health.error ? { error: health.error } : {})
  });
}

/**
 * GET /api/admin/environment-check (Admin only)
 * Returns environment health without leaking any secrets or personal data.
 */
export async function adminEnvironmentCheckHandler(_req: Request, res: Response): Promise<void> {
  try {
    let supabaseHost = "unknown";
    try {
      const u = new URL(process.env.SUPABASE_URL || "");
      supabaseHost = u.host;
    } catch {}

    const isOldProject = supabaseHost.includes("zznzmzwiewsnmykcbcni");
    const simulateEmails = process.env.SIMULATE_EMAILS === "true";
    const disablePayments = process.env.DISABLE_PAYMENTS === "true";

    const requiredTables = [
      "profiles",
      "courses",
      "teachers",
      "students",
      "schedules",
      "locations",
      "institute_settings",
      "student_enrollments",
      "email_templates",
      "referral_codes",
      "attendance",
      "email_log",
      "token_wallets",
      "token_orders",
      "token_ledger"
    ];

    const tableChecks: Record<string, boolean> = {};
    await Promise.all(
      requiredTables.map(async table => {
        try {
          const { error } = await supabaseAdmin.from(table).select("*", { count: "exact", head: true });
          tableChecks[table] = !error;
        } catch {
          tableChecks[table] = false;
        }
      })
    );

    const allTablesPass = requiredTables.every(t => tableChecks[t]);

    const [
      { count: studentsCount },
      { count: parentsCount },
      { count: studentsMustChangeCount },
      { count: parentsMustChangeCount }
    ] = await Promise.all([
      supabaseAdmin.from("students").select("id", { count: "exact", head: true }),
      supabaseAdmin.from("profiles").select("id", { count: "exact", head: true }).eq("role", "PARENT"),
      supabaseAdmin.from("profiles").select("id", { count: "exact", head: true }).eq("role", "STUDENT").eq("must_change_password", true),
      supabaseAdmin.from("profiles").select("id", { count: "exact", head: true }).eq("role", "PARENT").eq("must_change_password", true)
    ]);

    res.json({
      success: true,
      timestamp: new Date().toISOString(),
      supabaseHost,
      isOldProject,
      simulateEmails,
      disablePayments,
      allTablesPass,
      tableChecks,
      counts: {
        students: studentsCount || 0,
        parents: parentsCount || 0,
        studentsMustChangePassword: studentsMustChangeCount || 0,
        parentsMustChangePassword: parentsMustChangeCount || 0,
        totalMustChangePassword: (studentsMustChangeCount || 0) + (parentsMustChangeCount || 0)
      }
    });
  } catch (err: any) {
    console.error("Environment check error:", err);
    res.status(500).json({
      success: false,
      message: "Failed to perform environment check.",
      error: err.message
    });
  }
}

/**
 * Centralized error reporting middleware that redacts stack traces in production.
 */
export function centralizedErrorHandler(err: any, _req: Request, res: Response, _next: NextFunction): void {
  const isProd = process.env.NODE_ENV === "production";
  const status = err.status || err.statusCode || 500;
  const message = err.message || "An unexpected internal server error occurred.";

  console.error("Centralized Error Hook:", {
    status,
    message,
    ...(isProd ? {} : { stack: err.stack })
  });

  res.status(status).json({
    success: false,
    message,
    ...(isProd ? {} : { stack: err.stack })
  });
}

/**
 * Configures clean process termination on SIGTERM and SIGINT.
 */
export function registerGracefulShutdown(server: Server): void {
  const shutdown = (signal: string) => {
    console.log(`\n🛑 Received ${signal}. Starting graceful shutdown...`);
    server.close(() => {
      console.log("HTTP server closed. Exiting process.");
      process.exit(0);
    });

    // Forceful shutdown safeguard
    setTimeout(() => {
      console.error("Forceful shutdown after 10s timeout.");
      process.exit(1);
    }, 10000).unref();
  };

  process.on("SIGTERM", () => shutdown("SIGTERM"));
  process.on("SIGINT", () => shutdown("SIGINT"));
}
