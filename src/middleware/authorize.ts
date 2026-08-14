import type { Response, NextFunction } from "express";
import type { AuthenticatedRequest } from "./auth.js";
import type { PermissionString } from "../constants/rolePermissions.js";
import { hasBackendPermission } from "../constants/rolePermissions.js";

export const authorizePermission = (requiredPermission: PermissionString) => {
  return (req: AuthenticatedRequest, res: Response, next: NextFunction): void => {
    if (!req.user) {
      res.status(401).json({
        success: false,
        message: "Unauthorized: User identification missing.",
      });
      return;
    }

    const isAllowed = hasBackendPermission(req.user.role, requiredPermission);

    if (!isAllowed) {
      res.status(403).json({
        success: false,
        message: `Forbidden: User role '${req.user.role}' lacks required permission '${requiredPermission}'.`,
      });
      return;
    }

    next();
  };
};
