import { dispatchMultiChannelNotification } from "./notificationService.js";

export interface ReceiptDataInput {
  receiptNumber: string;
  orderNumber: string;
  studentName: string;
  studentCode: string;
  parentName?: string | undefined;
  studentEmail: string;
  parentEmail?: string | undefined;
  courseName: string;
  pricingModel: "HOURLY_CREDIT_PACKAGE" | "FIXED_COURSE_PACKAGE";
  purchasedHours?: number | undefined;
  grossAmount: number;
  taxAmount: number;
  totalPayable: number;
  paymentMethod: string;
  payerClassification?: string | undefined;
  chequeNumber?: string | undefined;
  bankName?: string | undefined;
  clearanceRef?: string | undefined;
  bankUtRef?: string | undefined;
  paymentDate: string;
}

export class ReceiptPdfService {
  /**
   * 1. Generates Official TopGrade Institutional Receipt HTML Document
   */
  public static generateReceiptHtml(data: ReceiptDataInput): string {
    const tax = (data.grossAmount * 0.18).toFixed(2);
    const total = (data.grossAmount * 1.18).toFixed(2);

    return `
<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <title>Official Fee Receipt - ${data.receiptNumber}</title>
  <style>
    body { font-family: 'Helvetica Neue', Helvetica, Arial, sans-serif; color: #0d1c2f; margin: 0; padding: 30px; background: #fff; }
    .receipt-box { max-width: 800px; margin: auto; border: 2px solid #004ac6; border-radius: 16px; padding: 30px; background: #fff; shadow: 0 4px 20px rgba(0,74,198,0.1); }
    .header { border-bottom: 3px solid #004ac6; padding-bottom: 15px; margin-bottom: 20px; display: flex; justify-content: space-between; align-items: center; }
    .title { font-size: 24px; font-weight: 900; color: #004ac6; text-transform: uppercase; letter-spacing: 1px; }
    .sub-title { font-size: 11px; font-weight: 700; color: #434655; text-transform: uppercase; }
    .badge { background: #004ac6; color: white; padding: 4px 12px; border-radius: 20px; font-size: 10px; font-weight: 800; text-transform: uppercase; }
    .grid { display: grid; grid-template-columns: 1fr 1fr; gap: 20px; margin-bottom: 20px; font-size: 12px; }
    .meta-card { background: #f8f9ff; padding: 15px; border-radius: 12px; border: 1px solid #c3c6d7; }
    .meta-title { font-size: 10px; font-weight: 800; color: #004ac6; text-transform: uppercase; margin-bottom: 6px; }
    table { width: 100%; border-collapse: collapse; margin: 20px 0; }
    th { background: #004ac6; color: white; text-align: left; padding: 10px; font-size: 11px; font-weight: 800; text-transform: uppercase; }
    td { padding: 12px 10px; border-bottom: 1px solid #e2e8f0; font-size: 12px; font-weight: 600; }
    .total-row { background: #eff4ff; font-weight: 900; color: #004ac6; }
    .stamp-box { border: 2px dashed #004ac6; padding: 15px; border-radius: 12px; text-align: center; color: #004ac6; font-weight: 800; font-size: 11px; }
  </style>
</head>
<body>
  <div class="receipt-box">
    <div class="header">
      <div>
        <div class="title">TopGrade Learning Institute</div>
        <div class="sub-title">Official Fee Payment Receipt &amp; Tax Invoice</div>
      </div>
      <div>
        <span class="badge">STAMPED &amp; VERIFIED</span>
        <div style="font-size: 11px; font-weight: 800; margin-top: 5px; color: #004ac6;">No: ${data.receiptNumber}</div>
      </div>
    </div>

    <div class="grid">
      <div class="meta-card">
        <div class="meta-title">Student &amp; Parent Details</div>
        <div><strong>Student Name:</strong> ${data.studentName}</div>
        <div><strong>Student ID:</strong> ${data.studentCode}</div>
        <div><strong>Parent Name:</strong> ${data.parentName || "Parent / Guardian"}</div>
        <div><strong>Email:</strong> ${data.studentEmail}</div>
      </div>

      <div class="meta-card">
        <div class="meta-title">Transaction &amp; Payer Metadata</div>
        <div><strong>Order Ref:</strong> ${data.orderNumber}</div>
        <div><strong>Payment Date:</strong> ${new Date(data.paymentDate).toLocaleDateString()}</div>
        <div><strong>Payment Method:</strong> ${data.paymentMethod}</div>
        <div><strong>Payer Tagging:</strong> ${data.payerClassification || "Direct Payment"}</div>
        ${data.chequeNumber ? `<div><strong>Cheque No:</strong> ${data.chequeNumber} (${data.bankName || "Bank"})</div>` : ""}
        ${data.bankUtRef ? `<div><strong>UTR Ref:</strong> ${data.bankUtRef}</div>` : ""}
      </div>
    </div>

    <table>
      <thead>
        <tr>
          <th>Item / Curriculum Description</th>
          <th>Pricing Package</th>
          <th>Units / Paid Hours</th>
          <th>Amount (INR)</th>
        </tr>
      </thead>
      <tbody>
        <tr>
          <td>${data.courseName}</td>
          <td>${data.pricingModel === "HOURLY_CREDIT_PACKAGE" ? "Hourly Credit Package" : "Fixed Course Package"}</td>
          <td>${data.purchasedHours ? `${data.purchasedHours} Paid Class Credits` : "Full Term"}</td>
          <td>₹${data.grossAmount.toFixed(2)}</td>
        </tr>
        <tr>
          <td colspan="3" style="text-align: right;"><strong>Subtotal:</strong></td>
          <td>₹${data.grossAmount.toFixed(2)}</td>
        </tr>
        <tr>
          <td colspan="3" style="text-align: right;"><strong>18% GST (CGST 9% + SGST 9%):</strong></td>
          <td>₹${tax}</td>
        </tr>
        <tr class="total-row">
          <td colspan="3" style="text-align: right; font-size: 13px;"><strong>TOTAL AMOUNT PAID:</strong></td>
          <td style="font-size: 14px;">₹${total}</td>
        </tr>
      </tbody>
    </table>

    <div class="grid">
      <div class="stamp-box">
        ✓ DIGITAL SEAL &amp; SIGNATURE<br>
        TopGrade Accounts Ledger Division<br>
        <span style="font-size: 9px; color: #434655;">Verified &amp; Cleared Automatically</span>
      </div>
      <div style="font-size: 10px; color: #737686; align-self: center;">
        Note: This is a computer-generated tax invoice and receipt. Fees paid are valid for the purchased class hour credits.
      </div>
    </div>
  </div>
</body>
</html>
    `;
  }

  /**
   * 2. Automated Confirmation Email Dispatcher with Receipt Attachment
   */
  public static async dispatchReceiptEmail(data: ReceiptDataInput): Promise<void> {
    const adminEmail = process.env.GMAIL_USER || "sivareddy683970@gmail.com";
    const receiptHtml = this.generateReceiptHtml(data);

    const recipients: Array<{ role: any; email: string; name: string }> = [
      { role: "STUDENT", email: data.studentEmail || adminEmail, name: data.studentName },
      { role: "ADMIN", email: adminEmail, name: "System Administrator" }
    ];

    if (data.parentEmail) {
      recipients.push({ role: "PARENT", email: data.parentEmail, name: data.parentName || "Parent" });
    }

    try {
      await dispatchMultiChannelNotification({
        eventType: "PAYMENT_COMPLETED",
        subject: `🧾 Official Payment Receipt — ${data.receiptNumber} (${data.courseName})`,
        message: `Dear ${data.studentName},\n\nYour payment of ₹${data.totalPayable.toFixed(2)} for '${data.courseName}' has been successfully confirmed!\n\nReceipt Number: ${data.receiptNumber}\nPayment Mode: ${data.paymentMethod} (${data.payerClassification || "Verified"})\n\nYour official institutional receipt PDF has been attached.\n\nBest Regards,\nTopGrade Accounts Division`,
        recipients,
        attachments: [
          {
            filename: `Official_Receipt_${data.receiptNumber}.html`,
            content: Buffer.from(receiptHtml, "utf-8"),
            contentType: "text/html"
          }
        ]
      });
    } catch (err) {
      console.warn("Receipt email dispatch note:", err);
    }
  }
}
