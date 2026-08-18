export interface RescheduleRequestInput {
  studentId: string;
  studentName: string;
  classSessionId: string;
  sessionStartTime: Date;
  requestedNewTime: string;
  reason: string;
  existingRescheduleCount: number;
}

export interface RescheduleValidationResult {
  allowed: boolean;
  status: "APPROVED" | "REJECTED_NOTICE_WINDOW" | "REJECTED_CAP_EXCEEDED" | "PENDING";
  noticeWindowHours: number;
  termAttemptCount: number;
  rejectionReason?: string;
  message: string;
}

export class RescheduleService {
  private static NOTICE_WINDOW_HOURS_REQUIRED = 24.0;
  private static MAX_RESCHEDULING_LIMIT_PER_TERM = 3;

  /**
   * Validates a student reschedule request against the 24h notice window & 3-reschedule limit per term.
   */
  public static validateAndProcessRequest(input: RescheduleRequestInput): RescheduleValidationResult {
    const now = new Date();
    const sessionStart = new Date(input.sessionStartTime);
    
    // 1. Calculate notice window in hours
    const timeDifferenceMs = sessionStart.getTime() - now.getTime();
    const noticeWindowHours = Number((timeDifferenceMs / (1000 * 60 * 60)).toFixed(2));

    // 2. Check 24-Hour Notice Constraint
    if (noticeWindowHours < this.NOTICE_WINDOW_HOURS_REQUIRED) {
      return {
        allowed: false,
        status: "REJECTED_NOTICE_WINDOW",
        noticeWindowHours,
        termAttemptCount: input.existingRescheduleCount + 1,
        rejectionReason: "Less than 24 hours advance notice provided.",
        message: "Reschedule request rejected: Minimum 24 hours advance notice required before scheduled session."
      };
    }

    // 3. Check Term Rescheduling Cap (Max <= 3 attempts)
    if (input.existingRescheduleCount >= this.MAX_RESCHEDULING_LIMIT_PER_TERM) {
      return {
        allowed: false,
        status: "REJECTED_CAP_EXCEEDED",
        noticeWindowHours,
        termAttemptCount: input.existingRescheduleCount + 1,
        rejectionReason: "Exceeded maximum limit of 3 reschedules per term.",
        message: "Sorry for the inconvenience. You have exceeded the rescheduling limit of 3 sessions per term."
      };
    }

    // 4. Request Approved
    const newAttemptCount = input.existingRescheduleCount + 1;
    return {
      allowed: true,
      status: "APPROVED",
      noticeWindowHours,
      termAttemptCount: newAttemptCount,
      message: `Reschedule request approved successfully! (Attempt ${newAttemptCount} of ${this.MAX_RESCHEDULING_LIMIT_PER_TERM} for this term)`
    };
  }
}
