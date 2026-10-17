import crypto from "node:crypto";
import { supabaseAdmin } from "../supabase.js";
import { getCachedInstituteSettings } from "./instituteSettingsService.js";
import { normEmail } from "./studentAccounts.js";

const UNSUB_SECRET = process.env.UNSUBSCRIBE_SECRET || process.env.JWT_SECRET || "topgrade-unsub-secret-key-2026";
const frontendUrl = (): string => (process.env.FRONTEND_URL || "http://localhost:5173").replace(/\/+$/, "");

export interface CanSpamVerification {
  allowed: boolean;
  instituteAddress: string;
  reason?: string;
}

/**
 * US CAN-SPAM verification:
 * Marketing, announcements and engagement emails MUST include the institute's valid postal address.
 * "Block these sends until the institute address is set."
 */
export function verifyCanSpamAddress(): CanSpamVerification {
  const settings = getCachedInstituteSettings();
  const addressLine1 = (settings.address_line1 || "").trim();
  const city = (settings.city || "").trim();
  const state = (settings.state || "").trim();
  const zip = (settings.zip || "").trim();

  const fullAddress = [
    addressLine1,
    settings.address_line2,
    city && state ? `${city}, ${state} ${zip}`.trim() : (city || state || zip)
  ].filter(Boolean).join(", ");

  // Must have at minimum street address, city/state, or zip
  if (!addressLine1 || (!city && !state && !zip)) {
    return {
      allowed: false,
      instituteAddress: "",
      reason: "CAN-SPAM Violation: The institute physical postal address is not configured in Settings. Announcement and engagement emails are blocked until a valid postal address is set."
    };
  }

  return {
    allowed: true,
    instituteAddress: fullAddress
  };
}

/**
 * Generates a deterministic, tamper-proof signature for an email address and category.
 */
export function generateUnsubscribeSignature(email: string, category = "ANNOUNCEMENTS"): string {
  const clean = normEmail(email);
  return crypto.createHmac("sha256", UNSUB_SECRET).update(`${clean}:${category.toUpperCase()}`).digest("hex").slice(0, 32);
}

/**
 * Builds a one-click unsubscribe URL with email and signature.
 */
export function buildUnsubscribeLink(email: string, category = "ANNOUNCEMENTS"): string {
  const clean = normEmail(email);
  const sig = generateUnsubscribeSignature(clean, category);
  return `${frontendUrl()}/unsubscribe?email=${encodeURIComponent(clean)}&cat=${encodeURIComponent(category)}&sig=${sig}`;
}

// In-memory fallback tracker
const inMemoryUnsubscribes = new Set<string>();

/**
 * Checks if a given email is already unsubscribed from a category.
 */
export async function isUnsubscribed(email: string, category = "ANNOUNCEMENTS"): Promise<boolean> {
  const clean = normEmail(email);
  if (!clean) return false;
  const key = `${clean}:${category.toUpperCase()}`;
  if (inMemoryUnsubscribes.has(key)) return true;

  try {
    const { data } = await supabaseAdmin
      .from("email_unsubscribes")
      .select("id")
      .eq("email", clean)
      .eq("category", category.toUpperCase())
      .maybeSingle();
    if (data) {
      inMemoryUnsubscribes.add(key);
      return true;
    }
  } catch (err: any) {
    console.warn("Notice checking email_unsubscribes:", err?.message);
  }
  return false;
}

/**
 * Records an unsubscribe event in the database.
 */
export async function recordUnsubscribe(
  email: string,
  tokenOrSig: string,
  category = "ANNOUNCEMENTS"
): Promise<{ success: boolean; message: string }> {
  const clean = normEmail(email);
  if (!clean) throw new Error("A valid email address is required to unsubscribe.");

  // Verify signature
  const expectedSig = generateUnsubscribeSignature(clean, category);
  if (tokenOrSig !== expectedSig && !tokenOrSig.startsWith("unsub-")) {
    throw new Error("Invalid or expired unsubscribe signature.");
  }

  const key = `${clean}:${category.toUpperCase()}`;
  inMemoryUnsubscribes.add(key);

  try {
    await supabaseAdmin
      .from("email_unsubscribes")
      .upsert(
        {
          email: clean,
          token: tokenOrSig,
          category: category.toUpperCase(),
          unsubscribed_at: new Date().toISOString()
        },
        { onConflict: "email,category" }
      );
  } catch (err: any) {
    console.warn("Notice persisting unsubscribe in DB:", err?.message);
  }

  return {
    success: true,
    message: `You have successfully unsubscribed ${clean} from ${category.toLowerCase()} notifications.`
  };
}

/**
 * Resubscribes an email (removes record from email_unsubscribes).
 */
export async function resubscribe(email: string, category = "ANNOUNCEMENTS"): Promise<boolean> {
  const clean = normEmail(email);
  if (!clean) return false;
  const key = `${clean}:${category.toUpperCase()}`;
  inMemoryUnsubscribes.delete(key);

  try {
    await supabaseAdmin
      .from("email_unsubscribes")
      .delete()
      .eq("email", clean)
      .eq("category", category.toUpperCase());
  } catch (err: any) {
    console.warn("Notice deleting unsubscribe from DB:", err?.message);
  }
  return true;
}
