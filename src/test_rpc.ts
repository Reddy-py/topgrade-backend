import { supabaseAdmin } from "./supabase.js";

async function testRpc() {
  const rpcs = ["exec_sql", "exec", "execute_sql", "run_sql", "query"];
  for (const r of rpcs) {
    const { data, error } = await supabaseAdmin.rpc(r, { query: "SELECT 1" });
    console.log(`RPC ${r}:`, error ? error.message : "SUCCESS!");
  }
}

testRpc().then(() => { process.exitCode = 0; });
