import { supabaseAdmin } from "./supabase.js";

async function inspect() {
  const { data: locs, error: locErr } = await supabaseAdmin.from("locations").select("*");
  console.log("Locations:", locErr ? locErr.message : locs);

  const { data: inst, error: instErr } = await supabaseAdmin.from("institute_settings").select("*");
  console.log("Institute Settings:", instErr ? instErr.message : inst);

  const { data: stuCols, error: stuErr } = await supabaseAdmin.from("students").select("*").limit(1);
  console.log("Student Sample Keys:", stuErr ? stuErr.message : (stuCols && stuCols[0] ? Object.keys(stuCols[0]) : "none"));

  const { data: schCols, error: schErr } = await supabaseAdmin.from("schedules").select("*").limit(1);
  console.log("Schedule Sample Keys:", schErr ? schErr.message : (schCols && schCols[0] ? Object.keys(schCols[0]) : "none"));
}

inspect().then(() => process.exit(0)).catch(err => { console.error(err); process.exit(1); });
