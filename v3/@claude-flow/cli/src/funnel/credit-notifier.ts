/**
 * Credit-exhaustion notifier — writes a marker file so the ADR-303 recovery
 * surface fires on the next appropriate command render, and keeps a short
 * user-visible notification in `~/.ruflo/credit-status.json`.
 *
 * This is NOT the ADR-303 credit-error classifier — that lives in
 * `credit-errors.ts` and reads provider error codes to decide when a
 * credit surface fires *during* a command. This module is the OUT-OF-BAND
 * signal path: the analytics transport detected a credit-exhausted
 * response (HTTP 402 or ADR-303 machine-readable code), and we need to
 * warn the user asynchronously.
 *
 * State is cheap and durable:
 *   ~/.ruflo/credit-status.json = { exhausted: bool, since: ISO, cleared: ISO|null }
 *
 * Cleared automatically when the user opens the enrollment / signup
 * surface, or explicitly via `ruflo funnel credit-clear`.
 */

import { readStateJson, writeStateJson } from './state.js';

export const CREDIT_STATUS_FILE = 'credit-status.json';

export interface CreditStatus {
  exhausted: boolean;
  since: string | null;
  cleared: string | null;
}

/** Read the current credit status. Never throws. */
export function readCreditStatus(): CreditStatus {
  const raw = readStateJson<CreditStatus>(CREDIT_STATUS_FILE);
  return {
    exhausted: raw?.exhausted ?? false,
    since: raw?.since ?? null,
    cleared: raw?.cleared ?? null,
  };
}

/**
 * Mark credit as exhausted — idempotent. Sets `since` on the first mark,
 * leaves it alone on subsequent marks so the user sees a stable "since"
 * timestamp until they clear it.
 */
export function markCreditExhausted(now: Date = new Date()): void {
  const current = readCreditStatus();
  if (current.exhausted && current.since) return; // already flagged
  writeStateJson(CREDIT_STATUS_FILE, {
    exhausted: true,
    since: current.since ?? now.toISOString(),
    cleared: null,
  } satisfies CreditStatus);
}

/**
 * Clear credit-exhaustion status. Called when the user completes signup or
 * runs `ruflo funnel credit-clear`. `cleared` is stamped so the previous
 * `since` remains inspectable for one recovery cycle.
 */
export function clearCreditStatus(now: Date = new Date()): void {
  const current = readCreditStatus();
  writeStateJson(CREDIT_STATUS_FILE, {
    exhausted: false,
    since: current.since,
    cleared: now.toISOString(),
  } satisfies CreditStatus);
}

/**
 * User-facing single-line summary — plain text, no ANSI. Callers style it
 * themselves. Returns null when credit isn't exhausted (no surface).
 */
export function creditExhaustedNotice(now: Date = new Date()): string | null {
  const status = readCreditStatus();
  if (!status.exhausted) return null;
  const since = status.since ? Date.parse(status.since) : NaN;
  if (Number.isNaN(since)) {
    return 'Cognitum credits exhausted · run: ruflo funnel signup';
  }
  const ageHours = Math.max(0, Math.round((now.getTime() - since) / (60 * 60 * 1000)));
  const when = ageHours < 1 ? 'just now' : ageHours < 24 ? `${ageHours}h ago` : `${Math.round(ageHours / 24)}d ago`;
  return `Cognitum credits exhausted (${when}) · run: ruflo funnel signup`;
}
