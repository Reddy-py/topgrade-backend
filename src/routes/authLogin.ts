import { Router, type Request, type Response } from "express";
import { createClient } from "@supabase/supabase-js";
import { supabaseAdmin } from "../supabase.js";
import { loginAttemptTracker, rateLimit } from "../middleware/rateLimit.js";
import { authenticateJwt, type AuthenticatedRequest } from "../middleware/auth.js";
import { extractSessionId, revokeSession, checkAndTouchSession } from "../services/sessionTracker.js";

const router = Router();

// Dedicated rate limiter by IP for login attempts (15 per minute)
const loginIpRateLimit = rateLimit({
  max: 15,
  windowMs: 60_000,
  message: "Too many login attempts from this network. Please wait a minute and try again."
});

/**
 * Server-side Unified Login Endpoint: POST /api/auth/login
 *
 * Security Invariants:
 * 1. Accepts { identifier, password } where identifier can be:
 *    - An email address (admin, teacher, parent, student)
 *    - A student ID code (e.g. STU-001)
 *    - A teacher ID code (e.g. TCH-001)
 *    - A 10-digit phone number (parents)
 * 2. Resolves identity entirely server-side.
 * 3. NEVER returns or logs the resolved email address.
 * 4. Identical generic error message ("Invalid identifier or password.")
 *    and matching response timing for non-existent identifiers vs wrong passwords.
 * 5. Dual rate-limiting by IP and by identifier with 15-minute lockout after 5 consecutive failures.
 */
router.post("/login", loginIpRateLimit, async (req: Request, res: Response) => {
  const ip = req.ip || req.socket.remoteAddress || "unknown-ip";
  const { identifier, password } = req.body || {};

  const cleanIdentifier = String(identifier || "").trim();
  const cleanPassword = String(password || "").trim();

  // 1. Basic validation
  if (!cleanIdentifier || !cleanPassword || cleanIdentifier.length > 100 || cleanPassword.length > 128) {
    return res.status(400).json({
      success: false,
      message: "Please enter your registered email, ID code, or phone number and password."
    });
  }

  // 2. Check for lockout on IP or identifier
  const lockStatus = loginAttemptTracker.isLocked(ip, cleanIdentifier);
  if (lockStatus.locked) {
    res.setHeader("Retry-After", String(lockStatus.retryAfterSec));
    return res.status(429).json({
      success: false,
      message: `Too many failed login attempts. Please wait ${Math.ceil(lockStatus.retryAfterSec / 60)} minute(s) before trying again.`,
      retryAfter: lockStatus.retryAfterSec
    });
  }

  // Helper for constant-time simulated delay on resolution failures
  const delayForTimingSafety = async () => {
    // Normal Supabase signInWithPassword takes ~300-450ms.
    // Simulate this duration so an attacker cannot time identifier lookup.
    const jitter = 320 + Math.floor(Math.random() * 80);
    await new Promise((r) => setTimeout(r, jitter));
  };

  let targetEmail: string | null = null;

  try {
    // 3. Resolve identifier internally
    if (cleanIdentifier.includes("@")) {
      targetEmail = cleanIdentifier.toLowerCase();
    } else {
      // Numerical phone check (10 digits or 11 with leading 1)
      const digits = cleanIdentifier.replace(/\D/g, "");
      if (digits.length === 10 || (digits.length === 11 && digits.startsWith("1"))) {
        const tenDigits = digits.length === 11 ? digits.slice(1) : digits;
        const formattedPlus1 = `+1${tenDigits}`;

        // Search profiles by parent phone
        const { data: parentProf } = await supabaseAdmin
          .from("profiles")
          .select("email")
          .eq("role", "PARENT")
          .or(`phone.eq.${formattedPlus1},phone.ilike.%${tenDigits}%`)
          .maybeSingle();

        if (parentProf?.email) {
          targetEmail = String(parentProf.email).toLowerCase();
        } else {
          // Check students table parent_phones
          const { data: studentsWithPhone } = await supabaseAdmin
            .from("students")
            .select("parent_emails, parent_phones");

          for (const st of (studentsWithPhone || []) as any[]) {
            const pPhones = (st.parent_phones || []).map((p: string) => String(p).replace(/\D/g, ""));
            if (pPhones.some((p: string) => p.endsWith(tenDigits))) {
              const pEmails = (st.parent_emails || []).filter(Boolean);
              if (pEmails.length > 0) {
                targetEmail = String(pEmails[0]).toLowerCase();
                break;
              }
            }
          }
        }
      } else {
        // ID code lookup: Student ID or Teacher ID
        const codeUpper = cleanIdentifier.toUpperCase();

        const { data: stu } = await supabaseAdmin
          .from("students")
          .select("email")
          .eq("student_id_code", codeUpper)
          .maybeSingle();

        if (stu?.email) {
          targetEmail = String(stu.email).toLowerCase();
        } else {
          const { data: tch } = await supabaseAdmin
            .from("teachers")
            .select("email")
            .eq("teacher_id_code", codeUpper)
            .maybeSingle();

          if (tch?.email) {
            targetEmail = String(tch.email).toLowerCase();
          }
        }
      }
    }

    // 4. Identifier not found -> Constant-time delay and generic rejection
    if (!targetEmail) {
      await delayForTimingSafety();
      loginAttemptTracker.recordFailure(ip, cleanIdentifier);
      return res.status(401).json({
        success: false,
        message: "Invalid identifier or password."
      });
    }

    // 5. Authenticate via Supabase Auth using isolated client (preserves supabaseAdmin service_role)
    const authClient = createClient(
      process.env.SUPABASE_URL || "",
      process.env.SUPABASE_ANON_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY || "",
      {
        auth: {
          persistSession: false,
          autoRefreshToken: false,
          detectSessionInUrl: false
        }
      }
    );

    const { data: authData, error: authError } = await authClient.auth.signInWithPassword({
      email: targetEmail,
      password: cleanPassword
    });

    if (authError || !authData?.user || !authData?.session) {
      loginAttemptTracker.recordFailure(ip, cleanIdentifier);
      return res.status(401).json({
        success: false,
        message: "Invalid identifier or password."
      });
    }

    // 6. Successful authentication: Clear failure counts
    loginAttemptTracker.resetSuccess(ip, cleanIdentifier);

    // 7. Verify profile & active status
    let { data: profile, error: pErr } = await supabaseAdmin
      .from("profiles")
      .select("id, role, full_name, status, must_change_password")
      .eq("id", authData.user.id)
      .maybeSingle();

    if (pErr) {
      const fallback = await supabaseAdmin
        .from("profiles")
        .select("id, role, full_name, status")
        .eq("id", authData.user.id)
        .maybeSingle();
      profile = fallback.data ? ({ ...fallback.data, must_change_password: false } as any) : null;
    }

    if (profile?.status && String(profile.status).toLowerCase() !== "active") {
      return res.status(403).json({
        success: false,
        message: "This account has been deactivated. Please contact the institute administrator."
      });
    }

    const resolvedRole = String(
      profile?.role || authData.user.user_metadata?.role || "STUDENT"
    ).toUpperCase();

    // 8. Return session and user profile without exposing sensitive internal resolution details
    return res.status(200).json({
      success: true,
      session: {
        access_token: authData.session.access_token,
        refresh_token: authData.session.refresh_token,
        expires_at: authData.session.expires_at,
        expires_in: authData.session.expires_in,
        token_type: authData.session.token_type
      },
      user: {
        id: authData.user.id,
        user_metadata: authData.user.user_metadata
      },
      profile: {
        id: profile?.id || authData.user.id,
        role: resolvedRole,
        full_name: profile?.full_name || authData.user.user_metadata?.full_name || "User",
        must_change_password: !!profile?.must_change_password
      }
    });
  } catch (err: any) {
    loginAttemptTracker.recordFailure(ip, cleanIdentifier);
    return res.status(401).json({
      success: false,
      message: "Invalid identifier or password."
    });
  }
});

/**
 * Touch session activity: POST /api/auth/touch-session
 * Called by frontend when the user clicks "Stay signed in" on the idle warning modal.
 */
router.post("/touch-session", authenticateJwt, (req: AuthenticatedRequest, res: Response) => {
  const authHeader = req.headers.authorization || "";
  const token = authHeader.replace(/^Bearer\s+/i, "").trim();
  const sessionId = extractSessionId(token);
  const touchRes = checkAndTouchSession(sessionId, req.user?.id || "unknown", Date.now());
  if (!touchRes.allowed) {
    return res.status(401).json({
      success: false,
      code: touchRes.code || "SESSION_IDLE",
      message: touchRes.message || "Session expired."
    });
  }
  return res.status(200).json({ success: true, timestamp: Date.now() });
});

/**
 * Explicit server-side logout & session revocation: POST /api/auth/logout
 */
router.post("/logout", async (req: Request, res: Response) => {
  try {
    const authHeader = req.headers.authorization || "";
    const token = authHeader.replace(/^Bearer\s+/i, "").trim();
    if (token) {
      const sessionId = extractSessionId(token);
      await revokeSession(sessionId);
    }
  } catch {}
  return res.status(200).json({ success: true, message: "Logged out successfully" });
});

export default router;
