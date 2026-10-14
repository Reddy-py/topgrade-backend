/**
 * One-time import of the old data/students_db.json into Supabase (students rows + student_dossiers).
 * Run ONCE after applying supabase/migrations/20261011_student_dossiers.sql:   npm run import:students
 * It never creates logins and never sends email. It does not store passwords.
 * Students already in Supabase (same student code) are updated, never duplicated.
 */
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { supabaseAdmin } from "./supabase.js";

const here = path.dirname(fileURLToPath(import.meta.url));
const file = path.join(here, "..", "data", "students_db.json");

const norm = (v: unknown) => String(v ?? "").trim().toLowerCase();

async function main() {
  if (!fs.existsSync(file)) {
    console.log("No data/students_db.json found. Nothing to import.");
    return;
  }
  const students: any[] = JSON.parse(fs.readFileSync(file, "utf-8"));
  console.log(`Importing ${students.length} students from students_db.json ...`);
  let ok = 0;
  const failed: string[] = [];

  for (const st of students) {
    try {
      const { password: _drop, ...dossier } = st;
      const parentEmails = Array.from(new Set(((st.parentEmails || []) as string[]).map(norm).filter(Boolean)));
      const row: any = {
        name: st.fullName,
        student_id_code: st.studentCode,
        gender: st.gender || "Male",
        dob: st.dob || null,
        age: st.age || 0,
        phone: st.primaryMobile || null,
        email: st.email ? norm(st.email) : null,
        father_name: st.fatherName || null,
        mother_name: st.motherName || null,
        guardian: st.guardianName || null,
        father_phone: (st.parentPhones && st.parentPhones[0]) || null,
        parent_emails: parentEmails,
        address: st.residentialAddress || null,
        alternate_address: st.studentAddress || st.alternateAddress || "",
        purchased_hours: st.purchasedHours || 0,
        program: st.program || null,
        teacher: st.teacher || null,
        status: (st.status || "ACTIVE").toUpperCase(),
      };
      const { data: saved, error } = await supabaseAdmin
        .from("students")
        .upsert(row, { onConflict: "student_id_code" })
        .select("id")
        .single();
      if (error || !saved) throw new Error(error?.message || "no row returned");

      const { error: dErr } = await supabaseAdmin
        .from("student_dossiers")
        .upsert({ student_id: saved.id, dossier: { ...dossier, id: saved.id }, updated_at: new Date().toISOString() }, { onConflict: "student_id" });
      if (dErr) throw new Error(dErr.message);
      ok++;
    } catch (e: any) {
      failed.push(`${st.studentCode || st.fullName}: ${e?.message}`);
    }
  }
  console.log(`Imported ${ok} of ${students.length}.`);
  if (failed.length) console.log("Failed:\n - " + failed.join("\n - "));
  const noParent = students.filter(s => !(s.parentEmails || []).some((e: string) => norm(e))).length;
  if (noParent) console.log(`Note: ${noParent} students have no parent email. Open each one and add it (it is mandatory now).`);
}

main().catch(e => { console.error(e); process.exit(1); });
