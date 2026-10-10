import type { Request, Response, NextFunction } from "express";

/** Tiny in-memory limiter for public endpoints (forgot password, lead forms, login lookup). */
export function rateLimit(max: number, windowMs: number) {
  const hits = new Map<string, { count: number; resetAt: number }>();
  return (req: Request, res: Response, next: NextFunction): void => {
    const key = `${req.ip}|${req.path}`;
    const now = Date.now();
    const entry = hits.get(key);
    if (!entry || now > entry.resetAt) {
      hits.set(key, { count: 1, resetAt: now + windowMs });
      next();
      return;
    }
    entry.count += 1;
    if (entry.count > max) {
      res.status(429).json({ success: false, message: "Too many requests. Please wait a minute and try again." });
      return;
    }
    next();
  };
}
