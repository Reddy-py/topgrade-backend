import { supabaseAdmin } from "../supabase.js";

const norm = (v: unknown): string => String(v ?? "").trim().toLowerCase();

/**
 * Who a teacher login is, so their data can be matched by exact id, code, login email or exact name.
 * (The old code matched on partial names, which could show one teacher another teacher's students.)
 */
export async function resolveTeacherIdentity(user: { id?: string | undefined; email?: string | undefined }): Promise<{ keys: Set<string>; names: Set<string> }> {
  const keys = new Set<string>();
  const names = new Set<string>();
  const email = norm(user.email);
  if (email) keys.add(email);
  if (user.id) keys.add(norm(user.id));

  try {
    const { data: teachers } = await supabaseAdmin
      .from("teachers")
      .select("id, teacher_id_code, name, email, user_id");
    for (const t of (teachers || []) as any[]) {
      const uid = norm(user.id);
      const isMatch = (uid && (norm(t.user_id) === uid || norm(t.id) === uid || norm(t.teacher_id_code) === uid || norm(t.email) === uid)) ||
                      (email && (norm(t.email) === email || norm(t.user_id) === email || norm(t.id) === email));
      if (isMatch) {
        [t.id, t.teacher_id_code, t.user_id, t.email].forEach(k => k && keys.add(norm(k)));
        if (t.name) names.add(norm(t.name));
      }
    }
  } catch (err: any) {
    console.warn("teacherIdentity lookup notice:", err?.message);
  }
  return { keys, names };
}

export interface TeacherRecord {
  id: string;
  code: string;
  name: string;
  email: string;
  status: string;
  availabilityDays: string[];
}

/** The teachers-table row for a teacher login (matched by user id or exact email), or null. */
export async function getTeacherRecord(user: { id?: string | undefined; email?: string | undefined }): Promise<TeacherRecord | null> {
  const email = norm(user.email);
  try {
    const { data } = await supabaseAdmin.from("teachers").select("*");
    for (const t of (data || []) as any[]) {
      if ((user.id && norm(t.user_id) === norm(user.id)) || (email && norm(t.email) === email)) {
        const days = t.availability_days ?? t.available_days ?? [];
        return {
          id: String(t.id),
          code: String(t.teacher_id_code || ""),
          name: String(t.name || ""),
          email: String(t.email || ""),
          status: String(t.status || "Active"),
          availabilityDays: Array.isArray(days) ? days.map((d: any) => String(d)) : [],
        };
      }
    }
  } catch (err: any) {
    console.warn("getTeacherRecord notice:", err?.message);
  }
  return null;
}
