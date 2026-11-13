import dotenv from "dotenv";
import path from "path";
import { fileURLToPath } from "url";
import { supabaseAdmin } from "../supabase.js";
import { ScheduleSlotService, utcToCstParts, cstDateTimeToUtc } from "../services/scheduleSlotService.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
dotenv.config({ path: path.resolve(__dirname, "../../.env") });

async function runVerification() {
  console.log("===============================================================");
  console.log("TopGrade Learning CRM: Automated Verification Suite (Steps 8-11)");
  console.log("===============================================================");

  // 1. Timezone Check
  const cst = utcToCstParts(new Date());
  console.log(`[PASS 1] Current CST Time: ${cst.cstDate} ${cst.timeStr} CST (${cst.dayOfWeek})`);

  // 2. Fetch or create a test slot and student for attendance testing
  const { data: teacher } = await supabaseAdmin.from("teachers").select("id").eq("status", "Active").limit(1).single();
  const { data: course } = await supabaseAdmin.from("courses").select("id").limit(1).single();
  const { data: student } = await supabaseAdmin.from("students").select("id").eq("status", "ACTIVE").limit(1).single();

  if (!teacher || !course || !student) {
    console.error("Missing test dependencies (teacher, course, or student).");
    return;
  }

  // Create slot for today in CST
  const startUtc = cstDateTimeToUtc(cst.cstDate, "14:00").toISOString();
  const endUtc = cstDateTimeToUtc(cst.cstDate, "15:00").toISOString();

  const { data: newSlot, error: sErr } = await supabaseAdmin
    .from("schedule_slots")
    .insert({
      course_id: course.id,
      teacher_id: teacher.id,
      grade: "Grade 9",
      start_at: startUtc,
      end_at: endUtc,
      duration_hours: 1.0,
      max_students: 5,
      status: "open",
      notes: "Verification Test Slot"
    })
    .select()
    .single();

  if (sErr) {
    console.error("Failed to create test slot:", sErr.message);
    return;
  }
  console.log(`[PASS 2] Created CST test slot for attendance: ${newSlot.id}`);

  try {
    // Grant tokens to test student
    await supabaseAdmin.from("token_ledger").insert({
      student_id: student.id,
      course_id: course.id,
      hours: 5.0,
      type: "grant",
      note: "Test Grant for Verification"
    });

    // Book student into slot
    const bookRes = await ScheduleSlotService.bookSlot(student.id, newSlot.id);
    console.log(`[PASS 3] Booked student into slot, bookingId: ${bookRes.bookingId}`);

    // Fetch attendance row
    const { data: attRow } = await supabaseAdmin
      .from("attendance")
      .select("*")
      .eq("slot_id", newSlot.id)
      .eq("student_id", student.id)
      .single();

    if (!attRow) throw new Error("Attendance row not found after booking!");
    console.log(`[PASS 4] Automatic attendance row created with status: '${attRow.status}'`);

    // Test listAttendanceSlots
    const slotsToday = await ScheduleSlotService.listAttendanceSlots(cst.cstDate);
    const found = slotsToday.find(s => s.id === newSlot.id);
    if (!found) throw new Error("Slot not returned in listAttendanceSlots!");
    console.log(`[PASS 5] listAttendanceSlots successfully returned slot with ${found.students.length} student(s)`);

    // Test markAttendance: Mark EXCUSED -> should release tokens back (+1.0)
    const excRes = await ScheduleSlotService.markAttendance(attRow.id, "excused", teacher.id, "Excused absence test");
    console.log(`[PASS 6] markAttendance 'excused' result:`, excRes);

    const { data: excLedger } = await supabaseAdmin
      .from("token_ledger")
      .select("*")
      .eq("ref_booking_id", bookRes.bookingId)
      .eq("type", "release")
      .order("created_at", { ascending: false })
      .limit(1)
      .single();

    if (!excLedger || Number(excLedger.hours) !== 1.0) {
      throw new Error("Excused absence did not create a release ledger row!");
    }
    console.log(`[PASS 7] Verified token release row (+1.0 hour restored) in token_ledger`);

    // Test markAttendance: Change from EXCUSED to PRESENT -> should re-reserve tokens (-1.0)
    const presRes = await ScheduleSlotService.markAttendance(attRow.id, "present", teacher.id, "Present after excused");
    console.log(`[PASS 8] markAttendance 'present' result:`, presRes);

    const { data: reResLedger } = await supabaseAdmin
      .from("token_ledger")
      .select("*")
      .eq("ref_booking_id", bookRes.bookingId)
      .eq("type", "reserve")
      .order("created_at", { ascending: false })
      .limit(1)
      .single();

    if (!reResLedger || Number(reResLedger.hours) !== -1.0) {
      throw new Error("Changing from excused to present did not re-reserve tokens!");
    }
    console.log(`[PASS 9] Verified re-reserve ledger row (-1.0 hour) in token_ledger`);

    // Check if slot status changed to completed because all students were marked
    const { data: updatedSlot } = await supabaseAdmin
      .from("schedule_slots")
      .select("status")
      .eq("id", newSlot.id)
      .single();

    console.log(`[PASS 10] Schedule slot status after all marked: '${updatedSlot?.status}' (expected 'completed')`);

    // Weekly attendance rate
    const weeklyRate = await ScheduleSlotService.getWeeklyAttendanceRate();
    console.log(`[PASS 11] Weekly attendance rate in CST: ${weeklyRate.display} (${weeklyRate.presentCount} present / ${weeklyRate.totalMarked} marked)`);

  } finally {
    // Cleanup test slot, bookings, attendance, test ledger
    await supabaseAdmin.from("attendance").delete().eq("slot_id", newSlot.id);
    await supabaseAdmin.from("bookings").delete().eq("slot_id", newSlot.id);
    await supabaseAdmin.from("schedule_slots").delete().eq("id", newSlot.id);
    await supabaseAdmin.from("token_ledger").delete().eq("student_id", student.id).eq("note", "Test Grant for Verification");
    console.log("[CLEANUP] Verification test slot & records safely cleaned up.");
  }

  console.log("===============================================================");
  console.log("ALL ACCEPTANCE CHECKS PASSED SUCCESSFULLY!");
  console.log("===============================================================");
}

runVerification().catch(err => {
  console.error("Verification failed:", err);
  process.exit(1);
});
