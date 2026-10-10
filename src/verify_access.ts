/**
 * Login-based access check. Run against a RUNNING backend with four real test accounts (one per role):
 *
 *   API_BASE=http://localhost:5000 SUPABASE_URL=... SUPABASE_ANON_KEY=... \
 *   TEST_ADMIN_EMAIL=... TEST_ADMIN_PASSWORD=... TEST_TEACHER_EMAIL=... TEST_TEACHER_PASSWORD=... \
 *   TEST_PARENT_EMAIL=... TEST_PARENT_PASSWORD=... TEST_STUDENT_EMAIL=... TEST_STUDENT_PASSWORD=... \
 *   npm run verify:access
 */
import { createClient } from "@supabase/supabase-js";

const API = process.env.API_BASE || "http://localhost:5000";
const url = process.env.SUPABASE_URL || "";
const anon = process.env.SUPABASE_ANON_KEY || "";
const supa = createClient(url, anon);

let failed = 0;
const check = (name: string, ok: boolean, detail = "") => {
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${ok ? "" : `  ${detail}`}`);
  if (!ok) failed++;
};

async function tokenFor(role: string): Promise<string> {
  const email = process.env[`TEST_${role}_EMAIL`] || "";
  const password = process.env[`TEST_${role}_PASSWORD`] || "";
  const { data, error } = await supa.auth.signInWithPassword({ email, password });
  if (error || !data.session) throw new Error(`Cannot sign in as ${role}: ${error?.message}`);
  return data.session.access_token;
}

async function call(method: string, path: string, token?: string, body?: unknown) {
  const headers: Record<string, string> = { "Content-Type": "application/json" };
  if (token) headers["Authorization"] = `Bearer ${token}`;
  const init: RequestInit = { method, headers };
  if (body !== undefined) init.body = JSON.stringify(body);
  const res = await fetch(`${API}${path}`, init);
  let json: any = null;
  try { json = await res.json(); } catch { /* not JSON */ }
  return { status: res.status, json };
}

async function main() {
  console.log("--- Not signed in ---");
  check("no token  -> 401 on students list", (await call("GET", "/api/students/list")).status === 401);
  check("fake demo token -> 401", (await call("GET", "/api/students/list", "demo-token")).status === 401);
  check("anyone creating accounts -> 401", (await call("POST", "/api/auth/provision-credentials", undefined, { email: "x@y.z", role: "ADMIN" })).status === 401);

  const t = {
    ADMIN: await tokenFor("ADMIN"),
    TEACHER: await tokenFor("TEACHER"),
    PARENT: await tokenFor("PARENT"),
    STUDENT: await tokenFor("STUDENT"),
  };

  console.log("--- Admin: whole access ---");
  check("admin  students list 200", (await call("GET", "/api/students/list", t.ADMIN)).status === 200);
  check("admin  reports 200", (await call("GET", "/api/reports/admissions", t.ADMIN)).status === 200);
  check("admin  fees list 200", (await call("GET", "/api/fees/list", t.ADMIN)).status === 200);

  console.log("--- Teacher ---");
  check("teacher students list 200", (await call("GET", "/api/students/list", t.TEACHER)).status === 200);
  check("teacher cannot add student (403)", (await call("POST", "/api/students", t.TEACHER, {})).status === 403);
  check("teacher cannot open reports (403)", (await call("GET", "/api/reports/admissions", t.TEACHER)).status === 403);
  check("teacher cannot open fees (403)", (await call("GET", "/api/fees/list", t.TEACHER)).status === 403);
  check("teacher cannot create accounts (403)", (await call("POST", "/api/auth/provision-credentials", t.TEACHER, { email: "x@y.z", role: "ADMIN" })).status === 403);

  console.log("--- Parent ---");
  const parentEmail = (process.env.TEST_PARENT_EMAIL || "").toLowerCase();
  const pl = await call("GET", "/api/students/list", t.PARENT);
  check("parent students list 200", pl.status === 200);
  const rows: any[] = pl.json?.data || [];
  check("parent sees only children with their own parent email", rows.every(s => (s.parentEmails || []).map((e: string) => e.toLowerCase()).includes(parentEmail)), `${rows.length} rows`);
  check("parent never receives passwords", rows.every(s => s.password === undefined));
  check("parent cannot add student (403)", (await call("POST", "/api/students", t.PARENT, {})).status === 403);
  check("parent cannot edit courses (403)", (await call("POST", "/api/courses", t.PARENT, {})).status === 403);
  check("parent cannot open reports (403)", (await call("GET", "/api/reports/admissions", t.PARENT)).status === 403);
  check("parent fees list 200", (await call("GET", "/api/fees/list", t.PARENT)).status === 200);

  console.log("--- Student ---");
  const sl = await call("GET", "/api/students/list", t.STUDENT);
  check("student sees only their own record", sl.status === 200 && (sl.json?.data || []).length <= 1, `${(sl.json?.data || []).length} rows`);
  check("student cannot open fees (403)", (await call("GET", "/api/fees/list", t.STUDENT)).status === 403);
  check("student cannot add student (403)", (await call("POST", "/api/students", t.STUDENT, {})).status === 403);
  check("student cannot mark attendance (403)", (await call("POST", "/api/attendance/mark-batch", t.STUDENT, {})).status === 403);
  check("student cannot open another student's schedule (403)", (await call("GET", "/api/schedules/student/not-my-id", t.STUDENT)).status === 403);

  console.log(failed === 0 ? "\nALL ACCESS CHECKS PASSED" : `\n${failed} CHECK(S) FAILED`);
  process.exit(failed === 0 ? 0 : 1);
}

main().catch(err => { console.error(err.message); process.exit(1); });
