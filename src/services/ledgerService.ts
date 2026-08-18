export interface InvoiceCreationInput {
  studentId: string;
  studentName: string;
  grossAmount: number;
  discountAmount?: number;
  dueDate: string;
}

export interface PaymentProcessingInput {
  invoiceId: string;
  amountPaid: number;
  paymentMethod: "CREDIT_CARD" | "CASH" | "BANK_TRANSFER" | "CHEQUE";
  chequeNumber?: string;
  bankName?: string;
  clearanceRef?: string;
  chequeImageUrl?: string;
}

export class LedgerService {
  private static ledgerBalanceTracker = 14500.00;

  /**
   * Creates tuition invoice with line-item discount & posts initial DEBIT ledger entry
   */
  public static createInvoice(input: InvoiceCreationInput) {
    const discount = input.discountAmount || 0;
    const netPayable = Math.max(0, input.grossAmount - discount);
    const invoiceNumber = `INV-${new Date().getFullYear()}-${Math.floor(1000 + Math.random() * 9000)}`;

    // Debit Ledger Entry
    this.ledgerBalanceTracker += netPayable;
    const debitEntry = {
      id: `ledg-deb-${Date.now()}`,
      invoiceId: invoiceNumber,
      entryType: "DEBIT",
      accountHead: "Accounts Receivable — Tuition Fees",
      amount: netPayable,
      balanceAfter: this.ledgerBalanceTracker,
      description: `Invoice ${invoiceNumber} issued for ${input.studentName} (Gross: $${input.grossAmount}, Waiver: $${discount})`,
      timestamp: new Date().toISOString()
    };

    return {
      invoice: {
        id: `inv-${Date.now()}`,
        invoiceNumber,
        studentId: input.studentId,
        totalAmount: input.grossAmount,
        discountAmount: discount,
        netPayable,
        status: "UNPAID",
        dueDate: input.dueDate,
        createdAt: new Date().toISOString()
      },
      debitEntry
    };
  }

  /**
   * Processes payment receipt and posts CREDIT ledger entry
   */
  public static processPayment(input: PaymentProcessingInput) {
    const receiptNumber = `REC-${new Date().getFullYear()}-${Math.floor(1000 + Math.random() * 9000)}`;

    // Credit Ledger Entry
    this.ledgerBalanceTracker -= input.amountPaid;
    const creditEntry = {
      id: `ledg-cred-${Date.now()}`,
      invoiceId: input.invoiceId,
      entryType: "CREDIT",
      accountHead: "Cash / Bank Clearing Account",
      amount: input.amountPaid,
      balanceAfter: this.ledgerBalanceTracker,
      description: `Payment received via ${input.paymentMethod} for Invoice ${input.invoiceId} (Receipt: ${receiptNumber})`,
      timestamp: new Date().toISOString()
    };

    return {
      receipt: {
        id: `rec-${Date.now()}`,
        receiptNumber,
        invoiceId: input.invoiceId,
        amountPaid: input.amountPaid,
        paymentMethod: input.paymentMethod,
        chequeNumber: input.chequeNumber || null,
        bankName: input.bankName || null,
        clearanceRef: input.clearanceRef || null,
        chequeImageUrl: input.chequeImageUrl || null,
        paymentDate: new Date().toISOString()
      },
      creditEntry
    };
  }
}
