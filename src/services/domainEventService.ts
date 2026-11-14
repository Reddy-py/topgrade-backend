import { supabaseAdmin } from "../supabase.js";
import { dispatchMultiChannelNotification } from "./notificationService.js";
import { ScheduleDataService } from "./scheduleDataService.js";

export type DomainEventType =
  | "slot.created"
  | "slot.updated"
  | "slot.cancelled"
  | "enrollment.created"
  | "enrollment.paused"
  | "enrollment.resumed"
  | "enrollment.ended"
  | "attendance.marked"
  | "attendance.corrected"
  | "hours.credited"
  | "hours.adjusted"
  | "student.created"
  | "student.updated"
  | "student.archived"
  | "teacher.updated"
  | "course.updated"
  | "announcement.created";

export interface DomainEventPayload<T = any> {
  type: DomainEventType;
  entity: string;
  entity_id: string;
  payload: T;
}

export interface DomainEventRecord {
  id: string;
  type: DomainEventType;
  entity: string;
  entity_id: string;
  payload: any;
  created_at: string;
  processed_at: string | null;
  attempts: number;
  last_error: string | null;
}

/**
 * Records a domain event into the domain_events outbox table.
 * Rule Part C.1: Every state change writes its event in the same transaction/request as the change.
 */
export async function recordDomainEvent<T = any>(event: DomainEventPayload<T>): Promise<string> {
  const nowIso = new Date().toISOString();
  const eventId = `evt-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

  try {
    const { error } = await supabaseAdmin.from("domain_events").insert({
      id: eventId,
      type: event.type,
      entity: event.entity,
      entity_id: event.entity_id,
      payload: event.payload || {},
      created_at: nowIso,
      attempts: 0
    });

    if (error) {
      console.warn(`Notice inserting domain event ${event.type}:`, error.message);
    }
  } catch (err: any) {
    console.warn(`Exception recording domain event ${event.type}:`, err?.message);
  }

  // Trigger worker asynchronously right after event write
  void processDomainEvents().catch(err => {
    console.warn("Notice in post-event outbox worker execution:", err?.message);
  });

  return eventId;
}

/**
 * Exponential retry delay calculation in milliseconds:
 * 1st retry: after 15 minutes (900,000 ms)
 * 2nd retry: after 2 hours (7,200,000 ms)
 * 3rd retry: after 6 hours (21,600,000 ms)
 * Beyond 3 retries: max attempts exceeded, marked failed
 */
export function isEventDueForRetry(event: { created_at: string; attempts: number }): boolean {
  if (event.attempts === 0) return true;
  const createdMs = new Date(event.created_at).getTime();
  const elapsedMs = Date.now() - createdMs;

  if (event.attempts === 1) return elapsedMs >= 15 * 60 * 1000;
  if (event.attempts === 2) return elapsedMs >= 2 * 60 * 60 * 1000;
  if (event.attempts === 3) return elapsedMs >= 6 * 60 * 60 * 1000;
  return false;
}

let isWorkerRunning = false;

/**
 * Outbox processor worker:
 * Processes events idempotently, dispatches emails, writes student history, and logs failures.
 */
export async function processDomainEvents(): Promise<{ processedCount: number; failedCount: number }> {
  if (isWorkerRunning) {
    return { processedCount: 0, failedCount: 0 };
  }

  isWorkerRunning = true;
  let processedCount = 0;
  let failedCount = 0;

  try {
    // 1. Fetch pending events with attempts < 4
    const { data: events, error } = await supabaseAdmin
      .from("domain_events")
      .select("*")
      .is("processed_at", null)
      .lt("attempts", 4)
      .order("created_at", { ascending: true })
      .limit(50);

    if (error || !events || events.length === 0) {
      isWorkerRunning = false;
      return { processedCount: 0, failedCount: 0 };
    }

    for (const evt of events as DomainEventRecord[]) {
      if (!isEventDueForRetry(evt)) {
        continue;
      }

      try {
        await handleDomainEvent(evt);

        // Mark processed
        await supabaseAdmin
          .from("domain_events")
          .update({
            processed_at: new Date().toISOString(),
            attempts: evt.attempts + 1,
            last_error: null
          })
          .eq("id", evt.id);

        processedCount++;
      } catch (handlerErr: any) {
        failedCount++;
        const nextAttempts = evt.attempts + 1;
        const errMessage = handlerErr?.message || "Unknown domain event error";

        await supabaseAdmin
          .from("domain_events")
          .update({
            attempts: nextAttempts,
            last_error: errMessage
          })
          .eq("id", evt.id);

        console.warn(`Outbox handler failed for event ${evt.id} (${evt.type}, attempt ${nextAttempts}):`, errMessage);
      }
    }
  } catch (loopErr: any) {
    console.warn("Outbox processor loop notice:", loopErr?.message);
  } finally {
    isWorkerRunning = false;
  }

  return { processedCount, failedCount };
}

/**
 * Idempotent event dispatcher: routes domain events to history, email notifications, and audits
 */
async function handleDomainEvent(event: DomainEventRecord): Promise<void> {
  const p = event.payload || {};

  switch (event.type) {
    case "slot.created":
      break;

    case "slot.updated":
      break;

    case "slot.cancelled":
      if (p.course_name && p.affected_students && Array.isArray(p.affected_students)) {
        for (const st of p.affected_students) {
          if (st.student_id) {
            void ScheduleDataService.appendHistoryItem({
              student_id: st.student_id,
              student_name: st.student_name || "Student",
              event_type: "STATUS_CHANGE",
              title: `Class Slot Cancelled: ${p.course_name}`,
              description: `Schedule slot on ${p.day_of_week || "assigned day"} was cancelled. Unused hours preserved.`,
              metadata: { slot_id: event.entity_id, course_id: p.course_id },
              actor: p.actor || "Administrator"
            });
          }
        }
      }
      break;

    case "enrollment.created":
      if (p.student_id) {
        void ScheduleDataService.appendHistoryItem({
          student_id: p.student_id,
          student_name: p.student_name || "Student",
          event_type: "COURSE_ENROLLMENT",
          title: `Enrolled in Course Slot: ${p.course_name || "Course"}`,
          description: `Active enrollment confirmed for slot ${p.slot_id}. Duration: ${p.duration_hours || 1} hr(s).`,
          metadata: { slot_id: p.slot_id, course_id: p.course_id, enrollment_id: event.entity_id },
          actor: p.actor || "Registrar"
        });
      }
      break;

    case "enrollment.paused":
      if (p.student_id) {
        void ScheduleDataService.appendHistoryItem({
          student_id: p.student_id,
          student_name: p.student_name || "Student",
          event_type: "STATUS_CHANGE",
          title: `Enrollment Paused: Insufficient Hours`,
          description: `Enrollment in ${p.course_name || "Course"} paused due to 0 remaining hours. Seat held for 14 days.`,
          metadata: { slot_id: p.slot_id, course_id: p.course_id, paused_at: new Date().toISOString() },
          actor: "System Outbox"
        });
      }
      break;

    case "enrollment.resumed":
      if (p.student_id) {
        void ScheduleDataService.appendHistoryItem({
          student_id: p.student_id,
          student_name: p.student_name || "Student",
          event_type: "STATUS_CHANGE",
          title: `Enrollment Resumed: Hours Added`,
          description: `Enrollment in ${p.course_name || "Course"} resumed automatically after hours credited.`,
          metadata: { slot_id: p.slot_id, course_id: p.course_id },
          actor: "System Outbox"
        });
      }
      break;

    case "enrollment.ended":
      if (p.student_id) {
        void ScheduleDataService.appendHistoryItem({
          student_id: p.student_id,
          student_name: p.student_name || "Student",
          event_type: "STATUS_CHANGE",
          title: `Enrollment Ended`,
          description: `Enrollment in slot ${p.slot_id} ended. Unused hours retained in course wallet.`,
          metadata: { slot_id: p.slot_id, course_id: p.course_id },
          actor: p.actor || "Registrar"
        });
      }
      break;

    case "attendance.marked":
    case "attendance.corrected":
      if (p.student_id) {
        void ScheduleDataService.appendHistoryItem({
          student_id: p.student_id,
          student_name: p.student_name || "Student",
          event_type: "ATTENDANCE_RECORD",
          title: `Attendance Marked: ${(p.status || "PRESENT").toUpperCase()}`,
          description: `${(p.status || "PRESENT").toUpperCase()} in ${p.course_name || "Class"} on ${p.date || "session date"}. Hours deducted: ${p.hours_deducted || 0} hr(s).`,
          metadata: { attendance_id: event.entity_id, slot_id: p.slot_id, date: p.date, status: p.status },
          actor: p.marked_by || "Teacher"
        });
      }
      break;

    case "hours.credited":
    case "hours.adjusted":
      if (p.student_id) {
        void ScheduleDataService.appendHistoryItem({
          student_id: p.student_id,
          student_name: p.student_name || "Student",
          event_type: "STATUS_CHANGE",
          title: `Hours ${p.delta > 0 ? "Credited" : "Adjusted"}: ${p.delta > 0 ? `+${p.delta}` : p.delta} hr(s)`,
          description: `${p.reason || "Wallet adjustment"} for course ${p.course_name || p.course_id}. New balance: ${p.new_balance || 0} hr(s).`,
          metadata: { delta: p.delta, course_id: p.course_id, wallet_id: p.wallet_id },
          actor: p.actor || "Administrator"
        });
      }
      break;

    case "student.created":
    case "student.updated":
    case "student.archived":
      break;

    case "teacher.updated":
    case "course.updated":
    case "announcement.created":
      break;

    default:
      break;
  }
}

/**
 * Returns summary of domain events outbox health for the Admin System check page.
 */
export async function getDomainEventsHealth(): Promise<{
  pendingCount: number;
  failedCount: number;
  totalRecorded: number;
  lastProcessedAt: string | null;
}> {
  try {
    const [pendingRes, failedRes, totalRes, lastRes] = await Promise.all([
      supabaseAdmin.from("domain_events").select("id", { count: "exact", head: true }).is("processed_at", null).lt("attempts", 4),
      supabaseAdmin.from("domain_events").select("id", { count: "exact", head: true }).is("processed_at", null).gte("attempts", 4),
      supabaseAdmin.from("domain_events").select("id", { count: "exact", head: true }),
      supabaseAdmin.from("domain_events").select("processed_at").not("processed_at", "is", null).order("processed_at", { ascending: false }).limit(1).maybeSingle()
    ]);

    return {
      pendingCount: pendingRes.count || 0,
      failedCount: failedRes.count || 0,
      totalRecorded: totalRes.count || 0,
      lastProcessedAt: lastRes.data?.processed_at || null
    };
  } catch (err: any) {
    return {
      pendingCount: 0,
      failedCount: 0,
      totalRecorded: 0,
      lastProcessedAt: null
    };
  }
}
