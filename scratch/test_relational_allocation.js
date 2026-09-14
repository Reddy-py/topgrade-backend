// Native global fetch in Node.js 18+

const API_BASE = "http://localhost:5000";

async function runTests() {
  console.log("=== 1. TEST GET COURSES ===");
  const coursesRes = await fetch(`${API_BASE}/api/courses/list`);
  const coursesData = await coursesRes.json();
  console.log(`Status: ${coursesRes.status}, Count: ${coursesData.data?.length}`);
  if (!coursesData.data || coursesData.data.length === 0) {
    throw new Error("No courses returned");
  }

  const sampleCourse = coursesData.data[0];
  console.log(`Sample Course: ${sampleCourse.name} (${sampleCourse.id})`);

  console.log("\n=== 2. TEST GET SCHEDULES LIST ===");
  const schedRes = await fetch(`${API_BASE}/api/schedules/list`);
  const schedData = await schedRes.json();
  console.log(`Status: ${schedRes.status}, Total Schedule Slots: ${schedData.data?.length}`);

  let testSlot = schedData.data?.[0];
  if (!testSlot) {
    console.log("Creating a test schedule slot...");
    const createSlotRes = await fetch(`${API_BASE}/api/schedules/create`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        course_id: sampleCourse.id,
        course_name: sampleCourse.name,
        teacher_id: "tchr-abel-1",
        teacher_name: "Abel Dominguez",
        day_of_week: "Monday",
        start_time: "10:00 AM",
        end_time: "11:30 AM",
        room: "Room 101",
        max_capacity: 15
      })
    });
    const createdJson = await createSlotRes.json();
    console.log("Create slot result:", createdJson.message || createdJson.error);
    testSlot = createdJson.data;
  }

  console.log(`Using Schedule Slot: ID=${testSlot.id}, Course='${testSlot.course_name}', Teacher='${testSlot.teacher_name}', Slot='${testSlot.day_of_week} ${testSlot.time_slot}'`);

  console.log("\n=== 3. TEST ASSIGN STUDENT TO SCHEDULE SLOT ===");
  const testStudentId = `test-stu-${Date.now()}`;
  const testStudentName = "Alexander Hamilton";
  const assignRes = await fetch(`${API_BASE}/api/schedules/assign-student`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      schedule_id: testSlot.id,
      student_id: testStudentId,
      student_name: testStudentName,
      student_code: "TG-STU-TEST-99",
      parent_email: "parent.hamilton@example.com"
    })
  });
  const assignJson = await assignRes.json();
  console.log(`Assign Status: ${assignRes.status}`);
  console.log("Assign Message:", assignJson.message);
  console.log(`Students in slot now: ${assignJson.data?.students?.length}`);

  const isStudentPresent = assignJson.data?.students?.some(s => s.student_id === testStudentId);
  console.log("Is student in schedule slot roster?", isStudentPresent);

  console.log("\n=== 4. TEST TEACHER ROSTER RETRIEVAL ===");
  const rosterRes = await fetch(`${API_BASE}/api/schedules/teacher/${encodeURIComponent(testSlot.teacher_name)}/roster`);
  const rosterJson = await rosterRes.json();
  console.log(`Teacher Roster Slot Count: ${rosterJson.data?.length}`);
  const slotInRoster = rosterJson.data?.find(s => s.schedule_id === testSlot.id);
  const studentInTeacherRoster = slotInRoster?.students?.some(s => s.student_id === testStudentId);
  console.log(`Student in Teacher (${testSlot.teacher_name}) Roster?`, studentInTeacherRoster);

  console.log("\n=== 5. TEST GET COURSES FILTERED BY TEACHER ===");
  const teacherFilterRes = await fetch(`${API_BASE}/api/courses/list?teacherName=${encodeURIComponent(testSlot.teacher_name)}`);
  const teacherFilterJson = await teacherFilterRes.json();
  console.log(`Courses for teacher '${testSlot.teacher_name}':`, teacherFilterJson.data?.map(c => c.name));

  const unassignedTeacherRes = await fetch(`${API_BASE}/api/courses/list?teacherName=NonExistentTeacherXYZ`);
  const unassignedTeacherJson = await unassignedTeacherRes.json();
  console.log(`Courses for unassigned teacher (should be 0):`, unassignedTeacherJson.data?.length);

  if (isStudentPresent && studentInTeacherRoster && unassignedTeacherJson.data?.length === 0) {
    console.log("\n>>> ALL RELATIONAL INTEGRATION TESTS PASSED! <<<");
  } else {
    console.warn("\n>>> SOME CHECKS FAILED <<<");
  }
}

runTests().catch(err => {
  console.error("Test error:", err);
});
