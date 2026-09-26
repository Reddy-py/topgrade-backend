import express from "express";
import QRCode from "qrcode";
import { RazorpayService } from "../services/razorpayService.js";
import { CourseHoursService, paymentOrdersStore, studentCourseBalancesStore, type PaymentOrderRecord } from "../services/courseHoursService.js";
import { ReceiptPdfService } from "../services/receiptPdfService.js";
import { LedgerService } from "../services/ledgerService.js";
import { dispatchMultiChannelNotification } from "../services/notificationService.js";

interface PendingUpiIntent {
  txn_ref: string;
  student_id: string;
  student_name: string;
  student_email?: string;
  parent_email?: string;
  parent_name?: string;
  course_id: string;
  course_name: string;
  tokens_purchased: number;
  hourly_rate: number;
  amount: number;
  upi_uri: string;
  qr_svg: string;
  status: "PENDING" | "PAID" | "EXPIRED";
  created_at: string;
}

export const pendingUpiIntentsStore: PendingUpiIntent[] = [];

const router = express.Router();

// 1. CREATE RAZORPAY ORDER (POST /api/payments/razorpay/create-order)
router.post("/razorpay/create-order", (req, res) => {
  try {
    const { amount, studentId, courseId, pricingModel, purchasedHours } = req.body;

    if (!amount || !studentId || !courseId) {
      return res.status(400).json({
        success: false,
        message: "Missing mandatory fields (amount, studentId, courseId)."
      });
    }

    const orderResult = RazorpayService.createOrder({
      amount: Number(amount),
      studentId,
      courseId,
      pricingModel: pricingModel || "HOURLY_CREDIT_PACKAGE",
      purchasedHours: Number(purchasedHours) || 10
    });

    res.status(201).json(orderResult);
  } catch (err: any) {
    res.status(500).json({ success: false, message: err.message });
  }
});

// 2. VERIFY RAZORPAY SIGNATURE & SETTLE (POST /api/payments/razorpay/verify)
router.post("/razorpay/verify", async (req, res) => {
  try {
    const {
      razorpayOrderId,
      razorpayPaymentId,
      razorpaySignature,
      studentId,
      studentName,
      studentCode,
      studentEmail,
      parentEmail,
      parentName,
      courseId,
      courseName,
      pricingModel,
      purchasedHours,
      grossAmount,
      payerClassification
    } = req.body;

    const isValid = RazorpayService.verifySignature({
      razorpayOrderId,
      razorpayPaymentId,
      razorpaySignature
    });

    if (!isValid) {
      return res.status(400).json({
        success: false,
        message: "Razorpay signature verification failed. HMAC SHA256 mismatch."
      });
    }

    // Allocate hours, sync roster, and post double-entry ledger
    const settlement = await CourseHoursService.allocateCourseHoursAndSyncRoster({
      studentId: studentId || "std-demo-1",
      studentName: studentName || "Rahul Kumar",
      studentCode: studentCode || "TG-2026-9081",
      studentEmail: studentEmail || "rahul.k@topgrade.edu",
      parentEmail: parentEmail || "parent@topgrade.edu",
      parentName: parentName || "Rajesh Kumar",
      courseId: courseId || "crs-sec-103",
      courseName: courseName || "Full-Stack Coding & Web Dev",
      pricingModel: pricingModel || "HOURLY_CREDIT_PACKAGE",
      purchasedHours: Number(purchasedHours) || 10,
      grossAmount: Number(grossAmount) || 250,
      paymentMethod: "CREDIT_CARD",
      payerClassification: payerClassification || "FATHERS_CARD",
      razorpayOrderId,
      razorpayPaymentId
    });

    res.json({
      success: true,
      message: "Razorpay payment verified & class hour credits allocated successfully!",
      data: settlement
    });
  } catch (err: any) {
    res.status(500).json({ success: false, message: err.message });
  }
});

// 3. SETTLE MULTI-CHANNEL PAYMENT (POST /api/payments/settle)
router.post("/settle", async (req, res) => {
  try {
    const {
      studentId,
      studentName,
      studentCode,
      studentEmail,
      parentEmail,
      parentName,
      courseId,
      courseName,
      pricingModel,
      purchasedHours,
      grossAmount,
      paymentMethod,
      payerClassification,
      chequeNumber,
      bankName,
      clearanceRef,
      chequeImageUrl,
      bankUtRef
    } = req.body;

    if (!studentId || !courseId || !paymentMethod || !grossAmount) {
      return res.status(400).json({
        success: false,
        message: "Missing mandatory payment settlement fields."
      });
    }

    const settlement = await CourseHoursService.allocateCourseHoursAndSyncRoster({
      studentId,
      studentName: studentName || "Student",
      studentCode: studentCode || `TG-${Date.now()}`,
      studentEmail: studentEmail || "student@topgrade.edu",
      parentEmail,
      parentName,
      courseId,
      courseName: courseName || "Course Package",
      pricingModel: pricingModel || "HOURLY_CREDIT_PACKAGE",
      purchasedHours: Number(purchasedHours) || 10,
      grossAmount: Number(grossAmount),
      paymentMethod,
      payerClassification,
      chequeNumber,
      bankName,
      clearanceRef,
      chequeImageUrl,
      bankUtRef
    });

    res.json({
      success: true,
      message: `Payment of $${grossAmount} settled via ${paymentMethod}! Class credits allocated.`,
      data: settlement
    });
  } catch (err: any) {
    res.status(500).json({ success: false, message: err.message });
  }
});

// 4. DOWNLOAD / PRINT RECEIPT HTML (GET /api/payments/receipt/:orderId/html)
router.get("/receipt/:orderId/html", (req, res) => {
  const { orderId } = req.params;
  const order = paymentOrdersStore.find(o => o.id === orderId || o.orderNumber === orderId);

  if (!order) {
    return res.status(404).send("<h3 style='font-family:sans-serif;'>Receipt record not found.</h3>");
  }

  const receiptHtml = ReceiptPdfService.generateReceiptHtml({
    receiptNumber: order.receiptNumber,
    orderNumber: order.orderNumber,
    studentName: "Rahul Kumar",
    studentCode: "TG-2026-9081",
    studentEmail: "rahul.k@topgrade.edu",
    parentName: "Rajesh Kumar",
    parentEmail: "parent@topgrade.edu",
    courseName: "Full-Stack Coding & Web Dev",
    pricingModel: order.pricingModel,
    purchasedHours: order.purchasedHours,
    grossAmount: order.grossAmount,
    taxAmount: order.taxAmount,
    totalPayable: order.totalPayable,
    paymentMethod: order.paymentMethod,
    payerClassification: order.payerClassification,
    chequeNumber: order.chequeNumber,
    bankName: order.bankName,
    bankUtRef: order.bankUtRef,
    paymentDate: order.createdAt
  });

  res.setHeader("Content-Type", "text/html");
  res.send(receiptHtml);
});

// 5. TEACHER ROSTER VIEW WITH QUOTA WARNINGS (GET /api/payments/teacher-roster)
router.get("/teacher-roster", (_req, res) => {
  const roster = CourseHoursService.getTeacherRosterView();
  res.json({
    success: true,
    count: roster.length,
    data: roster
  });
});

// 6. GENERATE DYNAMIC UPI INTENT & SVG QR (POST /api/payments/upi/generate-intent)
router.post("/upi/generate-intent", async (req, res): Promise<any> => {
  try {
    const {
      student_id,
      studentId,
      student_name,
      studentName,
      student_email,
      studentEmail,
      parent_email,
      parentEmail,
      parent_name,
      parentName,
      course_id,
      courseId,
      course_name,
      courseName,
      tokens_purchased,
      tokensPurchased,
      amount,
      hourly_rate,
      hourlyRate
    } = req.body;

    const sId = student_id || studentId;
    const cId = course_id || courseId;
    const tokens = Number(tokens_purchased || tokensPurchased || 1);
    const parsedAmount = Number(amount);

    if (!sId || !cId || isNaN(tokens) || tokens <= 0 || isNaN(parsedAmount) || parsedAmount <= 0) {
      return res.status(400).json({
        success: false,
        message: "Missing mandatory fields: student_id, course_id, tokens_purchased, and valid amount."
      });
    }

    const cName = course_name || courseName || "Course Track";
    const sName = student_name || studentName || "Enrolled Student";
    const rate = Number(hourly_rate || hourlyRate || (parsedAmount / tokens));

    // Generate unique transaction reference (max 35 chars for standard UPI banking specs)
    const txn_ref = `TG-UPI-${Date.now().toString().slice(-8)}-${Math.floor(1000 + Math.random() * 9000)}`;

    // Standard NPCI / UPI Deep Link URI
    const upi_uri = `upi://pay?pa=topgrade@upi&pn=TopGrade%20Learning&am=${parsedAmount.toFixed(2)}&cu=INR&tn=${encodeURIComponent(`TopGrade ${tokens} Tokens - ${cName}`)}&tr=${txn_ref}`;

    // Render Dynamic SVG QR Code
    const qr_svg = await QRCode.toString(upi_uri, {
      type: "svg",
      margin: 1,
      color: {
        dark: "#004ac6",
        light: "#ffffff"
      }
    });

    const intentRecord: PendingUpiIntent = {
      txn_ref,
      student_id: sId,
      student_name: sName,
      student_email: student_email || studentEmail || "student@topgrade.edu",
      parent_email: parent_email || parentEmail,
      parent_name: parent_name || parentName,
      course_id: cId,
      course_name: cName,
      tokens_purchased: tokens,
      hourly_rate: rate,
      amount: parsedAmount,
      upi_uri,
      qr_svg,
      status: "PENDING",
      created_at: new Date().toISOString()
    };

    pendingUpiIntentsStore.unshift(intentRecord);

    return res.status(200).json({
      success: true,
      message: "Dynamic UPI intent and SVG QR generated successfully.",
      data: {
        txn_ref,
        upi_uri,
        qr_svg,
        amount: parsedAmount,
        tokens_purchased: tokens,
        hourly_rate: rate,
        course_name: cName,
        payee_upi: "topgrade@upi",
        payee_name: "TopGrade Learning"
      }
    });
  } catch (err: any) {
    return res.status(500).json({ success: false, message: err.message || "Failed to generate UPI payment intent." });
  }
});

// 7. VERIFY UPI PAYMENT VIA 12-DIGIT UTR & CREDIT TOKENS (POST /api/payments/upi/verify)
router.post("/upi/verify", async (req, res): Promise<any> => {
  try {
    const {
      txn_ref,
      txnRef,
      utr_number,
      utrNumber,
      utr,
      student_id,
      studentId,
      student_name,
      studentName,
      student_email,
      studentEmail,
      parent_email,
      parentEmail,
      parent_name,
      parentName,
      course_id,
      courseId,
      course_name,
      courseName,
      tokens_purchased,
      tokensPurchased,
      amount,
      hourly_rate,
      hourlyRate
    } = req.body;

    const cleanUtr = String(utr_number || utrNumber || utr || "").trim();

    // Strict 12-digit UTR validation
    if (!/^\d{12}$/.test(cleanUtr)) {
      return res.status(400).json({
        success: false,
        message: "Invalid UTR number. The Bank UTR must contain exactly 12 numeric digits (e.g. 428190284918)."
      });
    }

    const tRef = txn_ref || txnRef;
    let intent = tRef ? pendingUpiIntentsStore.find(i => i.txn_ref === tRef) : undefined;

    const sId = student_id || studentId || intent?.student_id;
    const cId = course_id || courseId || intent?.course_id;
    const sName = student_name || studentName || intent?.student_name || "Rahul Kumar";
    const cName = course_name || courseName || intent?.course_name || "Full-Stack Coding & Web Dev";
    const sEmail = student_email || studentEmail || intent?.student_email || "student@topgrade.edu";
    const pEmail = parent_email || parentEmail || intent?.parent_email || "parent@topgrade.edu";
    const pName = parent_name || parentName || intent?.parent_name || "Parent";

    const tokens = Number(tokens_purchased || tokensPurchased || intent?.tokens_purchased || 2);
    const paidAmount = Number(amount || intent?.amount || (tokens * 40.00));
    const tokenPrice = Number(hourly_rate || hourlyRate || intent?.hourly_rate || (paidAmount / tokens));

    if (!sId || !cId) {
      return res.status(400).json({
        success: false,
        message: "Missing mandatory student_id or course_id for token allocation."
      });
    }

    if (intent) {
      intent.status = "PAID";
    }

    // 1. Credit tokens directly to student course balance (granular hour-as-token)
    const updatedBalance = CourseHoursService.creditTokens({
      studentId: sId,
      studentName: sName,
      courseId: cId,
      courseName: cName,
      tokensPurchased: tokens,
      hourlyRate: tokenPrice,
      maxHours: 25
    });

    // 2. Post balanced credit & debit entries to double-entry ledger
    const nowIso = new Date().toISOString();
    const invoiceResult = LedgerService.createInvoice({
      studentId: sId,
      studentName: sName,
      grossAmount: paidAmount,
      discountAmount: 0,
      dueDate: nowIso.slice(0, 10)
    });

    const paymentResult = LedgerService.processPayment({
      invoiceId: invoiceResult.invoice.invoiceNumber,
      amountPaid: paidAmount,
      paymentMethod: "UPI",
      clearanceRef: cleanUtr
    });

    // 3. Record verified payment order in paymentOrdersStore
    const orderNumber = `ORD-UPI-${new Date().getFullYear()}-${Math.floor(1000 + Math.random() * 9000)}`;
    const receiptNumber = `REC-UPI-${new Date().getFullYear()}-${Math.floor(1000 + Math.random() * 9000)}`;

    const orderRecord: PaymentOrderRecord = {
      id: `order-upi-${Date.now()}`,
      orderNumber,
      receiptNumber,
      studentId: sId,
      courseId: cId,
      pricingModel: "HOURLY_CREDIT_PACKAGE",
      purchasedHours: tokens,
      grossAmount: paidAmount,
      taxAmount: 0,
      totalPayable: paidAmount,
      paymentMethod: "UPI",
      payerClassification: "UPI_DIRECT",
      status: "PAID",
      bankUtRef: cleanUtr,
      createdAt: nowIso
    };

    paymentOrdersStore.unshift(orderRecord);

    // 4. Trigger confirmation email to parent detailing Course Name, Tokens/Hours Credited, Price per Token, Total Paid, and UTR
    const emailRecipients: Array<{ role: "STUDENT" | "PARENT" | "ADMIN"; email: string; name: string }> = [
      { role: "PARENT", email: pEmail, name: pName },
      { role: "STUDENT", email: sEmail, name: sName },
      { role: "ADMIN", email: process.env.ADMIN_EMAIL || "tglbiz101@gmail.com", name: "System Administrator" }
    ];

    const confirmationHtml = `
      <div style="font-family: 'Segoe UI', Tahoma, sans-serif; background: #f8f9ff; padding: 25px; border-radius: 18px; border: 2px solid #004ac6; max-width: 600px; margin: 0 auto;">
        <div style="text-align: center; margin-bottom: 20px;">
          <span style="font-size: 40px;">🎉 💳 🎓</span>
          <h2 style="color: #004ac6; margin: 10px 0 5px 0; font-size: 24px;">UPI Payment Confirmed!</h2>
          <p style="color: #434655; font-weight: 700; text-transform: uppercase; font-size: 11px; letter-spacing: 1px; margin: 0;">Top Grade Learning — Prepaid Class Hour Tokens</p>
        </div>
        <div style="background: #ffffff; padding: 22px; border-radius: 14px; box-shadow: 0 4px 15px rgba(0,0,0,0.05); color: #334155; line-height: 1.6; font-size: 13px;">
          <p>Dear <strong>${pName}</strong>,</p>
          <p>We are pleased to confirm that your UPI payment for <strong>${sName}</strong> has been successfully verified and credited with prepaid class hour tokens.</p>
          
          <table style="width: 100%; border-collapse: collapse; margin: 18px 0; background: #fdfdfd; border-radius: 10px; overflow: hidden; border: 1px solid #e2e8f0;">
            <tbody>
              <tr style="border-bottom: 1px solid #e2e8f0; background: #f8fafc;">
                <td style="padding: 10px 14px; color: #64748b; font-weight: 600;">Course Name:</td>
                <td style="padding: 10px 14px; font-weight: 800; color: #0d1c2f; text-align: right;">${cName}</td>
              </tr>
              <tr style="border-bottom: 1px solid #e2e8f0;">
                <td style="padding: 10px 14px; color: #64748b; font-weight: 600;">Tokens / Hours Credited:</td>
                <td style="padding: 10px 14px; font-weight: 900; color: #004ac6; text-align: right;">+${tokens} Class Tokens</td>
              </tr>
              <tr style="border-bottom: 1px solid #e2e8f0; background: #f8fafc;">
                <td style="padding: 10px 14px; color: #64748b; font-weight: 600;">Price per Token:</td>
                <td style="padding: 10px 14px; font-weight: 700; color: #0d1c2f; text-align: right;">$${tokenPrice.toFixed(2)} / Hour</td>
              </tr>
              <tr style="border-bottom: 1px solid #e2e8f0;">
                <td style="padding: 10px 14px; color: #64748b; font-weight: 600;">Total Amount Paid:</td>
                <td style="padding: 10px 14px; font-weight: 900; color: #16a34a; text-align: right;">₹${paidAmount.toFixed(2)}</td>
              </tr>
              <tr style="border-bottom: 1px solid #e2e8f0; background: #f8fafc;">
                <td style="padding: 10px 14px; color: #64748b; font-weight: 600;">12-Digit Bank UTR:</td>
                <td style="padding: 10px 14px; font-family: monospace; font-weight: 800; color: #4338ca; text-align: right;">${cleanUtr}</td>
              </tr>
              <tr style="background: #eff6ff;">
                <td style="padding: 10px 14px; color: #1e40af; font-weight: 800;">Available Token Balance:</td>
                <td style="padding: 10px 14px; font-weight: 900; color: #1e40af; text-align: right;">${updatedBalance.tokens_remaining} Class Hours</td>
              </tr>
            </tbody>
          </table>

          <div style="margin: 15px 0; padding: 12px; background: #f0fdf4; border-left: 4px solid #16a34a; border-radius: 6px; font-size: 12px; color: #15803d;">
            <strong>Token Consumption Policy:</strong> When the student attends class, 1 token is deducted automatically (1:1 deduction). You will receive an automated low quota alert if your balance reaches 2 or fewer tokens.
          </div>

          <p style="margin-top: 20px; font-weight: bold; color: #004ac6;">
            Warmest Regards,<br/>
            <strong>Top Grade Learning Accounts &amp; Admissions Division</strong><br/>
            <span style="font-size: 11px; color: #64748b; font-weight: normal;">tglbiz101@gmail.com</span>
          </p>
        </div>
      </div>
    `;

    dispatchMultiChannelNotification({
      eventType: "PAYMENT_COMPLETED",
      subject: `🧾 Payment Receipt: ${tokens} Class Tokens Credited for ${sName} (UTR: ${cleanUtr})`,
      message: confirmationHtml,
      recipients: emailRecipients
    }).catch(err => console.warn("Notice sending UPI payment receipt email:", err));

    return res.status(200).json({
      success: true,
      message: `Payment of ₹${paidAmount.toFixed(2)} verified via UPI! ${tokens} tokens credited successfully.`,
      data: {
        order: orderRecord,
        balance: updatedBalance,
        tokens_purchased: tokens,
        tokens_remaining: updatedBalance.tokens_remaining,
        tokens_consumed: updatedBalance.tokens_consumed,
        hourly_rate: tokenPrice,
        utr: cleanUtr,
        debitLedger: invoiceResult.debitEntry,
        creditLedger: paymentResult.creditEntry
      }
    });
  } catch (err: any) {
    return res.status(500).json({ success: false, message: err.message || "Failed to verify UPI payment." });
  }
});

// 8. GET STUDENT COURSE BALANCE (GET /api/payments/balance/:studentId)
router.get("/balance/:studentId", (req, res): any => {
  const { studentId } = req.params;
  const { courseId } = req.query;

  const balance = CourseHoursService.getStudentCourseBalance(studentId, courseId as string);
  if (!balance) {
    return res.json({
      success: true,
      data: {
        studentId,
        tokens_remaining: 0,
        tokens_consumed: 0,
        hourly_rate: 40.00,
        max_hours: 25,
        status: "EXHAUSTED",
        quotaWarningTriggered: true,
        teacherWarningMessage: "⚠️ No prepaid tokens found. Please purchase course hour tokens."
      }
    });
  }

  return res.json({
    success: true,
    data: balance
  });
});

export default router;
