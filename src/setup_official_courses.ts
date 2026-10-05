import dotenv from "dotenv";
import { createClient } from "@supabase/supabase-js";

dotenv.config();

const supabaseUrl = process.env.SUPABASE_URL || "";
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY || "";

if (!supabaseUrl || !supabaseKey) {
  console.error("Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY");
  process.exit(1);
}

const supabase = createClient(supabaseUrl, supabaseKey, {
  auth: { autoRefreshToken: false, persistSession: false }
});

const REQUIRED_COURSES = [
  {
    name: "Reading Comprehension",
    code: "CRS-REA-101",
    description: "Foundational and advanced reading comprehension, literary analysis, critical reasoning, and text interpretation.",
    ageGroup: "Elementary & Middle (Grade K-8)",
    skills: "Reading & English",
    fee: 380,
    duration: "3 Months"
  },
  {
    name: "After School Program",
    code: "CRS-ASP-01",
    description: "Daily afterschool enrichment program covering homework assistance, reading, mathematics, and STEAM activities.",
    ageGroup: "Elementary & Middle (Grade K-8)",
    skills: "General Academic",
    fee: 450,
    duration: "Academic Year"
  },
  {
    name: "STAAR Prep",
    code: "CRS-STA-09",
    description: "Comprehensive Texas STAAR exam readiness for Math and Reading with timed practice tests and diagnostic reviews.",
    ageGroup: "Grade 3-8",
    skills: "Standardized Testing",
    fee: 420,
    duration: "3 Months"
  },
  {
    name: "Math & Reading Foundations",
    code: "CRS-MR-101",
    description: "Integrated dual-focus curriculum strengthening computational math fluency and reading speed and comprehension.",
    ageGroup: "Elementary (Grade 1-6)",
    skills: "Mathematics & Reading",
    fee: 460,
    duration: "3 Months"
  },
  {
    name: "Summer Camp & Academic Tutoring",
    code: "CRS-SMP-101",
    description: "Interactive summer camp program combining academic enrichment in math and language arts with creative workshops.",
    ageGroup: "All Grades",
    skills: "Academic Enrichment",
    fee: 550,
    duration: "Summer Session"
  },
  {
    name: "Writing Skills & Handwriting",
    code: "CRS-WRT-101",
    description: "Structured writing workshops emphasizing grammar, paragraph formulation, narrative and argumentative essays, and penmanship.",
    ageGroup: "Elementary & Middle",
    skills: "Language Arts",
    fee: 350,
    duration: "3 Months"
  },
  {
    name: "College Essay Workshop & Writing",
    code: "CRS-CEW-101",
    description: "Intensive college admissions essay coaching, personal statement brainstorming, drafting, and expert faculty critique.",
    ageGroup: "High School (Grade 11-12)",
    skills: "College Admissions",
    fee: 490,
    duration: "2 Months"
  },
  {
    name: "GT Prep (Gifted & Talented)",
    code: "CRS-GTP-101",
    description: "Accelerated cognitive development, non-verbal reasoning, and quantitative problem-solving for Gifted & Talented placement.",
    ageGroup: "Pre-K to Grade 5",
    skills: "Advanced Learning",
    fee: 440,
    duration: "3 Months"
  },
  {
    name: "Algebra 1 & PAP Algebra 2",
    code: "CRS-ALG-101",
    description: "Rigorous algebra instruction covering linear equations, quadratic functions, polynomials, systems, and pre-AP foundations.",
    ageGroup: "Grade 8-11",
    skills: "Mathematics",
    fee: 400,
    duration: "3 Months"
  },
  {
    name: "TSI Prep",
    code: "CRS-TSI-101",
    description: "Texas Success Initiative Assessment prep for high school seniors ensuring college course placement readiness.",
    ageGroup: "High School (Grade 11-12)",
    skills: "Standardized Testing",
    fee: 380,
    duration: "2 Months"
  },
  {
    name: "ESL (English as a Second Language)",
    code: "CRS-ESL-101",
    description: "English language acquisition program focusing on verbal conversation, listening comprehension, grammar, and academic literacy.",
    ageGroup: "All Grades",
    skills: "Language Learning",
    fee: 390,
    duration: "3 Months"
  },
  {
    name: "Hindi Language",
    code: "CRS-HIN-101",
    description: "Devanagari script reading, writing, conversational speaking, and cultural heritage studies for students of all ages.",
    ageGroup: "All Grades",
    skills: "World Languages",
    fee: 320,
    duration: "3 Months"
  },
  {
    name: "PAP Spanish",
    code: "CRS-SPN-101",
    description: "Pre-AP Spanish grammar, vocabulary immersion, literature reading, and oral fluency preparation.",
    ageGroup: "Middle & High School",
    skills: "World Languages",
    fee: 380,
    duration: "3 Months"
  }
];

async function main() {
  console.log("Checking courses in Supabase...");
  const { data: existingCourses, error } = await supabase.from("courses").select("*");
  if (error) {
    console.error("Error fetching courses:", error);
    return;
  }

  const existingMap = new Map((existingCourses || []).map(c => [c.name.toLowerCase().trim(), c]));
  const existingCodes = new Set((existingCourses || []).map(c => c.course_code.toUpperCase().trim()));

  for (const c of REQUIRED_COURSES) {
    const key = c.name.toLowerCase().trim();
    if (!existingMap.has(key) && !existingCodes.has(c.code.toUpperCase())) {
      const scheduleMaterial = JSON.stringify({
        schedule: [
          { id: `sch-${c.code.toLowerCase()}-1`, day: "Monday", slot: "04:30 PM - 06:00 PM", room: "Center Room A", programTrack: c.name, teacherName: "Assigned Faculty", teacherId: "" },
          { id: `sch-${c.code.toLowerCase()}-2`, day: "Thursday", slot: "04:30 PM - 06:00 PM", room: "Center Room B", programTrack: c.name, teacherName: "Assigned Faculty", teacherId: "" }
        ]
      });

      const { data: ins, error: insErr } = await supabase.from("courses").insert([{
        course_code: c.code,
        name: c.name,
        description: c.description,
        age_group: c.ageGroup,
        duration: c.duration,
        fee: c.fee,
        max_students: 25,
        required_teacher_skills: c.skills,
        course_material: scheduleMaterial,
        status: "Active"
      }]).select().single();

      if (insErr) {
        console.warn(`  ! Could not insert ${c.name}:`, insErr.message);
      } else {
        console.log(`  + Inserted course: ${c.name} (${c.code})`);
      }
    } else {
      console.log(`  ✓ Course already present: ${c.name}`);
    }
  }

  console.log("Course setup complete.");
}

main();
