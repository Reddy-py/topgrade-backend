import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import crypto from "node:crypto";
import type { AccessScope } from "./accessScope.js";

// Ensure static offline init works cleanly with zero live Supabase env vars
process.env.NODE_ENV = "test";
process.env.SIMULATE_EMAILS = "true";
process.env.SUPABASE_URL = process.env.SUPABASE_URL || "https://synthetic-test.supabase.co";
process.env.SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || "synthetic-service-role-key";
process.env.ADMIN_EMAIL = "admin.notify@example.org";

/**
 * Isolated synthetic end-to-end verification (in-memory DB stub + simulated mailer).
 * Zero real database writes and zero real emails are dispatched.
 */
function buildMockReqRes(body: any = {}, params: any = {}, user: any = { role: "ADMIN", id: "admin-1", email: "admin@synthetic.test" }, query: any = {}) {
  const req: any = { body, params, query, user, headers: {} };
  const res: any = {
    statusCode: 200,
    body: null,
    status(c: number) {
      this.statusCode = c;
      return this;
    },
    json(d: any) {
      this.body = d;
      return this;
    },
  };
  return { req, res };
}

describe("Synthetic E2E: $1/hr Continuous Token Billing, Registration, Teacher Sync & Dual Attendance Emails", () => {
  let supabaseAdmin: any;
  let createCourseHandler: any;
  let getCoursesHandler: any;
  let getFeeStructureHandler: any;
  let getBalances: any;
  let createOrder: any;
  let fulfillOrder: any;
  let ScheduleSlotService: any;
  let scopeSchedules: any;
  let slotBelongsToTeacher: any;
  let markAttendance: any;
  let sendDailyAttendanceRollCallEmail: any;
  let sendCompletedClassAttendanceReportEmail: any;

  let origFrom: any;
  let origRpc: any;
  const origSim = process.env.SIMULATE_EMAILS;

  const courseId = crypto.randomUUID();
  const student1Id = crypto.randomUUID();
  const student2Id = crypto.randomUUID();
  const teacherId = crypto.randomUUID();
  const teacherAuthId = crypto.randomUUID();
  const slot1hrId = `sch-1hr-${Date.now()}`;
  const slot2hrId = `sch-2hr-${Date.now()}`;

  const tables: Record<string, any[]> = {
    courses: [],
    students: [
      {
        id: student1Id,
        name: "Aarav Synthetic",
        student_id_code: "TG-STU-SYN-1",
        email: "aarav.student@example.org",
        parent_emails: ["aarav.mom@example.org", "aarav.dad@example.org"],
        status: "ACTIVE",
        purchased_hours: 0,
      },
      {
        id: student2Id,
        name: "Maya Synthetic",
        student_id_code: "TG-STU-SYN-2",
        email: "maya.student@example.org",
        parent_emails: ["maya.parent@example.org"],
        status: "ACTIVE",
        purchased_hours: 0,
      },
    ],
    teachers: [
      {
        id: teacherId,
        user_id: teacherAuthId,
        teacher_id_code: "TCH-SYN-01",
        name: "Prof. Elena Tutor",
        email: "elena.teacher@example.org",
        status: "Active",
      },
    ],
    schedules: [
      {
        id: slot1hrId,
        course_id: courseId,
        course_name: "Continuous Robotics Track",
        teacher_id: teacherId,
        teacher_name: "Prof. Elena Tutor",
        day_of_week: "Monday",
        start_time: "10:00 AM",
        end_time: "11:00 AM",
        time_slot: "10:00 AM - 11:00 AM",
        duration_hours: 1,
        max_capacity: 15,
        room: "Lab 1",
        status: "active",
        is_active: true,
        open_for_teachers: false,
        start_at: new Date(Date.now() + 72 * 3600 * 1000).toISOString(),
        end_at: new Date(Date.now() + 73 * 3600 * 1000).toISOString(),
      },
      {
        id: slot2hrId,
        course_id: courseId,
        course_name: "Continuous Robotics Track",
        teacher_id: teacherId,
        teacher_name: "Prof. Elena Tutor",
        day_of_week: "Wednesday",
        start_time: "02:00 PM",
        end_time: "04:00 PM",
        time_slot: "02:00 PM - 04:00 PM",
        duration_hours: 2,
        max_capacity: 15,
        room: "Lab 2",
        status: "active",
        is_active: true,
        open_for_teachers: false,
        start_at: new Date(Date.now() + 96 * 3600 * 1000).toISOString(),
        end_at: new Date(Date.now() + 98 * 3600 * 1000).toISOString(),
      },
    ],
    student_enrollments: [],
    token_wallets: [],
    token_ledger: [],
    token_orders: [],
    attendance: [],
    email_log: [],
    email_templates: [],
    institute_settings: [
      {
        id: "default",
        institute_name: "TopGrade Learning Test",
        admin_notification_email: "admin.notify@example.org",
      },
    ],
    domain_events: [],
    history_logs: [],
  };

  function makeBuilder(table: string) {
    const state: any = {
      filters: [] as Array<(r: any) => boolean>,
      op: "select",
      payload: null,
      singleMode: false,
      maybeMode: false,
    };

    const run = () => {
      const list = tables[table] || [];
      if (state.op === "select") {
        let rows = list.filter(r => state.filters.every((fn: any) => fn(r)));
        // Join helper for student_enrollments -> students
        if (table === "student_enrollments") {
          rows = rows.map(enr => ({
            ...enr,
            students: (tables.students || []).find(s => s.id === enr.student_id) || null,
            schedules: (tables.schedules || []).find(sc => sc.id === enr.slot_id) || null,
          }));
        }
        if (table === "attendance") {
          rows = rows.map(att => ({
            ...att,
            schedules: (tables.schedules || []).find(sc => sc.id === att.schedule_id) || null,
          }));
        }
        if (state.singleMode || state.maybeMode) {
          return { data: rows[0] || null, error: null };
        }
        return { data: rows, error: null, count: rows.length };
      }

      if (state.op === "insert") {
        const items = Array.isArray(state.payload) ? state.payload : [state.payload];
        const inserted: any[] = [];
        for (const item of items) {
          const row = {
            id: item.id || crypto.randomUUID(),
            created_at: item.created_at || new Date().toISOString(),
            ...item,
          };
          if (table === "courses" && !item.id) row.id = courseId;
          list.push(row);
          inserted.push(row);
        }
        return state.singleMode || state.maybeMode
          ? { data: inserted[0], error: null }
          : { data: inserted, error: null };
      }

      if (state.op === "upsert") {
        const items = Array.isArray(state.payload) ? state.payload : [state.payload];
        const upserted: any[] = [];
        for (const item of items) {
          const idx = list.findIndex(r =>
            table === "token_wallets"
              ? r.student_id === item.student_id && r.course_id === item.course_id
              : r.id === item.id
          );
          if (idx >= 0) {
            list[idx] = { ...list[idx], ...item };
            upserted.push(list[idx]);
          } else {
            const row = { id: item.id || crypto.randomUUID(), ...item };
            list.push(row);
            upserted.push(row);
          }
        }
        return { data: upserted[0], error: null };
      }

      if (state.op === "update") {
        const matched = list.filter(r => state.filters.every((fn: any) => fn(r)));
        for (const r of matched) Object.assign(r, state.payload);
        return state.singleMode || state.maybeMode
          ? { data: matched[0] || null, error: null }
          : { data: matched, error: null };
      }

      if (state.op === "delete") {
        tables[table] = list.filter(r => !state.filters.every((fn: any) => fn(r)));
        return { data: [], error: null };
      }
      return { data: null, error: null };
    };

    const builder: any = {
      select(_cols?: string, opts?: any) {
        if (state.op === "insert" || state.op === "update" || state.op === "upsert") return builder;
        state.op = "select";
        if (opts?.head) return builder;
        return builder;
      },
      insert(p: any) { state.op = "insert"; state.payload = p; return builder; },
      upsert(p: any) { state.op = "upsert"; state.payload = p; return builder; },
      update(p: any) { state.op = "update"; state.payload = p; return builder; },
      delete() { state.op = "delete"; return builder; },
      eq(col: string, val: any) { state.filters.push((r: any) => String(r[col] ?? "") === String(val ?? "")); return builder; },
      neq(col: string, val: any) { state.filters.push((r: any) => String(r[col] ?? "") !== String(val ?? "")); return builder; },
      ilike(col: string, val: any) {
        const clean = String(val || "").replace(/%/g, "").toLowerCase();
        state.filters.push((r: any) => String(r[col] || "").toLowerCase().includes(clean));
        return builder;
      },
      in(col: string, vals: any[]) {
        const set = new Set((vals || []).map(v => String(v)));
        state.filters.push((r: any) => set.has(String(r[col])));
        return builder;
      },
      is(col: string, val: any) { state.filters.push((r: any) => r[col] === val); return builder; },
      not(col: string, _op: string, val: any) { state.filters.push((r: any) => r[col] !== val); return builder; },
      gt(col: string, val: any) { state.filters.push((r: any) => String(r[col] || "") > String(val)); return builder; },
      gte(col: string, val: any) { state.filters.push((r: any) => String(r[col] || "") >= String(val)); return builder; },
      lt(col: string, val: any) { state.filters.push((r: any) => String(r[col] || "") < String(val)); return builder; },
      lte(col: string, val: any) { state.filters.push((r: any) => String(r[col] || "") <= String(val)); return builder; },
      like(col: string, pattern: string) {
        const pref = pattern.replace(/%/g, "");
        state.filters.push((r: any) => String(r[col] || "").startsWith(pref));
        return builder;
      },
      or(_expr: string) { return builder; },
      order() { return builder; },
      limit() { return builder; },
      single() { state.singleMode = true; return Promise.resolve(run()); },
      maybeSingle() { state.maybeMode = true; return Promise.resolve(run()); },
      then(resolve: any, reject: any) { return Promise.resolve(run()).then(resolve, reject); },
    };
    return builder;
  }

  before(async () => {
    ({ supabaseAdmin } = await import("../supabase.js"));
    ({ createCourseHandler, getCoursesHandler, getFeeStructureHandler } = await import("../routes/courses.js"));
    ({ getBalances, createOrder, fulfillOrder } = await import("./tokenService.js"));
    ({ ScheduleSlotService } = await import("./scheduleSlotService.js"));
    ({ scopeSchedules, slotBelongsToTeacher } = await import("./accessScope.js"));
    ({ markAttendance } = await import("./attendanceService.js"));
    ({ sendDailyAttendanceRollCallEmail, sendCompletedClassAttendanceReportEmail } = await import("./notificationService.js"));

    origFrom = supabaseAdmin.from.bind(supabaseAdmin);
    origRpc = supabaseAdmin.rpc.bind(supabaseAdmin);
    process.env.SIMULATE_EMAILS = "true";
    process.env.ADMIN_EMAIL = "admin.notify@example.org";
    (supabaseAdmin as any).from = (table: string) => {
      if (table === "student_course_balance") {
        // Compute directly from synthetic token_ledger
        const agg = new Map<string, any>();
        for (const l of tables.token_ledger || []) {
          const k = `${l.student_id}:${l.course_id}`;
          if (!agg.has(k)) agg.set(k, { student_id: l.student_id, course_id: l.course_id, available_tokens: 0 });
          agg.get(k).available_tokens += Number(l.hours ?? l.delta ?? 0);
        }
        const rows = Array.from(agg.values());
        return {
          select() { return this; },
          eq(c: string, v: any) {
            return Promise.resolve({ data: rows.filter((r: any) => r[c] === v), error: null });
          },
          in(c: string, vs: any[]) {
            return Promise.resolve({ data: rows.filter((r: any) => vs.includes(r[c])), error: null });
          },
        };
      }
      if (!tables[table]) tables[table] = [];
      return makeBuilder(table);
    };
    (supabaseAdmin as any).rpc = async (fn: string) => {
      if (fn === "token_apply") return { data: null, error: { message: "use TS fallback" } };
      return { data: null, error: null };
    };
  });

  after(() => {
    (supabaseAdmin as any).from = origFrom;
    (supabaseAdmin as any).rpc = origRpc;
    process.env.SIMULATE_EMAILS = origSim;
  });

  it("1. Defaults new course to $1.00/hr and Continuous (No End Date) & allows Student catalog browsing", async () => {
    const { req, res } = buildMockReqRes({
      name: "Continuous Robotics Track",
      category: "Robotics",
    });
    await createCourseHandler(req, res);
    assert.equal(res.statusCode, 201);
    assert.equal(res.body.data.hourly_rate, 1);
    assert.equal(res.body.data.duration_months, null);
    assert.equal(res.body.data.duration, "Continuous (No End Date)");

    // Fee structure endpoint also returns $1/hr & continuous
    const feeMock = buildMockReqRes();
    await getFeeStructureHandler(feeMock.req, feeMock.res);
    assert.equal(feeMock.res.statusCode, 200);
    assert.equal(feeMock.res.body.data[0].hourly_rate, 1);
    assert.equal(feeMock.res.body.data[0].duration, "Continuous (No End Date)");

    // Student can browse active catalog without pre-enrollment
    const stuCourses = buildMockReqRes({}, {}, { role: "STUDENT", id: student1Id, email: "aarav.student@example.org" });
    await getCoursesHandler(stuCourses.req, stuCourses.res);
    assert.equal(stuCourses.res.statusCode, 200);
    assert.equal(stuCourses.res.body.data.length, 1);
    assert.deepEqual(stuCourses.res.body.data[0].mapped_students, []);
  });

  it("2. Blocks slot booking with 0 tokens, allows custom token buy ($1/token), and deducts 1 token (1hr) and 2 tokens (2hr) cleanly", async () => {
    // 0 tokens -> rejected
    await assert.rejects(
      () => ScheduleSlotService.bookSlot(student1Id, slot1hrId),
      /Insufficient tokens/i
    );

    // Student buys 3 tokens ($3.00)
    const { order } = await createOrder({
      studentIdOrCode: student1Id,
      courseIdOrName: courseId,
      quantity: 3,
      plan: "HOURS",
      provider: "OTHER",
      providerRef: "INSTANT_TOKEN_PORTAL",
      status: "PENDING_PAYMENT",
      by: student1Id,
    });
    assert.equal(order.amount_total, 3);
    assert.equal(order.quantity, 3);

    const ful = await fulfillOrder(order, student1Id);
    assert.equal(ful.balance, 3);

    // Register 1-hour slot -> deducts 1 token (3 -> 2)
    const book1 = await ScheduleSlotService.bookSlot(student1Id, slot1hrId);
    assert.equal(book1.tokensDeducted, 1);
    assert.equal(book1.balance, 2);

    // Register 2-hour slot -> deducts 2 tokens (2 -> 0)
    const book2 = await ScheduleSlotService.bookSlot(student1Id, slot2hrId);
    assert.equal(book2.tokensDeducted, 2);
    assert.equal(book2.balance, 0);

    const wallets = await getBalances(student1Id);
    assert.equal(wallets[0]?.balance, 0);
    assert.equal(wallets[0]?.totalUsed, 3);
  });

  it("3. Scopes schedules cleanly for Assigned Teacher and Students (privacy preserved)", async () => {
    const teacherScope: AccessScope = {
      role: "TEACHER",
      unrestricted: false,
      studentKeys: new Set(),
      teacherKeys: new Set([teacherId.toLowerCase(), "elena.teacher@example.org", "tch-syn-01"]),
      teacherNames: new Set(["prof. elena tutor"]),
      courseKeys: new Set(),
    };
    const slots = await ScheduleSlotService.listSlots();
    assert.ok(slotBelongsToTeacher(slots[0], teacherScope));
    const teacherVisible = scopeSchedules(slots, teacherScope);
    assert.equal(teacherVisible.length, 2);
    assert.equal(teacherVisible[0].students.length, 1);
    assert.equal(teacherVisible[0].students[0].student_id, student1Id);

    // Student 2 (not enrolled yet) still sees active slots with 0 students leaked
    const student2Scope: AccessScope = {
      role: "STUDENT",
      unrestricted: false,
      studentKeys: new Set([student2Id.toLowerCase()]),
      teacherKeys: new Set(),
      teacherNames: new Set(),
      courseKeys: new Set(),
    };
    const student2Visible = scopeSchedules(slots, student2Scope);
    assert.equal(student2Visible.length, 2);
    assert.equal(student2Visible[0].booked_count, 1);
    assert.equal(student2Visible[0].students.length, 0); // Other students scrubbed!
  });

  it("4. Attendance marking never double-deducts registration-paid tokens & emails BOTH Student + Parents + Teacher + Admin", async () => {
    // Student 2 also registers for 1hr slot first (buys 5 tokens, spends 1 -> 4 remaining)
    const { order: o2 } = await createOrder({
      studentIdOrCode: student2Id,
      courseIdOrName: courseId,
      quantity: 5,
      plan: "HOURS",
      provider: "OTHER",
      providerRef: "INSTANT_TOKEN_PORTAL",
      status: "PENDING_PAYMENT",
    });
    await fulfillOrder(o2, student2Id);
    await ScheduleSlotService.bookSlot(student2Id, slot1hrId);

    // Mark Aarav PRESENT and Maya ABSENT in 1-hr slot
    const today = "2026-11-26";
    const att1 = await markAttendance({
      studentIdOrCode: student1Id,
      status: "PRESENT",
      courseId,
      courseName: "Continuous Robotics Track",
      scheduleId: slot1hrId,
      date: today,
      hours: 1,
      scanMethod: "TEACHER_ROLLCALL",
    });
    const att2 = await markAttendance({
      studentIdOrCode: student2Id,
      status: "ABSENT",
      courseId,
      courseName: "Continuous Robotics Track",
      scheduleId: slot1hrId,
      date: today,
      hours: 1,
      scanMethod: "TEACHER_ROLLCALL",
    });

    // ZERO double deduction on registration-paid enrollments!
    assert.equal(att1.token.remaining, 0);
    assert.equal(att2.token.remaining, 4);

    // Individual Present/Absent notifications go to BOTH Student & ALL Parent emails
    tables.email_log = [];
    await sendDailyAttendanceRollCallEmail({
      studentEmail: "aarav.student@example.org",
      parentEmails: ["aarav.mom@example.org", "aarav.dad@example.org"],
      studentName: "Aarav Synthetic",
      courseName: "Continuous Robotics Track",
      date: today,
      status: "PRESENT",
      markedBy: "Prof. Elena Tutor",
    });
    await sendDailyAttendanceRollCallEmail({
      studentEmail: "maya.student@example.org",
      parentEmails: ["maya.parent@example.org"],
      studentName: "Maya Synthetic",
      courseName: "Continuous Robotics Track",
      date: today,
      status: "ABSENT",
      markedBy: "Prof. Elena Tutor",
    });

    const dailyLogs = (tables.email_log || []).filter(e => e.kind === "ATTENDANCE_DAILY");
    assert.equal(dailyLogs.length, 2);
    assert.deepEqual(dailyLogs[0].recipients, [
      "aarav.student@example.org",
      "aarav.mom@example.org",
      "aarav.dad@example.org",
    ]);
    assert.deepEqual(dailyLogs[1].recipients, [
      "maya.student@example.org",
      "maya.parent@example.org",
    ]);

    // Completed class full roster report goes to BOTH Teacher & Admin emails
    await sendCompletedClassAttendanceReportEmail({
      courseName: "Continuous Robotics Track",
      date: today,
      timeSlot: "10:00 AM - 11:00 AM",
      room: "Lab 1",
      teacherName: "Prof. Elena Tutor",
      teacherEmail: "elena.teacher@example.org",
      scheduleId: slot1hrId,
      entries: [
        { studentName: "Aarav Synthetic", studentCode: "TG-STU-SYN-1", status: "PRESENT", tokensRemaining: 0 },
        { studentName: "Maya Synthetic", studentCode: "TG-STU-SYN-2", status: "ABSENT", tokensRemaining: 4 },
      ],
    });

    const reportLogs = (tables.email_log || []).filter(e => e.kind === "ATTENDANCE_CLASS_REPORT");
    assert.equal(reportLogs.length, 1);
    assert.equal(reportLogs[0].recipients.length, 2);
    assert.equal(reportLogs[0].recipients[0], "elena.teacher@example.org");
    assert.ok(reportLogs[0].recipients[1].includes("@"), "Admin recipient email must be included");
    assert.match(reportLogs[0].subject, /1\/2 Present/);
    assert.match(reportLogs[0].body_preview, /Aarav Synthetic \(PRESENT\)/);
    assert.match(reportLogs[0].body_preview, /Maya Synthetic \(ABSENT\)/);
  });
});
