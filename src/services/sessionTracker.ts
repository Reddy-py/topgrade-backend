import crypto from "node:crypto";
import { supabaseAdmin } from "../supabase.js";

export interface SessionRecord {
  sessionId: string;
  userId: string;
  lastActivity: number;
  lastDbSync: number;
  revoked: boolean;
  revokedAt?: number;
  createdAt: number;
}

export const IDLE_TIMEOUT_MS = 5 * 60 * 1000; // 5 minutes (300,000 ms)
export const IDLE_GRACE_MS = 30 * 1000;       // 30 seconds grace (30,000 ms)
export const TOTAL_ALLOWED_IDLE_MS = IDLE_TIMEOUT_MS + IDLE_GRACE_MS; // 330,000 ms
export const DB_THROTTLE_MS = 60 * 1000;      // 1 minute throttle for DB sync

// In-memory active session registry
const activeSessions = new Map<string, SessionRecord>();

/**
 * Extracts a stable, non-sensitive session identifier from a bearer token.
 * Extracts session_id / jti from JWT payload if present, or SHA-256 hash of token.
 */
export function extractSessionId(token: string): string {
  if (!token) return "unknown";
  try {
    const parts = token.split(".");
    if (parts.length === 3 && parts[1]) {
      const payloadJson = Buffer.from(parts[1], "base64url").toString("utf-8");
      const payload = JSON.parse(payloadJson);
      if (payload.session_id) return String(payload.session_id);
      if (payload.jti) return String(payload.jti);
      if (payload.sub) {
        // Compound hash of subject and iat/exp
        const sig = `${payload.sub}:${payload.iat || 0}:${payload.exp || 0}`;
        return crypto.createHash("sha256").update(sig).digest("hex").slice(0, 32);
      }
    }
  } catch {
    // fallback to hash
  }
  return crypto.createHash("sha256").update(token).digest("hex").slice(0, 32);
}

/**
 * Validates session idle state and updates lastActivity.
 * Enforces:
 * - 5 minutes idle + 30s grace = 330s maximum idle.
 * - Writes to persistent store are throttled to once per minute.
 * - On idle expiration or revocation: returns allowed: false, code: SESSION_IDLE, revoking the session.
 */
export function checkAndTouchSession(
  sessionId: string,
  userId: string,
  now = Date.now()
): { allowed: boolean; code?: string; message?: string } {
  if (!sessionId || sessionId === "unknown") {
    return { allowed: true };
  }

  const existing = activeSessions.get(sessionId);

  if (existing) {
    if (existing.revoked) {
      return {
        allowed: false,
        code: "SESSION_REVOKED",
        message: "Your session has been terminated. Please sign in again."
      };
    }

    const idleTime = now - existing.lastActivity;
    if (idleTime > TOTAL_ALLOWED_IDLE_MS) {
      // Session has exceeded 5m30s of inactivity -> revoke immediately
      existing.revoked = true;
      existing.revokedAt = now;
      syncRevokeToDb(sessionId, userId, now);
      return {
        allowed: false,
        code: "SESSION_IDLE",
        message: "Session expired due to inactivity. Please sign in again."
      };
    }

    // Still active: update memory timestamp
    existing.lastActivity = now;

    // Throttle persistent writes to once a minute
    if (now - existing.lastDbSync >= DB_THROTTLE_MS) {
      existing.lastDbSync = now;
      syncActivityToDb(sessionId, userId, now);
    }

    return { allowed: true };
  }

  // First time seeing this session in memory: register it
  const newRecord: SessionRecord = {
    sessionId,
    userId,
    lastActivity: now,
    lastDbSync: now,
    revoked: false,
    createdAt: now
  };
  activeSessions.set(sessionId, newRecord);
  syncActivityToDb(sessionId, userId, now);

  return { allowed: true };
}

/**
 * Revokes a session explicitly (e.g. on user logout or admin intervention).
 */
export async function revokeSession(sessionId: string, userId?: string, now = Date.now()): Promise<void> {
  const existing = activeSessions.get(sessionId);
  if (existing) {
    existing.revoked = true;
    existing.revokedAt = now;
  } else {
    activeSessions.set(sessionId, {
      sessionId,
      userId: userId || "unknown",
      lastActivity: now,
      lastDbSync: now,
      revoked: true,
      revokedAt: now,
      createdAt: now
    });
  }

  syncRevokeToDb(sessionId, userId || existing?.userId || "", now);
}

/**
 * Background non-blocking DB synchronization (throttled to once a minute per session)
 */
function syncActivityToDb(sessionId: string, userId: string, now: number): void {
  if (!sessionId || !userId || userId === "unknown") return;
  // Best-effort database upsert; never throw or block execution
  Promise.resolve(
    supabaseAdmin
      .from("user_sessions")
      .upsert(
        {
          id: sessionId,
          user_id: userId,
          last_activity: new Date(now).toISOString(),
          revoked: false
        },
        { onConflict: "id" }
      )
  ).catch(() => {
    // Ignore DB errors (e.g. table not yet present or offline test environment)
  });
}

function syncRevokeToDb(sessionId: string, userId: string, now: number): void {
  if (!sessionId) return;
  Promise.resolve(
    supabaseAdmin
      .from("user_sessions")
      .upsert(
        {
          id: sessionId,
          user_id: userId && userId !== "unknown" ? userId : undefined,
          last_activity: new Date(now).toISOString(),
          revoked: true,
          revoked_at: new Date(now).toISOString()
        },
        { onConflict: "id" }
      )
  ).catch(() => {
    // Ignore DB errors
  });
}

/**
 * Helper for test fixtures and state inspection
 */
export function getActiveSession(sessionId: string): SessionRecord | undefined {
  return activeSessions.get(sessionId);
}

export function clearActiveSessions(): void {
  activeSessions.clear();
}
