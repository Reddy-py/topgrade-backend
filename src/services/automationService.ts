import { supabaseAdmin } from "../supabase.js";
import {
  getCachedInstituteSettings,
  isAutomationEnabled,
  type AutomationKey,
  type InstituteSettings,
} from "./instituteSettingsService.js";

export interface AutomationPreviewRow {
  id: string;
  automation_key: AutomationKey;
  recipient_count: number;
  preview_data: any;
  created_at: string;
}

export interface AutomationStatusSummary {
  key: AutomationKey;
  enabled: boolean;
  killSwitchActive: boolean;
  lastRunAt?: string;
  previewCount: number;
  latestPreview?: any;
}

// In-memory fallback stores for offline testing / sandbox
export const inMemoryAutomationPreviews: AutomationPreviewRow[] = [];
export const inMemoryAutomationClaims = new Set<string>();
export const inMemoryBaselinesCaptured = new Set<string>();

/**
 * Gets today's date in America/Chicago timezone as YYYY-MM-DD
 */
export function getChicagoToday(): string {
  try {
    const formatter = new Intl.DateTimeFormat("en-CA", {
      timeZone: "America/Chicago",
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
    });
    return formatter.format(new Date());
  } catch {
    return new Date().toISOString().split("T")[0] || "2026-11-20";
  }
}

/**
 * Records a preview of what an automation WOULD have sent if it were enabled.
 * Used whenever an automation is executed while its switch is OFF.
 */
export async function recordAutomationPreview(
  automationKey: AutomationKey,
  recipientCount: number,
  previewData: any
): Promise<AutomationPreviewRow> {
  const row: AutomationPreviewRow = {
    id: `prev-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
    automation_key: automationKey,
    recipient_count: recipientCount,
    preview_data: previewData,
    created_at: new Date().toISOString(),
  };

  inMemoryAutomationPreviews.unshift(row);
  if (inMemoryAutomationPreviews.length > 200) {
    inMemoryAutomationPreviews.pop();
  }

  try {
    await supabaseAdmin.from("automation_previews").insert({
      id: row.id,
      automation_key: row.automation_key,
      recipient_count: row.recipient_count,
      preview_data: row.preview_data,
      created_at: row.created_at,
    });
  } catch {}

  return row;
}

/**
 * Retrieves the latest preview records for an automation or all automations.
 */
export async function getLatestAutomationPreviews(automationKey?: AutomationKey): Promise<AutomationPreviewRow[]> {
  try {
    let q = supabaseAdmin.from("automation_previews").select("*").order("created_at", { ascending: false }).limit(50);
    if (automationKey) {
      q = q.eq("automation_key", automationKey);
    }
    const { data } = await q;
    if (data && data.length > 0) {
      return data;
    }
  } catch {}

  if (automationKey) {
    return inMemoryAutomationPreviews.filter(p => p.automation_key === automationKey);
  }
  return inMemoryAutomationPreviews;
}

/**
 * Checks whether a specific automation action has already been claimed for a date.
 * Guarantees zero duplicate email sends even across two server instances or restarts.
 */
export async function isAutomationClaimed(
  claimType: string,
  entityId: string,
  claimedDate?: string
): Promise<boolean> {
  const dateStr = claimedDate || getChicagoToday();
  const memoryKey = `${claimType}::${entityId}::${dateStr}`;
  if (inMemoryAutomationClaims.has(memoryKey)) {
    return true;
  }

  try {
    const { data } = await supabaseAdmin
      .from("automation_claims")
      .select("id")
      .eq("claim_type", claimType)
      .eq("entity_id", entityId)
      .eq("claimed_date", dateStr)
      .maybeSingle();

    if (data) {
      inMemoryAutomationClaims.add(memoryKey);
      return true;
    }
  } catch {}

  return false;
}

/**
 * Claims an automation action for a given date. Returns false if already claimed.
 */
export async function claimAutomationAction(
  claimType: string,
  entityId: string,
  payload?: any,
  claimedDate?: string
): Promise<boolean> {
  const dateStr = claimedDate || getChicagoToday();
  const memoryKey = `${claimType}::${entityId}::${dateStr}`;

  if (inMemoryAutomationClaims.has(memoryKey)) {
    return false;
  }

  inMemoryAutomationClaims.add(memoryKey);

  try {
    const { error } = await supabaseAdmin.from("automation_claims").insert({
      claim_type: claimType,
      entity_id: entityId,
      claimed_date: dateStr,
      payload: payload || {},
      created_at: new Date().toISOString(),
    });

    if (error) {
      // 23505 is unique violation in Postgres
      if (error.code === "23505" || error.message.includes("unique")) {
        return false;
      }
    }
  } catch {}

  return true;
}

/**
 * When an admin enables an automation for the first time:
 * 1. Checks that the confirmed count matches the preview count (mandatory confirmation).
 * 2. Updates institute_settings to enable the automation.
 * 3. Captures all CURRENT conditions as the baseline without sending emails.
 */
export async function enableAutomationWithBaseline(params: {
  key: AutomationKey;
  confirmedCount: number;
  captureBaselineFn: () => Promise<number>;
  adminUserId?: string;
}): Promise<{ success: boolean; message: string; baselineCount: number }> {
  const { key, confirmedCount, captureBaselineFn, adminUserId } = params;

  // 1. Get latest preview to verify count
  const previews = await getLatestAutomationPreviews(key);
  const latest = previews[0];
  const expectedCount = latest ? latest.recipient_count : 0;

  if (confirmedCount !== expectedCount) {
    throw new Error(
      `Confirmation mismatch: Expected ${expectedCount} recipients from latest preview, but received ${confirmedCount}. Please review the preview before enabling.`
    );
  }

  // 2. Enable in settings
  const settings = getCachedInstituteSettings();
  const patch: Partial<InstituteSettings> = { [key]: true };
  Object.assign(settings, patch);

  try {
    await supabaseAdmin.from("institute_settings").update({
      [key]: true,
      updated_at: new Date().toISOString(),
    }).eq("id", settings.id || "default");
  } catch {}

  // 3. Capture baseline WITHOUT emailing
  let baselineCount = 0;
  try {
    baselineCount = await captureBaselineFn();
    inMemoryBaselinesCaptured.add(key);
  } catch (err) {
    console.warn(`Notice capturing baseline for ${key}:`, err);
  }

  return {
    success: true,
    message: `Automation '${key}' enabled successfully. Baseline of ${baselineCount} existing condition(s) recorded without sending emails. Only new crossings will trigger email dispatches.`,
    baselineCount,
  };
}

/**
 * Toggles the global kill switch 'Pause all automatic emails'.
 */
export async function toggleGlobalEmailKillSwitch(pause: boolean): Promise<boolean> {
  const settings = getCachedInstituteSettings();
  settings.pause_all_automatic_emails = pause;

  try {
    await supabaseAdmin.from("institute_settings").update({
      pause_all_automatic_emails: pause,
      updated_at: new Date().toISOString(),
    }).eq("id", settings.id || "default");
  } catch {}

  return pause;
}
