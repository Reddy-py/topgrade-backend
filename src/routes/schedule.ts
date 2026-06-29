import { Router } from "express";
import { supabaseAdmin } from "../index.js";

const router = Router();

// Endpoint to allocate a new class with active conflict checks
router.post("/allocate", async (req, res): Promise<any> => {
  const { 
    student_id, 
    course_id, 
    teacher_id, 
    branch, 
    classroom, 
    day_of_week, 
    time_slot, 
    duration_minutes, 
    start_date, 
    end_date 
  } = req.body;

  try {
    // 1. Conflict Check: Is the Teacher already booked at this exact time and day?
    const { data: teacherConflict } = await supabaseAdmin
      .from("schedules")
      .select("id")
      .eq("teacher_id", teacher_id)
      .eq("day_of_week", day_of_week)
      .eq("time_slot", time_slot)
      .limit(1);

    if (teacherConflict && teacherConflict.length > 0) {
      return res.status(400).json({ 
        success: false, 
        error: "Scheduling Conflict: The assigned Teacher is already booked for another course session during this slot." 
      });
    }

    // 2. Conflict Check: Is the physical Classroom already occupied at this branch?
    const { data: roomConflict } = await supabaseAdmin
      .from("schedules")
      .select("id")
      .eq("branch", branch)
      .eq("classroom", classroom)
      .eq("day_of_week", day_of_week)
      .eq("time_slot", time_slot)
      .limit(1);

    if (roomConflict && roomConflict.length > 0) {
      return res.status(400).json({ 
        success: false, 
        error: "Scheduling Conflict: The designated classroom space is already occupied by another class session." 
      });
    }

    // 3. Conflict Check: Is the Student already busy elsewhere?
    const { data: studentConflict } = await supabaseAdmin
      .from("schedules")
      .select("id")
      .eq("student_id", student_id)
      .eq("day_of_week", day_of_week)
      .eq("time_slot", time_slot)
      .limit(1);

    if (studentConflict && studentConflict.length > 0) {
      return res.status(400).json({ 
        success: false, 
        error: "Scheduling Conflict: This student is already assigned to a different course schedule during this time." 
      });
    }

    // Clear verification check -> Insert structural event allocation row
    const { data: newSchedule, error: insertError } = await supabaseAdmin
      .from("schedules")
      .insert([
        { student_id, course_id, teacher_id, branch, classroom, day_of_week, time_slot, duration_minutes, start_date, end_date }
      ])
      .select();

    if (insertError) throw insertError;

    res.status(201).json({ success: true, data: newSchedule[0] });

  } catch (error: any) {
    res.status(500).json({ success: false, error: error.message });
  }
});

export default router;