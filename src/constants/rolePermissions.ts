export type UserRole = "STUDENT" | "PARENT" | "TEACHER" | "ACCOUNTANT" | "ADMIN";

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
  | "settings.view" | "settings.edit" | "settings.manage";

export const ROLE_PERMISSIONS: Record<UserRole, PermissionString[]> = {
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
    "settings.view",
    "settings.edit",
    "settings.manage",
  ],
  ACCOUNTANT: [
    "dashboard.view",
    "students.view",
    "fees.view", "fees.create", "fees.edit", "fees.pay",
    "payments.view", "payments.create", "payments.edit",
    "receipts.view", "receipts.create", "receipts.download",
    "reports.view",
    "attendance.view",
    "settings.view",
  ],
  TEACHER: [
    "dashboard.view",
    "students.view",
    "teachers.view",
    "courses.view",
    "classes.view",
    "attendance.view", "attendance.create", "attendance.edit",
    "reports.view",
    "settings.view",
  ],
  PARENT: [
    "dashboard.view",
    "students.view",
    "courses.view",
    "classes.view",
    "attendance.view",
    "fees.view", "fees.pay",
    "payments.view",
    "receipts.view", "receipts.download",
    "reports.view",
    "settings.view",
  ],
  STUDENT: [
    "dashboard.view",
    "students.view",
    "courses.view",
    "classes.view",
    "attendance.view",
    "fees.view", "fees.pay",
    "payments.view",
    "receipts.view", "receipts.download",
    "reports.view",
    "settings.view",
  ],
};

export function hasBackendPermission(role: UserRole | undefined, permission: PermissionString): boolean {
  if (!role) return false;
  return ROLE_PERMISSIONS[role]?.includes(permission) ?? false;
}
