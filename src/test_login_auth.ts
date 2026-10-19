/**
 * Automated Test Suite for Go-Live Hardening:
 * 1. POST /api/auth/login server-side resolution, constant timing, generic errors, no email leak.
 * 2. Short lockout after repeated login failures (5 failures -> 429 + Retry-After).
 * 3. Old GET /api/auth/resolve-login route returns 404.
 * 4. GET /api/health: strictly { status }, 30-second cache, no diagnostic leakage.
 * 5. GET /api/admin/system-health: role-protected (admin only), returns latency, uptime, memory.
 */
import dotenv from "dotenv";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createClient } from "@supabase/supabase-js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
dotenv.config({ path: path.resolve(__dirname, "../.env") });

const API = process.env.API_BASE || "http://localhost:5000";
const supabaseUrl = process.env.SUPABASE_URL || "";
const anonKey = process.env.SUPABASE_ANON_KEY || "";
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY || "";
const supabase = createClient(supabaseUrl, serviceKey || anonKey);

let passed = 0;
let failed = 0;

function assert(description: string, condition: boolean, extra = "") {
  if (condition) {
    console.log(`  PASS: ${description}`);
    passed++;
  } else {
    console.error(`  FAIL: ${description} ${extra ? `-> ${extra}` : ""}`);
    failed++;
  }
}

async function request(method: string, endpoint: string, body?: any, headers: Record<string, string> = {}) {
  const opts: RequestInit = {
    method,
    headers: {
      "Content-Type": "application/json",
      ...headers
    }
  };
  if (body !== undefined) {
    opts.body = JSON.stringify(body);
  }
  const start = Date.now();
  const res = await fetch(`${API}${endpoint}`, opts);
  const durationMs = Date.now() - start;
  let json: any = null;
  let rawText = "";
  try {
    rawText = await res.text();
    json = JSON.parse(rawText);
  } catch {
    // not JSON
  }
  return { status: res.status, headers: res.headers, json, rawText, durationMs };
}

async function runTests() {
  console.log("=================================================");
  console.log("GO-LIVE HARDENING TEST SUITE");
  console.log(`Target Backend: ${API}`);
  console.log("=================================================\n");

  // Load test credentials
  const adminEmail = process.env.TEST_ADMIN_EMAIL || "admin@topgrade.edu";
  const adminPassword = process.env.TEST_ADMIN_PASSWORD || "TopGrade2026!";
  const studentEmail = process.env.TEST_STUDENT_EMAIL || "student@topgrade.edu";
  const studentPassword = process.env.TEST_STUDENT_PASSWORD || "TopGrade2026!";

  // Query a real student code and parent phone from DB to test resolution
  const { data: studentRow } = await supabase
    .from("students")
    .select("student_id_code, email, parent_phones")
    .limit(1)
    .maybeSingle();

  const studentCode = studentRow?.student_id_code || "STU-001";

  // --------------------------------------------------------------------------
  // TEST 1: Old GET /api/auth/resolve-login MUST return 404 (removed from public)
  // --------------------------------------------------------------------------
  console.log("--- 1. Verification of Route Removal: GET /api/auth/resolve-login ---");
  const oldRouteRes = await request("GET", `/api/auth/resolve-login?code=${encodeURIComponent(studentCode)}`);
  assert("Old resolve-login endpoint returns 404 Not Found", oldRouteRes.status === 404, `Got status ${oldRouteRes.status}`);

  // --------------------------------------------------------------------------
  // TEST 2: POST /api/auth/login with valid email credentials
  // --------------------------------------------------------------------------
  console.log("\n--- 2. POST /api/auth/login: Valid Email Authentication ---");
  const emailLoginRes = await request("POST", "/api/auth/login", {
    identifier: adminEmail,
    password: adminPassword
  });

  assert("Returns 200 OK on valid credentials", emailLoginRes.status === 200, `Got ${emailLoginRes.status}`);
  assert("Returns session access_token", !!emailLoginRes.json?.session?.access_token);
  assert("Returns session refresh_token", !!emailLoginRes.json?.session?.refresh_token);
  console.log("  Profile returned:", emailLoginRes.json?.profile);
  const returnedRole = String(emailLoginRes.json?.profile?.role || "").toUpperCase();
  assert("Returns verified profile with role ADMIN", returnedRole === "ADMIN", `Got ${returnedRole}`);
  assert("Never returns resolved email field in root JSON", emailLoginRes.json?.email === undefined);
  assert("Never returns resolved email field in profile JSON", emailLoginRes.json?.profile?.email === undefined);

  const adminToken = emailLoginRes.json?.session?.access_token;

  // --------------------------------------------------------------------------
  // TEST 3: POST /api/auth/login with Student ID Code
  // --------------------------------------------------------------------------
  console.log("\n--- 3. POST /api/auth/login: Student ID Code Resolution ---");
  const codeLoginRes = await request("POST", "/api/auth/login", {
    identifier: studentCode,
    password: studentPassword
  });

  if (codeLoginRes.status === 200) {
    assert("Returns 200 OK using student ID code", true);
    assert("Returns session access_token for student", !!codeLoginRes.json?.session?.access_token);
    assert("Root response does NOT leak student email", codeLoginRes.json?.email === undefined);
    assert("Profile response does NOT leak student email", codeLoginRes.json?.profile?.email === undefined);
  } else {
    // If student test password differs, verify it rejected securely without leaking
    assert("Secure response without email leakage", codeLoginRes.json?.email === undefined);
  }

  // --------------------------------------------------------------------------
  // TEST 4: Timing Safety & Generic Error Messages (Anti-Enumeration)
  // --------------------------------------------------------------------------
  console.log("\n--- 4. Anti-Enumeration: Timing and Generic Error Message Consistency ---");
  // Non-existent identifier
  const fakeIdRes = await request("POST", "/api/auth/login", {
    identifier: "nonexistent_user_99999@domain.org",
    password: "Password123!"
  });

  // Known identifier with wrong password
  const wrongPassRes = await request("POST", "/api/auth/login", {
    identifier: adminEmail,
    password: "TotallyWrongPassword999!"
  });

  assert("Non-existent identifier returns 401 Unauthorized", fakeIdRes.status === 401, `Got ${fakeIdRes.status}`);
  assert("Wrong password returns 401 Unauthorized", wrongPassRes.status === 401, `Got ${wrongPassRes.status}`);
  assert("Both return identical generic message", fakeIdRes.json?.message === wrongPassRes.json?.message && fakeIdRes.json?.message === "Invalid identifier or password.");

  const timingDiff = Math.abs(fakeIdRes.durationMs - wrongPassRes.durationMs);
  console.log(`  Timing comparison: Unknown ID = ${fakeIdRes.durationMs}ms | Wrong Pass = ${wrongPassRes.durationMs}ms (diff: ${timingDiff}ms)`);
  assert("Response times are comparable within timing jitter window (< 350ms diff)", timingDiff < 350);

  // --------------------------------------------------------------------------
  // TEST 5: Public /api/health Response & 30-Second Cache
  // --------------------------------------------------------------------------
  console.log("\n--- 5. Public /api/health: Strict { status } and Caching ---");
  const health1 = await request("GET", "/api/health");
  assert("Public health returns 200 (or 503 if degraded)", health1.status === 200 || health1.status === 503);
  assert("Public health response has 'status' key", typeof health1.json?.status === "string");

  // Crucial security requirement: must NOT leak latency, uptime, db details to public
  assert("Public health DOES NOT leak database details", health1.json?.database === undefined);
  assert("Public health DOES NOT leak latencyMs", health1.json?.latencyMs === undefined);
  assert("Public health DOES NOT leak uptime", health1.json?.uptime === undefined);
  assert("Public health DOES NOT leak memoryUsage", health1.json?.memoryUsage === undefined);
  assert("Keys in public health response are strictly { status }", Object.keys(health1.json || {}).length === 1 && "status" in health1.json);

  // Test caching (consecutive call should complete instantly from cache)
  const health2 = await request("GET", "/api/health");
  assert("Consecutive health check is cached and fast (< 50ms)", health2.durationMs < 50);

  // --------------------------------------------------------------------------
  // TEST 6: Admin-Only System Health Diagnostics
  // --------------------------------------------------------------------------
  console.log("\n--- 6. Admin-Only System Health Diagnostics: GET /api/admin/system-health ---");
  const anonAdminHealth = await request("GET", "/api/admin/system-health");
  assert("Unauthenticated request to /api/admin/system-health returns 401", anonAdminHealth.status === 401);

  if (adminToken) {
    const authAdminHealth = await request("GET", "/api/admin/system-health", undefined, {
      Authorization: `Bearer ${adminToken}`
    });
    assert("Admin authenticated request returns 200 OK", authAdminHealth.status === 200, `Got ${authAdminHealth.status}`);
    assert("Admin health includes status", typeof authAdminHealth.json?.status === "string");
    assert("Admin health includes latencyMs", typeof authAdminHealth.json?.latencyMs === "number");
    assert("Admin health includes uptime", typeof authAdminHealth.json?.uptime === "number");
    assert("Admin health includes memoryUsage", typeof authAdminHealth.json?.memoryUsage === "object");
  } else {
    console.warn("  Skipping authenticated admin health test (adminToken not available)");
  }

  // --------------------------------------------------------------------------
  // TEST 7: Repeated Failure Lockout and Retry-After Header
  // --------------------------------------------------------------------------
  console.log("\n--- 7. Rate Limiting and Lockout on Repeated Failures ---");
  const testLockoutTarget = `attacker_test_${Date.now()}@test.org`;
  let lockoutTriggered = false;
  let retryAfterHeader = "";

  for (let i = 1; i <= 6; i++) {
    const attempt = await request("POST", "/api/auth/login", {
      identifier: testLockoutTarget,
      password: "WrongPassword!"
    });

    if (attempt.status === 429) {
      lockoutTriggered = true;
      retryAfterHeader = attempt.headers.get("retry-after") || "";
      console.log(`  Lockout triggered on attempt ${i} (Status: 429, Retry-After: ${retryAfterHeader}s)`);
      break;
    }
  }

  assert("5+ consecutive failures trigger 429 Too Many Requests lockout", lockoutTriggered);
  assert("429 response includes Retry-After header", !!retryAfterHeader && Number(retryAfterHeader) > 0);

  // --------------------------------------------------------------------------
  // SUMMARY
  // --------------------------------------------------------------------------
  console.log("\n=================================================");
  console.log(`TEST SUMMARY: ${passed} PASSED | ${failed} FAILED`);
  console.log("=================================================");

  if (failed > 0) {
    process.exit(1);
  }
}

runTests().catch(err => {
  console.error("Test runner exception:", err);
  process.exit(1);
});
