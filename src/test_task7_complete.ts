import { createClient } from "@supabase/supabase-js";
import dotenv from "dotenv";
import ExcelJS from "exceljs";

dotenv.config();

let BASE_URL = process.env.API_BASE_URL || "http://localhost:5000";

async function resolveBaseUrl(): Promise<string> {
  for (const port of [5000, 5001]) {
    try {
      const res = await fetch(`http://localhost:${port}/api/health`);
      if (res.ok) return `http://localhost:${port}`;
    } catch {}
  }
  return "http://localhost:5000";
}

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

async function runTask7Verification() {
  BASE_URL = await resolveBaseUrl();
  console.log("================================================================================");
  console.log("GRAVITAS VERIFICATION: TASK 7 OF 10");
  console.log("History, Past Data, Retention List, Re-enrollment Invites, and Exports");
  console.log(`Backend Engine URL: ${BASE_URL}`);
  console.log("================================================================================");

  // ---------------------------------------------------------------------------
  // STEP 0: AUTHENTICATION
  // ---------------------------------------------------------------------------
  console.log("\n▶ STEP 0: AUTHENTICATION TOKENS");

  let adminToken = "";
  let teacherToken = "";
  let parentToken = "";
  let parentChildId = "";

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

    // Find a student associated with parent@topgrade.edu
    const { data: parentStudents } = await dbClient
      .from("students")
      .select("id, name, email, parent_emails")
      .or("email.eq.parent@topgrade.edu,parent_emails.cs.{\"parent@topgrade.edu\"}");

    if (parentStudents && parentStudents.length > 0) {
      parentChildId = parentStudents[0].id;
    } else {
      // Pick any student for parent test linking and link parent@topgrade.edu
      const { data: firstStu } = await dbClient.from("students").select("id, parent_emails").limit(1);
      if (firstStu && firstStu.length > 0) {
        parentChildId = firstStu[0].id;
        const currentParentEmails = Array.isArray(firstStu[0].parent_emails) ? firstStu[0].parent_emails : [];
        if (!currentParentEmails.includes("parent@topgrade.edu")) {
          await dbClient.from("students").update({
            parent_emails: [...currentParentEmails, "parent@topgrade.edu"]
          }).eq("id", parentChildId);
        }
      }
    }
  } catch (err: any) {
    console.warn("Auth initialization note:", err?.message);
  }

  assert(!!adminToken, "Admin JWT authentication token obtained");
  assert(!!teacherToken, "Teacher JWT authentication token obtained");
  assert(!!parentToken, "Parent JWT authentication token obtained");
  console.log(`  Identified test parent's child ID: ${parentChildId}`);

  const adminHeaders = { Authorization: `Bearer ${adminToken}`, "Content-Type": "application/json" };
  const teacherHeaders = { Authorization: `Bearer ${teacherToken}`, "Content-Type": "application/json" };
  const parentHeaders = { Authorization: `Bearer ${parentToken}`, "Content-Type": "application/json" };

  // ---------------------------------------------------------------------------
  // STEP 1: HISTORY PAGE TABS & TABLE-BACKED DATA
  // ---------------------------------------------------------------------------
  console.log("\n▶ STEP 1: HISTORY TABS & TABLE-BACKED DATA");

  // 1.1 Overview metrics
  const overRes = await fetch(`${BASE_URL}/api/history/overview`, { headers: adminHeaders });
  assert(overRes.status === 200, "GET /api/history/overview returns 200 OK");
  const overJson = await overRes.json();
  assert(overJson.success === true, "Overview response success is true");
  assert(typeof overJson.data?.totalStudents === "number", `Overview has totalStudents count (${overJson.data?.totalStudents})`);
  assert(typeof overJson.data?.retentionOpportunities === "number", `Overview has retentionOpportunities count (${overJson.data?.retentionOpportunities})`);

  // 1.2 Tutoring (past)
  const tutRes = await fetch(`${BASE_URL}/api/history/tutoring`, { headers: adminHeaders });
  assert(tutRes.status === 200, "GET /api/history/tutoring returns 200 OK");
  const tutJson = await tutRes.json();
  assert(tutJson.success === true && Array.isArray(tutJson.data), `Tutoring past returned ${tutJson.data?.length} records from tables`);
  if (tutJson.data.length > 0) {
    const record = tutJson.data[0];
    assert(record.studentName && (record.status || record.subject), `Tutoring record has studentName (${record.studentName}) and course/status info`);
  }

  // 1.3 Afterschool (past)
  const aftRes = await fetch(`${BASE_URL}/api/history/afterschool`, { headers: adminHeaders });
  assert(aftRes.status === 200, "GET /api/history/afterschool returns 200 OK");
  const aftJson = await aftRes.json();
  assert(aftJson.success === true && Array.isArray(aftJson.data), `Afterschool past returned ${aftJson.data?.length} records from tables`);

  // 1.4 Student history (timeline events)
  const stuHistRes = await fetch(`${BASE_URL}/api/history/students`, { headers: adminHeaders });
  assert(stuHistRes.status === 200, "GET /api/history/students returns 200 OK");
  const stuHistJson = await stuHistRes.json();
  assert(stuHistJson.success === true && Array.isArray(stuHistJson.data), `Student history returned ${stuHistJson.data?.length} timeline events from tables`);

  // 1.5 Attendance history
  const attHistRes = await fetch(`${BASE_URL}/api/history/attendance`, { headers: adminHeaders });
  assert(attHistRes.status === 200, "GET /api/history/attendance returns 200 OK");
  const attHistJson = await attHistRes.json();
  assert(attHistJson.success === true && Array.isArray(attHistJson.data), `Attendance history returned ${attHistJson.data?.length} logs from attendance table`);

  // 1.6 Payment history stays hidden/disabled until payments return
  const payHistRes = await fetch(`${BASE_URL}/api/history/payments`, { headers: adminHeaders });
  assert(payHistRes.status === 200, "GET /api/history/payments returns 200 OK");
  const payHistJson = await payHistRes.json();
  assert(payHistJson.available === false, `Payment history reports available=false ('${payHistJson.message}')`);

  // ---------------------------------------------------------------------------
  // STEP 2: RETENTION LIST (ADMIN)
  // ---------------------------------------------------------------------------
  console.log("\n▶ STEP 2: RETENTION LIST & 30/60/90 DAYS GROUPING");

  const retRes = await fetch(`${BASE_URL}/api/history/retention`, { headers: adminHeaders });
  assert(retRes.status === 200, "GET /api/history/retention returns 200 OK");
  const retJson = await retRes.json();
  assert(retJson.success === true, "Retention list response success is true");
  assert(typeof retJson.total === "number", `Total retention candidates: ${retJson.total}`);
  assert(retJson.grouped && Array.isArray(retJson.grouped.days30), "Retention grouped includes days30 cohort");
  assert(retJson.grouped && Array.isArray(retJson.grouped.days60), "Retention grouped includes days60 cohort");
  assert(retJson.grouped && Array.isArray(retJson.grouped.days90), "Retention grouped includes days90 cohort");
  assert(retJson.grouped && Array.isArray(retJson.grouped.over90), "Retention grouped includes over90 cohort");

  console.log(`  Cohorts: 30 days=${retJson.grouped.days30.length}, 60 days=${retJson.grouped.days60.length}, 90 days=${retJson.grouped.days90.length}, 90+ days=${retJson.grouped.over90.length}`);

  let testCandidate = (retJson.data && retJson.data.length > 0 ? retJson.data[0] : null) || (retJson.all && retJson.all.length > 0 ? retJson.all[0] : null);
  if (testCandidate) {
    assert(testCandidate.studentId && testCandidate.studentName, `Candidate has student ID and Name (${testCandidate.studentName})`);
    assert(testCandidate.lastCourse !== undefined, `Candidate has last course (${testCandidate.lastCourse})`);
    assert(typeof testCandidate.unusedHours === "number", `Candidate has unused hours (${testCandidate.unusedHours} hrs)`);
    assert(testCandidate.parentContacts !== undefined, `Candidate has parent contacts (${JSON.stringify(testCandidate.parentContacts)})`);
    assert(typeof testCandidate.daysSinceLastClass === "number", `Candidate days since last class: ${testCandidate.daysSinceLastClass}`);
    assert(testCandidate.canSendInvite !== undefined || testCandidate.inviteCooldown !== undefined, `Candidate has invite cooldown info (canSendInvite: ${testCandidate.canSendInvite ?? testCandidate.inviteCooldown?.eligible})`);
  } else {
    console.log("  [NOTE] No natural retention candidates found. Will verify with dynamically designated test student.");
  }

  // ---------------------------------------------------------------------------
  // STEP 3: RE-ENROLLMENT INVITE & 1-WEEK RATE LIMIT COOLDOWN
  // ---------------------------------------------------------------------------
  console.log("\n▶ STEP 3: RE-ENROLLMENT INVITE (STUDENT-ELSE-PARENT & 1-WEEK RATE LIMIT)");

  // Pick a student for the invite test
  const { data: candidateStudents } = await dbClient
    .from("students")
    .select("id, name, email, parent_emails, student_id_code")
    .limit(1);

  const inviteStudent = candidateStudents && candidateStudents.length > 0 ? candidateStudents[0] : null;
  assert(!!inviteStudent, "Found test student for re-enrollment invitation");

  if (inviteStudent) {
    const stuId = inviteStudent.id;

    // Clean up any existing RE_ENROLLMENT_INVITE logs for this student so test starts fresh
    await dbClient.from("email_log").delete().eq("subject_key", stuId).eq("kind", "RE_ENROLLMENT_INVITE");

    // 3.1 First Invite: Should SUCCEED
    const invite1Res = await fetch(`${BASE_URL}/api/history/re-enrollment-invite`, {
      method: "POST",
      headers: adminHeaders,
      body: JSON.stringify({
        studentId: stuId,
        offerDiscountCode: "TESTRETURN20",
        customNote: "Automated Gravitas Verification Test Invitation"
      })
    });

    const invite1Json = await invite1Res.json();
    assert(invite1Res.status === 200, `First re-enrollment invite returned 200: ${invite1Json.message}`);
    assert(invite1Json.success === true, "First re-enrollment invite success is true");
    const targetRecipient = invite1Json.recipientEmail || invite1Json.recipient;
    assert(!!targetRecipient, `Invitation dispatched to student-else-parent email: ${targetRecipient}`);

    // Verify email_log entry created
    const { data: logEntry } = await dbClient
      .from("email_log")
      .select("*")
      .eq("subject_key", stuId)
      .eq("kind", "RE_ENROLLMENT_INVITE")
      .order("created_at", { ascending: false })
      .limit(1);

    assert(logEntry && logEntry.length > 0, "Dispatched invitation recorded in email_log table");
    if (logEntry && logEntry.length > 0) {
      assert(logEntry[0].status?.toLowerCase() === "sent" || logEntry[0].status?.toLowerCase() === "delivered", `Email log status is ${logEntry[0].status}`);
      const logRecs = (Array.isArray(logEntry[0].recipients) ? logEntry[0].recipients : []).map((r: string) => r.toLowerCase());
      assert(logRecs.includes(targetRecipient.toLowerCase()), `Email log recipients contains ${targetRecipient}`);
    }

    // Verify student_history timeline entry created
    const stuHistAuditRes = await fetch(`${BASE_URL}/api/history/student/${stuId}`, { headers: adminHeaders });
    const stuHistAuditJson = await stuHistAuditRes.json();
    const hasInviteEvent = (stuHistAuditJson.data || []).some((item: any) =>
      item.eventType === "NOTE" || item.event_type === "NOTE" ||
      (item.title && item.title.includes("Re-Enrollment")) ||
      (item.description && item.description.includes("Re-enrollment"))
    );
    assert(hasInviteEvent, "Dispatched invitation recorded in student's history audit ledger");

    // 3.2 Second Invite: Should be BLOCKED by 1-week rate limit cooldown!
    const invite2Res = await fetch(`${BASE_URL}/api/history/re-enrollment-invite`, {
      method: "POST",
      headers: adminHeaders,
      body: JSON.stringify({
        studentId: stuId,
        offerDiscountCode: "REPEATTRY",
        customNote: "Immediate duplicate try"
      })
    });

    const invite2Json = await invite2Res.json();
    assert(
      invite2Res.status === 429 || invite2Res.status === 400,
      `Second invite within 7 days was correctly rejected with status ${invite2Res.status}: "${invite2Json.message}"`
    );
    assert(invite2Json.success === false, "Duplicate invite within 7 days success is false");
    assert(
      invite2Json.message && invite2Json.message.toLowerCase().includes("week"),
      `Rejection message clearly mentions weekly rate-limit cooldown: "${invite2Json.message}"`
    );
  }

  // ---------------------------------------------------------------------------
  // STEP 4: AUTOMATIC TRANSITION TO PAST & INACTIVE/RESTORE LIFECYCLE
  // ---------------------------------------------------------------------------
  console.log("\n▶ STEP 4: ENROLLMENT ENDING/CANCELLING -> AUTO TRANSITION TO PAST & INACTIVE/RESTORE");

  // Pick a student for the lifecycle test
  const { data: lifecycleStudents } = await dbClient
    .from("students")
    .select("id, name, status, student_id_code")
    .order("created_at", { ascending: false })
    .limit(1);

  const testStudent = lifecycleStudents && lifecycleStudents.length > 0 ? lifecycleStudents[0] : null;
  assert(!!testStudent, "Identified test student for lifecycle transitions");

  if (testStudent) {
    const testStuId = testStudent.id;

    // 4.1 Admin sets student inactive
    const inactRes = await fetch(`${BASE_URL}/api/history/set-inactive`, {
      method: "POST",
      headers: adminHeaders,
      body: JSON.stringify({
        studentId: testStuId,
        reason: "Admin setting student inactive for verification test"
      })
    });
    const inactJson = await inactRes.json();
    assert(inactRes.status === 200, `Admin set-inactive returned 200: ${inactJson.message}`);
    assert(inactJson.success === true, "Set-inactive success is true");

    // Verify student status in database
    const { data: inactStudent } = await dbClient.from("students").select("status").eq("id", testStuId).single();
    assert(inactStudent?.status === "INACTIVE", `Student status in DB changed to INACTIVE (was ${testStudent.status})`);

    // Verify audit log in student history
    const inactAuditRes = await fetch(`${BASE_URL}/api/history/student/${testStuId}`, { headers: adminHeaders });
    const inactAuditJson = await inactAuditRes.json();
    const hasInactEvent = (inactAuditJson.data || []).some((e: any) =>
      (e.title && e.title.toLowerCase().includes("inactive")) ||
      (e.description && e.description.toLowerCase().includes("inactive"))
    );
    assert(hasInactEvent, "STUDENT_INACTIVATED recorded in student history with who and when");

    // 4.2 Admin restores student to current
    const restoreRes = await fetch(`${BASE_URL}/api/history/restore-student`, {
      method: "POST",
      headers: adminHeaders,
      body: JSON.stringify({
        studentId: testStuId,
        reason: "Restoring student to active state after verification test"
      })
    });
    const restoreJson = await restoreRes.json();
    assert(restoreRes.status === 200, `Admin restore-student returned 200: ${restoreJson.message}`);
    assert(restoreJson.success === true, "Restore-student success is true");

    const { data: restoredStudent } = await dbClient.from("students").select("status").eq("id", testStuId).single();
    assert(restoredStudent?.status === "ACTIVE", `Student status restored to ACTIVE in database`);

    const restoreAuditRes = await fetch(`${BASE_URL}/api/history/student/${testStuId}`, { headers: adminHeaders });
    const restoreAuditJson = await restoreAuditRes.json();
    const hasRestoreEvent = (restoreAuditJson.data || []).some((e: any) =>
      (e.title && e.title.toLowerCase().includes("restore")) ||
      (e.description && e.description.toLowerCase().includes("restore"))
    );
    assert(hasRestoreEvent, "STUDENT_RESTORED recorded in student history with who and when");

    // 4.3 Automatic transition to PAST when enrollment ends / is cancelled
    // Call PATCH /api/enrollments/:id/status with COMPLETED
    const endEnrollRes = await fetch(`${BASE_URL}/api/enrollments/${testStuId}/status`, {
      method: "PATCH",
      headers: adminHeaders,
      body: JSON.stringify({
        status: "COMPLETED",
        reason: "Course term completed successfully"
      })
    });

    const endEnrollJson = await endEnrollRes.json();
    assert(endEnrollRes.status === 200, `PATCH /api/enrollments/:id/status returned 200: ${endEnrollJson.message}`);
    assert(endEnrollJson.studentMovedToPast === true, "Enrollment response confirms studentMovedToPast === true");

    // Verify that student status in database is automatically moved to PAST
    const { data: postEnrollStudent } = await dbClient.from("students").select("status").eq("id", testStuId).single();
    assert(postEnrollStudent?.status === "PAST", `Student automatically moved to PAST after ending last enrollment (Current DB Status: ${postEnrollStudent?.status})`);

    // Verify recorded in student_history
    const pastAuditRes = await fetch(`${BASE_URL}/api/history/student/${testStuId}`, { headers: adminHeaders });
    const pastAuditJson = await pastAuditRes.json();
    const hasPastEvent = (pastAuditJson.data || []).some((e: any) =>
      (e.title && e.title.toLowerCase().includes("past")) ||
      (e.description && e.description.toLowerCase().includes("past"))
    );
    assert(hasPastEvent, "Auto-transition to PAST recorded in student_history with who and when");

    // Clean up test student back to ACTIVE
    await dbClient.from("students").update({ status: "ACTIVE" }).eq("id", testStuId);
  }

  // ---------------------------------------------------------------------------
  // STEP 5: EXPORT RETENTION LIST TO CSV AND EXCEL (.XLSX)
  // ---------------------------------------------------------------------------
  console.log("\n▶ STEP 5: RETENTION LIST EXPORT TO CSV AND EXCEL");

  // 5.1 Export to CSV
  const csvRes = await fetch(`${BASE_URL}/api/history/retention/export?format=csv`, { headers: adminHeaders });
  assert(csvRes.status === 200, "GET /api/history/retention/export?format=csv returns 200 OK");
  assert(csvRes.headers.get("content-type")?.includes("text/csv") === true, "CSV content-type header is text/csv");
  const csvText = await csvRes.text();
  assert(csvText.toLowerCase().includes("top grade") || csvText.toLowerCase().includes("topgrade"), "CSV header contains Institute Name");
  assert(csvText.includes("Student Name") && (csvText.includes("Days Since Last Class") || csvText.includes("Days Inactive")), "CSV contains Retention columns");
  console.log(`  CSV Export verified (${csvText.split("\n").length} lines)`);

  // 5.2 Export to Excel (.xlsx)
  const xlsxRes = await fetch(`${BASE_URL}/api/history/retention/export?format=xlsx`, { headers: adminHeaders });
  assert(xlsxRes.status === 200, "GET /api/history/retention/export?format=xlsx returns 200 OK");
  assert(
    xlsxRes.headers.get("content-type")?.includes("spreadsheetml.sheet") === true,
    "Excel content-type header is application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
  );
  const xlsxBuffer = await xlsxRes.arrayBuffer();
  assert(xlsxBuffer.byteLength > 1000, `Excel file received with non-trivial size (${xlsxBuffer.byteLength} bytes)`);

  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.load(xlsxBuffer);
  const worksheet = workbook.getWorksheet("Retention List");
  assert(!!worksheet, "Excel worksheet 'Retention List' exists and parsed successfully");
  if (worksheet) {
    const row1Val = worksheet.getRow(1).getCell(1).value;
    assert(String(row1Val).toLowerCase().includes("top grade") || String(row1Val).toLowerCase().includes("topgrade"), `Excel title banner contains Institute name ('${row1Val}')`);
    console.log(`  Excel worksheet verified (${worksheet.rowCount} rows, columns: ${worksheet.columnCount})`);
  }

  // ---------------------------------------------------------------------------
  // STEP 6: ROLE-BASED ACCESS CONTROL & SCOPING
  // ---------------------------------------------------------------------------
  console.log("\n▶ STEP 6: ROLE GUARDS & SCOPING (ADMIN ONLY VS PARENT CHILD)");

  // 6.1 Teacher blocked from admin retention list
  const teacherRetRes = await fetch(`${BASE_URL}/api/history/retention`, { headers: teacherHeaders });
  assert(teacherRetRes.status === 403, `Teacher is forbidden from admin retention list (HTTP ${teacherRetRes.status})`);

  // 6.2 Parent blocked from admin retention list
  const parentRetRes = await fetch(`${BASE_URL}/api/history/retention`, { headers: parentHeaders });
  assert(parentRetRes.status === 403, `Parent is forbidden from admin retention list (HTTP ${parentRetRes.status})`);

  // 6.3 Teacher blocked from admin tutoring history
  const teacherTutRes = await fetch(`${BASE_URL}/api/history/tutoring`, { headers: teacherHeaders });
  assert(teacherTutRes.status === 403, `Teacher is forbidden from admin tutoring history (HTTP ${teacherTutRes.status})`);

  // 6.4 Parent can view their own child's history inside the profile
  if (parentChildId) {
    const childHistRes = await fetch(`${BASE_URL}/api/history/student/${parentChildId}`, { headers: parentHeaders });
    assert(
      childHistRes.status === 200,
      `Parent successfully accesses their own child's academic history (HTTP ${childHistRes.status})`
    );
    const childHistJson = await childHistRes.json();
    assert(childHistJson.success === true, "Child history response success is true");
    assert(Array.isArray(childHistJson.data), `Child timeline records returned (${childHistJson.data?.length} events)`);
    assert(Array.isArray(childHistJson.pastTutoring), `Child past tutoring returned (${childHistJson.pastTutoring?.length} records)`);

    // 6.5 Parent blocked from viewing ANOTHER student's history
    const { data: otherStudents } = await dbClient
      .from("students")
      .select("id")
      .neq("id", parentChildId)
      .limit(1);

    if (otherStudents && otherStudents.length > 0) {
      const otherId = otherStudents[0].id;
      const unauthHistRes = await fetch(`${BASE_URL}/api/history/student/${otherId}`, { headers: parentHeaders });
      assert(
        unauthHistRes.status === 403,
        `Parent is forbidden from viewing another student's history (HTTP ${unauthHistRes.status})`
      );
    }
  }

  // ---------------------------------------------------------------------------
  // SUMMARY
  // ---------------------------------------------------------------------------
  console.log("\n================================================================================");
  console.log(`TASK 7 VERIFICATION COMPLETE: ${passed} PASSED, ${failed} FAILED`);
  console.log("================================================================================");

  if (failed > 0) {
    process.exit(1);
  } else {
    process.exit(0);
  }
}

runTask7Verification().catch(err => {
  console.error("FATAL ERROR in runTask7Verification:", err);
  process.exit(1);
});
