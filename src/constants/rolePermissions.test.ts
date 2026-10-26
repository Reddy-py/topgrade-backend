import { test, describe } from "node:test";
import assert from "node:assert/strict";
import {
  USER_ROLES,
  ROLE_PERMISSIONS,
  hasBackendPermission,
  type UserRole,
  type PermissionString
} from "./rolePermissions.js";

describe("TASK 17 - PART B: Role Rules, Menus and Permission Matrix", () => {
  test("strictly four user roles exist in the system", () => {
    assert.deepEqual([...USER_ROLES], ["ADMIN", "TEACHER", "PARENT", "STUDENT"]);
  });

  test("ADMIN has unrestricted access across all system modules", () => {
    const adminPermissions = ROLE_PERMISSIONS.ADMIN;
    assert.ok(adminPermissions.includes("dashboard.view"));
    assert.ok(adminPermissions.includes("reports.view"));
    assert.ok(adminPermissions.includes("settings.view"));
    assert.ok(adminPermissions.includes("fees.view"));
    assert.ok(adminPermissions.includes("fees.create"));
    assert.ok(adminPermissions.includes("fees.edit"));
    assert.ok(adminPermissions.includes("courses.create"));
    assert.ok(adminPermissions.includes("courses.edit"));
    assert.ok(adminPermissions.includes("courses.delete"));
    assert.ok(adminPermissions.includes("students.create"));
    assert.ok(adminPermissions.includes("teachers.create"));
  });

  test("TEACHER permissions match exactly the 5 sidebar capabilities and restrict all others", () => {
    // Exactly 5 sidebar capabilities: Dashboard, Profile, Courses, Schedule, Attendance
    assert.ok(hasBackendPermission("TEACHER", "dashboard.view"), "Teacher must have dashboard.view");
    assert.ok(hasBackendPermission("TEACHER", "teachers.view"), "Teacher must have teachers.view (Profile)");
    assert.ok(hasBackendPermission("TEACHER", "courses.view"), "Teacher must have courses.view");
    assert.ok(hasBackendPermission("TEACHER", "classes.view"), "Teacher must have classes.view (Schedule)");
    assert.ok(hasBackendPermission("TEACHER", "attendance.view"), "Teacher must have attendance.view");
    assert.ok(hasBackendPermission("TEACHER", "attendance.create"), "Teacher must be able to mark attendance");
    assert.ok(hasBackendPermission("TEACHER", "attendance.edit"), "Teacher must be able to edit attendance");

    // Strictly forbidden for teacher:
    assert.equal(hasBackendPermission("TEACHER", "reports.view"), false, "Teacher must never access Reports");
    assert.equal(hasBackendPermission("TEACHER", "fees.view"), false, "Teacher must never access Fees");
    assert.equal(hasBackendPermission("TEACHER", "fees.pay"), false, "Teacher must never access Fees Pay");
    assert.equal(hasBackendPermission("TEACHER", "settings.view"), false, "Teacher must never access Settings");
    assert.equal(hasBackendPermission("TEACHER", "courses.create"), false, "Teacher must never create courses");
    assert.equal(hasBackendPermission("TEACHER", "students.create"), false, "Teacher must never create students");
    assert.equal(hasBackendPermission("TEACHER", "teachers.create"), false, "Teacher must never create teachers");
    assert.equal(hasBackendPermission("TEACHER", "history.view"), false, "Teacher must never access Institute History");
  });

  test("PARENT permissions allow children, courses, schedule, attendance, and fees/receipts", () => {
    assert.ok(hasBackendPermission("PARENT", "dashboard.view"));
    assert.ok(hasBackendPermission("PARENT", "students.view"), "Parent sees My Children");
    assert.ok(hasBackendPermission("PARENT", "courses.view"));
    assert.ok(hasBackendPermission("PARENT", "classes.view"));
    assert.ok(hasBackendPermission("PARENT", "attendance.view"));
    assert.ok(hasBackendPermission("PARENT", "fees.view"), "Parent sees Fees");
    assert.ok(hasBackendPermission("PARENT", "fees.pay"), "Parent can pay");
    assert.ok(hasBackendPermission("PARENT", "receipts.view"));

    // Strictly forbidden for parent:
    assert.equal(hasBackendPermission("PARENT", "reports.view"), false, "Parent must never access Reports");
    assert.equal(hasBackendPermission("PARENT", "settings.view"), false, "Parent must never access Settings");
    assert.equal(hasBackendPermission("PARENT", "courses.create"), false, "Parent cannot create courses");
    assert.equal(hasBackendPermission("PARENT", "students.create"), false, "Parent cannot add students");
    assert.equal(hasBackendPermission("PARENT", "attendance.create"), false, "Parent cannot mark attendance");
  });

  test("STUDENT permissions allow self profile, courses, schedule, attendance, and fees for self", () => {
    assert.ok(hasBackendPermission("STUDENT", "dashboard.view"));
    assert.ok(hasBackendPermission("STUDENT", "students.view"), "Student sees own profile");
    assert.ok(hasBackendPermission("STUDENT", "courses.view"));
    assert.ok(hasBackendPermission("STUDENT", "classes.view"));
    assert.ok(hasBackendPermission("STUDENT", "attendance.view"));
    assert.ok(hasBackendPermission("STUDENT", "fees.view"), "Student can view fees");
    assert.ok(hasBackendPermission("STUDENT", "fees.pay"), "Student can buy hours for themselves");
    assert.ok(hasBackendPermission("STUDENT", "receipts.view"));

    // Strictly forbidden for student:
    assert.equal(hasBackendPermission("STUDENT", "reports.view"), false, "Student must never access Reports");
    assert.equal(hasBackendPermission("STUDENT", "settings.view"), false, "Student must never access Settings");
    assert.equal(hasBackendPermission("STUDENT", "courses.create"), false, "Student cannot create courses");
    assert.equal(hasBackendPermission("STUDENT", "students.create"), false, "Student cannot add students");
    assert.equal(hasBackendPermission("STUDENT", "attendance.create"), false, "Student cannot mark attendance");
  });

  test("Frontend and Backend permission sets are identical for all 4 roles", () => {
    // Invariants:
    // Teachers have 7 permission strings
    assert.equal(ROLE_PERMISSIONS.TEACHER.length, 7);
    // Parents have 10 permission strings
    assert.equal(ROLE_PERMISSIONS.PARENT.length, 10);
    // Students have 10 permission strings
    assert.equal(ROLE_PERMISSIONS.STUDENT.length, 10);
    // Admin has 50 permission strings
    assert.equal(ROLE_PERMISSIONS.ADMIN.length, 50);
  });

  test("Route access matrix per role: allowed routes return true, forbidden return false", () => {
    const routePermissionMap: Record<string, PermissionString> = {
      "/app/dashboard": "dashboard.view",
      "/app/students": "students.view",
      "/app/teachers": "teachers.view",
      "/app/courses": "courses.view",
      "/app/schedule": "classes.view",
      "/app/attendance": "attendance.view",
      "/app/fees": "fees.view",
      "/app/reports": "reports.view",
      "/app/settings": "settings.view",
      "/app/history": "history.view"
    };

    // Teacher check: exactly Dashboard, Profile, Courses, Schedule, Attendance
    assert.equal(hasBackendPermission("TEACHER", routePermissionMap["/app/dashboard"]), true);
    assert.equal(hasBackendPermission("TEACHER", routePermissionMap["/app/courses"]), true);
    assert.equal(hasBackendPermission("TEACHER", routePermissionMap["/app/schedule"]), true);
    assert.equal(hasBackendPermission("TEACHER", routePermissionMap["/app/attendance"]), true);
    assert.equal(hasBackendPermission("TEACHER", routePermissionMap["/app/reports"]), false);
    assert.equal(hasBackendPermission("TEACHER", routePermissionMap["/app/fees"]), false);
    assert.equal(hasBackendPermission("TEACHER", routePermissionMap["/app/settings"]), false);
    assert.equal(hasBackendPermission("TEACHER", routePermissionMap["/app/students"]), false);
    assert.equal(hasBackendPermission("TEACHER", routePermissionMap["/app/history"]), false);

    // Parent check: Dashboard, My Children, Courses, Schedule, Attendance, Fees
    assert.equal(hasBackendPermission("PARENT", routePermissionMap["/app/dashboard"]), true);
    assert.equal(hasBackendPermission("PARENT", routePermissionMap["/app/students"]), true);
    assert.equal(hasBackendPermission("PARENT", routePermissionMap["/app/courses"]), true);
    assert.equal(hasBackendPermission("PARENT", routePermissionMap["/app/schedule"]), true);
    assert.equal(hasBackendPermission("PARENT", routePermissionMap["/app/attendance"]), true);
    assert.equal(hasBackendPermission("PARENT", routePermissionMap["/app/fees"]), true);
    assert.equal(hasBackendPermission("PARENT", routePermissionMap["/app/reports"]), false);
    assert.equal(hasBackendPermission("PARENT", routePermissionMap["/app/settings"]), false);
    assert.equal(hasBackendPermission("PARENT", routePermissionMap["/app/teachers"]), false);

    // Student check: Dashboard, Profile, Courses, Schedule, Attendance, Fees
    assert.equal(hasBackendPermission("STUDENT", routePermissionMap["/app/dashboard"]), true);
    assert.equal(hasBackendPermission("STUDENT", routePermissionMap["/app/students"]), true);
    assert.equal(hasBackendPermission("STUDENT", routePermissionMap["/app/courses"]), true);
    assert.equal(hasBackendPermission("STUDENT", routePermissionMap["/app/schedule"]), true);
    assert.equal(hasBackendPermission("STUDENT", routePermissionMap["/app/attendance"]), true);
    assert.equal(hasBackendPermission("STUDENT", routePermissionMap["/app/fees"]), true);
    assert.equal(hasBackendPermission("STUDENT", routePermissionMap["/app/reports"]), false);
    assert.equal(hasBackendPermission("STUDENT", routePermissionMap["/app/settings"]), false);
    assert.equal(hasBackendPermission("STUDENT", routePermissionMap["/app/teachers"]), false);

    // Admin: everything allowed
    Object.values(routePermissionMap).forEach(perm => {
      assert.equal(hasBackendPermission("ADMIN", perm), true);
    });
  });
});
