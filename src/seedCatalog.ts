// ============================================================================
// SEED CATALOG SCRIPT (EMPTY DATABASE INITIALIZATION ONLY)
// Note: The Supabase PostgreSQL database holds 48 real courses.
// This utility is reserved ONLY as an optional bootstrapper for an empty database.
// It detects existing rows and immediately aborts if any courses already exist.
// ============================================================================
import { supabaseAdmin } from "./supabase.js";
import { OFFICIAL_COURSES } from "./constants/officialCatalog.js";

export async function seedCatalog() {
  console.log("Checking courses table in Supabase...");
  const { count, error } = await supabaseAdmin
    .from("courses")
    .select("*", { count: "exact", head: true });

  if (error) {
    console.error("Error querying courses table:", error.message);
    process.exit(1);
  }

  if (count !== null && count > 0) {
    console.log(`Courses table already contains ${count} courses.`);
    console.log("Seed catalog aborted: table is not empty.");
    return { seeded: false, count };
  }

  console.log(`Courses table is empty. Inserting ${OFFICIAL_COURSES.length} official courses...`);

  const rows = OFFICIAL_COURSES.map(c => ({
    course_code: c.course_code,
    name: c.name,
    description: c.description,
    required_teacher_skills: c.category,
    age_group: c.age_group,
    duration: c.duration,
    fee: c.fee,
    max_students: c.max_students,
    status: "Active",
    course_material: {}
  }));

  const { data, error: insertError } = await supabaseAdmin
    .from("courses")
    .insert(rows)
    .select("id, course_code, name");

  if (insertError) {
    console.error("Failed to insert courses:", insertError.message);
    process.exit(1);
  }

  console.log(`Successfully inserted ${data?.length || 0} official courses into courses table.`);
  return { seeded: true, count: data?.length || 0 };
}

if (process.argv[1] && process.argv[1].includes("seedCatalog")) {
  seedCatalog()
    .then(() => {
      process.exitCode = 0;
    })
    .catch(err => {
      console.error("Seed catalog failed:", err);
      process.exit(1);
    });
}
