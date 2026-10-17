import { supabaseAdmin } from "./supabase.js";

async function testSelect() {
  const res = await supabaseAdmin.from("schedules").select("*").limit(5);
  console.log("schedules result:", {
    status: res.status,
    statusText: res.statusText,
    error: res.error,
    data: res.data
  });
}

testSelect().then(() => { process.exitCode = 0; });
