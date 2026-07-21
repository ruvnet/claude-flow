/**
 * Consent domains and versioned receipts — ADR-302.
 *
 * Four+ distinct decisions, never bundled: account, proxy-install,
 * telemetry, cloud-routing, hosted-memory. A receipt is written on both
 * grant AND decline (a decline is a decision, not an absence). A stale
 * policyVersion means the consent must be re-asked before the capability
 * activates — never silently carried forward.
 */

import type { ConsentDomain, ConsentFile, ConsentReceipt } from './types.js';
import { CONSENT_POLICY_VERSION } from './types.js';
import { readStateJson, writeStateJson } from './state.js';

const CONSENT_FILE = 'consent.json';

export const CONSENT_DOMAINS: ConsentDomain[] = [
  'account',
  'proxy-install',
  'telemetry',
  'cloud-routing',
  'hosted-memory',
  'sponsored-downtime',
  'power-saver',
  'training-data-sharing',
  'advisor-tips',
  'rev-share-payout',
  'spinner-verbs',
  'company-announcements',
];

export function readConsents(): ConsentFile {
  return readStateJson<ConsentFile>(CONSENT_FILE) ?? {};
}

export function getConsent(domain: ConsentDomain): ConsentReceipt {
  const file = readConsents();
  return (
    file[domain] ?? { granted: false, policyVersion: CONSENT_POLICY_VERSION, at: null, surface: null }
  );
}

/**
 * Effective consent: granted AND at the current policy version. A receipt
 * from an older policy version is treated as not-consented (re-ask, never
 * carry forward).
 */
export function hasConsent(domain: ConsentDomain): boolean {
  const r = getConsent(domain);
  return r.granted === true && r.at !== null && r.policyVersion === CONSENT_POLICY_VERSION;
}

export function recordConsent(
  domain: ConsentDomain,
  granted: boolean,
  surface: string,
  now: Date = new Date(),
): ConsentReceipt {
  const file = readConsents();
  const receipt: ConsentReceipt = {
    granted,
    policyVersion: CONSENT_POLICY_VERSION,
    at: now.toISOString(),
    surface,
  };
  file[domain] = receipt;
  writeStateJson(CONSENT_FILE, file);
  return receipt;
}

export function revokeConsent(domain: ConsentDomain, surface: string): ConsentReceipt {
  return recordConsent(domain, false, surface);
}
