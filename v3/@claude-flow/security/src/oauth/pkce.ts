/**
 * OAuth 2.0 + PKCE (RFC 7636) client-side generation (ADR-306).
 *
 * A TypeScript port of meta-proxy's `src/oauth/pkce.rs` (cognitum-one/meta-proxy,
 * itself ported from `dashboard/apps/cli/src/pkce.rs`) so a verifier generated
 * here validates against the same `services/identity` authorization server
 * meta-proxy already talks to successfully — same byte lengths, same encoding,
 * same hash. Intentionally duplicated rather than imported from
 * `@claude-flow/mcp/src/oauth.ts` (a different, unrelated OAuth client in this
 * monorepo) — ADR-306 assigns PKCE ownership to this package specifically.
 *
 * @module v3/security/oauth/pkce
 */

import { randomBytes, createHash } from 'crypto';

export interface PkceRequest {
  state: string;
  codeVerifier: string;
  codeChallenge: string;
}

/**
 * 32 random bytes, base64url-encoded (no padding) — comfortably within RFC
 * 7636's 43-128 character verifier length requirement (32 bytes -> 43 chars).
 * Matches the Rust port's `random_url_safe_token(32)` exactly.
 */
function randomUrlSafeToken(byteLen: number): string {
  return randomBytes(byteLen).toString('base64url');
}

export function challengeFromVerifier(verifier: string): string {
  return createHash('sha256').update(verifier).digest('base64url');
}

/**
 * Generates a fresh `state` + PKCE verifier/challenge pair for one login
 * attempt.
 */
export function generate(): PkceRequest {
  const state = randomUrlSafeToken(32);
  const codeVerifier = randomUrlSafeToken(32);
  const codeChallenge = challengeFromVerifier(codeVerifier);
  return { state, codeVerifier, codeChallenge };
}
