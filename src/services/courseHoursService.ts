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
  tokens_remaining?: number; // Granular Hour-as-Token: Prepaid hours available
  tokens_consumed?: number;  // Granular Hour-as-Token: Hours deducted upon attendance (1:1)
  hourly_rate?: number;      // Granular token rate ($/hr or INR/hr)
  max_hours?: number;        // Course ceiling limit (e.g. 25 hrs)
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
    tokens_remaining: 34,
    tokens_consumed: 16,
    hourly_rate: 40.00,
    max_hours: 25,
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
    tokens_remaining: 2,
    tokens_consumed: 18,
    hourly_rate: 40.00,
    max_hours: 25,
    status: "ACTIVE",
    quotaWarningTriggered: true,
    teacherWarningMessage: "⚠️ Low Token Warning: 2 hours left",
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
      balance.tokens_remaining = balance.availableHours;
      balance.tokens_consumed = balance.usedHours;
      balance.hourly_rate = balance.hourly_rate || 40.00;
      balance.max_hours = balance.max_hours || 25;
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
        tokens_remaining: hoursToAdd,
        tokens_consumed: 0,
        hourly_rate: 40.00,
        max_hours: 25,
        status: "ACTIVE",
        quotaWarningTriggered: false,
        updatedAt: nowIso
      };
      studentCourseBalancesStore.unshift(balance);
    }

    // 2. Check Quota Warning Threshold (availableHours <= 2)
    if ((balance.tokens_remaining ?? 0) <= 2) {
      balance.quotaWarningTriggered = true;
      balance.teacherWarningMessage = `⚠️ Low Token Warning: ${balance.tokens_remaining ?? 0} hours left`;
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
      remainingClassesText: `${b.tokens_remaining ?? b.availableHours} classes remaining`,
      isLowQuotaWarning: (b.tokens_remaining ?? b.availableHours) <= 2
    }));
  }

  /**
   * 3. Get Student Course Balance by studentId and course identifier
   */
  public static getStudentCourseBalance(studentId: string, courseIdOrName?: string): StudentCourseBalanceRecord | undefined {
    if (!studentId) return undefined;
    const cleanStudentId = studentId.trim().toLowerCase();
    const cleanCourse = (courseIdOrName || "").trim().toLowerCase();

    // Direct match
    let match = studentCourseBalancesStore.find(b => {
      const bStudent = b.studentId.toLowerCase();
      const bCourseId = b.courseId.toLowerCase();
      const bCourseName = b.courseName.toLowerCase();
      const studentMatches = bStudent === cleanStudentId || b.id.toLowerCase() === cleanStudentId;
      if (!studentMatches) return false;
      if (!cleanCourse) return true;
      return bCourseId === cleanCourse || bCourseName === cleanCourse || cleanCourse.includes(bCourseName) || bCourseName.includes(cleanCourse);
    });

    if (match) return match;

    // Fallback: match by studentId alone if single course enrollment exists
    return studentCourseBalancesStore.find(b => b.studentId.toLowerCase() === cleanStudentId);
  }

  /**
   * 4. Deduct 1 Token on Attendance Roll-Call (1:1 deduction when marked PRESENT)
   */
  public static deductTokenOnAttendance(studentId: string, courseIdOrName?: string) {
    let balance = this.getStudentCourseBalance(studentId, courseIdOrName);
    const nowIso = new Date().toISOString();

    if (!balance) {
      // Initialize dynamic balance on first attendance if not previously created
      balance = {
        id: `bal-${Date.now()}-${Math.floor(Math.random() * 1000)}`,
        studentId,
        studentName: "Enrolled Student",
        courseId: courseIdOrName || "crs-active",
        courseName: courseIdOrName || "Active Course Track",
        pricingModel: "HOURLY_CREDIT_PACKAGE",
        totalPurchasedHours: 20,
        availableHours: 20,
        usedHours: 0,
        tokens_remaining: 20,
        tokens_consumed: 0,
        hourly_rate: 40.00,
        max_hours: 25,
        status: "ACTIVE",
        quotaWarningTriggered: false,
        updatedAt: nowIso
      };
      studentCourseBalancesStore.unshift(balance);
    }

    // Granular token deduction 1:1
    balance.tokens_remaining = Math.max(0, (balance.tokens_remaining ?? balance.availableHours ?? 0) - 1);
    balance.tokens_consumed = (balance.tokens_consumed ?? balance.usedHours ?? 0) + 1;
    balance.availableHours = balance.tokens_remaining;
    balance.usedHours = balance.tokens_consumed;
    balance.updatedAt = nowIso;

    // Check low quota threshold (<= 2 tokens remaining)
    if (balance.tokens_remaining <= 2) {
      balance.quotaWarningTriggered = true;
      balance.teacherWarningMessage = `⚠️ Low Token Warning: ${balance.tokens_remaining} hours left`;
    } else {
      balance.quotaWarningTriggered = false;
      balance.teacherWarningMessage = undefined;
    }

    if (balance.tokens_remaining === 0) {
      balance.status = "EXHAUSTED";
    }

    return {
      success: true,
      tokens_remaining: balance.tokens_remaining,
      tokens_consumed: balance.tokens_consumed,
      isLowQuotaWarning: balance.tokens_remaining <= 2,
      warningMessage: balance.teacherWarningMessage,
      balance
    };
  }

  /**
   * 5. Granular Token Credit upon UPI / Online Verification
   */
  public static creditTokens(input: {
    studentId: string;
    studentName?: string;
    courseId: string;
    courseName?: string;
    tokensPurchased: number;
    hourlyRate?: number;
    maxHours?: number;
  }) {
    const hoursToAdd = Number(input.tokensPurchased) || 1;
    const nowIso = new Date().toISOString();

    let balance = this.getStudentCourseBalance(input.studentId, input.courseId || input.courseName);
    if (balance) {
      balance.totalPurchasedHours += hoursToAdd;
      balance.availableHours += hoursToAdd;
      balance.tokens_remaining = balance.availableHours;
      balance.hourly_rate = input.hourlyRate || balance.hourly_rate || 40.00;
      balance.max_hours = input.maxHours || balance.max_hours || 25;
      balance.status = "ACTIVE";
      balance.updatedAt = nowIso;
    } else {
      balance = {
        id: `bal-${Date.now()}`,
        studentId: input.studentId,
        studentName: input.studentName || "Student",
        courseId: input.courseId,
        courseName: input.courseName || "Course Track",
        pricingModel: "HOURLY_CREDIT_PACKAGE",
        totalPurchasedHours: hoursToAdd,
        availableHours: hoursToAdd,
        usedHours: 0,
        tokens_remaining: hoursToAdd,
        tokens_consumed: 0,
        hourly_rate: input.hourlyRate || 40.00,
        max_hours: input.maxHours || 25,
        status: "ACTIVE",
        quotaWarningTriggered: false,
        updatedAt: nowIso
      };
      studentCourseBalancesStore.unshift(balance);
    }

    // Clear low token warning if quota restored
    if ((balance.tokens_remaining ?? 0) > 2) {
      balance.quotaWarningTriggered = false;
      balance.teacherWarningMessage = undefined;
    } else {
      balance.quotaWarningTriggered = true;
      balance.teacherWarningMessage = `⚠️ Low Token Warning: ${balance.tokens_remaining ?? 0} hours left`;
    }

    return balance;
  }
}
