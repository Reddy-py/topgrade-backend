import express from "express";
import { RazorpayService } from "../services/razorpayService.js";
import { CourseHoursService, paymentOrdersStore } from "../services/courseHoursService.js";
import { ReceiptPdfService } from "../services/receiptPdfService.js";

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

export default router;
