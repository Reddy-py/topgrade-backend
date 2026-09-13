import { supabaseAdmin } from "./supabase.js";

// ============================================================================
// 1. THE 36 OFFICIAL COURSES (FROM USER SHEET)
// ============================================================================
export const OFFICIAL_COURSES = [
  {
    course_code: "CRS-ASP-01",
    name: "After School Program",
    category: "Junior Foundation & Enrichment",
    description: "Structured after-school academic enrichment, homework assistance, and skill-building activities.",
    age_group: "All Grades",
    duration: "Ongoing",
    fee: 350,
    max_students: 30
  },
  {
    course_code: "CRS-BSP-02",
    name: "Before School Program",
    category: "Junior Foundation & Enrichment",
    description: "Early morning academic readiness, reading sessions, and supervised study routines.",
    age_group: "All Grades",
    duration: "Ongoing",
    fee: 250,
    max_students: 25
  },
  {
    course_code: "CRS-FEE-03",
    name: "Enrollment fees",
    category: "Administrative & Registration",
    description: "One-time institutional student registration, diagnostics, and portal enrollment fee.",
    age_group: "All Grades",
    duration: "One-Time",
    fee: 75,
    max_students: 100
  },
  {
    course_code: "CRS-SMP-04",
    name: "Summer Camp",
    category: "Camps & Intensive Workshops",
    description: "Comprehensive summer academic acceleration, robotics, STEM, and creative arts.",
    age_group: "All Grades",
    duration: "3 Months",
    fee: 450,
    max_students: 35
  },
  {
    course_code: "CRS-SAT-05",
    name: "SAT Prep",
    category: "Test Preparation & College Readiness",
    description: "Comprehensive digital SAT prep covering Math, Reading & Writing with full mock exams.",
    age_group: "High School (Grade 9-12)",
    duration: "3 Months",
    fee: 599,
    max_students: 20
  },
  {
    course_code: "CRS-ACT-06",
    name: "ACT Prep",
    category: "Test Preparation & College Readiness",
    description: "Rigorous ACT preparation covering English, Math, Reading, Science, and timing strategies.",
    age_group: "High School (Grade 9-12)",
    duration: "3 Months",
    fee: 599,
    max_students: 20
  },
  {
    course_code: "CRS-COG-07",
    name: "CogNT Prep",
    category: "Gifted & Talented Test Prep",
    description: "Cognitive abilities test preparation focusing on verbal, quantitative, and non-verbal reasoning.",
    age_group: "Primary (Grade 1-5)",
    duration: "3 Months",
    fee: 450,
    max_students: 15
  },
  {
    course_code: "CRS-COL-08",
    name: "College Prep",
    category: "Test Preparation & College Readiness",
    description: "Holistic college admissions guidance, essays, profile building, and college-level academic rigor.",
    age_group: "High School (Grade 9-12)",
    duration: "6 Months",
    fee: 499,
    max_students: 20
  },
  {
    course_code: "CRS-STA-09",
    name: "STAAR Prep",
    category: "Standardized Test Preparation",
    description: "Texas STAAR test preparation mastering state standards in Math, Reading, and Science.",
    age_group: "Middle School (Grade 6-8)",
    duration: "3 Months",
    fee: 399,
    max_students: 25
  },
  {
    course_code: "CRS-3DP-10",
    name: "3D Printing",
    category: "STEM & Technology",
    description: "Hands-on 3D CAD modeling, slicing software, rapid prototyping, and additive manufacturing.",
    age_group: "Middle & High School",
    duration: "3 Months",
    fee: 399,
    max_students: 15
  },
  {
    course_code: "CRS-COD-11",
    name: "Coding",
    category: "STEM & Technology",
    description: "Programming fundamentals, computational thinking, algorithms, and practical software projects.",
    age_group: "All Grades",
    duration: "3 Months",
    fee: 425,
    max_students: 20
  },
  {
    course_code: "CRS-REA-12",
    name: "Reading",
    category: "Language & Arts",
    description: "Phonics, vocabulary development, textual analysis, and deep comprehension strategies.",
    age_group: "Primary (Grade 1-5)",
    duration: "3 Months",
    fee: 320,
    max_students: 20
  },
  {
    course_code: "CRS-MAT-13",
    name: "Math",
    category: "Mathematics",
    description: "Core foundational math, mental arithmetic, problem solving, and algebraic concepts.",
    age_group: "All Grades",
    duration: "3 Months",
    fee: 350,
    max_students: 25
  },
  {
    course_code: "CRS-SOC-14",
    name: "Social Sciences",
    category: "Humanities & Social Sciences",
    description: "World cultures, geography, civics, societal structures, and historical analytical thinking.",
    age_group: "Middle & High School",
    duration: "3 Months",
    fee: 320,
    max_students: 25
  },
  {
    course_code: "CRS-CHM-15",
    name: "Chemistry",
    category: "Science & Laboratory",
    description: "Atomic structure, chemical bonding, stoichiometry, gas laws, and hands-on laboratory concepts.",
    age_group: "High School (Grade 9-12)",
    duration: "3 Months",
    fee: 380,
    max_students: 20
  },
  {
    course_code: "CRS-PHY-16",
    name: "Physics",
    category: "Science & Laboratory",
    description: "Classical mechanics, kinematics, Newton's laws, energy, momentum, and electricity.",
    age_group: "High School (Grade 9-12)",
    duration: "3 Months",
    fee: 380,
    max_students: 20
  },
  {
    course_code: "CRS-BIO-17",
    name: "Biology",
    category: "Science & Laboratory",
    description: "Cellular biology, genetics, molecular synthesis, ecology, physiology, and evolutionary biology.",
    age_group: "High School (Grade 9-12)",
    duration: "3 Months",
    fee: 380,
    max_students: 20
  },
  {
    course_code: "CRS-CAL-18",
    name: "Calculus",
    category: "Advanced Mathematics",
    description: "Differential and integral calculus, limits, continuity, rate of change, and practical optimizations.",
    age_group: "High School (Grade 9-12)",
    duration: "3 Months",
    fee: 420,
    max_students: 20
  },
  {
    course_code: "CRS-GEO-19",
    name: "Geometry",
    category: "Advanced Mathematics",
    description: "Euclidean geometry, proofs, congruency, trigonometry, circle theorems, and 3D spatial reasoning.",
    age_group: "High School (Grade 9-12)",
    duration: "3 Months",
    fee: 380,
    max_students: 25
  },
  {
    course_code: "CRS-ENG-20",
    name: "English",
    category: "Language & Arts",
    description: "Grammar mastery, essay composition, rhetoric, literary analysis, and vocabulary acquisition.",
    age_group: "All Grades",
    duration: "3 Months",
    fee: 320,
    max_students: 25
  },
  {
    course_code: "CRS-FRE-21",
    name: "French",
    category: "World Languages",
    description: "Conversational French, grammatical syntax, phonetics, and cultural appreciation.",
    age_group: "All Grades",
    duration: "3 Months",
    fee: 350,
    max_students: 20
  },
  {
    course_code: "CRS-SPN-22",
    name: "Spanish",
    category: "World Languages",
    description: "Spanish language fundamentals, verb conjugations, fluency practice, and composition.",
    age_group: "All Grades",
    duration: "3 Months",
    fee: 350,
    max_students: 20
  },
  {
    course_code: "CRS-PSY-23",
    name: "Physcology",
    category: "Humanities & Social Sciences",
    description: "Introduction to cognitive science, behavioral psychology, brain anatomy, and developmental stages.",
    age_group: "High School (Grade 9-12)",
    duration: "3 Months",
    fee: 350,
    max_students: 20
  },
  {
    course_code: "CRS-APCHM-24",
    name: "AP Chemistry",
    category: "Advanced Placement (AP)",
    description: "Advanced college-level chemistry, thermodynamics, kinetics, equilibrium, and AP exam prep.",
    age_group: "High School (Grade 9-12)",
    duration: "6 Months",
    fee: 520,
    max_students: 15
  },
  {
    course_code: "CRS-APPHY-25",
    name: "AP Physics",
    category: "Advanced Placement (AP)",
    description: "AP Physics C & 1 curriculum: mechanics, rotational dynamics, electromagnetism, and calculus-based modeling.",
    age_group: "High School (Grade 9-12)",
    duration: "6 Months",
    fee: 520,
    max_students: 15
  },
  {
    course_code: "CRS-APBIO-26",
    name: "AP Biology",
    category: "Advanced Placement (AP)",
    description: "Rigorous AP Biology syllabus: biochemical processes, gene regulation, biotechnology, and lab investigations.",
    age_group: "High School (Grade 9-12)",
    duration: "6 Months",
    fee: 520,
    max_students: 15
  },
  {
    course_code: "CRS-APCAL-27",
    name: "AP Calculus",
    category: "Advanced Placement (AP)",
    description: "AP Calculus AB/BC curriculum: series, differential equations, integration techniques, and FRQ mastery.",
    age_group: "High School (Grade 9-12)",
    duration: "6 Months",
    fee: 520,
    max_students: 15
  },
  {
    course_code: "CRS-APENG-28",
    name: "AP English",
    category: "Advanced Placement (AP)",
    description: "AP English Language & Literature: rhetorical analysis, argument synthesis, poetry, and prose style.",
    age_group: "High School (Grade 9-12)",
    duration: "6 Months",
    fee: 480,
    max_students: 15
  },
  {
    course_code: "CRS-APFRE-29",
    name: "AP French",
    category: "Advanced Placement (AP)",
    description: "AP French Language and Culture: interpersonal speaking, interpretive reading, and cultural synthesis.",
    age_group: "High School (Grade 9-12)",
    duration: "6 Months",
    fee: 480,
    max_students: 15
  },
  {
    course_code: "CRS-APSPN-30",
    name: "AP Spanish",
    category: "Advanced Placement (AP)",
    description: "AP Spanish Language & Literature: auditory comprehension, persuasive essays, and conversational accuracy.",
    age_group: "High School (Grade 9-12)",
    duration: "6 Months",
    fee: 480,
    max_students: 15
  },
  {
    course_code: "CRS-APPSY-31",
    name: "AP Physcology",
    category: "Advanced Placement (AP)",
    description: "AP Psychology coursework: neurological basis of behavior, social psychology, sensation, and research methods.",
    age_group: "High School (Grade 9-12)",
    duration: "6 Months",
    fee: 480,
    max_students: 15
  },
  {
    course_code: "CRS-APHUG-32",
    name: "AP Human Geography",
    category: "Advanced Placement (AP)",
    description: "Patterns and processes of human population, migration, cultural patterns, and political organization.",
    age_group: "High School (Grade 9-12)",
    duration: "6 Months",
    fee: 480,
    max_students: 15
  },
  {
    course_code: "CRS-USH-33",
    name: "US History",
    category: "Humanities & Social Sciences",
    description: "In-depth study of American civilization from colonization to modern contemporary geopolitical eras.",
    age_group: "High School (Grade 9-12)",
    duration: "3 Months",
    fee: 350,
    max_students: 25
  },
  {
    course_code: "CRS-APUSH-34",
    name: "AP US History",
    category: "Advanced Placement (AP)",
    description: "AP US History (APUSH): DBQ mastery, historical causation, periodization, and intensive source analysis.",
    age_group: "High School (Grade 9-12)",
    duration: "6 Months",
    fee: 480,
    max_students: 15
  },
  {
    course_code: "CRS-ECO-35",
    name: "Economics",
    category: "Humanities & Social Sciences",
    description: "Principles of microeconomics and macroeconomics: supply and demand, fiscal policy, and market structures.",
    age_group: "High School (Grade 9-12)",
    duration: "3 Months",
    fee: 350,
    max_students: 20
  },
  {
    course_code: "CRS-GOV-36",
    name: "US Government",
    category: "Humanities & Social Sciences",
    description: "Foundational principles of the United States Constitution, branches of government, civil liberties, and voting.",
    age_group: "High School (Grade 9-12)",
    duration: "3 Months",
    fee: 350,
    max_students: 20
  }
];

// ============================================================================
// 2. THE 17 OFFICIAL TEACHERS (FROM TUTOR DIRECTORY CSV)
// ============================================================================
export const OFFICIAL_TEACHERS = [
  {
    teacher_id_code: "TG-FAC-101",
    name: "Jamie Dawson",
    title: "Ms.",
    first_name: "Jamie",
    last_name: "Dawson",
    gender: "Female",
    email: "jldaeb1000@gmail.com",
    phone: "+1 832-315-1251",
    dob: "1968-05-04",
    age: 58,
    address_line1: "407 County Road 193",
    city: "Alvin",
    postal_code: "77511",
    state: "Texas",
    country: "US",
    joining_date: "2024-02-07",
    preferred_delivery_method: "online",
    user_name: "jamie.dawson",
    specialization: "Online Instruction & Academic Mentoring",
    qualification: "Certified Faculty Educator"
  },
  {
    teacher_id_code: "TG-FAC-102",
    name: "Shahrazad Polk",
    title: "Ms.",
    first_name: "Shahrazad",
    last_name: "Polk",
    gender: "Female",
    email: "sha.polk20@gmail.com",
    phone: "+1 281-995-0685",
    dob: "1994-11-15",
    age: 31,
    address_line1: "3904 Parkside dr",
    city: "Pearland",
    postal_code: "77584",
    state: "Texas",
    country: "US",
    joining_date: "2023-11-09",
    preferred_delivery_method: "in center",
    user_name: "shahrazad.polk",
    specialization: "In-Center Tutoring & Standard Curriculum",
    qualification: "Certified Academic Instructor"
  },
  {
    teacher_id_code: "TG-FAC-103",
    name: "Annalisa Jaimes",
    title: "Ms.",
    first_name: "Annalisa",
    last_name: "Jaimes",
    gender: "Female",
    email: "annalisa.jaimes@gmail.com",
    phone: "+1 832-542-1864",
    dob: "1974-09-22",
    age: 51,
    address_line1: "512 Hurst Place",
    city: "Angleton",
    postal_code: "77515",
    state: "Texas",
    country: "US",
    joining_date: "2025-10-22",
    preferred_delivery_method: "InPerson",
    user_name: "annalisa.jaimes",
    specialization: "In-Person Classroom & Foundations",
    qualification: "Senior Educator"
  },
  {
    teacher_id_code: "TG-FAC-104",
    name: "Laura Gorham",
    title: "Ms.",
    first_name: "Laura",
    last_name: "Gorham",
    gender: "Female",
    email: "laura_gorham@yahoo.com",
    phone: "+1 713-498-6884",
    dob: "1966-05-08",
    age: 60,
    address_line1: "3506 Pheasant Lane",
    city: "Pearland",
    postal_code: "77581",
    state: "Texas",
    country: "US",
    joining_date: "2025-08-01",
    preferred_delivery_method: "in center",
    user_name: "laura.gorham",
    specialization: "In-Center Elementary & Middle School",
    qualification: "Certified Faculty Educator"
  },
  {
    teacher_id_code: "TG-FAC-105",
    name: "Jignesh Upadhyaya",
    title: "Mr.",
    first_name: "Jignesh",
    last_name: "Upadhyaya",
    gender: "Male",
    email: "jigneshu2004@yahoo.com",
    phone: "+1 281-760-6386",
    dob: "1970-12-31",
    age: 55,
    address_line1: "Pearland Center Blvd",
    city: "Pearland",
    postal_code: "77584",
    state: "Texas",
    country: "US",
    joining_date: "2021-12-13",
    preferred_delivery_method: "in center",
    user_name: "jupadhyaya",
    specialization: "Mathematics, Physics & Test Prep",
    qualification: "Master of Science in STEM"
  },
  {
    teacher_id_code: "TG-FAC-106",
    name: "Katrina Baines",
    title: "Mrs.",
    first_name: "Katrina",
    last_name: "Baines",
    gender: "Female",
    email: "katrina.baines@yahoo.com",
    phone: "+1 832-641-5525",
    dob: "1975-12-26",
    age: 50,
    address_line1: "11038 Heather Bluff Lane",
    city: "Houston",
    postal_code: "77075",
    state: "Texas",
    country: "US",
    joining_date: "2024-05-01",
    preferred_delivery_method: "in center",
    user_name: "kbaines",
    specialization: "Language Arts, Reading & Writing",
    qualification: "Certified Academic Instructor"
  },
  {
    teacher_id_code: "TG-FAC-107",
    name: "Chloe Self",
    title: "Ms.",
    first_name: "Chloe",
    last_name: "Self",
    gender: "Female",
    email: "chloe.r.self@gmail.com",
    phone: "+1 832-600-1004",
    dob: "2003-11-25",
    age: 22,
    address_line1: "2039 Westside Court",
    city: "Sugar Land",
    postal_code: "77478",
    state: "Texas",
    country: "US",
    joining_date: "2026-06-01",
    preferred_delivery_method: "in center",
    user_name: "chloe.r.self",
    specialization: "STEM, Chemistry & Accelerated Learning",
    qualification: "Faculty Instructor"
  },
  {
    teacher_id_code: "TG-FAC-108",
    name: "Abel Dominguez",
    title: "Mr.",
    first_name: "Abel",
    last_name: "Dominguez",
    gender: "Male",
    email: "abeldominguez10000@gmail.com",
    phone: "+1 832-288-7224",
    dob: "1993-08-18",
    age: 33,
    address_line1: "6125 Fuqua St",
    city: "Houston",
    postal_code: "77048",
    state: "Texas",
    country: "US",
    joining_date: "2020-09-12",
    preferred_delivery_method: "in center",
    user_name: "dominguez.abel",
    specialization: "Mathematics & Physical Sciences",
    qualification: "Certified Faculty Educator"
  },
  {
    teacher_id_code: "TG-FAC-109",
    name: "Patricia Landrum",
    title: "Mrs.",
    first_name: "Patricia",
    last_name: "Landrum",
    gender: "Female",
    email: "tclandrum@hotmail.com",
    phone: "+1 713-899-7890",
    dob: "1968-12-07",
    age: 57,
    address_line1: "3907 Somerville Lake Ct",
    city: "Pearland",
    postal_code: "77581",
    state: "Texas",
    country: "US",
    joining_date: "2024-02-12",
    preferred_delivery_method: "in center",
    user_name: "trish.landrum",
    specialization: "Language Arts, STAAR & Study Skills",
    qualification: "Senior Educator"
  },
  {
    teacher_id_code: "TG-FAC-110",
    name: "Logan Fenner",
    title: "Ms.",
    first_name: "Logan",
    last_name: "Fenner",
    gender: "Female",
    email: "fennelog@gmail.com",
    phone: "+1 936-900-9302",
    dob: "1997-01-27",
    age: 29,
    address_line1: "7373 Ardmore Street #1123",
    city: "Houston",
    postal_code: "77054",
    state: "Texas",
    country: "US",
    joining_date: "2025-03-18",
    preferred_delivery_method: "in center",
    user_name: "logan.fenner",
    specialization: "Algebra, Calculus & Geometry",
    qualification: "B.S. in Mathematics"
  },
  {
    teacher_id_code: "TG-FAC-111",
    name: "Achalesh Amar",
    title: "Mr.",
    first_name: "Achalesh",
    last_name: "Amar",
    gender: "Female",
    email: "achalesh@gmail.com",
    phone: "+1 713-357-8216",
    dob: "1971-01-12",
    age: 55,
    address_line1: "2607 Parkbriar Lane",
    city: "Pearland",
    postal_code: "77584",
    state: "Texas",
    country: "US",
    joining_date: "2025-03-27",
    preferred_delivery_method: "in center",
    user_name: "achalesh.amar",
    specialization: "Social Sciences, History & Humanities",
    qualification: "Certified Faculty Educator"
  },
  {
    teacher_id_code: "TG-FAC-112",
    name: "Nicole Abner",
    title: "Ms.",
    first_name: "Nicole",
    last_name: "Abner",
    gender: "Female",
    email: "nicoleabner1@gmail.com",
    phone: "+1 713-819-4727",
    dob: "1990-01-01",
    age: 36,
    address_line1: "Rodeo Dr",
    city: "Manvel",
    postal_code: "77578",
    state: "Texas",
    country: "US",
    joining_date: "2021-08-02",
    preferred_delivery_method: "in center",
    user_name: "nicole.abner",
    specialization: "Primary & Middle School Foundations",
    qualification: "Certified Academic Instructor"
  },
  {
    teacher_id_code: "TG-FAC-113",
    name: "Paula Isaac",
    title: "Mrs.",
    first_name: "Paula",
    last_name: "Isaac",
    gender: "Female",
    email: "mrspisaac2022@gmail.com",
    phone: "+1 501-519-2000",
    dob: "1980-01-01",
    age: 46,
    address_line1: "14123 Winecup Ln",
    city: "Houston",
    postal_code: "77047",
    state: "Texas",
    country: "US",
    joining_date: "2021-12-08",
    preferred_delivery_method: "Any",
    user_name: "paula.isaac",
    specialization: "Hybrid Online & On-Campus Tutoring",
    qualification: "Certified Faculty Educator"
  },
  {
    teacher_id_code: "TG-FAC-114",
    name: "Tamara Gipson",
    title: "Ms.",
    first_name: "Tamara",
    last_name: "Gipson",
    gender: "Female",
    email: "tamaratechbytes@gmail.com",
    phone: "+1 281-755-0107",
    dob: "1973-08-03",
    age: 53,
    address_line1: "309 Hutcheson Street",
    city: "Houston",
    postal_code: "77003",
    state: "Texas",
    country: "US",
    joining_date: "2026-04-29",
    preferred_delivery_method: "InPerson",
    user_name: "tgipson",
    specialization: "Coding, 3D Printing & Applied Tech",
    qualification: "Technology & Computer Science Specialist"
  },
  {
    teacher_id_code: "TG-FAC-115",
    name: "Deja Getwood",
    title: "Ms.",
    first_name: "Deja",
    last_name: "Getwood",
    gender: "Female",
    email: "dejagetwood15@gmail.com",
    phone: "+1 409-365-5283",
    dob: "1996-10-25",
    age: 29,
    address_line1: "2910 Milam Street",
    city: "Houston",
    postal_code: "77006",
    state: "Texas",
    country: "US",
    joining_date: "2022-08-23",
    preferred_delivery_method: "Any",
    user_name: "deja.getwood",
    specialization: "Spanish, French & World Languages",
    qualification: "Linguistics & Certified Educator"
  },
  {
    teacher_id_code: "TG-FAC-116",
    name: "Kerry Rails",
    title: "Ms.",
    first_name: "Kerry",
    last_name: "Rails",
    gender: "Female",
    email: "kag9181@gmail.com",
    phone: "+1 409-497-1722",
    dob: "1981-09-01",
    age: 45,
    address_line1: "11575 Pearland Pkwy 4108",
    city: "Houston",
    postal_code: "77089",
    state: "Texas",
    country: "US",
    joining_date: "2025-11-17",
    preferred_delivery_method: "Any",
    user_name: "kerry.rails",
    specialization: "Economics, Government & Social Sciences",
    qualification: "Certified Academic Instructor"
  },
  {
    teacher_id_code: "TG-FAC-117",
    name: "Ryon Davis",
    title: "Mr.",
    first_name: "Ryon",
    last_name: "Davis",
    gender: "Male",
    email: "davisryon@gmail.com",
    phone: "+1 972-489-9296",
    dob: "1998-10-10",
    age: 27,
    address_line1: "7373 Ardmore Street",
    city: "Houston",
    postal_code: "77054",
    state: "Texas",
    country: "US",
    joining_date: "2025-09-24",
    preferred_delivery_method: "Any",
    user_name: "davisryon",
    specialization: "High School STEM & SAT/ACT Prep",
    qualification: "B.S. in Engineering & STEM Educator"
  }
];

// Default availability days and shift slots for faculty
const DEFAULT_AVAILABILITY_DAYS = ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
const DEFAULT_AVAILABILITY_SLOTS = [
  "Morning - 09:00 AM - 12:00 PM",
  "Afternoon - 01:00 PM - 04:00 PM",
  "Evening - 05:00 PM - 08:00 PM"
];

export async function runIngestionAndCleanup() {
  console.log("=========================================================================");
  console.log("🚀 STARTING OFFICIAL COURSES & TEACHERS INGESTION AND DEMO PURGE");
  console.log("=========================================================================\n");

  // --------------------------------------------------------------------------
  // STEP 1: VERIFY STUDENTS INTEGRITY (MUST PRESERVE 71 STUDENTS)
  // --------------------------------------------------------------------------
  console.log("▶ [STEP 1/5] Verifying Student Records in Supabase (Safeguard)...");
  const { count: studentCount, error: stuErr } = await supabaseAdmin
    .from("students")
    .select("*", { count: "exact", head: true });

  if (stuErr) {
    console.error("❌ Error checking students:", stuErr.message);
  } else {
    console.log(`  ✓ Found ${studentCount} active students in Supabase. These records will be STRICTLY PRESERVED.\n`);
  }

  // --------------------------------------------------------------------------
  // STEP 2: REMOVE PREVIOUS DEMO COURSES & INGEST 36 OFFICIAL COURSES
  // --------------------------------------------------------------------------
  console.log("▶ [STEP 2/5] Purging Previous Courses & Ingesting Official 36 Courses into Supabase...");
  
  // Clean all existing courses in Supabase
  const { error: delCourseErr } = await supabaseAdmin
    .from("courses")
    .delete()
    .neq("id", "00000000-0000-0000-0000-000000000000"); // deletes all rows

  if (delCourseErr) {
    console.warn("  Notice purging previous courses:", delCourseErr.message);
  } else {
    console.log("  ✓ Previous courses catalog purged successfully.");
  }

  // Insert 36 official courses
  const courseRows = OFFICIAL_COURSES.map(c => ({
    course_code: c.course_code,
    name: c.name,
    description: c.description,
    age_group: c.age_group,
    duration: c.duration,
    fee: c.fee,
    max_students: c.max_students,
    required_teacher_skills: c.category,
    status: "Active",
    course_material: JSON.stringify({
      category: c.category,
      grade_eligibility: [c.age_group]
    })
  }));

  const { data: insertedCourses, error: insCourseErr } = await supabaseAdmin
    .from("courses")
    .insert(courseRows)
    .select("id, name, course_code");

  if (insCourseErr) {
    throw new Error(`Failed to insert official courses: ${insCourseErr.message}`);
  }

  console.log(`  ✅ Successfully ingested ${insertedCourses?.length || 0} Official Courses into Supabase!\n`);

  // --------------------------------------------------------------------------
  // STEP 3: REMOVE PREVIOUS DEMO TEACHERS & INGEST 17 OFFICIAL TEACHERS
  // --------------------------------------------------------------------------
  console.log("▶ [STEP 3/5] Purging Previous Demo Teachers & Ingesting 17 Official Faculty into Supabase...");

  // Purge previous teachers from Supabase
  const { error: delTeacherErr } = await supabaseAdmin
    .from("teachers")
    .delete()
    .neq("id", "00000000-0000-0000-0000-000000000000");

  if (delTeacherErr) {
    console.warn("  Notice purging previous teachers:", delTeacherErr.message);
  } else {
    console.log("  ✓ Previous demo teachers purged successfully.");
  }

  // Also remove demo teacher profiles from profiles table (e.g. manikanta@topgrade.edu, teacher@topgrade.edu)
  const demoTeacherEmails = ["manikanta@topgrade.edu", "teacher@topgrade.edu"];
  for (const email of demoTeacherEmails) {
    await supabaseAdmin.from("profiles").delete().eq("email", email);
  }

  // Insert 17 official teachers
  const teacherRows = OFFICIAL_TEACHERS.map(t => ({
    teacher_id_code: t.teacher_id_code,
    name: t.name,
    dob: t.dob,
    age: t.age,
    qualification: t.qualification,
    phone: t.phone,
    email: t.email,
    specialization: t.specialization,
    experience: "5+ Years",
    joining_date: t.joining_date,
    salary: "$55,000",
    availability_days: DEFAULT_AVAILABILITY_DAYS,
    availability_slots: DEFAULT_AVAILABILITY_SLOTS,
    status: "Active"
  }));

  const { data: insertedTeachers, error: insTeacherErr } = await supabaseAdmin
    .from("teachers")
    .insert(teacherRows)
    .select("id, name, email, teacher_id_code");

  if (insTeacherErr) {
    throw new Error(`Failed to insert official teachers: ${insTeacherErr.message}`);
  }

  console.log(`  ✅ Successfully ingested ${insertedTeachers?.length || 0} Official Teachers into Supabase!\n`);

  // --------------------------------------------------------------------------
  // STEP 4: SYNCHRONIZE TEACHER PROFILES IN SUPABASE
  // --------------------------------------------------------------------------
  console.log("▶ [STEP 4/5] Synchronizing Teacher Profiles in Supabase `profiles` table...");
  for (const t of OFFICIAL_TEACHERS) {
    const { data: existingProfile } = await supabaseAdmin
      .from("profiles")
      .select("id")
      .eq("email", t.email)
      .maybeSingle();

    if (!existingProfile) {
      await supabaseAdmin.from("profiles").insert({
        email: t.email,
        full_name: `${t.title} ${t.name}`.trim(),
        phone: t.phone,
        role: "TEACHER",
        status: "Active"
      });
    } else {
      await supabaseAdmin.from("profiles").update({
        full_name: `${t.title} ${t.name}`.trim(),
        phone: t.phone,
        role: "TEACHER",
        status: "Active"
      }).eq("id", existingProfile.id);
    }
  }
  console.log("  ✓ Synchronized all 17 teacher user profiles.\n");

  // --------------------------------------------------------------------------
  // STEP 5: FINAL AUDIT & VALIDATION
  // --------------------------------------------------------------------------
  console.log("▶ [STEP 5/5] Performing Final Supabase Roster Audit...");
  const { count: finalCourseCount } = await supabaseAdmin
    .from("courses")
    .select("*", { count: "exact", head: true });

  const { count: finalTeacherCount } = await supabaseAdmin
    .from("teachers")
    .select("*", { count: "exact", head: true });

  const { count: finalStudentCount } = await supabaseAdmin
    .from("students")
    .select("*", { count: "exact", head: true });

  console.log("=========================================================================");
  console.log("🎉 INGESTION & PURGE COMPLETE - FINAL DATABASE STATE:");
  console.log(`   • Total Official Courses in Supabase: ${finalCourseCount} (Expected: 36)`);
  console.log(`   • Total Official Teachers in Supabase: ${finalTeacherCount} (Expected: 17)`);
  console.log(`   • Total Students in Supabase:         ${finalStudentCount} (Expected: 71)`);
  console.log("=========================================================================\n");
}

// Execute if run directly
if (process.argv[1]?.includes("ingest_official_courses_and_teachers")) {
  runIngestionAndCleanup()
    .then(() => process.exit(0))
    .catch((err) => {
      console.error("❌ INGESTION FAILED:", err);
      process.exit(1);
    });
}
