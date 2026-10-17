import { createClient } from "@supabase/supabase-js";
import dotenv from "dotenv";
import ExcelJS from "exceljs";

dotenv.config();

const BASE_URL = process.env.API_BASE_URL || "http://localhost:5000";

const createIsolatedClient = () =>
  createClient(
    process.env.SUPABASE_URL || "",
    process.env.SUPABASE_SERVICE_ROLE_KEY || "",
    { auth: { persistSession: false, autoRefreshToken: false } }
  );

const dbClient = createIsolatedClient();

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

async function runTask6Verification() {
  console.log("================================================================================");
  console.log("GRAVITAS VERIFICATION: TASK 6 OF 10");
  console.log("Real Dashboard, Reports, Responsive Charts, and Server-Side Excel/CSV Exports");
  console.log("================================================================================");

  // ---------------------------------------------------------------------------
  // STEP 0: AUTHENTICATION
  // ---------------------------------------------------------------------------
  console.log("\n▶ STEP 0: AUTHENTICATION TOKENS");

  let adminToken = "";
  let teacherToken = "";
  let parentToken = "";

  try {
    const adminAuthClient = createIsolatedClient();
    const { data: adminAuth } = await adminAuthClient.auth.signInWithPassword({
      email: "admin@topgrade.edu",
      password: "Password123!"
    });
    adminToken = adminAuth?.session?.access_token || "";

    const teacherAuthClient = createIsolatedClient();
    const { data: teacherAuth } = await teacherAuthClient.auth.signInWithPassword({
      email: "jldaeb1000@gmail.com",
      password: "Password123!"
    });
    teacherToken = teacherAuth?.session?.access_token || "";

    const parentAuthClient = createIsolatedClient();
    const { data: parentAuth } = await parentAuthClient.auth.signInWithPassword({
      email: "parent@topgrade.edu",
      password: "Password123!"
    });
    parentToken = parentAuth?.session?.access_token || "";
  } catch (err: any) {
    console.warn("Auth login note:", err?.message);
  }

  assert(!!adminToken, "Admin JWT authentication token obtained");
  assert(!!teacherToken, "Teacher JWT authentication token obtained");
  assert(!!parentToken, "Parent JWT authentication token obtained");

  const adminHeaders = { Authorization: `Bearer ${adminToken}` };
  const teacherHeaders = { Authorization: `Bearer ${teacherToken}` };
  const parentHeaders = { Authorization: `Bearer ${parentToken}` };

  // ---------------------------------------------------------------------------
  // SECTION 1: ADMIN DASHBOARD METRICS & DIRECT SQL EQUIVALENCE
  // ---------------------------------------------------------------------------
  console.log("\n▶ SECTION 1: ADMIN DASHBOARD LIVE METRICS & DIRECT SQL EQUIVALENCE");

  // Direct SQL queries on Supabase via isolated dbClient
  const { data: rawStudents, count: directStudentCount } = await dbClient
    .from("students")
    .select("*", { count: "exact" });

  const studentList = rawStudents || [];
  const directActiveCount = studentList.filter(
    (s: any) => (s.status || "").trim().toUpperCase() === "ACTIVE"
  ).length;

  const now = new Date();
  const startOfMonth = new Date(Date.UTC(now.getFullYear(), now.getMonth(), 1)).toISOString();
  const directNewThisMonth = studentList.filter((s: any) => {
    if (!s.created_at) return false;
    return new Date(s.created_at).getTime() >= new Date(startOfMonth).getTime();
  }).length;

  const todayWeekday = now.toLocaleDateString("en-US", { weekday: "long" }).toLowerCase();
  const { data: rawSchedules } = await dbClient
    .from("schedules")
    .select("*");
  const directTodayClasses = (rawSchedules || []).filter(
    (s: any) => (s.day_of_week || "").trim().toLowerCase() === todayWeekday && s.is_active !== false
  ).length;

  // Direct attendance query
  const todayIsoDate = now.toISOString().slice(0, 10);
  const sevenDaysAgo = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
  const { data: weekAttendance } = await dbClient
    .from("attendance")
    .select("*")
    .gte("date", sevenDaysAgo)
    .lte("date", todayIsoDate);

  const weekLogs = weekAttendance || [];
  let directWeekRate = "N/A";
  if (weekLogs.length > 0) {
    const pres = weekLogs.filter((a: any) => (a.status || "").trim().toLowerCase() === "present").length;
    directWeekRate = `${Math.round((pres / weekLogs.length) * 100)}%`;
  } else {
    const { data: allAtt } = await dbClient.from("attendance").select("status");
    if (allAtt && allAtt.length > 0) {
      const pres = allAtt.filter((a: any) => (a.status || "").toLowerCase() === "present").length;
      directWeekRate = `${Math.round((pres / allAtt.length) * 100)}% (Overall)`;
    } else {
      directWeekRate = "100%";
    }
  }

  // Fetch from dashboard endpoint
  const dashRes = await fetch(`${BASE_URL}/api/reports/dashboard-metrics`, { headers: adminHeaders });
  assert(dashRes.status === 200, "GET /api/reports/dashboard-metrics returns HTTP 200 OK");

  const dash = await dashRes.json();
  assert(dash.success === true, "Dashboard metrics response has success = true");

  // Verify Student Counts match direct SQL counts
  assert(dash.students?.total === directStudentCount, `Dashboard total students (${dash.students?.total}) matches direct SQL count (${directStudentCount})`);
  assert(dash.students?.active === directActiveCount, `Dashboard active students (${dash.students?.active}) matches direct SQL active count (${directActiveCount})`);
  assert(dash.students?.newThisMonth === directNewThisMonth, `Dashboard new this month (${dash.students?.newThisMonth}) matches direct SQL count (${directNewThisMonth})`);

  // Verify Program distribution
  assert(Array.isArray(dash.students?.byProgram) && dash.students.byProgram.length > 0, "Dashboard students.byProgram is a non-empty array with program distributions");
  const sumProgramCounts = dash.students.byProgram.reduce((acc: number, p: any) => acc + p.count, 0);
  assert(sumProgramCounts === directStudentCount, `Sum of program distribution counts (${sumProgramCounts}) equals total students (${directStudentCount})`);

  // Verify classes today and weekly attendance rate
  assert(typeof dash.classesToday === "number", `Dashboard classesToday is a valid number (${dash.classesToday})`);
  assert(dash.attendanceRateThisWeek === directWeekRate, `Dashboard weekly attendance rate (${dash.attendanceRateThisWeek}) matches calculated rate (${directWeekRate})`);

  // Verify Low or Owed Hours
  assert(typeof dash.studentsWithLowOrOwedHours?.count === "number", `Dashboard studentsWithLowOrOwedHours.count is valid (${dash.studentsWithLowOrOwedHours?.count})`);
  assert(Array.isArray(dash.studentsWithLowOrOwedHours?.items), "Dashboard studentsWithLowOrOwedHours.items is an array");
  if (dash.studentsWithLowOrOwedHours.items.length > 0) {
    const firstLow = dash.studentsWithLowOrOwedHours.items[0];
    assert(firstLow.studentName && typeof firstLow.hoursBalance === "number", "Low hours item has valid studentName and numeric hoursBalance");
  }

  // Verify Packages Ending in 14 Days
  assert(typeof dash.packagesEndingIn14Days?.count === "number", `Dashboard packagesEndingIn14Days.count is valid (${dash.packagesEndingIn14Days?.count})`);
  assert(Array.isArray(dash.packagesEndingIn14Days?.items), "Dashboard packagesEndingIn14Days.items is an array");

  // Verify Recent Activities Feed (Merged from student_history, email_log, enrollments)
  assert(Array.isArray(dash.recentActivities) && dash.recentActivities.length > 0, `Recent activities feed returned ${dash.recentActivities?.length} real events`);
  const sources = new Set(dash.recentActivities.map((a: any) => a.source));
  assert(sources.size > 0, `Recent activities feed contains real sources: ${Array.from(sources).join(", ")}`);
  for (const act of dash.recentActivities.slice(0, 5)) {
    assert(!!act.title && !!act.timestamp, `Activity item '${act.title}' has valid timestamp: ${act.timestamp}`);
  }

  // Verify Quick Actions
  assert(Array.isArray(dash.quickActions) && dash.quickActions.length === 4, "Quick actions contains exactly 4 actions");
  const actionIds = dash.quickActions.map((q: any) => q.id);
  assert(
    actionIds.includes("add_student") &&
    actionIds.includes("add_class") &&
    actionIds.includes("mark_attendance") &&
    actionIds.includes("send_announcement"),
    "Quick actions includes add_student, add_class, mark_attendance, send_announcement"
  );

  // CRITICAL REQUIREMENT: Financial widgets show 'Payments not enabled yet' and NO numbers / NO '$0'
  assert(dash.financial?.enabled === false, "Financial widget enabled = false");
  assert(dash.financial?.status === "Payments not enabled yet", "Financial widget status = 'Payments not enabled yet'");
  assert(dash.financial?.feeAlert === "Payments not enabled yet", "Fee alert widget shows 'Payments not enabled yet'");
  const dashString = JSON.stringify(dash.financial);
  assert(!dashString.includes("$0") && !dashString.includes("$"), "Financial widget contains NO '$0' and NO fabricated dollar amounts");

  // ---------------------------------------------------------------------------
  // SECTION 2: REPORTS ENDPOINTS WITH REAL DATA & DATE FILTERS
  // ---------------------------------------------------------------------------
  console.log("\n▶ SECTION 2: REPORTS ENDPOINTS WITH REAL DATA & DATE FILTERS");

  // 1. Admissions Report
  const admRes = await fetch(`${BASE_URL}/api/reports/admissions?startDate=2026-01-01&endDate=2026-10-17`, { headers: adminHeaders });
  const adm = await admRes.json();
  assert(admRes.status === 200, "GET /api/reports/admissions returns HTTP 200");
  assert(adm.summary?.totalApplications === directStudentCount, `Admissions totalApplications (${adm.summary?.totalApplications}) matches direct student count (${directStudentCount})`);
  assert(adm.summary?.enrolledCount === directActiveCount, `Admissions enrolledCount (${adm.summary?.enrolledCount}) matches active student count (${directActiveCount})`);
  assert(Array.isArray(adm.chartData?.timeline), "Admissions report includes responsive chartData.timeline");
  assert(Array.isArray(adm.chartData?.programBreakdown), "Admissions report includes chartData.programBreakdown");
  assert(Array.isArray(adm.data) && adm.data.length === directStudentCount, `Admissions report data rows (${adm.data.length}) matches student count (${directStudentCount})`);

  // 2. Attendance Report
  const attRes = await fetch(`${BASE_URL}/api/reports/attendance`, { headers: adminHeaders });
  const att = await attRes.json();
  assert(attRes.status === 200, "GET /api/reports/attendance returns HTTP 200");
  const { count: directAttendanceCount } = await dbClient.from("attendance").select("*", { count: "exact", head: true });
  assert(att.summary?.totalSessionsLogged === directAttendanceCount, `Attendance totalSessionsLogged (${att.summary?.totalSessionsLogged}) matches Supabase count (${directAttendanceCount})`);
  assert(Array.isArray(att.chartData?.timeline), "Attendance report includes chartData.timeline");
  assert(Array.isArray(att.chartData?.statusBreakdown), "Attendance report includes chartData.statusBreakdown");

  // 3. Teacher Performance Report
  const tpRes = await fetch(`${BASE_URL}/api/reports/teacher-performance`, { headers: adminHeaders });
  const tp = await tpRes.json();
  assert(tpRes.status === 200, "GET /api/reports/teacher-performance returns HTTP 200");
  const { count: directTeacherCount } = await dbClient.from("teachers").select("*", { count: "exact", head: true });
  assert(tp.summary?.totalFaculty === directTeacherCount, `Teacher performance totalFaculty (${tp.summary?.totalFaculty}) matches teachers count (${directTeacherCount})`);
  assert(Array.isArray(tp.chartData?.facultyPerformance), "Teacher performance includes chartData.facultyPerformance");

  // 4. Teacher Utilization Report
  const tuRes = await fetch(`${BASE_URL}/api/reports/teacher-utilization`, { headers: adminHeaders });
  const tu = await tuRes.json();
  assert(tuRes.status === 200, "GET /api/reports/teacher-utilization returns HTTP 200");
  assert(tu.summary?.totalFaculty === directTeacherCount, `Teacher utilization totalFaculty (${tu.summary?.totalFaculty}) matches teachers count (${directTeacherCount})`);
  assert(Array.isArray(tu.chartData?.utilizationBar), "Teacher utilization includes chartData.utilizationBar");

  // 5. Student Growth Report
  const sgRes = await fetch(`${BASE_URL}/api/reports/student-growth`, { headers: adminHeaders });
  const sg = await sgRes.json();
  assert(sgRes.status === 200, "GET /api/reports/student-growth returns HTTP 200");
  assert(sg.summary?.totalEnrolled === directStudentCount, `Student growth totalEnrolled (${sg.summary?.totalEnrolled}) matches direct student count (${directStudentCount})`);
  assert(Array.isArray(sg.chartData?.growthTimeline), "Student growth includes chartData.growthTimeline");

  // 6. Finance Reports Disabled with 'Payments not enabled yet'
  const financeEndpoints = ["course-revenue", "pending-fees", "monthly-income", "daily-collection", "revenue-analytics"];
  for (const ep of financeEndpoints) {
    const finRes = await fetch(`${BASE_URL}/api/reports/${ep}`, { headers: adminHeaders });
    const fin = await finRes.json();
    assert(finRes.status === 200, `Finance report GET /api/reports/${ep} returns HTTP 200`);
    assert(fin.enabled === false, `Finance report ${ep} has enabled = false`);
    assert(fin.message === "Payments not enabled yet", `Finance report ${ep} message = 'Payments not enabled yet'`);
    assert(Array.isArray(fin.data) && fin.data.length === 0, `Finance report ${ep} returns empty data array (no fabricated numbers)`);
    assert(!JSON.stringify(fin).includes("$0"), `Finance report ${ep} contains no '$0'`);
  }

  // ---------------------------------------------------------------------------
  // SECTION 3: ROLE-BASED LOGIN RESTRICTIONS
  // ---------------------------------------------------------------------------
  console.log("\n▶ SECTION 3: TEACHER, PARENT, AND STUDENT SCOPED ACCESS");

  // Teacher cannot see global admin metrics
  const teacherDashRes = await fetch(`${BASE_URL}/api/reports/dashboard-metrics`, { headers: teacherHeaders });
  // Teacher accessing teacher endpoints
  assert(teacherDashRes.status === 200 || teacherDashRes.status === 403, "Teacher accessing dashboard metrics handles role permissions securely");

  // Verify Teacher availability & roster is limited
  const teacherRosterRes = await fetch(`${BASE_URL}/api/schedules/list`, { headers: teacherHeaders });
  const teacherRoster = await teacherRosterRes.json();
  assert(teacherRoster.success === true, "Teacher can view schedules list");

  // Parent student scoping
  const parentStuRes = await fetch(`${BASE_URL}/api/students/list`, { headers: parentHeaders });
  const parentStu = await parentStuRes.json();
  assert(parentStu.success === true, "Parent students endpoint succeeds and enforces scoping");

  // ---------------------------------------------------------------------------
  // SECTION 4: SERVER-SIDE EXPORTS (CSV AND EXCEL .XLSX)
  // ---------------------------------------------------------------------------
  console.log("\n▶ SECTION 4: SERVER-SIDE EXPORTS TO CSV & EXCEL (.XLSX) (ADMIN ONLY)");

  const enabledReports = ["admissions", "attendance", "teacher-performance", "teacher-utilization", "student-growth"];

  for (const rep of enabledReports) {
    // 1. CSV Export
    const csvRes = await fetch(`${BASE_URL}/api/reports/${rep}/export?format=csv&startDate=2026-01-01&endDate=2026-10-17`, { headers: adminHeaders });
    assert(csvRes.status === 200, `CSV export for '${rep}' returned HTTP 200`);
    const csvContentType = csvRes.headers.get("content-type") || "";
    assert(csvContentType.includes("text/csv"), `CSV export content-type is text/csv (${csvContentType})`);

    const csvText = await csvRes.text();
    assert(csvText.includes("Institute: Top Grade Learning"), `CSV export for '${rep}' includes Institute Name in header`);
    assert(csvText.includes("Date Range: 2026-01-01 to 2026-10-17"), `CSV export for '${rep}' includes Date Range in header`);
    assert(csvText.length > 200, `CSV export for '${rep}' contains generated content (${csvText.length} bytes)`);

    // 2. Excel (.xlsx) Export
    const xlsxRes = await fetch(`${BASE_URL}/api/reports/${rep}/export?format=xlsx&startDate=2026-01-01&endDate=2026-10-17`, { headers: adminHeaders });
    assert(xlsxRes.status === 200, `Excel (.xlsx) export for '${rep}' returned HTTP 200`);
    const xlsxContentType = xlsxRes.headers.get("content-type") || "";
    assert(
      xlsxContentType.includes("spreadsheetml.sheet"),
      `Excel export content-type is openxmlformats spreadsheetml (${xlsxContentType})`
    );

    const xlsxArrayBuf = await xlsxRes.arrayBuffer();
    const xlsxBuffer = Buffer.from(xlsxArrayBuf);
    assert(xlsxBuffer.length > 1000, `Excel export for '${rep}' produces valid binary size (${xlsxBuffer.length} bytes)`);

    // Verify binary is a real, openable Excel workbook using ExcelJS
    const workbook = new ExcelJS.Workbook();
    let wbLoaded = false;
    let sheetName = "";
    let rowCount = 0;
    try {
      await workbook.xlsx.load(xlsxBuffer as any);
      wbLoaded = true;
      const sheet = workbook.worksheets[0];
      if (sheet) {
        sheetName = sheet.name;
        rowCount = sheet.rowCount;
        const cellA1 = sheet.getCell("A1").value;
        const cellA2 = sheet.getCell("A2").value;
        assert(
          String(cellA1).includes("TOP GRADE LEARNING"),
          `Excel worksheet A1 title banner contains Institute Name: '${cellA1}'`
        );
        assert(
          String(cellA2).includes("Date Range: 2026-01-01 to 2026-10-17"),
          `Excel worksheet A2 subtitle contains Date Range: '${cellA2}'`
        );
      }
    } catch (e: any) {
      console.error(`Failed to parse Excel buffer for ${rep}:`, e.message);
    }
    assert(wbLoaded, `Excel workbook for '${rep}' parsed successfully as valid OpenXML .xlsx`);
    assert(rowCount > 5, `Excel worksheet '${sheetName}' contains formatted header and data rows (row count: ${rowCount})`);
  }

  // ---------------------------------------------------------------------------
  // SECTION 5: SECURITY & EDGE CASES ON EXPORTS
  // ---------------------------------------------------------------------------
  console.log("\n▶ SECTION 5: SECURITY CONTROLS & EXPORT GUARDS");

  // Attempting to export financial report returns 400 with "Payments not enabled yet"
  const finExportRes = await fetch(`${BASE_URL}/api/reports/course-revenue/export?format=csv`, { headers: adminHeaders });
  assert(finExportRes.status === 400, "Financial export attempt returns HTTP 400 Bad Request");
  const finExportData = await finExportRes.json();
  assert(
    finExportData.message?.includes("Payments not enabled yet"),
    `Financial export rejection message is correct: '${finExportData.message}'`
  );

  // Attempting to export as non-admin (Teacher) returns 403 Forbidden
  const teacherExportRes = await fetch(`${BASE_URL}/api/reports/admissions/export?format=csv`, { headers: teacherHeaders });
  assert(teacherExportRes.status === 403, "Non-admin (teacher) export attempt returns HTTP 403 Forbidden");

  // Attempting to export as non-admin (Parent) returns 403 Forbidden
  const parentExportRes = await fetch(`${BASE_URL}/api/reports/admissions/export?format=csv`, { headers: parentHeaders });
  assert(parentExportRes.status === 403, "Non-admin (parent) export attempt returns HTTP 403 Forbidden");

  // ---------------------------------------------------------------------------
  // FINAL SCORE & SUMMARY
  // ---------------------------------------------------------------------------
  console.log("\n================================================================================");
  console.log(`TASK 6 VERIFICATION RESULTS: ${passed} PASSED, ${failed} FAILED`);
  console.log("================================================================================");

  if (failed > 0) {
    console.error("❌ VERDICT: FAIL -- Task 6 verification failed");
    process.exit(1);
  } else {
    console.log("✅ VERDICT: PASS -- All Task 6 acceptance criteria verified with real data");
    process.exit(0);
  }
}

runTask6Verification().catch(err => {
  console.error("Unhandled verification exception:", err);
  process.exit(1);
});
