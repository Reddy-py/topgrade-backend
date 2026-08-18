import { LeadService, leadsStore, enrollmentsStore } from "./services/leadService.js";

async function runLeadPipelineVerification() {
  console.log("==================================================================");
  console.log("🧪 STARTING LEAD PIPELINE & CONVERSION SUITE VERIFICATION");
  console.log("==================================================================\n");

  let passedTests = 0;
  let totalTests = 4;

  // ----------------------------------------------------------------
  // TEST 1: Lead Ingestion & Deduplication Logic
  // ----------------------------------------------------------------
  console.log("🔹 TEST 1: Lead Ingestion & Deduplication Check");
  const firstIngestion = await LeadService.ingestAndDeduplicateLead({
    fullName: "Siddharth Verma",
    email: "siddharth.verma@gmail.com",
    phone: "+919876500112",
    targetGrade: "Secondary (Grade 9)",
    source: "META",
    utmParameters: { campaign: "FB_SPRING_LEADS_2026" },
    notes: "Interested in Coding & Computer Science track."
  });

  console.log("   • First Ingestion Result:", {
    leadId: firstIngestion.lead.id,
    source: firstIngestion.lead.source,
    isDuplicate: firstIngestion.isDuplicate
  });

  // Duplicate Ingestion Check (Same email & phone, different notes/source)
  const duplicateIngestion = await LeadService.ingestAndDeduplicateLead({
    fullName: "Siddharth Verma",
    email: "siddharth.verma@gmail.com",
    phone: "+919876500112",
    targetGrade: "Secondary (Grade 9)",
    source: "GOOGLE_ADS",
    notes: "Followed up via Google Search Ad inquiry form."
  });

  console.log("   • Duplicate Ingestion Result:", {
    leadId: duplicateIngestion.lead.id,
    isDuplicate: duplicateIngestion.isDuplicate,
    updatedNotes: duplicateIngestion.lead.notes
  });

  if (!firstIngestion.isDuplicate && duplicateIngestion.isDuplicate && leadsStore.length === 1) {
    console.log("   ✅ TEST 1 PASSED: Lead created and duplicate correctly appended!\n");
    passedTests++;
  } else {
    console.log("   ❌ TEST 1 FAILED!\n");
  }

  // ----------------------------------------------------------------
  // TEST 2: Follow-Up Interaction Logging & Due Dates Query
  // ----------------------------------------------------------------
  console.log("🔹 TEST 2: Follow-Up Interaction Logging & Due Dates Query");
  const leadId = firstIngestion.lead.id;
  const todayIso = new Date().toISOString();

  const interactionLog = LeadService.logInteraction({
    leadId,
    counselorId: "counselor-sarah",
    interactionType: "CALL",
    outcome: "CALLBACK_REQUESTED",
    notes: "Parent requested callback today evening to discuss payment structure.",
    scheduledFollowUpAt: todayIso
  });

  console.log("   • Interaction Logged:", {
    interactionId: interactionLog.interaction.id,
    leadStatus: interactionLog.lead.status,
    lastInteractionAt: interactionLog.lead.lastInteractionAt
  });

  const dueFollowUps = LeadService.getDueFollowUps();
  console.log("   • Due Follow-Ups Query Count:", dueFollowUps.count);

  if (interactionLog.lead.status === "CONTACTED" && dueFollowUps.count > 0) {
    console.log("   ✅ TEST 2 PASSED: Interaction logged & due follow-up retrieved successfully!\n");
    passedTests++;
  } else {
    console.log("   ❌ TEST 2 FAILED!\n");
  }

  // ----------------------------------------------------------------
  // TEST 3: 1-Click Conversion Pipeline
  // ----------------------------------------------------------------
  console.log("🔹 TEST 3: 1-Click Conversion to Enrollment (FORM_SUBMITTED)");
  const conversionResult = LeadService.convertLeadToEnrollment(leadId);

  console.log("   • Conversion Result:", {
    enrollmentId: conversionResult.enrollment.id,
    enrollmentStatus: conversionResult.enrollment.status,
    studentName: conversionResult.enrollment.studentName,
    leadIsConverted: conversionResult.lead.isConverted,
    leadStatus: conversionResult.lead.status
  });

  if (
    conversionResult.enrollment.status === "FORM_SUBMITTED" &&
    conversionResult.lead.isConverted &&
    conversionResult.lead.status === "CONVERTED" &&
    enrollmentsStore.length > 0
  ) {
    console.log("   ✅ TEST 3 PASSED: Lead converted to Enrollment record (FORM_SUBMITTED) seamlessly!\n");
    passedTests++;
  } else {
    console.log("   ❌ TEST 3 FAILED!\n");
  }

  // ----------------------------------------------------------------
  // TEST 4: Stale Lead Archival Routine
  // ----------------------------------------------------------------
  console.log("🔹 TEST 4: Stale Lead Auto-Archiving Routine");
  // Ingest a fresh lead that will be marked NOT_INTERESTED
  const staleLeadIngest = await LeadService.ingestAndDeduplicateLead({
    fullName: "Aarav Sharma",
    email: "aarav.sharma@gmail.com",
    phone: "+919988776655",
    targetGrade: "Primary (Grade 4)",
    source: "WEBSITE",
    notes: "Initial website form submission."
  });

  LeadService.logInteraction({
    leadId: staleLeadIngest.lead.id,
    counselorId: "counselor-john",
    interactionType: "CALL",
    outcome: "NOT_INTERESTED",
    notes: "Parent decided to join local school near residence."
  });

  console.log("   • Lead Status After NOT_INTERESTED Outcome:", staleLeadIngest.lead.status);

  const archiveResult = LeadService.archiveStaleLeads();
  console.log("   • Archival Execution Summary:", {
    archivedCount: archiveResult.archivedCount
  });

  if (staleLeadIngest.lead.status === "INACTIVE_ARCHIVED") {
    console.log("   ✅ TEST 4 PASSED: Stale & Not-Interested leads archived successfully!\n");
    passedTests++;
  } else {
    console.log("   ❌ TEST 4 FAILED!\n");
  }

  console.log("==================================================================");
  console.log(`📊 FINAL VERIFICATION SCORE: ${passedTests}/${totalTests} TESTS PASSED`);
  console.log("==================================================================\n");

  if (passedTests !== totalTests) {
    process.exit(1);
  }
}

runLeadPipelineVerification().catch(err => {
  console.error("FATAL: Verification script failed:", err);
  process.exit(1);
});
