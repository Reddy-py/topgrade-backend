export type EnrollmentStage = "FORM_SUBMITTED" | "UNDER_REVIEW" | "APPROVED" | "ACTIVATED" | "DE_ENROLLED";

export interface EnrollmentStateContext {
  enrollmentId: string;
  leadId?: string;
  studentName: string;
  email: string;
  primaryMobile: string;
  dob: string;
  address: string;
  academicGrade: string;
  currentStatus: EnrollmentStage;
  financialWaiver: boolean;
  transportWaiver: boolean;
  mediaWaiver: boolean;
}

export class EnrollmentService {
  /**
   * Auto-calculates dynamic age from Date of Birth string (YYYY-MM-DD)
   */
  public static calculateDynamicAge(dobString: string): number {
    const dob = new Date(dobString);
    const today = new Date();
    let age = today.getFullYear() - dob.getFullYear();
    const monthDiff = today.getMonth() - dob.getMonth();
    if (monthDiff < 0 || (monthDiff === 0 && today.getDate() < dob.getDate())) {
      age--;
    }
    return age > 0 ? age : 0;
  }

  /**
   * Validates state transition progression
   */
  public static transitionStage(
    current: EnrollmentStage,
    next: EnrollmentStage
  ): { valid: boolean; message: string } {
    const validTransitions: Record<EnrollmentStage, EnrollmentStage[]> = {
      FORM_SUBMITTED: ["UNDER_REVIEW"],
      UNDER_REVIEW: ["APPROVED"],
      APPROVED: ["ACTIVATED"],
      ACTIVATED: ["DE_ENROLLED"],
      DE_ENROLLED: []
    };

    const allowedNext = validTransitions[current] || [];
    if (!allowedNext.includes(next)) {
      return {
        valid: false,
        message: `Invalid state transition: Cannot transition enrollment from '${current}' directly to '${next}'. Expected next state: '${allowedNext.join(", ")}'.`
      };
    }

    return { valid: true, message: `Transitioned successfully from '${current}' to '${next}'.` };
  }

  /**
   * Generates formatted student code (e.g. TG-2026-8912)
   */
  public static generateStudentCode(): string {
    const rand = Math.floor(1000 + Math.random() * 9000);
    return `TG-${new Date().getFullYear()}-${rand}`;
  }
}
