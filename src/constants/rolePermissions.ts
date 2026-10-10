// Single source of truth for login-based access. Exactly four roles exist.
// KEEP IN SYNC with topgrade/src/constants/permissions.ts (frontend copy used only to show/hide screens).
// The backend (this file) and the database (row-level security) are what actually enforce access.
export type UserRole = "STUDENT" | "PARENT" | "TEACHER" | "ADMIN";

export const USER_ROLES: readonly UserRole[] = ["ADMIN", "TEACHER", "PARENT", "STUDENT"] as const;

export type PermissionString =
  | "dashboard.view"
  | "students.view" | "students.create" | "students.edit" | "students.delete"
  | "parents.view" | "parents.create" | "parents.edit" | "parents.delete" | "parents.link_children"
  | "teachers.view" | "teachers.create" | "teachers.edit" | "teachers.delete"
  | "courses.view" | "courses.create" | "courses.edit" | "courses.delete"
  | "classes.view" | "classes.create" | "classes.edit" | "classes.delete"
  | "attendance.view" | "attendance.create" | "attendance.edit" | "attendance.delete"
  | "fees.view" | "fees.create" | "fees.edit" | "fees.delete" | "fees.pay"
  | "payments.view" | "payments.create" | "payments.edit" | "payments.delete"
  | "receipts.view" | "receipts.create" | "receipts.download"
  | "reports.view"
  | "users.view" | "users.create" | "users.edit" | "users.disable"
  | "roles.view" | "roles.manage"
  | "settings.view" | "settings.edit" | "settings.manage"
  | "history.view" | "alerts.manage";

export const ROLE_PERMISSIONS: Record<UserRole, PermissionString[]> = {
  // Admin: whole access.
  ADMIN: [
    "dashboard.view",
    "students.view", "students.create", "students.edit", "students.delete",
    "parents.view", "parents.create", "parents.edit", "parents.delete", "parents.link_children",
    "teachers.view", "teachers.create", "teachers.edit", "teachers.delete",
    "courses.view", "courses.create", "courses.edit", "courses.delete",
    "classes.view", "classes.create", "classes.edit", "classes.delete",
    "attendance.view", "attendance.create", "attendance.edit", "attendance.delete",
    "fees.view", "fees.create", "fees.edit", "fees.delete", "fees.pay",
    "payments.view", "payments.create", "payments.edit", "payments.delete",
    "receipts.view", "receipts.create", "receipts.download",
    "reports.view",
    "users.view", "users.create", "users.edit", "users.disable",
    "roles.view", "roles.manage",
    "settings.view", "settings.edit", "settings.manage",
    "history.view", "alerts.manage",
  ],
  // Teacher: sees own classes and assigned students, marks attendance. No fees, reports, settings.
  TEACHER: [
    "dashboard.view",
    "teachers.view",
    "students.view",
    "courses.view",
    "classes.view",
    "attendance.view", "attendance.create", "attendance.edit",
  ],
  // Parent: read-only view of own children (courses, attendance, schedule) plus fees and receipts.
  PARENT: [
    "dashboard.view",
    "students.view",
    "teachers.view",
    "courses.view",
    "classes.view",
    "attendance.view",
    "fees.view", "fees.pay",
    "payments.view",
    "receipts.view", "receipts.download",
  ],
  // Student: read-only view of own profile, courses, schedule and attendance. No fees.
  STUDENT: [
    "dashboard.view",
    "students.view",
    "teachers.view",
    "courses.view",
    "classes.view",
    "attendance.view",
  ],
};

export function isUserRole(value: unknown): value is UserRole {
  return typeof value === "string" && (USER_ROLES as readonly string[]).includes(value);
}

export function hasBackendPermission(role: UserRole | undefined, permission: PermissionString): boolean {
  if (!role) return false;
  return ROLE_PERMISSIONS[role]?.includes(permission) ?? false;
}
