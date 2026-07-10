/**
 * Existing-install disclosure gate — ADR-301.
 *
 * Invariants (release-blocking, tested):
 *   - No promotional content before disclosure.
 *   - The disable instruction appears in the first disclosure itself.
 *   - Shown once per user (user-level receipt), not once per project.
 *   - Declining disables all funnel surfaces (enforced in precedence.ts).
 *
 * The disclosure text stays on the promo row for a grace window after its
 * first render so a single flash can't count as "the user was told"; only
 * after the window do promotional messages become eligible.
 */

import type { DisclosureRecord, FunnelDisclosureState } from './types.js';
import { readStateJson, writeStateJson } from './state.js';

const DISCLOSURE_FILE = 'funnel-disclosure.json';

/** How long the disclosure text keeps the row before promo becomes eligible. */
export const DISCLOSURE_GRACE_MS = 72 * 60 * 60 * 1000; // 72h

// Must fit the 80-column message bound WITH the disable instruction intact —
// a truncated disclosure that loses the opt-out is an ADR-301 invariant
// violation (tested in funnel.test.ts).
export const DISCLOSURE_TEXT =
  'Ruflo now shows tips & Cognitum notices here — disable: ruflo funnel disable';

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
