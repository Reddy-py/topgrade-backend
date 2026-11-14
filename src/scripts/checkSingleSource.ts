import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const BACKEND_SRC = path.resolve(__dirname, "..");
const FRONTEND_SRC = path.resolve(__dirname, "../../../topgrade/src");

const FORBIDDEN_EXACT_TABLES = [
  "schedule_slots",
  "schedule_students",
  "hour_wallets",
  "hour_ledger",
  "email_logs"
];

// Patterns for table references
const FORBIDDEN_PATTERNS: Array<{ name: string; regex: RegExp }> = [
  ...FORBIDDEN_EXACT_TABLES.map(tbl => ({
    name: tbl,
    regex: new RegExp(`\\b${tbl}\\b`, "i")
  })),
  {
    name: "bookings table",
    regex: /\.from\(\s*["']bookings["']\s*\)|from\s+public\.bookings\b|into\s+public\.bookings\b|table\s+bookings\b/i
  }
];

const IGNORED_FILES = [
  "checkSingleSource.ts",
  "DATA_FLOW.md",
  "RUN_ORDER.md"
];

function scanDirectory(dir: string, fileList: string[] = []): string[] {
  if (!fs.existsSync(dir)) return fileList;
  const entries = fs.readdirSync(dir, { withFileTypes: true });
  for (const entry of entries) {
    const fullPath = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      if (entry.name !== "node_modules" && entry.name !== ".git" && entry.name !== "dist" && entry.name !== "build") {
        scanDirectory(fullPath, fileList);
      }
    } else if (entry.isFile()) {
      const ext = path.extname(entry.name);
      if ([".ts", ".tsx", ".js", ".jsx"].includes(ext) && !IGNORED_FILES.includes(entry.name)) {
        fileList.push(fullPath);
      }
    }
  }
  return fileList;
}

interface Violation {
  file: string;
  line: number;
  pattern: string;
  code: string;
}

function runCheck() {
  console.log("==================================================");
  console.log("   TASK 19 PART B: SINGLE SOURCE OF TRUTH CHECK   ");
  console.log("==================================================");
  console.log("Scanning codebase for references to deprecated tables...");
  console.log(`Forbidden tables: ${FORBIDDEN_EXACT_TABLES.join(", ")}, bookings\n`);

  const files = [
    ...scanDirectory(BACKEND_SRC),
    ...scanDirectory(FRONTEND_SRC)
  ];

  const violations: Violation[] = [];

  for (const file of files) {
    if (file.endsWith("checkSingleSource.ts")) continue;
    const content = fs.readFileSync(file, "utf8");
    const lines = content.split("\n");

    lines.forEach((lineText, idx) => {
      // Skip comments that describe migrations or deprecations
      const trimmed = lineText.trim();
      if (trimmed.startsWith("//") && (trimmed.toLowerCase().includes("deprecated") || trimmed.toLowerCase().includes("migration") || trimmed.toLowerCase().includes("dropped"))) {
        return;
      }

      for (const { name, regex } of FORBIDDEN_PATTERNS) {
        if (regex.test(lineText)) {
          violations.push({
            file: path.relative(process.cwd(), file),
            line: idx + 1,
            pattern: name,
            code: trimmed
          });
        }
      }
    });
  }

  if (violations.length > 0) {
    console.error(`❌ FAILED: Found ${violations.length} forbidden reference(s) to deprecated tables:\n`);
    for (const v of violations) {
      console.error(`  - ${v.file}:${v.line} [${v.pattern}]`);
      console.error(`    ${v.code}\n`);
    }
    console.error("Please migrate all code to use the canonical tables: schedules, student_enrollments, token_wallets, token_ledger, attendance, email_log.");
    process.exit(1);
  } else {
    console.log(`✅ PASSED: Scanned ${files.length} source files across backend and frontend.`);
    console.log("Zero references found to deprecated tables (schedule_slots, bookings, schedule_students, hour_wallets, hour_ledger, email_logs).\n");
    process.exit(0);
  }
}

runCheck();
