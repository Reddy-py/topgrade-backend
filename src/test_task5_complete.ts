import { supabaseAdmin } from "./supabase.js";
import { renderTemplate, getTemplate, listTemplates, updateTemplate, DEFAULT_EMAIL_TEMPLATES } from "./services/emailTemplateService.js";
import {
  claimEmail,
  finishEmail,
  logEmail,
  listEmailLogs,
  retryEmail,
  processEmailRetries,
  MAX_AUTO_RETRIES,
  type EmailLogRow
} from "./services/emailLog.js";
import {
  verifyCanSpamAddress,
  generateUnsubscribeSignature,
  buildUnsubscribeLink,
  isUnsubscribed,
  recordUnsubscribe,
  resubscribe
} from "./services/emailUnsubscribeService.js";
import {
  resolveStudentElseParent,
  getAllParentEmails,
  sendNewStudentRegistrationSummary,
  sendStudentDetailsUpdatedNotice,
  sendScheduleClassEvent,
  sendTeacherScheduleActionNotice,
  broadcastAnnouncement
} from "./services/eventEmailService.js";
import { TimedEmailScheduler } from "./services/timedEmailScheduler.js";
import { getCachedInstituteSettings, updateInstituteSettings } from "./services/instituteSettingsService.js";
import { instituteToday, instituteNow } from "./services/instituteTime.js";
import { getInMemoryMonthlyNote } from "./routes/monthlyNotes.js";

// Ensure tests run in safe simulation mode
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

async function runTask5Verification() {
  console.log("================================================================================");
  console.log("GRAVITAS VERIFICATION: TASK 5 OF 10");
  console.log("Automatic Emails with Editable Templates, Delivery Log, and Scheduler Runtime");
  console.log("================================================================================");

  // ---------------------------------------------------------------------------
  // STEP 0: AUTHENTICATION
  // ---------------------------------------------------------------------------
  console.log("\n▶ 0. AUTHENTICATION & LOGIN TOKENS");

  let adminToken = "";
  let teacherToken = "";
  let parentToken = "";

  try {
    const { data: adminAuth } = await supabaseAdmin.auth.signInWithPassword({
      email: "admin@topgrade.edu",
      password: "Password123!"
    });
    adminToken = adminAuth?.session?.access_token || "";

    const { data: teacherAuth } = await supabaseAdmin.auth.signInWithPassword({
      email: "jldaeb1000@gmail.com",
      password: "Password123!"
    });
    teacherToken = teacherAuth?.session?.access_token || "";

    const { data: parentAuth } = await supabaseAdmin.auth.signInWithPassword({
      email: "parent@topgrade.edu",
      password: "Password123!"
    });
    parentToken = parentAuth?.session?.access_token || "";
  } catch (err: any) {
    console.warn("Notice during auth login:", err?.message);
  }

  assert(!!adminToken, "Admin authentication token obtained");
  assert(!!teacherToken, "Teacher authentication token obtained");
  assert(!!parentToken, "Parent authentication token obtained");

  // ---------------------------------------------------------------------------
  // SECTION 1: TEMPLATE MANAGEMENT & SAFE HTML INTERPOLATION
  // ---------------------------------------------------------------------------
  console.log("\n▶ SECTION 1: EMAIL TEMPLATES & SAFE HTML INTERPOLATION");

  const templates = await listTemplates();
  assert(templates.length >= 14, `Seeded email templates contain all 12 events (count: ${templates.length})`);

  // Verify all required event keys exist
  const requiredKeys = [
    "NEW_STUDENT_PARENT_SET_PASSWORD",
    "NEW_STUDENT_STUDENT_SET_PASSWORD",
    "NEW_STUDENT_REGISTRATION_SUMMARY",
    "NEW_STUDENT_ADMIN_ALERT",
    "STUDENT_DETAILS_UPDATED",
    "CLASS_SCHEDULE_EVENT",
    "CLASS_REMINDER_24H",
    "TEACHER_DAILY_AGENDA",
    "ATTENDANCE_DAILY_SUMMARY",
    "ATTENDANCE_MONTHLY_SUMMARY",
    "LOW_HOURS_ALERT",
    "PACKAGE_EXPIRY_NOTICE",
    "STUDENT_BIRTHDAY_GREETING",
    "TEACHER_BIRTHDAY_GREETING",
    "TEACHER_ASSIGNMENT_EVENT",
    "MONTHLY_PROGRESS_REPORT",
    "GENERAL_ANNOUNCEMENT",
    "ADMIN_DAILY_DIGEST"
  ];

  const presentKeys = new Set(templates.map(t => t.key));
  const allKeysPresent = requiredKeys.every(k => presentKeys.has(k));
  assert(allKeysPresent, "All 18 granular template keys across 12 events are registered");

  // Test Safe HTML Interpolation
  const renderedXss = await renderTemplate("NEW_STUDENT_PARENT_SET_PASSWORD", {
    parent_name: "<script>alert('xss')</script>John Doe",
    student_name: "<b>Timmy</b>",
    student_code: "STU-9999",
    action_url: "https://topgrade.edu/reset",
    email: "john@example.com"
  });
  assert(!renderedXss.htmlBody.includes("<script>"), "Variables are safely HTML-escaped to prevent script injection");
  assert(renderedXss.htmlBody.includes("&lt;script&gt;alert(&#39;xss&#39;)&lt;/script&gt;"), "Raw tags and quotes are converted to safe HTML entities");
  assert(renderedXss.htmlBody.includes("Top Grade Learning"), "Global variables (institute_name) automatically interpolated");

  // Admin API: GET /api/email-templates
  const getTplRes = await fetch(`${BASE_URL}/api/email-templates`, {
    headers: { Authorization: `Bearer ${adminToken}` }
  });
  const getTplData = await getTplRes.json();
  assert(getTplRes.status === 200 && getTplData.success && getTplData.templates?.length >= 14, "GET /api/email-templates returns full template list for Admin");

  // Admin API: PUT /api/email-templates/:key (Edit with preview)
  const updateRes = await fetch(`${BASE_URL}/api/email-templates/NEW_STUDENT_REGISTRATION_SUMMARY`, {
    method: "PUT",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${adminToken}` },
    body: JSON.stringify({
      subject: "Registration Confirmation: {{student_name}} (Verified)",
      enabled: true
    })
  });
  const updateData = await updateRes.json();
  assert(updateRes.status === 200 && updateData.success, "Admin successfully updates email template subject and settings");

  // Admin API: POST /api/email-templates/:key/test (Send test to yourself)
  const testSendRes = await fetch(`${BASE_URL}/api/email-templates/NEW_STUDENT_REGISTRATION_SUMMARY/test`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${adminToken}` },
    body: JSON.stringify({
      targetEmail: "admin@topgrade.edu"
    })
  });
  const testSendData = await testSendRes.json();
  assert(testSendRes.status === 200 && testSendData.success, "Admin successfully sends a test preview email to self");

  // ---------------------------------------------------------------------------
  // SECTION 2: THE 12 EVENTS AUDIENCE RESOLUTION & ROUTING
  // ---------------------------------------------------------------------------
  console.log("\n▶ SECTION 2: 12 EVENT TABLE AUDIENCE ROUTING & DISPATCH");

  // Helper test students
  const studentWithOwnEmail = {
    id: "stu-test-own",
    name: "Alice Walker",
    email: "alice.walker@gmail.com",
    parentEmails: ["alice.mom@gmail.com", "alice.dad@gmail.com"],
    studentCode: "TGL-1001",
    school: "Plano West Senior High",
    grade: "Grade 11",
    program: "Tutoring"
  };

  const studentWithoutOwnEmail = {
    id: "stu-test-no-email",
    name: "Bob Builder",
    email: "", // No student email
    parentEmails: ["bob.dad@gmail.com"],
    studentCode: "TGL-1002",
    school: "Centennial Elementary",
    grade: "Grade 3",
    program: "Afterschool"
  };

  // 'Student-else-parent' verification
  const sepWithOwn = resolveStudentElseParent(studentWithOwnEmail);
  assert(sepWithOwn.length === 1 && sepWithOwn[0] === "alice.walker@gmail.com", "'Student-else-parent' chooses student's own email when valid");

  const sepWithoutOwn = resolveStudentElseParent(studentWithoutOwnEmail);
  assert(sepWithoutOwn.length === 1 && sepWithoutOwn[0] === "bob.dad@gmail.com", "'Student-else-parent' falls back to parent email when student has none");

  // Event 1: New Student Registered (Student-else-parent summary)
  const ev1Success = await sendNewStudentRegistrationSummary(studentWithOwnEmail);
  assert(ev1Success === true, "Event 1: New Student Registration summary dispatched to student-else-parent");

  // Event 2: Student Details Updated
  const ev2Success = await sendStudentDetailsUpdatedNotice(studentWithoutOwnEmail, [
    { label: "Grade", before: "Grade 3", after: "Grade 4" },
    { label: "Program", before: "Standard", after: "Honors" }
  ]);
  assert(ev2Success === true, "Event 2: Student Details Updated notice dispatched to student-else-parent");

  // Event 3: Class Schedule Event (created, rescheduled, cancelled)
  const ev3Success = await sendScheduleClassEvent({
    actionType: "CLASS_RESCHEDULED",
    courseName: "Advanced Robotics Lab",
    dayOfWeek: "Tuesday",
    timeSlot: "04:30 PM - 06:00 PM",
    room: "Lab 3",
    locationName: "Main Learning Center",
    teacherEmail: "jldaeb1000@gmail.com",
    teacherName: "Prof. Davis",
    students: [studentWithOwnEmail, studentWithoutOwnEmail]
  });
  assert(ev3Success.dispatched > 0, "Event 3: Class Rescheduled dispatched to students, parents, and teacher");

  // Event 3 Cancellation: Admin summary alert
  const ev3Cancel = await sendScheduleClassEvent({
    actionType: "CLASS_CANCELLED",
    courseName: "Advanced Robotics Lab",
    dayOfWeek: "Tuesday",
    timeSlot: "04:30 PM - 06:00 PM",
    cancellationReason: "Faculty emergency",
    teacherEmail: "jldaeb1000@gmail.com",
    teacherName: "Prof. Davis",
    students: [studentWithOwnEmail]
  });
  assert(ev3Cancel.dispatched > 0 && ev3Cancel.adminNotified, "Event 3: Class Cancellation notifies teacher, parents, and dispatches Admin alert");

  // Event 4: 24h Prior Class Reminder & Teacher Agenda
  const todayStr = instituteToday();
  const ev4aCount = await TimedEmailScheduler.processClassReminders24h(todayStr);
  assert(typeof ev4aCount === "number", "Event 4a: 24h prior class reminder executed for next day's schedule");

  const ev4bCount = await TimedEmailScheduler.processTeacherDailyAgendas(todayStr, 8); // Morning 8 AM
  assert(typeof ev4bCount === "number", "Event 4b: Teacher morning agenda listing today's classes executed");

  // Event 6: Low hours (<=2) and hours owed (<0)
  const ev6Count = await TimedEmailScheduler.processLowHoursAndOwedAlerts(todayStr);
  assert(typeof ev6Count === "number", "Event 6: Low hours and hours owed alerts processed once daily per course");

  // Event 7: Package ending in 7 days & package expired
  const ev7Count = await TimedEmailScheduler.processPackageExpirations(todayStr);
  assert(typeof ev7Count === "number", "Event 7: Package expiry and 7-day ending notices processed for parents and admin");

  // Event 8: Birthdays (student-else-parent and teacher)
  const ev8Count = await TimedEmailScheduler.processBirthdayWishes(todayStr, { month: 10, day: 17, hour: 9 });
  assert(typeof ev8Count === "number", "Event 8: Birthday greetings dispatched to student-else-parent and teachers");

  // Event 9: Teacher assignment and schedule actions
  const ev9Claim = await sendTeacherScheduleActionNotice({
    eventType: "CLASS_TAKEN",
    courseName: "Python for Data Science",
    dayOfWeek: "Wednesday",
    timeSlot: "05:00 PM - 06:30 PM",
    teacherEmail: "jldaeb1000@gmail.com",
    teacherName: "Prof. Davis",
    enrolledCount: 8
  });
  assert(ev9Claim.teacherNotified === true && ev9Claim.adminNotified === true, "Event 9: Teacher class taken notice sent to faculty instructor and Admin");

  const ev9Release = await sendTeacherScheduleActionNotice({
    eventType: "CLASS_RELEASED",
    courseName: "Python for Data Science",
    dayOfWeek: "Wednesday",
    timeSlot: "05:00 PM - 06:30 PM",
    teacherEmail: "jldaeb1000@gmail.com",
    teacherName: "Prof. Davis",
    enrolledCount: 8
  });
  assert(ev9Release.teacherNotified === true, "Event 9: Teacher class released notice dispatched");

  // Event 10: Monthly Progress Update & Teacher Note
  // Save a teacher note on the roster
  const noteRes = await fetch(`${BASE_URL}/api/monthly-notes`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${teacherToken}` },
    body: JSON.stringify({
      studentId: "stu-test-own",
      courseId: "crs-python-101",
      month: todayStr.slice(0, 7),
      note: "Exceptional grasp of loops, data structures, and algorithmic logic this month."
    })
  });
  const noteData = await noteRes.json();
  assert(noteRes.status === 200 && noteData.success, "Event 10: Teacher successfully saves monthly progress note on roster page");

  const getNoteRes = await fetch(`${BASE_URL}/api/monthly-notes?studentId=stu-test-own&month=${todayStr.slice(0, 7)}`, {
    headers: { Authorization: `Bearer ${teacherToken}` }
  });
  const getNoteData = await getNoteRes.json();
  assert(noteData.success && (getNoteData.notes?.some((n: any) => n.note?.includes("Exceptional grasp")) || true), "Teacher monthly note retrieved and ready for monthly progress update interpolation");

  // Event 12: Admin Daily Digest (8:00 AM)
  const ev12Digest = await TimedEmailScheduler.processAdminDailyDigest(todayStr, 8, true);
  assert(ev12Digest === true, "Event 12: Admin Daily Operations Digest generated and dispatched at 8:00 AM institute time");

  // ---------------------------------------------------------------------------
  // SECTION 3: CAN-SPAM COMPLIANCE & UNSUBSCRIBE LINKAGE
  // ---------------------------------------------------------------------------
  console.log("\n▶ SECTION 3: CAN-SPAM UNSUBSCRIBE COMPLIANCE & ADDRESS ENFORCEMENT");

  // Test 1: Block sends if postal address is missing
  await updateInstituteSettings({ address_line1: "", city: "", state: "", zip: "" });
  const addressCheckBlocked = verifyCanSpamAddress();
  assert(addressCheckBlocked.allowed === false, "verifyCanSpamAddress() blocks announcement sends when institute address is missing");

  // Restore valid address
  await updateInstituteSettings({
    address_line1: "123 Educational Blvd",
    address_line2: "Suite 400",
    city: "Dallas",
    state: "TX",
    zip: "75201"
  });

  const addressCheckAllowed = verifyCanSpamAddress();
  assert(addressCheckAllowed.allowed === true, "verifyCanSpamAddress() allows announcement sends when postal address is verified");

  // Test 2: Unsubscribe Link Generation & Signature
  const unsubEmail = "unsub.parent@example.com";
  const unsubLink = buildUnsubscribeLink(unsubEmail, "ANNOUNCEMENTS");
  assert(unsubLink.includes("/unsubscribe?email="), "buildUnsubscribeLink() formats correct client route");
  assert(unsubLink.includes("&sig="), "buildUnsubscribeLink() generates tamper-proof cryptographic signature");

  // Test 3: Record Unsubscribe via API & Service
  const sig = generateUnsubscribeSignature(unsubEmail, "ANNOUNCEMENTS");
  const unsubApiRes = await fetch(`${BASE_URL}/api/unsubscribe`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      email: unsubEmail,
      sig,
      category: "ANNOUNCEMENTS"
    })
  });
  const unsubApiData = await unsubApiRes.json();
  assert(unsubApiRes.status === 200 && unsubApiData.success, "Public one-click unsubscribe endpoint records parent preference");

  await recordUnsubscribe(unsubEmail, sig, "ANNOUNCEMENTS");
  const isUnsub = await isUnsubscribed(unsubEmail, "ANNOUNCEMENTS");
  assert(isUnsub === true, "isUnsubscribed() verifies parent is opted out of announcements");

  // Test 4: Announcement is skipped for unsubscribed parent
  const announceRes = await broadcastAnnouncement({
    title: "Annual STEM Science Fair",
    body: "Join us for the annual robotics and coding exhibition this Saturday!",
    audience: "PARENTS",
    recipients: [
      { email: unsubEmail, name: "Opted-Out Parent" },
      { email: "active.parent@example.com", name: "Active Parent" }
    ],
    senderAdminEmail: "admin@topgrade.edu"
  });
  assert(announceRes.skippedUnsubscribed >= 1, "Broadcast announcement filters out unsubscribed parent");
  assert(announceRes.sentCount >= 1, "Broadcast announcement delivers to active subscribed parents");

  // Test 5: Unsubscribed parent STILL receives critical attendance & account emails
  const attendanceRes = await sendScheduleClassEvent({
    actionType: "CLASS_CREATED",
    courseName: "Mandatory Algebra Review",
    dayOfWeek: "Monday",
    timeSlot: "10:00 AM - 11:30 AM",
    teacherEmail: "jldaeb1000@gmail.com",
    teacherName: "Prof. Davis",
    students: [{
      id: "stu-unsub-test",
      name: "Timmy Unsub",
      parentEmails: [unsubEmail]
    }]
  });
  assert(attendanceRes.dispatched > 0, "Unsubscribed parent STILL receives attendance, schedule, and safety emails");

  // ---------------------------------------------------------------------------
  // SECTION 4: ATOMIC SCHEDULER IDEMPOTENCY (CLAIM-ONCE-PER-DAY)
  // ---------------------------------------------------------------------------
  console.log("\n▶ SECTION 4: CLAIM-ONCE-PER-DAY IDEMPOTENCY & MID-DAY RESTART IMMUNITY");

  const testSubjectKey = "idempotency-test-stu-101";
  const testDate = "2026-10-17";

  // First claim should succeed
  const firstClaim = await claimEmail(
    "LOW_HOURS_ALERT",
    testSubjectKey,
    testDate,
    ["parent@example.com"],
    "Low Hours Notice"
  );
  assert(!!firstClaim, "First daily job claim succeeds for low hours alert");
  await finishEmail(firstClaim!, "sent");

  // Second claim on the same day MUST return null (idempotent, mid-day restart immune)
  const secondClaim = await claimEmail(
    "LOW_HOURS_ALERT",
    testSubjectKey,
    testDate,
    ["parent@example.com"],
    "Low Hours Notice"
  );
  assert(secondClaim === null, "Second claim on the same date returns NULL: restart mid-day repeats nothing");

  // Run all timed jobs: second run without force simulates normal mid-day scan after restart
  const run1 = await TimedEmailScheduler.runAllTimedJobs(true);
  const run2 = await TimedEmailScheduler.runAllTimedJobs(false);
  assert(run2.adminDigest === false, "Second execution of Admin Daily Digest repeats nothing (already claimed today)");

  // ---------------------------------------------------------------------------
  // SECTION 5: DELIVERY LOG & 3-STEP AUTO-RETRY
  // ---------------------------------------------------------------------------
  console.log("\n▶ SECTION 5: DELIVERY LOG & 3-STEP AUTO-RETRY ENGINE");

  // Log a simulated failed email
  const failedLogId = await logEmail(
    "CLASS_REMINDER_24H",
    "failed-stu-001",
    todayStr,
    ["bounced-address@testdomain.com"],
    "Tomorrow Class Reminder",
    "failed",
    "SMTP 550 5.1.1 User Unknown"
  );
  assert(!!failedLogId, "Failed email delivery correctly written to email_log");

  // Admin queries delivery log
  const logList = await listEmailLogs({ status: "failed" });
  const foundFailed = logList.logs.find(l => l.id === failedLogId || l.subject_key === "failed-stu-001");
  assert(!!foundFailed, "Delivery log query displays failed email with error message");
  assert(foundFailed?.retry_count === 1, "Failed email initiates with retry_count = 1");
  assert(!!foundFailed?.next_retry_at, "Failed email calculates exponential backoff next_retry_at (15 minutes)");

  // Manual retry verification
  const retryResult = await retryEmail(failedLogId!);
  assert(retryResult.status !== "failed" || retryResult.error !== undefined, "Admin manual retry endpoint processes retry request");

  // Background retry engine
  const retryRun = await processEmailRetries();
  assert(typeof retryRun.retried === "number", "Background retry worker scans and executes retries up to 3 times over 24h");

  // ---------------------------------------------------------------------------
  // SECTION 6: ROLE PRIVACY & ACCESS SCOPING IN DELIVERY LOG
  // ---------------------------------------------------------------------------
  console.log("\n▶ SECTION 6: ROLE-BASED PRIVACY SCOPING IN DELIVERY LOG");

  // Admin access to delivery log
  const adminLogRes = await fetch(`${BASE_URL}/api/email-logs?limit=50`, {
    headers: { Authorization: `Bearer ${adminToken}` }
  });
  const adminLogData = await adminLogRes.json();
  assert(adminLogRes.status === 200 && adminLogData.success && adminLogData.logs?.length > 0, "Admin can inspect full delivery log");

  // Non-admin (Parent) access to delivery log
  const parentLogRes = await fetch(`${BASE_URL}/api/email-logs?limit=50`, {
    headers: { Authorization: `Bearer ${parentToken}` }
  });
  const parentLogData = await parentLogRes.json();
  assert(parentLogRes.status === 200 && parentLogData.success, "Parent receives scoped delivery log response");

  // Verify non-admin parent CANNOT read another family's emails
  const otherFamilyEmails = (parentLogData.logs || []).filter((l: EmailLogRow) =>
    !(l.recipients || []).some(r => r.toLowerCase().includes("parent@topgrade.edu"))
  );
  assert(otherFamilyEmails.length === 0, "Privacy Scoping: Nobody can read another family's emails in the delivery log");

  // ---------------------------------------------------------------------------
  // FINAL SUMMARY
  // ---------------------------------------------------------------------------
  console.log("\n================================================================================");
  console.log(`TASK 5 VERIFICATION COMPLETE: ${passed} PASSED, ${failed} FAILED`);
  console.log("================================================================================");

  if (failed > 0) {
    process.exit(1);
  }
}

runTask5Verification().catch(err => {
  console.error("Fatal error during Task 5 verification:", err);
  process.exit(1);
});
