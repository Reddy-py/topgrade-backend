import express from "express";
import { supabaseAdmin } from "../supabase.js";
import { requireRoles, type AuthenticatedRequest } from "../middleware/auth.js";
import { generateSequentialCode } from "../utils/idGenerator.js";
import { recordDomainEvent } from "../services/domainEventService.js";
import {
  ensureLogin,
  fallbackLoginEmailForCode,
  getDefaultInitialPassword,
  isValidEmail,
  normEmail
} from "../services/studentAccounts.js";

const router = express.Router();

async function ensureParentAuthAccount(params: {
  parentIdCode: string;
  name: string;
  email?: string | null;
  phone?: string | null;
  resetPassword?: boolean;
}) {
  const defaultPw = getDefaultInitialPassword();
  const rawEmail = normEmail(params.email);
  const loginEmail = rawEmail && isValidEmail(rawEmail)
    ? rawEmail
    : fallbackLoginEmailForCode(params.parentIdCode);

  const res = await ensureLogin({
    email: loginEmail,
    fullName: params.name || `Parent ${params.parentIdCode}`,
    role: "PARENT",
    phone: params.phone || undefined,
    initialPassword: defaultPw,
    mustChangePassword: true,
    metadata: { parent_id_code: params.parentIdCode }
  });

  if (params.resetPassword && res.userId && !res.created) {
    await supabaseAdmin.auth.admin.updateUserById(res.userId, {
      password: defaultPw,
      user_metadata: {
        full_name: params.name,
        role: "PARENT",
        parent_id_code: params.parentIdCode
      }
    }).catch(() => undefined);
  }

  return { userId: res.userId, loginEmail, created: res.created };
}

/**
 * GET /api/parents
 * List all parents (with sequential TGP001 IDs and linked students)
 */
router.get("/", async (_req, res): Promise<any> => {
  try {
    const [{ data: parentRows, error: pErr }, { data: studentRows }] = await Promise.all([
      supabaseAdmin.from("parents").select("*").order("parent_id_code", { ascending: true }),
      supabaseAdmin.from("students").select("id, name, student_id_code, email, parent_emails, father_name, mother_name, guardian, father_phone, phone, status")
    ]);

    if (pErr && !pErr.message.includes("does not exist")) {
      return res.status(500).json({ success: false, message: pErr.message });
    }

    const parents = (parentRows || []) as any[];
    const students = (studentRows || []) as any[];

    const enriched = parents.map((p) => {
      const pEmail = normEmail(p.email);
      const pName = String(p.name || "").trim().toLowerCase();
      const linkedStudents = students.filter((s) => {
        const sParentEmails = Array.isArray(s.parent_emails) ? s.parent_emails.map(normEmail) : [];
        if (pEmail && !pEmail.endsWith("@login.topgrade.local") && sParentEmails.includes(pEmail)) {
          return true;
        }
        if (pName && (
          String(s.father_name || "").trim().toLowerCase() === pName ||
          String(s.mother_name || "").trim().toLowerCase() === pName ||
          String(s.guardian || "").trim().toLowerCase() === pName
        )) {
          return true;
        }
        return false;
      });

      const isSyntheticEmail = !pEmail || pEmail.endsWith("@login.topgrade.local");
      const code = p.parent_id_code || `TGP-${String(p.id).slice(0, 4).toUpperCase()}`;

      return {
        id: p.id,
        parent_id_code: code,
        profile_id: p.profile_id || null,
        name: p.name || "Parent / Guardian",
        email: isSyntheticEmail ? "" : p.email,
        login_username: isSyntheticEmail ? code : p.email,
        phone: p.phone || "",
        created_at: p.created_at,
        linked_students: linkedStudents.map((s) => ({
          id: s.id,
          name: s.name,
          student_code: s.student_id_code,
          status: s.status
        }))
      };
    });

    return res.json({ success: true, count: enriched.length, data: enriched });
  } catch (err: any) {
    return res.status(500).json({ success: false, message: err?.message || "Failed to load parents." });
  }
});

/**
 * POST /api/parents
 * Admin creates a new Parent record with sequential TGP001 ID and default login
 */
router.post("/", requireRoles("ADMIN"), async (req: AuthenticatedRequest, res): Promise<any> => {
  try {
    const { name, email, phone } = req.body || {};
    if (!name || !String(name).trim()) {
      return res.status(400).json({ success: false, message: "Parent name is required." });
    }

    const parentIdCode = await generateSequentialCode("parents", "parent_id_code", "TGP", 3);
    const cleanEmail = normEmail(email);
    const storedEmail = cleanEmail && isValidEmail(cleanEmail)
      ? cleanEmail
      : fallbackLoginEmailForCode(parentIdCode);

    let profileId: string | null = null;
    try {
      const authRes = await ensureParentAuthAccount({
        parentIdCode,
        name: String(name).trim(),
        email: cleanEmail,
        phone: phone ? String(phone).trim() : null
      });
      profileId = authRes.userId;
    } catch (authErr: any) {
      return res.status(400).json({ success: false, message: authErr?.message || "Could not create parent login." });
    }

    const { data: inserted, error } = await supabaseAdmin
      .from("parents")
      .insert({
        parent_id_code: parentIdCode,
        profile_id: profileId,
        name: String(name).trim(),
        email: storedEmail,
        phone: phone ? String(phone).trim() : null
      })
      .select()
      .single();

    if (error) {
      return res.status(500).json({ success: false, message: error.message });
    }

    void recordDomainEvent({
      type: "parent.updated",
      entity: "parent",
      entity_id: inserted.id,
      payload: {
        parent_id_code: parentIdCode,
        parent_name: inserted.name,
        parent_email: cleanEmail || parentIdCode,
        summary: `Parent ${inserted.name} (${parentIdCode}) created`,
        actor: req.user?.email || "Admin"
      }
    });

    return res.status(201).json({
      success: true,
      message: `Parent '${inserted.name}' (${parentIdCode}) created successfully.`,
      data: inserted
    });
  } catch (err: any) {
    return res.status(500).json({ success: false, message: err?.message || "Failed to create parent." });
  }
});

/**
 * PUT /api/parents/:id
 * Admin updates Parent record & syncs login/history
 */
router.put("/:id", requireRoles("ADMIN"), async (req: AuthenticatedRequest, res): Promise<any> => {
  try {
    const id = String(req.params.id);
    const { name, email, phone } = req.body || {};

    const { data: existing, error: fetchErr } = await supabaseAdmin
      .from("parents")
      .select("*")
      .or(`id.eq.${id},parent_id_code.eq.${id}`)
      .maybeSingle();

    if (fetchErr || !existing) {
      return res.status(404).json({ success: false, message: "Parent record not found." });
    }

    const parentIdCode = existing.parent_id_code || await generateSequentialCode("parents", "parent_id_code", "TGP", 3);
    const nextName = name !== undefined ? String(name).trim() : existing.name;
    const rawEmail = email !== undefined ? normEmail(email) : normEmail(existing.email);
    const nextEmail = rawEmail && isValidEmail(rawEmail) ? rawEmail : fallbackLoginEmailForCode(parentIdCode);
    const nextPhone = phone !== undefined ? (String(phone).trim() || null) : existing.phone;

    const { data: updated, error: updErr } = await supabaseAdmin
      .from("parents")
      .update({
        parent_id_code: parentIdCode,
        name: nextName,
        email: nextEmail,
        phone: nextPhone
      })
      .eq("id", existing.id)
      .select()
      .single();

    if (updErr) {
      return res.status(500).json({ success: false, message: updErr.message });
    }

    try {
      await ensureParentAuthAccount({
        parentIdCode,
        name: nextName,
        email: nextEmail,
        phone: nextPhone
      });
    } catch {}

    void recordDomainEvent({
      type: "parent.updated",
      entity: "parent",
      entity_id: existing.id,
      payload: {
        parent_id_code: parentIdCode,
        parent_name: nextName,
        parent_email: nextEmail.endsWith("@login.topgrade.local") ? parentIdCode : nextEmail,
        parent_phone: nextPhone || "",
        summary: `Parent ${nextName} (${parentIdCode}) updated`,
        actor: req.user?.email || "Admin"
      }
    });

    return res.json({ success: true, message: `Parent (${parentIdCode}) updated successfully.`, data: updated });
  } catch (err: any) {
    return res.status(500).json({ success: false, message: err?.message || "Failed to update parent." });
  }
});

/**
 * POST /api/parents/sync-logins
 * Admin bulk-standardizes all Teachers, Students, and Parents logins to email (or ID fallback) + DEFAULT_INITIAL_PASSWORD.
 */
router.post("/sync-logins", requireRoles("ADMIN"), async (_req: AuthenticatedRequest, res): Promise<any> => {
  try {
    const defaultPw = getDefaultInitialPassword();
    const summary = { teachers: 0, students: 0, parents: 0, errors: [] as string[] };

    // 1. Teachers: email + DEFAULT_INITIAL_PASSWORD
    const { data: teachers } = await supabaseAdmin.from("teachers").select("id, name, email, phone, teacher_id_code, user_id");
    for (const t of (teachers || []) as any[]) {
      const em = normEmail(t.email);
      if (!em || !isValidEmail(em)) continue;
      try {
        const login = await ensureLogin({
          email: em,
          fullName: t.name || "Teacher",
          role: "TEACHER",
          phone: t.phone || undefined,
          initialPassword: defaultPw,
          metadata: { teacher_id_code: t.teacher_id_code }
        });
        await supabaseAdmin.auth.admin.updateUserById(login.userId, { password: defaultPw }).catch(() => undefined);
        if (!t.user_id) {
          await supabaseAdmin.from("teachers").update({ user_id: login.userId }).eq("id", t.id);
        }
        summary.teachers++;
      } catch (e: any) {
        summary.errors.push(`Teacher ${t.teacher_id_code || t.name}: ${e?.message}`);
      }
    }

    // 2. Students: email (or TGSTxxx fallback) + DEFAULT_INITIAL_PASSWORD
    const { data: students } = await supabaseAdmin.from("students").select("id, name, email, phone, student_id_code");
    for (const s of (students || []) as any[]) {
      const code = s.student_id_code || `TGST-${String(s.id).slice(0, 4)}`;
      const rawEm = normEmail(s.email);
      const loginEm = rawEm && isValidEmail(rawEm) ? rawEm : fallbackLoginEmailForCode(code);
      try {
        const login = await ensureLogin({
          email: loginEm,
          fullName: s.name || "Student",
          role: "STUDENT",
          phone: s.phone || undefined,
          initialPassword: defaultPw,
          metadata: { student_id: s.id, student_code: code }
        });
        await supabaseAdmin.auth.admin.updateUserById(login.userId, { password: defaultPw }).catch(() => undefined);
        summary.students++;
      } catch (e: any) {
        summary.errors.push(`Student ${code}: ${e?.message}`);
      }
    }

    // 3. Parents: email (or TGPxxx fallback) + DEFAULT_INITIAL_PASSWORD
    const { data: parents } = await supabaseAdmin.from("parents").select("id, name, email, phone, parent_id_code, profile_id");
    for (const p of (parents || []) as any[]) {
      const code = p.parent_id_code || `TGP-${String(p.id).slice(0, 4)}`;
      const rawEm = normEmail(p.email);
      const loginEm = rawEm && isValidEmail(rawEm) ? rawEm : fallbackLoginEmailForCode(code);
      try {
        const login = await ensureLogin({
          email: loginEm,
          fullName: p.name || `Parent ${code}`,
          role: "PARENT",
          phone: p.phone || undefined,
          initialPassword: defaultPw,
          metadata: { parent_id_code: code }
        });
        await supabaseAdmin.auth.admin.updateUserById(login.userId, { password: defaultPw }).catch(() => undefined);
        if (!p.profile_id) {
          await supabaseAdmin.from("parents").update({ profile_id: login.userId }).eq("id", p.id);
        }
        summary.parents++;
      } catch (e: any) {
        summary.errors.push(`Parent ${code}: ${e?.message}`);
      }
    }

    return res.json({
      success: true,
      message: `Synchronized logins with default password (${summary.teachers} teachers, ${summary.students} students, ${summary.parents} parents).`,
      summary
    });
  } catch (err: any) {
    return res.status(500).json({ success: false, message: err?.message || "Failed to sync logins." });
  }
});

export default router;
