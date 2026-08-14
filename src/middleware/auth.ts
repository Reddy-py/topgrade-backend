import type { Request, Response, NextFunction } from "express";
import { supabaseAdmin } from "../index.js";
import type { UserRole } from "../constants/rolePermissions.js";

export interface AuthenticatedUser {
  id: string;
  email?: string | undefined;
  role: UserRole;
}

export interface AuthenticatedRequest extends Request {
  user?: AuthenticatedUser;
}

export const authenticateJwt = async (
  req: AuthenticatedRequest,
  res: Response,
  next: NextFunction
): Promise<void> => {
  try {
    const authHeader = req.headers.authorization;
    if (!authHeader || !authHeader.startsWith("Bearer ")) {
      res.status(401).json({
        success: false,
        message: "Unauthorized: Missing or malformed access token.",
      });
      return;
    }

    const token = authHeader.split(" ")[1];
    const { data: { user }, error } = await supabaseAdmin.auth.getUser(token);

    if (error || !user) {
      res.status(401).json({
        success: false,
        message: "Unauthorized: Invalid or expired access token.",
      });
      return;
    }

    // Retrieve role from profiles table or user metadata
    let role: UserRole = (user.user_metadata?.role as UserRole) || "STUDENT";

    const { data: profile } = await supabaseAdmin
      .from("profiles")
      .select("role")
      .eq("id", user.id)
      .single();

    if (profile?.role) {
      role = profile.role as UserRole;
    }

    req.user = {
      id: user.id,
      email: user.email ?? undefined,
      role,
    };

    next();
  } catch (err: any) {
    console.error("JWT Authentication Middleware Fault:", err);
    res.status(500).json({
      success: false,
      message: "Internal Authentication System Failure",
    });
  }
};
