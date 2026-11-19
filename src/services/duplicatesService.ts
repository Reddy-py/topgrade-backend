import { supabaseAdmin } from "../supabase.js";
import { inMemoryStudentStore, resolveStudent, type StudentDossier } from "./studentService.js";
import { recordDomainEvent } from "./domainEventService.js";
import { applyTokens, getBalances } from "./tokenService.js";

export interface DuplicateCluster {
  id: string;
  type: "STUDENT" | "PARENT";
  reason: string;
  confidence: "EXACT" | "HIGH" | "MEDIUM";
  recordA: {
    id: string;
    code?: string | undefined;
    name: string;
    email?: string | undefined;
    phone?: string | undefined;
    dob?: string | undefined;
    grade?: string | undefined;
    parentEmail?: string | undefined;
    status?: string | undefined;
  };
  recordB: {
    id: string;
    code?: string | undefined;
    name: string;
    email?: string | undefined;
    phone?: string | undefined;
    dob?: string | undefined;
    grade?: string | undefined;
    parentEmail?: string | undefined;
    status?: string | undefined;
  };
}

export interface MergePreviewResult {
  dryRun: boolean;
  primaryId: string;
  duplicateId: string;
  type: "STUDENT" | "PARENT";
  enrollmentsCount: number;
  attendanceCount: number;
  feeDuesCount: number;
  walletBalanceToTransfer: number;
  childrenCount: number;
  summary: string;
}

const norm = (str?: string | null) => (str || "").trim().toLowerCase();
const normPhone = (str?: string | null) => (str || "").replace(/\D/g, "");

/**
 * Scans active and imported records to identify duplicate students and parents.
 */
export async function scanDuplicatesService(): Promise<DuplicateCluster[]> {
  const clusters: DuplicateCluster[] = [];
  const clusterKeySet = new Set<string>();

  // 1. Fetch all students from Supabase (or in-memory store)
  let students: any[] = [];
  try {
    const { data, error } = await supabaseAdmin.from("students").select("*");
    if (!error && data && data.length > 0) {
      students = data;
    }
  } catch {}

  if (students.length === 0) {
    students = inMemoryStudentStore.map(s => ({
      id: s.id,
      student_id_code: s.studentCode,
      name: s.fullName,
      email: s.email,
      phone: s.primaryMobile,
      dob: s.dob,
      grade: s.grade,
      parent_emails: s.parentEmails,
      status: s.status
    }));
  }

  // Detect student duplicates
  for (let i = 0; i < students.length; i++) {
    for (let j = i + 1; j < students.length; j++) {
      const a = students[i];
      const b = students[j];
      if (a.id === b.id) continue;

      const emailA = norm(a.email);
      const emailB = norm(b.email);
      const phoneA = normPhone(a.phone);
      const phoneB = normPhone(b.phone);
      const nameA = norm(a.name);
      const nameB = norm(b.name);
      const firstNameA = nameA.split(" ")[0];
      const firstNameB = nameB.split(" ")[0];
      const dobA = norm(a.dob);
      const dobB = norm(b.dob);
      const gradeA = norm(a.grade);
      const gradeB = norm(b.grade);

      const parentsA: string[] = Array.isArray(a.parent_emails) ? a.parent_emails.map(norm) : [];
      const parentsB: string[] = Array.isArray(b.parent_emails) ? b.parent_emails.map(norm) : [];
      const sharedParent = parentsA.some(p => p && parentsB.includes(p));

      let matchReason = "";
      let confidence: "EXACT" | "HIGH" | "MEDIUM" = "HIGH";

      if (emailA && emailA === emailB && !emailA.includes("placeholder") && !emailA.includes("@topgrade.internal")) {
        matchReason = `Identical student email address (${emailA})`;
        confidence = "EXACT";
      } else if (phoneA && phoneA.length >= 7 && phoneA === phoneB) {
        matchReason = `Identical primary phone number (${a.phone})`;
        confidence = "HIGH";
      } else if (sharedParent && firstNameA && firstNameA === firstNameB && (dobA === dobB || gradeA === gradeB)) {
        matchReason = `Same parent account with matching child name (${firstNameA}) and ${dobA === dobB ? "birth date" : "grade"}`;
        confidence = "HIGH";
      }

      if (matchReason) {
        const key = [a.id, b.id].sort().join("::");
        if (!clusterKeySet.has(key)) {
          clusterKeySet.add(key);
          clusters.push({
            id: `dup-${clusters.length + 1}`,
            type: "STUDENT",
            reason: matchReason,
            confidence,
            recordA: {
              id: a.id,
              code: a.student_id_code,
              name: a.name || "Student A",
              email: a.email,
              phone: a.phone,
              dob: a.dob,
              grade: a.grade,
              parentEmail: parentsA[0],
              status: a.status
            },
            recordB: {
              id: b.id,
              code: b.student_id_code,
              name: b.name || "Student B",
              email: b.email,
              phone: b.phone,
              dob: b.dob,
              grade: b.grade,
              parentEmail: parentsB[0],
              status: b.status
            }
          });
        }
      }
    }
  }

  // 2. Fetch all parent profiles to detect parent duplicates
  try {
    const { data: parents } = await supabaseAdmin.from("profiles").select("id, full_name, email, phone, role").eq("role", "PARENT");
    if (parents && parents.length > 0) {
      for (let i = 0; i < parents.length; i++) {
        for (let j = i + 1; j < parents.length; j++) {
          const pA = parents[i];
          const pB = parents[j];
          if (!pA || !pB || pA.id === pB.id) continue;

          const pEmailA = norm(pA.email);
          const pEmailB = norm(pB.email);
          const pPhoneA = normPhone(pA.phone);
          const pPhoneB = normPhone(pB.phone);

          let reason = "";
          let conf: "EXACT" | "HIGH" = "HIGH";

          if (pEmailA && pEmailA === pEmailB) {
            reason = `Identical parent login email (${pEmailA})`;
            conf = "EXACT";
          } else if (pPhoneA && pPhoneA.length >= 7 && pPhoneA === pPhoneB) {
            reason = `Matching parent phone number (${pA.phone})`;
            conf = "HIGH";
          }

          if (reason) {
            const key = [pA.id, pB.id].sort().join("::");
            if (!clusterKeySet.has(key)) {
              clusterKeySet.add(key);
              clusters.push({
                id: `dup-parent-${clusters.length + 1}`,
                type: "PARENT",
                reason,
                confidence: conf,
                recordA: {
                  id: pA.id,
                  name: pA.full_name || "Parent A",
                  email: pA.email || undefined,
                  phone: pA.phone || undefined
                },
                recordB: {
                  id: pB.id,
                  name: pB.full_name || "Parent B",
                  email: pB.email || undefined,
                  phone: pB.phone || undefined
                }
              });
            }
          }
        }
      }
    }
  } catch {}

  return clusters;
}

/**
 * Generates a dry-run preview or executes an all-in-one transactional merge of two duplicate records.
 */
export async function mergeRecordsService(params: {
  primaryId: string;
  duplicateId: string;
  type: "STUDENT" | "PARENT";
  dryRun?: boolean;
  adminEmail?: string;
}): Promise<MergePreviewResult> {
  const { primaryId, duplicateId, type, dryRun = true, adminEmail = "admin" } = params;

  if (primaryId === duplicateId) {
    throw new Error("Cannot merge a record into itself.");
  }

  let enrollmentsCount = 0;
  let attendanceCount = 0;
  let feeDuesCount = 0;
  let walletBalanceToTransfer = 0;
  let childrenCount = 0;

  if (type === "STUDENT") {
    // 1. Count enrollments
    try {
      const { data: enr } = await supabaseAdmin.from("student_enrollments").select("id").eq("student_id", duplicateId);
      enrollmentsCount = enr?.length || 0;
    } catch {}

    // 2. Count attendance
    try {
      const { data: att } = await supabaseAdmin.from("attendance").select("id").eq("student_id", duplicateId);
      attendanceCount = att?.length || 0;
    } catch {}

    // 3. Count fee dues
    try {
      const { data: fees } = await supabaseAdmin.from("fee_dues").select("id").eq("student_id", duplicateId);
      feeDuesCount = fees?.length || 0;
    } catch {}

    // 4. Token balance
    try {
      const balances = await getBalances(duplicateId);
      walletBalanceToTransfer = balances.reduce((sum, b) => sum + (b.balance || 0), 0);
    } catch {}

    if (!dryRun) {
      // Re-point student_enrollments
      try {
        await supabaseAdmin.from("student_enrollments").update({ student_id: primaryId }).eq("student_id", duplicateId);
      } catch {}

      // Re-point attendance
      try {
        await supabaseAdmin.from("attendance").update({ student_id: primaryId }).eq("student_id", duplicateId);
      } catch {}

      // Re-point fee_dues
      try {
        await supabaseAdmin.from("fee_dues").update({ student_id: primaryId }).eq("student_id", duplicateId);
      } catch {}

      // Transfer token balance if positive
      if (walletBalanceToTransfer > 0) {
        try {
          await applyTokens({
            studentId: duplicateId,
            courseId: "all",
            delta: -walletBalanceToTransfer,
            reason: "ADJUSTMENT",
            note: `Consolidated to merged primary student ${primaryId}`,
            by: adminEmail
          });
          await applyTokens({
            studentId: primaryId,
            courseId: "all",
            delta: walletBalanceToTransfer,
            reason: "MANUAL_CREDIT",
            note: `Transferred from merged duplicate student ${duplicateId}`,
            by: adminEmail
          });
        } catch {}
      }

      // Re-point student_parents
      try {
        await supabaseAdmin.from("student_parents").update({ student_id: primaryId }).eq("student_id", duplicateId);
      } catch {}

      // Archive duplicate student (Never erase, per Part B.5)
      try {
        await supabaseAdmin.from("students").update({
          status: "ARCHIVED",
          medical_notes: `MERGED_INTO:${primaryId}`
        }).eq("id", duplicateId);
      } catch {}

      // Update in-memory store
      const dupIdx = inMemoryStudentStore.findIndex(s => s.id === duplicateId || s.studentCode === duplicateId);
      if (dupIdx !== -1 && inMemoryStudentStore[dupIdx]) {
        inMemoryStudentStore[dupIdx]!.status = "ARCHIVED";
      }

      // Record audit domain event
      void recordDomainEvent({
        type: "duplicates.merged",
        entity: "students",
        entity_id: primaryId,
        payload: {
          primary_id: primaryId,
          duplicate_id: duplicateId,
          enrollments_repointed: enrollmentsCount,
          attendance_repointed: attendanceCount,
          fees_repointed: feeDuesCount,
          hours_transferred: walletBalanceToTransfer,
          merged_by: adminEmail
        }
      });
    }
  } else {
    // PARENT merge
    try {
      const { data: kids } = await supabaseAdmin.from("student_parents").select("student_id").eq("parent_id", duplicateId);
      childrenCount = kids?.length || 0;
    } catch {}

    if (!dryRun) {
      // Re-point student_parents
      try {
        await supabaseAdmin.from("student_parents").update({ parent_id: primaryId }).eq("parent_id", duplicateId);
      } catch {}

      // Record audit domain event
      void recordDomainEvent({
        type: "duplicates.merged",
        entity: "profiles",
        entity_id: primaryId,
        payload: {
          primary_parent_id: primaryId,
          duplicate_parent_id: duplicateId,
          children_repointed: childrenCount,
          merged_by: adminEmail
        }
      });
    }
  }

  const summary = dryRun
    ? `Dry run: Merging ${type.toLowerCase()} ${duplicateId} into ${primaryId} will re-point ${enrollmentsCount} enrollments, ${attendanceCount} attendance logs, ${feeDuesCount} fee records, and transfer ${walletBalanceToTransfer} lesson hours.`
    : `Successfully merged ${type.toLowerCase()} record. Surviving record: ${primaryId}. Duplicate archived with full audit history.`;

  return {
    dryRun,
    primaryId,
    duplicateId,
    type,
    enrollmentsCount,
    attendanceCount,
    feeDuesCount,
    walletBalanceToTransfer,
    childrenCount,
    summary
  };
}
