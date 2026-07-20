/**
 * Process-lifetime in-memory access-token cache (ADR-306).
 *
 * The access token is never written to `auth.json` or any other disk file —
 * only the refresh token (via the OS keychain, or nowhere in session-only
 * mode) survives a process exit. Every fresh `ruflo` invocation starts with
 * an empty cache and re-derives an access token from the refresh token (or
 * asks the user to log in again, in session-only mode). This is a deliberate
 * ADR-306 usability cost, not something to "fix" by persisting the access
 * token — see auth/types.ts's doc comment.
 */

interface SessionEntry {
  accessToken: string;
  /** epoch ms */
  expiresAt: number;
}

const sessions = new Map<string, SessionEntry>();

export function setSessionToken(profile: string, accessToken: string, expiresAtMs: number): void {
  sessions.set(profile, { accessToken, expiresAt: expiresAtMs });
}

/**
 * Returns the cached access token when it remains valid for at least
 * `minValidityMs`. Authenticated callers use a small refresh window so a
 * token cannot expire while an outbound request is in flight.
 */
export function getSessionToken(profile: string, minValidityMs = 0): string | null {
  const entry = sessions.get(profile);
  if (!entry) return null;
  if (Date.now() + Math.max(0, minValidityMs) >= entry.expiresAt) return null;
  return entry.accessToken;
}

export function clearSessionToken(profile: string): void {
  sessions.delete(profile);
}
