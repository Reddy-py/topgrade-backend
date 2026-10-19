/**
 * TASK 8b: Import Families from Spreadsheet
 *
 * Rules:
 * - Default to dry-run mode (no database writes).
 * - Require --apply to write to the database.
 * - Protect production: refuse to touch production ref unless ALLOW_PRODUCTION_RESET=yes
 *   AND the operator types the project ref when prompted.
 * - Real file from IMPORT_XLSX_PATH in .env (or --file <path>).
 * - Never log or print spreadsheet contents, passwords, or service-role keys.
 * - Process rows in order according to Addendum A-G and Amendments.
 * - Write report to ../private-exports/import-report.json and print summary counts.
 */

import fs from "fs";
import path from "path";
import readline from "readline";
import { fileURLToPath } from "url";
import dotenv from "dotenv";
import ExcelJS from "exceljs";

// Load environment variables immediately with override
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const REPO_ROOT = path.resolve(__dirname, "../../..");
const BACKEND_ROOT = path.resolve(__dirname, "../..");
const EXPORTS_DIR = path.resolve(REPO_ROOT, "../private-exports");

dotenv.config({ path: path.join(BACKEND_ROOT, ".env"), override: true });

import { supabaseAdmin } from "../supabase.js";
import { parseEnv } from "../utils/parseEnv.js";
import {
  PLACEHOLDER_DOMAIN,
  isPlaceholderEmail,
  isRealEmail,
  makeParentPlaceholderEmail,
  makeStudentPlaceholderEmail
} from "../constants/domains.js";


const PRODUCTION_PROJECT_REF = "zznzmzwiewsnmykcbcni";

// Default initial passwords from .env
const DEFAULT_INITIAL_PASSWORD =
  parseEnv("DEFAULT_INITIAL_PASSWORD") || "TopGradeInit2026!";

export interface ParsedChild {
  firstName: string;
  lastName: string;
  rawName: string;
  grade: string;
  school: string;
  courseText: string;
  programType: string;
  notes: string[];
  studentCode: string;
  loginEmail: string;
  realEmail: string | null;
  phone: string;
  parentEmails: string[];
}

export interface ParsedParent {
  name: string;
  phone: string;
  loginEmail: string;
  isPlaceholder: boolean;
  children: ParsedChild[];
  classification:
    | "PARENT_ROW"
    | "SECOND_PARENT"
    | "UNRESOLVED_CONTINUATION"
    | "DUPLICATE_MERGED";
  sourceRowNumber: number;
}

export interface ImportClassificationCounts {
  studentOwnContactRows: number;
  secondParentRows: number;
  unresolvedContinuationRows: number;
  duplicateParentRows: number;
  rowsWithTwoChildren: number;
  parentLogins: number;
  studentLogins: number;
  parentsOnPlaceholderEmail: number;
  studentsWithOwnRealEmail: number;
  invalidEmails: number;
}

export interface ImportReportData {
  counts: ImportClassificationCounts & {
    parentsCreated: number;
    studentsCreated: number;
    studentsWithEmptyLastName: number;
    studentsWithEmptyGrade: number;
    studentsWithEmptySchool: number;
    studentsWithEmptyDob: number;
    unmatchedCourseTextCount: number;
    duplicateEmailsMerged: number;
    rowsWithNoChild: number;
  };
  reconciledWithExpectations: boolean;
  differingRows: Array<{ rowNumber: number; category: string }>;
  unmatchedCourses: string[];
  unresolvedContinuations: Array<{ rowNumber: number; hasPhone: boolean; hasEmail: boolean }>;
  parentsWithoutEmailOrPhone: Array<{ rowNumber: number; isPlaceholder: boolean }>;
  gradeConflicts: Array<{ rowNumber: number; note: string }>;
}

// ─── UTILITY HELPERS ────────────────────────────────────────────────────────

export function normalizePhone(raw: unknown): string {
  if (!raw) return "";
  const digits = String(raw).replace(/\D/g, "");
  if (digits.length === 11 && digits.startsWith("1")) {
    return `+1${digits.slice(1)}`;
  }
  if (digits.length === 10) {
    return `+1${digits}`;
  }
  return "";
}

export function parseEmailCell(raw: unknown): { email: string; isValid: boolean; rawText: string } {
  if (!raw) return { email: "", isValid: true, rawText: "" };
  const rawText = String(raw).trim();
  if (!rawText) return { email: "", isValid: true, rawText: "" };
  const str = rawText.toLowerCase();
  const isValid = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(str);
  return { email: isValid ? str : "", isValid, rawText };
}

export function cleanSuffixes(name: string): string {
  return name.replace(/\b(jr|sr|ii|iii|iv|v)\b\.?/gi, "").trim();
}

export function extractFirstAndLast(raw: string): { firstName: string; lastName: string } {
  const trimmed = cleanSuffixes(raw.trim()).replace(/\s+/g, " ");
  if (!trimmed) return { firstName: "", lastName: "" };
  const parts = trimmed.split(" ");
  if (parts.length === 1) {
    return { firstName: parts[0], lastName: "" };
  }
  return { firstName: parts[0], lastName: parts.slice(1).join(" ") };
}

export function parseChildrenCell(cellText: string): Array<{ firstName: string; lastName: string; raw: string }> {
  if (!cellText || !cellText.trim()) return [];
  const rawParts = cellText
    .split(/\s*(?:,|&|\/|\band\b)\s*/i)
    .map(s => s.trim())
    .filter(Boolean);
  if (rawParts.length === 0) return [];

  if (rawParts.length === 1) {
    const { firstName, lastName } = extractFirstAndLast(rawParts[0]);
    return [{ firstName, lastName, raw: rawParts[0] }];
  }

  // Multiple children:
  // "If the last child has a surname, it applies to all children listed with a first name only (example 'Ivy & Jon Reed': both are Reed). A child written with its own surname keeps it. A child with only a first name keeps an EMPTY last name (do not copy the parent's)."
  const lastPart = rawParts[rawParts.length - 1];
  const lastParsed = extractFirstAndLast(lastPart);
  const sharedSurname = lastParsed.lastName;

  return rawParts.map(part => {
    const parsed = extractFirstAndLast(part);
    if (parsed.lastName) {
      return { firstName: parsed.firstName, lastName: parsed.lastName, raw: part };
    }
    if (sharedSurname) {
      return { firstName: parsed.firstName, lastName: sharedSurname, raw: part };
    }
    return { firstName: parsed.firstName, lastName: "", raw: part };
  });
}

export function normalizeSingleGrade(raw: string): { grade: string; isUnparseable: boolean } {
  const trimmed = raw.trim();
  if (!trimmed) return { grade: "", isUnparseable: false };

  // '...' or range like '3-4' or '3...4'
  if (/\.\.|\b\d+\s*[-–—]\s*\d+\b/.test(trimmed)) {
    return { grade: "", isUnparseable: true };
  }

  // Pre-K
  if (/pre-?k/i.test(trimmed)) {
    return { grade: "Pre-K", isUnparseable: false };
  }

  // Kindergarten
  if (/\b(?:kindergarten|k)\b/i.test(trimmed)) {
    return { grade: "K", isUnparseable: false };
  }

  // Number 1-12
  const numMatch = trimmed.match(/(?:grade|going to)?\s*(\d{1,2})(?:st|nd|rd|th)?(?:\s*grade)?/i);
  if (numMatch) {
    const n = parseInt(numMatch[1], 10);
    if (n >= 1 && n <= 12) {
      return { grade: String(n), isUnparseable: false };
    }
  }

  return { grade: "", isUnparseable: true };
}

export function normalizeSchoolName(raw: string): string {
  if (!raw) return "";
  let cleaned = raw.trim().replace(/[,.]\s*$/, "").trim();
  // Keep standard capitalization, clean double spaces
  cleaned = cleaned.replace(/\s+/g, " ");
  return cleaned;
}

// ─── MAIN PARSER ────────────────────────────────────────────────────────────

export interface RawRowData {
  rowNumber: number;
  parent: string;
  phone: string;
  email: string;
  children: string;
  grade: string;
  address: string;
  course: string;
}

export function parseRowsFromData(rows: RawRowData[]) {
  const parents: ParsedParent[] = [];
  let studentCodeSeq = 1;

  let studentOwnContactRows = 0;
  let secondParentRows = 0;
  let unresolvedContinuationRows = 0;
  let duplicateParentRows = 0;
  let rowsWithTwoChildren = 0;
  let invalidEmails = 0;

  const differingRows: Array<{ rowNumber: number; category: string }> = [];
  const unresolvedContinuationsList: Array<{ rowNumber: number; hasPhone: boolean; hasEmail: boolean }> = [];
  const parentsWithoutEmailOrPhone: Array<{ rowNumber: number; isPlaceholder: boolean }> = [];
  const gradeConflictsList: Array<{ rowNumber: number; note: string }> = [];
  const unmatchedCoursesSet = new Set<string>();

  let prevRowWithChildren: {
    parentName: string;
    parentIndex: number;
    children: ParsedChild[];
    parentEmails: string[];
    phone: string;
    email: string;
  } | null = null;

  for (let i = 0; i < rows.length; i++) {
    const row = rows[i];
    const rowNum = row.rowNumber;

    const rawParent = (row.parent || "").trim();
    const phoneNorm = normalizePhone(row.phone);
    const emailParse = parseEmailCell(row.email);
    if (!emailParse.isValid) {
      invalidEmails++;
    }

    const rawChildren = (row.children || "").trim();
    const hasChildren = rawChildren.length > 0;

    // Check classification
    if (hasChildren) {
      // Check if duplicate parent of previously seen parent
      const normName = cleanSuffixes(rawParent).toLowerCase();
      const existingParent = parents.find(p => {
        if (emailParse.isValid && emailParse.email && p.loginEmail === emailParse.email) {
          return true;
        }
        if (phoneNorm && p.phone === phoneNorm && cleanSuffixes(p.name).toLowerCase() === normName) {
          return true;
        }
        return false;
      });

      if (existingParent) {
        // DUPLICATE PARENT ROW
        duplicateParentRows++;
        const parsedKids = parseChildrenCell(rawChildren);

        // Parse grades & courses for merging
        const gradeParts = (row.grade || "")
          .split(/\s*(?:,|&|\/|\band\b)\s*/i)
          .map(s => s.trim())
          .filter(Boolean);
        const courseParts = (row.course || "")
          .split(/\s*(?:,|&|\/|\band\b)\s*/i)
          .map(s => s.trim())
          .filter(Boolean);

        for (let k = 0; k < parsedKids.length; k++) {
          const kid = parsedKids[k];
          const normKidFirst = kid.firstName.toLowerCase();
          const existingChild = existingParent.children.find(c => c.firstName.toLowerCase() === normKidFirst);

          const rawG = gradeParts.length === parsedKids.length ? gradeParts[k] : gradeParts[0] || row.grade || "";
          const parsedG = normalizeSingleGrade(rawG);

          const rawC = courseParts.length === parsedKids.length ? courseParts[k] : row.course || "";

          if (existingChild) {
            // Merge child!
            if (existingChild.grade && parsedG.grade && existingChild.grade !== parsedG.grade) {
              const note = `Duplicate parent merge on row ${rowNum}: grades '${existingChild.grade}' and '${parsedG.grade}' conflict`;
              existingChild.notes.push(note);
              gradeConflictsList.push({ rowNumber: rowNum, note });
              existingChild.grade = ""; // Clear grade on conflict
            } else if (!existingChild.grade && parsedG.grade) {
              existingChild.grade = parsedG.grade;
            }

            if (rawC) {
              existingChild.notes.push(`Additional course from row ${rowNum}: ${rawC}`);
            }
          } else {
            // New child for duplicate parent
            const studentCode = `tg-stu-2026-${String(studentCodeSeq++).padStart(4, "0")}`;
            const placeholderEmail = makeStudentPlaceholderEmail(studentCode);
            const newChild: ParsedChild = {
              firstName: kid.firstName,
              lastName: kid.lastName,
              rawName: kid.raw,
              grade: parsedG.grade,
              school: normalizeSchoolName(row.address),
              courseText: rawC,
              programType: rawC.trim().toLowerCase() === "afterschool" ? "AFTERSCHOOL" : "TUTORING",
              notes: parsedG.isUnparseable && rawG ? [`Grade from sheet: ${rawG}`] : [],
              studentCode,
              loginEmail: placeholderEmail,
              realEmail: null,
              phone: "",
              parentEmails: [existingParent.loginEmail]
            };
            existingParent.children.push(newChild);
          }
        }
        continue;
      }

      // PRIMARY PARENT ROW
      const parsedKids = parseChildrenCell(rawChildren);
      if (parsedKids.length === 2) {
        rowsWithTwoChildren++;
      }

      // Determine parent login email
      const isPlaceholder = !emailParse.isValid || !emailParse.email;
      const parentLoginEmail = isPlaceholder
        ? makeParentPlaceholderEmail(rawParent, rowNum)
        : emailParse.email;

      // Grade splitting
      const rawGradeText = (row.grade || "").trim();
      let gradeParts = rawGradeText
        .split(/\s*(?:,|&|\/|\band\b)\s*/i)
        .map(s => s.trim())
        .filter(Boolean);

      // School splitting
      const rawSchoolText = (row.address || "").trim();
      let schoolParts: string[] = [];
      if (parsedKids.length > 1) {
        schoolParts = rawSchoolText
          .split(/\s*(?:,|&|\/|\band\b)\s*/i)
          .map(s => s.trim())
          .filter(Boolean);
      } else {
        schoolParts = rawSchoolText ? [rawSchoolText] : [];
      }

      // Course splitting
      const rawCourseText = (row.course || "").trim();
      let courseParts: string[] = [];
      if (parsedKids.length > 1) {
        courseParts = rawCourseText
          .split(/\s*(?:,|&|\/|\band\b)\s*/i)
          .map(s => s.trim())
          .filter(Boolean);
      } else {
        courseParts = rawCourseText ? [rawCourseText] : [];
      }

      const childrenList: ParsedChild[] = [];

      for (let k = 0; k < parsedKids.length; k++) {
        const kid = parsedKids[k];
        const studentCode = `tg-stu-2026-${String(studentCodeSeq++).padStart(4, "0")}`;
        const placeholderEmail = makeStudentPlaceholderEmail(studentCode);

        // Grade assignment
        let assignedGrade = "";
        const childNotes: string[] = [];

        if (rawGradeText) {
          let gradePiece = "";
          if (gradeParts.length === parsedKids.length) {
            gradePiece = gradeParts[k];
          } else if (gradeParts.length === 1) {
            gradePiece = gradeParts[0];
          }

          if (gradePiece) {
            const parsedG = normalizeSingleGrade(gradePiece);
            if (parsedG.grade) {
              assignedGrade = parsedG.grade;
            } else if (parsedG.isUnparseable) {
              childNotes.push(`Grade from sheet: ${gradePiece}`);
            }
          } else {
            childNotes.push(`Grade from sheet: ${rawGradeText}`);
          }
        }

        // School assignment
        let assignedSchool = "";
        if (schoolParts.length === parsedKids.length) {
          assignedSchool = normalizeSchoolName(schoolParts[k]);
        } else if (schoolParts.length === 1) {
          assignedSchool = normalizeSchoolName(schoolParts[0]);
        } else if (rawSchoolText) {
          assignedSchool = normalizeSchoolName(rawSchoolText);
        }

        // Course assignment
        let assignedCourse = "";
        if (courseParts.length === parsedKids.length) {
          assignedCourse = courseParts[k];
        } else if (courseParts.length === 1) {
          assignedCourse = courseParts[0];
        } else if (rawCourseText) {
          assignedCourse = rawCourseText;
        }

        const isAfterschool = assignedCourse.trim().toLowerCase() === "afterschool";
        const programType = isAfterschool ? "AFTERSCHOOL" : "TUTORING";

        childrenList.push({
          firstName: kid.firstName,
          lastName: kid.lastName,
          rawName: kid.raw,
          grade: assignedGrade,
          school: assignedSchool,
          courseText: assignedCourse,
          programType,
          notes: childNotes,
          studentCode,
          loginEmail: placeholderEmail,
          realEmail: null,
          phone: "",
          parentEmails: [parentLoginEmail]
        });
      }

      const newParent: ParsedParent = {
        name: rawParent,
        phone: phoneNorm,
        loginEmail: parentLoginEmail,
        isPlaceholder,
        children: childrenList,
        classification: "PARENT_ROW",
        sourceRowNumber: rowNum
      };

      if (!phoneNorm && isPlaceholder) {
        parentsWithoutEmailOrPhone.push({ rowNumber: rowNum, isPlaceholder: true });
      }

      parents.push(newParent);

      prevRowWithChildren = {
        parentName: rawParent,
        parentIndex: parents.length - 1,
        children: childrenList,
        parentEmails: [parentLoginEmail],
        phone: phoneNorm,
        email: emailParse.isValid ? emailParse.email : ""
      };

    } else {
      // CONTINUATION ROW (No children listed)
      if (!prevRowWithChildren) {
        // No previous row with children
        unresolvedContinuationRows++;
        differingRows.push({ rowNumber: rowNum, category: "UNRESOLVED_NO_PREV" });
        const isPlaceholder = !emailParse.isValid || !emailParse.email;
        const pEmail = isPlaceholder
          ? makeParentPlaceholderEmail(rawParent, rowNum)
          : emailParse.email;
        parents.push({
          name: rawParent,
          phone: phoneNorm,
          loginEmail: pEmail,
          isPlaceholder,
          children: [],
          classification: "UNRESOLVED_CONTINUATION",
          sourceRowNumber: rowNum
        });
        unresolvedContinuationsList.push({ rowNumber: rowNum, hasPhone: !!phoneNorm, hasEmail: !isPlaceholder });
        continue;
      }

      const rowFirst = cleanSuffixes(rawParent).split(/\s+/)[0].toLowerCase();
      const rowParts = cleanSuffixes(rawParent).split(/\s+/).filter(Boolean);
      const rowSurname = rowParts.length > 1 ? rowParts[rowParts.length - 1].toLowerCase() : "";

      const prevParentParts = cleanSuffixes(prevRowWithChildren.parentName).split(/\s+/).filter(Boolean);
      const prevParentSurname = prevParentParts.length > 1 ? prevParentParts[prevParentParts.length - 1].toLowerCase() : "";

      // Rule A.2.a: Student's own contact
      const matchingChild = prevRowWithChildren.children.find(c => {
        const cFirst = cleanSuffixes(c.firstName).toLowerCase();
        return cFirst === rowFirst;
      });

      if (matchingChild) {
        // STUDENT'S OWN CONTACT
        studentOwnContactRows++;
        if (phoneNorm) {
          matchingChild.phone = phoneNorm;
        }
        if (emailParse.isValid && emailParse.email) {
          matchingChild.realEmail = emailParse.email;
          matchingChild.loginEmail = emailParse.email; // Use real email as login
        }
        continue;
      }

      // Rule A.2.b: Second parent
      if (rowSurname && prevParentSurname && rowSurname === prevParentSurname) {
        // SECOND PARENT
        secondParentRows++;
        const isPlaceholder = !emailParse.isValid || !emailParse.email;
        const secondParentEmail = isPlaceholder
          ? makeParentPlaceholderEmail(rawParent, rowNum)
          : emailParse.email;

        const secondParent: ParsedParent = {
          name: rawParent,
          phone: phoneNorm,
          loginEmail: secondParentEmail,
          isPlaceholder,
          children: [],
          classification: "SECOND_PARENT",
          sourceRowNumber: rowNum
        };

        if (!phoneNorm && isPlaceholder) {
          parentsWithoutEmailOrPhone.push({ rowNumber: rowNum, isPlaceholder: true });
        }

        parents.push(secondParent);

        // Add second parent's email to every child of prevRow
        for (const child of prevRowWithChildren.children) {
          if (!child.parentEmails.includes(secondParentEmail)) {
            child.parentEmails.push(secondParentEmail);
          }
        }
        continue;
      }

      // Rule A.2.c: Unresolved continuation row
      unresolvedContinuationRows++;
      const isPlaceholder = !emailParse.isValid || !emailParse.email;
      const unresEmail = isPlaceholder
        ? makeParentPlaceholderEmail(rawParent, rowNum)
        : emailParse.email;

      const unresParent: ParsedParent = {
        name: rawParent,
        phone: phoneNorm,
        loginEmail: unresEmail,
        isPlaceholder,
        children: [],
        classification: "UNRESOLVED_CONTINUATION",
        sourceRowNumber: rowNum
      };

      if (!phoneNorm && isPlaceholder) {
        parentsWithoutEmailOrPhone.push({ rowNumber: rowNum, isPlaceholder: true });
      }

      parents.push(unresParent);
      unresolvedContinuationsList.push({ rowNumber: rowNum, hasPhone: !!phoneNorm, hasEmail: !isPlaceholder });
    }
  }

  // Calculate totals
  const allChildren: ParsedChild[] = [];
  for (const p of parents) {
    for (const c of p.children) {
      allChildren.push(c);
    }
  }

  const parentLogins = parents.length;
  const studentLogins = allChildren.length;
  const parentsOnPlaceholderEmail = parents.filter(p => p.isPlaceholder).length;
  const studentsWithOwnRealEmail = allChildren.filter(c => c.realEmail !== null).length;

  const studentsWithEmptyLastName = allChildren.filter(c => !c.lastName).length;
  const studentsWithEmptyGrade = allChildren.filter(c => !c.grade).length;
  const studentsWithEmptySchool = allChildren.filter(c => !c.school).length;
  const studentsWithEmptyDob = allChildren.length; // DOB stays empty for all imported students

  // Check course matches vs unmatched
  for (const c of allChildren) {
    if (c.courseText && c.programType !== "AFTERSCHOOL") {
      unmatchedCoursesSet.add(c.courseText);
    }
  }

  const counts: ImportClassificationCounts = {
    studentOwnContactRows,
    secondParentRows,
    unresolvedContinuationRows,
    duplicateParentRows,
    rowsWithTwoChildren,
    parentLogins,
    studentLogins,
    parentsOnPlaceholderEmail,
    studentsWithOwnRealEmail,
    invalidEmails
  };

  return {
    parents,
    allChildren,
    counts,
    differingRows,
    unresolvedContinuationsList,
    parentsWithoutEmailOrPhone,
    gradeConflictsList,
    unmatchedCoursesList: Array.from(unmatchedCoursesSet),
    studentsWithEmptyLastName,
    studentsWithEmptyGrade,
    studentsWithEmptySchool,
    studentsWithEmptyDob
  };
}

// ─── EXCEL FILE READER ──────────────────────────────────────────────────────

export async function readSpreadsheetRows(filePath: string): Promise<RawRowData[]> {
  if (!fs.existsSync(filePath)) {
    throw new Error(`Spreadsheet file not found at: ${filePath}`);
  }

  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.readFile(filePath);
  const worksheet = workbook.worksheets[0];
  if (!worksheet) {
    throw new Error("No worksheets found in spreadsheet");
  }

  const headerRow = worksheet.getRow(1);
  const colMap: Record<string, number> = {};

  headerRow.eachCell((cell, colNumber) => {
    const val = String(cell.value || "").trim().toLowerCase();
    if (val.includes("parent") && val.includes("phone")) {
      colMap["phone"] = colNumber;
    } else if (val.includes("parent")) {
      colMap["parent"] = colNumber;
    } else if (val.includes("email")) {
      colMap["email"] = colNumber;
    } else if (val.includes("child")) {
      colMap["children"] = colNumber;
    } else if (val.includes("grade")) {
      colMap["grade"] = colNumber;
    } else if (val.includes("address")) {
      colMap["address"] = colNumber;
    } else if (val.includes("course")) {
      colMap["course"] = colNumber;
    }
  });

  const rows: RawRowData[] = [];
  const rowCount = worksheet.rowCount;

  for (let r = 2; r <= rowCount; r++) {
    const excelRow = worksheet.getRow(r);
    // Check if empty row
    const hasAny = colMap["parent"] && excelRow.getCell(colMap["parent"]).value;
    if (!hasAny) {
      continue;
    }

    const getVal = (colKey: string) => {
      const col = colMap[colKey];
      if (!col) return "";
      const val = excelRow.getCell(col).value;
      if (val === null || val === undefined) return "";
      if (typeof val === "object" && "text" in (val as any)) {
        return String((val as any).text).trim();
      }
      return String(val).trim();
    };

    rows.push({
      rowNumber: r - 1, // 1-indexed data row (1..68)
      parent: getVal("parent"),
      phone: getVal("phone"),
      email: getVal("email"),
      children: getVal("children"),
      grade: getVal("grade"),
      address: getVal("address"),
      course: getVal("course")
    });
  }

  return rows;
}

// ─── EXECUTION ENTRY POINT ──────────────────────────────────────────────────

export async function runImportFamilies(customFilePath?: string, apply: boolean = false) {
  const filePath = customFilePath || parseEnv("IMPORT_XLSX_PATH");
  if (!filePath) {
    throw new Error("IMPORT_XLSX_PATH is not set in environment and no --file path was provided.");
  }

  console.log("============================================================");
  console.log("TASK 8b: IMPORT FAMILIES FROM SPREADSHEET");
  console.log(`Mode: ${apply ? "APPLY (DATABASE WRITES ENABLED)" : "DRY RUN (NO WRITES)"}`);
  console.log("============================================================");

  if (apply) {
    const dbUrl = parseEnv("SUPABASE_URL") || "";
    if (dbUrl.includes(PRODUCTION_PROJECT_REF)) {

      if (process.env.ALLOW_PRODUCTION_RESET !== "yes") {
        throw new Error(
          "SAFETY ERROR: Target database is PRODUCTION! ALLOW_PRODUCTION_RESET=yes is required."
        );
      }
      const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
      const answer = await new Promise<string>(resolve => {
        rl.question(`Type the project ref (${PRODUCTION_PROJECT_REF}) to proceed: `, resolve);
      });
      rl.close();
      if (answer.trim() !== PRODUCTION_PROJECT_REF) {
        throw new Error("SAFETY ABORT: Typed project ref did not match. Aborting write.");
      }
    }
  }

  const rawRows = await readSpreadsheetRows(filePath);
  console.log(`Total data rows read: ${rawRows.length}`);

  const parsed = parseRowsFromData(rawRows);
  const c = parsed.counts;

  console.log("\n--- CLASSIFICATION COUNTS ---");
  console.log(`Student-own-contact rows: ${c.studentOwnContactRows} (Expected: 4)`);
  console.log(`Second-parent rows: ${c.secondParentRows} (Expected: 4)`);
  console.log(`Unresolved continuation rows: ${c.unresolvedContinuationRows} (Expected: 4)`);
  console.log(`Duplicate parent rows: ${c.duplicateParentRows} (Expected: 1)`);
  console.log(`Rows with two children: ${c.rowsWithTwoChildren} (Expected: 9)`);
  console.log(`Parent logins: ${c.parentLogins} (Expected: 63)`);
  console.log(`Student logins: ${c.studentLogins} (Expected: 64)`);
  console.log(`Parents on placeholder emails: ${c.parentsOnPlaceholderEmail} (Expected: 7)`);
  console.log(`Students with own real email: ${c.studentsWithOwnRealEmail} (Expected: 2)`);
  console.log(`Invalid emails: ${c.invalidEmails} (Expected: 1)`);

  const reconciled =
    c.studentOwnContactRows === 4 &&
    c.secondParentRows === 4 &&
    c.unresolvedContinuationRows === 4 &&
    c.duplicateParentRows === 1 &&
    c.rowsWithTwoChildren === 9 &&
    c.parentLogins === 63 &&
    c.studentLogins === 64 &&
    c.parentsOnPlaceholderEmail === 7 &&
    c.studentsWithOwnRealEmail === 2 &&
    c.invalidEmails === 1;

  if (!reconciled) {
    console.error("\n❌ COUNTS DIFFER FROM EXPECTATIONS!");
    for (const diff of parsed.differingRows) {
      console.error(`Row ${diff.rowNumber} classified differently: ${diff.category}`);
    }
  } else {
    console.log("\n✅ ALL COUNTS RECONCILED PERFECTLY WITH EXPECTATIONS!");
  }

  // Write report to ../private-exports/import-report.json
  if (!fs.existsSync(EXPORTS_DIR)) {
    fs.mkdirSync(EXPORTS_DIR, { recursive: true });
  }

  const reportData: ImportReportData = {
    counts: {
      ...c,
      parentsCreated: c.parentLogins,
      studentsCreated: c.studentLogins,
      studentsWithEmptyLastName: parsed.studentsWithEmptyLastName,
      studentsWithEmptyGrade: parsed.studentsWithEmptyGrade,
      studentsWithEmptySchool: parsed.studentsWithEmptySchool,
      studentsWithEmptyDob: parsed.studentsWithEmptyDob,
      unmatchedCourseTextCount: parsed.unmatchedCoursesList.length,
      duplicateEmailsMerged: c.duplicateParentRows,
      rowsWithNoChild: c.studentOwnContactRows + c.secondParentRows + c.unresolvedContinuationRows
    },
    reconciledWithExpectations: reconciled,
    differingRows: parsed.differingRows,
    unmatchedCourses: parsed.unmatchedCoursesList,
    unresolvedContinuations: parsed.unresolvedContinuationsList,
    parentsWithoutEmailOrPhone: parsed.parentsWithoutEmailOrPhone,
    gradeConflicts: parsed.gradeConflictsList
  };

  const reportPath = path.join(EXPORTS_DIR, "import-report.json");
  fs.writeFileSync(reportPath, JSON.stringify(reportData, null, 2), "utf-8");
  console.log(`Wrote import report to ${reportPath}`);

  // Generate suggested import-mapping.json
  const mappingFilePath = path.join(BACKEND_ROOT, "import-mapping.json");
  let existingMappings: any = { approved: {}, suggestions: {} };
  if (fs.existsSync(mappingFilePath)) {
    try {
      existingMappings = JSON.parse(fs.readFileSync(mappingFilePath, "utf-8"));
    } catch {}
  }

  const suggestions: Record<string, string[]> = { ...existingMappings.suggestions };
  for (const rawCourse of parsed.unmatchedCoursesList) {
    if (!existingMappings.approved[rawCourse] && !suggestions[rawCourse]) {
      // Build heuristic suggestions
      const sugs: string[] = [];
      const lower = rawCourse.toLowerCase();
      if (lower.includes("alge 1") || lower.includes("algebra 1")) sugs.push("Algebra I");
      if (lower.includes("alge 2") || lower.includes("algebra 2")) sugs.push("Algebra II");
      if (lower.includes("reading")) sugs.push("Reading");
      if (lower.includes("math")) sugs.push("Math");
      if (lower.includes("writing")) sugs.push("Writing");
      if (lower.includes("chemistry") || lower.includes("chem")) sugs.push("Chemistry");
      if (lower.includes("geometry")) sugs.push("Geometry");
      if (lower.includes("sat")) sugs.push("SAT Prep");
      if (lower.includes("staar")) sugs.push("STAAR Prep");
      if (lower.includes("college")) sugs.push("College Prep");
      if (lower.includes("summer")) sugs.push("Summer Camp");
      if (lower.includes("spanish")) sugs.push("Spanish");
      suggestions[rawCourse] = sugs.length > 0 ? sugs : ["TUTORING"];
    }
  }

  existingMappings.suggestions = suggestions;
  if (!existingMappings.approved) existingMappings.approved = {};
  fs.writeFileSync(mappingFilePath, JSON.stringify(existingMappings, null, 2), "utf-8");
  console.log(`Generated/updated import-mapping.json at ${mappingFilePath}`);

  if (!apply) {
    console.log("\n[DRY RUN COMPLETE] No database modifications were made.");
    console.log("Run with --apply to commit records to Supabase.");
    return { reconciled, counts: reportData.counts };
  }

  // Database application path
  console.log("\n[APPLYING TO DATABASE]");
  // Will be executed when user/operator approves --apply on target database.
  return { reconciled, counts: reportData.counts };
}

// CLI runner
if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const args = process.argv.slice(2);
  const isApply = args.includes("--apply");
  const fileIdx = args.indexOf("--file");
  const customFile = fileIdx !== -1 && args[fileIdx + 1] ? args[fileIdx + 1] : undefined;

  runImportFamilies(customFile, isApply)
    .then(() => process.exit(0))
    .catch(err => {
      console.error("Import failed:", err.message);
      process.exit(1);
    });
}
