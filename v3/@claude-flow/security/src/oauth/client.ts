/**
 * HTTP client for `auth.cognitum.one`'s OAuth surface (ADR-306): authorize
 * URL construction, `POST /oauth/token` (`authorization_code` and
 * `refresh_token` grants), and `POST /v1/oauth/code-exchange` (OOB fallback).
 *
 * A TypeScript port of meta-proxy's `src/oauth/client.rs`
 * (cognitum-one/meta-proxy) — same base URL, same endpoints, same
 * form/query parameter names, confirmed live 2026-07-16 (a real
 * `GET /oauth/authorize?...&client_id=meta-proxy&redirect_uri=<ruflo-controlled
 * loopback>` returns a working consent page, not a redirect_uri-mismatch
 * error — so this client reuses meta-proxy's registered `client_id` rather
 * than requiring a new one).
 *
 * Deliberately NOT `api.cognitum.one/v1/auth/*` — that's what ruflo's own
 * checked-in OpenAPI spec (v3/docs/api/cognitum-v1.openapi.yaml, ADR-308)
 * describes, but it does not match what the real identity server serves.
 * This client targets the proven, live surface instead.
 *
 * @module v3/security/oauth/client
 */

export const CLIENT_ID = 'meta-proxy';
export const SCOPE = 'inference';
/** RFC 8252 out-of-band sentinel — the OOB/manual-paste flow's `redirect_uri`. */
export const OOB_REDIRECT_URI = 'urn:ietf:wg:oauth:2.0:oob';

function authBaseUrl(): string {
  const override = process.env.COGNITUM_AUTH_URL;
  return override && override.trim() ? override : 'https://auth.cognitum.one';
}

export interface TokenResponse {
  access_token: string;
  token_type: string;
  account_email?: string;
  refresh_token?: string;
  expires_in?: number;
}

interface OAuthErrorBody {
  error: string;
  error_description: string;
}

export class OAuthError extends Error {
  constructor(
    message: string,
    public readonly code: 'network' | 'protocol' | 'unexpected_shape',
    public readonly oauthError?: string,
    public readonly oauthDescription?: string,
  ) {
    super(message);
    this.name = 'OAuthError';
  }
}

/** Builds the `/oauth/authorize` URL for the standard loopback-redirect flow. */
export function authorizeUrl(redirectUri: string, state: string, codeChallenge: string): string {
  const url = new URL(`${authBaseUrl()}/oauth/authorize`);
  url.searchParams.set('response_type', 'code');
  url.searchParams.set('client_id', CLIENT_ID);
  url.searchParams.set('redirect_uri', redirectUri);
  url.searchParams.set('scope', SCOPE);
  url.searchParams.set('state', state);
  url.searchParams.set('code_challenge', codeChallenge);
  url.searchParams.set('code_challenge_method', 'S256');
  return url.toString();
}

async function parseTokenResponse(resp: Response): Promise<TokenResponse> {
  if (resp.ok) {
    try {
      return (await resp.json()) as TokenResponse;
    } catch {
      throw new OAuthError('unexpected response shape from the server', 'unexpected_shape');
    }
  }
  try {
    const body = (await resp.json()) as OAuthErrorBody;
    throw new OAuthError(
      `oauth error: ${body.error} — ${body.error_description}`,
      'protocol',
      body.error,
      body.error_description,
    );
  } catch (e) {
    if (e instanceof OAuthError) throw e;
    throw new OAuthError('unexpected response shape from the server', 'unexpected_shape');
  }
}

async function postForm(path: string, form: Record<string, string>, base = authBaseUrl()): Promise<TokenResponse> {
  let resp: Response;
  try {
    resp = await fetch(`${base}${path}`, {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams(form).toString(),
    });
  } catch (e) {
    throw new OAuthError(`network error: ${e instanceof Error ? e.message : String(e)}`, 'network');
  }
  return parseTokenResponse(resp);
}

/** `POST /oauth/token` with `grant_type=authorization_code`. */
export async function exchangeCode(
  code: string,
  codeVerifier: string,
  redirectUri: string,
  base = authBaseUrl(),
): Promise<TokenResponse> {
  return postForm(
    '/oauth/token',
    { grant_type: 'authorization_code', code, code_verifier: codeVerifier, client_id: CLIENT_ID, redirect_uri: redirectUri },
    base,
  );
}

/**
 * `POST /oauth/token` with `grant_type=refresh_token`. identity rotates
 * refresh tokens with reuse detection: presenting a refresh token returns a
 * NEW refresh token and revokes the old one, and re-presenting a spent one
 * revokes the whole session family. Callers MUST persist the returned
 * `refresh_token` atomically before using the new access token, and must
 * never retry a failed refresh with the same token.
 */
export async function refreshToken(refreshTokenValue: string, base = authBaseUrl()): Promise<TokenResponse> {
  return postForm('/oauth/token', { grant_type: 'refresh_token', refresh_token: refreshTokenValue, client_id: CLIENT_ID }, base);
}

/**
 * `POST /v1/oauth/code-exchange` — the OOB manual-entry fallback for
 * headless/SSH/container environments where no browser round-trip to
 * `127.0.0.1` is reachable.
 */
export async function exchangeManualCode(
  code: string,
  codeVerifier: string,
  base = authBaseUrl(),
): Promise<TokenResponse> {
  let resp: Response;
  try {
    resp = await fetch(`${base}/v1/oauth/code-exchange`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ code, code_verifier: codeVerifier, client_id: CLIENT_ID }),
    });
  } catch (e) {
    throw new OAuthError(`network error: ${e instanceof Error ? e.message : String(e)}`, 'network');
  }
  return parseTokenResponse(resp);
}
