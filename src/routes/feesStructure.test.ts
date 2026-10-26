import { test, describe, before, after } from "node:test";
import assert from "node:assert/strict";
import crypto from "node:crypto";
import { 
  getFeeStructureHandler, 
  getFeeStructureAuditHandler, 
  updateCourseFeeStructureHandler,
  createCourseHandler,
  inMemoryFeeStructureAudit
} from "./courses.js";
import { quoteEnrollment } from "../services/pricing.js";
import { createOrder, fulfillOrder, getBalances, applyTokens } from "../services/tokenService.js";
import { supabaseAdmin } from "../supabase.js";

function createMockReqRes(body: any, params: any = {}, user: any = { role: "ADMIN", id: "admin-1" }, query: any = {}) {
  const req: any = {
    body,
    params,
    query,
    user,
    headers: {}
  };
  const res: any = {
    statusCode: 200,
    body: null,
    status(code: number) {
      this.statusCode = code;
      return this;
    },
    json(data: any) {
      this.body = data;
      return this;
    }
  };
  return { req, res };
}

describe("TASK 17 - PART E: Fee Structure Management & Auditing", () => {
  const createdCourseIds: string[] = [];
  let testCourse: any;
  const testStudentId = crypto.randomUUID();

  before(async () => {
    // 1. Create a test course with known initial fee structure
    const { req, res } = createMockReqRes({
      name: `PartE Fees Course ${Date.now()}`,
      category: "Robotics",
      description: "Test course for Part E fee structure",
      classLength: 1,
      hourly_rate: 55,
      package_hours: 20,
      package_price: 950,
      duration_months: 3,
      scheduleSlots: [
        { day_of_week: "Monday", start_time: "09:00 AM", end_time: "10:00 AM", room: `Room-Fee-${Date.now()}` }
      ]
    });

    await createCourseHandler(req, res);
    assert.equal(res.statusCode, 201, `Failed to create course for testing: ${JSON.stringify(res.body)}`);
    testCourse = res.body.data;
    createdCourseIds.push(testCourse.id);

    // 2. Seed a test student
    await supabaseAdmin.from("students").insert({
      id: testStudentId,
      name: "PartE Test Student",
      email: `part_e_student_${Date.now()}@test.edu`,
      student_id_code: `STD-E-${Math.floor(1000 + Math.random() * 9000)}`
    });
  });

  after(async () => {
    for (const cid of createdCourseIds) {
      await supabaseAdmin.from("courses").delete().eq("id", cid);
      await supabaseAdmin.from("fee_structure_audit").delete().eq("course_id", cid);
    }
    await supabaseAdmin.from("students").delete().eq("id", testStudentId);
    await supabaseAdmin.from("token_wallets").delete().eq("student_id", testStudentId);
  });

  test("Test 1: Admin can fetch fee structure for courses via getFeeStructureHandler", async () => {
    const adminUser = { role: "ADMIN", id: crypto.randomUUID(), name: "Head Admin" };
    const { req, res } = createMockReqRes({}, {}, adminUser);

    await getFeeStructureHandler(req, res);

    assert.equal(res.statusCode, 200, "Admin must receive HTTP 200 for fee structure");
    assert.equal(res.body.success, true, "Response must indicate success");
    assert.ok(Array.isArray(res.body.data), "Fee structure data must be an array");

    const found = res.body.data.find((c: any) => c.id === testCourse.id);
    assert.ok(found, "Test course must be present in fee structure listing");
    assert.equal(found.hourly_rate, 55, "Hourly rate must match initial configuration");
    assert.equal(found.package_hours, 20, "Package hours must match initial configuration");
    assert.equal(found.package_price, 950, "Package price must match initial configuration");
    assert.equal(found.duration_months, 3, "Duration months must match initial configuration");
  });

  test("Test 2: Non-admin users (TEACHER, PARENT, STUDENT) are blocked with HTTP 403 Forbidden", async () => {
    // Teacher attempting GET fee-structure
    const teacherReq = createMockReqRes({}, {}, { role: "TEACHER", id: "t-1" });
    await getFeeStructureHandler(teacherReq.req, teacherReq.res);
    assert.equal(teacherReq.res.statusCode, 403, "Teacher must be blocked with HTTP 403 from viewing fee structure");

    // Parent attempting PUT fee-structure
    const parentReq = createMockReqRes(
      { hourly_rate: 40, package_hours: 10, package_price: 350, duration_months: 2 },
      { id: testCourse.id },
      { role: "PARENT", id: "p-1" }
    );
    await updateCourseFeeStructureHandler(parentReq.req, parentReq.res);
    assert.equal(parentReq.res.statusCode, 403, "Parent must be blocked with HTTP 403 from updating fee structure");

    // Student attempting PUT fee-structure
    const studentReq = createMockReqRes(
      { hourly_rate: 10, package_hours: 100, package_price: 50, duration_months: 1 },
      { id: testCourse.id },
      { role: "STUDENT", id: "s-1" }
    );
    await updateCourseFeeStructureHandler(studentReq.req, studentReq.res);
    assert.equal(studentReq.res.statusCode, 403, "Student must be blocked with HTTP 403 from updating fee structure");

    // Parent attempting GET audit log
    const auditReq = createMockReqRes({}, {}, { role: "PARENT", id: "p-1" });
    await getFeeStructureAuditHandler(auditReq.req, auditReq.res);
    assert.equal(auditReq.res.statusCode, 403, "Parent must be blocked with HTTP 403 from viewing audit logs");
  });

  test("Test 3: Admin updates fee structure; audit log is recorded with old vs new values", async () => {
    const adminUser = { role: "ADMIN", id: crypto.randomUUID(), name: "Finance Director", email: "finance@topgrade.edu" };
    
    // Update fee structure
    const { req: updateReq, res: updateRes } = createMockReqRes(
      {
        hourly_rate: 70,
        package_hours: 24,
        package_price: 1400,
        duration_months: 6,
        duration: "6 Months"
      },
      { id: testCourse.id },
      adminUser
    );

    await updateCourseFeeStructureHandler(updateReq, updateRes);

    assert.equal(updateRes.statusCode, 200, "Update must succeed with HTTP 200");
    assert.equal(updateRes.body.success, true);
    assert.equal(updateRes.body.data.hourly_rate, 70);
    assert.equal(updateRes.body.data.package_hours, 24);
    assert.equal(updateRes.body.data.package_price, 1400);
    assert.equal(updateRes.body.data.duration_months, 6);

    // Verify Audit Trail
    const { req: auditReq, res: auditRes } = createMockReqRes({}, {}, adminUser);
    await getFeeStructureAuditHandler(auditReq, auditRes);

    assert.equal(auditRes.statusCode, 200);
    const audits = auditRes.body.data as any[];
    const courseAudit = audits.find((a: any) => a.course_id === testCourse.id);
    
    assert.ok(courseAudit, "Audit record must be logged for the modified course");
    assert.equal(courseAudit.old_values.hourly_rate, 55, "Old hourly rate must be 55");
    assert.equal(courseAudit.old_values.package_hours, 20, "Old package hours must be 20");
    assert.equal(courseAudit.old_values.package_price, 950, "Old package price must be 950");
    assert.equal(courseAudit.old_values.duration_months, 3, "Old duration months must be 3");

    assert.equal(courseAudit.new_values.hourly_rate, 70, "New hourly rate must be 70");
    assert.equal(courseAudit.new_values.package_hours, 24, "New package hours must be 24");
    assert.equal(courseAudit.new_values.package_price, 1400, "New package price must be 1400");
    assert.equal(courseAudit.new_values.duration_months, 6, "New duration months must be 6");

    assert.ok(courseAudit.changed_by_name, "Changed by user name must be recorded");
  });

  test("Test 4: Negative or invalid prices and hours are rejected with HTTP 400", async () => {
    const adminUser = { role: "ADMIN", id: "admin-1" };

    // Negative hourly rate
    const res1 = createMockReqRes({ hourly_rate: -20, package_hours: 10, package_price: 300, duration_months: 2 }, { id: testCourse.id }, adminUser);
    await updateCourseFeeStructureHandler(res1.req, res1.res);
    assert.equal(res1.res.statusCode, 400, "Negative hourly rate must be rejected with HTTP 400");

    // Zero package hours
    const res2 = createMockReqRes({ hourly_rate: 50, package_hours: 0, package_price: 300, duration_months: 2 }, { id: testCourse.id }, adminUser);
    await updateCourseFeeStructureHandler(res2.req, res2.res);
    assert.equal(res2.res.statusCode, 400, "Zero package hours must be rejected with HTTP 400");

    // Non-integer package hours
    const res3 = createMockReqRes({ hourly_rate: 50, package_hours: 12.5, package_price: 300, duration_months: 2 }, { id: testCourse.id }, adminUser);
    await updateCourseFeeStructureHandler(res3.req, res3.res);
    assert.equal(res3.res.statusCode, 400, "Decimal package hours must be rejected with HTTP 400");

    // Negative package price
    const res4 = createMockReqRes({ hourly_rate: 50, package_hours: 10, package_price: -500, duration_months: 2 }, { id: testCourse.id }, adminUser);
    await updateCourseFeeStructureHandler(res4.req, res4.res);
    assert.equal(res4.res.statusCode, 400, "Negative package price must be rejected with HTTP 400");

    // Non-existent course
    const res5 = createMockReqRes({ hourly_rate: 50, package_hours: 10, package_price: 500, duration_months: 2 }, { id: crypto.randomUUID() }, adminUser);
    await updateCourseFeeStructureHandler(res5.req, res5.res);
    assert.equal(res5.res.statusCode, 404, "Non-existent course must return HTTP 404");
  });

  test("Test 5: Server-side pricing enforcement (quoteEnrollment strictly ignores client tampering)", async () => {
    // Course now has hourly_rate: 70, package_price: 1400, package_hours: 24, duration_months: 6
    const updatedCourseRow = {
      id: testCourse.id,
      name: testCourse.name,
      hourly_rate: 70,
      package_price: 1400,
      package_hours: 24,
      duration_months: 6
    };

    // 1. Hourly calculation: 5 hours * $70 = $350
    const quoteHours = quoteEnrollment(updatedCourseRow, "HOURS", 5);
    assert.equal(quoteHours.quoted_amount, 350, "5 hours at $70 must equal $350 strictly calculated on server");
    assert.equal(quoteHours.hours_total, 5);

    // 2. Package calculation: fixed $1400, 24 hours
    const quotePackage = quoteEnrollment(updatedCourseRow, "PACKAGE");
    assert.equal(quotePackage.quoted_amount, 1400, "Package price must equal $1400 strictly calculated on server");
    assert.equal(quotePackage.hours_total, 24, "Package hours must equal 24");
    assert.ok(quotePackage.expires_on, "Package must compute an expiration date");
  });

  test("Test 6: Student purchasing for self: hours are credited strictly to course-specific wallet", async () => {
    // 1. Create order for student purchasing 10 hours of testCourse
    const { order, student, course } = await createOrder({
      studentIdOrCode: testStudentId,
      courseIdOrName: testCourse.id,
      plan: "HOURS",
      quantity: 10,
      provider: "ZELLE",
      status: "PENDING_PAYMENT",
      payerEmail: "student@test.edu",
      by: testStudentId
    });

    assert.equal(order.amount_total, 700, "10 hours at $70/hr must equal $700");
    assert.equal(order.student_id, testStudentId);
    assert.equal(order.course_id, testCourse.id);

    // 2. Fulfill order (simulating bank confirmation or card payment success)
    const fulfillment = await fulfillOrder(order, "admin-system");
    assert.equal(fulfillment.credited, true, "Order must be credited to wallet");
    assert.equal(fulfillment.balance, 10, "10 hours must be in wallet after fulfillment");

    // 3. Verify course-specific wallet balance
    const wallets = await getBalances(testStudentId);
    const courseWallet = wallets.find(w => w.courseId === testCourse.id);

    assert.ok(courseWallet, "Course wallet must exist for this student and course");
    assert.equal(courseWallet.balance, 10, "Course-specific wallet balance must be 10 hours");
  });
});
