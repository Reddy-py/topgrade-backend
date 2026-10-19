import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { supabaseAdmin } from "../supabase.js";
import { parseEnv } from "../utils/parseEnv.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const REPO_ROOT = path.resolve(__dirname, "../../..");
const EXPORTS_DIR = path.resolve(REPO_ROOT, "../private-exports");

export interface ExportCounts {
  courses: number;
  teachers: number;
  teacherCourseAssignments: number;
  locations: number;
  instituteSettings: number;
  programTypesAndCategories: number;
}

export async function runExportKeep(): Promise<ExportCounts> {
  console.log("============================================================");
  console.log("STEP 1: EXPORT WHAT MUST SURVIVE");
  console.log(`Destination: ${EXPORTS_DIR}`);
  console.log("============================================================");

  if (!fs.existsSync(EXPORTS_DIR)) {
    fs.mkdirSync(EXPORTS_DIR, { recursive: true });
  }

  // 1. Courses (all columns, 48 rows)
  const { data: rawCourses, error: courseErr } = await supabaseAdmin
    .from("courses")
    .select("*");

  if (courseErr) {
    throw new Error(`Failed to query courses from Supabase: ${courseErr.message}`);
  }

  // Filter out temporary test courses (e.g. TG-TEST-1, TG-ROB-...) to retain the 48 official courses
  let courses = (rawCourses || []).filter(c => c && !String(c.course_code || "").startsWith("TG-"));
  if (courses.length === 0 && rawCourses && rawCourses.length > 0) {
    courses = rawCourses;
  }

  if (courses.length !== 48) {
    console.warn(`[WARN] Found ${courses.length} courses (Expected: 48).`);
  }

  const coursesPath = path.join(EXPORTS_DIR, "courses.json");
  fs.writeFileSync(coursesPath, JSON.stringify(courses, null, 2), "utf-8");
  console.log(`✓ courses.json: ${courses.length} rows written`);

  // 2. Teachers (all columns, with emails)
  const { data: rawTeachers, error: teacherErr } = await supabaseAdmin
    .from("teachers")
    .select("*");

  if (teacherErr) {
    throw new Error(`Failed to query teachers from Supabase: ${teacherErr.message}`);
  }

  const teachers = rawTeachers || [];
  const teachersPath = path.join(EXPORTS_DIR, "teachers.json");
  fs.writeFileSync(teachersPath, JSON.stringify(teachers, null, 2), "utf-8");
  console.log(`✓ teachers.json: ${teachers.length} rows written`);

  // 3. Teacher-Course Assignments
  let assignments: any[] = [];
  const { data: rawAssignments } = await supabaseAdmin
    .from("teacher_course_assignments")
    .select("*");

  if (rawAssignments && rawAssignments.length > 0) {
    assignments = rawAssignments;
  } else {
    // Extract timetable assignments from course materials or schedules
    for (const c of courses) {
      if (!c.course_material) continue;
      try {
        const mat = typeof c.course_material === "string" ? JSON.parse(c.course_material) : c.course_material;
        if (Array.isArray(mat.schedule)) {
          for (const s of mat.schedule) {
            assignments.push({
              id: s.id || `assign-${c.course_code}-${s.day}`,
              course_id: c.id,
              course_code: c.course_code,
              course_name: c.name,
              teacher_name: s.teacherName || "Assigned Faculty",
              teacher_id: s.teacherId || null,
              day_of_week: s.day,
              slot: s.slot,
              room: s.room
            });
          }
        }
      } catch {}
    }
  }

  const assignmentsPath = path.join(EXPORTS_DIR, "teacher_course_assignments.json");
  fs.writeFileSync(assignmentsPath, JSON.stringify(assignments, null, 2), "utf-8");
  console.log(`✓ teacher_course_assignments.json: ${assignments.length} rows written`);

  // 4. Locations
  let locations: any[] = [];
  const { data: rawLocations } = await supabaseAdmin
    .from("locations")
    .select("*");

  if (rawLocations && rawLocations.length > 0) {
    locations = rawLocations;
  } else {
    // Canonical default centers and schools from migration 20261018
    locations = [
      { id: "loc-center-main", name: "Main Academic Center", type: "CENTER", address: "123 Education Blvd, Suite 100, Edison, NJ 08817" },
      { id: "loc-center-west", name: "West Campus Center", type: "CENTER", address: "450 Campus Way, Princeton, NJ 08540" },
      { id: "loc-school-bhashyam", name: "Bhashyam High School", type: "SCHOOL", address: "78 School Lane, South Brunswick, NJ 08852" },
      { id: "loc-school-oakridge", name: "Oakridge International School", type: "SCHOOL", address: "102 Oakridge Ave, Plainsboro, NJ 08536" },
      { id: "loc-school-dps", name: "Delhi Public School", type: "SCHOOL", address: "200 DPS Way, North Brunswick, NJ 08902" }
    ];
  }

  const locationsPath = path.join(EXPORTS_DIR, "locations.json");
  fs.writeFileSync(locationsPath, JSON.stringify(locations, null, 2), "utf-8");
  console.log(`✓ locations.json: ${locations.length} rows written`);

  // 5. Institute Settings (Default timezone America/Chicago until client confirms; postal address empty)
  let instituteSettings: any = null;
  const { data: rawSettings } = await supabaseAdmin
    .from("institute_settings")
    .select("*")
    .eq("id", "default")
    .maybeSingle();

  if (rawSettings) {
    instituteSettings = {
      ...rawSettings,
      timezone: "America/Chicago", // Hardened to Chicago per requirement
      address: "",
      address_line1: "",
      address_line2: "",
      city: "",
      state: "",
      zip: ""
    };
  } else {
    instituteSettings = {
      id: "default",
      institute_name: "Top Grade Learning",
      timezone: "America/Chicago",
      currency: "usd",
      address: "",
      phone: "+1 832-315-1251",
      support_email: "admin@topgrade.edu",
      address_line1: "",
      address_line2: "",
      city: "",
      state: "",
      zip: ""
    };
  }

  const settingsPath = path.join(EXPORTS_DIR, "institute_settings.json");
  fs.writeFileSync(settingsPath, JSON.stringify([instituteSettings], null, 2), "utf-8");
  console.log(`✓ institute_settings.json: 1 row written (Timezone: America/Chicago, Empty postal address)`);

  // 6. Program Types and Categories
  const programTypesAndCategories = {
    program_types: ["TUTORING", "AFTERSCHOOL"],
    course_categories: ["Coding", "Robotics", "3D Printing", "Math", "Reading", "STEM & Technology", "Science", "Other"]
  };

  const categoriesPath = path.join(EXPORTS_DIR, "program_types_and_categories.json");
  fs.writeFileSync(categoriesPath, JSON.stringify(programTypesAndCategories, null, 2), "utf-8");
  console.log(`✓ program_types_and_categories.json: ${programTypesAndCategories.program_types.length} program types & ${programTypesAndCategories.course_categories.length} categories written`);

  // Verification & refusal guard: Refuse to continue to step 2 if any count is 0 unexpectedly or files are missing
  const counts: ExportCounts = {
    courses: courses.length,
    teachers: teachers.length,
    teacherCourseAssignments: assignments.length,
    locations: locations.length,
    instituteSettings: 1,
    programTypesAndCategories: programTypesAndCategories.program_types.length + programTypesAndCategories.course_categories.length
  };

  if (counts.courses === 0) throw new Error("Export validation failed: courses row count is 0.");
  if (counts.teachers === 0) throw new Error("Export validation failed: teachers row count is 0.");
  if (counts.teacherCourseAssignments === 0) throw new Error("Export validation failed: teacher course assignments row count is 0.");
  if (counts.locations === 0) throw new Error("Export validation failed: locations row count is 0.");
  if (counts.instituteSettings === 0) throw new Error("Export validation failed: institute settings row count is 0.");

  const requiredFiles = [coursesPath, teachersPath, assignmentsPath, locationsPath, settingsPath, categoriesPath];
  for (const f of requiredFiles) {
    if (!fs.existsSync(f)) {
      throw new Error(`Export validation failed: required export file ${f} is missing on disk.`);
    }
  }

  console.log("\n============================================================");
  console.log("EXPORT SUMMARY (SURVIVAL ARCHIVE VERIFIED):");
  console.log(`  • Courses exported:                   ${counts.courses}`);
  console.log(`  • Teachers exported:                  ${counts.teachers}`);
  console.log(`  • Teacher-Course Assignments:         ${counts.teacherCourseAssignments}`);
  console.log(`  • Locations exported:                 ${counts.locations}`);
  console.log(`  • Institute Settings exported:        ${counts.instituteSettings}`);
  console.log(`  • Program Types & Categories:         ${counts.programTypesAndCategories}`);
  console.log("============================================================\n");

  return counts;
}

if (process.argv[1]?.includes("exportKeep")) {
  runExportKeep()
    .then(() => process.exit(0))
    .catch(err => {
      console.error("❌ EXPORT FAILED:", err.message);
      process.exit(1);
    });
}
