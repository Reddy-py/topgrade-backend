import { supabaseAdmin } from "./supabase.js";

async function test() {
  const { data: pData, error: pErr } = await supabaseAdmin.from("payments").select("*").limit(1);
  console.log("PAYMENTS TABLE:", { exists: !pErr, error: pErr?.message, sample: pData?.[0] });

  const { data: fData, error: fErr } = await supabaseAdmin.from("fees").select("*").limit(1);
  console.log("FEES TABLE:", { exists: !fErr, error: fErr?.message, sample: fData?.[0] });

  const { data: sData, error: sErr } = await supabaseAdmin.from("students").select("*").limit(1);
  console.log("STUDENTS TABLE COLUMNS:", Object.keys(sData?.[0] || {}));
}

test();
