import { supabaseAdmin } from "../supabase.js";
import { ScheduleDataService } from "./scheduleDataService.js";
import { instituteToday } from "./instituteTime.js";

export interface ExpiryJobResult {
  claimed: boolean;
  expiredCount: number;
  expiredEnrollments: Array<{
    enrollmentId: string;
    studentId: string;
    courseId: string;
    unusedHours: number;
    expiresOn: string;
  }>;
  message: string;
}

const localClaimedDates = new Set<string>();

/**
 * Claim pattern daily job:
 * - Runs once per day (checks/claims today's date).
 * - Finds PACKAGE enrollments where expires_on or end_date < CURRENT_DATE and status = 'ACTIVE'.
 * - Marks their status as 'EXPIRED'.
 * - Records unused hours in student_history without deleting/zeroing any balance.
 */
export async function runDailyPackageExpiryJob(workerId: string = "system-cron"): Promise<ExpiryJobResult> {
  const today = instituteToday();

  // In-memory check first to avoid redundant database calls
  if (localClaimedDates.has(today)) {
    return {
      claimed: false,
      expiredCount: 0,
      expiredEnrollments: [],
      message: `Daily package expiry job was already executed for today (${today}). Claim skipped.`
    };
  }

  let claimed = false;
  try {
    const { data: existingClaim, error: readErr } = await supabaseAdmin
      .from("daily_job_claims")
      .select("*")
      .eq("job_name", "package_enrollment_expiry")
      .maybeSingle();

    if (!readErr && existingClaim) {
      const claimDate = String(existingClaim.claimed_date).slice(0, 10);
      if (claimDate === today) {
        localClaimedDates.add(today);
        return {
          claimed: false,
          expiredCount: 0,
          expiredEnrollments: [],
          message: `Daily package expiry job was already executed for today (${today}). Claim skipped.`
        };
      }

      await supabaseAdmin
        .from("daily_job_claims")
        .update({
          claimed_date: today,
          claimed_at: new Date().toISOString(),
          worker_id: workerId
        })
        .eq("job_name", "package_enrollment_expiry");
      claimed = true;
    } else if (!readErr) {
      await supabaseAdmin
        .from("daily_job_claims")
        .insert({
          job_name: "package_enrollment_expiry",
          claimed_date: today,
          claimed_at: new Date().toISOString(),
          worker_id: workerId
        });
      claimed = true;
    } else {
      claimed = true;
    }
  } catch {
    claimed = true;
  }
  localClaimedDates.add(today);

  // 3. Find all ACTIVE PACKAGE enrollments whose expires_on or end_date is in the past
  let expiredList: any[] = [];
  try {
    const { data, error: fetchErr } = await supabaseAdmin
      .from("student_enrollments")
      .select("*")
      .eq("status", "ACTIVE");

    if (!fetchErr && Array.isArray(data)) {
      expiredList = data.filter((e: any) => {
        const expDate = e.expires_on || e.end_date;
        if (!expDate) return false;
        const expStr = String(expDate).slice(0, 10);
        return (e.plan === "PACKAGE" || !e.plan) && expStr < today;
      });
    }
  } catch (err: any) {
    console.warn("Notice querying student_enrollments expiry:", err?.message);
  }

  if (!expiredList || expiredList.length === 0) {
    return {
      claimed,
      expiredCount: 0,
      expiredEnrollments: [],
      message: `No active package enrollments past their expiration date as of ${today}.`
    };
  }

  const results: Array<{
    enrollmentId: string;
    studentId: string;
    courseId: string;
    unusedHours: number;
    expiresOn: string;
  }> = [];

  // Fetch courses and students for clear history logging
  const courseIds = [...new Set(expiredList.map(e => e.course_id))];
  const studentIds = [...new Set(expiredList.map(e => e.student_id))];

  const { data: courses } = await supabaseAdmin
    .from("courses")
    .select("id, name")
    .in("id", courseIds);
  const courseMap = new Map((courses || []).map((c: any) => [c.id, c.name]));

  const { data: students } = await supabaseAdmin
    .from("students")
    .select("id, name, tokens_balance, hours_left")
    .in("id", studentIds);
  const studentMap = new Map((students || []).map((s: any) => [s.id, s]));

  // Also check token_wallets
  const { data: wallets } = await supabaseAdmin
    .from("token_wallets")
    .select("student_id, course_id, balance")
    .in("student_id", studentIds);
  const walletMap = new Map<string, number>();
  (wallets || []).forEach((w: any) => {
    walletMap.set(`${w.student_id}:${w.course_id}`, Number(w.balance) || 0);
  });

  const nowIso = new Date().toISOString();

  for (const enr of expiredList) {
    // 1. Mark enrollment as EXPIRED
    await supabaseAdmin
      .from("student_enrollments")
      .update({
        status: "EXPIRED",
        updated_at: nowIso
      })
      .eq("id", enr.id);

    const student = studentMap.get(enr.student_id);
    const courseName = courseMap.get(enr.course_id) || "Enrolled Course";
    const walletBalance = walletMap.get(`${enr.student_id}:${enr.course_id}`);
    const unusedHours = walletBalance !== undefined 
      ? walletBalance 
      : (student?.tokens_balance ?? student?.hours_left ?? 0);

    // 2. Record unused hours in student history WITHOUT deleting or zeroing balance
    await ScheduleDataService.appendHistoryItem({
      student_id: enr.student_id,
      student_name: student?.name || "Student",
      event_type: "PACKAGE_EXPIRED",
      title: `Course Package Expired: ${courseName}`,
      description: `Course package reached expiration date (${enr.expires_on}). Student has ${unusedHours} unused hours remaining. Balance preserved for administrative review.`,
      metadata: {
        enrollment_id: enr.id,
        course_id: enr.course_id,
        course_name: courseName,
        plan: "PACKAGE",
        hours_total: enr.hours_total,
        unused_hours: unusedHours,
        expires_on: enr.expires_on,
        notice: "Balance was NOT zeroed or deleted. Awaiting administrative action."
      },
      actor: "Daily Expiry Scheduler"
    });

    results.push({
      enrollmentId: enr.id,
      studentId: enr.student_id,
      courseId: enr.course_id,
      unusedHours,
      expiresOn: enr.expires_on
    });
  }

  return {
    claimed,
    expiredCount: results.length,
    expiredEnrollments: results,
    message: `Daily expiry job executed: ${results.length} package enrollments marked EXPIRED. Unused hours logged to student histories without altering balances.`
  };
}
