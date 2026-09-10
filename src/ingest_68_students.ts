import dotenv from "dotenv";
import { createClient } from "@supabase/supabase-js";
import fs from "fs";
import path from "path";

dotenv.config();

const supabaseUrl = process.env.SUPABASE_URL || "";
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY || "";

if (!supabaseUrl || !supabaseKey) {
  console.error("Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY in .env");
  process.exit(1);
}

const supabase = createClient(supabaseUrl, supabaseKey, {
  auth: { autoRefreshToken: false, persistSession: false }
});

const rawCsv = `Tanyea Fowls,832) 209-9729,tanyeafowls@yahoo.com,Jacob,Grade 5,Sablatura, Reading Comp
Angel Lewis,832- 322-2239,missyou1970@yahoo.com,Kamauri Hunter,grade K,IL Texas,Reading
Tierra Perry,8328888512,,,,,
DULCE Eduardo Garcia,8322762098,gdulce955@gmail.com,Camila,Grade 3," Lahon elem,",Reading
Elizabeth Guillory,832-589-3676,guilloryea@gmail.com,Giselle,grade 4,Rogers,Afterschool
Esperanza garcia,8324311633,esperanzagarciaovalle@gmail.com,Leandro, grade 4,Silverlake,Afterschool
Lani Mercado,713-319-8985,lani.garrido@gmail.com,Kiron & Cara,GRADES 4 & 2,Silverlake,Afterschool
Anna Jan,626-808-2351,annasjan@gmail.com,Evelyn,grade K,Silvercrest,Afterschool
Chad Williams,9042268065,Chad8404@gmail.com,CJ,grade 3,,Reading
Yoselin Kuzniar,8323447553,yosyaranda18@gmail.com,Ethan Kuzniar,grade 4,,STAAR
Conner Kuzniar,7132080947,conner.skuzniar@gmail.com,,,,
Loan Nguyen,2816179583,nloan969@gmail.com,Minh,grade K,Silverlake elem,Afterschool
Tu Hyunh,7142616170,tuhuynh0046@gmail.com,,,,
Alexis Merritt,(334) 372-5625,megul41@gmail.com,Peyton,grade 5,Rogers,Afterschool
Claudette Fonndikum,7133825195,,Uriel,,,STAAR prep
Selena Miller,7138200880,selenademps@hotmail.com,Samson Miller,grade K,Red Duke,Afterschool
Quinisha Starks,2298541224,qunisha.starks1@gmail.com,Logan Starks,Grade 6,Sam Jamison,Math & Reading
Janice Perkins,919-215-3437,deeutley@gmail.com,Joseph,Going to 1st grade-,,"Summer camp & Math, writing, reading tutoring"
Minny Bhatty,662-617-9073,minnybhatty@gmail.com,Sumay,Grade 7 ,Sablatura,Writing skills
Prakash Motwani,304-419-5289,pmots@yahoo.com,Chirag,grade 11,Dawson,AP Physics
Chirag Motwani,304-767-2676,cmotwani10@gmail.com,,,,
Rekha Nair,3463910006,nair.rekha11@gmail.com,Kris,grade9,,Geometry
Natalie Chaiban,504-495-3594,n_pilotte@yahoo.com,"Lydia, Elias",grade K,Red Duke,summer camp
Uma Narula,346-546-9546,umanutritionist@gmail.com,Saanvi Narula,Grade 12,Clear Creek HS,College Essay workshop
Barbara Habal,8325262483,barbarajaycacho@yahoo.com,Christopher Habal,Grade 12,HPVA-High School of Performing & Visual Arts,"SAT prep, College Essay workshop"
Lexii Zielinski,8322749851,alexisszielinski@gmail.com,Sky Zielinski,grade K,Massey Ranch,Afterschool
marisol penaloza,(832) 941-8419,marisol.maldonado96@icloud.com,eric penaloza & Robert Mora,"grade K, grade 6",Mary Marek & Nolan Ryan,Afterschool
Mili Chavez,346-313-5879,pabloymili2023@gmail.com,Faith,grade 4,Silverlake,Afterschool
Chantha,3465744701,chanthavorng@icloud.com,Amir Douhdouh,grade 8,Berry Miller,Afterschool
Dhara Desai,7138944018,dhara.6n@gmail.com,Dhyana & Aarshiv,"Grade 2, Grade pre-K",Glen York elem,GT prep/ Math & Reading
Rashmi Aggarwal,7138559596,rashmi.esq@gmail.com,Amisha,grade 7,Berry Miller,PAP Spanish
Linda Duggal,8323143624,duggaljd14@gmail.com,Deven,grade 11,Dawson,"AP Chem , SAT prep"
Sandeep Duggal,8323143626,duggalmd@aol.com,,,,
Anvita Gupta,3124970695,anvita512@gmail.com,Noshi & Kiaan,Grade 11 & grade 9,,
Nitin Wadhwa,8327548223,nwadhwa78@gmail.com,Raina,grade 5,,Hindi
Brandon Kimmons,9012465376,kimmonscare@gmail.com,Brandon,grade 3...4,,Math  
Kaushalya Amunugama,5733085088,kaushalya.amunugama@gmail.com,Vinoli,grade 5,,Reading Writing
Minny Bhatty,6626179073,minnybhatty@gmail.com,Sumay,grade 6...7,,Writing
Ayan Monpara,2817360945,monpara@gmail.com,Anushka ,grade 12,Dawson,SAT prep
Kirtida Monpara,7813531272,,,,,
Blake Johnson,9737604734,mykix3@gmail.com,Kaleb Smith,grade 12,Pearland HS,SAT prep
Kaleb Smith,9083402976,,,,,
Serena Ayala,8326070195,smayala79@yahoo.com,Serena,grade 9,Turner,Alge 1
Serena III,9799007400,,,,,
Gayathri Sathiamoorthy,6179593713,gayathri.sathiamoorthy@gmail.com,Hari Charan,grade 11,Dawson,SAT prep
Bindu Aghari,8322155432,,Reshmika,grade 9,Dawson,
Shiva Marthy,2818515873,Shiva90@gmail.com,Nikhil,grade 12,Shadow Creek,SAT prep
Chaitanya Gundapaneni,2816149093,chaitu900@gmail.com,,,,
Garrett Grant,7132998351,ggrantl@renewedstrength.biz,Brooke,grade 8,Berry Miller,Math
Vondeah Grant,7137253665,vondeahgrant@yahoo.com,,,,
Elizabeth Osorio,7133021264,o.elizabeth@icloud.com,Ulaysha,grade 12,Shadow Creek,TSI prep
Ulaysha Gibbs,7138200792,ulayshagibbs@gmail.com,,,,
Amy Carter,8328164463,carterae2020@gmail.com,Madison Carter,grade 6,Sablatura,Afterschool
Florence Buaku,7347091718,flossied@gmail.com,Isabelle & Julia Buaku,Grades 3 & 6,Silvercrest & Rogers,Afterschool
Judith Rawls,2023683012,jcothorn@gmail.com,Abigail Rawls,Grade 6,Rogers,Afterschool
Yordana Bridger,,,Abi Bridger,Grade 6,Rogers,Afterschool
Geraldine Raja,7164640517,gerijosie@yahoo.com,Viviana,grade 2,"Silvercrest,",Afterschool
Soosan Pappan,8327467799,soosanmathai@yahoo.com,Nehemiah & Bezaleel,grade6 & 7,"Sablatura, PJHW",ESL
Lakeshia Morgan,9364147009,lakeshiamorgan880,"Kaliyah, Kalena",grades 4 & 2,Wilder elem,Reading & Math
Chardae Evans,3463199044,chardaeevans1@gmail.com,Kayden Jones,grade 4,The Imani school,Math
Brindha Madhan,2818096351,brindha.biotek@gmail.com,AmudhanMadhan Kumar,grade 12,Dawson,College Essay writing
Annie Smith,832-275-5298,AnnieB@cgsfs.com,"Sophie, Dahlia",Grades 9 & 5,"Turner, Rogers",Afterschool
Chardaet Galvan,713-858-5771,,,,,
Ke Li,8322880435,ke.li@outlook.com,Evan Li,grade 10,Dawson,"PAP Chemistry, PAP Alge 2"
Wes Murdoch,8327123339,wesdmurdock@hotmail.com,Micah,grade 7,PJHS,"Reading, Handwriting"
Rosie Lopez,8328797941,rosieflopez@yahoo.com,Ava,grade 10,Pearland HS,PAP Geometry
Frank Fernandez,7138236790,ftfern24@yahoo.com,Charlotte,grade 12,Manvel HS,Math
Liz Rodwell,4017439608,elizabethannrodwell@gmail.com,Charlie,grade 4,Massey ranch,Reading`;

function parseCsvLine(text: string): string[] {
  const result: string[] = [];
  let cur = '';
  let inQuotes = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (c === '"') inQuotes = !inQuotes;
    else if (c === ',' && !inQuotes) {
      result.push(cur.trim());
      cur = '';
    } else {
      cur += c;
    }
  }
  result.push(cur.trim());
  return result;
}

function cleanPhone(p: string) {
  const num = p.replace(/[^0-9]/g, '');
  if (num.length === 10) return `+1 ${num.slice(0, 3)} ${num.slice(3, 6)} ${num.slice(6)}`;
  if (num.length === 11 && num.startsWith('1')) return `+1 ${num.slice(1, 4)} ${num.slice(4, 7)} ${num.slice(7)}`;
  return p.trim() || null;
}

function cleanName(n: string) {
  return n.trim().replace(/\s+/g, ' ');
}

// Convert student name to email-safe slug
function toEmailSlug(name: string) {
  return name.toLowerCase().replace(/[^a-z0-9]/g, '.').replace(/\.+/g, '.').replace(/^\.|\.$/g, '');
}

async function main() {
  console.log("==================================================");
  console.log("  TOPGRADE CRM - CSV STUDENT & LOGIN MIGRATION");
  console.log("==================================================");

  // ─── STEP 1: FETCH EXISTING DATA TO PREVENT CONFLICTS ───
  console.log("\n[1/5] Checking existing courses and students in Supabase...");
  const { data: existingCourses } = await supabase.from("courses").select("*");
  const { data: existingStudents } = await supabase.from("students").select("*");
  const { data: authUsersData } = await supabase.auth.admin.listUsers({ perPage: 1000 });

  const coursesMap = new Map<string, any>((existingCourses || []).map(c => [c.name.toLowerCase(), c]));
  const existingStuCodes = new Set<string>((existingStudents || []).map(s => s.student_id_code));
  const existingAuthEmails = new Set<string>((authUsersData?.users || []).map(u => u.email?.toLowerCase()).filter(Boolean) as string[]);

  console.log(` -> Existing Courses: ${existingCourses?.length || 0}`);
  console.log(` -> Existing Students: ${existingStudents?.length || 0}`);
  console.log(` -> Existing Auth Users: ${authUsersData?.users?.length || 0}`);

  // ─── STEP 2: CREATE NEW COURSES DERIVED FROM CSV ───
  console.log("\n[2/5] Ingesting unique courses from CSV...");
  const coursesToCreate = [
    { name: "Reading Comprehension", code: "CRS-REA-101", ageGroup: "Elementary & Middle", skills: "Language Arts & English" },
    { name: "Reading & Language Arts", code: "CRS-REA-102", ageGroup: "Elementary (Grade K-5)", skills: "Language Arts & English" },
    { name: "Afterschool Program", code: "CRS-AFT-101", ageGroup: "Elementary & Middle (Grade K-8)", skills: "General Academic" },
    { name: "STAAR Prep", code: "CRS-STA-101", ageGroup: "Grade 4-8", skills: "Standardized Testing" },
    { name: "Math & Reading Foundations", code: "CRS-MR-101", ageGroup: "Elementary (Grade 1-5)", skills: "Core Elementary" },
    { name: "Summer Camp & Academic Tutoring", code: "CRS-SMP-101", ageGroup: "Elementary & Middle", skills: "General Academic" },
    { name: "Writing Skills & Handwriting", code: "CRS-WRT-101", ageGroup: "Middle School (Grade 6-8)", skills: "Language Arts" },
    { name: "AP Physics", code: "CRS-PHY-101", ageGroup: "High School (Grade 11-12)", skills: "Physics & Science" },
    { name: "Geometry & PAP Geometry", code: "CRS-GEO-101", ageGroup: "High School (Grade 9-10)", skills: "Mathematics" },
    { name: "College Essay Workshop & Writing", code: "CRS-CEW-101", ageGroup: "High School (Grade 11-12)", skills: "College Admissions" },
    { name: "SAT Prep", code: "CRS-SAT-101", ageGroup: "High School (Grade 11-12)", skills: "College Admissions" },
    { name: "GT Prep (Gifted & Talented)", code: "CRS-GTP-101", ageGroup: "Elementary (Pre-K - Grade 3)", skills: "Advanced Learning" },
    { name: "PAP Spanish", code: "CRS-SPN-101", ageGroup: "Middle & High School", skills: "World Languages" },
    { name: "AP Chemistry & PAP Chemistry", code: "CRS-CHM-101", ageGroup: "High School (Grade 10-12)", skills: "Chemistry & Science" },
    { name: "Hindi Language", code: "CRS-HIN-101", ageGroup: "Elementary & Middle", skills: "World Languages" },
    { name: "Elementary Math", code: "CRS-MAT-101", ageGroup: "Elementary (Grade 3-5)", skills: "Mathematics" },
    { name: "Algebra 1 & PAP Algebra 2", code: "CRS-ALG-101", ageGroup: "High School (Grade 9-11)", skills: "Mathematics" },
    { name: "TSI Prep", code: "CRS-TSI-101", ageGroup: "High School (Grade 11-12)", skills: "College Readiness" },
    { name: "ESL (English as a Second Language)", code: "CRS-ESL-101", ageGroup: "All Grades", skills: "Language Learning" }
  ];

  for (const c of coursesToCreate) {
    if (!coursesMap.has(c.name.toLowerCase())) {
      const scheduleMaterial = JSON.stringify({
        schedule: [
          { id: `sch-${c.code.toLowerCase()}-1`, day: "Monday", slot: "09:00 AM - 10:30 AM", room: "Room 101", programTrack: c.name, teacherName: "Assigned Faculty", teacherId: "" },
          { id: `sch-${c.code.toLowerCase()}-2`, day: "Wednesday", slot: "01:00 PM - 02:30 PM", room: "Room 101", programTrack: c.name, teacherName: "Assigned Faculty", teacherId: "" }
        ]
      });

      const { data: inserted, error: cErr } = await supabase.from("courses").insert([{
        name: c.name,
        course_code: c.code,
        description: `Comprehensive TopGrade curriculum for ${c.name}`,
        age_group: c.ageGroup,
        duration: "3 Months",
        fee: 450,
        max_students: 40,
        required_teacher_skills: c.skills,
        course_material: scheduleMaterial,
        status: "Active"
      }]).select().single();

      if (!cErr && inserted) {
        console.log(`  + Created course: ${c.name} (${c.code})`);
        coursesMap.set(c.name.toLowerCase(), inserted);
      } else {
        console.warn(`  ! Could not create course ${c.name}:`, cErr?.message);
      }
    } else {
      console.log(`  ✓ Course already exists: ${c.name}`);
    }
  }

  // ─── STEP 3: PARSE AND NORMALIZE 68 CSV ENTRIES ───
  console.log("\n[3/5] Parsing 68 CSV rows...");
  const lines = rawCsv.split('\n').filter(l => l.trim().length > 0);
  console.log(` -> Found ${lines.length} rows in CSV.`);

  const studentDefaultPassword = "Student@TopGrade2026";
  const parentDefaultPassword = "Parent@TopGrade2026";

  const credentialsRoster: any[] = [];
  let addedStudentsCount = 0;
  let addedParentAccountsCount = 0;

  for (let i = 0; i < lines.length; i++) {
    const rowNum = i + 1;
    const line = lines[i] || "";
    const cols = parseCsvLine(line);
    const rawStudentName = cols[0] || `Student ${rowNum}`;
    const rawPhone = cols[1] || "";
    const rawEmail = cols[2] || "";
    const rawParentName = cols[3] || "";
    const rawGrade = cols[4] || "";
    const rawSchool = cols[5] || "";
    const rawCourse = cols[6] || "";

    const studentName = cleanName(rawStudentName);
    const studentPhone = cleanPhone(rawPhone);
    const parentName = rawParentName.trim() ? cleanName(rawParentName) : null;
    const grade = rawGrade.trim() ? cleanName(rawGrade) : null;
    const school = rawSchool.trim() ? cleanName(rawSchool) : null;
    const course = rawCourse.trim() ? cleanName(rawCourse) : null;

    // Student ID Code: TG-STU-2026-5001 to 5068
    const studentCode = `TG-STU-2026-${5000 + rowNum}`;

    // Normalize student login email
    const emailSlug = toEmailSlug(studentName);
    const studentLoginEmail = `${emailSlug}.${rowNum}@student.topgrade.edu`;
    const studentContactEmail = rawEmail.trim() ? rawEmail.trim().toLowerCase() : studentLoginEmail;

    // Check if student with this code or name already exists in Supabase
    const alreadyExists = existingStudents?.find(s => 
      s.student_id_code === studentCode || 
      (s.name.toLowerCase() === studentName.toLowerCase() && s.student_id_code.startsWith("TG-STU-2026-50"))
    );

    let studentUserId: string | null = null;

    // ── Create Student Auth User ──
    if (!existingAuthEmails.has(studentLoginEmail)) {
      try {
        const { data: stuAuth, error: authErr } = await supabase.auth.admin.createUser({
          email: studentLoginEmail,
          password: studentDefaultPassword,
          email_confirm: true,
          user_metadata: {
            role: "STUDENT",
            full_name: studentName,
            student_id_code: studentCode
          }
        });

        if (stuAuth?.user) {
          studentUserId = stuAuth.user.id;
          existingAuthEmails.add(studentLoginEmail);

          // Insert or update profiles table
          await supabase.from("profiles").upsert({
            id: studentUserId,
            email: studentLoginEmail,
            full_name: studentName,
            phone: studentPhone || "",
            role: "STUDENT",
            status: "ACTIVE"
          });
        } else if (authErr) {
          console.warn(`    ! Auth user creation note for student ${studentName}:`, authErr.message);
        }
      } catch (e: any) {
        console.warn(`    ! Auth user exception for ${studentLoginEmail}:`, e.message);
      }
    } else {
      // Find user ID from list
      const matchedUser = authUsersData?.users?.find(u => u.email?.toLowerCase() === studentLoginEmail);
      studentUserId = matchedUser?.id || null;
    }

    // Compute age from grade
    let computedAge: number | null = null;
    if (grade) {
      const gLower = grade.toLowerCase();
      if (gLower.includes("pre-k")) computedAge = 4;
      else if (gLower.includes("k")) computedAge = 5;
      else if (gLower.includes("1st") || gLower.includes("1")) computedAge = 6;
      else if (gLower.includes("2")) computedAge = 7;
      else if (gLower.includes("3")) computedAge = 8;
      else if (gLower.includes("4")) computedAge = 9;
      else if (gLower.includes("5")) computedAge = 10;
      else if (gLower.includes("6")) computedAge = 11;
      else if (gLower.includes("7")) computedAge = 12;
      else if (gLower.includes("8")) computedAge = 13;
      else if (gLower.includes("9")) computedAge = 14;
      else if (gLower.includes("10")) computedAge = 15;
      else if (gLower.includes("11")) computedAge = 16;
      else if (gLower.includes("12")) computedAge = 17;
    }

    // ── Create Student Database Record in 'students' table ──
    if (!alreadyExists) {
      const studentRecord = {
        user_id: studentUserId,
        student_id_code: studentCode,
        name: studentName,
        phone: studentPhone,
        email: studentContactEmail,
        father_name: parentName,
        mother_name: null,
        guardian: null,
        father_phone: parentName ? studentPhone : null,
        mother_phone: null,
        program: course || "General Academic Track",
        status: "ACTIVE",
        gender: "Not Specified",
        dob: null,
        age: computedAge || 12,
        nationality: grade ? `Grade: ${grade}` : null,
        address: school ? `School: ${school}` : null,
        alternate_address: null,
        medical_notes: null,
        pricing_type: "Standard Tuition",
        purchased_hours: 0,
        discount: null,
        discount_approved: false
      };

      const { data: insertedStu, error: insErr } = await supabase.from("students").insert([studentRecord]).select().single();
      if (!insErr && insertedStu) {
        addedStudentsCount++;
      } else {
        console.warn(`  ! Could not insert student ${studentName} into DB:`, insErr?.message);
      }
    }

    // ── Create Parent Auth User (if parentName is provided) ──
    let parentLoginEmail: string | null = null;
    if (parentName) {
      // Check if rawEmail is available, valid, and not already claimed by student
      const isValidEmail = (em: string) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(em);
      let desiredParentEmail = "";
      
      if (rawEmail.trim() && isValidEmail(rawEmail.trim()) && !existingAuthEmails.has(rawEmail.trim().toLowerCase())) {
        desiredParentEmail = rawEmail.trim().toLowerCase();
      } else {
        desiredParentEmail = `parent.${toEmailSlug(parentName)}.${rowNum}@parents.topgrade.edu`;
      }

      parentLoginEmail = desiredParentEmail;

      if (!existingAuthEmails.has(desiredParentEmail)) {
        try {
          const { data: parentAuth, error: pAuthErr } = await supabase.auth.admin.createUser({
            email: desiredParentEmail,
            password: parentDefaultPassword,
            email_confirm: true,
            user_metadata: {
              role: "PARENT",
              full_name: parentName,
              phone: studentPhone || "",
              child_name: studentName,
              child_code: studentCode
            }
          });

          if (parentAuth?.user) {
            existingAuthEmails.add(desiredParentEmail);
            addedParentAccountsCount++;

            // Insert into profiles table
            await supabase.from("profiles").upsert({
              id: parentAuth.user.id,
              email: desiredParentEmail,
              full_name: parentName,
              phone: studentPhone || "",
              role: "PARENT",
              status: "ACTIVE"
            });
          } else if (pAuthErr) {
            console.warn(`    ! Auth parent creation note for ${parentName}:`, pAuthErr.message);
          }
        } catch (e: any) {
          console.warn(`    ! Auth parent exception for ${desiredParentEmail}:`, e.message);
        }
      }
    }

    credentialsRoster.push({
      rowNum,
      studentCode,
      studentName,
      studentLoginEmail,
      studentPassword: studentDefaultPassword,
      studentContactEmail: rawEmail || "Not provided",
      phone: studentPhone || "Not provided",
      grade: grade || "Not provided",
      school: school || "Not provided",
      course: course || "General Track",
      parentName: parentName || "Not provided (Available later)",
      parentLoginEmail: parentLoginEmail || "N/A (No parent listed)",
      parentPassword: parentLoginEmail ? parentDefaultPassword : "N/A"
    });

    if (rowNum % 10 === 0 || rowNum === lines.length) {
      console.log(`  Processed ${rowNum}/${lines.length} students...`);
    }
  }

  // ─── STEP 4: GENERATE EXPORTABLE CREDENTIALS ROSTER CSV ───
  console.log("\n[4/5] Writing exportable credentials roster...");
  const csvHeaders = "Row,Student ID,Student Name,Student Login Email,Student Password,Personal Email,Phone,Grade,School,Enrolled Course,Parent Name,Parent Login Email,Parent Password\n";
  const csvRows = credentialsRoster.map(r => 
    `"${r.rowNum}","${r.studentCode}","${r.studentName}","${r.studentLoginEmail}","${r.studentPassword}","${r.studentContactEmail}","${r.phone}","${r.grade}","${r.school}","${r.course}","${r.parentName}","${r.parentLoginEmail}","${r.parentPassword}"`
  ).join("\n");

  const outputPath = path.resolve("c:/Users/91778/Downloads/PROJECTS/top grade CRM/topgrade/student_and_parent_credentials.csv");
  fs.writeFileSync(outputPath, csvHeaders + csvRows, "utf-8");
  console.log(`  ✓ Successfully wrote credentials to: ${outputPath}`);

  // ─── STEP 5: FINAL AUDIT & COUNTS ───
  console.log("\n[5/5] Performing final database count audit...");
  const { count: finalStudentCount } = await supabase.from("students").select("*", { count: "exact", head: true });
  const { count: finalCourseCount } = await supabase.from("courses").select("*", { count: "exact", head: true });
  const { count: finalProfileCount } = await supabase.from("profiles").select("*", { count: "exact", head: true });

  console.log("==================================================");
  console.log(`  MIGRATION EXECUTION COMPLETE!`);
  console.log(`  -> New Students Added: ${addedStudentsCount}`);
  console.log(`  -> New Parent Accounts Provisioned: ${addedParentAccountsCount}`);
  console.log(`  -> Total Students in Supabase: ${finalStudentCount} (Target: 71)`);
  console.log(`  -> Total Courses in Supabase: ${finalCourseCount}`);
  console.log(`  -> Total Profiles in Supabase: ${finalProfileCount}`);
  console.log("==================================================");
}

main().catch(err => {
  console.error("Migration failed:", err);
  process.exit(1);
});
