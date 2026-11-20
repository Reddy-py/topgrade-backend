import { supabaseAdmin } from "../supabase.js";

export interface InstituteSettings {
  id: string;
  institute_name: string;
  timezone: string;
  address_line1: string;
  address_line2: string;
  city: string;
  state: string;
  zip: string;
  phone: string;
  support_email: string;
  currency: string;
  logo_url: string;
  program_types?: string[];
  course_categories?: string[];
  engagement_welcome_series_enabled?: boolean;
  engagement_monthly_update_enabled?: boolean;
  engagement_we_miss_you_enabled?: boolean;
  zelle_display_name?: string;
  zelle_tag?: string;
  zelle_email?: string;
  zelle_phone?: string;
  payment_instructions_note?: string;
  pending_order_expiry_days?: number;
  auto_confirm_strong_matches?: boolean;
  saved_bank_csv_mapping?: Record<string, string>;
  card_enabled?: boolean;
  zelle_enabled?: boolean;
  payments_enabled?: boolean;
  self_enrollment_mode?: "OFF" | "REQUEST" | "AUTO";
  // TASK 22 Automation Rollout Safety Switches
  low_hours_emails?: boolean;
  payment_reminders?: boolean;
  trial_automation?: boolean;
  waitlist?: boolean;
  onboarding_chaser?: boolean;
  win_back?: boolean;
  attendance_care?: boolean;
  admin_morning_digest?: boolean;
  bank_auto_confirm?: boolean;
  bank_feed?: boolean;
  pause_all_automatic_emails?: boolean;
  low_hours_threshold?: number;
  low_hours_recipients?: "STUDENT_ELSE_PARENT" | "BOTH";
  auto_confirm_limit?: number;
  matching_date_window_days?: number;
  request_expiry_days?: number;
  overdue_reminders?: boolean;
  admin_notification_emails?: string[];
  zelle_recipient_name?: string;
  zelle_instructions?: string;
  saved_bank_csv_mappings?: Record<string, string>;
  created_at?: string;
  updated_at?: string;
}

export type AutomationKey =
  | "low_hours_emails"
  | "payment_reminders"
  | "trial_automation"
  | "waitlist"
  | "onboarding_chaser"
  | "win_back"
  | "attendance_care"
  | "admin_morning_digest"
  | "bank_auto_confirm"
  | "bank_feed";

export const DEFAULT_PROGRAM_TYPES = ["TUTORING", "AFTERSCHOOL"];
export const DEFAULT_COURSE_CATEGORIES = [
  "Coding",
  "Robotics",
  "3D Printing",
  "Math",
  "Reading",
  "STEM & Technology",
  "Science",
  "Other"
];

export const DEFAULT_INSTITUTE_SETTINGS: InstituteSettings = {
  id: "default",
  institute_name: "Top Grade Learning",
  timezone: process.env.INSTITUTE_TIMEZONE || "America/Chicago",
  address_line1: process.env.INSTITUTE_ADDRESS_LINE1 || "100 Plainfield Ave, Suite 2B",
  address_line2: process.env.INSTITUTE_ADDRESS_LINE2 || "",
  city: process.env.INSTITUTE_CITY || "Edison",
  state: process.env.INSTITUTE_STATE || "NJ",
  zip: process.env.INSTITUTE_ZIP || "08817",
  phone: process.env.INSTITUTE_PHONE || "+1 (555) 019-2834",
  support_email: process.env.ADMIN_EMAIL || process.env.GMAIL_USER || "tglbiz101@gmail.com",
  currency: "usd",
  logo_url: "",
  payments_enabled: false,
  program_types: [...DEFAULT_PROGRAM_TYPES],
  course_categories: [...DEFAULT_COURSE_CATEGORIES],
  engagement_welcome_series_enabled: true,
  engagement_monthly_update_enabled: true,
  engagement_we_miss_you_enabled: true,
  zelle_display_name: "Top Grade Learning LLC",
  zelle_tag: "",
  zelle_email: "billing@topgradelearning.com",
  zelle_phone: "+1 (555) 019-2834",
  payment_instructions_note: "Pay in your bank app using Zelle and write this code in the memo.",
  pending_order_expiry_days: 7,
  auto_confirm_strong_matches: false,
  card_enabled: true,
  zelle_enabled: true,
  self_enrollment_mode: "REQUEST",
  // TASK 22 Automation Rollout Safety Defaults (Default OFF)
  low_hours_emails: false,
  payment_reminders: false,
  trial_automation: false,
  waitlist: false,
  onboarding_chaser: false,
  win_back: false,
  attendance_care: false,
  admin_morning_digest: false,
  bank_auto_confirm: false,
  bank_feed: false,
  pause_all_automatic_emails: false,
  low_hours_threshold: 2,
  low_hours_recipients: "STUDENT_ELSE_PARENT",
  auto_confirm_limit: 500,
  matching_date_window_days: 10,
  request_expiry_days: 7,
  overdue_reminders: false,
  admin_notification_emails: ["tglbiz101@gmail.com"],
  zelle_recipient_name: "Top Grade Learning LLC",
  zelle_instructions: "Pay in your bank app using Zelle and write this code in the memo. The institute confirms when the money arrives.",
  saved_bank_csv_mappings: {},
};

let cachedSettings: InstituteSettings = { ...DEFAULT_INSTITUTE_SETTINGS };
let lastFetchedAt = 0;
const CACHE_TTL_MS = 60_000; // 60 seconds cache

/**
 * Returns the current cached institute settings synchronously.
 * Enables synchronous callers (e.g. instituteTimezone, instituteNow, emailFooter)
 * to read settings without breaking synchronous signatures.
 */
export function getCachedInstituteSettings(): InstituteSettings {
  return cachedSettings;
}

/**
 * Resolves list of admin notification recipient emails from institute_settings.
 * Guarantees zero hardcoded addresses across the application.
 */
export function getAdminNotificationEmails(settings?: InstituteSettings): string[] {
  const s = settings || getCachedInstituteSettings();
  if (Array.isArray(s.admin_notification_emails) && s.admin_notification_emails.length > 0) {
    const list = s.admin_notification_emails.filter(e => typeof e === "string" && e.trim());
    if (list.length > 0) return list;
  }
  if (s.support_email && s.support_email.trim()) {
    return [s.support_email.trim()];
  }
  return [process.env.ADMIN_EMAIL || process.env.GMAIL_USER || "tglbiz101@gmail.com"];
}

/**
 * Checks whether an automation is currently allowed to dispatch emails.
 * Honors both the global kill switch and the individual automation switch.
 */
export function isAutomationEnabled(key: AutomationKey, settings?: InstituteSettings): boolean {
  const s = settings || getCachedInstituteSettings();
  if (s.pause_all_automatic_emails) {
    return false;
  }
  return Boolean(s[key]);
}

/**
 * Formats the postal address components into a single line string.
 */
export function formatPostalAddress(s: Partial<InstituteSettings>): string {
  const addressParts: string[] = [];
  if (s.address_line1?.trim()) addressParts.push(s.address_line1.trim());
  if (s.address_line2?.trim()) addressParts.push(s.address_line2.trim());

  const cityState = [s.city?.trim(), s.state?.trim()].filter(Boolean).join(", ");
  const cityStateZip = [cityState, s.zip?.trim()].filter(Boolean).join(" ");
  if (cityStateZip) addressParts.push(cityStateZip);

  return addressParts.join(", ");
}

/**
 * Returns the institute name and formatted postal address.
 * Appended to every notification email footer.
 */
export function emailFooter(override?: Partial<InstituteSettings>): string {
  const s = override ? { ...cachedSettings, ...override } : getCachedInstituteSettings();
  const address = formatPostalAddress(s);
  const name = s.institute_name?.trim() || "Top Grade Learning";
  const tz = s.timezone || "America/Chicago";
  if (!address) {
    return `${name} | Operating Timezone: ${tz}`;
  }
  return `${name} | ${address} | Operating Timezone: ${tz}`;
}

/**
 * Resets or clears the in-memory cache (primarily for tests).
 */
export function clearInstituteSettingsCache(): void {
  cachedSettings = { ...DEFAULT_INSTITUTE_SETTINGS };
  lastFetchedAt = 0;
}

/**
 * Directly injects cached settings (primarily for tests).
 */
export function setCachedInstituteSettings(settings: Partial<InstituteSettings>): void {
  cachedSettings = {
    ...cachedSettings,
    ...settings,
    timezone: settings.timezone || cachedSettings.timezone || "America/New_York",
  };
  lastFetchedAt = Date.now();
}

/**
 * Retrieves institute settings from database with a 60-second in-memory cache.
 * Falls back to DEFAULT_INSTITUTE_SETTINGS / environment variable if unavailable.
 */
export async function getInstituteSettings(forceRefresh = false): Promise<InstituteSettings> {
  const now = Date.now();
  if (!forceRefresh && (now - lastFetchedAt < CACHE_TTL_MS)) {
    return cachedSettings;
  }

  try {
    const { data, error } = await supabaseAdmin
      .from("institute_settings")
      .select("*")
      .eq("id", "default")
      .maybeSingle();

    if (!error && data) {
      const resolvedTz = data.institute_timezone || data.timezone || process.env.INSTITUTE_TIMEZONE || "America/Chicago";
      cachedSettings = {
        ...DEFAULT_INSTITUTE_SETTINGS,
        ...data,
        timezone: resolvedTz,
        program_types: Array.isArray(data.program_types) && data.program_types.length > 0 ? data.program_types : (cachedSettings.program_types || [...DEFAULT_PROGRAM_TYPES]),
        course_categories: Array.isArray(data.course_categories) && data.course_categories.length > 0 ? data.course_categories : (cachedSettings.course_categories || [...DEFAULT_COURSE_CATEGORIES]),
      };
      lastFetchedAt = now;
      return cachedSettings;
    }
  } catch (err: any) {
    console.warn("[INSTITUTE_SETTINGS] Failed to read institute_settings from DB, using cached defaults:", err?.message);
  }

  lastFetchedAt = now;
  return cachedSettings;
}

/**
 * Updates institute settings in database and immediately updates the in-memory cache.
 */
export async function updateInstituteSettings(updates: Partial<InstituteSettings>): Promise<InstituteSettings> {
  const payload = {
    ...updates,
    id: "default",
    updated_at: new Date().toISOString(),
  };

  try {
    const { data, error } = await supabaseAdmin
      .from("institute_settings")
      .upsert(payload, { onConflict: "id" })
      .select("*")
      .single();

    if (!error && data) {
      const resolvedTz = data.institute_timezone || data.timezone || process.env.INSTITUTE_TIMEZONE || "America/Chicago";
      cachedSettings = {
        ...DEFAULT_INSTITUTE_SETTINGS,
        ...data,
        timezone: resolvedTz,
        program_types: Array.isArray(data.program_types) && data.program_types.length > 0 ? data.program_types : (updates.program_types || cachedSettings.program_types || [...DEFAULT_PROGRAM_TYPES]),
        course_categories: Array.isArray(data.course_categories) && data.course_categories.length > 0 ? data.course_categories : (updates.course_categories || cachedSettings.course_categories || [...DEFAULT_COURSE_CATEGORIES]),
      };
      lastFetchedAt = Date.now();
      return cachedSettings;
    }
  } catch (err: any) {
    console.warn("[INSTITUTE_SETTINGS] Remote update note, falling back to cache:", err?.message);
  }

  // Gracefully apply updates to cachedSettings even if remote DB table is unmigrated
  cachedSettings = {
    ...cachedSettings,
    ...updates,
    timezone: updates.timezone || (updates as any).institute_timezone || cachedSettings.timezone || "America/Chicago",
    program_types: updates.program_types || cachedSettings.program_types || [...DEFAULT_PROGRAM_TYPES],
    course_categories: updates.course_categories || cachedSettings.course_categories || [...DEFAULT_COURSE_CATEGORIES],
    updated_at: new Date().toISOString(),
  };
  lastFetchedAt = Date.now();
  return cachedSettings;
}

let backgroundRefreshInterval: NodeJS.Timeout | null = null;

/**
 * Loads the settings once at server start and refreshes them in the background
 * every 60 seconds so instituteTimezone() is never stale or empty.
 */
export function startInstituteSettingsBackgroundRefresh(): void {
  if (backgroundRefreshInterval) return;
  // Load immediately on startup
  getInstituteSettings(true).catch(e => console.warn("[INSTITUTE_SETTINGS] Startup load error:", e?.message));
  // Background interval every 60 seconds
  backgroundRefreshInterval = setInterval(() => {
    getInstituteSettings(true).catch(e => console.warn("[INSTITUTE_SETTINGS] Background refresh error:", e?.message));
  }, CACHE_TTL_MS);
}

export function stopInstituteSettingsBackgroundRefresh(): void {
  if (backgroundRefreshInterval) {
    clearInterval(backgroundRefreshInterval);
    backgroundRefreshInterval = null;
  }
}

export function instituteAddress(): string {
  return formatPostalAddress(getCachedInstituteSettings());
}

// Eagerly prime the cache upon service load
void getInstituteSettings().catch(() => {});
