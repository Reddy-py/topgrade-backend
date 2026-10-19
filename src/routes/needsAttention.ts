import type { Request, Response } from "express";

import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { supabaseAdmin } from "../supabase.js";
import { isPlaceholderEmail, displayEmail } from "../constants/domains.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const REPO_ROOT = path.resolve(__dirname, "../../..");
const EXPORTS_DIR = path.resolve(REPO_ROOT, "../private-exports");

export interface NeedsAttentionItem {
  id: string;
  category: string;
  categoryLabel: string;
  name: string;
  contactEmail: string;
  contactPhone: string;
  details: string;
  quickEditUrl: string;
}

export async function getNeedsAttentionData() {
  const items: NeedsAttentionItem[] = [];

  // 1. Fetch Students
  const { data: students, error: stuErr } = await supabaseAdmin
    .from("students")
    .select("id, student_id_code, name, first_name, last_name, dob, grade, school, notes, phone, email, parent_emails");

  if (!stuErr && students) {
    for (const s of students) {
      const studentId = s.id;
      const studentCode = s.student_id_code || s.id;
      const fullName = s.name || "Student";
      const quickEditUrl = `/app/students?edit=${encodeURIComponent(studentCode)}`;

      // Missing Last Name
      const lastName = (s.last_name || "").trim();
      const parts = (s.name || "").trim().split(/\s+/);
      const isMissingLastName = !lastName && parts.length <= 1;
      if (isMissingLastName) {
        items.push({
          id: `stu-ln-${studentId}`,
          category: "STUDENTS_MISSING_LAST_NAME",
          categoryLabel: "Student Missing Last Name",
          name: fullName,
          contactEmail: displayEmail(s.email),
          contactPhone: s.phone || "",
          details: "First name only recorded; last name is missing",
          quickEditUrl
        });
      }

      // Missing DOB
      if (!s.dob) {
        items.push({
          id: `stu-dob-${studentId}`,
          category: "STUDENTS_MISSING_DOB",
          categoryLabel: "Student Missing Date of Birth",
          name: fullName,
          contactEmail: displayEmail(s.email),
          contactPhone: s.phone || "",
          details: "Date of birth is not on file (birthday greetings disabled)",
          quickEditUrl
        });
      }

      // Missing Grade
      const grade = (s.grade || "").trim();
      if (!grade) {
        items.push({
          id: `stu-gr-${studentId}`,
          category: "STUDENTS_MISSING_GRADE",
          categoryLabel: "Student Missing Academic Grade",
          name: fullName,
          contactEmail: displayEmail(s.email),
          contactPhone: s.phone || "",
          details: "Academic grade is empty or unparseable",
          quickEditUrl
        });
      }

      // Missing School
      const school = (s.school || "").trim();
      if (!school) {
        items.push({
          id: `stu-sc-${studentId}`,
          category: "STUDENTS_MISSING_SCHOOL",
          categoryLabel: "Student Missing School Location",
          name: fullName,
          contactEmail: displayEmail(s.email),
          contactPhone: s.phone || "",
          details: "School affiliation is not recorded",
          quickEditUrl
        });
      }

      // Unmatched Course Text
      const notes = s.notes || "";
      if (notes.includes("Course from sheet:")) {
        const match = notes.match(/Course from sheet:\s*([^;]+)/i);
        const rawCourse = match ? match[1]?.trim() : notes;
        items.push({
          id: `stu-course-${studentId}`,
          category: "UNMATCHED_COURSE_TEXT",
          categoryLabel: "Unmatched Course Text",
          name: fullName,
          contactEmail: displayEmail(s.email),
          contactPhone: s.phone || "",
          details: `Requires mapping: "${rawCourse}"`,
          quickEditUrl
        });
      }

      // Grade Conflict from Duplicate Parent Merge
      if (notes.includes("Duplicate parent merge") || notes.includes("conflict")) {
        items.push({
          id: `stu-conflict-${studentId}`,
          category: "GRADE_CONFLICTS",
          categoryLabel: "Duplicate Merge Grade Conflict",
          name: fullName,
          contactEmail: displayEmail(s.email),
          contactPhone: s.phone || "",
          details: notes,
          quickEditUrl
        });
      }
    }
  }

  // 2. Fetch Parents & Profiles
  const { data: parents, error: parErr } = await supabaseAdmin
    .from("profiles")
    .select("id, full_name, email, phone, role")
    .eq("role", "PARENT");

  if (!parErr && parents) {
    for (const p of parents) {
      const email = p.email || "";
      const phone = (p.phone || "").trim();
      const parentName = p.full_name || "Parent";
      const isPlaceholder = isPlaceholderEmail(email);

      // Parent with no real email
      if (isPlaceholder) {
        const quickEditUrl = `/app/students?parentEdit=${encodeURIComponent(p.id)}`;
        if (!phone) {
          // Parent with NEITHER email NOR phone
          items.push({
            id: `par-no-contact-${p.id}`,
            category: "PARENTS_NO_EMAIL_NO_PHONE",
            categoryLabel: "Parent Without Email or Phone",
            name: parentName,
            contactEmail: "",
            contactPhone: "",
            details: "Account has neither email nor phone on file. Direct login is blocked until admin adds contact.",
            quickEditUrl
          });
        } else {
          // Parent with placeholder email (has phone)
          items.push({
            id: `par-placeholder-${p.id}`,
            category: "PARENTS_NO_REAL_EMAIL",
            categoryLabel: "Parent Without Real Email",
            name: parentName,
            contactEmail: "",
            contactPhone: phone,
            details: `Using placeholder login. Can sign in by phone: ${phone}`,
            quickEditUrl
          });
        }
      }
    }
  }

  // 3. Unresolved continuation rows from import report
  const reportPath = path.join(EXPORTS_DIR, "import-report.json");
  if (fs.existsSync(reportPath)) {
    try {
      const report = JSON.parse(fs.readFileSync(reportPath, "utf-8"));
      if (report?.unresolvedContinuations && Array.isArray(report.unresolvedContinuations)) {
        for (const unres of report.unresolvedContinuations) {
          items.push({
            id: `unres-row-${unres.rowNumber}`,
            category: "UNRESOLVED_CONTINUATION_ROWS",
            categoryLabel: "Unresolved Continuation Row",
            name: `Continuation Row #${unres.rowNumber}`,
            contactEmail: unres.hasEmail ? "Provided in import" : "",
            contactPhone: unres.hasPhone ? "Provided in import" : "",
            details: "Could not safely link to children or parent above. Created as standalone parent for privacy.",
            quickEditUrl: `/app/settings`
          });
        }
      }
    } catch {}
  }

  // Calculate summary counts
  const summaryCounts: Record<string, number> = {
    PARENTS_NO_REAL_EMAIL: 0,
    PARENTS_NO_EMAIL_NO_PHONE: 0,
    UNRESOLVED_CONTINUATION_ROWS: 0,
    GRADE_CONFLICTS: 0,
    STUDENTS_MISSING_LAST_NAME: 0,
    STUDENTS_MISSING_DOB: 0,
    STUDENTS_MISSING_GRADE: 0,
    STUDENTS_MISSING_SCHOOL: 0,
    UNMATCHED_COURSE_TEXT: 0,
    TOTAL: items.length
  };

  for (const item of items) {
    const cat = item.category as keyof typeof summaryCounts;
    if (summaryCounts[cat] !== undefined) {
      summaryCounts[cat]++;
    }
  }

  return {
    summaryCounts,
    totalCount: items.length,
    items
  };
}

export async function getNeedsAttentionHandler(_req: Request, res: Response) {
  try {
    const data = await getNeedsAttentionData();
    res.json({ success: true, ...data });
  } catch (err: any) {
    res.status(500).json({ success: false, message: err?.message || "Failed to fetch attention items." });
  }
}

export async function getNeedsAttentionSummaryHandler(_req: Request, res: Response) {
  try {
    const data = await getNeedsAttentionData();
    // Amendment: Return only summary counts on public/dashboard metrics, no personal data in logs
    res.json({
      success: true,
      totalCount: data.totalCount,
      summaryCounts: data.summaryCounts
    });
  } catch (err: any) {
    res.status(500).json({ success: false, message: err?.message || "Failed to fetch attention counts." });
  }
}

export async function exportNeedsAttentionCsvHandler(_req: Request, res: Response) {
  try {
    const data = await getNeedsAttentionData();
    const rows = [
      ["Category", "Name", "Contact Email", "Contact Phone", "Details", "Action Link"]
    ];

    for (const item of data.items) {
      rows.push([
        `"${item.categoryLabel.replace(/"/g, '""')}"`,
        `"${item.name.replace(/"/g, '""')}"`,
        `"${item.contactEmail.replace(/"/g, '""')}"`,
        `"${item.contactPhone.replace(/"/g, '""')}"`,
        `"${item.details.replace(/"/g, '""')}"`,
        `"${item.quickEditUrl.replace(/"/g, '""')}"`
      ]);
    }

    const csvContent = rows.map(r => r.join(",")).join("\n");
    res.setHeader("Content-Type", "text/csv");
    res.setHeader("Content-Disposition", 'attachment; filename="needs-attention-report.csv"');
    res.status(200).send(csvContent);
  } catch (err: any) {
    res.status(500).json({ success: false, message: err?.message || "Failed to generate CSV export." });
  }
}
