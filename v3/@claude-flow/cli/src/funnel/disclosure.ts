/**
 * Existing-install disclosure gate — ADR-301, amended by ADR-311 to source
 * the disclosure MESSAGE itself from the remote feed rather than hardcoding
 * it in the CLI. Everything about WHETHER/WHEN to show a disclosure stays
 * local (state machine below); everything about WHAT it says comes from
 * the same remote pool as tips/promos, validated through the identical
 * ADR-301 content pipeline (isValidMessage in messages.ts).
 *
 * Invariants (release-blocking, tested):
 *   - No promotional content before disclosure.
 *   - The manage instruction appears in the disclosure text itself.
 *   - Shown once per user (user-level receipt), not once per project.
 *   - Declining disables all funnel surfaces (enforced in precedence.ts).
 *   - Fail-closed: if the remote feed has never successfully populated a
 *     disclosure-class message, there is nothing to show — no local
 *     fallback text exists (ADR-311 "zero local promo content").
 *
 * The disclosure text stays on the promo row for a grace window after its
 * first render so a single flash can't count as "the user was told"; only
 * after the window do promotional messages become eligible.
 */

import type { DisclosureRecord, FunnelDisclosureState, FunnelMessage } from './types.js';
import { readStateJson, writeStateJson } from './state.js';
import { getRemoteMessages } from './message-transport.js';

const DISCLOSURE_FILE = 'funnel-disclosure.json';

/** How long the disclosure text keeps the row before promo becomes eligible. */
export const DISCLOSURE_GRACE_MS = 24 * 60 * 60 * 1000; // 24h

// One disclosure variant per 5-minute wall-clock slot. Longer than the
// 20-second rotation cadence so a user watching the statusline sees the
// same variant long enough to read it, but short enough that a fresh
// session gets a different one than the previous one did.
export const DISCLOSURE_ROTATION_SLOT_MS = 5 * 60 * 1000;

/** Remote-cached messages tagged class==='disclosure' — the only source. */
function getDisclosureMessagePool(): FunnelMessage[] {
  return getRemoteMessages().filter((m) => m.class === 'disclosure');
}

/**
 * Deterministic slot-based selection over the remote disclosure pool — no
 * RNG so the choice is reproducible for a given wall-clock instant. Returns
 * null when the pool is empty (cold start before first fetch, or the remote
 * feed is unreachable) — the caller must treat null as "show nothing".
 */
export function selectDisclosureMessage(now: Date = new Date()): FunnelMessage | null {
  const pool = getDisclosureMessagePool();
  if (pool.length === 0) return null;
  const slot = Math.floor(now.getTime() / DISCLOSURE_ROTATION_SLOT_MS);
  return pool[slot % pool.length];
}

export function getDisclosure(): DisclosureRecord {
  const rec = readStateJson<DisclosureRecord>(DISCLOSURE_FILE);
  if (rec && isValidState(rec.state)) return rec;
  return { state: 'never_seen', firstShownAt: null };
}

function isValidState(s: unknown): s is FunnelDisclosureState {
  return s === 'never_seen' || s === 'disclosed_enabled' || s === 'disclosed_disabled';
}

/** Record that the disclosure text was rendered (idempotent). */
export function recordDisclosureShown(now: Date = new Date()): DisclosureRecord {
  const current = getDisclosure();
  if (current.state !== 'never_seen') return current;
  const rec: DisclosureRecord = { state: 'disclosed_enabled', firstShownAt: now.toISOString() };
  writeStateJson(DISCLOSURE_FILE, rec);
  return rec;
}

/** User explicitly declined (e.g. `ruflo funnel disable`). */
export function recordDisclosureDeclined(now: Date = new Date()): DisclosureRecord {
  const current = getDisclosure();
  const rec: DisclosureRecord = {
    state: 'disclosed_disabled',
    firstShownAt: current.firstShownAt ?? now.toISOString(),
  };
  writeStateJson(DISCLOSURE_FILE, rec);
  return rec;
}

/** Re-enable after a prior decline (explicit user action only). */
export function recordDisclosureReenabled(now: Date = new Date()): DisclosureRecord {
  const rec: DisclosureRecord = { state: 'disclosed_enabled', firstShownAt: now.toISOString() };
  writeStateJson(DISCLOSURE_FILE, rec);
  return rec;
}

/**
 * Whether promotional/educational messages may render. True only after the
 * disclosure was shown AND its grace window has elapsed. While the window is
 * open the row must carry the disclosure text itself.
 */
export function promoEligible(now: Date = new Date()): boolean {
  const rec = getDisclosure();
  if (rec.state !== 'disclosed_enabled' || !rec.firstShownAt) return false;
  const first = Date.parse(rec.firstShownAt);
  if (Number.isNaN(first)) return false;
  return now.getTime() - first >= DISCLOSURE_GRACE_MS;
}
