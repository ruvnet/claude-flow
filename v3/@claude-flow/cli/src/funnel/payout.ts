/**
 * Developer revenue-share enrollment state — ADR-317, Phase 0.
 *
 * Stores an opaque enrollment token issued by the funnel.ruv.io backend
 * after the user completes browser-side KYC + Stripe Connect. The client
 * never introspects the token; it just includes it in attribution events
 * so the backend can credit the correct payout account.
 *
 * Consent for the `rev-share-payout` domain is a PRECONDITION for
 * enrollment (see ADR-317 §1). Consent alone does not mean earning —
 * an enrollment token is also required, and KYC can fail after consent
 * is granted for reasons outside the user's control. Callers should
 * check both when deciding whether to enrich attribution.
 */

import type { PayoutEnrollment, PayoutEnrollmentPolicyVersion } from './types.js';
import { readStateJson, writeStateJson } from './state.js';
import { hasConsent } from './consent.js';

const PAYOUT_FILE = 'funnel-payout.json';

/** Bump when the payout policy changes materially (e.g., 50/50 → other split). */
export const PAYOUT_POLICY_VERSION: PayoutEnrollmentPolicyVersion = 1;

export function getEnrollment(): PayoutEnrollment | null {
  return readStateJson<PayoutEnrollment>(PAYOUT_FILE);
}

/**
 * Whether attribution events should be enriched with the user's enrollment
 * token. True only when BOTH consent is granted AND a verified token exists —
 * either alone means "not yet earning."
 */
export function isEarningEligible(): boolean {
  if (!hasConsent('rev-share-payout')) return false;
  const rec = getEnrollment();
  return !!rec && rec.kyc_status === 'verified' && !!rec.enrollment_token;
}

/** Opaque token safe to include in attribution events. Null when not eligible. */
export function getAttributionToken(): string | null {
  if (!isEarningEligible()) return null;
  const rec = getEnrollment();
  return rec?.enrollment_token ?? null;
}

/**
 * Record a successful enrollment (called by the CLI subcommand after the
 * browser-side flow returns via device-code callback). Never called from
 * hot paths — this is a rare, user-initiated write.
 */
export function recordEnrollment(rec: Omit<PayoutEnrollment, 'policy_version'>): PayoutEnrollment {
  const full: PayoutEnrollment = { ...rec, policy_version: PAYOUT_POLICY_VERSION };
  writeStateJson(PAYOUT_FILE, full);
  return full;
}

/**
 * Delete local enrollment state. Called by `ruflo funnel unenroll`. The
 * server-side revoke is separate — this only removes the local token so
 * subsequent attribution events stop being enriched. Idempotent — deleting
 * a missing enrollment is a no-op success.
 */
export function deleteEnrollment(): boolean {
  return writeStateJson(PAYOUT_FILE, null);
}
