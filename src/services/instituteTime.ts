import { getCachedInstituteSettings } from "./instituteSettingsService.js";

/**
 * "Today" for the institute, not for the server. A server in another time zone (most hosts run on UTC)
 * would otherwise send birthday wishes on the wrong day. Reads the configured time zone from
 * institute_settings (cached for 60 seconds, updated immediately on change).
 * Falls back to process.env.INSTITUTE_TIMEZONE, then America/New_York.
 */
export const instituteTimezone = (): string => {
  const settings = getCachedInstituteSettings();
  return settings.timezone || process.env.INSTITUTE_TIMEZONE || "America/Chicago";
};

export interface InstituteNow {
  dateStr: string; // YYYY-MM-DD in the institute's time zone
  year: number;
  month: number;   // 1-12
  day: number;     // 1-31
  hour: number;    // 0-23
}

export function instituteNow(at: Date = new Date()): InstituteNow {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: instituteTimezone(),
    year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", hourCycle: "h23",
  }).formatToParts(at);
  const get = (t: string) => Number(parts.find(p => p.type === t)?.value ?? 0);
  const year = get("year"), month = get("month"), day = get("day"), hour = get("hour");
  const pad = (n: number) => String(n).padStart(2, "0");
  return { dateStr: `${year}-${pad(month)}-${pad(day)}`, year, month, day, hour };
}

/** Returns today's date string (YYYY-MM-DD) in the institute's time zone. */
export function instituteToday(at: Date = new Date()): string {
  return instituteNow(at).dateStr;
}

/** True when this month/day is the birthday today. A 29 February birthday is celebrated on 28 February in non-leap years. */
export function isBirthdayToday(dob: { month: number; day: number }, now: InstituteNow): boolean {
  if (dob.month === now.month && dob.day === now.day) return true;
  const leap = (now.year % 4 === 0 && now.year % 100 !== 0) || now.year % 400 === 0;
  return !leap && dob.month === 2 && dob.day === 29 && now.month === 2 && now.day === 28;
}

/**
 * Returns the YYYY-MM-DD date string of the upcoming occurrence of a weekday in America/Chicago.
 */
export function getNextDayOfWeekDateStr(dayName: string): string {
  const dayNames = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
  const targetDay = dayNames.findIndex(d => d.toLowerCase() === dayName.toLowerCase());
  if (targetDay === -1) return instituteToday();

  const now = new Date();
  const todayParts = instituteNow(now);
  const todayUtc = new Date(Date.UTC(todayParts.year, todayParts.month - 1, todayParts.day));
  const currentDay = todayUtc.getUTCDay();

  let diff = targetDay - currentDay;
  if (diff <= 0) diff += 7;

  const nextDate = new Date(todayUtc.getTime() + diff * 24 * 3600 * 1000);
  const y = nextDate.getUTCFullYear();
  const m = String(nextDate.getUTCMonth() + 1).padStart(2, "0");
  const d = String(nextDate.getUTCDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

export function formatInstituteDate(date: Date, options?: Intl.DateTimeFormatOptions): string {
  return new Intl.DateTimeFormat("en-US", {
    timeZone: instituteTimezone(),
    weekday: "long",
    year: "numeric",
    month: "short",
    day: "numeric",
    ...options
  }).format(date);
}

export function formatInstituteTime(date: Date, includeSeconds = false): string {
  return new Intl.DateTimeFormat("en-US", {
    timeZone: instituteTimezone(),
    hour: "numeric",
    minute: "2-digit",
    ...(includeSeconds ? { second: "2-digit" } : {}),
    hour12: true
  }).format(date);
}

export function getInstituteDateString(date: Date = new Date()): string {
  return instituteNow(date).dateStr;
}

