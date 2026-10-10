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
      if ((user.id && norm(t.user_id) === norm(user.id)) || (email && norm(t.email) === email)) {
        [t.id, t.teacher_id_code, t.user_id].forEach(k => k && keys.add(norm(k)));
        if (t.name) names.add(norm(t.name));
      }
    }
  } catch (err: any) {
    console.warn("teacherIdentity lookup notice:", err?.message);
  }
  return { keys, names };
}
