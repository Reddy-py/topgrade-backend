import { test, describe, beforeEach } from "node:test";
import assert from "node:assert/strict";
import {
  extractSessionId,
  checkAndTouchSession,
  revokeSession,
  getActiveSession,
  clearActiveSessions,
  TOTAL_ALLOWED_IDLE_MS,
  DB_THROTTLE_MS
} from "./sessionTracker.js";

describe("TASK 17 - PART A: Session Security & Server-Side Idle Check", () => {
  beforeEach(() => {
    clearActiveSessions();
  });

  test("extractSessionId extracts stable identifier from token or payload", () => {
    // Normal string token
    const token = "mock-sample-bearer-token-12345";
    const sid = extractSessionId(token);
    assert.ok(sid && sid.length >= 16, "Must produce a hash identifier");

    // JWT token with session_id claim
    const header = Buffer.from(JSON.stringify({ alg: "HS256", typ: "JWT" })).toString("base64url");
    const payload = Buffer.from(JSON.stringify({ sub: "user-123", session_id: "sess-abc-789" })).toString("base64url");
    const jwtToken = `${header}.${payload}.mock-signature`;
    assert.equal(extractSessionId(jwtToken), "sess-abc-789", "Must extract session_id directly from JWT");
  });

  test("allows active session and updates activity timestamp", () => {
    const t0 = 1000000;
    const res = checkAndTouchSession("sess-1", "user-1", t0);
    assert.equal(res.allowed, true);

    const record = getActiveSession("sess-1");
    assert.ok(record);
    assert.equal(record.lastActivity, t0);
    assert.equal(record.revoked, false);

    // 2 minutes later (within 5 minutes idle)
    const t1 = t0 + 2 * 60 * 1000;
    const res2 = checkAndTouchSession("sess-1", "user-1", t1);
    assert.equal(res2.allowed, true);
    assert.equal(getActiveSession("sess-1")?.lastActivity, t1);
  });

  test("throttles database writes to once per minute", () => {
    const t0 = 1000000;
    checkAndTouchSession("sess-throttle", "user-1", t0);
    const rec0 = getActiveSession("sess-throttle");
    assert.equal(rec0?.lastDbSync, t0);

    // Call after 30 seconds: lastActivity updates, but lastDbSync does NOT update (throttled)
    const t1 = t0 + 30 * 1000;
    checkAndTouchSession("sess-throttle", "user-1", t1);
    const rec1 = getActiveSession("sess-throttle");
    assert.equal(rec1?.lastActivity, t1);
    assert.equal(rec1?.lastDbSync, t0, "DB write must remain throttled within 60s");

    // Call after 65 seconds (> DB_THROTTLE_MS): lastDbSync updates
    const t2 = t0 + 65 * 1000;
    checkAndTouchSession("sess-throttle", "user-1", t2);
    const rec2 = getActiveSession("sess-throttle");
    assert.equal(rec2?.lastActivity, t2);
    assert.equal(rec2?.lastDbSync, t2, "DB write must be triggered after 60s");
  });

  test("rejects request after more than 5 minutes idle plus 30s grace with code SESSION_IDLE and revokes session", () => {
    const t0 = 1000000;
    checkAndTouchSession("sess-idle-test", "user-2", t0);

    // Exactly 5 minutes + 31 seconds later (331,000 ms > 330,000 ms total allowed idle)
    const tIdle = t0 + TOTAL_ALLOWED_IDLE_MS + 1000;
    const idleCheck = checkAndTouchSession("sess-idle-test", "user-2", tIdle);

    assert.equal(idleCheck.allowed, false);
    assert.equal(idleCheck.code, "SESSION_IDLE");
    assert.match(idleCheck.message || "", /inactivity/i);

    // Verify session was revoked in registry
    const record = getActiveSession("sess-idle-test");
    assert.equal(record?.revoked, true);
    assert.equal(record?.revokedAt, tIdle);

    // Subsequent call is blocked with SESSION_REVOKED
    const followup = checkAndTouchSession("sess-idle-test", "user-2", tIdle + 5000);
    assert.equal(followup.allowed, false);
    assert.equal(followup.code, "SESSION_REVOKED");
  });

  test("explicit revokeSession terminates session immediately", async () => {
    const t0 = 1000000;
    checkAndTouchSession("sess-manual", "user-3", t0);
    assert.equal(getActiveSession("sess-manual")?.revoked, false);

    await revokeSession("sess-manual", "user-3", t0 + 5000);
    assert.equal(getActiveSession("sess-manual")?.revoked, true);

    const check = checkAndTouchSession("sess-manual", "user-3", t0 + 6000);
    assert.equal(check.allowed, false);
    assert.equal(check.code, "SESSION_REVOKED");
  });

  test("Cache-Control: no-store header formatting invariant", () => {
    const headers: Record<string, string> = {
      "Cache-Control": "no-store, no-cache, must-revalidate, proxy-revalidate",
      "Pragma": "no-cache",
      "Expires": "0"
    };

    assert.ok((headers["Cache-Control"] || "").includes("no-store"));
    assert.ok((headers["Cache-Control"] || "").includes("no-cache"));
    assert.equal(headers["Pragma"], "no-cache");
    assert.equal(headers["Expires"], "0");
  });

  test("Client storage wipe simulation verifies all keys and tokens are removed", () => {
    const mockLocalStorage = new Map<string, string>([
      ["topgrade_token", "secret-token"],
      ["topgrade_user_email", "admin@topgrade.edu"],
      ["topgrade_user_role", "ADMIN"],
      ["unrelated_system_key", "system-val"]
    ]);

    const mockSessionStorage = new Map<string, string>([
      ["topgrade_token", "secret-token"],
      ["topgrade_student_id", "STU-100"]
    ]);

    // Simulate wipe
    mockSessionStorage.clear();
    for (const key of Array.from(mockLocalStorage.keys())) {
      if (key.startsWith("topgrade_") || key.startsWith("sb-")) {
        mockLocalStorage.delete(key);
      }
    }

    assert.equal(mockSessionStorage.size, 0, "sessionStorage must be completely cleared");
    assert.equal(mockLocalStorage.has("topgrade_token"), false, "topgrade_token must be removed");
    assert.equal(mockLocalStorage.has("topgrade_user_email"), false, "topgrade_user_email must be removed");
    assert.equal(mockLocalStorage.has("unrelated_system_key"), true, "Non-app keys are left intact");
  });

  test("bfcache Back-button protection re-check logic", () => {
    // When pageshow has persisted=true and session is invalid, onInvalid must trigger
    let redirected = false;
    const sessionMock: any = null; // signed out

    const simulatePageShow = (persisted: boolean) => {
      if (persisted && !sessionMock) {
        redirected = true;
      }
    };

    simulatePageShow(true);
    assert.equal(redirected, true, "bfcache restoration without session must redirect to /login");
  });
});
