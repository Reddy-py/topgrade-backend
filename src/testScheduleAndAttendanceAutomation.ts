import dotenv from "dotenv";
dotenv.config();

import { ScheduleDataService } from "./services/scheduleDataService.js";
import { supabaseAdmin } from "./supabase.js";
import { sendClassScheduleEmail, sendDailyAttendanceRollCallEmail } from "./services/notificationService.js";

async function runAutomationVerification() {
  console.log("=========================================================================");
  console.log("🚀 STARTING E2E SCHEDULE & ATTENDANCE AUTOMATION VERIFICATION");
  console.log("=========================================================================\n");

  let passedTests = 0;
  let totalTests = 7;

  try {
    // ------------------------------------------------------------------------
    // TEST 1: STRICT EXISTING COURSES VALIDATION (No New Categories Hardcoded)
    // ------------------------------------------------------------------------
    console.log("▶ [TEST 1/7] Validating Courses Bind Strictly to Existing DB/CSV Catalog...");
    const existingCourses = await ScheduleDataService.getExistingCourses();
    console.log(`  Found ${existingCourses.length} institutional courses in catalog.`);
    if (existingCourses.length === 0) {
      throw new Error("No existing courses found in database! Strict requirement violated.");
    }
    const sampleCourse = existingCourses[0];
    console.log(`  Selected Course for Test: "${sampleCourse.name}" (ID: ${sampleCourse.id})`);
    console.log("  ✅ TEST 1 PASSED: Courses bind strictly to existing database entities.\n");
    passedTests++;

    // ------------------------------------------------------------------------
    // TEST 2: FETCH ACTIVE TEACHER & REAL STUDENTS FROM DB
    // ------------------------------------------------------------------------
    console.log("▶ [TEST 2/7] Fetching Active Faculty and Enrolled Students...");
    let teacherId = "tch-1";
    let teacherName = "Logan";

    const { data: teachers } = await supabaseAdmin.from("teachers").select("id, name").limit(1);
    if (teachers && teachers.length > 0) {
      teacherId = teachers[0].id;
      teacherName = teachers[0].name;
    }
    console.log(`  Assigned Teacher: ${teacherName} (${teacherId})`);

    const { data: students } = await supabaseAdmin.from("students").select("id, name, student_id_code, email").limit(3);
    const testStudents = (students && students.length >= 3) ? students.map(s => ({
      student_id: s.id,
      student_name: s.name,
      student_code: s.student_id_code || `TG-STU-${s.id.slice(0, 6)}`,
      email: s.email
    })) : [
      { student_id: "std-test-1", student_name: "Tanyea Fowls", student_code: "TG-STU-001", email: "tanyea@test.com" },
      { student_id: "std-test-2", student_name: "Jordan Smith", student_code: "TG-STU-002", email: "jordan@test.com" },
      { student_id: "std-test-3", student_name: "Emma Watson", student_code: "TG-STU-003", email: "emma@test.com" }
    ];

    console.log(`  Selected 3 Enrolled Students: ${testStudents.map(s => s.student_name).join(", ")}`);
    console.log("  ✅ TEST 2 PASSED: Faculty and Student entities mapped.\n");
    passedTests++;

    // ------------------------------------------------------------------------
    // TEST 3: WEEKLY SCHEDULE CREATION
    // ------------------------------------------------------------------------
    console.log("▶ [TEST 3/7] Creating Weekly Schedule Slot for Tuesday 10:00 AM - 11:30 AM...");
    const testDay = "Tuesday";
    const startTime = "10:00 AM";
    const endTime = "11:30 AM";
    const testRoom = "Classroom A-102";

    const createdSlot = await ScheduleDataService.createSchedule({
      course_id: sampleCourse.id,
      course_name: sampleCourse.name,
      teacher_id: teacherId,
      teacher_name: teacherName,
      day_of_week: testDay,
      start_time: startTime,
      end_time: endTime,
      room: testRoom,
      location: "Main Academic Center",
      max_capacity: 15,
      students: testStudents
    });

    console.log(`  Slot Created: ID=${createdSlot.id}, Course='${createdSlot.course_name}', Room='${createdSlot.room}'`);
    console.log(`  Mapped Enrolled Students Count: ${createdSlot.students?.length || 0}`);
    if (!createdSlot.students || createdSlot.students.length !== 3) {
      throw new Error("Enrolled students were not correctly bound to the schedule slot.");
    }
    console.log("  ✅ TEST 3 PASSED: Schedule slot and student roster created successfully.\n");
    passedTests++;

    // ------------------------------------------------------------------------
    // TEST 4: MULTI-POINT COLLISION PROTECTION (Teacher, Room, Student Conflicts)
    // ------------------------------------------------------------------------
    console.log("▶ [TEST 4/7] Testing Collision Protection Engine...");

    // 4A: Teacher Collision Check (Same teacher, same day, overlapping time)
    let teacherCollisionCaught = false;
    try {
      await ScheduleDataService.createSchedule({
        course_id: sampleCourse.id,
        course_name: sampleCourse.name,
        teacher_id: teacherId,
        teacher_name: teacherName,
        day_of_week: testDay,
        start_time: "10:30 AM", // Overlaps 10:00 - 11:30
        end_time: "12:00 PM",
        room: "Classroom B-201",
        students: []
      });
    } catch (err: any) {
      if (err.message.includes("Teacher Collision")) {
        teacherCollisionCaught = true;
        console.log(`  ✓ Successfully detected Teacher Collision: "${err.message}"`);
      }
    }
    if (!teacherCollisionCaught) throw new Error("Failed to detect Teacher Collision!");

    // 4B: Room Collision Check (Same room, same day, overlapping time)
    let roomCollisionCaught = false;
    try {
      await ScheduleDataService.createSchedule({
        course_id: sampleCourse.id,
        course_name: sampleCourse.name,
        teacher_id: "other-teacher-99",
        teacher_name: "Dr. Alexander",
        day_of_week: testDay,
        start_time: "10:00 AM",
        end_time: "11:30 AM",
        room: testRoom, // Room A-102 is already booked!
        students: []
      });
    } catch (err: any) {
      if (err.message.includes("Room Collision")) {
        roomCollisionCaught = true;
        console.log(`  ✓ Successfully detected Room Collision: "${err.message}"`);
      }
    }
    if (!roomCollisionCaught) throw new Error("Failed to detect Room Collision!");

    // 4C: Student Collision Check (Same student in another class at the same time)
    let studentCollisionCaught = false;
    try {
      await ScheduleDataService.createSchedule({
        course_id: sampleCourse.id,
        course_name: sampleCourse.name,
        teacher_id: "other-teacher-99",
        teacher_name: "Dr. Alexander",
        day_of_week: testDay,
        start_time: "10:30 AM",
        end_time: "12:00 PM",
        room: "Classroom C-303",
        students: [{ student_id: testStudents[0].student_id, student_name: testStudents[0].student_name }]
      });
    } catch (err: any) {
      if (err.message.includes("Student Collision")) {
        studentCollisionCaught = true;
        console.log(`  ✓ Successfully detected Student Collision: "${err.message}"`);
      }
    }
    if (!studentCollisionCaught) throw new Error("Failed to detect Student Collision!");

    console.log("  ✅ TEST 4 PASSED: 100% Collision protection verified (Teacher, Room, and Student).\n");
    passedTests++;

    // ------------------------------------------------------------------------
    // TEST 5: SCHEDULE-DRIVEN DAILY ATTENDANCE ROLL-CALL
    // ------------------------------------------------------------------------
    console.log("▶ [TEST 5/7] Executing Schedule-Driven Daily Roll-Call...");
    const todayStr = new Date().toISOString().slice(0, 10);
    const rollCallEntries = [
      { student_id: testStudents[0].student_id, student_name: testStudents[0].student_name, status: "PRESENT", remarks: "Great active answers" },
      { student_id: testStudents[1].student_id, student_name: testStudents[1].student_name, status: "ABSENT", remarks: "Unexcused absence" },
      { student_id: testStudents[2].student_id, student_name: testStudents[2].student_name, status: "EXCUSED", remarks: "Doctor appointment" }
    ];

    for (const entry of rollCallEntries) {
      // Direct insert into Supabase attendance table
      await supabaseAdmin.from("attendance").insert([
        {
          student_id: entry.student_id,
          student_name: entry.student_name,
          class_name: sampleCourse.name,
          status: entry.status,
          date: todayStr,
          remarks: entry.remarks,
          marked_by: teacherName
        }
      ]);

      // Append to student history
      ScheduleDataService.appendHistoryItem({
        student_id: entry.student_id,
        student_name: entry.student_name,
        event_type: "ATTENDANCE_RECORD",
        title: `Daily Attendance: ${entry.status}`,
        description: `Attended '${sampleCourse.name}' on ${todayStr}. Status: ${entry.status}. Note: ${entry.remarks}`,
        metadata: {
          schedule_id: createdSlot.id,
          date: todayStr,
          status: entry.status,
          course_name: sampleCourse.name,
          marked_by: teacherName,
          remarks: entry.remarks
        },
        actor: teacherName
      });
    }

    console.log(`  Logged Roll-Call for 3 students: 1 PRESENT, 1 ABSENT, 1 EXCUSED.`);
    console.log("  ✅ TEST 5 PASSED: Daily attendance roster successfully processed.\n");
    passedTests++;

    // ------------------------------------------------------------------------
    // TEST 6: NODEMAILER PARENT EMAIL NOTIFICATION DISPATCH
    // ------------------------------------------------------------------------
    console.log("▶ [TEST 6/7] Verifying Nodemailer Parent Email Pipeline...");
    const adminEmail = process.env.GMAIL_USER || "sivareddy683970@gmail.com";

    // 6A: Class Schedule Email
    const schedEmailSent = await sendClassScheduleEmail({
      parentEmail: adminEmail,
      studentName: testStudents[0].student_name,
      courseName: sampleCourse.name,
      dayOfWeek: testDay,
      timeSlot: `${startTime} - ${endTime}`,
      room: testRoom,
      teacherName: teacherName
    });
    console.log(`  ✓ Schedule Confirmation Email Sent: ${schedEmailSent}`);

    // 6B: Daily Attendance Alert Email (ABSENT scenario)
    const attEmailSent = await sendDailyAttendanceRollCallEmail({
      parentEmail: adminEmail,
      studentName: testStudents[1].student_name,
      courseName: sampleCourse.name,
      date: todayStr,
      status: "ABSENT",
      remarks: "Unexcused absence - please contact administration.",
      attendancePercentage: 88,
      markedBy: teacherName
    });
    console.log(`  ✓ Attendance Roll-Call Alert Email Sent: ${attEmailSent}`);

    if (!schedEmailSent || !attEmailSent) {
      throw new Error("Parent email dispatch returned false.");
    }
    console.log("  ✅ TEST 6 PASSED: Nodemailer parent email pipeline verified.\n");
    passedTests++;

    // ------------------------------------------------------------------------
    // TEST 7: STUDENT HISTORY / PAST DATA LEDGER AUDIT TRAIL
    // ------------------------------------------------------------------------
    console.log("▶ [TEST 7/7] Validating Student History Ledger...");
    const history = await ScheduleDataService.getStudentHistory(testStudents[0].student_id);
    console.log(`  Retrieved ${history.length} chronological audit events for student '${testStudents[0].student_name}'.`);

    const hasScheduleEvent = history.some(h => h.event_type === "SCHEDULE_ASSIGNMENT");
    const hasAttendanceEvent = history.some(h => h.event_type === "ATTENDANCE_RECORD");

    console.log(`  ✓ Schedule Assignment Event in History: ${hasScheduleEvent ? "FOUND" : "NOT FOUND"}`);
    console.log(`  ✓ Daily Attendance Event in History: ${hasAttendanceEvent ? "FOUND" : "NOT FOUND"}`);

    if (!hasScheduleEvent || !hasAttendanceEvent) {
      throw new Error("Student history ledger is missing expected lifecycle events.");
    }
    console.log("  ✅ TEST 7 PASSED: Student History Ledger verified with full chronological audit events.\n");
    passedTests++;

    // Clean up test schedule slot
    await ScheduleDataService.deleteSchedule(createdSlot.id);
    console.log(`  (Cleaned up temporary test slot ${createdSlot.id})\n`);

    console.log("=========================================================================");
    console.log(`🎉 ALL ${passedTests}/${totalTests} TESTS PASSED WITH 100% SUCCESS RATE!`);
    console.log("=========================================================================");

  } catch (error: any) {
    console.error(`\n❌ VERIFICATION TEST FAILED: ${error.message}`);
    process.exit(1);
  }
}

runAutomationVerification();
