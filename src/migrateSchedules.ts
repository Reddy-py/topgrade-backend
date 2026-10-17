import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { supabaseAdmin } from "./supabase.js";
import pg from "pg";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const DATA_DIR = path.resolve(__dirname, "../data");

const SCHEDULES_FILE = path.join(DATA_DIR, "schedules_db.json");
const TEACHER_AVAILABILITY_FILE = path.join(DATA_DIR, "teacher_availability_db.json");
const STUDENT_HISTORY_FILE = path.join(DATA_DIR, "student_history_db.json");

interface MigrationStats {
  slotsFound: number;
  studentsFound: number;
  historyFound: number;
  availabilityFound: number;
  dbCounts: {
    schedules: number;
    scheduleStudents: number;
    studentHistory: number;
    teacherAvailability: number;
  };
  errors: string[];
}

export async function runMigration(): Promise<MigrationStats> {
  const directPgUrl = process.env.DATABASE_URL;
  const isDirectPg = Boolean(directPgUrl && directPgUrl.trim() !== "");

  console.log("============================================================");
  console.log("MIGRATE SCHEDULES & SINGLE STORE ENGINE");
  console.log(`Mode: ${isDirectPg ? "Direct PostgreSQL (PostgREST-free path)" : "Supabase PostgREST API"}`);
  if (isDirectPg) {
    console.log(`Connection: ${directPgUrl?.split("@")[1] || "Local Database"}`);
  }
  console.log("============================================================");

  const errors: string[] = [];
  let pgPool: pg.Pool | null = null;

  if (isDirectPg) {
    pgPool = new pg.Pool({ connectionString: directPgUrl });
  }

  const slotsToInsert: any[] = [];
  const scheduleStudentsToInsert: any[] = [];
  const historyToInsert: any[] = [];
  const availabilityToInsert: any[] = [];

  const processedSlotIds = new Set<string>();

  // 1. Source 1: Schedules JSON (if present)
  if (fs.existsSync(SCHEDULES_FILE)) {
    try {
      const fileContent = fs.readFileSync(SCHEDULES_FILE, "utf-8");
      const slots: any[] = JSON.parse(fileContent);
      for (const slot of slots) {
        if (!slot || !slot.id) continue;
        processedSlotIds.add(slot.id);
        slotsToInsert.push({
          id: String(slot.id),
          course_id: String(slot.course_id || ""),
          course_name: String(slot.course_name || ""),
          teacher_id: slot.teacher_id ? String(slot.teacher_id) : null,
          teacher_name: slot.teacher_name ? String(slot.teacher_name) : null,
          day_of_week: String(slot.day_of_week || "Monday"),
          start_time: String(slot.start_time || "10:00 AM"),
          end_time: String(slot.end_time || "11:30 AM"),
          time_slot: String(slot.time_slot || `${slot.start_time || "10:00 AM"} - ${slot.end_time || "11:30 AM"}`),
          room: String(slot.room || "Room 101"),
          location: String(slot.location || "Main Academic Center"),
          max_capacity: Number(slot.max_capacity) || 15,
          is_active: slot.is_active !== false,
          open_for_teachers: slot.open_for_teachers === true,
          program: slot.program ? String(slot.program) : null,
          created_at: slot.created_at || new Date().toISOString(),
          updated_at: slot.updated_at || new Date().toISOString()
        });

        if (Array.isArray(slot.students)) {
          for (const st of slot.students) {
            if (!st.student_id) continue;
            scheduleStudentsToInsert.push({
              id: `ss-${slot.id}-${st.student_id}`,
              schedule_id: String(slot.id),
              student_id: String(st.student_id),
              student_name: String(st.student_name || "Student"),
              student_code: st.student_code ? String(st.student_code) : null,
              created_at: st.created_at || new Date().toISOString()
            });
          }
        }
      }
      console.log(`[Source] Loaded ${slotsToInsert.length} slots from ${SCHEDULES_FILE}`);
    } catch (err: any) {
      errors.push(`Failed to parse ${SCHEDULES_FILE}: ${err.message}`);
    }
  }

  // 2. Source 2: Course Timetable slots in database (courses.course_material.schedule)
  try {
    let coursesList: any[] = [];
    if (isDirectPg && pgPool) {
      const res = await pgPool.query("SELECT id, name, course_material FROM public.courses WHERE status = 'Active' OR status IS NULL;");
      coursesList = res.rows;
    } else {
      const { data, error } = await supabaseAdmin
        .from("courses")
        .select("id, name, course_material");
      if (error) {
        throw new Error(`Failed to query courses: ${error.message} (code: ${error.code})`);
      }
      coursesList = data || [];
    }

    console.log(`[Source] Checked ${coursesList.length} courses in database for course_material schedules.`);
    for (const crs of coursesList) {
      let meta: any = {};
      if (crs.course_material) {
        try {
          meta = typeof crs.course_material === "string" ? JSON.parse(crs.course_material) : crs.course_material;
        } catch {
          meta = {};
        }
      }

      const scheduleArr: any[] = Array.isArray(meta?.schedule) ? meta.schedule : [];
      const assignedTeachers: any[] = Array.isArray(meta?.assigned_teachers) ? meta.assigned_teachers : [];
      const defaultTeacherName = assignedTeachers[0]?.name || "Staff Faculty";
      const defaultTeacherId = assignedTeachers[0]?.teacherId || null;

      for (const cSlot of scheduleArr) {
        if (!cSlot || !cSlot.day) continue;
        const slotId = cSlot.id || `sch-course-${crs.id}-${cSlot.day}-${cSlot.startTime || cSlot.slot || "slot"}`;

        if (processedSlotIds.has(slotId)) continue;
        processedSlotIds.add(slotId);

        const timeSlotStr = cSlot.slot || (cSlot.startTime && cSlot.endTime ? `${cSlot.startTime} - ${cSlot.endTime}` : "09:00 AM - 10:30 AM");
        const startTimeStr = cSlot.startTime || (timeSlotStr.split("-")[0] || "09:00 AM").trim();
        const endTimeStr = cSlot.endTime || (timeSlotStr.split("-")[1] || "10:30 AM").trim();

        slotsToInsert.push({
          id: slotId,
          course_id: String(crs.id),
          course_name: String(crs.name || ""),
          teacher_id: cSlot.openForTeachers === true ? null : (cSlot.teacherId ? String(cSlot.teacherId) : defaultTeacherId),
          teacher_name: cSlot.openForTeachers === true ? null : (cSlot.teacherName ? String(cSlot.teacherName) : defaultTeacherName),
          day_of_week: String(cSlot.day),
          start_time: startTimeStr,
          end_time: endTimeStr,
          time_slot: timeSlotStr,
          room: String(cSlot.room || "Room 101"),
          location: "Main Academic Center",
          max_capacity: 15,
          is_active: true,
          open_for_teachers: cSlot.openForTeachers === true,
          program: String(crs.name || ""),
          created_at: new Date().toISOString(),
          updated_at: new Date().toISOString()
        });
      }
    }
  } catch (err: any) {
    errors.push(`Error scanning courses timetable: ${err.message}`);
  }

  // 3. Source 3: Student History JSON (if present)
  if (fs.existsSync(STUDENT_HISTORY_FILE)) {
    try {
      const histContent = fs.readFileSync(STUDENT_HISTORY_FILE, "utf-8");
      const historyList: any[] = JSON.parse(histContent);
      for (const h of historyList) {
        if (!h.student_id) continue;
        historyToInsert.push({
          id: h.id ? String(h.id) : `hist-${Date.now()}-${Math.random().toString(36).substring(2, 9)}`,
          student_id: String(h.student_id),
          student_name: h.student_name ? String(h.student_name) : null,
          event_type: String(h.event_type || "SCHEDULE_ASSIGNMENT"),
          title: String(h.title || "Academic Event"),
          description: h.description ? String(h.description) : null,
          metadata: h.metadata || {},
          actor: h.actor ? String(h.actor) : "Academic Registrar",
          created_at: h.created_at || new Date().toISOString()
        });
      }
    } catch (err: any) {
      errors.push(`Failed to parse ${STUDENT_HISTORY_FILE}: ${err.message}`);
    }
  }

  // 4. Source 4: Teacher Availability JSON (if present)
  if (fs.existsSync(TEACHER_AVAILABILITY_FILE)) {
    try {
      const availContent = fs.readFileSync(TEACHER_AVAILABILITY_FILE, "utf-8");
      const availList: any = JSON.parse(availContent);
      const items: any[] = Array.isArray(availList) ? availList : [];
      for (const a of items) {
        if (!a.teacher_id || !a.day_of_week) continue;
        availabilityToInsert.push({
          id: a.id ? String(a.id) : `avail-${Date.now()}-${Math.random().toString(36).substring(2, 9)}`,
          teacher_id: String(a.teacher_id),
          day_of_week: String(a.day_of_week),
          available_from: String(a.available_from || "09:00"),
          available_to: String(a.available_to || "19:00"),
          is_active: a.is_active !== false,
          created_at: a.created_at || new Date().toISOString()
        });
      }
    } catch (err: any) {
      errors.push(`Failed to parse ${TEACHER_AVAILABILITY_FILE}: ${err.message}`);
    }
  }

  console.log(`[Summary] Total Source Records Discovered:`);
  console.log(`  - Schedules:            ${slotsToInsert.length}`);
  console.log(`  - Schedule Students:    ${scheduleStudentsToInsert.length}`);
  console.log(`  - Student History:      ${historyToInsert.length}`);
  console.log(`  - Teacher Availability: ${availabilityToInsert.length}`);

  // --------------------------------------------------------------------------
  // INSERTS / UPSERTS (Never swallow errors!)
  // --------------------------------------------------------------------------
  if (isDirectPg && pgPool) {
    const client = await pgPool.connect();
    try {
      await client.query("BEGIN;");

      // Insert Schedules
      for (const s of slotsToInsert) {
        await client.query(`
          INSERT INTO public.schedules (
            id, course_id, course_name, teacher_id, teacher_name, day_of_week,
            start_time, end_time, time_slot, room, location, max_capacity,
            is_active, open_for_teachers, program, created_at, updated_at
          ) VALUES (
            $1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17
          ) ON CONFLICT (id) DO UPDATE SET
            course_id = EXCLUDED.course_id,
            course_name = EXCLUDED.course_name,
            teacher_id = EXCLUDED.teacher_id,
            teacher_name = EXCLUDED.teacher_name,
            updated_at = NOW();
        `, [
          s.id, s.course_id, s.course_name, s.teacher_id, s.teacher_name, s.day_of_week,
          s.start_time, s.end_time, s.time_slot, s.room, s.location, s.max_capacity,
          s.is_active, s.open_for_teachers, s.program, s.created_at, s.updated_at
        ]);
      }

      // Insert Schedule Students
      for (const ss of scheduleStudentsToInsert) {
        await client.query(`
          INSERT INTO public.schedule_students (id, schedule_id, student_id, student_name, student_code, created_at)
          VALUES ($1, $2, $3, $4, $5, $6)
          ON CONFLICT (schedule_id, student_id) DO UPDATE SET
            student_name = EXCLUDED.student_name,
            student_code = EXCLUDED.student_code;
        `, [ss.id, ss.schedule_id, ss.student_id, ss.student_name, ss.student_code, ss.created_at]);
      }

      // Insert Student History
      for (const h of historyToInsert) {
        await client.query(`
          INSERT INTO public.student_history (id, student_id, student_name, event_type, title, description, metadata, actor, created_at)
          VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
          ON CONFLICT (id) DO NOTHING;
        `, [h.id, h.student_id, h.student_name, h.event_type, h.title, h.description, JSON.stringify(h.metadata), h.actor, h.created_at]);
      }

      // Insert Teacher Availability
      for (const a of availabilityToInsert) {
        await client.query(`
          INSERT INTO public.teacher_availability (id, teacher_id, day_of_week, available_from, available_to, is_active, created_at)
          VALUES ($1, $2, $3, $4, $5, $6, $7)
          ON CONFLICT (id) DO NOTHING;
        `, [a.id, a.teacher_id, a.day_of_week, a.available_from, a.available_to, a.is_active, a.created_at]);
      }

      await client.query("COMMIT;");
      console.log(`[Success] Inserted/Upserted records via Direct PostgreSQL transaction.`);
    } catch (insertErr: any) {
      await client.query("ROLLBACK;");
      errors.push(`Direct SQL Insert Error: ${insertErr.message}`);
      console.error(`[CRITICAL ERROR] Insert transaction failed:`, insertErr.message);
    } finally {
      client.release();
    }
  } else {
    // PostgREST upserts (Strict error propagation)
    for (const s of slotsToInsert) {
      const { error } = await supabaseAdmin.from("schedules").upsert(s, { onConflict: "id" });
      if (error) {
        const msg = `Schedules upsert error for '${s.id}': ${error.message} (code: ${error.code})`;
        console.error(`[Error] ${msg}`);
        errors.push(msg);
      }
    }

    for (const ss of scheduleStudentsToInsert) {
      const { error } = await supabaseAdmin.from("schedule_students").upsert(ss, { onConflict: "schedule_id,student_id" });
      if (error) {
        const msg = `ScheduleStudents upsert error: ${error.message} (code: ${error.code})`;
        console.error(`[Error] ${msg}`);
        errors.push(msg);
      }
    }

    for (const h of historyToInsert) {
      const { error } = await supabaseAdmin.from("student_history").upsert(h, { onConflict: "id" });
      if (error) {
        const msg = `StudentHistory upsert error for '${h.id}': ${error.message} (code: ${error.code})`;
        console.error(`[Error] ${msg}`);
        errors.push(msg);
      }
    }

    for (const a of availabilityToInsert) {
      const { error } = await supabaseAdmin.from("teacher_availability").upsert(a, { onConflict: "id" });
      if (error) {
        const msg = `TeacherAvailability upsert error for '${a.id}': ${error.message} (code: ${error.code})`;
        console.error(`[Error] ${msg}`);
        errors.push(msg);
      }
    }
  }

  // --------------------------------------------------------------------------
  // REAL COUNTS FROM DATABASE (SELECT count(*))
  // --------------------------------------------------------------------------
  let dbSchedulesCount = 0;
  let dbStudentsCount = 0;
  let dbHistoryCount = 0;
  let dbAvailabilityCount = 0;

  try {
    if (isDirectPg && pgPool) {
      const r1 = await pgPool.query("SELECT count(*)::int AS cnt FROM public.schedules;");
      dbSchedulesCount = r1.rows[0].cnt;
      const r2 = await pgPool.query("SELECT count(*)::int AS cnt FROM public.schedule_students;");
      dbStudentsCount = r2.rows[0].cnt;
      const r3 = await pgPool.query("SELECT count(*)::int AS cnt FROM public.student_history;");
      dbHistoryCount = r3.rows[0].cnt;
      const r4 = await pgPool.query("SELECT count(*)::int AS cnt FROM public.teacher_availability;");
      dbAvailabilityCount = r4.rows[0].cnt;
    } else {
      const { count: c1, error: e1 } = await supabaseAdmin.from("schedules").select("*", { count: "exact", head: true });
      if (e1) throw new Error(`SELECT count(*) on schedules failed: ${e1.message}`);
      dbSchedulesCount = c1 || 0;

      const { count: c2, error: e2 } = await supabaseAdmin.from("schedule_students").select("*", { count: "exact", head: true });
      if (e2) throw new Error(`SELECT count(*) on schedule_students failed: ${e2.message}`);
      dbStudentsCount = c2 || 0;

      const { count: c3, error: e3 } = await supabaseAdmin.from("student_history").select("*", { count: "exact", head: true });
      if (e3) throw new Error(`SELECT count(*) on student_history failed: ${e3.message}`);
      dbHistoryCount = c3 || 0;

      const { count: c4, error: e4 } = await supabaseAdmin.from("teacher_availability").select("*", { count: "exact", head: true });
      if (e4) throw new Error(`SELECT count(*) on teacher_availability failed: ${e4.message}`);
      dbAvailabilityCount = c4 || 0;
    }
  } catch (countErr: any) {
    errors.push(`Database count read failed: ${countErr.message}`);
    console.error(`[CRITICAL ERROR] Failed to read real database counts:`, countErr.message);
  } finally {
    if (pgPool) {
      await pgPool.end();
    }
  }

  // --------------------------------------------------------------------------
  // VERIFICATION & REPORTING
  // --------------------------------------------------------------------------
  console.log("\n============================================================");
  console.log("DATABASE VERIFICATION (REAL SELECT count(*) FROM POSTGRES)");
  console.log("============================================================");
  console.log(`Table                 | Source Items | Real DB Count | Status`);
  console.log(`----------------------+--------------+---------------+--------`);
  const sMatch = dbSchedulesCount >= slotsToInsert.length;
  console.log(`schedules             | ${slotsToInsert.length.toString().padStart(12)} | ${dbSchedulesCount.toString().padStart(13)} | ${sMatch ? "PASS ✓" : "MISMATCH ✗"}`);
  
  const ssMatch = dbStudentsCount >= scheduleStudentsToInsert.length;
  console.log(`schedule_students     | ${scheduleStudentsToInsert.length.toString().padStart(12)} | ${dbStudentsCount.toString().padStart(13)} | ${ssMatch ? "PASS ✓" : "MISMATCH ✗"}`);
  
  const hMatch = dbHistoryCount >= historyToInsert.length;
  console.log(`student_history       | ${historyToInsert.length.toString().padStart(12)} | ${dbHistoryCount.toString().padStart(13)} | ${hMatch ? "PASS ✓" : "MISMATCH ✗"}`);
  
  const aMatch = dbAvailabilityCount >= availabilityToInsert.length;
  console.log(`teacher_availability  | ${availabilityToInsert.length.toString().padStart(12)} | ${dbAvailabilityCount.toString().padStart(13)} | ${aMatch ? "PASS ✓" : "MISMATCH ✗"}`);
  console.log("============================================================\n");

  if (errors.length > 0) {
    console.error(`\n[FATAL] Migration encountered ${errors.length} error(s):`);
    for (const err of errors) {
      console.error(`  - ${err}`);
    }
  }

  return {
    slotsFound: slotsToInsert.length,
    studentsFound: scheduleStudentsToInsert.length,
    historyFound: historyToInsert.length,
    availabilityFound: availabilityToInsert.length,
    dbCounts: {
      schedules: dbSchedulesCount,
      scheduleStudents: dbStudentsCount,
      studentHistory: dbHistoryCount,
      teacherAvailability: dbAvailabilityCount
    },
    errors
  };
}

// Execute directly from CLI
if (process.argv[1] && process.argv[1].includes("migrateSchedules")) {
  runMigration()
    .then((stats) => {
      if (stats.errors.length > 0) {
        console.error("Migration finished with errors. Exiting with non-zero exit code (1).");
        process.exit(1);
      }
      if (
        stats.dbCounts.schedules < stats.slotsFound ||
        stats.dbCounts.scheduleStudents < stats.studentsFound ||
        stats.dbCounts.studentHistory < stats.historyFound ||
        stats.dbCounts.teacherAvailability < stats.availabilityFound
      ) {
        console.error("Source and database counts differ! Exiting with non-zero exit code (1).");
        process.exit(1);
      }
      console.log("Migration completed successfully with 100% verified counts.");
      process.exit(0);
    })
    .catch((err) => {
      console.error("Unhandled migration failure:", err);
      process.exit(1);
    });
}
