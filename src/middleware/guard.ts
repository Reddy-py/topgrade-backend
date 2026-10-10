import type { Response, NextFunction } from "express";
import { authenticateJwt, type AuthenticatedRequest } from "./auth.js";
import { authorizePermission } from "./authorize.js";
import type { PermissionString } from "../constants/rolePermissions.js";

export interface GuardOverride {
  method: string;            // "GET", "POST", ... or "*"
  path: RegExp;              // tested against req.path (relative to the mount point)
  permission: PermissionString | "PUBLIC";
}

const METHOD_ACTION: Record<string, string> = {
  GET: "view", HEAD: "view", OPTIONS: "view",
  POST: "create",
  PUT: "edit", PATCH: "edit",
  DELETE: "delete",
};

/**
 * Router-level guard: login required + role permission checked on EVERY route under the mount point.
 *  - routeGuard("students")        -> GET needs students.view, POST students.create, PUT/PATCH students.edit, DELETE students.delete
 *  - routeGuard("reports.view")    -> every method needs that one permission
 *  - overrides                     -> per-route exceptions (a different permission, or PUBLIC for webhooks / forgot-password)
 * Admin holds every permission, so admin always passes. Data-level limits (own child, own class) are applied in the handlers via accessScope.
 */
export function routeGuard(resourceOrPermission: string, overrides: GuardOverride[] = []) {
  return (req: AuthenticatedRequest, res: Response, next: NextFunction): void => {
    const method = req.method.toUpperCase();
    const override = overrides.find(o => (o.method === "*" || o.method === method) && o.path.test(req.path));

    if (override?.permission === "PUBLIC") {
      next();
      return;
    }

    let permission: string;
    if (override) {
      permission = override.permission;
    } else if (resourceOrPermission.includes(".")) {
      permission = resourceOrPermission;
    } else {
      permission = `${resourceOrPermission}.${METHOD_ACTION[method] || "edit"}`;
    }

    authenticateJwt(req, res, (err?: any) => {
      if (err) return next(err);
      authorizePermission(permission as PermissionString)(req, res, next);
    }).catch(next);
  };
}

// ---------------------------------------------------------------------------
// Ownership checks: a parent may only act for their own child, a student for themselves.
// ---------------------------------------------------------------------------
import { getAccessScope, allowsStudent } from "../services/accessScope.js";
import { paymentOrdersStore } from "../services/courseHoursService.js";

/** Checks student ids sent in the request body (or the URL, with "param:name") against the login's own students. */
export function requireOwnStudent(...fields: string[]) {
  return async (req: AuthenticatedRequest, res: Response, next: NextFunction): Promise<void> => {
    try {
      if (!req.user) { res.status(401).json({ success: false, message: "Unauthorized: sign in to continue." }); return; }
      const ids = fields
        .map(f => (f.startsWith("param:") ? req.params[f.slice(6)] : req.body?.[f]))
        .filter(v => v !== undefined && v !== null && String(v).trim() !== "");
      if (ids.length === 0) { res.status(400).json({ success: false, message: "A student id is required." }); return; }
      const scope = await getAccessScope(req.user);
      if (!ids.every(id => allowsStudent(scope, id))) {
        res.status(403).json({ success: false, message: "Forbidden: this student is not linked to your login." });
        return;
      }
      next();
    } catch (err) { next(err); }
  };
}

/** Receipt access: the order must belong to one of the login's own students. */
export function requireOwnOrder(paramName: string) {
  return async (req: AuthenticatedRequest, res: Response, next: NextFunction): Promise<void> => {
    try {
      if (!req.user) { res.status(401).json({ success: false, message: "Unauthorized: sign in to continue." }); return; }
      const orderId = req.params[paramName];
      const order: any = paymentOrdersStore.find(o => o.id === orderId || o.orderNumber === orderId);
      if (!order) { next(); return; } // the route itself answers 404
      const scope = await getAccessScope(req.user);
      if (!allowsStudent(scope, order.studentId)) {
        res.status(403).json({ success: false, message: "Forbidden: this receipt belongs to another student." });
        return;
      }
      next();
    } catch (err) { next(err); }
  };
}
