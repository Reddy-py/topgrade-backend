/**
 * Payment Provider Abstraction Layer for Top Grade CRM.
 * Supports:
 * 1. STRIPE_CARD: Hosted Stripe Checkout, automatic confirmation, refunds, dispute freeze.
 * 2. ZELLE: Bank-verified admin reconciliation (Task 16).
 */

import { getCachedInstituteSettings } from "./instituteSettingsService.js";
import { isStripeConfigured, getStripeMode, isStripeWebhookConfigured } from "./stripeService.js";

export type PaymentMethodCode = "STRIPE_CARD" | "ZELLE";

export interface PaymentMethodDescriptor {
  code: PaymentMethodCode;
  name: string;
  badge: string;
  description: string;
  isAutomated: boolean;
  requiresReconciliation: boolean;
  enabled: boolean;
}

export interface PaymentProvider {
  readonly code: PaymentMethodCode;
  readonly displayName: string;
  readonly isAutomated: boolean;
  isAvailable(): boolean;
}

export class StripeCardProvider implements PaymentProvider {
  readonly code = "STRIPE_CARD" as const;
  readonly displayName = "Credit or Debit Card";
  readonly isAutomated = true;

  isAvailable(): boolean {
    const settings = getCachedInstituteSettings();
    const enabledInSettings = settings.card_enabled !== false;
    return enabledInSettings && isStripeConfigured();
  }
}

export class ZellePaymentProvider implements PaymentProvider {
  readonly code = "ZELLE" as const;
  readonly displayName = "Zelle (Bank Transfer)";
  readonly isAutomated = false;

  isAvailable(): boolean {
    const settings = getCachedInstituteSettings();
    return settings.zelle_enabled !== false;
  }
}

export const stripeCardProvider = new StripeCardProvider();
export const zellePaymentProvider = new ZellePaymentProvider();

/**
 * Returns available payment methods based on institute settings and environment readiness.
 * If neither is enabled/configured, returns an empty array.
 */
export function getAvailablePaymentMethods(): PaymentMethodDescriptor[] {
  const settings = getCachedInstituteSettings();
  const methods: PaymentMethodDescriptor[] = [];

  const cardConfigured = isStripeConfigured();
  const cardEnabled = settings.card_enabled !== false;

  if (cardEnabled && cardConfigured) {
    methods.push({
      code: "STRIPE_CARD",
      name: "Credit / Debit Card",
      badge: "Instant Credit",
      description: "Pay securely via Stripe hosted checkout with Visa, Mastercard, or Amex.",
      isAutomated: true,
      requiresReconciliation: false,
      enabled: true,
    });
  }

  const zelleEnabled = settings.zelle_enabled !== false;
  if (zelleEnabled) {
    methods.push({
      code: "ZELLE",
      name: "Zelle (Bank Transfer)",
      badge: "Bank Verified",
      description: "Pay using your bank app with reference memo. Hours credited upon admin bank reconciliation.",
      isAutomated: false,
      requiresReconciliation: true,
      enabled: true,
    });
  }

  return methods;
}

/**
 * Diagnostic report of payment systems status (never printing secret keys).
 */
export function getPaymentSystemStatus(): {
  card_enabled: boolean;
  zelle_enabled: boolean;
  stripe_configured: boolean;
  stripe_mode: "test" | "live" | "unconfigured";
  stripe_webhook_configured: boolean;
  zelle_recipient_ready: boolean;
} {
  const settings = getCachedInstituteSettings();
  const stripeMode = getStripeMode();
  const hasZelleRecipient = !!(settings.zelle_email || settings.zelle_phone || settings.zelle_tag);

  return {
    card_enabled: settings.card_enabled !== false,
    zelle_enabled: settings.zelle_enabled !== false,
    stripe_configured: isStripeConfigured(),
    stripe_mode: stripeMode,
    stripe_webhook_configured: isStripeWebhookConfigured(),
    zelle_recipient_ready: hasZelleRecipient,
  };
}
