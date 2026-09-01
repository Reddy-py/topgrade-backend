import dotenv from "dotenv";
import { createClient } from "@supabase/supabase-js";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

dotenv.config();

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const supabaseUrl = process.env.SUPABASE_URL || "https://zznzmzwiewsnmykcbcni.supabase.co";
const supabaseServiceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY || "";

const supabase = createClient(supabaseUrl, supabaseServiceRoleKey, {
  auth: { autoRefreshToken: false, persistSession: false }
});

async function syncAllToSupabase() {
  console.log("=== SYNCING LOCAL RECORDS TO SUPABASE ===");

  // 1. Sync Students from students_db.json
  const studentsFile = path.join(__dirname, "../data/students_db.json");
  if (fs.existsSync(studentsFile)) {
    const students = JSON.parse(fs.readFileSync(studentsFile, "utf-8"));
    console.log(`Found ${students.length} local students to sync.`);

    for (const s of students) {
      console.log(`Processing student: ${s.fullName} (${s.studentCode})...`);

      // 1a. Ensure Supabase Auth user exists
      let authUserId: string | null = null;
      if (s.email) {
        try {
          const { data: userCreated, error: authErr } = await supabase.auth.admin.createUser({
            email: s.email,
            password: s.password || "Student@123",
            email_confirm: true,
            user_metadata: {
              full_name: s.fullName,
              role: "STUDENT",
              student_code: s.studentCode
            }
          });

          if (userCreated?.user) {
            authUserId = userCreated.user.id;
            console.log(`  -> Auth user created: ${s.email} (${authUserId})`);
          } else if (authErr) {
            console.log(`  -> Auth note for ${s.email}:`, authErr.message);
            // Look up existing user id if already created
            const { data: userList } = await supabase.auth.admin.listUsers();
            const existing = userList?.users?.find(u => u.email?.toLowerCase() === s.email.toLowerCase());
            if (existing) authUserId = existing.id;
          }
        } catch (e: any) {
          console.log(`  -> Auth exception:`, e.message);
        }
      }

      // 1b. Upsert into public.students table
      const studentRow: any = {
        name: s.fullName,
        student_id_code: s.studentCode,
        gender: s.gender || "Male",
        dob: s.dob || null,
        age: s.age || 0,
        phone: s.primaryMobile || (s.studentPhones && s.studentPhones[0]) || null,
        email: s.email || null,
        father_name: s.fatherName || null,
        mother_name: s.motherName || null,
        guardian: s.guardianName || null,
        program: s.program || (s.allocatedCourses && s.allocatedCourses[0]?.courseName) || "General Academic Track",
        teacher: s.teacher || "Unassigned",
        status: s.status || "Active"
      };

      if (authUserId) {
        studentRow.user_id = authUserId;
      }

      const { data: upsertData, error: upsertErr } = await supabase
        .from("students")
        .upsert(studentRow, { onConflict: "student_id_code" })
        .select();

      if (upsertErr) {
        console.error(`  -> Failed to insert into 'students' table:`, upsertErr.message);
      } else {
        console.log(`  -> Synced into Supabase 'students' table:`, upsertData?.[0]?.student_id_code);
      }
    }
  }

  // 2. Sync Teacher: Manikanta
  console.log("\nProcessing teacher: manikanta...");
  const teacherEmail = "manikanta@topgrade.edu";
  let teacherAuthId: string | null = null;
  try {
    const { data: tAuth, error: tAuthErr } = await supabase.auth.admin.createUser({
      email: teacherEmail,
      password: "Teacher@123",
      email_confirm: true,
      user_metadata: {
        full_name: "manikanta",
        role: "TEACHER",
        teacher_id_code: "TG-FAC-101"
      }
    });

    if (tAuth?.user) {
      teacherAuthId = tAuth.user.id;
      console.log(`  -> Teacher Auth created: ${teacherEmail} (${teacherAuthId})`);
    } else if (tAuthErr) {
      console.log(`  -> Teacher Auth note:`, tAuthErr.message);
      const { data: userList } = await supabase.auth.admin.listUsers();
      const existing = userList?.users?.find(u => u.email?.toLowerCase() === teacherEmail.toLowerCase());
      if (existing) teacherAuthId = existing.id;
    }
  } catch (e: any) {
    console.log(`  -> Teacher Auth exception:`, e.message);
  }

  const teacherRow: any = {
    name: "manikanta",
    teacher_id_code: "TG-FAC-101",
    qualification: "M.Tech in Computer Science & Engineering",
    phone: "+1 778 064 8562",
    email: teacherEmail,
    specialization: "Coding & Computer Science",
    experience: "7 Years",
    status: "Active"
  };
  if (teacherAuthId) teacherRow.user_id = teacherAuthId;

  const { data: tData, error: tErr } = await supabase
    .from("teachers")
    .upsert(teacherRow, { onConflict: "teacher_id_code" })
    .select();

  if (tErr) {
    console.error(`  -> Failed to insert teacher into 'teachers' table:`, tErr.message);
  } else {
    console.log(`  -> Synced into Supabase 'teachers' table:`, tData?.[0]?.teacher_id_code);
  }

  console.log("\n=== SYNC COMPLETE ===");
}

syncAllToSupabase();
