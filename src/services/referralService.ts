import crypto from "node:crypto";
import { supabaseAdmin } from "../supabase.js";
import { normEmail } from "./studentAccounts.js";

export interface ReferralCodeRow {
  id: string;
  parent_email: string;
  parent_name: string;
  code: string;
  created_at: string;
  updated_at: string;
}

export interface ReferralRow {
  id: string;
  referrer_email: string;
  referrer_name: string;
  referral_code: string;
  referred_student_id: string;
  referred_student_name: string;
  referred_student_code: string;
  status: "registered" | "enrolled";
  reward_notes: string;
  created_at: string;
  updated_at: string;
}

// In-memory persistent caches for offline/unmigrated fallback
const inMemoryReferralCodes = new Map<string, ReferralCodeRow>(); // key: lower(email)
const inMemoryReferralCodesByCode = new Map<string, ReferralCodeRow>(); // key: code
const inMemoryReferrals = new Map<string, ReferralRow>(); // key: id

/**
 * Generates a cryptographically unguessable, high-entropy referral code.
 * Example: REF-9D8F2A7B (32 bits of cryptographic entropy = >4.29 billion possibilities)
 */
export function generateUniqueReferralCode(): string {
  const bytes = crypto.randomBytes(4).toString("hex").toUpperCase();
  return `REF-${bytes}`;
}

/**
 * Gets or creates a random, unique referral code for a parent.
 * Visible only to the owning parent and admin.
 */
export async function getOrCreateParentReferralCode(
  parentEmail: string,
  parentName = ""
): Promise<ReferralCodeRow> {
  const cleanEmail = normEmail(parentEmail);
  if (!cleanEmail) {
    throw new Error("A valid parent email is required to retrieve or generate a referral code.");
  }

  // Check cache first
  const cached = inMemoryReferralCodes.get(cleanEmail);
  if (cached) return cached;

  // Check Supabase
  try {
    const { data, error } = await supabaseAdmin
      .from("referral_codes")
      .select("*")
      .eq("parent_email", cleanEmail)
      .maybeSingle();

    if (!error && data) {
      const row: ReferralCodeRow = {
        id: data.id,
        parent_email: data.parent_email,
        parent_name: data.parent_name || parentName,
        code: data.code,
        created_at: data.created_at,
        updated_at: data.updated_at
      };
      inMemoryReferralCodes.set(cleanEmail, row);
      inMemoryReferralCodesByCode.set(row.code, row);
      return row;
    }
  } catch (err: any) {
    console.warn("Notice querying referral_codes:", err?.message);
  }

  // Generate a new unique code that cannot be guessed
  let newCode = generateUniqueReferralCode();
  while (inMemoryReferralCodesByCode.has(newCode)) {
    newCode = generateUniqueReferralCode();
  }

  const nowIso = new Date().toISOString();
  const newRow: ReferralCodeRow = {
    id: `refcode-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    parent_email: cleanEmail,
    parent_name: (parentName || cleanEmail.split("@")[0] || "Parent"),
    code: newCode,
    created_at: nowIso,
    updated_at: nowIso
  };

  inMemoryReferralCodes.set(cleanEmail, newRow);
  inMemoryReferralCodesByCode.set(newCode, newRow);

  // Attempt DB persistence
  try {
    const { data: inserted, error: insertErr } = await supabaseAdmin
      .from("referral_codes")
      .insert({
        parent_email: newRow.parent_email,
        parent_name: newRow.parent_name,
        code: newRow.code,
        created_at: newRow.created_at,
        updated_at: newRow.updated_at
      })
      .select()
      .maybeSingle();

    if (!insertErr && inserted) {
      newRow.id = inserted.id;
    }
  } catch (err: any) {
    console.warn("Notice inserting referral_code:", err?.message);
  }

  return newRow;
}

/**
 * Validates whether a given referral code exists and returns the referrer details.
 */
export async function validateReferralCode(
  code: string
): Promise<{ valid: boolean; referrerName?: string; referrer?: { email: string; name: string; code: string } }> {
  const cleanCode = (code || "").trim().toUpperCase();
  if (!cleanCode) return { valid: false };

  // Check in-memory first
  const cached = inMemoryReferralCodesByCode.get(cleanCode);
  if (cached) {
    return {
      valid: true,
      referrerName: cached.parent_name,
      referrer: {
        email: cached.parent_email,
        name: cached.parent_name,
        code: cached.code
      }
    };
  }

  // Check Supabase
  try {
    const { data, error } = await supabaseAdmin
      .from("referral_codes")
      .select("*")
      .eq("code", cleanCode)
      .maybeSingle();

    if (!error && data) {
      const row: ReferralCodeRow = {
        id: data.id,
        parent_email: data.parent_email,
        parent_name: data.parent_name || "",
        code: data.code,
        created_at: data.created_at,
        updated_at: data.updated_at
      };
      inMemoryReferralCodes.set(normEmail(row.parent_email), row);
      inMemoryReferralCodesByCode.set(cleanCode, row);
      return {
        valid: true,
        referrerName: row.parent_name,
        referrer: {
          email: row.parent_email,
          name: row.parent_name,
          code: row.code
        }
      };
    }
  } catch (err: any) {
    console.warn("Notice validating referral code in DB:", err?.message);
  }

  return { valid: false };
}

export interface RecordReferralParams {
  referralCode: string;
  studentId?: string | undefined;
  studentName?: string | undefined;
  studentCode?: string | undefined;
  isEnrolled?: boolean | undefined;
  referredStudentId?: string | undefined;
  referredStudentName?: string | undefined;
  referredStudentEmail?: string | undefined;
  referredStudentCode?: string | undefined;
  status?: "registered" | "enrolled" | undefined;
}

/**
 * Records a referral when a student registers with a referral code.
 */
export async function recordReferral(params: RecordReferralParams): Promise<ReferralRow | null> {
  const validation = await validateReferralCode(params.referralCode);
  if (!validation.valid || !validation.referrer) {
    return null;
  }

  const cleanCode = params.referralCode.trim().toUpperCase();
  const nowIso = new Date().toISOString();
  const referralId = `ref-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;

  const studentId = params.studentId || params.referredStudentId || `stu-${Date.now()}`;
  const studentName = params.studentName || params.referredStudentName || "New Student";
  const rawCode = params.studentCode || params.referredStudentCode;
  const studentCode = rawCode || `TG-${studentId.slice(0, 6)}`;
  const status: "registered" | "enrolled" = params.status || (params.isEnrolled ? "enrolled" : "registered");

  const referralRow: ReferralRow = {
    id: referralId,
    referrer_email: validation.referrer.email,
    referrer_name: validation.referrer.name,
    referral_code: cleanCode,
    referred_student_id: studentId,
    referred_student_name: studentName,
    referred_student_code: studentCode,
    status: status,
    reward_notes: "",
    created_at: nowIso,
    updated_at: nowIso
  };

  inMemoryReferrals.set(referralId, referralRow);

  try {
    const { data, error } = await supabaseAdmin
      .from("referrals")
      .insert({
        referrer_email: referralRow.referrer_email,
        referrer_name: referralRow.referrer_name,
        referral_code: referralRow.referral_code,
        referred_student_id: referralRow.referred_student_id,
        referred_student_name: referralRow.referred_student_name,
        referred_student_code: referralRow.referred_student_code,
        status: referralRow.status,
        reward_notes: referralRow.reward_notes,
        created_at: referralRow.created_at,
        updated_at: referralRow.updated_at
      })
      .select()
      .maybeSingle();

    if (!error && data) {
      referralRow.id = data.id;
    }
  } catch (err: any) {
    console.warn("Notice saving referral in DB:", err?.message);
  }

  return referralRow;
}

/**
 * Lists all referrals for the Admin Referrals page.
 * Lists referrers, referred students, and status (registered, enrolled).
 */
export async function listAllReferrals(filters?: {
  status?: string;
  search?: string;
}): Promise<ReferralRow[]> {
  let list: ReferralRow[] = [];

  try {
    let query = supabaseAdmin.from("referrals").select("*").order("created_at", { ascending: false });
    if (filters?.status && filters.status !== "ALL") {
      query = query.eq("status", filters.status.toLowerCase());
    }
    const { data, error } = await query;
    if (!error && data && data.length > 0) {
      list = data.map((d: any) => ({
        id: d.id,
        referrer_email: d.referrer_email,
        referrer_name: d.referrer_name || "",
        referral_code: d.referral_code,
        referred_student_id: d.referred_student_id,
        referred_student_name: d.referred_student_name || "",
        referred_student_code: d.referred_student_code || "",
        status: (d.status || "registered").toLowerCase() as "registered" | "enrolled",
        reward_notes: d.reward_notes || "",
        created_at: d.created_at,
        updated_at: d.updated_at
      }));
    }
  } catch (err: any) {
    console.warn("Notice loading referrals from DB:", err?.message);
  }

  // Merge in-memory items
  for (const item of inMemoryReferrals.values()) {
    if (!list.some(r => r.id === item.id)) {
      list.push(item);
    }
  }

  // Apply search filtering
  if (filters?.search) {
    const q = filters.search.toLowerCase().trim();
    list = list.filter(
      r =>
        r.referrer_name.toLowerCase().includes(q) ||
        r.referrer_email.toLowerCase().includes(q) ||
        r.referred_student_name.toLowerCase().includes(q) ||
        r.referred_student_code.toLowerCase().includes(q) ||
        r.referral_code.toLowerCase().includes(q) ||
        r.reward_notes.toLowerCase().includes(q)
    );
  }

  if (filters?.status && filters.status !== "ALL") {
    list = list.filter(r => r.status === filters.status?.toLowerCase());
  }

  return list.sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime());
}

/**
 * Lists referrals for a specific parent (visible ONLY to the owning parent and admin).
 */
export async function listReferralsForParent(parentEmail: string): Promise<ReferralRow[]> {
  const cleanEmail = normEmail(parentEmail);
  if (!cleanEmail) return [];

  const all = await listAllReferrals();
  return all.filter(r => normEmail(r.referrer_email) === cleanEmail);
}

/**
 * Updates a referral's status to 'enrolled' when a student enrolls in a course/schedule.
 */
export async function updateReferralStatusToEnrolled(studentId: string): Promise<void> {
  if (!studentId) return;

  for (const ref of inMemoryReferrals.values()) {
    if (ref.referred_student_id === studentId && ref.status === "registered") {
      ref.status = "enrolled";
      ref.updated_at = new Date().toISOString();
    }
  }

  try {
    await supabaseAdmin
      .from("referrals")
      .update({ status: "enrolled", updated_at: new Date().toISOString() })
      .eq("referred_student_id", studentId);
  } catch (err: any) {
    console.warn("Notice updating referral status in DB:", err?.message);
  }
}

/**
 * Updates reward notes for a referral (Admin only, NO money logic).
 */
export async function updateReferralRewardNotes(
  referralId: string,
  rewardNotes: string
): Promise<ReferralRow> {
  const nowIso = new Date().toISOString();
  let row = inMemoryReferrals.get(referralId);

  if (row) {
    row.reward_notes = rewardNotes;
    row.updated_at = nowIso;
  }

  try {
    const { data, error } = await supabaseAdmin
      .from("referrals")
      .update({ reward_notes: rewardNotes, updated_at: nowIso })
      .eq("id", referralId)
      .select()
      .maybeSingle();

    if (!error && data) {
      row = {
        id: data.id,
        referrer_email: data.referrer_email,
        referrer_name: data.referrer_name,
        referral_code: data.referral_code,
        referred_student_id: data.referred_student_id,
        referred_student_name: data.referred_student_name,
        referred_student_code: data.referred_student_code,
        status: data.status,
        reward_notes: data.reward_notes,
        created_at: data.created_at,
        updated_at: data.updated_at
      };
      inMemoryReferrals.set(referralId, row);
    }
  } catch (err: any) {
    console.warn("Notice updating referral reward in DB:", err?.message);
  }

  if (!row) {
    throw new Error(`Referral with ID ${referralId} not found.`);
  }

  return row;
}

export const referralService = {
  generateUniqueReferralCode,
  getOrCreateReferralCode: (a: string, b?: string, c?: string) => {
    if (c !== undefined) {
      return getOrCreateParentReferralCode(b || "", c || "");
    }
    return getOrCreateParentReferralCode(a, b || "");
  },
  getOrCreateParentReferralCode,
  validateReferralCode,
  recordReferral,
  recordStudentReferral: (code: string, studentId: string, studentName: string, studentEmail?: string, status: "registered" | "enrolled" = "registered") =>
    recordReferral({ referralCode: code, referredStudentId: studentId, referredStudentName: studentName, referredStudentEmail: studentEmail, status }),
  listAllReferrals,
  getParentReferrals: listReferralsForParent,
  listReferralsForParent,
  updateReferralStatusToEnrolled,
  updateReferralReward: (referralId: string, notes: string, _adminUserId?: string) =>
    updateReferralRewardNotes(referralId, notes),
  updateReferralRewardNotes
};
