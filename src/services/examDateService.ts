import { supabaseAdmin } from "../supabase.js";
import { resolveStudent, inMemoryStudentStore } from "./studentService.js";
import { normEmail, isValidEmail } from "./studentAccounts.js";
import { isRealEmail } from "../constants/domains.js";
import { dispatchMultiChannelNotification } from "./notificationService.js";
import { getCachedInstituteSettings } from "./instituteSettingsService.js";

export interface StudentExamDateRecord {
  id?: string | undefined;
  studentId: string;
  courseId: string;
  examDate: string;
  notes?: string | undefined;
  createdBy?: string | undefined;
  createdAt?: string | undefined;
  updatedAt?: string | undefined;
}

// In-memory fallback cache for offline development/synthetic runs
const inMemoryExamDates: StudentExamDateRecord[] = [];

/**
 * Retrieves all exam dates for a specific student, migrating legacy medical_notes if needed.
 */
export async function getStudentExamDatesService(studentLookup: string): Promise<StudentExamDateRecord[]> {
  const student = await resolveStudent(studentLookup);
  if (!student) return [];

  const studentId = student.id;

  // 1. Try querying student_exam_dates table (timeout protected for offline resilience)
  try {
    const timeoutPromise = new Promise<any>((resolve) => setTimeout(() => resolve({ data: null, error: new Error("DB timeout") }), 2000));
    const queryPromise = supabaseAdmin
      .from("student_exam_dates")
      .select("*")
      .eq("student_id", studentId)
      .order("exam_date", { ascending: true });

    const { data, error } = await Promise.race([queryPromise, timeoutPromise]);

    if (!error && data && data.length > 0) {
      return data.map((r: any) => ({
        id: r.id,
        studentId: r.student_id,
        courseId: r.course_id,
        examDate: r.exam_date,
        notes: r.notes || "",
        createdBy: r.created_by,
        createdAt: r.created_at,
        updatedAt: r.updated_at,
      }));
    }
  } catch (err: any) {
    console.warn("Notice querying student_exam_dates:", err.message);
  }

  // 2. Check in-memory store
  const memDates = inMemoryExamDates.filter(e => e.studentId === studentId);
  if (memDates.length > 0) return memDates;

  // 3. Migrate legacy date if present on student record
  if (student.examDate) {
    const legacyRec: StudentExamDateRecord = {
      id: `legacy-${Date.now()}`,
      studentId: studentId || "unknown",
      courseId: "GENERAL",
      examDate: student.examDate,
      notes: "Migrated from legacy student record",
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };
    inMemoryExamDates.push(legacyRec);
    // Attempt lazy DB migration if table exists
    try {
      await supabaseAdmin.from("student_exam_dates").upsert({
        student_id: studentId,
        course_id: "GENERAL",
        exam_date: student.examDate,
        notes: "Migrated from legacy profile",
      }, { onConflict: "student_id,course_id" });
    } catch {}

    return [legacyRec];
  }

  return [];
}

/**
 * Saves or updates an exam date for a specific student and course without overwriting other courses.
 */
export async function upsertStudentExamDateService(params: {
  studentId: string;
  courseId: string;
  examDate: string;
  notes?: string;
  createdBy?: string;
}): Promise<StudentExamDateRecord> {
  const student = await resolveStudent(params.studentId);
  if (!student) {
    throw new Error(`Student '${params.studentId}' not found.`);
  }

  const cleanCourse = (params.courseId || "GENERAL").trim().toUpperCase();
  const cleanDate = (params.examDate || "").trim();
  if (!cleanDate || !/^\d{4}-\d{2}-\d{2}$/.test(cleanDate)) {
    throw new Error("Valid exam date in YYYY-MM-DD format is required.");
  }

  const record: StudentExamDateRecord = {
    id: `sed-${Date.now()}`,
    studentId: student.id || params.studentId,
    courseId: cleanCourse,
    examDate: cleanDate,
    notes: params.notes || "",
    createdBy: params.createdBy,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };

  // Upsert in memory store
  const existingIdx = inMemoryExamDates.findIndex(
    e => e.studentId === student.id && e.courseId === cleanCourse
  );
  if (existingIdx >= 0) {
    inMemoryExamDates[existingIdx] = { ...inMemoryExamDates[existingIdx], ...record, updatedAt: new Date().toISOString() };
  } else {
    inMemoryExamDates.push(record);
  }

  // Also update in-memory student.examDate if general or most recent
  const memStu = inMemoryStudentStore.find(s => s.id === student.id || s.studentCode === student.studentCode);
  if (memStu) {
    memStu.examDate = cleanDate;
  }

  // Upsert into Supabase student_exam_dates table if available
  try {
    const { data, error } = await supabaseAdmin
      .from("student_exam_dates")
      .upsert({
        student_id: student.id,
        course_id: cleanCourse,
        exam_date: cleanDate,
        notes: params.notes || null,
        created_by: params.createdBy || null,
        updated_at: new Date().toISOString(),
      }, { onConflict: "student_id,course_id" })
      .select()
      .maybeSingle();

    if (!error && data) {
      record.id = data.id;
    }
  } catch (err: any) {
    console.warn("Notice saving to student_exam_dates table:", err.message);
  }

  return record;
}

/**
 * Checks whether an exam wish was already sent to this student today
 */
async function hasExamWishSentToday(studentId: string, courseId?: string): Promise<boolean> {
  const today = new Date().toISOString().split("T")[0];
  try {
    const { data } = await supabaseAdmin
      .from("email_log")
      .select("id")
      .eq("student_id", studentId)
      .eq("event_type", "EXAM_WISH")
      .gte("created_at", `${today}T00:00:00.000Z`)
      .limit(1);

    return !!(data && data.length > 0);
  } catch {
    return false;
  }
}

/**
 * Sends a personal 1-to-1 exam wish to a student and/or their parents.
 */
export async function sendSingleStudentExamWishService(params: {
  studentId: string;
  courseId?: string;
  examDate?: string;
  recipientTypes?: ("STUDENT" | "PARENT")[];
  customMessage?: string;
  forceResend?: boolean;
}): Promise<{
  success: boolean;
  sentCount: number;
  recipients: string[];
  alreadySentToday?: boolean;
  message: string;
}> {
  const student = await resolveStudent(params.studentId);
  if (!student) {
    throw new Error(`Student '${params.studentId}' not found.`);
  }

  const courseName = params.courseId && params.courseId !== "GENERAL" ? params.courseId : "Upcoming Academic Assessment";
  const examDate = params.examDate || student.examDate || "Scheduled Assessment Date";
  const recipientTypes = params.recipientTypes || ["STUDENT", "PARENT"];

  // Check idempotency for same day
  if (!params.forceResend) {
    const targetStudentId = student.id || params.studentId;
    const alreadySent = await hasExamWishSentToday(targetStudentId, params.courseId);
    if (alreadySent) {
      return {
        success: false,
        sentCount: 0,
        recipients: [],
        alreadySentToday: true,
        message: `An exam wish has already been sent to ${student.fullName} today. Confirm 'Resend' to send again.`,
      };
    }
  }

  // Build target recipient list
  const targetEmails = new Set<string>();
  const recipientObjects: Array<{ role: any; email: string; name: string; phone: string }> = [];

  if (recipientTypes.includes("STUDENT")) {
    const sEmails = [student.email, ...(student.studentEmails || [])].map(normEmail).filter(isRealEmail);
    for (const e of sEmails) {
      if (!targetEmails.has(e)) {
        targetEmails.add(e);
        recipientObjects.push({
          role: "STUDENT",
          email: e,
          name: student.fullName,
          phone: student.primaryMobile || "",
        });
      }
    }
  }

  if (recipientTypes.includes("PARENT")) {
    const pEmails = (student.parentEmails || []).map(normEmail).filter(isRealEmail);
    const pName = student.fatherName || student.motherName || "Parent / Guardian";
    for (const e of pEmails) {
      if (!targetEmails.has(e)) {
        targetEmails.add(e);
        recipientObjects.push({
          role: "PARENT",
          email: e,
          name: pName,
          phone: student.parentPhones?.[0] || "",
        });
      }
    }
  }

  if (recipientObjects.length === 0) {
    throw new Error(`No valid real email addresses found for ${student.fullName}. Check student and parent email fields.`);
  }

  // Construct personalized message
  const settings = getCachedInstituteSettings();
  const sanitizedPersonalNote = params.customMessage
    ? params.customMessage.replace(/[<>]/g, "").trim()
    : "Believe in yourself and your preparation. You have worked hard, and we know you will do great!";

  const subject = `🍀 Best of Luck on Your ${courseName} Exam, ${student.fullName}! — Top Grade Learning`;

  const emailBody =
    `Dear ${student.fullName},\n\n` +
    `On behalf of everyone at Top Grade Learning, we want to wish you the absolute best on your upcoming ${courseName} exam scheduled for ${examDate}!\n\n` +
    `A message from your instructor and academic team:\n"${sanitizedPersonalNote}"\n\n` +
    `Stay calm, read each question carefully, and trust the preparation you have put in.\n\n` +
    `Warm regards,\n` +
    `${settings.institute_name} Team\n` +
    `${settings.phone || ""}`;

  await dispatchMultiChannelNotification({
    eventType: "ADMISSION_APPROVED", // Maps to EXAM_WISH in log
    subject,
    message: emailBody,
    escapeMessage: true,
    recipients: recipientObjects,
  });

  return {
    success: true,
    sentCount: recipientObjects.length,
    recipients: Array.from(targetEmails),
    message: `Exam wishes dispatched successfully to ${Array.from(targetEmails).join(", ")}.`,
  };
}
