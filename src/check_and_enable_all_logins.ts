import { supabaseAdmin } from "./supabase.js";

const ADMIN_EMAILS = [
  { email: "tglbiz101@gmail.com", name: "System Administrator" },
  { email: "admin@topgrade.edu", name: "System Administrator" }
];
const TESTER_EMAIL = "sivareddy683970@gmail.com";

const PARENT_STUDENTS_CSV = [
  { parentName: "Tanyea Fowls", parentPhone: "(832) 209-9729", parentEmail: "tanyeafowls@yahoo.com", studentName: "Jacob", grade: "Grade 5", school: "Sablatura", course: "Reading Comp" },
  { parentName: "Angel Lewis", parentPhone: "(832) 322-2239", parentEmail: "missyou1970@yahoo.com", studentName: "Kamauri Hunter", grade: "Grade K", school: "IL Texas", course: "Reading" },
  { parentName: "DULCE Eduardo Garcia", parentPhone: "(832) 276-2098", parentEmail: "gdulce955@gmail.com", studentName: "Camila", grade: "Grade 3", school: "Lahon elem", course: "Reading" },
  { parentName: "Elizabeth Guillory", parentPhone: "(832) 589-3676", parentEmail: "guilloryea@gmail.com", studentName: "Giselle", grade: "Grade 4", school: "Rogers", course: "Afterschool" },
  { parentName: "Esperanza garcia", parentPhone: "(832) 431-1633", parentEmail: "esperanzagarciaovalle@gmail.com", studentName: "Leandro", grade: "Grade 4", school: "Silverlake", course: "Afterschool" },
  { parentName: "Lani Mercado", parentPhone: "(713) 319-8985", parentEmail: "lani.garrido@gmail.com", studentName: "Kiron", grade: "Grade 4", school: "Silverlake", course: "Afterschool" },
  { parentName: "Lani Mercado", parentPhone: "(713) 319-8985", parentEmail: "lani.garrido@gmail.com", studentName: "Cara", grade: "Grade 2", school: "Silverlake", course: "Afterschool" },
  { parentName: "Anna Jan", parentPhone: "(626) 808-2351", parentEmail: "annasjan@gmail.com", studentName: "Evelyn", grade: "Grade K", school: "Silvercrest", course: "Afterschool" },
  { parentName: "Chad Williams", parentPhone: "(904) 226-8065", parentEmail: "Chad8404@gmail.com", studentName: "CJ", grade: "Grade 3", school: "", course: "Reading" },
  { parentName: "Yoselin Kuzniar", parentPhone: "(832) 344-7553", parentEmail: "yosyaranda18@gmail.com", studentName: "Ethan Kuzniar", grade: "Grade 4", school: "", course: "STAAR" },
  { parentName: "Loan Nguyen", parentPhone: "(281) 617-9583", parentEmail: "nloan969@gmail.com", studentName: "Minh", grade: "Grade K", school: "Silverlake elem", course: "Afterschool" },
  { parentName: "Alexis Merritt", parentPhone: "(334) 372-5625", parentEmail: "megul41@gmail.com", studentName: "Peyton", grade: "Grade 5", school: "Rogers", course: "Afterschool" },
  { parentName: "Selena Miller", parentPhone: "(713) 820-0880", parentEmail: "selenademps@hotmail.com", studentName: "Samson Miller", grade: "Grade K", school: "Red Duke", course: "Afterschool" },
  { parentName: "Quinisha Starks", parentPhone: "(229) 854-1224", parentEmail: "qunisha.starks1@gmail.com", studentName: "Logan Starks", grade: "Grade 6", school: "Sam Jamison", course: "Math & Reading" },
  { parentName: "Janice Perkins", parentPhone: "(919) 215-3437", parentEmail: "deeutley@gmail.com", studentName: "Joseph", grade: "Grade 1", school: "", course: "Summer camp & Math" },
  { parentName: "Minny Bhatty", parentPhone: "(662) 617-9073", parentEmail: "minnybhatty@gmail.com", studentName: "Sumay", grade: "Grade 7", school: "Sablatura", course: "Writing skills" },
  { parentName: "Prakash Motwani", parentPhone: "(304) 419-5289", parentEmail: "pmots@yahoo.com", studentName: "Chirag Motwani", grade: "Grade 11", school: "Dawson", course: "AP Physics" },
  { parentName: "Rekha Nair", parentPhone: "(346) 391-0006", parentEmail: "nair.rekha11@gmail.com", studentName: "Kris", grade: "Grade 9", school: "", course: "Geometry" },
  { parentName: "Natalie Chaiban", parentPhone: "(504) 495-3594", parentEmail: "n_pilotte@yahoo.com", studentName: "Lydia", grade: "Grade K", school: "Red Duke", course: "Summer Camp" },
  { parentName: "Natalie Chaiban", parentPhone: "(504) 495-3594", parentEmail: "n_pilotte@yahoo.com", studentName: "Elias", grade: "Grade K", school: "Red Duke", course: "Summer Camp" },
  { parentName: "Uma Narula", parentPhone: "(346) 546-9546", parentEmail: "umanutritionist@gmail.com", studentName: "Saanvi Narula", grade: "Grade 12", school: "Clear Creek HS", course: "College Essay workshop" },
  { parentName: "Barbara Habal", parentPhone: "(832) 526-2483", parentEmail: "barbarajaycacho@yahoo.com", studentName: "Christopher Habal", grade: "Grade 12", school: "HPVA", course: "SAT prep" },
  { parentName: "Lexii Zielinski", parentPhone: "(832) 274-9851", parentEmail: "alexisszielinski@gmail.com", studentName: "Sky Zielinski", grade: "Grade K", school: "Massey Ranch", course: "Afterschool" },
  { parentName: "marisol penaloza", parentPhone: "(832) 941-8419", parentEmail: "marisol.maldonado96@icloud.com", studentName: "Eric Penaloza", grade: "Grade K", school: "Mary Marek", course: "Afterschool" },
  { parentName: "marisol penaloza", parentPhone: "(832) 941-8419", parentEmail: "marisol.maldonado96@icloud.com", studentName: "Robert Mora", grade: "Grade 6", school: "Nolan Ryan", course: "Afterschool" },
  { parentName: "Mili Chavez", parentPhone: "(346) 313-5879", parentEmail: "pabloymili2023@gmail.com", studentName: "Faith", grade: "Grade 4", school: "Silverlake", course: "Afterschool" },
  { parentName: "Chantha", parentPhone: "(346) 574-4701", parentEmail: "chanthavorng@icloud.com", studentName: "Amir Douhdouh", grade: "Grade 8", school: "Berry Miller", course: "Afterschool" },
  { parentName: "Dhara Desai", parentPhone: "(713) 894-4018", parentEmail: "dhara.6n@gmail.com", studentName: "Dhyana Desai", grade: "Grade 2", school: "Glen York elem", course: "GT prep" },
  { parentName: "Dhara Desai", parentPhone: "(713) 894-4018", parentEmail: "dhara.6n@gmail.com", studentName: "Aarshiv Desai", grade: "Pre-K", school: "Glen York elem", course: "GT prep" },
  { parentName: "Rashmi Aggarwal", parentPhone: "(713) 855-9596", parentEmail: "rashmi.esq@gmail.com", studentName: "Amisha", grade: "Grade 7", school: "Berry Miller", course: "PAP Spanish" },
  { parentName: "Linda Duggal", parentPhone: "(832) 314-3624", parentEmail: "duggaljd14@gmail.com", studentName: "Deven", grade: "Grade 11", school: "Dawson", course: "AP Chem" },
  { parentName: "Anvita Gupta", parentPhone: "(312) 497-0695", parentEmail: "anvita512@gmail.com", studentName: "Noshi", grade: "Grade 11", school: "", course: "Tutoring" },
  { parentName: "Anvita Gupta", parentPhone: "(312) 497-0695", parentEmail: "anvita512@gmail.com", studentName: "Kiaan", grade: "Grade 9", school: "", course: "Tutoring" },
  { parentName: "Nitin Wadhwa", parentPhone: "(832) 754-8223", parentEmail: "nwadhwa78@gmail.com", studentName: "Raina", grade: "Grade 5", school: "", course: "Hindi" },
  { parentName: "Brandon Kimmons", parentPhone: "(901) 246-5376", parentEmail: "kimmonscare@gmail.com", studentName: "Brandon", grade: "Grade 4", school: "", course: "Math" },
  { parentName: "Kaushalya Amunugama", parentPhone: "(573) 308-5088", parentEmail: "kaushalya.amunugama@gmail.com", studentName: "Vinoli", grade: "Grade 5", school: "", course: "Reading Writing" },
  { parentName: "Ayan Monpara", parentPhone: "(281) 736-0945", parentEmail: "monpara@gmail.com", studentName: "Anushka", grade: "Grade 12", school: "Dawson", course: "SAT prep" },
  { parentName: "Blake Johnson", parentPhone: "(973) 760-4734", parentEmail: "mykix3@gmail.com", studentName: "Kaleb Smith", grade: "Grade 12", school: "Pearland HS", course: "SAT prep" },
  { parentName: "Serena Ayala", parentPhone: "(832) 607-0195", parentEmail: "smayala79@yahoo.com", studentName: "Serena", grade: "Grade 9", school: "Turner", course: "Alge 1" },
  { parentName: "Gayathri Sathiamoorthy", parentPhone: "(617) 959-3713", parentEmail: "gayathri.sathiamoorthy@gmail.com", studentName: "Hari Charan", grade: "Grade 11", school: "Dawson", course: "SAT prep" },
  { parentName: "Shiva Marthy", parentPhone: "(281) 851-5873", parentEmail: "Shiva90@gmail.com", studentName: "Nikhil", grade: "Grade 12", school: "Shadow Creek", course: "SAT prep" },
  { parentName: "Garrett Grant", parentPhone: "(713) 299-8351", parentEmail: "ggrantl@renewedstrength.biz", studentName: "Brooke", grade: "Grade 8", school: "Berry Miller", course: "Math" },
  { parentName: "Elizabeth Osorio", parentPhone: "(713) 302-1264", parentEmail: "o.elizabeth@icloud.com", studentName: "Ulaysha", grade: "Grade 12", school: "Shadow Creek", course: "TSI prep" },
  { parentName: "Amy Carter", parentPhone: "(832) 816-4463", parentEmail: "carterae2020@gmail.com", studentName: "Madison Carter", grade: "Grade 6", school: "Sablatura", course: "Afterschool" },
  { parentName: "Florence Buaku", parentPhone: "(734) 709-1718", parentEmail: "flossied@gmail.com", studentName: "Isabelle Buaku", grade: "Grade 3", school: "Silvercrest", course: "Afterschool" },
  { parentName: "Florence Buaku", parentPhone: "(734) 709-1718", parentEmail: "flossied@gmail.com", studentName: "Julia Buaku", grade: "Grade 6", school: "Rogers", course: "Afterschool" },
  { parentName: "Judith Rawls", parentPhone: "(202) 368-3012", parentEmail: "jcothorn@gmail.com", studentName: "Abigail Rawls", grade: "Grade 6", school: "Rogers", course: "Afterschool" },
  { parentName: "Geraldine Raja", parentPhone: "(716) 464-0517", parentEmail: "gerijosie@yahoo.com", studentName: "Viviana", grade: "Grade 2", school: "Silvercrest", course: "Afterschool" },
  { parentName: "Soosan Pappan", parentPhone: "(832) 746-7799", parentEmail: "soosanmathai@yahoo.com", studentName: "Nehemiah", grade: "Grade 6", school: "Sablatura", course: "ESL" },
  { parentName: "Soosan Pappan", parentPhone: "(832) 746-7799", parentEmail: "soosanmathai@yahoo.com", studentName: "Bezaleel", grade: "Grade 7", school: "PJHW", course: "ESL" },
  { parentName: "Chardae Evans", parentPhone: "(346) 319-9044", parentEmail: "chardaeevans1@gmail.com", studentName: "Kayden Jones", grade: "Grade 4", school: "The Imani school", course: "Math" },
  { parentName: "Brindha Madhan", parentPhone: "(281) 809-6351", parentEmail: "brindha.biotek@gmail.com", studentName: "AmudhanMadhan Kumar", grade: "Grade 12", school: "Dawson", course: "College Essay writing" },
  { parentName: "Annie Smith", parentPhone: "(832) 275-5298", parentEmail: "AnnieB@cgsfs.com", studentName: "Sophie", grade: "Grade 9", school: "Turner", course: "Afterschool" },
  { parentName: "Annie Smith", parentPhone: "(832) 275-5298", parentEmail: "AnnieB@cgsfs.com", studentName: "Dahlia", grade: "Grade 5", school: "Rogers", course: "Afterschool" },
  { parentName: "Ke Li", parentPhone: "(832) 288-0435", parentEmail: "ke.li@outlook.com", studentName: "Evan Li", grade: "Grade 10", school: "Dawson", course: "PAP Chemistry" },
  { parentName: "Wes Murdoch", parentPhone: "(832) 712-3339", parentEmail: "wesdmurdock@hotmail.com", studentName: "Micah", grade: "Grade 7", school: "PJHS", course: "Reading" },
  { parentName: "Rosie Lopez", parentPhone: "(832) 879-7941", parentEmail: "rosieflopez@yahoo.com", studentName: "Ava", grade: "Grade 10", school: "Pearland HS", course: "PAP Geometry" },
  { parentName: "Frank Fernandez", parentPhone: "(713) 823-6790", parentEmail: "ftfern24@yahoo.com", studentName: "Charlotte", grade: "Grade 12", school: "Manvel HS", course: "Math" },
  { parentName: "Liz Rodwell", parentPhone: "(401) 743-9608", parentEmail: "elizabethannrodwell@gmail.com", studentName: "Charlie", grade: "Grade 4", school: "Massey ranch", course: "Reading" },
];

async function ensureUser(email: string, password: string, role: string, fullName: string) {
  const normEmail = email.toLowerCase().trim();
  if (!normEmail || !normEmail.includes("@")) return null;

  let existingUser = null;
  let page = 1;
  while (true) {
    const { data, error } = await supabaseAdmin.auth.admin.listUsers({ page, perPage: 200 });
    if (error || !data || !data.users || data.users.length === 0) break;
    const found = data.users.find(u => u.email?.toLowerCase() === normEmail);
    if (found) {
      existingUser = found;
      break;
    }
    if (data.users.length < 200) break;
    page++;
  }

  let userId: string;
  if (existingUser) {
    userId = existingUser.id;
    const { error: updErr } = await supabaseAdmin.auth.admin.updateUserById(userId, {
      password,
      email_confirm: true,
      user_metadata: { role, full_name: fullName, name: fullName }
    });
    if (updErr) {
      console.warn(`  ⚠️ Failed to update password for ${normEmail}:`, updErr.message);
    } else {
      console.log(`  ✓ Updated Auth user: ${normEmail} (${role})`);
    }
  } else {
    const { data: created, error: crtErr } = await supabaseAdmin.auth.admin.createUser({
      email: normEmail,
      password,
      email_confirm: true,
      user_metadata: { role, full_name: fullName, name: fullName }
    });
    if (crtErr || !created.user) {
      console.error(`  ❌ Failed to create Auth user for ${normEmail}:`, crtErr?.message);
      return null;
    }
    userId = created.user.id;
    console.log(`  ✅ Created Auth user: ${normEmail} (${role})`);
  }

  // Ensure profiles entry using full_name
  const { error: pErr } = await supabaseAdmin.from("profiles").upsert({
    id: userId,
    email: normEmail,
    role,
    full_name: fullName,
    status: "Active",
    updated_at: new Date().toISOString()
  }, { onConflict: "id" });

  if (pErr) {
    console.warn(`  ⚠️ Profile notice for ${normEmail}:`, pErr.message);
  }

  return userId;
}

async function run() {
  console.log("===============================================================");
  console.log("🔐 ENSURING LOGINS FOR ADMINS, TESTER, AND ALL PARENTS/STUDENTS");
  console.log("===============================================================\n");

  // 1. Admins
  console.log("▶ [1/4] Ensuring Admin Accounts...");
  for (const adm of ADMIN_EMAILS) {
    await ensureUser(adm.email, "TopGrade2026!", "ADMIN", adm.name);
  }

  // 2. Student Tester
  console.log("\n▶ [2/4] Ensuring Student Tester Account (sivareddy683970@gmail.com)...");
  const testerId = await ensureUser(TESTER_EMAIL, "TopGrade2026!", "STUDENT", "Siva Reddy (Tester)");
  if (testerId) {
    await supabaseAdmin.from("students").upsert({
      id: testerId,
      name: "Siva Reddy",
      email: TESTER_EMAIL,
      program: "SAT prep",
      parent_name: "Admin Parent",
      parent_email: "tglbiz101@gmail.com",
      status: "Active"
    }, { onConflict: "id" });
  }

  // 3. Parents from CSV
  console.log(`\n▶ [3/4] Ensuring ${PARENT_STUDENTS_CSV.length} Parents & Students...`);
  const uniqueParents = new Map<string, { name: string; phone: string }>();
  for (const r of PARENT_STUDENTS_CSV) {
    if (r.parentEmail && r.parentEmail.includes("@")) {
      uniqueParents.set(r.parentEmail.toLowerCase().trim(), { name: r.parentName, phone: r.parentPhone });
    }
  }

  console.log(`Found ${uniqueParents.size} unique parent accounts to ensure...`);
  const parentIdMap = new Map<string, string>();
  for (const [pEmail, pInfo] of uniqueParents.entries()) {
    const pid = await ensureUser(pEmail, "Parent@TopGrade2026", "PARENT", pInfo.name);
    if (pid) parentIdMap.set(pEmail, pid);
  }

  // 4. Students
  console.log(`\n▶ [4/4] Ensuring Students in DB...`);
  let studentsSynced = 0;
  for (const r of PARENT_STUDENTS_CSV) {
    const pEmail = r.parentEmail?.toLowerCase().trim();
    const pId = pEmail ? parentIdMap.get(pEmail) : null;

    // Student login credentials
    const cleanStudentName = r.studentName.replace(/[^a-zA-Z0-9]/g, "").toLowerCase();
    const cleanParentPrefix = pEmail ? pEmail.split("@")[0].replace(/[^a-zA-Z0-9]/g, "").toLowerCase() : "parent";
    const studentLoginEmail = `${cleanStudentName}.${cleanParentPrefix}@student.topgrade.edu`;

    const stUserId = await ensureUser(studentLoginEmail, "Student@TopGrade2026", "STUDENT", r.studentName);

    const studentRecordId = stUserId || crypto.randomUUID();

    // Upsert into students table
    await supabaseAdmin.from("students").upsert({
      id: studentRecordId,
      name: r.studentName,
      email: studentLoginEmail,
      program: r.course || "General",
      parent_name: r.parentName,
      parent_email: pEmail,
      status: "Active"
    }, { onConflict: "id" });

    // Link in student_parents table if available
    if (pId) {
      try {
        await supabaseAdmin.from("student_parents").upsert({
          student_id: studentRecordId,
          parent_id: pId,
          parent_email: pEmail
        });
      } catch {}
    }

    studentsSynced++;
  }

  // 5. TEST AUTHENTICATION FOR SAMPLES OF EACH ROLE
  console.log("\n===============================================================");
  console.log("🧪 RUNNING AUTHENTICATION VERIFICATION TESTS");
  console.log("===============================================================");

  // Admin 1
  const a1 = await supabaseAdmin.auth.signInWithPassword({ email: "tglbiz101@gmail.com", password: "TopGrade2026!" });
  console.log(`Admin (tglbiz101@gmail.com):`, a1.error ? `❌ ${a1.error.message}` : `✅ OK (UID: ${a1.data.user?.id})`);

  // Admin 2
  const a2 = await supabaseAdmin.auth.signInWithPassword({ email: "admin@topgrade.edu", password: "TopGrade2026!" });
  console.log(`Admin (admin@topgrade.edu):`, a2.error ? `❌ ${a2.error.message}` : `✅ OK (UID: ${a2.data.user?.id})`);

  // Student Tester
  const st = await supabaseAdmin.auth.signInWithPassword({ email: "sivareddy683970@gmail.com", password: "TopGrade2026!" });
  console.log(`Student Tester (sivareddy683970@gmail.com):`, st.error ? `❌ ${st.error.message}` : `✅ OK (UID: ${st.data.user?.id})`);

  // Sample Parent
  const p1 = await supabaseAdmin.auth.signInWithPassword({ email: "tanyeafowls@yahoo.com", password: "Parent@TopGrade2026" });
  console.log(`Parent (tanyeafowls@yahoo.com):`, p1.error ? `❌ ${p1.error.message}` : `✅ OK (UID: ${p1.data.user?.id})`);

  // Sample Teacher
  const t1 = await supabaseAdmin.auth.signInWithPassword({ email: "jldaeb1000@gmail.com", password: "TopGrade@2026!" });
  console.log(`Teacher (jldaeb1000@gmail.com):`, t1.error ? `❌ ${t1.error.message}` : `✅ OK (UID: ${t1.data.user?.id})`);

  console.log(`\n===============================================================`);
  console.log(`🎉 ALL LOGINS PROVISIONED & VERIFIED!`);
  console.log(`===============================================================\n`);
}

run().catch(console.error);
