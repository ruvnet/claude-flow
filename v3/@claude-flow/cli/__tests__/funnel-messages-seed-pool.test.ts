/**
 * Regression guard for the cold-start promo seed pool restored on
 * 2026-07-26 (statusline promo row was blank on new installs because
 * ADR-311 had emptied the local pool and the remote fetch hadn't
 * landed yet).
 *
 * The seed pool must:
 *   - Contain at least one 'disclosure' message so the disclosure gate
 *     can unlock without waiting for a remote fetch.
 *   - Every disclosure MUST contain the exact " · manage: ruflo settings"
 *     tail — this is an ADR-301 invariant enforced by `isValidMessage`
 *     and a UX contract with users who look for the manage instruction.
 *   - Every seed message must pass `isValidMessage` (schema, host
 *     allowlist, control-char strip, 80-column cap) so a bad seed can't
 *     silently drop and re-empty the pool.
 *   - Every URL must be on the exact-host allowlist (cognitum.one /
 *     github.com/ruvnet/) so no accidental third-party host slips in.
 */

import { describe, it, expect } from 'vitest';
import { MESSAGES, isValidMessage, isAllowedUrl } from '../src/funnel/messages.js';

describe('funnel seed pool — cold-start recovery for statusline promo (2026-07-26)', () => {
  it('is non-empty (guards against a re-empty of MESSAGES that would blank the row again)', () => {
    expect(MESSAGES.length).toBeGreaterThan(0);
  });

  it('includes at least one disclosure so the disclosure gate can unlock on cold start', () => {
    const disclosures = MESSAGES.filter((m) => m.class === 'disclosure');
    expect(disclosures.length).toBeGreaterThan(0);
  });

  it('every disclosure carries the exact " · manage: ruflo settings" tail (ADR-301)', () => {
    const disclosures = MESSAGES.filter((m) => m.class === 'disclosure');
    for (const msg of disclosures) {
      expect(msg.text).toContain(' · manage: ruflo settings');
    }
  });

  it('every seed message passes isValidMessage() so none silently drop', () => {
    for (const msg of MESSAGES) {
      expect(isValidMessage(msg)).toBe(true);
    }
  });

  it('every seed URL is on the exact-host allowlist (no third-party leaks)', () => {
    for (const msg of MESSAGES) {
      if (msg.url) {
        expect(isAllowedUrl(msg.url)).toBe(true);
      }
    }
  });

  it('provides at least one educational tip so the rotation has something to show most slots', () => {
    // 4-in-5 rotation slots are educational per ADR-301; without at least one
    // educational message the promo row would be blank most of the time even
    // after the disclosure gate unlocks.
    const educational = MESSAGES.filter((m) => m.class === 'educational');
    expect(educational.length).toBeGreaterThan(0);
  });

  it('all message ids are unique (rotation dedup keys on id)', () => {
    const ids = MESSAGES.map((m) => m.id);
    const unique = new Set(ids);
    expect(unique.size).toBe(ids.length);
  });
});
