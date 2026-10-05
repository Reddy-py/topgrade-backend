import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import dotenv from "dotenv";
import { createClient } from "@supabase/supabase-js";

dotenv.config();

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const DATA_DIR = path.join(__dirname, "../data");

const supabaseUrl = process.env.SUPABASE_URL || "";
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY || "";
const supabase = createClient(supabaseUrl, supabaseKey, {
  auth: { autoRefreshToken: false, persistSession: false }
});

const emailsFromImage = [
  "tanyeafowls@yahoo.com",
  "missyou1970@yahoo.com",
  "gdulce955@gmail.com",
  "guilloryea@gmail.com",
  "esperanzagarciaovalle@gmail.com",
  "lani.garrido@gmail.com",
  "annasjan@gmail.com",
  "chad8404@gmail.com",
  "yosyaranda18@gmail.com",
  "conner.skuzniar@gmail.com",
  "nloan969@gmail.com",
  "tuhuynh0046@gmail.com",
  "megul41@gmail.com",
  "selenademps@hotmail.com",
  "qunisha.starks1@gmail.com",
  "deeutley@gmail.com",
  "minnybhatty@gmail.com",
  "pmots@yahoo.com",
  "cmotwani10@gmail.com",
  "nair.rekha11@gmail.com",
  "n_pilotte@yahoo.com",
  "umanutritionist@gmail.com",
  "barbarajaycacho@yahoo.com",
  "alexisszielinski@gmail.com",
  "marisol.maldonado96@icloud.com",
  "pabloymili2023@gmail.com",
  "chanthavorng@icloud.com",
  "dhara.6n@gmail.com",
  "rashmi.esq@gmail.com",
  "duggaljd14@gmail.com",
  "duggalmd@aol.com",
  "anvita512@gmail.com",
  "nwadhwa78@gmail.com",
  "kimmonscare@gmail.com",
  "kaushalya.amunugama@gmail.com",
  "monpara@gmail.com",
  "mykix3@gmail.com",
  "smayala79@yahoo.com",
  "gayathri.sathiamoorthy@gmail.com",
  "shiva90@gmail.com",
  "chaitu900@gmail.com",
  "ggrantl@renewedstrength.biz",
  "vondeahgrant@yahoo.com",
  "o.elizabeth@icloud.com",
  "ulayshagibbs@gmail.com",
  "carterae2020@gmail.com",
  "flossied@gmail.com",
  "jcothorn@gmail.com",
  "gerijosie@yahoo.com",
  "soosanmathai@yahoo.com",
  "lakeshiamorgan880",
  "chardaeevans1@gmail.com",
  "brindha.biotek@gmail.com",
  "annieb@cgsfs.com",
  "ke.li@outlook.com",
  "wesdmurdock@hotmail.com",
  "rosieflopez@yahoo.com",
  "ftfern24@yahoo.com",
  "elizabethannrodwell@gmail.com"
];

async function audit() {
  const logFile = path.join(DATA_DIR, "automated_emails_log.json");
  let emailLogs: any[] = [];
  if (fs.existsSync(logFile)) {
    emailLogs = JSON.parse(fs.readFileSync(logFile, "utf-8"));
  }

  // Load students_db.json
  const studentsDbFile = path.join(DATA_DIR, "students_db.json");
  let studentsDb: any[] = [];
  if (fs.existsSync(studentsDbFile)) {
    studentsDb = JSON.parse(fs.readFileSync(studentsDbFile, "utf-8"));
  }

  // Load Supabase Auth Users
  const { data: authData } = await supabase.auth.admin.listUsers({ perPage: 1000 });
  const authUsers = authData?.users || [];
  const authMap = new Map<string, any>();
  authUsers.forEach(u => {
    if (u.email) authMap.set(u.email.toLowerCase().trim(), u);
  });

  const auditResults: any[] = [];

  for (const email of emailsFromImage) {
    const cleanEmail = email.toLowerCase().trim();

    // Check email log
    const matchedLogs = emailLogs.filter((log: any) => {
      const recs = (log.recipientEmails || []).map((e: string) => e.toLowerCase().trim());
      return recs.includes(cleanEmail) || (cleanEmail.includes("@") && recs.some((r: string) => r.includes(cleanEmail) || cleanEmail.includes(r)));
    });

    // Check associated student in students_db.json
    const linkedStudents = studentsDb.filter((s: any) => {
      const pEmails = (s.parentEmails || []).map((e: string) => e.toLowerCase().trim());
      const sEmails = (s.studentEmails || []).map((e: string) => e.toLowerCase().trim());
      return pEmails.includes(cleanEmail) || sEmails.includes(cleanEmail) || (s.email && s.email.toLowerCase() === cleanEmail);
    });

    // Check auth status
    const authUser = authMap.get(cleanEmail) || authMap.get(`${cleanEmail}@gmail.com`);

    auditResults.push({
      email,
      sentCount: matchedLogs.length,
      hasBeenSent: matchedLogs.length > 0,
      sentDetails: matchedLogs.map((l: any) => ({ type: l.type, date: l.dateSent })),
      linkedStudents: linkedStudents.map((s: any) => ({ code: s.studentCode, name: s.fullName })),
      hasAuthAccount: !!authUser,
      authRole: authUser?.user_metadata?.role || "NONE",
      authCreated: authUser?.created_at?.slice(0, 10)
    });
  }

  console.log("================================================================================");
  console.log("           AUDIT REPORT: AUTOMATIC MESSAGES STATUS FOR 59 EMAILS               ");
  console.log("================================================================================\n");

  const sentList = auditResults.filter(r => r.hasBeenSent);
  const notSentList = auditResults.filter(r => !r.hasBeenSent);

  console.log(`TOTAL EMAILS AUDITED: ${auditResults.length}`);
  console.log(`✅ EMAILS WITH AUTOMATIC MESSAGES SENT: ${sentList.length}`);
  console.log(`❌ EMAILS WITH NO AUTOMATIC MESSAGES SENT: ${notSentList.length}\n`);

  if (sentList.length > 0) {
    console.log("--- SENT EMAILS ---");
    sentList.forEach(s => {
      console.log(`• ${s.email}: Sent ${s.sentCount} message(s) -> ${JSON.stringify(s.sentDetails)} | Linked Student: ${s.linkedStudents.map((st: any) => `${st.name} (${st.code})`).join(", ")}`);
    });
    console.log("");
  }

  console.log("--- NOT SENT EMAILS (58 EMAILS PENDING) ---");
  notSentList.forEach((ns, i) => {
    const studentStr = ns.linkedStudents.length > 0
      ? ns.linkedStudents.map((st: any) => `${st.name} (${st.code})`).join(", ")
      : "(Secondary / Unlinked Parent)";
    console.log(`${(i + 1).toString().padStart(2, " ")}. ${ns.email.padEnd(36, " ")} | Auth Account: ${ns.hasAuthAccount ? `YES [${ns.authRole}]` : "NO"} | Student: ${studentStr}`);
  });

  console.log("\n================================================================================");
}

audit();
