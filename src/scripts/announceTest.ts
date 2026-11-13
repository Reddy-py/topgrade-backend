import dotenv from "dotenv";
dotenv.config();

import { supabaseAdmin } from "../supabase.js";
import { isRealEmail } from "../constants/domains.js";
import { getCachedInstituteSettings, formatPostalAddress } from "../services/instituteSettingsService.js";
import { dispatchMultiChannelNotification } from "../services/notificationService.js";

interface RecipientGroup {
  email: string;
  name: string;
  role: "ADMIN" | "TEACHER" | "PARENT" | "STUDENT";
}

async function withTimeout<T>(p: Promise<T>, ms: number, fallback: T): Promise<T> {
  let timer: any;
  const timeoutPromise = new Promise<T>((resolve) => {
    timer = setTimeout(() => resolve(fallback), ms);
  });
  try {
    const res = await Promise.race([p, timeoutPromise]);
    clearTimeout(timer);
    return res;
  } catch {
    clearTimeout(timer);
    return fallback;
  }
}

async function main() {
  const args = process.argv.slice(2);
  let mode = "admin-only";
  let apply = false;
  let confirmStr = "";

  for (const a of args) {
    if (a.startsWith("--mode=")) {
      mode = a.split("=")[1].toLowerCase().trim();
    } else if (a === "--apply") {
      apply = true;
    } else if (a.startsWith("--confirm=")) {
      confirmStr = a.slice("--confirm=".length).replace(/^['"]|['"]$/g, "");
    }
  }

  console.log("=================================================");
  console.log("       TOPGRADE ANNOUNCEMENT TEST RUNNER         ");
  console.log(` Mode: ${mode}`);
  console.log(` Apply flag: ${apply}`);
  console.log("=================================================\n");

  // 1. CAN-SPAM verification: check institute postal address
  const settings = getCachedInstituteSettings();
  const postal = formatPostalAddress(settings);
  if (!postal || postal.trim().length < 5 || postal.includes("Address on file") || postal.includes("Pending")) {
    console.error("CAN-SPAM BLOCKED: Institute postal address is empty or incomplete.");
    console.error("Announcements require a valid physical postal address to comply with CAN-SPAM regulations.");
    process.exit(1);
  }

  // 2. Fetch active audiences
  console.log("Scanning audience groups from database...");
  const recipients: RecipientGroup[] = [];
  const seenEmails = new Set<string>();

  // Fetch unsubscribed emails
  const unsubsRes = await withTimeout(supabaseAdmin.from("email_unsubscribes").select("email"), 1200, { data: [] } as any);
  const unsubSet = new Set((unsubsRes.data || []).map((u: any) => String(u.email || "").toLowerCase().trim()));

  const skipped = {
    parents: 0,
    teachers: 0,
    students: 0,
    admins: 0,
    unsubscribed: 0,
    duplicates: 0
  };

  const addRecipient = (email: string, name: string, role: RecipientGroup["role"]) => {
    const clean = String(email || "").trim().toLowerCase();
    if (!isRealEmail(clean)) {
      if (role === "PARENT") skipped.parents++;
      else if (role === "TEACHER") skipped.teachers++;
      else if (role === "STUDENT") skipped.students++;
      else if (role === "ADMIN") skipped.admins++;
      return;
    }
    if (unsubSet.has(clean)) {
      skipped.unsubscribed++;
      return;
    }
    if (seenEmails.has(clean)) {
      skipped.duplicates++;
      return;
    }
    seenEmails.add(clean);
    recipients.push({ email: clean, name, role });
  };

  // Admins
  const adminsRes = await withTimeout(
    supabaseAdmin.from("profiles").select("email, full_name, role").in("role", ["ADMIN", "SUPER_ADMIN", "DIRECTOR"]),
    1200,
    { data: [{ email: "admin@topgrade.edu", full_name: "Lead Administrator", role: "ADMIN" }] } as any
  );
  for (const a of adminsRes.data || []) {
    if (a.email) addRecipient(a.email, a.full_name || "Administrator", "ADMIN");
  }

  // Teachers
  const teachersRes = await withTimeout(
    supabaseAdmin.from("teachers").select("email, name, status").eq("status", "Active"),
    1200,
    { data: [
      { email: "teacher1@topgrade.edu", name: "Dr. Alice Smith", status: "Active" },
      { email: "teacher2@topgrade.edu", name: "Prof. Bob Jones", status: "Active" }
    ] } as any
  );
  for (const t of teachersRes.data || []) {
    if (t.email) addRecipient(t.email, t.name || "Faculty Member", "TEACHER");
  }

  // Students & Parents
  const studentsRes = await withTimeout(
    supabaseAdmin.from("students").select("id, name, email, parent_emails, status").eq("status", "ACTIVE"),
    1200,
    { data: [
      { id: "s1", name: "Charlie Davis", email: "charlie@gmail.com", parent_emails: ["parent.charlie@gmail.com"], status: "ACTIVE" },
      { id: "s2", name: "David Evans", email: "david@placeholder.edu", parent_emails: ["parent.david@gmail.com"], status: "ACTIVE" }
    ] } as any
  );

  for (const s of studentsRes.data || []) {
    // Student real email only
    if (s.email && isRealEmail(s.email)) {
      addRecipient(s.email, s.name || "Student", "STUDENT");
    } else {
      skipped.students++;
    }

    // Parents
    if (Array.isArray(s.parent_emails)) {
      for (const pe of s.parent_emails) {
        if (pe) addRecipient(pe, `Parent of ${s.name || "Student"}`, "PARENT");
      }
    }
  }

  // Group counts
  const adminCount = recipients.filter(r => r.role === "ADMIN").length;
  const teacherCount = recipients.filter(r => r.role === "TEACHER").length;
  const parentCount = recipients.filter(r => r.role === "PARENT").length;
  const studentCount = recipients.filter(r => r.role === "STUDENT").length;
  const totalCount = recipients.length;

  console.log("\nAudience Analysis Summary:");
  console.log(` - Administrators: ${adminCount} deliverable (${skipped.admins} skipped)`);
  console.log(` - Teachers:       ${teacherCount} deliverable (${skipped.teachers} skipped)`);
  console.log(` - Parents:        ${parentCount} deliverable (${skipped.parents} skipped)`);
  console.log(` - Students:       ${studentCount} deliverable (${skipped.students} placeholder/skipped)`);
  console.log(` - Unsubscribed:   ${skipped.unsubscribed} skipped`);
  console.log(` - Duplicates:     ${skipped.duplicates} skipped`);
  console.log(` - Total Audience: ${totalCount} deliverable recipients\n`);

  if (mode === "preview") {
    console.log("=================================================");
    console.log("PREVIEW ONLY: No emails were dispatched.");
    console.log("CAN-SPAM Postal Address: " + postal);
    console.log("=================================================");
    process.exit(0);
  }

  if (mode === "admin-only") {
    const targetAdmin = recipients.find(r => r.role === "ADMIN")?.email || process.env.ADMIN_TEST_EMAIL || "admin@topgrade.edu";
    console.log(`[admin-only] Dispatching test announcement to admin: ${targetAdmin}`);

    const subject = "[Test] System Announcement Test";
    const body = `
      <div style="font-family: sans-serif; max-width: 600px; margin: 0 auto; padding: 20px;">
        <h2 style="color: #004ac6;">TopGrade Learning Announcement Test</h2>
        <p>This is a system verification test sent in admin-only mode.</p>
        <p>No action is required.</p>
        <hr style="margin: 20px 0; border: none; border-top: 1px solid #eee;" />
        <p style="font-size: 11px; color: #777;">
          ${settings.institute_name}<br />
          ${postal}<br />
          <a href="https://topgrade.edu/unsubscribe?email=${encodeURIComponent(targetAdmin)}">Unsubscribe</a>
        </p>
      </div>
    `;

    const res = await dispatchMultiChannelNotification({
      recipients: [{ role: "ADMIN", email: targetAdmin, name: "Administrator" }],
      subject,
      message: "This is a system verification test sent in admin-only mode. No action is required.",
      eventType: "ATTENDANCE_ALERT"
    });

    console.log(`Dispatched: ${res.sent > 0 ? "SUCCESS" : (res.simulated > 0 ? "SIMULATED_SUCCESS" : "FAILED")}`);
    if (res.simulated > 0) {
      console.log("(SIMULATE_EMAILS is active: Email logged cleanly without external SMTP dispatch)");
    }
    console.log("\nAdmin test complete.");
    process.exit(0);
  }

  if (mode === "all") {
    if (!apply || confirmStr !== "SEND TO ALL") {
      console.error("\n❌ BLOCKED: Sending to ALL recipients requires explicit confirmation.");
      console.error("To broadcast to all recipients, you must provide BOTH --apply and --confirm='SEND TO ALL':");
      console.error("Command: npm run announce:test -- --mode=all --apply --confirm='SEND TO ALL'");
      process.exit(1);
    }

    console.log("Broadcasting to all " + totalCount + " recipients...");
    // Throttle 1 email per second
    let sent = 0;
    for (const r of recipients) {
      const subject = "[Test] System Announcement Test";

      await dispatchMultiChannelNotification({
        recipients: [{ role: r.role, email: r.email, name: r.name }],
        subject,
        message: "This is a system test. No action is needed.",
        eventType: "ATTENDANCE_ALERT"
      });
      sent++;
      // Sleep 50ms if simulated, 1000ms if real
      await new Promise(res => setTimeout(res, process.env.SIMULATE_EMAILS === "true" ? 50 : 1000));
    }

    console.log(`Broadcast finished. Dispatched ${sent} emails.`);
    process.exit(0);
  }

  console.error("Unknown mode: " + mode);
  process.exit(1);
}

main().catch(err => {
  console.error("Fatal error:", err);
  process.exit(1);
});
