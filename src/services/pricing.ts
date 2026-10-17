/**
 * Pricing and Enrollment Quote Engine
 *
 * Decisions:
 * - Every class is exactly 1 hour.
 * - A student's balance is a whole number of hours per course.
 * - A course can be sold as a PACKAGE (fixed price, fixed number of hours, valid for the course duration)
 *   or as extra HOURS at the course's hourly rate.
 * - A package student may also buy extra hours.
 * - Package hours expire at the end of the package; extra hours never expire.
 */

export type EnrollmentPlan = "PACKAGE" | "HOURS";

export interface CoursePricingInput {
  id?: string;
  name?: string;
  package_price?: number | null;
  package_hours?: number | null;
  hourly_rate?: number | null;
  duration_months?: number | null;
  duration?: string | null;
}

export interface EnrollmentQuote {
  plan: EnrollmentPlan;
  hours_total: number;
  quoted_amount: number; // rounded to 2 decimal places (cents)
  currency: string;      // "usd"
  starts_on: string;     // YYYY-MM-DD
  expires_on: string | null; // YYYY-MM-DD or null
  is_valid: boolean;
  error?: string;
}

/**
 * Calculates expiration date given a start date string (YYYY-MM-DD) and duration in months.
 */
export function calculatePackageExpiry(startsOnIso: string, durationMonths: number): string {
  const parts = startsOnIso.split("-").map(Number);
  const year = parts[0] || new Date().getFullYear();
  const month = parts[1] || 1;
  const day = parts[2] || 1;

  const dt = new Date(year, month - 1, day);
  dt.setMonth(dt.getMonth() + (durationMonths > 0 ? durationMonths : 6));

  const yyyy = dt.getFullYear();
  const mm = String(dt.getMonth() + 1).padStart(2, "0");
  const dd = String(dt.getDate()).padStart(2, "0");
  return `${yyyy}-${mm}-${dd}`;
}

/**
 * Pure function quoteEnrollment(course, plan, hours, startsOn?)
 * - PACKAGE returns package_price and package_hours, expires_on = starts_on + duration_months
 * - HOURS returns hours times hourly_rate, rounded to cents, expires_on = null (never expires)
 */
export function quoteEnrollment(
  course: CoursePricingInput | null | undefined,
  plan: EnrollmentPlan,
  hours?: number | null,
  startsOn?: string | Date
): EnrollmentQuote {
  const now = startsOn ? (startsOn instanceof Date ? startsOn.toISOString().slice(0, 10) : startsOn.slice(0, 10)) : new Date().toISOString().slice(0, 10);

  if (!course) {
    return {
      plan,
      hours_total: 0,
      quoted_amount: 0,
      currency: "usd",
      starts_on: now,
      expires_on: null,
      is_valid: false,
      error: "Course information is required to generate quote."
    };
  }

  if (plan === "PACKAGE") {
    const pkgPrice = Number(course.package_price);
    const pkgHours = Number(course.package_hours);

    if (isNaN(pkgPrice) || pkgPrice <= 0) {
      return {
        plan: "PACKAGE",
        hours_total: isNaN(pkgHours) || pkgHours <= 0 ? 0 : pkgHours,
        quoted_amount: 0,
        currency: "usd",
        starts_on: now,
        expires_on: null,
        is_valid: false,
        error: "Course package price not set. Please set a positive package price on the Courses page."
      };
    }

    if (isNaN(pkgHours) || pkgHours <= 0) {
      return {
        plan: "PACKAGE",
        hours_total: 0,
        quoted_amount: Math.round(pkgPrice * 100) / 100,
        currency: "usd",
        starts_on: now,
        expires_on: null,
        is_valid: false,
        error: "Course package hours not set. Please set a positive number of package hours."
      };
    }

    const durationMonths = Number(course.duration_months) > 0 ? Number(course.duration_months) : 6;
    const expiresOn = calculatePackageExpiry(now, durationMonths);

    return {
      plan: "PACKAGE",
      hours_total: Math.floor(pkgHours),
      quoted_amount: Math.round(pkgPrice * 100) / 100,
      currency: "usd",
      starts_on: now,
      expires_on: expiresOn,
      is_valid: true
    };
  }

  if (plan === "HOURS") {
    const hRate = Number(course.hourly_rate);
    const qty = Number(hours);

    if (isNaN(hRate) || hRate <= 0) {
      return {
        plan: "HOURS",
        hours_total: isNaN(qty) || qty <= 0 ? 0 : Math.floor(qty),
        quoted_amount: 0,
        currency: "usd",
        starts_on: now,
        expires_on: null,
        is_valid: false,
        error: "Course hourly rate not set. Please set an hourly rate on the Courses page."
      };
    }

    if (isNaN(qty) || qty <= 0) {
      return {
        plan: "HOURS",
        hours_total: 0,
        quoted_amount: 0,
        currency: "usd",
        starts_on: now,
        expires_on: null,
        is_valid: false,
        error: "Please enter a positive number of hours."
      };
    }

    const wholeHours = Math.floor(qty);
    const rawTotal = wholeHours * hRate;
    const roundedCents = Math.round(rawTotal * 100) / 100;

    return {
      plan: "HOURS",
      hours_total: wholeHours,
      quoted_amount: roundedCents,
      currency: "usd",
      starts_on: now,
      expires_on: null, // extra hours never expire
      is_valid: true
    };
  }

  return {
    plan,
    hours_total: 0,
    quoted_amount: 0,
    currency: "usd",
    starts_on: now,
    expires_on: null,
    is_valid: false,
    error: `Unknown plan: '${plan}'. Must be PACKAGE or HOURS.`
  };
}
