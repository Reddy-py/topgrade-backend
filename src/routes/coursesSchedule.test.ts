import { test, describe, before, after } from "node:test";
import assert from "node:assert/strict";
import crypto from "node:crypto";
import { createCourseHandler, editCourseHandler } from "./courses.js";
import { ScheduleDataService } from "../services/scheduleDataService.js";
import { markAttendance } from "../services/attendanceService.js";
import { applyTokens, getBalances } from "../services/tokenService.js";
import { supabaseAdmin } from "../supabase.js";

function createMockReqRes(body: any, params: any = {}, user: any = { role: "ADMIN", id: "admin-1" }) {
  const req: any = {
    body,
    params,
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

describe("TASK 17 - PART D: Courses Create the Schedule & Collisions", () => {
  const createdCourseIds: string[] = [];
  const createdScheduleIds: string[] = [];
  const testStudentId = crypto.randomUUID();

  before(async () => {
    // Seed test student with valid UUID
    await supabaseAdmin.from("students").insert({
      id: testStudentId,
      name: "Test PartD Student",
      email: `partd_student_${Date.now()}@test.edu`,
      student_id_code: `STD-D-${Math.floor(1000 + Math.random() * 9000)}`
    });
  });

  after(async () => {
    // Clean up created schedules
    if (createdScheduleIds.length > 0) {
      await supabaseAdmin.from("schedules").delete().in("id", createdScheduleIds);
    }
    // Clean up created courses
    if (createdCourseIds.length > 0) {
      await supabaseAdmin.from("courses").delete().in("id", createdCourseIds);
    }
    // Clean up test student
    await supabaseAdmin.from("students").delete().eq("id", testStudentId);
  });

  test("Test 1: Creating 1-hour course with Mon, Wed, Fri creates 3 schedule slots with 60m duration and duration_hours: 1", async () => {
    const coursePayload = {
      name: `PartD 1-Hour Test Course ${Date.now()}`,
      category: "Math & Logic",
      class_length: 1,
      weekdays: ["Monday", "Wednesday", "Friday"],
      start_time: "09:00 AM",
      room: "Room 101-A",
      location: "Main Campus",
      program_type: "TUTORING",
      max_students: 15,
      hourly_rate: 40,
      package_hours: 20,
      package_price: 700
    };

    const { req, res } = createMockReqRes(coursePayload);
    await createCourseHandler(req, res);

    assert.equal(res.statusCode, 201, `Expected status 201, got ${res.statusCode}: ${JSON.stringify(res.body)}`);
    assert.equal(res.body?.success, true);
    assert.ok(res.body?.data?.id);
    createdCourseIds.push(res.body.data.id);

    const slots = res.body?.createdSlots || [];
    assert.equal(slots.length, 3, "Must create exactly 3 slots for Mon, Wed, Fri");

    for (const slot of slots) {
      createdScheduleIds.push(slot.id);
      assert.equal(slot.duration_hours, 1, "Slot duration_hours must be 1");
      assert.ok(slot.time_slot.includes("09:00 AM - 10:00 AM") || slot.end_time === "10:00 AM", `Slot end time must be 10:00 AM: ${slot.time_slot}`);
      assert.ok(["Monday", "Wednesday", "Friday"].includes(slot.day_of_week));
    }
  });

  test("Test 2: Creating 2-hour course with Tue, Thu creates 2 schedule slots with 120m duration and duration_hours: 2", async () => {
    const coursePayload = {
      name: `PartD 2-Hour Test Course ${Date.now()}`,
      category: "STEM & Technology",
      class_length: 2,
      weekdays: ["Tuesday", "Thursday"],
      start_time: "02:00 PM",
      room: "Lab 201-B",
      location: "STEM Center",
      program_type: "BOOTCAMP",
      max_students: 20,
      hourly_rate: 60,
      package_hours: 40,
      package_price: 2000
    };

    const { req, res } = createMockReqRes(coursePayload);
    await createCourseHandler(req, res);

    assert.equal(res.statusCode, 201, `Expected status 201, got ${res.statusCode}: ${JSON.stringify(res.body)}`);
    assert.equal(res.body?.success, true);
    assert.ok(res.body?.data?.id);
    createdCourseIds.push(res.body.data.id);

    const slots = res.body?.createdSlots || [];
    assert.equal(slots.length, 2, "Must create exactly 2 slots for Tue, Thu");

    for (const slot of slots) {
      createdScheduleIds.push(slot.id);
      assert.equal(slot.duration_hours, 2, "Slot duration_hours must be 2");
      assert.ok(slot.time_slot.includes("02:00 PM - 04:00 PM") || slot.end_time === "04:00 PM", `Slot end time must be 04:00 PM: ${slot.time_slot}`);
      assert.ok(["Tuesday", "Thursday"].includes(slot.day_of_week));
    }
  });

  test("Test 3: Creating a course with a slot that collides with an existing room aborts atomically with 0 course created", async () => {
    // 1. Create a baseline course that occupies Room Collision-999 on Monday 11:00 AM - 12:00 PM
    const baselinePayload = {
      name: `Baseline Room Occupation ${Date.now()}`,
      category: "Science",
      class_length: 1,
      weekdays: ["Monday"],
      start_time: "11:00 AM",
      room: "Room Collision-999",
      location: "Main Campus"
    };

    const { req: bReq, res: bRes } = createMockReqRes(baselinePayload);
    await createCourseHandler(bReq, bRes);
    assert.equal(bRes.statusCode, 201);
    createdCourseIds.push(bRes.body.data.id);
    for (const s of bRes.body.createdSlots || []) {
      createdScheduleIds.push(s.id);
    }

    // 2. Attempt to create a new course with Monday and Wednesday in the SAME room at overlapping time (11:30 AM - 12:30 PM)
    const collidingPayload = {
      name: `Colliding Course ${Date.now()}`,
      category: "Science",
      class_length: 1,
      weekdays: ["Monday", "Wednesday"],
      start_time: "11:30 AM",
      room: "Room Collision-999",
      location: "Main Campus"
    };

    const { req: cReq, res: cRes } = createMockReqRes(collidingPayload);
    await createCourseHandler(cReq, cRes);

    assert.equal(cRes.statusCode, 409, `Must reject collision with 409, got ${cRes.statusCode}`);
    assert.equal(cRes.body?.success, false);
    assert.ok(cRes.body?.message?.includes("Room Collision") || cRes.body?.message?.includes("Collision-999"), `Message must name the conflict: ${cRes.body?.message}`);

    // Verify atomic rollback: course was NOT created
    const { data: phantomCourse } = await supabaseAdmin
      .from("courses")
      .select("id")
      .eq("name", collidingPayload.name)
      .maybeSingle();
    assert.equal(phantomCourse, null, "Course must be completely rolled back");
  });

  test("Test 4: Marking attendance for a 2-hour class deducts 2 hours from token balance; marking absent deducts 0 hours", async () => {
    // 1. Create a 2-hour course
    const coursePayload = {
      name: `Attendance 2-Hour Test Course ${Date.now()}`,
      category: "STEM & Technology",
      class_length: 2,
      weekdays: ["Monday"],
      start_time: "01:00 PM",
      room: `Lab Attend-${Date.now()}`,
      location: "Main Campus"
    };
    const { req: cReq, res: cRes } = createMockReqRes(coursePayload);
    await createCourseHandler(cReq, cRes);
    assert.equal(cRes.statusCode, 201);
    const course = cRes.body.data;
    createdCourseIds.push(course.id);
    for (const s of cRes.body.createdSlots || []) createdScheduleIds.push(s.id);

    // 2. Credit 10 hours to student wallet
    const initialCredit = await applyTokens({
      studentId: testStudentId,
      courseId: course.id,
      delta: 10,
      reason: "PURCHASE",
      ref: `seed-hours-${Date.now()}`
    });
    assert.equal(initialCredit.balance, 10, "Initial wallet balance should be 10");

    // 3. Mark student PRESENT for a 2-hour session
    const markRes1 = await markAttendance({
      studentIdOrCode: testStudentId,
      status: "PRESENT",
      scanMethod: "MANUAL_MARKING",
      courseId: course.id,
      courseName: course.name,
      date: "2026-10-26",
      hours: 2,
      remarks: "Present for 2-hour session"
    });

    assert.equal(markRes1.token.remaining, 8, "Balance must be 8 after deducting 2 hours for a 2-hour class");

    // 4. Mark student ABSENT on next session
    await markAttendance({
      studentIdOrCode: testStudentId,
      status: "ABSENT",
      scanMethod: "MANUAL_MARKING",
      courseId: course.id,
      courseName: course.name,
      date: "2026-10-27",
      hours: 2,
      remarks: "Absent from class"
    });

    const balances = await getBalances(testStudentId);
    const courseBal = balances.find(b => b.courseId === course.id);
    assert.equal(courseBal?.balance, 8, "Balance must remain 8 (0 hours deducted for absent mark)");
  });

  test("Test 5: Changing class_length on a course with enrolled students is rejected with HTTP 400", async () => {
    // 1. Create a course
    const coursePayload = {
      name: `Locked Class Length Course ${Date.now()}`,
      category: "Language",
      class_length: 1,
      weekdays: ["Friday"],
      start_time: "03:00 PM",
      room: `Room Lock-${Date.now()}`,
      location: "Language Center"
    };

    const { req: cReq, res: cRes } = createMockReqRes(coursePayload);
    await createCourseHandler(cReq, cRes);
    assert.equal(cRes.statusCode, 201);
    const courseId = cRes.body.data.id;
    createdCourseIds.push(courseId);
    const slotId = cRes.body.createdSlots[0].id;
    createdScheduleIds.push(slotId);

    // 2. Enroll student in the slot
    await ScheduleDataService.enrollStudentInSchedule({
      schedule_id: slotId,
      student_id: testStudentId,
      student_name: "Test PartD Student"
    });

    // 3. Attempt to update class_length from 1 to 2
    const { req: uReq, res: uRes } = createMockReqRes(
      { class_length: 2, name: coursePayload.name },
      { id: courseId }
    );
    await editCourseHandler(uReq, uRes);

    assert.equal(uRes.statusCode, 400, `Expected HTTP 400 for locked class length, got ${uRes.statusCode}`);
    assert.equal(uRes.body?.success, false);
    assert.ok(uRes.body?.message?.includes("cannot be changed once students are enrolled"), `Expected lock error message, got: ${uRes.body?.message}`);
  });

  test("Test 6: Race-safe concurrent creation tests with two simultaneous overlapping requests", async () => {
    const sharedRoom = `Room Race-${Date.now()}`;

    const payloadA = {
      name: `Race Course A ${Date.now()}`,
      category: "Math",
      class_length: 1,
      weekdays: ["Saturday"],
      start_time: "10:00 AM",
      room: sharedRoom,
      location: "Main Building"
    };

    const payloadB = {
      name: `Race Course B ${Date.now()}`,
      category: "Math",
      class_length: 1,
      weekdays: ["Saturday"],
      start_time: "10:00 AM",
      room: sharedRoom,
      location: "Main Building"
    };

    const { req: reqA, res: resA } = createMockReqRes(payloadA);
    const { req: reqB, res: resB } = createMockReqRes(payloadB);

    // Dispatch both concurrently
    await Promise.all([
      createCourseHandler(reqA, resA),
      createCourseHandler(reqB, resB)
    ]);

    const statuses = [resA.statusCode, resB.statusCode];
    assert.ok(statuses.includes(201), `At least one request must succeed (201), got: ${statuses.join(", ")}`);
    assert.ok(statuses.includes(409), `The conflicting request must be rejected with 409 collision, got: ${statuses.join(", ")}`);

    if (resA.statusCode === 201) {
      createdCourseIds.push(resA.body.data.id);
      for (const s of resA.body.createdSlots || []) createdScheduleIds.push(s.id);
    }
    if (resB.statusCode === 201) {
      createdCourseIds.push(resB.body.data.id);
      for (const s of resB.body.createdSlots || []) createdScheduleIds.push(s.id);
    }
  });
});
