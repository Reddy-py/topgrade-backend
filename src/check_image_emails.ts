import fs from "fs";
import path from "path";

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

const logFile = path.resolve("./data/automated_emails_log.json");
let logs: any[] = [];
if (fs.existsSync(logFile)) {
  logs = JSON.parse(fs.readFileSync(logFile, "utf-8"));
}

console.log("Total entries in automated_emails_log.json:", logs.length);

const allLoggedRecipients = new Set<string>();
logs.forEach((log: any) => {
  if (Array.isArray(log.recipientEmails)) {
    log.recipientEmails.forEach((e: string) => allLoggedRecipients.add(e.toLowerCase().trim()));
  }
});

console.log("Unique recipients in automated_emails_log.json:", allLoggedRecipients.size);
console.log("All recipients in log:", Array.from(allLoggedRecipients));

console.log("\n--- Checking emails from Image ---");
let sentCount = 0;
let missingCount = 0;

emailsFromImage.forEach((email, idx) => {
  const clean = email.toLowerCase().trim();
  const isSent = allLoggedRecipients.has(clean) || Array.from(allLoggedRecipients).some(r => r.includes(clean) || clean.includes(r));
  if (isSent) {
    console.log(`[${idx + 1}] SENT: ${email}`);
    sentCount++;
  } else {
    console.log(`[${idx + 1}] NOT SENT: ${email}`);
    missingCount++;
  }
});

console.log(`\nSummary: Sent = ${sentCount}, Not Sent = ${missingCount}, Total = ${emailsFromImage.length}`);
