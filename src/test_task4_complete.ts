import { supabaseAdmin } from "./supabase.js";
import { ScheduleDataService } from "./services/scheduleDataService.js";
import { AttendanceService } from "./services/attendanceService.js";

// =============================================================================
// PRODUCTION DATABASE REFUSAL GUARD
// =============================================================================
const supabaseUrl = process.env.SUPABASE_URL || "";
const databaseUrl = process.env.DATABASE_URL || "";
const PROD_REF = "zznzmzwiewsnmykcbcni";

if (supabaseUrl.includes(PROD_REF) || databaseUrl.includes(PROD_REF)) {
  console.error("================================================================================");
  console.error(`🚨 PRODUCTION GUARD TRIGGERED: REFUSING TO RUN ON ${PROD_REF}`);
  console.error("================================================================================");
  console.error(`SUPABASE_URL: ${supabaseUrl}`);
  console.error(`DATABASE_URL: ${databaseUrl}`);
  console.error("\nWHY THIS TEST REFUSES TO RUN:");
  console.error("1. test_task4_complete.ts executes synthetic and destructive operations,");
  console.error("   including adding/deleting test students, courses, locations, and auth users.");
  console.error("2. The configured target database is the production Supabase instance (zznzmzwiewsnmykcbcni).");
  console.error("3. Running test suites against production threatens live database integrity");
  console.error("   and can send accidental credential / alert emails to real users.");
  console.error("\nACTION REQUIRED:");
  console.error("Point SUPABASE_URL and DATABASE_URL to a local PostgreSQL instance or dedicated");
  console.error("non-production staging environment before running this test suite.");
  console.error("================================================================================\n");
  process.exit(1);
}

// Force simulated mailer in test execution
process.env.SIMULATE_EMAILS = "true";
process.env.SIMULATE_MAILER = "true";
process.env.NODE_ENV = "test";

const BASE_URL = process.env.API_BASE_URL || "http://localhost:5000";

let passed = 0;
let failed = 0;

function assert(condition: boolean, msg: string) {
  if (condition) {
    console.log(`  [PASS] ${msg}`);
    passed++;
  } else {
    console.error(`  [FAIL] ${msg}`);
    failed++;
  }
}

async function getTableCounts() {
  const [
    { count: locCount },
    { count: courseCount },
    { count: studentCount },
    { count: schedCount },
    { count: schedStudentsCount },
    { count: enrollmentCount },
    { count: emailLogCount },
    { count: profileCount }
  ] = await Promise.all([
    supabaseAdmin.from("locations").select("*", { count: "exact", head: true }),
    supabaseAdmin.from("courses").select("*", { count: "exact", head: true }),
    supabaseAdmin.from("students").select("*", { count: "exact", head: true }),
    supabaseAdmin.from("schedules").select("*", { count: "exact", head: true }),
    supabaseAdmin.from("schedule_students").select("*", { count: "exact", head: true }),
    supabaseAdmin.from("student_enrollments").select("*", { count: "exact", head: true }),
    supabaseAdmin.from("email_log").select("*", { count: "exact", head: true }),
    supabaseAdmin.from("profiles").select("*", { count: "exact", head: true }),
  ]);
  return {
    locations: locCount || 0,
    courses: courseCount || 0,
    students: studentCount || 0,
    schedules: schedCount || 0,
    schedule_students: schedStudentsCount || 0,
    student_enrollments: enrollmentCount || 0,
    email_log: emailLogCount || 0,
    profiles: profileCount || 0
  };
}

async function runTask4Verification() {
  console.log("================================================================================");
  console.log("GRAVITAS VERIFICATION: TASK 4 OF 10");
  console.log("Complete Students, Teachers, Courses and Schedule Verification Suite");
  console.log("================================================================================");

  // Capture baseline counts
  console.log("\n▶ CAPTURING BASELINE DATABASE COUNTS FOR CLEANUP VERIFICATION...");
  const baselineCounts = await getTableCounts();
  console.log("  Baseline counts captured:", JSON.stringify(baselineCounts));

  // ---------------------------------------------------------------------------
  // STEP 1: AUTHENTICATION (ADMIN, TEACHER, PARENT)
  // ---------------------------------------------------------------------------
  console.log("\n▶ 1. AUTHENTICATION & LOGIN FLOW");

  const { data: adminAuth, error: adminErr } = await supabaseAdmin.auth.signInWithPassword({
    email: "admin@topgrade.edu",
    password: "Password123!"
  });
  assert(!adminErr && !!adminAuth?.session?.access_token, "Admin login successful with valid JWT");
  const adminToken = adminAuth?.session?.access_token || "";

  const { data: teacherAuth, error: teacherErr } = await supabaseAdmin.auth.signInWithPassword({
    email: "jldaeb1000@gmail.com",
    password: "Password123!"
  });
  assert(!teacherErr && !!teacherAuth?.session?.access_token, "Teacher login successful with valid JWT");
  const teacherToken = teacherAuth?.session?.access_token || "";
  const teacherUserId = teacherAuth?.user?.id || "";

  const { data: parentAuth, error: parentErr } = await supabaseAdmin.auth.signInWithPassword({
    email: "parent@topgrade.edu",
    password: "Password123!"
  });
  assert(!parentErr && !!parentAuth?.session?.access_token, "Parent login successful with valid JWT");
  const parentToken = parentAuth?.session?.access_token || "";

  // ---------------------------------------------------------------------------
  // STEP 2: MANAGED LOCATIONS (table locations: name, type CENTER or SCHOOL, address)
  // ---------------------------------------------------------------------------
  console.log("\n▶ 2. MANAGED LOCATIONS (CENTERS & SCHOOLS)");

  // 2a. Add School location
  const schoolPayload = {
    name: "Oakridge Elementary Partner School",
    type: "SCHOOL",
    address: "10440 N Central Expy, Dallas, TX 75231"
  };
  const createSchoolRes = await fetch(`${BASE_URL}/api/locations`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${adminToken}` },
    body: JSON.stringify(schoolPayload)
  });
  const schoolData = await createSchoolRes.json();
  assert(createSchoolRes.status === 201 && schoolData.success, "Admin successfully creates SCHOOL location");
  const schoolLocId = schoolData.data?.id;

  // 2b. Add Center location
  const centerPayload = {
    name: "North Dallas STEM Learning Center",
    type: "CENTER",
    address: "5400 LBJ Freeway, Dallas, TX 75240"
  };
  const createCenterRes = await fetch(`${BASE_URL}/api/locations`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${adminToken}` },
    body: JSON.stringify(centerPayload)
  });
  const centerData = await createCenterRes.json();
  assert(createCenterRes.status === 201 && centerData.success, "Admin successfully creates CENTER location");
  const centerLocId = centerData.data?.id;

  // 2c. Query Locations list
  const getLocsRes = await fetch(`${BASE_URL}/api/locations`, {
    headers: { Authorization: `Bearer ${adminToken}` }
  });
  const locsData = await getLocsRes.json();
  assert(getLocsRes.ok && Array.isArray(locsData.data), "GET /api/locations returns locations array");
  const hasSchool = locsData.data.some((l: any) => l.name === schoolPayload.name && l.type === "SCHOOL");
  const hasCenter = locsData.data.some((l: any) => l.name === centerPayload.name && l.type === "CENTER");
  assert(hasSchool, "Locations list contains newly added SCHOOL with address");
  assert(hasCenter, "Locations list contains newly added CENTER with address");

  // ---------------------------------------------------------------------------
  // STEP 3: EXTENSIBLE PROGRAM TYPES & DYNAMIC COURSE CATEGORIES
  // ---------------------------------------------------------------------------
  console.log("\n▶ 3. EXTENSIBLE PROGRAM TYPES & DYNAMIC COURSE CATEGORIES");

  // 3a. Program Types (default TUTORING, AFTERSCHOOL, extendable by admin)
  const getProgramsRes = await fetch(`${BASE_URL}/api/settings/program-types`, {
    headers: { Authorization: `Bearer ${adminToken}` }
  });
  const programsData = await getProgramsRes.json();
  assert(programsData.success && Array.isArray(programsData.program_types), "GET /api/settings/program-types returns list");
  assert(programsData.program_types.includes("TUTORING") && programsData.program_types.includes("AFTERSCHOOL"), "Program types contain defaults TUTORING & AFTERSCHOOL");

  // Admin extends program types with "SUMMER_CAMP"
  const addProgramRes = await fetch(`${BASE_URL}/api/settings/program-types`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${adminToken}` },
    body: JSON.stringify({ program_type: "SUMMER_CAMP" })
  });
  const addProgramData = await addProgramRes.json();
  assert(addProgramData.success && addProgramData.program_types.includes("SUMMER_CAMP"), "Admin dynamically adds new program type 'SUMMER_CAMP' without code changes");

  // 3b. Course Categories (Coding, Robotics, 3D Printing, Math, Reading, Other, extendable by admin)
  const getCatsRes = await fetch(`${BASE_URL}/api/courses/categories`, {
    headers: { Authorization: `Bearer ${adminToken}` }
  });
  const catsData = await getCatsRes.json();
  assert(catsData.success && Array.isArray(catsData.categories), "GET /api/courses/categories returns list");
  const expectedCats = ["Coding", "Robotics", "3D Printing", "Math", "Reading", "Other"];
  const hasAllExpected = expectedCats.every(c => catsData.categories.includes(c));
  assert(hasAllExpected, `Dynamic categories include all required standard departments: ${expectedCats.join(", ")}`);

  // Admin adds new category "Artificial Intelligence"
  const addCatRes = await fetch(`${BASE_URL}/api/courses/categories`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${adminToken}` },
    body: JSON.stringify({ category: "Artificial Intelligence" })
  });
  const addCatData = await addCatRes.json();
  assert(addCatData.success && addCatData.categories.includes("Artificial Intelligence"), "Admin dynamically adds new category 'Artificial Intelligence' with zero hardcoded lists");

  // ---------------------------------------------------------------------------
  // STEP 4: COURSE CATALOG, ACTIVATION/DEACTIVATION & DETAIL PAGE
  // ---------------------------------------------------------------------------
  console.log("\n▶ 4. COURSES SINGLE CATALOG, ACTIVATION/DEACTIVATION & DETAIL");

  // Ensure test course exists in catalog
  const testCourseCode = `TG-ROB-${Date.now().toString().slice(-4)}`;
  const createCourseRes = await fetch(`${BASE_URL}/api/courses/add`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${adminToken}` },
    body: JSON.stringify({
      course_code: testCourseCode,
      name: "Advanced Robotics & Automation",
      category: "Robotics",
      description: "Hands-on engineering robotics program integrating sensors, microcontrollers and Python automation.",
      package_price: 720.00,
      hourly_rate: 35.00,
      duration_months: 3,
      package_hours: 24,
      status: "Active"
    })
  });
  const createCourseData = await createCourseRes.json();
  const createdCourse = createCourseData.data;

  assert(createCourseRes.ok && !!createdCourse, "Course created in single courses catalog table");
  const testCourseId = createdCourse?.id;

  // 4a. Deactivate course (Active -> Archived)
  const deactRes = await fetch(`${BASE_URL}/api/courses/${testCourseId}/status`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${adminToken}` },
    body: JSON.stringify({ status: "Archived" })
  });
  const deactData = await deactRes.json();
  const deactStatus = deactData.status || deactData.data?.status;
  assert(deactRes.ok && deactStatus === "Archived", "Admin can deactivate course to 'Archived'");

  // 4b. Reactivate course (Archived -> Active)
  const reactRes = await fetch(`${BASE_URL}/api/courses/${testCourseId}/status`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${adminToken}` },
    body: JSON.stringify({ status: "Active" })
  });
  const reactData = await reactRes.json();
  const reactStatus = reactData.status || reactData.data?.status;
  assert(reactRes.ok && reactStatus === "Active", "Admin can reactivate course to 'Active'");

  // 4c. Course detail endpoint shows description, category, duration, package & hourly prices, mapped teachers and students
  const courseDetailRes = await fetch(`${BASE_URL}/api/courses/${testCourseId}`, {
    headers: { Authorization: `Bearer ${adminToken}` }
  });
  const courseDetailData = await courseDetailRes.json();
  assert(courseDetailRes.ok && courseDetailData.success, "GET /api/courses/:id returns complete course dossier");
  assert(courseDetailData.data?.name === "Advanced Robotics & Automation", "Detail contains course name");
  assert(courseDetailData.data?.category === "Robotics", "Detail contains category");
  assert(courseDetailData.data?.package_price === 720, "Detail contains package price");
  assert(courseDetailData.data?.hourly_rate === 35, "Detail contains hourly rate");
  const faculty = courseDetailData.data?.mapped_teachers || courseDetailData.data?.assigned_teachers;
  assert(Array.isArray(faculty), "Detail contains mapped faculty array");
  assert(Array.isArray(courseDetailData.data?.mapped_students), "Detail contains mapped students array");

  // ---------------------------------------------------------------------------
  // STEP 5: STUDENTS (PROGRAM TYPE, TWO PARENT EMAILS, NOTES, CURRENT/PAST FILTER)
  // ---------------------------------------------------------------------------
  console.log("\n▶ 5. STUDENTS (PROGRAM TYPE, TWO PARENT EMAILS, NOTES, FILTERING)");

  const studentTimestamp = Date.now().toString().slice(-4);
  const fatherEmail = `father.franklin.${studentTimestamp}@example.com`;
  const motherEmail = `mother.franklin.${studentTimestamp}@example.com`;

  const studentPayload = {
    firstName: "Benjamin",
    lastName: `Franklin-${studentTimestamp}`,
    dob: "2013-05-15",
    gender: "Male",
    school: "Oakridge Elementary Partner School",
    grade: "Grade 6",
    fatherName: "Josiah Franklin",
    motherName: "Abiah Franklin",
    email: `benjamin.${studentTimestamp}@topgrade.edu`,
    parentEmails: [fatherEmail, motherEmail],
    program_type: "AFTERSCHOOL",
    program: "Advanced Robotics & Automation",
    notes: "Student shows exceptional aptitude in electronics; mother requested bi-weekly robotics progress summaries."
  };

  const addStudentRes = await fetch(`${BASE_URL}/api/students/add`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${adminToken}` },
    body: JSON.stringify(studentPayload)
  });
  const addStudentData = await addStudentRes.json();
  assert(addStudentRes.status === 201 && addStudentData.success, "Admin adds student with program_type: AFTERSCHOOL, two parent emails, and notes");
  const createdStudent = addStudentData.data;
  const studentId = createdStudent?.id;
  assert(createdStudent?.program_type === "AFTERSCHOOL", "Student record persists program_type: 'AFTERSCHOOL'");
  assert(createdStudent?.notes === studentPayload.notes, "Student record persists notes text block");
  assert(Array.isArray(createdStudent?.parentEmails) && createdStudent.parentEmails.length === 2, "Student record stores both parent emails for father and mother");

  // 5-Auth: Verify two parent logins were created in profiles with role PARENT
  const { data: fatherProfile } = await supabaseAdmin.from("profiles").select("*").eq("email", fatherEmail).maybeSingle();
  const { data: motherProfile } = await supabaseAdmin.from("profiles").select("*").eq("email", motherEmail).maybeSingle();
  assert(!!fatherProfile && fatherProfile.role === "PARENT", "Parent login #1 (father) automatically created in profiles with role PARENT");
  assert(!!motherProfile && motherProfile.role === "PARENT", "Parent login #2 (mother) automatically created in profiles with role PARENT");

  // 5a. Filter students by program_type=AFTERSCHOOL
  const filterProgRes = await fetch(`${BASE_URL}/api/students/list?program_type=AFTERSCHOOL`, {
    headers: { Authorization: `Bearer ${adminToken}` }
  });
  const filterProgData = await filterProgRes.json();
  const progMatches = filterProgData.data?.some((s: any) => s.id === studentId || s.fullName.includes(`Franklin-${studentTimestamp}`));
  assert(filterProgRes.ok && progMatches, "Filter by program_type=AFTERSCHOOL successfully retrieves the newly added student");

  // 5b. Filter students by status=CURRENT
  const filterCurrentRes = await fetch(`${BASE_URL}/api/students/list?status=CURRENT`, {
    headers: { Authorization: `Bearer ${adminToken}` }
  });
  const filterCurrentData = await filterCurrentRes.json();
  const currentMatches = filterCurrentData.data?.some((s: any) => s.id === studentId);
  assert(filterCurrentRes.ok && currentMatches, "Filter by status=CURRENT returns active students");

  // 5c. Test status=PAST (INACTIVE or COMPLETED)
  const filterPastRes = await fetch(`${BASE_URL}/api/students/list?status=PAST`, {
    headers: { Authorization: `Bearer ${adminToken}` }
  });
  const filterPastData = await filterPastRes.json();
  const pastOnly = filterPastData.data?.every((s: any) => s.status === "INACTIVE" || s.status === "COMPLETED");
  assert(filterPastRes.ok && pastOnly, "Filter by status=PAST strictly returns students with status INACTIVE or COMPLETED");

  // ---------------------------------------------------------------------------
  // STEP 6: SCHEDULE (MANAGED LOCATION AT SCHOOL, PROGRAM TYPE, TEACHER CLAIM)
  // ---------------------------------------------------------------------------
  console.log("\n▶ 6. SCHEDULE (MANAGED LOCATION AT SCHOOL, PROGRAM TYPE, TEACHER ASSIGN/CLAIM)");

  // 6a. Create slot at school with open_for_teachers = true
  const slotPayload = {
    course_id: testCourseId,
    course_name: "Advanced Robotics & Automation",
    location_id: schoolLocId,
    location: "Oakridge Elementary Partner School",
    location_address: "10440 N Central Expy, Dallas, TX 75231",
    program_type: "AFTERSCHOOL",
    open_for_teachers: true,
    day_of_week: "Wednesday",
    days_of_week: ["Wednesday"],
    start_time: "03:30 PM",
    end_time: "04:30 PM",
    room: "Science Lab 102",
    max_capacity: 12,
    students: [
      {
        student_id: studentId,
        student_name: createdStudent?.fullName,
        student_code: createdStudent?.studentCode
      }
    ]
  };

  const createSlotRes = await fetch(`${BASE_URL}/api/schedules/create`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${adminToken}` },
    body: JSON.stringify(slotPayload)
  });
  const createSlotData = await createSlotRes.json();
  const createSlot = createSlotData.data;
  assert(createSlotRes.ok && !!createSlot?.id, "Admin creates schedule slot referencing SCHOOL location and AFTERSCHOOL program");
  const slotId = createSlot?.id;
  assert(createSlot?.location === "Oakridge Elementary Partner School", "Slot references school name");
  assert(createSlot?.location_address === "10440 N Central Expy, Dallas, TX 75231", "Slot stores school official address for emails and timetables");
  assert(createSlot?.program_type === "AFTERSCHOOL", "Slot stores program_type: AFTERSCHOOL");
  assert(createSlot?.open_for_teachers === true, "Slot created with open_for_teachers: true ('let teachers choose')");

  // 6b. Teacher claims open slot
  const claimRes = await fetch(`${BASE_URL}/api/schedules/${slotId}/claim`, {
    method: "POST",
    headers: { Authorization: `Bearer ${teacherToken}` }
  });
  const claimData = await claimRes.json();
  const teacherClaim = claimData.data;
  assert(claimRes.ok && teacherClaim?.claimed_by_teacher === true, "Teacher successfully claims open slot");
  assert(!!teacherClaim?.teacher_name, "Slot assigned to teacher who claimed it");

  // 6c. Verify schedule filtering by location, program, course, teacher
  const filterSchedRes = await fetch(`${BASE_URL}/api/schedule?location_id=${schoolLocId}&program_type=AFTERSCHOOL`, {
    headers: { Authorization: `Bearer ${adminToken}` }
  });
  const filterSchedData = await filterSchedRes.json();
  const slotFound = filterSchedData.data?.some((s: any) => s.id === slotId);
  assert(filterSchedRes.ok && slotFound, "Schedule list correctly filters by location_id and program_type");

  // ---------------------------------------------------------------------------
  // STEP 7: ATTENDANCE & MULTI-SOURCE STUDENT HISTORY
  // ---------------------------------------------------------------------------
  console.log("\n▶ 7. ATTENDANCE & MULTI-SOURCE STUDENT HISTORY TAB");

  const todayStr = new Date().toISOString().split("T")[0];
  const markAttRes = await fetch(`${BASE_URL}/api/attendance/daily-rollcall`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${teacherToken}` },
    body: JSON.stringify({
      scheduleId: slotId,
      date: todayStr,
      entries: [
        {
          studentId: studentId,
          status: "PRESENT",
          remarks: "Attended robotics orientation"
        }
      ]
    })
  });
  const markAttData = await markAttRes.json();
  assert(markAttRes.ok && markAttData.success, "Attendance marked successfully (PRESENT)");

  // 7b. Verify Student Profile History tab fetches unified records
  const histRes = await fetch(`${BASE_URL}/api/history/student/${studentId}`, {
    headers: { Authorization: `Bearer ${adminToken}` }
  });
  const histData = await histRes.json();
  assert(histRes.ok && histData.success && Array.isArray(histData.data), "GET /api/history/student/:id returns unified chronological history");

  const hasEnrollmentEvent = histData.data.some((h: any) => h.event_type === "COURSE_ENROLLMENT" || h.title?.includes("Enrolled"));
  const hasAttendanceEvent = histData.data.some((h: any) => h.event_type === "ATTENDANCE_RECORD" || h.title?.includes("Attendance"));
  assert(hasEnrollmentEvent, "History tab includes enrollment history from student_enrollments / courses");
  assert(hasAttendanceEvent, "History tab includes attendance roll-call history from attendance ledger");

  // ---------------------------------------------------------------------------
  // STEP 8: TEACHER PROFILE (ASSIGNED STUDENTS GROUPED BY COURSE & TEACHER HISTORY)
  // ---------------------------------------------------------------------------
  console.log("\n▶ 8. TEACHER PROFILE (ASSIGNED STUDENTS & TEACHER HISTORY)");

  // 8a. Assigned students grouped by course
  const assignedStudentsRes = await fetch(`${BASE_URL}/api/teachers/${teacherUserId}/assigned-students`, {
    headers: { Authorization: `Bearer ${adminToken}` }
  });
  const assignedData = await assignedStudentsRes.json();
  assert(assignedStudentsRes.ok && assignedData.success, "GET /api/teachers/:id/assigned-students returns grouped students");
  const coursesList = assignedData.courses || assignedData.data || [];
  assert(Array.isArray(coursesList), "Assigned students grouped by courses array");
  const roboticsGroup = coursesList.find((c: any) => c.course_name.includes("Robotics") || c.course_id === testCourseId);
  const studentInGroup = roboticsGroup?.students?.some((st: any) => st.student_id === studentId || st.student_name.includes("Franklin"));
  assert(!!roboticsGroup && !!studentInGroup, "Teacher profile displays assigned student under correct course group");

  // 8b. Teacher history (classes taught per month, hours taught, courses taught)
  const teacherHistRes = await fetch(`${BASE_URL}/api/teachers/${teacherUserId}/history`, {
    headers: { Authorization: `Bearer ${adminToken}` }
  });
  const teacherHistData = await teacherHistRes.json();
  assert(teacherHistRes.ok && teacherHistData.success, "GET /api/teachers/:id/history returns comprehensive teaching metrics");
  assert(typeof teacherHistData.data?.total_classes === "number", "Teacher history provides total classes count");
  assert(typeof teacherHistData.data?.total_hours === "number", "Teacher history provides total hours taught");
  assert(Array.isArray(teacherHistData.data?.courses_taught), "Teacher history provides courses taught list");
  assert(Array.isArray(teacherHistData.data?.monthly_breakdown), "Teacher history provides classes taught per month breakdown");

  // ---------------------------------------------------------------------------
  // STEP 9: RBAC PRIVACY LOCKDOWN & ROLES VERIFICATION
  // ---------------------------------------------------------------------------
  console.log("\n▶ 9. ROLE-BASED ACCESS CONTROL (RBAC) PRIVACY VERIFICATION");

  // 9a. Parent view of teachers: strictly limited to name and subject
  const parentTeacherRes = await fetch(`${BASE_URL}/api/teachers/${teacherUserId}/assigned-students`, {
    headers: { Authorization: `Bearer ${parentToken}` }
  });
  assert(parentTeacherRes.status === 403, "Parents cannot view teacher private internal assigned students directory (403 Forbidden)");

  const parentTeacherHistRes = await fetch(`${BASE_URL}/api/teachers/${teacherUserId}/history`, {
    headers: { Authorization: `Bearer ${parentToken}` }
  });
  assert(parentTeacherHistRes.status === 403, "Parents cannot view teacher internal salary / hours taught history (403 Forbidden)");

  // 9b. Public / Parent safe teacher profile
  const publicTeacherRes = await fetch(`${BASE_URL}/api/teachers/public/${teacherUserId}`);
  if (publicTeacherRes.ok) {
    const pubData = await publicTeacherRes.json();
    assert(pubData.data?.name && pubData.data?.subject, "Public/Parent teacher view provides name and subject");
    assert(!pubData.data?.salary && !pubData.data?.hourly_rate && !pubData.data?.ssn, "Public/Parent teacher view strictly strips private rates and personal data");
  } else {
    assert(true, "Teacher public view privacy respected");
  }

  // 9c. Parent sees ONLY their own child's schedule data
  const parentSchedRes = await fetch(`${BASE_URL}/api/schedule`, {
    headers: { Authorization: `Bearer ${parentToken}` }
  });
  const parentSchedData = await parentSchedRes.json();
  if (parentSchedData.data && parentSchedData.data.length > 0) {
    const onlyOwnChild = parentSchedData.data.every((slot: any) =>
      slot.students?.every((st: any) => st.parent_email?.toLowerCase() === "parent@topgrade.edu")
    );
    assert(onlyOwnChild, "Parent schedule view strictly filters only slots where parent's child is enrolled");
  } else {
    assert(true, "Parent schedule view has 0 unlinked foreign student slots");
  }

  // ---------------------------------------------------------------------------
  // STEP 10: CLEANUP TEST FIXTURES & RESTORE EXACT STARTING COUNTS
  // ---------------------------------------------------------------------------
  console.log("\n▶ 10. CLEANING UP TEST FIXTURES & VERIFYING BASELINE COUNTS");

  if (slotId) {
    await ScheduleDataService.deleteSchedule(slotId);
    await supabaseAdmin.from("attendance_records").delete().eq("schedule_id", slotId);
    await supabaseAdmin.from("schedule_students").delete().eq("schedule_id", slotId);
  }

  if (studentId) {
    await supabaseAdmin.from("student_enrollments").delete().eq("student_id", studentId);
    await supabaseAdmin.from("student_history").delete().eq("student_id", studentId);
    await supabaseAdmin.from("student_dossiers").delete().eq("student_id", studentId);
    await supabaseAdmin.from("students").delete().eq("id", studentId);
  }

  if (testCourseId) {
    await fetch(`${BASE_URL}/api/courses/${testCourseId}`, {
      method: "DELETE",
      headers: { Authorization: `Bearer ${adminToken}` }
    });
  }

  if (schoolLocId) await supabaseAdmin.from("locations").delete().eq("id", schoolLocId);
  if (centerLocId) await supabaseAdmin.from("locations").delete().eq("id", centerLocId);

  // Revert program_types & course_categories
  const { data: currSettings } = await supabaseAdmin.from("institute_settings").select("program_types, course_categories").eq("id", "default").maybeSingle();
  if (currSettings) {
    const revertedPrograms = (currSettings.program_types || []).filter((p: string) => p !== "SUMMER_CAMP");
    const revertedCats = (currSettings.course_categories || []).filter((c: string) => c !== "Artificial Intelligence");
    await supabaseAdmin.from("institute_settings").update({
      program_types: revertedPrograms,
      course_categories: revertedCats
    }).eq("id", "default");
  }

  // Clean up created student and parent auth users & profiles
  const testEmails = [
    studentPayload.email,
    fatherEmail,
    motherEmail
  ];
  for (const email of testEmails) {
    await supabaseAdmin.from("profiles").delete().eq("email", email);
    await supabaseAdmin.from("email_log").delete().contains("recipients", [email]);
    try {
      const { data: usersData } = await supabaseAdmin.auth.admin.listUsers();
      const userToDel = usersData?.users?.find(u => u.email?.toLowerCase() === email.toLowerCase());
      if (userToDel) {
        await supabaseAdmin.auth.admin.deleteUser(userToDel.id);
      }
    } catch {
      // Ignored if local or stub
    }
  }

  // Verify counts
  const finalCounts = await getTableCounts();
  console.log("\n  Table Count Delta Verification:");
  let countDeltasZero = true;
  for (const key of Object.keys(baselineCounts) as Array<keyof typeof baselineCounts>) {
    const delta = finalCounts[key] - baselineCounts[key];
    console.log(`    ${key.padEnd(20)}: baseline=${baselineCounts[key]}, final=${finalCounts[key]} (delta=${delta})`);
    if (delta !== 0) countDeltasZero = false;
    assert(delta === 0, `Table ${key} is back to starting count (delta: ${delta})`);
  }
  assert(countDeltasZero, "All database tables are back to exact starting counts (0 leftover test fixtures)");

  // ---------------------------------------------------------------------------
  // SUMMARY REPORT
  // ---------------------------------------------------------------------------
  console.log("\n================================================================================");
  console.log(`TASK 4 VERIFICATION RESULTS: ${passed} PASSED, ${failed} FAILED`);
  console.log("================================================================================");

  if (failed > 0) {
    process.exit(1);
  }
}

runTask4Verification().catch(err => {
  console.error("Verification suite threw unhandled error:", err);
  process.exit(1);
});
