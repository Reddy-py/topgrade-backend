import type { Request, Response, NextFunction } from "express";
import { supabaseAdmin } from "../supabase.js";
import { isUserRole, type UserRole } from "../constants/rolePermissions.js";

export interface AuthenticatedUser {
  id: string;
  email?: string | undefined;
  role: UserRole;
  metadata?: any;
}

export interface AuthenticatedRequest extends Request {
  user?: AuthenticatedUser;
}

// Short cache so a page that fires many API calls does not hit the profiles table every time.
const PROFILE_CACHE_MS = 15_000;
const profileCache = new Map<string, { at: number; role: UserRole; fullName: string | null }>();

/**
 * Verifies the Supabase access token and loads the role from the `profiles` table.
 * - No token, bad token, expired token  -> 401.
 * - No profile, disabled profile, or a role that is not one of the four roles -> 403.
 * The role is NEVER read from user_metadata (users can edit it), localStorage, headers or query strings.
 */
export const authenticateJwt = async (
  req: AuthenticatedRequest,
  res: Response,
  next: NextFunction
): Promise<void> => {
  try {
    const authHeader = req.headers.authorization;
    if (!authHeader || !authHeader.startsWith("Bearer ")) {
      res.status(401).json({ success: false, message: "Unauthorized: sign in to continue." });
      return;
    }

    const token = authHeader.slice(7).trim();
    if (!token) {
      res.status(401).json({ success: false, message: "Unauthorized: sign in to continue." });
      return;
    }

    const { data: { user }, error } = await supabaseAdmin.auth.getUser(token);
    if (error || !user) {
      res.status(401).json({ success: false, message: "Unauthorized: your session is invalid or expired. Sign in again." });
      return;
    }

    let cached = profileCache.get(user.id);
    if (!cached || Date.now() - cached.at > PROFILE_CACHE_MS) {
      const { data: profile } = await supabaseAdmin
        .from("profiles")
        .select("role, status, full_name")
        .eq("id", user.id)
        .maybeSingle();

      const role = String(profile?.role || "").toUpperCase();
      const active = String(profile?.status || "").toLowerCase() === "active";
      if (!profile || !active || !isUserRole(role)) {
        profileCache.delete(user.id);
        res.status(403).json({ success: false, message: "Forbidden: this account is not active or has no valid role." });
        return;
      }
      cached = { at: Date.now(), role, fullName: profile.full_name ?? null };
      profileCache.set(user.id, cached);
    }

    req.user = {
      id: user.id,
      email: user.email ?? undefined,
      role: cached.role,
      metadata: { full_name: cached.fullName },
    };

    next();
  } catch (err: any) {
    console.error("JWT Authentication Middleware Fault:", err);
    res.status(500).json({ success: false, message: "Internal Authentication System Failure" });
  }
};

export const requireRoles = (...roles: UserRole[]) =>
  (req: AuthenticatedRequest, res: Response, next: NextFunction): void => {
    if (!req.user) {
      res.status(401).json({ success: false, message: "Unauthorized: sign in to continue." });
      return;
    }
    if (!roles.includes(req.user.role)) {
      res.status(403).json({ success: false, message: `Forbidden: the ${req.user.role} login cannot do this.` });
      return;
    }
    next();
  };
