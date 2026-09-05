/**
 * `ruflo auth login` flow orchestration (ADR-306) — composes
 * `@claude-flow/security`'s ported OAuth primitives (loopback PKCE, OOB
 * manual-paste, refresh) the same way meta-proxy's `oauth/login.rs`
 * orchestrates its own Rust primitives. See security-bridge.ts for why the
 * package is loaded lazily, and oauth/client.ts (in @claude-flow/security)
 * for why this targets the live `auth.cognitum.one` surface rather than
 * ADR-308's unconfirmed `/v1/auth/*` spec.
 *
 * @module auth/client
 */

import * as readline from 'node:readline/promises';
import { existsSync } from 'node:fs';
import { loadSecurityOAuth, type OAuthTokenResponse } from './security-bridge.js';
import { KEYCHAIN_SERVICE } from './constants.js';
import { getProfile, setProfile } from './state.js';
import { getSessionToken, setSessionToken } from './session.js';
import { hasConsent } from '../funnel/index.js';
import { domainForScope } from './scopes.js';

/** Refresh before there is less than one minute left on the access token. */
export const ACCESS_TOKEN_REFRESH_WINDOW_MS = 60_000;

export interface LoginResult {
  tokens: OAuthTokenResponse;
  method: 'pkce' | 'device' | 'token-stdin';
}

/**
 * Best-effort headlessness signal — a false negative just means the browser
 * flow is attempted and a real browser opens fine anyway; a false positive
 * means the user falls back to the manual OOB flow, which always works
 * regardless. Mirrors meta-proxy's `login.rs::is_probably_headless()`.
 */
export function isProbablyHeadless(): boolean {
  return Boolean(
    process.env.SSH_CONNECTION || process.env.SSH_TTY || process.env.CONTAINER || existsDockerEnv(),
  );
}

function existsDockerEnv(): boolean {
  try {
    return existsSync('/.dockerenv');
  } catch {
    return false;
  }
}

/**
 * Validates the OAuth callback params against the request that started the
 * flow — the CSRF-critical step, extracted so it's independently testable.
 * Order matters: an explicit `error` (user denied) and a missing code are
 * reported as their own reasons; a missing or mismatched `state` is always
 * a state-mismatch, even when a code is present.
 */
export function validateCallback(
  error: string | null,
  code: string | null,
  returnedState: string | null,
  expectedState: string,
): { ok: true; code: string } | { ok: false; reason: 'denied' | 'state-mismatch'; detail?: string } {
  if (error) return { ok: false, reason: 'denied', detail: error };
  if (!code) return { ok: false, reason: 'denied', detail: 'no authorization code received' };
  if (!returnedState || returnedState !== expectedState) return { ok: false, reason: 'state-mismatch' };
  return { ok: true, code };
}

export class LoginCancelledError extends Error {
  constructor() {
    super('login cancelled: no code was entered');
    this.name = 'LoginCancelledError';
  }
}

export class LoginDeniedError extends Error {
  constructor(detail: string) {
    super(`authorization was denied or failed: ${detail}`);
    this.name = 'LoginDeniedError';
  }
}

export class StateMismatchError extends Error {
  constructor() {
    super('state mismatch — the OAuth callback did not match the request this CLI sent');
    this.name = 'StateMismatchError';
  }
}

export class NotLoggedInError extends Error {
  constructor(profile: string) {
    super(`not logged in for profile "${profile}" — run: ruflo auth login --profile ${profile}`);
    this.name = 'NotLoggedInError';
  }
}

export class SessionOnlyExpiredError extends Error {
  constructor(profile: string) {
    super(
      `profile "${profile}" has no persisted refresh token and its in-memory access token is ` +
        `absent or expiring — run: ruflo auth login --profile ${profile}`,
    );
    this.name = 'SessionOnlyExpiredError';
  }
}

export class ScopeConsentMismatchError extends Error {
  constructor(profile: string, scopes: string[]) {
    super(
      `profile "${profile}" has scope(s) without matching local consent: ${scopes.join(', ')} — ` +
        'authenticated capability denied',
    );
    this.name = 'ScopeConsentMismatchError';
  }
}

/** Browser-based loopback PKCE login — the ADR-306 default for an interactive desktop. */
export async function browserLogin(print: (line: string) => void): Promise<LoginResult> {
  const sec = await loadSecurityOAuth();
  const server = await sec.CallbackServer.bind();
  const pkce = sec.generatePkce();
  const url = sec.authorizeUrl(server.redirectUri, pkce.state, pkce.codeChallenge);

  print('Opening your browser to sign in to Cognitum...');
  print(`If it doesn't open automatically, visit:\n\n  ${url}\n`);
  await sec.openBrowser(url).catch(() => {}); // best-effort — the URL above is always the fallback
  print('Waiting for you to finish signing in...');

  const result = await server.awaitCallback();
  const validated = validateCallback(result.error, result.code, result.state, pkce.state);
  if (!validated.ok) {
    if (validated.reason === 'state-mismatch') throw new StateMismatchError();
    throw new LoginDeniedError(validated.detail ?? 'unknown');
  }

  const tokens = await sec.exchangeCode(validated.code, pkce.codeVerifier, server.redirectUri);
  return { tokens, method: 'pkce' };
}

/** Headless fallback: prints the authorize URL with the OOB redirect, prompts for the pasted code. */
export async function manualLogin(
  print: (line: string) => void,
  input: NodeJS.ReadableStream = process.stdin,
): Promise<LoginResult> {
  const sec = await loadSecurityOAuth();
  print('Browser-based callback unavailable (SSH/container detected, or --no-browser).\n');

  const pkce = sec.generatePkce();
  const url = sec.authorizeUrl(sec.OOB_REDIRECT_URI, pkce.state, pkce.codeChallenge);
  print(`Open this URL in a browser and authorize:\n\n  ${url}\n`);

  // `rl.question()` resolves on a newline-terminated 'line' event — if `input`
  // ends without ever emitting one (e.g. stdin closed early, or piped input
  // with no trailing newline), it hangs forever rather than treating EOF as
  // a cancellation. Race it against the interface's own 'close' event so an
  // early EOF resolves to "" (-> LoginCancelledError below) instead of hanging.
  const rl = readline.createInterface({ input, terminal: false });
  let code: string;
  try {
    const closed = new Promise<string>((resolve) => rl.once('close', () => resolve('')));
    code = (await Promise.race([rl.question('Paste the code shown after authorizing: '), closed])).trim();
  } finally {
    rl.close();
  }
  if (!code) throw new LoginCancelledError();

  const tokens = await sec.exchangeManualCode(code, pkce.codeVerifier);
  return { tokens, method: 'device' };
}

/**
 * `--token-stdin`: reads one JSON object from stdin,
 * `{access_token, refresh_token?, expires_in, scope}`. Wire format is not
 * specified by ADR-306 — defined here as typed JSON rather than a bare
 * token string, so scope/expiry are explicit rather than inferred.
 */
export async function tokenStdinLogin(input: NodeJS.ReadableStream = process.stdin): Promise<LoginResult> {
  const chunks: Buffer[] = [];
  for await (const chunk of input) chunks.push(chunk as Buffer);
  const raw = Buffer.concat(chunks).toString('utf-8').trim();
  if (!raw) throw new Error('--token-stdin: no input received on stdin');

  let parsed: { access_token?: string; refresh_token?: string; expires_in?: number; scope?: string };
  try {
    parsed = JSON.parse(raw);
  } catch {
    throw new Error(
      '--token-stdin expects a single JSON object: {"access_token","refresh_token"?,"expires_in","scope"}',
    );
  }
  if (!parsed.access_token) throw new Error('--token-stdin: JSON is missing required field "access_token"');

  const tokens: OAuthTokenResponse = {
    access_token: parsed.access_token,
    token_type: 'Bearer',
    refresh_token: parsed.refresh_token,
    expires_in: parsed.expires_in,
  };
  return { tokens, method: 'token-stdin' };
}

/**
 * Refreshes an access token. Classifies failure into network-unreachable
 * vs. a reachable-but-erroring server so callers can print an honest
 * message instead of collapsing both into "offline" (ADR-308 failure
 * policy: local ruflo functionality is never affected by auth being
 * unavailable, but the diagnostic should say WHY it's unavailable).
 */
export async function refreshAccessToken(refreshTokenValue: string): Promise<OAuthTokenResponse> {
  const sec = await loadSecurityOAuth();
  try {
    return await sec.refreshToken(refreshTokenValue);
  } catch (e) {
    if (e instanceof sec.OAuthError) {
      if (e.code === 'network') {
        throw new Error(
          'Could not reach the Cognitum auth service. ruflo core functionality is unaffected — ' +
            'sign-in is not required for local use.',
        );
      }
      throw new Error(`Cognitum auth service returned an unexpected response: ${e.message}`);
    }
    throw e;
  }
}

/**
 * Returns an access token suitable for an authenticated call.
 *
 * Fast path: a process-memory token with more than one minute remaining.
 * Slow path: load the profile's refresh token from the OS keychain, perform
 * one refresh, persist a rotated refresh token BEFORE exposing the new access
 * token, then update metadata and the process cache. Refresh is deliberately
 * demand-driven: offline-safe commands such as plain `auth status` never call
 * this function and therefore never create background traffic or retry loops.
 */
export async function getValidAccessToken(profileName = 'default'): Promise<string> {
  const profile = getProfile(profileName);
  if (!profile) throw new NotLoggedInError(profileName);

  const scopesWithoutConsent = profile.scopes.filter((scope) => {
    const domain = domainForScope(scope);
    return domain !== undefined && !hasConsent(domain);
  });
  if (scopesWithoutConsent.length > 0) {
    throw new ScopeConsentMismatchError(profileName, scopesWithoutConsent);
  }

  const cached = getSessionToken(profileName, ACCESS_TOKEN_REFRESH_WINDOW_MS);
  if (cached) return cached;
  if (!profile.keychainRef) throw new SessionOnlyExpiredError(profileName);

  const sec = await loadSecurityOAuth();
  const keychain = await sec.createKeychainAdapter();
  const refreshTokenValue = await keychain.getSecret(KEYCHAIN_SERVICE, profile.keychainRef);
  if (!refreshTokenValue) throw new SessionOnlyExpiredError(profileName);

  const refreshed = await refreshAccessToken(refreshTokenValue);
  if (!refreshed.access_token) throw new Error('Cognitum refresh response did not contain an access token');

  // Cognitum rotates refresh tokens with reuse detection. Commit the rotated
  // credential first; if this write fails, do not publish/cache the access
  // token and do not retry the already-spent old refresh token here.
  if (refreshed.refresh_token) {
    await keychain.setSecret(KEYCHAIN_SERVICE, profile.keychainRef, refreshed.refresh_token);
  }

  const expiresAtMs = Date.now() + Math.max(0, refreshed.expires_in ?? 0) * 1000;
  setSessionToken(profileName, refreshed.access_token, expiresAtMs);
  setProfile(profileName, {
    ...profile,
    accountId: refreshed.account_email ?? profile.accountId,
    accessTokenExpiresAt: new Date(expiresAtMs).toISOString(),
    linkedAt: new Date().toISOString(),
  });
  return refreshed.access_token;
}
