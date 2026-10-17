import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { supabaseAdmin } from "./supabase.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const DATA_DIR = path.resolve(__dirname, "../data");

async function checkSources() {
  console.log("============================================================");
  console.log("EXAMINING SOURCE DATA FOR SCHEDULES MIGRATION");
  console.log("============================================================");

  // 1. schedules_db.json
  const schedulesFile = path.join(DATA_DIR, "schedules_db.json");
  let schedulesJson: any[] = [];
  let studentsInJson = 0;
  if (fs.existsSync(schedulesFile)) {
    schedulesJson = JSON.parse(fs.readFileSync(schedulesFile, "utf-8"));
    for (const s of schedulesJson) {
      if (Array.isArray(s.students)) studentsInJson += s.students.length;
    }
  }

  // 2. courses table course_material.schedule
  const { data: courses } = await supabaseAdmin.from("courses").select("id, name, course_material");
  let courseSlots = 0;
  const courseSlotIds = new Set<string>();
  if (courses) {
    for (const c of courses) {
      const schedule = c.course_material?.schedule;
      if (Array.isArray(schedule)) {
        for (const slot of schedule) {
          if (slot.id) {
            courseSlots++;
            courseSlotIds.add(slot.id);
          }
        }
      }
    }
  }

  // 3. student_history_db.json
  const historyFile = path.join(DATA_DIR, "student_history_db.json");
  let historyJson: any[] = [];
  if (fs.existsSync(historyFile)) {
    historyJson = JSON.parse(fs.readFileSync(historyFile, "utf-8"));
  }

  // 4. teacher_availability_db.json
  const availFile = path.join(DATA_DIR, "teacher_availability_db.json");
  let availJson: any = {};
  let availCount = 0;
  if (fs.existsSync(availFile)) {
    try {
      availJson = JSON.parse(fs.readFileSync(availFile, "utf-8"));
      availCount = Array.isArray(availJson) ? availJson.length : Object.keys(availJson).length;
    } catch {}
  }

  // Deduplication between schedules_db.json and course slots
  const allUniqueSlotIds = new Set<string>();
  schedulesJson.forEach(s => s.id && allUniqueSlotIds.add(s.id));
  courseSlotIds.forEach(id => allUniqueSlotIds.add(id));

  console.log("Source Data Counts:");
  console.log(`  1. Slots in data/schedules_db.json:           ${schedulesJson.length}`);
  console.log(`  2. Enrolled students in schedules_db.json:    ${studentsInJson}`);
  console.log(`  3. Timetable slots in courses.course_material: ${courseSlots}`);
  console.log(`  4. Total Unique Combined Slots to Migrate:   ${allUniqueSlotIds.size}`);
  console.log(`  5. History records in student_history_db:     ${historyJson.length}`);
  console.log(`  6. Availability rows in teacher_availability:  ${availCount}`);
  console.log("============================================================");
}

checkSources().then(() => { process.exitCode = 0; });
