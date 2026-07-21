/**
 * `ruflo auth` state shapes (ADR-306).
 *
 * `auth.json` holds identity metadata ONLY — never token material. The
 * access token lives exclusively in a process-lifetime in-memory singleton
 * (session.ts); the refresh token goes to the OS keychain (keychainRef set)
 * or nowhere at all when no keychain backend is reachable (keychainRef:
 * null — session-only mode, ADR-306's accepted usability cost, not a bug).
 */

export interface ProfileAuthState {
  accountId: string;
  scopes: string[];
  /** ISO timestamp — the access token's own expiry, not tracked beyond this. */
  accessTokenExpiresAt: string;
  /** OS-keychain account identifier for this profile's refresh token, or null if session-only. */
  keychainRef: string | null;
  profile: string;
  loginMethod: 'pkce' | 'device' | 'token-stdin';
  /** ISO timestamp of the login that created/last-refreshed this profile. */
  linkedAt: string;
}

export interface AuthFile {
  schemaVersion: 1;
  defaultProfile: string;
  profiles: Record<string, ProfileAuthState>;
}
