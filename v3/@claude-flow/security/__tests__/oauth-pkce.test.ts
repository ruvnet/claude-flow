/**
 * PKCE (RFC 7636) generation tests — the port's correctness check against
 * the same values meta-proxy's Rust `pkce.rs` test suite verifies.
 */

import { describe, it, expect } from 'vitest';
import { generate, challengeFromVerifier } from '../src/oauth/pkce.js';

describe('oauth/pkce', () => {
  it('generates a verifier within RFC 7636 length bounds (43-128 chars)', () => {
    const req = generate();
    expect(req.codeVerifier.length).toBeGreaterThanOrEqual(43);
    expect(req.codeVerifier.length).toBeLessThanOrEqual(128);
  });

  it('produces a deterministic challenge for a given verifier', () => {
    const req = generate();
    expect(challengeFromVerifier(req.codeVerifier)).toBe(req.codeChallenge);
  });

  it('never collides across two generations', () => {
    const a = generate();
    const b = generate();
    expect(a.state).not.toBe(b.state);
    expect(a.codeVerifier).not.toBe(b.codeVerifier);
    expect(a.codeChallenge).not.toBe(b.codeChallenge);
  });

  it('matches the RFC 7636 Appendix B worked example', () => {
    // The exact vector meta-proxy's pkce.rs test suite uses — confirms this
    // port's encoding (base64url, no padding) and hash (SHA-256) match byte
    // for byte, since a verifier generated here must validate against the
    // same identity server meta-proxy already talks to successfully.
    const verifier = 'dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk';
    expect(challengeFromVerifier(verifier)).toBe('E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM');
  });
});
