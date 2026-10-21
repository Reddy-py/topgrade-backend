import { supabaseAdmin } from "../supabase.js";

async function main() {
  const fallback = await supabaseAdmin
    .from("profiles")
    .select("role, status, full_name")
    .eq("id", "5a104fe2-7152-43af-beb5-7ec5dd294e1d")
    .maybeSingle();

  console.log("Fallback result:", fallback);
}

main().catch(console.error);
