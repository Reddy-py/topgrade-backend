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
  self_enrollment_mode?: "OFF" | "REQUEST" | "AUTO";
  created_at?: string;
  updated_at?: string;
}

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
  timezone: process.env.INSTITUTE_TIMEZONE || "America/New_York",
  address_line1: process.env.INSTITUTE_ADDRESS_LINE1 || "100 Plainfield Ave, Suite 2B",
  address_line2: process.env.INSTITUTE_ADDRESS_LINE2 || "",
  city: process.env.INSTITUTE_CITY || "Edison",
  state: process.env.INSTITUTE_STATE || "NJ",
  zip: process.env.INSTITUTE_ZIP || "08817",
  phone: process.env.INSTITUTE_PHONE || "+1 (555) 019-2834",
  support_email: process.env.ADMIN_EMAIL || process.env.GMAIL_USER || "tglbiz101@gmail.com",
  currency: "usd",
  logo_url: "",
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
  if (!address) {
    return name;
  }
  return `${name} | ${address}`;
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
      cachedSettings = {
        ...DEFAULT_INSTITUTE_SETTINGS,
        ...data,
        timezone: data.timezone || process.env.INSTITUTE_TIMEZONE || "America/New_York",
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
      cachedSettings = {
        ...DEFAULT_INSTITUTE_SETTINGS,
        ...data,
        timezone: data.timezone || process.env.INSTITUTE_TIMEZONE || "America/New_York",
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
    timezone: updates.timezone || cachedSettings.timezone || "America/New_York",
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
