import { RescheduleService } from "../services/rescheduleService.js";
import { EnrollmentService } from "../services/enrollmentService.js";
import { LedgerService } from "../services/ledgerService.js";

export const productionSeedData = {
  roles: [
    { email: "admin@topgrade.edu", role: "ADMIN", name: "System Administrator" },
    { email: "accountant@topgrade.edu", role: "ACCOUNTANT", name: "Ledger Controller" },
    { email: "teacher@topgrade.edu", role: "TEACHER", name: "John Doe (M.Sc CS)" },
    { email: "parent@topgrade.edu", role: "PARENT", name: "Rajesh Kumar" },
    { email: "student@topgrade.edu", role: "STUDENT", name: "Alex Mercer" }
  ],
  grades: [
    { name: "Kindergarten", description: "Early Childhood STEM & Motor Skills" },
    { name: "Primary (Grades 1-5)", description: "Foundational Math & Logic" },
    { name: "Secondary (Grades 6-10)", description: "Coding, Web Dev & Sciences" },
    { name: "Higher Secondary (Grades 11-12)", description: "Advanced Physics & Computer Science" }
  ],
  subjects: [
    { code: "KG-STEM-101", title: "STEM Foundations", gradeName: "Kindergarten" },
    { code: "MATH-ELEM-201", title: "Primary Math & Logic", gradeName: "Primary (Grades 1-5)" },
    { code: "CS-SEC-301", title: "Full-Stack Coding & Web Dev", gradeName: "Secondary (Grades 6-10)" },
    { code: "PHYS-HS-401", title: "Higher Secondary Physics", gradeName: "Higher Secondary (Grades 11-12)" }
  ],
  teachers: [
    {
      name: "John Doe",
      email: "teacher@topgrade.edu",
      qualification: "M.Sc Computer Science",
      hourlyRate: 45.00,
      weeklyMaxSessions: 20,
      weeklyAssignedSessions: 14,
      gdriveFolderSubmitted: true,
      photoWaiverSigned: true
    },
    {
      name: "Sarah Jenkins",
      email: "sarah.j@topgrade.edu",
      qualification: "Ph.D Mathematics",
      hourlyRate: 38.00,
      weeklyMaxSessions: 25,
      weeklyAssignedSessions: 18,
      gdriveFolderSubmitted: true,
      photoWaiverSigned: true
    }
  ],
  leads: [
    {
      id: "lead-wa-101",
      source: "whatsapp",
      studentName: "Vikram Malhotra",
      contactNumber: "+919876543210",
      email: "vikram.m@gmail.com",
      academicGrade: "Secondary (Grade 9)",
      message: "WhatsApp inquiry for Full-Stack Coding track starting next month."
    },
    {
      id: "lead-ig-102",
      source: "instagram",
      studentName: "Priya Nair",
      contactNumber: "+919812345678",
      email: "priya.nair@gmail.com",
      academicGrade: "Higher Secondary (Grade 11)",
      message: "Instagram Ad click for Physics Olympiad prep."
    }
  ],
  enrollments: [
    {
      id: "enr-101",
      studentName: "Vikram Malhotra",
      academicGrade: "Secondary (Grade 9)",
      status: "FORM_SUBMITTED",
      submittedAt: new Date(Date.now() - 24 * 3600 * 1000).toISOString()
    },
    {
      id: "enr-102",
      studentName: "Priya Nair",
      academicGrade: "Higher Secondary (Grade 11)",
      status: "APPROVED",
      submittedAt: new Date(Date.now() - 48 * 3600 * 1000).toISOString()
    }
  ],
  students: [
    {
      studentCode: "TG-2026-9081",
      fullName: "Rahul Kumar",
      email: "rahul.k@topgrade.edu",
      dob: "2010-04-12",
      calculatedAge: EnrollmentService.calculateDynamicAge("2010-04-12"),
      primaryMobile: "+919876543210",
      residentialAddress: "742 Evergreen Terrace, Springfield",
      status: "ACTIVE",
      enrolledTenureMonths: 14
    },
    {
      studentCode: "TG-2026-9082",
      fullName: "Ananya Sharma",
      email: "ananya.s@topgrade.edu",
      dob: "2012-08-25",
      calculatedAge: EnrollmentService.calculateDynamicAge("2012-08-25"),
      primaryMobile: "+919812345678",
      residentialAddress: "123 Innovation Way, Tech Park",
      status: "ACTIVE",
      enrolledTenureMonths: 8
    }
  ]
};

export function executeProductionSeed() {
  // Test Reschedule Engine with 24h & 3-attempt validation
  const testRescheduleAttempt1 = RescheduleService.validateAndProcessRequest({
    studentId: "std-101",
    studentName: "Rahul Kumar",
    classSessionId: "session-201",
    sessionStartTime: new Date(Date.now() + 48 * 3600 * 1000), // 48h notice
    requestedNewTime: "Tomorrow 04:00 PM",
    reason: "Family Event",
    existingRescheduleCount: 1
  });

  const testRescheduleAttemptCapExceeded = RescheduleService.validateAndProcessRequest({
    studentId: "std-101",
    studentName: "Rahul Kumar",
    classSessionId: "session-201",
    sessionStartTime: new Date(Date.now() + 48 * 3600 * 1000),
    requestedNewTime: "Tomorrow 04:00 PM",
    reason: "Exceeding Limit Test",
    existingRescheduleCount: 3
  });

  // Test Invoicing & Double-Entry Ledger
  const invoiceData = LedgerService.createInvoice({
    studentId: "TG-2026-9081",
    studentName: "Rahul Kumar",
    grossAmount: 350.0,
    discountAmount: 50.0,
    dueDate: "2026-09-01"
  });

  const paymentData = LedgerService.processPayment({
    invoiceId: invoiceData.invoice.invoiceNumber,
    amountPaid: 300.0,
    paymentMethod: "CHEQUE",
    chequeNumber: "CHQ-882901",
    bankName: "Chase National Bank",
    clearanceRef: "CLR-990182",
    chequeImageUrl: "https://topgrade.edu/docs/cheque-882901.jpg"
  });

  return {
    seedData: productionSeedData,
    rescheduleTestAllowed: testRescheduleAttempt1,
    rescheduleTestCapExceeded: testRescheduleAttemptCapExceeded,
    sampleInvoice: invoiceData.invoice,
    sampleLedgerDebit: invoiceData.debitEntry,
    samplePaymentReceipt: paymentData.receipt,
    sampleLedgerCredit: paymentData.creditEntry
  };
}
