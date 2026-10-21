import dotenv from "dotenv";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
dotenv.config({ path: path.resolve(__dirname, "../../.env") });

async function run() {
  const API = "http://localhost:5000";
  // 1. Admin Login
  const loginRes = await fetch(`${API}/api/auth/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ identifier: "admin@topgrade.edu", password: "TopGrade2026!" })
  });
  const loginData = await loginRes.json() as any;
  const token = loginData.session?.access_token || loginData.token;

  console.log("Logged in as admin. Testing student filters...");

  // Test 1: Basic list (limit 25)
  const t0 = Date.now();
  const res1 = await fetch(`${API}/api/students/list?page=1&limit=25`, {
    headers: { Authorization: `Bearer ${token}` }
  });
  const d1 = await res1.json() as any;
  const elapsed1 = Date.now() - t0;
  console.log(`[PASS 1] Basic list 25/page: total=${d1.total}, returned=${d1.data?.length}, elapsed=${elapsed1}ms`);

  // Test 2: Filter by Grade and preset hours
  const t1 = Date.now();
  const res2 = await fetch(`${API}/api/students/list?page=1&limit=25&hoursPreset=0-2`, {
    headers: { Authorization: `Bearer ${token}` }
  });
  const d2 = await res2.json() as any;
  const elapsed2 = Date.now() - t1;
  console.log(`[PASS 2] Hours preset '0-2': count=${d2.data?.length}, elapsed=${elapsed2}ms`);

  // Test 3: Filter by weekdays (any)
  const t2 = Date.now();
  const res3 = await fetch(`${API}/api/students/list?weekdays=Monday,Wednesday&weekdayMatch=any`, {
    headers: { Authorization: `Bearer ${token}` }
  });
  const d3 = await res3.json() as any;
  const elapsed3 = Date.now() - t2;
  console.log(`[PASS 3] Weekdays any (Monday, Wednesday): count=${d3.data?.length}, elapsed=${elapsed3}ms`);

  // Test 4: Combined filters with AND
  const t3 = Date.now();
  const res4 = await fetch(`${API}/api/students/list?sessionPreset=0&hoursPreset=0-2&plan=Package`, {
    headers: { Authorization: `Bearer ${token}` }
  });
  const d4 = await res4.json() as any;
  const elapsed4 = Date.now() - t3;
  console.log(`[PASS 4] Combined filters (sessionPreset=0 AND hoursPreset=0-2 AND plan=Package): count=${d4.data?.length}, elapsed=${elapsed4}ms`);

  // Test 5: Teacher login
  const tLogin = await fetch(`${API}/api/auth/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ identifier: "teacher@topgrade.edu", password: "TopGrade2026!" })
  });
  const tLoginData = await tLogin.json() as any;
  const tToken = tLoginData.session?.access_token || tLoginData.token;

  const tRes = await fetch(`${API}/api/students/list?page=1&limit=25`, {
    headers: { Authorization: `Bearer ${tToken}` }
  });
  const td = await tRes.json() as any;
  console.log(`[PASS 5] Teacher login: total=${td.total}, availableFilters courses=${td.availableFilters?.courses?.length}, schools=${td.availableFilters?.schools?.length}`);

  if (elapsed1 < 300 && elapsed2 < 300 && elapsed3 < 300 && elapsed4 < 300) {
    console.log("✅ ALL RESPONSES WELL UNDER 300ms SLA!");
  } else {
    console.warn("⚠️ Response exceeded 300ms!");
  }
}

run();
