import dotenv from "dotenv";
import path from "path";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

dotenv.config({ path: path.resolve(__dirname, "../.env") });

const supabaseUrl = process.env.SUPABASE_URL || "";
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY || "";

async function testSql() {
  const query = "ALTER TABLE students ADD COLUMN IF NOT EXISTS exam_date DATE; ALTER TABLE students ADD COLUMN IF NOT EXISTS student_address TEXT;";
  
  // Try 1: Supabase PG REST / v1/query
  try {
    const res = await fetch(`${supabaseUrl}/pg/query`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization": `Bearer ${supabaseKey}`,
        "apikey": supabaseKey
      },
      body: JSON.stringify({ query })
    });
    console.log("pg/query status:", res.status, await res.text());
  } catch (e) {
    console.log("pg/query failed:", e.message);
  }

  // Try 2: sql endpoint
  try {
    const res = await fetch(`${supabaseUrl}/rest/v1/rpc/exec_sql`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization": `Bearer ${supabaseKey}`,
        "apikey": supabaseKey
      },
      body: JSON.stringify({ query })
    });
    console.log("rpc/exec_sql status:", res.status, await res.text());
  } catch (e) {
    console.log("rpc/exec_sql failed:", e.message);
  }
}

testSql();
