import { supabaseAdmin } from "./supabase.js";

async function test() {
  const { data, error } = await supabaseAdmin.from("students").select("*").limit(1);
  if (error) {
    console.error("Error fetching student:", error);
    return;
  }
  if (data && data.length > 0) {
    console.log("STUDENT TABLE COLUMNS:", Object.keys(data[0]));
    console.log("SAMPLE ROW:", data[0]);
  } else {
    console.log("No student data found.");
  }
}

test();
