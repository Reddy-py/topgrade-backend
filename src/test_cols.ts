import { supabaseAdmin } from "./supabase.js";

async function test() {
  const { data, error } = await supabaseAdmin.from("parent_students").select("*").limit(5);
  console.log("PARENT_STUDENTS TABLE:", { count: data?.length, error });
}

test();
