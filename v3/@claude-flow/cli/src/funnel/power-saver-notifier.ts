/**
 * Power-saver notifier — ADR-314 §A out-of-band signal path.
 *
 * Structural mirror of rate-limit-notifier.ts, same self-reported/manual
 * constraint (ADR-312's detection gap applies unchanged — ruflo cannot read
 * "your account is at 20%" any more than it can read "you are rate
 * limited"). Deliberately a SEPARATE flag from rate-limited: "running low,
 * want to proactively conserve" (still have capacity) and "blocked" (zero
 * capacity left) are different urgencies — conflating them would mean
 * power-saver mode never fires until you're already blocked (too late to
 * have conserved anything).
 *
 * State is cheap and durable:
 *   ~/.ruflo/quota-status.json = { low: bool, since: ISO, cleared: ISO|null, lastToggleAt: ISO|null }
 *
 * Same 6h TTL rationale as rate-limit-notifier.ts, and the same ADR-314 §D1
 * toggle cooldown (10 min) — a self-reported flag with zero server-side
 * verification needs at least this much client-side friction against
 * casual always-on gaming.
 */

import { readStateJson, writeStateJson } from './state.js';
import { cooldownActive } from './toggle-cooldown.js';

export const QUOTA_STATUS_FILE = 'quota-status.json';

/** Auto-expire a forgotten manual flag after 6h (see module doc). */
export const QUOTA_LOW_TTL_MS = 6 * 60 * 60 * 1000;

export interface QuotaLowStatus {
  low: boolean;
  since: string | null;
  cleared: string | null;
  lastToggleAt: string | null;
}

/** Read the current power-saver status. Never throws. Applies the TTL. */
export function readQuotaLowStatus(now: Date = new Date()): QuotaLowStatus {
  const raw = readStateJson<QuotaLowStatus>(QUOTA_STATUS_FILE);
  const status: QuotaLowStatus = {
    low: raw?.low ?? false,
    since: raw?.since ?? null,
    cleared: raw?.cleared ?? null,
    lastToggleAt: raw?.lastToggleAt ?? null,
  };
  if (status.low && status.since) {
    const since = Date.parse(status.since);
    if (!Number.isNaN(since) && now.getTime() - since >= QUOTA_LOW_TTL_MS) {
      return { low: false, since: status.since, cleared: now.toISOString(), lastToggleAt: status.lastToggleAt };
    }
  }
  return status;
}

/**
 * Mark quota as running low — idempotent, cooldown-gated (ADR-314 §D1).
 * Returns false when the cooldown blocks the flip (not yet applied).
 */
export function markQuotaLow(now: Date = new Date()): boolean {
  const current = readQuotaLowStatus(now);
  if (current.low && current.since) return true; // already flagged, not a change
  if (cooldownActive(current.lastToggleAt, now)) return false;
  writeStateJson(QUOTA_STATUS_FILE, {
    low: true,
    since: current.since ?? now.toISOString(),
    cleared: null,
    lastToggleAt: now.toISOString(),
  } satisfies QuotaLowStatus);
  return true;
}

/** Clear power-saver status. Cooldown-gated the same way as the mark direction. */
export function clearQuotaLowStatus(now: Date = new Date()): boolean {
  const current = readQuotaLowStatus(now);
  if (!current.low) return true; // already clear, not a change
  if (cooldownActive(current.lastToggleAt, now)) return false;
  writeStateJson(QUOTA_STATUS_FILE, {
    low: false,
    since: current.since,
    cleared: now.toISOString(),
    lastToggleAt: now.toISOString(),
  } satisfies QuotaLowStatus);
  return true;
}

/**
 * User-facing single-line summary — plain text, no ANSI. Returns null when
 * not flagged low (no surface).
 */
export function quotaLowNotice(now: Date = new Date()): string | null {
  const status = readQuotaLowStatus(now);
  if (!status.low) return null;
  const since = status.since ? Date.parse(status.since) : NaN;
  if (Number.isNaN(since)) {
    return 'Power saver mode active · manage: ruflo proxy power-saver-disable';
  }
  const ageMin = Math.max(0, Math.round((now.getTime() - since) / (60 * 1000)));
  const when = ageMin < 1 ? 'just now' : ageMin < 60 ? `${ageMin}m ago` : `${Math.round(ageMin / 60)}h ago`;
  return `Power saver mode active (${when}) · manage: ruflo proxy power-saver-disable`;
}
