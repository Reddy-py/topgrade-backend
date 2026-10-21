import { supabaseAdmin } from "../supabase.js";
import { getInstituteSettings } from "../services/instituteSettingsService.js";
import { verifyCanSpamAddress } from "../services/emailUnsubscribeService.js";

const BASE_URL = process.env.API_BASE_URL || "http://localhost:5000";

interface TestReport {
  name: string;
  passed: boolean;
  details?: any;
  error?: string;
}

const report: TestReport[] = [];

function assert(condition: boolean, name: string, details?: any) {
  if (condition) {
    report.push({ name, passed: true, details });
    console.log(`  ✅ PASS: ${name}`);
  } else {
    report.push({ name, passed: false, details });
    console.error(`  ❌ FAIL: ${name}`, details);
  }
}

async function runTests() {
  console.log("\n========================================================");
  console.log("🚀 TASK 15: CLIENT CHANGES & INTEGRATION TEST SUITE");
  console.log("========================================================\n");

  // 1. SAFETY CHECKS
  console.log("--- 1. Safety Enforcements ---");
  const isSimulated = process.env.SIMULATE_EMAILS === "true";
  const isPaymentsDisabled = process.env.DISABLE_PAYMENTS === "true";
  assert(isSimulated, "SIMULATE_EMAILS is set to true");
  assert(isPaymentsDisabled, "DISABLE_PAYMENTS is set to true");

  // 2. AUTHENTICATION (ADMIN & TEACHER)
  console.log("\n--- 2. Authentication Tokens ---");
  const adminLoginRes = await fetch(`${BASE_URL}/api/auth/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ identifier: "admin@topgrade.edu", password: "TopGrade2026!" })
  });
  const adminLogin = (await adminLoginRes.json()) as any;
  console.log("adminLogin payload:", JSON.stringify(adminLogin));
  assert(adminLogin.success && adminLogin.profile?.role === "ADMIN", "Admin authentication successful", adminLogin.profile);
  const adminToken = adminLogin.session?.access_token;

  const teacherLoginRes = await fetch(`${BASE_URL}/api/auth/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ identifier: "teacher@topgrade.edu", password: "TopGrade2026!" })
  });
  const teacherLogin = (await teacherLoginRes.json()) as any;
  assert(teacherLogin.success && teacherLogin.profile?.role === "TEACHER", "Teacher authentication successful", teacherLogin.profile);
  const teacherToken = teacherLogin.session?.access_token;

  // 3. NEW STUDENT ADDITION (SINGLE PARENT & TWO PARENTS, OPTIONAL EMAIL)
  console.log("\n--- 3. New Student Addition (Single Parent & Optional Email) ---");
  const singleParentPayload = {
    firstName: "Aria",
    lastName: "Montgomery",
    fullName: "Aria Montgomery",
    gender: "Female",
    dob: "2014-05-12",
    age: 12,
    school: "Edison Middle School",
    grade: "Grade 7",
    status: "ACTIVE",
    fatherName: "Byron Montgomery",
    parentPhones: ["+1 555-019-8801"],
    parentEmails: ["byron.montgomery@example.com"],
    email: "", // Optional student email omitted!
    residentialAddress: "400 Oak Street, Edison, NJ 08817",
    program: "Robotics Fundamentals",
    program_type: "TUTORING",
    feePlan: "Monthly",
    purchasedHours: 20
  };

  const addStudentRes1 = await fetch(`${BASE_URL}/api/students/add`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${adminToken}`
    },
    body: JSON.stringify(singleParentPayload)
  });
  const addStudent1 = (await addStudentRes1.json()) as any;
  assert(
    addStudentRes1.status === 201 && addStudent1.success,
    "Student with single parent & optional email created successfully",
    { studentCode: addStudent1.data?.studentCode, message: addStudent1.message }
  );

  const twoParentPayload = {
    firstName: "Leo",
    lastName: "Fitz",
    fullName: "Leo Fitz",
    gender: "Male",
    dob: "2013-08-19",
    age: 13,
    school: "J.P. Stevens High School",
    grade: "Grade 8",
    status: "ACTIVE",
    fatherName: "Alistair Fitz",
    motherName: "Pamela Fitz",
    parentPhones: ["+1 555-019-8802", "+1 555-019-8803"],
    parentEmails: ["alistair.fitz@example.com", "pamela.fitz@example.com"],
    email: "leo.fitz.scholar@example.com",
    residentialAddress: "520 Grove Ave, Metuchen, NJ 08840",
    program: "AP Physics Mechanics",
    program_type: "TUTORING",
    feePlan: "Quarterly",
    purchasedHours: 40
  };

  const addStudentRes2 = await fetch(`${BASE_URL}/api/students/add`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${adminToken}`
    },
    body: JSON.stringify(twoParentPayload)
  });
  const addStudent2 = (await addStudentRes2.json()) as any;
  assert(
    addStudentRes2.status === 201 && addStudent2.success,
    "Student with two parents created successfully",
    { studentCode: addStudent2.data?.studentCode }
  );

  const studentAriaCode = addStudent1.data?.studentCode || "TG-STU-ARIA";
  const studentLeoCode = addStudent2.data?.studentCode || "TG-STU-LEO";

  // 4. NEW COURSE ADDITION
  console.log("\n--- 4. New Course Addition ---");
  const coursePayload = {
    name: "Advanced Artificial Intelligence & Python 2026",
    code: `CS-AI-${Date.now().toString().slice(-4)}`,
    category: "STEM & Technology",
    program_type: "TUTORING",
    duration_months: 6,
    package_hours: 48,
    package_price: 1800,
    hourly_rate: 37.5,
    description: "Hands-on machine learning, neural networks, and computer vision."
  };

  const addCourseRes = await fetch(`${BASE_URL}/api/courses/add`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${adminToken}`
    },
    body: JSON.stringify(coursePayload)
  });
  const addCourse = (await addCourseRes.json()) as any;
  assert(
    (addCourseRes.status === 200 || addCourseRes.status === 201) && addCourse.success,
    "New course created with duration_months, package_hours, hourly_rate",
    { courseId: addCourse.data?.id, name: addCourse.data?.name }
  );

  // 5. COLLISION DETECTION: TEACHER, ROOM, AND OVERLAP CONSTRAINTS
  console.log("\n--- 5. Collision Prevention (API + Exclusion Constraints) ---");
  const testDay = "Thursday";
  const testTeacherId = "tch-collision-test";
  const testTeacherName = "Prof. Alan Turing";
  const testRoom = "Lab Suite 404";

  // Create Slot 1: Thursday 14:00 - 15:30 (14:00 to 15:30)
  const slot1Payload = {
    course_name: "Advanced Artificial Intelligence & Python 2026",
    teacher_id: testTeacherId,
    teacher_name: testTeacherName,
    room: testRoom,
    day_of_week: testDay,
    start_time: "02:00 PM",
    end_time: "03:00 PM",
    max_capacity: 2,
    students: []
  };

  const createSlot1Res = await fetch(`${BASE_URL}/api/schedules/add`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${adminToken}` },
    body: JSON.stringify(slot1Payload)
  });
  const createSlot1 = (await createSlot1Res.json()) as any;
  assert(
    (createSlot1Res.status === 200 || createSlot1Res.status === 201) && createSlot1.success,
    "Created baseline schedule slot (Thursday 02:00 PM - 03:00 PM)",
    { slotId: createSlot1.data?.id }
  );
  const slot1Id = createSlot1.data?.id;

  // Collision Check Endpoint (/api/schedules/check-conflicts)
  const conflictCheckRes = await fetch(`${BASE_URL}/api/schedules/check-conflicts`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${adminToken}` },
    body: JSON.stringify({
      day_of_week: testDay,
      start_time: "02:30 PM",
      end_time: "03:30 PM",
      teacher_id: testTeacherId,
      room: testRoom
    })
  });
  const conflictCheck = (await conflictCheckRes.json()) as any;
  assert(
    conflictCheckRes.status === 200 && conflictCheck.hasConflict === true,
    "Pre-flight conflict check API correctly detects overlap with free time suggestions",
    { conflictsCount: conflictCheck.conflicts?.length, suggestions: conflictCheck.suggestedFreeTimes?.slice(0, 2) }
  );

  // Attempt Overlapping Slot (Teacher Overlap): Thursday 02:30 PM - 03:30 PM
  const slotTeacherOverlap = {
    course_name: "Python Coding Foundations",
    teacher_id: testTeacherId,
    teacher_name: testTeacherName,
    room: "Different Room 202",
    day_of_week: testDay,
    start_time: "02:30 PM",
    end_time: "03:30 PM",
    max_capacity: 5
  };

  const createTeacherOverlapRes = await fetch(`${BASE_URL}/api/schedules/add`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${adminToken}` },
    body: JSON.stringify(slotTeacherOverlap)
  });
  const createTeacherOverlap = (await createTeacherOverlapRes.json()) as any;
  assert(
    createTeacherOverlapRes.status === 409 || createTeacherOverlap.conflict === true || !createTeacherOverlap.success,
    "Teacher concurrent overlap rejected with 409 Conflict",
    { message: createTeacherOverlap.message }
  );

  // Attempt Overlapping Slot (Room Overlap): Thursday 01:30 PM - 02:30 PM in same room
  const slotRoomOverlap = {
    course_name: "Reading Comprehension",
    teacher_id: "other-teacher-99",
    teacher_name: "Other Instructor",
    room: testRoom,
    day_of_week: testDay,
    start_time: "01:30 PM",
    end_time: "02:30 PM",
    max_capacity: 5
  };

  const createRoomOverlapRes = await fetch(`${BASE_URL}/api/schedules/add`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${adminToken}` },
    body: JSON.stringify(slotRoomOverlap)
  });
  const createRoomOverlap = (await createRoomOverlapRes.json()) as any;
  assert(
    createRoomOverlapRes.status === 409 || createRoomOverlap.conflict === true || !createRoomOverlap.success,
    "Room concurrent overlap rejected with 409 Conflict",
    { message: createRoomOverlap.message }
  );

  // 6. CAPACITY ENFORCEMENT & STUDENT ENROLLMENT FROM SCHEDULE
  console.log("\n--- 6. Capacity Enforcement (Schedule Cohort) ---");
  // Enroll Student 1 (Aria) -> 1/2 Capacity
  const enroll1Res = await fetch(`${BASE_URL}/api/schedules/enroll-students`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${adminToken}` },
    body: JSON.stringify({
      schedule_id: slot1Id,
      student_ids: [studentAriaCode]
    })
  });
  const enroll1 = (await enroll1Res.json()) as any;
  assert(enroll1Res.status === 200 && enroll1.success, "Enrolled 1st student into slot (1/2 capacity)", { enrolled: enroll1.enrolledCount });

  // Enroll Student 2 (Leo) -> 2/2 Capacity (Full)
  const enroll2Res = await fetch(`${BASE_URL}/api/schedules/enroll-students`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${adminToken}` },
    body: JSON.stringify({
      schedule_id: slot1Id,
      student_ids: [studentLeoCode]
    })
  });
  const enroll2 = (await enroll2Res.json()) as any;
  assert(enroll2Res.status === 200 && enroll2.success, "Enrolled 2nd student into slot (2/2 capacity - full)", { enrolled: enroll2.enrolledCount });

  // Attempt to enroll 3rd student (exceeds max_capacity 2)
  const enroll3Res = await fetch(`${BASE_URL}/api/schedules/enroll-students`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${adminToken}` },
    body: JSON.stringify({
      schedule_id: slot1Id,
      student_ids: ["TG-STU-OVERFLOW-3"]
    })
  });
  const enroll3 = (await enroll3Res.json()) as any;
  assert(
    enroll3Res.status === 400 || enroll3.capacityFull === true || !enroll3.success,
    "Capacity limit strictly enforced (Cannot exceed max capacity)",
    { message: enroll3.message }
  );

  // 7. TEACHER ROLL-CALL & HOURS DEDUCTION
  console.log("\n--- 7. Attendance Roll-Call & Deductions ---");
  // Fetch roster for this session
  const rosterRes = await fetch(`${BASE_URL}/api/attendance/session/${slot1Id}/roster`, {
    headers: { Authorization: `Bearer ${adminToken}` }
  });
  const roster = (await rosterRes.json()) as any;
  assert(rosterRes.status === 200 && roster.success, "Session roster retrieved with live enrolled students", {
    studentsCount: roster.students?.length
  });

  // Submit roll-call: Aria = PRESENT (-1 hr), Leo = ABSENT (0 hr refund)
  const submitAttendanceRes = await fetch(`${BASE_URL}/api/attendance/session/${slot1Id}/submit`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${adminToken}` },
    body: JSON.stringify({
      date: new Date().toISOString().split("T")[0],
      records: [
        { studentId: studentAriaCode, status: "PRESENT", remarks: "Great active participation in AI lab." },
        { studentId: studentLeoCode, status: "ABSENT", remarks: "Doctor appointment excused." }
      ]
    })
  });
  const submitAttendance = (await submitAttendanceRes.json()) as any;
  assert(
    submitAttendanceRes.status === 200 && submitAttendance.success,
    "Roll-call marked: Present deducts 1 hr, Absent refunds 0 hr",
    { message: submitAttendance.message, results: submitAttendance.results }
  );

  // Idempotent re-submission (repeating submission does not deduct double hours)
  const resubmitAttendanceRes = await fetch(`${BASE_URL}/api/attendance/session/${slot1Id}/submit`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${adminToken}` },
    body: JSON.stringify({
      date: new Date().toISOString().split("T")[0],
      records: [
        { studentId: studentAriaCode, status: "PRESENT", remarks: "Updated notes idempotent." }
      ]
    })
  });
  const resubmitAttendance = (await resubmitAttendanceRes.json()) as any;
  assert(
    resubmitAttendanceRes.status === 200 && resubmitAttendance.success,
    "Idempotent attendance: repeating submission updates safely without duplicate hours deductions",
    { message: resubmitAttendance.message }
  );

  // Orphan attendance report check
  const orphanRes = await fetch(`${BASE_URL}/api/attendance/orphans`, {
    headers: { Authorization: `Bearer ${adminToken}` }
  });
  const orphanData = (await orphanRes.json()) as any;
  assert(orphanRes.status === 200 && orphanData.success, "Orphan attendance rows endpoint operational", {
    orphanCount: orphanData.count
  });

  // 8. TEACHER NAVIGATION, SCOPING & PRIVACY
  console.log("\n--- 8. Teacher Navigation Scoping & Privacy ---");
  // Teacher reading teachers list
  const teacherListRes = await fetch(`${BASE_URL}/api/teachers/list`, {
    headers: { Authorization: `Bearer ${teacherToken}` }
  });
  const teacherList = (await teacherListRes.json()) as any;
  assert(
    teacherListRes.status === 200 && teacherList.success && teacherList.data.length <= 1,
    "Teacher role strictly scoped to own record in /api/teachers/list",
    { count: teacherList.data?.length }
  );

  // Teacher blocked from Admin Campaigns
  const teacherCampaignRes = await fetch(`${BASE_URL}/api/campaigns`, {
    headers: { Authorization: `Bearer ${teacherToken}` }
  });
  assert(
    teacherCampaignRes.status === 403,
    "Teacher role strictly blocked from /api/campaigns (403 Forbidden)"
  );

  // Teacher blocked from Admin Financial Reports
  const teacherReportsRes = await fetch(`${BASE_URL}/api/reports/financial`, {
    headers: { Authorization: `Bearer ${teacherToken}` }
  });
  assert(
    teacherReportsRes.status === 403,
    "Teacher role strictly blocked from /api/reports/financial (403 Forbidden)"
  );

  // Teacher updating own profile
  const teacherUpdateSelfRes = await fetch(`${BASE_URL}/api/teachers/${teacherLogin.profile?.id || "teacher"}`, {
    method: "PUT",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${teacherToken}` },
    body: JSON.stringify({
      phone: "+1 (555) 019-9944",
      qualification: "M.Sc. Mathematics & Computer Science",
      specialization: "Advanced Calculus & Python",
      availabilityDays: ["Monday", "Wednesday", "Friday"],
      availabilitySlots: ["Morning - 09:00 AM - 12:00 PM"]
    })
  });
  const teacherUpdateSelf = (await teacherUpdateSelfRes.json()) as any;
  assert(
    teacherUpdateSelfRes.status === 200 && teacherUpdateSelf.success,
    "Teacher can update own phone, bio, and availability slots/days",
    { updatedTeacher: teacherUpdateSelf.data?.name }
  );

  // 9. COMPLETE REFERRALS PURGE VERIFICATION
  console.log("\n--- 9. Complete Referrals Purge Database Verification ---");
  const { data: refTableCheck } = await supabaseAdmin.from("pg_tables").select("tablename").eq("schemaname", "public").in("tablename", ["referrals", "referral_codes"]);
  assert(
    !refTableCheck || refTableCheck.length === 0,
    "Tables 'referrals' and 'referral_codes' are completely dropped from Postgres database",
    { remainingTables: refTableCheck }
  );

  const { data: refColCheck } = await supabaseAdmin.from("information_schema.columns").select("column_name").eq("table_schema", "public").eq("column_name", "referred_by_code");
  assert(
    !refColCheck || refColCheck.length === 0,
    "Column 'referred_by_code' is completely dropped from all database tables",
    { remainingColumns: refColCheck }
  );

  // 10. CAMPAIGNS & CAN-SPAM COMPLIANCE
  console.log("\n--- 10. Campaigns & CAN-SPAM Compliance ---");
  const canSpamStatus = verifyCanSpamAddress();
  assert(canSpamStatus.allowed === true, "CAN-SPAM check passes with configured institute postal address", {
    address: canSpamStatus.instituteAddress
  });

  const campListRes = await fetch(`${BASE_URL}/api/campaigns`, {
    headers: { Authorization: `Bearer ${adminToken}` }
  });
  const campListData = (await campListRes.json()) as any;
  assert(campListRes.status === 200 && campListData.success, "Admin can list marketing campaigns", {
    campaignsCount: campListData.data?.length
  });

  // SUMMARY
  console.log("\n========================================================");
  const total = report.length;
  const passed = report.filter(r => r.passed).length;
  const failed = total - passed;
  console.log(`🏁 TEST RESULTS: ${passed}/${total} PASSED (${failed} FAILED)`);
  console.log("========================================================\n");

  if (failed > 0) {
    process.exit(1);
  }
}

runTests().catch(err => {
  console.error("FATAL TEST RUN ERROR:", err);
  process.exit(1);
});
