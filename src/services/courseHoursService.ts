import { LedgerService } from "./ledgerService.js";
import { ReceiptPdfService, type ReceiptDataInput } from "./receiptPdfService.js";

export interface CourseHourAllocationInput {
  studentId: string;
  studentName: string;
  studentCode: string;
  studentEmail: string;
  parentEmail?: string | undefined;
  parentName?: string | undefined;
  courseId: string;
  courseName: string;
  pricingModel: "HOURLY_CREDIT_PACKAGE" | "FIXED_COURSE_PACKAGE";
  purchasedHours?: number | undefined;
  grossAmount: number;
  paymentMethod: "CREDIT_CARD" | "CASH" | "BANK_TRANSFER" | "CHEQUE";
  payerClassification?: "FATHERS_CARD" | "MOTHERS_CARD" | "SELF" | "GUARDIAN" | undefined;
  razorpayOrderId?: string | undefined;
  razorpayPaymentId?: string | undefined;
  chequeNumber?: string | undefined;
  bankName?: string | undefined;
  clearanceRef?: string | undefined;
  chequeImageUrl?: string | undefined;
  bankUtRef?: string | undefined;
}

export interface StudentCourseBalanceRecord {
  id: string;
  studentId: string;
  studentName: string;
  courseId: string;
  courseName: string;
  pricingModel: "HOURLY_CREDIT_PACKAGE" | "FIXED_COURSE_PACKAGE";
  totalPurchasedHours: number;
  availableHours: number;
  usedHours: number;
  status: "ACTIVE" | "EXHAUSTED" | "EXPIRED";
  quotaWarningTriggered: boolean;
  teacherWarningMessage?: string | undefined;
  updatedAt: string;
}

export interface PaymentOrderRecord {
  id: string;
  orderNumber: string;
  receiptNumber: string;
  studentId: string;
  courseId: string;
  pricingModel: "HOURLY_CREDIT_PACKAGE" | "FIXED_COURSE_PACKAGE";
  purchasedHours: number;
  grossAmount: number;
  taxAmount: number;
  totalPayable: number;
  paymentMethod: string;
  payerClassification?: string | undefined;
  status: "PAID";
  chequeNumber?: string | undefined;
  bankName?: string | undefined;
  bankUtRef?: string | undefined;
  createdAt: string;
}

// In-Memory store for fast runtime execution & fallback
export const studentCourseBalancesStore: StudentCourseBalanceRecord[] = [
  {
    id: "bal-101",
    studentId: "std-demo-1",
    studentName: "Rahul Kumar",
    courseId: "crs-sec-103",
    courseName: "Full-Stack Coding & Web Dev",
    pricingModel: "HOURLY_CREDIT_PACKAGE",
    totalPurchasedHours: 50,
    availableHours: 34,
    usedHours: 16,
    status: "ACTIVE",
    quotaWarningTriggered: false,
    updatedAt: new Date().toISOString()
  },
  {
    id: "bal-102",
    studentId: "std-demo-2",
    studentName: "Ananya Sharma",
    courseId: "crs-elem-102",
    courseName: "Primary Math & Logic Track",
    pricingModel: "HOURLY_CREDIT_PACKAGE",
    totalPurchasedHours: 20,
    availableHours: 2, // Low capacity threshold for warning test
    usedHours: 18,
    status: "ACTIVE",
    quotaWarningTriggered: true,
    teacherWarningMessage: "⚠️ Quota Warning: Student has <= 2 sessions remaining!",
    updatedAt: new Date().toISOString()
  }
];

export const paymentOrdersStore: PaymentOrderRecord[] = [];

export class CourseHoursService {
  /**
   * 1. Allocates prepaid hours, syncs teacher roster, checks <= 2 quota alert, and posts ledger entries
   */
  public static async allocateCourseHoursAndSyncRoster(input: CourseHourAllocationInput) {
    const hoursToAdd = input.pricingModel === "HOURLY_CREDIT_PACKAGE" ? (input.purchasedHours || 10) : 50;
    const nowIso = new Date().toISOString();

    // 1. Find or create StudentCourseBalance
    let balance = studentCourseBalancesStore.find(
      b => b.studentId === input.studentId && b.courseId === input.courseId
    );

    if (balance) {
      balance.totalPurchasedHours += hoursToAdd;
      balance.availableHours += hoursToAdd;
      balance.status = "ACTIVE";
      balance.updatedAt = nowIso;
    } else {
      balance = {
        id: `bal-${Date.now()}`,
        studentId: input.studentId,
        studentName: input.studentName,
        courseId: input.courseId,
        courseName: input.courseName,
        pricingModel: input.pricingModel,
        totalPurchasedHours: hoursToAdd,
        availableHours: hoursToAdd,
        usedHours: 0,
        status: "ACTIVE",
        quotaWarningTriggered: false,
        updatedAt: nowIso
      };
      studentCourseBalancesStore.unshift(balance);
    }

    // 2. Check Quota Warning Threshold (availableHours <= 2)
    if (balance.availableHours <= 2) {
      balance.quotaWarningTriggered = true;
      balance.teacherWarningMessage = `⚠️ Quota Warning: Student '${input.studentName}' has only ${balance.availableHours} session(s) remaining!`;
    } else {
      balance.quotaWarningTriggered = false;
      balance.teacherWarningMessage = undefined;
    }

    // 3. Tax & Order Amount Calculation (18% GST)
    const taxAmount = Number((input.grossAmount * 0.18).toFixed(2));
    const totalPayable = Number((input.grossAmount * 1.18).toFixed(2));
    const orderNumber = `ORD-${new Date().getFullYear()}-${Math.floor(1000 + Math.random() * 9000)}`;
    const receiptNumber = `REC-${new Date().getFullYear()}-${Math.floor(1000 + Math.random() * 9000)}`;

    const orderRecord: PaymentOrderRecord = {
      id: `order-${Date.now()}`,
      orderNumber,
      receiptNumber,
      studentId: input.studentId,
      courseId: input.courseId,
      pricingModel: input.pricingModel,
      purchasedHours: hoursToAdd,
      grossAmount: input.grossAmount,
      taxAmount,
      totalPayable,
      paymentMethod: input.paymentMethod,
      payerClassification: input.payerClassification,
      status: "PAID",
      chequeNumber: input.chequeNumber,
      bankName: input.bankName,
      bankUtRef: input.bankUtRef,
      createdAt: nowIso
    };

    paymentOrdersStore.unshift(orderRecord);

    // 4. Double-Entry Ledger Postings
    const invoiceResult = LedgerService.createInvoice({
      studentId: input.studentId,
      studentName: input.studentName,
      grossAmount: input.grossAmount,
      discountAmount: 0,
      dueDate: nowIso.slice(0, 10)
    });

    const paymentResult = LedgerService.processPayment({
      invoiceId: invoiceResult.invoice.invoiceNumber,
      amountPaid: totalPayable,
      paymentMethod: input.paymentMethod,
      chequeNumber: input.chequeNumber,
      bankName: input.bankName,
      clearanceRef: input.clearanceRef,
      chequeImageUrl: input.chequeImageUrl
    });

    // 5. Generate Institutional PDF Receipt & Dispatch Confirmation Email
    const receiptData: ReceiptDataInput = {
      receiptNumber,
      orderNumber,
      studentName: input.studentName,
      studentCode: input.studentCode,
      parentName: input.parentName,
      studentEmail: input.studentEmail,
      parentEmail: input.parentEmail,
      courseName: input.courseName,
      pricingModel: input.pricingModel,
      purchasedHours: hoursToAdd,
      grossAmount: input.grossAmount,
      taxAmount,
      totalPayable,
      paymentMethod: input.paymentMethod,
      payerClassification: input.payerClassification,
      chequeNumber: input.chequeNumber,
      bankName: input.bankName,
      clearanceRef: input.clearanceRef,
      bankUtRef: input.bankUtRef,
      paymentDate: nowIso
    };

    // Non-blocking receipt email dispatch
    ReceiptPdfService.dispatchReceiptEmail(receiptData).catch(err =>
      console.warn("Async receipt email dispatch note:", err)
    );

    return {
      order: orderRecord,
      balance,
      debitLedger: invoiceResult.debitEntry,
      creditLedger: paymentResult.creditEntry,
      receiptHtml: ReceiptPdfService.generateReceiptHtml(receiptData)
    };
  }

  /**
   * 2. Teacher Roster View query returning student balances & quota warnings
   */
  public static getTeacherRosterView() {
    return studentCourseBalancesStore.map(b => ({
      ...b,
      remainingClassesText: `${b.availableHours} classes remaining`,
      isLowQuotaWarning: b.availableHours <= 2
    }));
  }
}
