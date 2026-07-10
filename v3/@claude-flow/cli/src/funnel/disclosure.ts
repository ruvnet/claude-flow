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

// Sponsor URL wrapped in an OSC 8 escape at render time (allowlist in the
// statusline renderer). Ships in code — no message payload can smuggle it.
// The bare base URL; UTM attribution + the pseudonymous funnel ID are appended
// by attributionUrl() below when consent permits.
export const DISCLOSURE_SPONSOR_URL = 'https://cognitum.one/ruflo';

// Rotating disclosure copy. Every variant MUST:
//   - fit the 80-column message bound,
//   - carry the "manage: ruflo settings" tail verbatim,
//   - name Cognitum so the OSC 8 hyperlink target reads as attribution.
// A truncated disclosure that loses the manage instruction is an ADR-301
// invariant violation (tested in funnel.test.ts over every entry here).
// Copy discipline (why these read the way they read):
//   - explain WHY the row exists (mechanism), not that Cognitum sponsors the
//     software — an open-source CLI that reads as "advertising" loses trust
//     faster than it gains conversions,
//   - describe Cognitum as a source of *additional capabilities*, framing it
//     as product discovery rather than paid placement,
//   - never leak internal terminology ("funnel") to end users; the tail
//     points at `ruflo settings`, a user-facing preference command,
//   - fit the 80-column bound with any prefix glyph counted.
export const DISCLOSURE_TEXTS: readonly string[] = [
  '✨ Tips, features and Cognitum updates here · manage: ruflo settings',
  '✨ Additional AI capabilities from Cognitum · manage: ruflo settings',
  '✨ Tips and Cognitum updates appear here · manage: ruflo settings',
];

// First entry is the canonical form — kept as DISCLOSURE_TEXT for
// backwards compatibility with anything that imports the constant directly.
export const DISCLOSURE_TEXT: string = DISCLOSURE_TEXTS[0];

// One disclosure variant per 5-minute wall-clock slot. Longer than the
// 20-second rotation cadence so a user watching the statusline sees the
// same variant long enough to read it, but short enough that a fresh
// session gets a different one than the previous one did.
export const DISCLOSURE_ROTATION_SLOT_MS = 5 * 60 * 1000;

/**
 * Deterministic slot-based selection over DISCLOSURE_TEXTS — no RNG so the
 * choice is reproducible for a given wall-clock instant (statusline caches
 * results, and any nondeterminism would skew the rotation).
 */
export function selectDisclosureText(now: Date = new Date()): string {
  const slot = Math.floor(now.getTime() / DISCLOSURE_ROTATION_SLOT_MS);
  return DISCLOSURE_TEXTS[slot % DISCLOSURE_TEXTS.length];
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
