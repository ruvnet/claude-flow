/**
 * Bypass-attempt tests for CASA enforcement (ADR-380 §3 / ADR-240 §4).
 *
 * These specifically probe the load-bearing invariant: enforcement is a
 * pure, deterministic function over the bounded envelope schema, and
 * deny always wins, and the default posture is deny.
 */

import { describe, it, expect } from 'vitest';
import { checkAuthorization } from '../enforce.js';
import type { CasaEnvelope } from '../schema.js';

const baseEnvelope: CasaEnvelope = {
  objective: 'review repository security',
  allow: ['repository.read', 'tests.execute'],
  deny: ['git.push', 'secret.export', 'deployment.create'],
  budget_usd: 8,
  expires_at: '2026-07-30T22:00:00Z',
};

describe('checkAuthorization', () => {
  it('allows an action that is in allow and not in deny', () => {
    const result = checkAuthorization(baseEnvelope, 'repository.read', '2026-07-30T10:00:00Z');
    expect(result).toEqual({ allowed: true, reason: 'allowed' });
  });

  it('denies an action that is in neither allow nor deny (deny-by-default)', () => {
    const result = checkAuthorization(baseEnvelope, 'network.exfiltrate', '2026-07-30T10:00:00Z');
    expect(result.allowed).toBe(false);
    expect(result.reason).toBe('not in allow list (deny-by-default)');
  });

  it('denies an action present in both allow AND deny — deny wins', () => {
    const conflicted: CasaEnvelope = {
      ...baseEnvelope,
      allow: ['repository.read', 'git.push'],
      deny: ['git.push'],
    };
    const result = checkAuthorization(conflicted, 'git.push', '2026-07-30T10:00:00Z');
    expect(result.allowed).toBe(false);
    expect(result.reason).toBe('explicit deny');
  });

  it('denies any request after expiry, even one that is in allow', () => {
    const result = checkAuthorization(baseEnvelope, 'repository.read', '2026-07-30T23:00:00Z');
    expect(result.allowed).toBe(false);
    expect(result.reason).toBe('expired');
  });

  it('denies at and after the boundary; allows strictly before it (spec: now >= expires_at is expired)', () => {
    // now === expires_at IS treated as expired — matches the Rust reference
    // implementation (`envelope.rs::check_authorization`), which denies at
    // `now_secs >= expires_at_secs`. The two enforcement points must agree
    // bit-for-bit on this boundary.
    const exactlyOnBoundary = checkAuthorization(baseEnvelope, 'repository.read', '2026-07-30T22:00:00Z');
    expect(exactlyOnBoundary.allowed).toBe(false);
    expect(exactlyOnBoundary.reason).toBe('expired');

    const oneMsLate = checkAuthorization(baseEnvelope, 'repository.read', '2026-07-30T22:00:00.001Z');
    expect(oneMsLate.allowed).toBe(false);
    expect(oneMsLate.reason).toBe('expired');

    const oneMsEarly = checkAuthorization(baseEnvelope, 'repository.read', '2026-07-30T21:59:59.999Z');
    expect(oneMsEarly.allowed).toBe(true);
  });

  it('bypass attempt: non-array allow/deny on a malformed envelope is denied, not substring-matched', () => {
    // Prior to the schema-revalidation fix, `Array.prototype.includes` /
    // `String.prototype.includes` overload confusion meant a caller
    // handing in `allow: "repository.read"` (a string, not string[]) would
    // authorize the substring-matching scope "repository" via
    // `"repository.read".includes("repository")` — a real deny-by-default
    // bypass. checkAuthorization must defend its own precondition instead
    // of trusting the (compile-time-only) TypeScript type.
    const malformed = {
      ...baseEnvelope,
      allow: 'repository.read',
    } as unknown as CasaEnvelope;
    const result = checkAuthorization(malformed, 'repository', '2026-07-30T10:00:00Z');
    expect(result.allowed).toBe(false);
    expect(result.reason).toBe('invalid envelope (failed schema validation)');

    const malformedDeny = {
      ...baseEnvelope,
      deny: 'git.push,secret.export,deployment.create',
    } as unknown as CasaEnvelope;
    const denyResult = checkAuthorization(malformedDeny, 'repository.read', '2026-07-30T10:00:00Z');
    expect(denyResult.allowed).toBe(false);
    expect(denyResult.reason).toBe('invalid envelope (failed schema validation)');
  });

  it('bypass attempt: an unparseable `now` fails closed (expired), not silently skips the expiry gate', () => {
    // Previously, `Date.parse('not-a-real-timestamp')` is NaN, which
    // short-circuited the old `!Number.isNaN(now) && ...` guard to false —
    // silently disabling the expiry check entirely and falling through to
    // the deny/allow checks as if the envelope had no expiry at all.
    const result = checkAuthorization(baseEnvelope, 'repository.read', 'not-a-real-timestamp');
    expect(result.allowed).toBe(false);
    expect(result.reason).toBe('expired');
  });

  it('bypass attempt: an offset-less `now` is rejected rather than interpreted in the host timezone', () => {
    // `Date.parse('2026-07-30T22:00:00')` (no trailing Z/offset) is parsed
    // in the *local system timezone*, not UTC — two machines with
    // different TZ settings would silently disagree on whether this is
    // before or after expires_at. Reject it outright, matching the Rust
    // reference parser's explicit "no explicit timezone — reject rather
    // than guess" behavior.
    const result = checkAuthorization(baseEnvelope, 'repository.read', '2026-07-30T10:00:00');
    expect(result.allowed).toBe(false);
    expect(result.reason).toBe('expired');
  });

  it('denies everything when allow is an empty list', () => {
    const lockedDown: CasaEnvelope = {
      ...baseEnvelope,
      allow: [],
    };
    for (const action of ['repository.read', 'tests.execute', 'anything.at.all']) {
      const result = checkAuthorization(lockedDown, action, '2026-07-30T10:00:00Z');
      expect(result.allowed).toBe(false);
      expect(result.reason).toBe('not in allow list (deny-by-default)');
    }
  });

  it('denies an action in deny even when allow is empty (deny checked before allow)', () => {
    const lockedDownWithDeny: CasaEnvelope = {
      ...baseEnvelope,
      allow: [],
      deny: ['git.push'],
    };
    const result = checkAuthorization(lockedDownWithDeny, 'git.push', '2026-07-30T10:00:00Z');
    expect(result.allowed).toBe(false);
    expect(result.reason).toBe('explicit deny');
  });

  it('the one genuinely-allowed case: tests.execute under the ADR-380 example envelope', () => {
    const result = checkAuthorization(baseEnvelope, 'tests.execute', '2026-07-30T21:59:59Z');
    expect(result).toEqual({ allowed: true, reason: 'allowed' });
  });

  it('is a pure function: identical inputs always produce identical output', () => {
    const a = checkAuthorization(baseEnvelope, 'repository.read', '2026-07-30T10:00:00Z');
    const b = checkAuthorization(baseEnvelope, 'repository.read', '2026-07-30T10:00:00Z');
    expect(a).toEqual(b);
  });

  it('does not mutate the envelope it is given', () => {
    const snapshot = JSON.parse(JSON.stringify(baseEnvelope));
    checkAuthorization(baseEnvelope, 'git.push', '2026-07-30T10:00:00Z');
    expect(baseEnvelope).toEqual(snapshot);
  });
});
