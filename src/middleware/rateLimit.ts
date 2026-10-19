import type { Request, Response, NextFunction } from "express";

export interface RateLimitOptions {
  max: number;
  windowMs: number;
  message?: string;
  keyGenerator?: (req: Request) => string;
}

interface RateLimitEntry {
  count: number;
  resetAt: number;
  lockedUntil?: number;
}

const storage = new Map<string, RateLimitEntry>();

// Periodic pruning of expired entries every 10 minutes to prevent memory leak
setInterval(() => {
  const now = Date.now();
  for (const [key, entry] of storage.entries()) {
    if (now > entry.resetAt && (!entry.lockedUntil || now > entry.lockedUntil)) {
      storage.delete(key);
    }
  }
}, 600_000).unref();

/**
 * Robust in-memory rate limiter with Retry-After header and lockout support.
 */
export function rateLimit(maxOrOptions: number | RateLimitOptions, windowMsArg?: number) {
  const options: RateLimitOptions = typeof maxOrOptions === "number"
    ? { max: maxOrOptions, windowMs: windowMsArg || 60_000 }
    : maxOrOptions;

  const { max, windowMs, message = "Too many requests. Please wait and try again.", keyGenerator } = options;

  return (req: Request, res: Response, next: NextFunction): void => {
    const ip = req.ip || req.socket.remoteAddress || "unknown-ip";
    const key = keyGenerator ? keyGenerator(req) : `${ip}|${req.path}`;
    const now = Date.now();
    const entry = storage.get(key);

    // 1. Check if currently locked out
    if (entry?.lockedUntil && now < entry.lockedUntil) {
      const retryAfterSec = Math.max(1, Math.ceil((entry.lockedUntil - now) / 1000));
      res.setHeader("Retry-After", String(retryAfterSec));
      res.status(429).json({
        success: false,
        message: "Account or IP temporarily locked due to repeated attempts. Please try again later.",
        retryAfter: retryAfterSec
      });
      return;
    }

    // 2. Check window expiration
    if (!entry || now > entry.resetAt) {
      storage.set(key, { count: 1, resetAt: now + windowMs });
      next();
      return;
    }

    // 3. Increment and evaluate threshold
    entry.count += 1;
    if (entry.count > max) {
      const retryAfterSec = Math.max(1, Math.ceil((entry.resetAt - now) / 1000));
      res.setHeader("Retry-After", String(retryAfterSec));
      res.status(429).json({
        success: false,
        message,
        retryAfter: retryAfterSec
      });
      return;
    }

    next();
  };
}

/**
 * Dedicated failure tracker for sensitive login endpoints.
 * Locks out an IP or identifier after 5 consecutive failures for 15 minutes.
 */
class LoginAttemptTracker {
  private failures = new Map<string, { count: number; lockedUntil: number; windowStart: number }>();

  private getKey(ip: string, identifier: string): { ipKey: string; idKey: string } {
    return {
      ipKey: `login_ip_${ip}`,
      idKey: `login_id_${identifier.toLowerCase().trim()}`
    };
  }

  public isLocked(ip: string, identifier: string): { locked: boolean; retryAfterSec: number } {
    const now = Date.now();
    const { ipKey, idKey } = this.getKey(ip, identifier);

    for (const k of [ipKey, idKey]) {
      const entry = this.failures.get(k);
      if (entry && entry.lockedUntil > now) {
        return {
          locked: true,
          retryAfterSec: Math.max(1, Math.ceil((entry.lockedUntil - now) / 1000))
        };
      }
    }
    return { locked: false, retryAfterSec: 0 };
  }

  public recordFailure(ip: string, identifier: string, maxAttempts = 5, lockoutMs = 900_000): void {
    const now = Date.now();
    const { ipKey, idKey } = this.getKey(ip, identifier);

    for (const k of [ipKey, idKey]) {
      let entry = this.failures.get(k);
      if (!entry || (now - entry.windowStart > lockoutMs && entry.lockedUntil <= now)) {
        entry = { count: 1, lockedUntil: 0, windowStart: now };
      } else {
        entry.count += 1;
        if (entry.count >= maxAttempts) {
          entry.lockedUntil = now + lockoutMs;
        }
      }
      this.failures.set(k, entry);
    }
  }

  public resetSuccess(ip: string, identifier: string): void {
    const { ipKey, idKey } = this.getKey(ip, identifier);
    this.failures.delete(ipKey);
    this.failures.delete(idKey);
  }
}

export const loginAttemptTracker = new LoginAttemptTracker();
