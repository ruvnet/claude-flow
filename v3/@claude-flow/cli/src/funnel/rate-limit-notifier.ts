/**
 * Rate-limit notifier — ADR-312 Phase 0 out-of-band signal path.
 *
 * Structural mirror of credit-notifier.ts. This is NOT automatic detection
 * — ADR-312 established that Claude Code does not currently expose any way
 * to detect its own usage-limit state from outside its process (verified
 * against the actual installed CLI source, not assumed). This module is the
 * MANUAL, self-reported alternative: the user tells ruflo they've hit a
 * limit, ruflo remembers it, and the funnel promo row can react.
 *
 * State is cheap and durable:
 *   ~/.ruflo/rate-limit-status.json = { limited: bool, since: ISO, cleared: ISO|null }
 *
 * A TTL (default 6h) auto-expires a forgotten flag so a stale manual mark
 * doesn't linger indefinitely if the user forgets to clear it — Claude
 * usage limits reset on hours-to-days cadences (five_hour / seven_day per
 * ADR-312's grounded research), so 6h is a reasonable "the user probably
 * forgot to clear this" bound without requiring per-type precision we
 * don't have.
 */

import { readStateJson, writeStateJson } from './state.js';
import { cooldownActive } from './toggle-cooldown.js';

export const RATE_LIMIT_STATUS_FILE = 'rate-limit-status.json';

/** Auto-expire a forgotten manual flag after 6h (see module doc). */
export const RATE_LIMIT_TTL_MS = 6 * 60 * 60 * 1000;

export interface RateLimitStatus {
  limited: boolean;
  since: string | null;
  cleared: string | null;
  /** ADR-314 §D1 — last time `limited` actually changed value; gates the toggle cooldown. */
  lastToggleAt: string | null;
}

/** Read the current rate-limit status. Never throws. Applies the TTL. */
export function readRateLimitStatus(now: Date = new Date()): RateLimitStatus {
  const raw = readStateJson<RateLimitStatus>(RATE_LIMIT_STATUS_FILE);
  const status: RateLimitStatus = {
    limited: raw?.limited ?? false,
    since: raw?.since ?? null,
    cleared: raw?.cleared ?? null,
    lastToggleAt: raw?.lastToggleAt ?? null,
  };
  if (status.limited && status.since) {
    const since = Date.parse(status.since);
    if (!Number.isNaN(since) && now.getTime() - since >= RATE_LIMIT_TTL_MS) {
      return { limited: false, since: status.since, cleared: now.toISOString(), lastToggleAt: status.lastToggleAt };
    }
  }
  return status;
}

/**
 * Mark as rate-limited — idempotent. Sets `since` on the first mark, leaves
 * it alone on subsequent marks so the user sees a stable "since" timestamp
 * until they clear it or the TTL expires. Refuses to flip false→true inside
 * the ADR-314 §D1 cooldown window (returns false; a no-op re-mark of an
 * already-true flag is unaffected — that's not a state change).
 */
export function markRateLimited(now: Date = new Date()): boolean {
  const current = readRateLimitStatus(now);
  if (current.limited && current.since) return true; // already flagged, not a change
  if (cooldownActive(current.lastToggleAt, now)) return false;
  writeStateJson(RATE_LIMIT_STATUS_FILE, {
    limited: true,
    since: current.since ?? now.toISOString(),
    cleared: null,
    lastToggleAt: now.toISOString(),
  } satisfies RateLimitStatus);
  return true;
}

/**
 * Clear rate-limited status. Called via `ruflo settings notices
 * rate-limited --clear`, automatically by the TTL, or once a real Phase 1/2
 * signal (ADR-312) confirms the limit has reset. Refuses to flip true→false
 * inside the cooldown window (returns false); clearing an already-clear
 * flag is always allowed (not a state change, and TTL auto-clear must never
 * be blocked by a cooldown it didn't itself trigger).
 */
export function clearRateLimitStatus(now: Date = new Date()): boolean {
  const current = readRateLimitStatus(now);
  if (!current.limited) return true; // already clear, not a change
  if (cooldownActive(current.lastToggleAt, now)) return false;
  writeStateJson(RATE_LIMIT_STATUS_FILE, {
    limited: false,
    since: current.since,
    cleared: now.toISOString(),
    lastToggleAt: now.toISOString(),
  } satisfies RateLimitStatus);
  return true;
}

/**
 * User-facing single-line summary — plain text, no ANSI. Callers style it
 * themselves. Returns null when not rate-limited (no surface).
 */
export function rateLimitNotice(now: Date = new Date()): string | null {
  const status = readRateLimitStatus(now);
  if (!status.limited) return null;
  const since = status.since ? Date.parse(status.since) : NaN;
  if (Number.isNaN(since)) {
    return 'Claude usage limit flagged · run: ruflo proxy sponsor-enable';
  }
  const ageMin = Math.max(0, Math.round((now.getTime() - since) / (60 * 1000)));
  const when = ageMin < 1 ? 'just now' : ageMin < 60 ? `${ageMin}m ago` : `${Math.round(ageMin / 60)}h ago`;
  return `Claude usage limit flagged (${when}) · run: ruflo proxy sponsor-enable`;
}
