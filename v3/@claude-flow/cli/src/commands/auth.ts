/**
 * `ruflo auth` — Cognitum identity (ADR-306).
 *
 * `login` obtains OAuth tokens via the loopback PKCE flow (default,
 * interactive desktop), the OOB manual-paste flow (`--no-browser`, or
 * auto-detected headless environments), or `--token-stdin` (CI/enterprise
 * automation — refuses interactively otherwise, per ADR-306). The refresh
 * token goes to the OS keychain when reachable, or nowhere (session-only —
 * a deliberate usability cost, not a bug) when it isn't. The access token
 * itself is NEVER written to disk; see src/auth/session.ts.
 */

import type { Command, CommandResult } from '../types.js';
import { output } from '../output.js';
import { isCI, isInteractive, hasConsent, recordConsent, revokeConsent } from '../funnel/index.js';
import {
  browserLogin,
  manualLogin,
  tokenStdinLogin,
  isProbablyHeadless,
  LoginCancelledError,
  LoginDeniedError,
  StateMismatchError,
} from '../auth/client.js';
import { loadSecurityOAuth, SecurityPackageMissingError, type OAuthTokenResponse } from '../auth/security-bridge.js';
import { getProfile, setProfile, removeProfile, listProfiles, clearAllProfiles, DEFAULT_PROFILE } from '../auth/state.js';
import { setSessionToken, clearSessionToken } from '../auth/session.js';
import { INITIAL_SCOPE, domainForScope } from '../auth/scopes.js';
import type { ProfileAuthState } from '../auth/types.js';
import { KEYCHAIN_SERVICE } from '../auth/constants.js';
import { getValidAccessToken, NotLoggedInError, SessionOnlyExpiredError } from '../auth/client.js';
import { removeInjectedToken } from '../proxy/token-bridge.js';

function nowIso(): string {
  return new Date().toISOString();
}

async function persistLogin(
  profileName: string,
  tokens: OAuthTokenResponse,
  method: ProfileAuthState['loginMethod'],
): Promise<ProfileAuthState> {
  const expiresInSec = tokens.expires_in ?? 0;
  const expiresAtMs = Date.now() + expiresInSec * 1000;
  setSessionToken(profileName, tokens.access_token, expiresAtMs);

  let keychainRef: string | null = null;
  if (tokens.refresh_token) {
    const sec = await loadSecurityOAuth();
    const keychain = await sec.createKeychainAdapter();
    if (await keychain.isAvailable()) {
      await keychain.setSecret(KEYCHAIN_SERVICE, profileName, tokens.refresh_token);
      keychainRef = profileName;
    }
    // else: session-only — the refresh token is simply not persisted anywhere.
  }

  const state: ProfileAuthState = {
    accountId: tokens.account_email ?? 'unknown',
    scopes: [INITIAL_SCOPE],
    accessTokenExpiresAt: new Date(expiresAtMs).toISOString(),
    keychainRef,
    profile: profileName,
    loginMethod: method,
    linkedAt: nowIso(),
  };
  setProfile(profileName, state);
  recordConsent('account', true, 'auth-login');
  return state;
}

function refuseNonInteractive(hasTokenStdin: boolean): CommandResult | null {
  if (hasTokenStdin) return null;
  if (isInteractive() && !isCI()) return null;
  // The CLI harness only acts on exitCode — it never auto-prints
  // CommandResult.message, so this path must print for itself.
  const message =
    'ruflo auth login refuses to run interactively in a non-TTY/CI environment. ' +
    'Use --token-stdin for automation (reads {"access_token",...} JSON from stdin).';
  output.printError(message);
  return { success: false, message, exitCode: 1 };
}

const loginCommand: Command = {
  name: 'login',
  description: 'Sign in to Cognitum (PKCE browser flow, OOB manual flow, or --token-stdin)',
  options: [
    { name: 'profile', description: 'Named profile to store this login under', type: 'string', default: DEFAULT_PROFILE },
    { name: 'no-browser', description: 'Force the headless OOB copy-paste flow', type: 'boolean', default: false },
    { name: 'token-stdin', description: 'Read a pre-obtained token as JSON from stdin (CI/automation)', type: 'boolean', default: false },
  ],
  action: async (ctx): Promise<CommandResult> => {
    const profileName = typeof ctx.flags.profile === 'string' ? ctx.flags.profile : DEFAULT_PROFILE;
    // Parser camelCases kebab-case flag names — read via tokenStdin/noBrowser,
    // not ['token-stdin']/['no-browser'] (see doctor.ts's fixHandles comment).
    const tokenStdin = Boolean(ctx.flags.tokenStdin ?? ctx.flags['token-stdin']);
    const noBrowser = Boolean(ctx.flags.noBrowser ?? ctx.flags['no-browser']);

    const refusal = refuseNonInteractive(tokenStdin);
    if (refusal) return refusal;

    try {
      const result = tokenStdin
        ? await tokenStdinLogin()
        : noBrowser || isProbablyHeadless()
          ? await manualLogin((line) => output.writeln(line))
          : await browserLogin((line) => output.writeln(line));

      const state = await persistLogin(profileName, result.tokens, result.method);

      output.printSuccess(`Logged in as ${state.accountId} (profile: ${profileName})`);
      output.writeln(
        state.keychainRef
          ? '  refresh token: stored in the OS keychain'
          : '  refresh token: NOT stored (no keychain backend reachable) — session-only, you will need to log in again next time',
      );
      return { success: true, data: { profile: profileName, accountId: state.accountId } };
    } catch (e) {
      if (e instanceof SecurityPackageMissingError || e instanceof LoginCancelledError || e instanceof LoginDeniedError || e instanceof StateMismatchError) {
        output.printError(e.message);
        return { success: false, message: e.message, exitCode: 1 };
      }
      const message = e instanceof Error ? e.message : String(e);
      output.printError('Sign-in failed', message);
      return { success: false, message, exitCode: 1 };
    }
  },
};

const logoutCommand: Command = {
  name: 'logout',
  description: 'Sign out — clears the local session, keychain entry, and account consent',
  options: [
    { name: 'profile', description: 'Profile to log out of', type: 'string', default: DEFAULT_PROFILE },
    { name: 'all', description: 'Log out of every profile', type: 'boolean', default: false },
  ],
  action: async (ctx): Promise<CommandResult> => {
    removeInjectedToken();
    const all = ctx.flags.all === true;
    const profileName = typeof ctx.flags.profile === 'string' ? ctx.flags.profile : DEFAULT_PROFILE;
    const { profiles } = listProfiles();

    if (profiles.length === 0) {
      output.writeln('Nothing to log out of — no profile is signed in.');
      return { success: true, data: { hadSession: false } };
    }

    const toClear = all ? profiles : profiles.filter((p) => p.profile === profileName);
    if (toClear.length === 0) {
      output.writeln(`No such profile: ${profileName}`);
      return { success: false, exitCode: 1 };
    }

    let sec;
    try {
      sec = await loadSecurityOAuth();
    } catch {
      sec = null; // best-effort keychain cleanup — logout must still succeed locally
    }

    for (const p of toClear) {
      clearSessionToken(p.profile);
      if (p.keychainRef && sec) {
        const keychain = await sec.createKeychainAdapter();
        await keychain.deleteSecret(KEYCHAIN_SERVICE, p.keychainRef).catch(() => {});
      }
      removeProfile(p.profile);
    }

    if (all) {
      clearAllProfiles();
      revokeConsent('account', 'auth-logout');
    } else if (listProfiles().profiles.length === 0) {
      revokeConsent('account', 'auth-logout');
    }

    output.printSuccess(all ? 'Logged out of all profiles.' : `Logged out of profile "${profileName}".`);
    output.writeln(
      '  Note: this only forgets the local copy. Cognitum does not currently expose a token ' +
        'revocation endpoint for this flow, matching the same known limitation meta-proxy documents ' +
        'for its own logout — revoke server-side access from the Cognitum dashboard if needed.',
    );
    return { success: true, data: { hadSession: true } };
  },
};

const statusCommand: Command = {
  name: 'status',
  description: 'Show signed-in profile(s), scopes, and expiry',
  options: [
    { name: 'profile', description: 'Show only this profile', type: 'string' },
    { name: 'json', description: 'Machine-readable output', type: 'boolean', default: false },
    {
      name: 'check',
      description: 'Validate credentials now; silently refresh from the OS keychain when needed',
      type: 'boolean',
      default: false,
    },
  ],
  action: async (ctx): Promise<CommandResult> => {
    const { defaultProfile, profiles } = listProfiles();
    const filterName = typeof ctx.flags.profile === 'string' ? ctx.flags.profile : undefined;
    const shown = filterName ? profiles.filter((p) => p.profile === filterName) : profiles;

    if (shown.length === 0) {
      const message = filterName ? `No such profile: ${filterName}` : 'Not logged in. Run: ruflo auth login';
      if (ctx.flags.json) {
        output.printJson({ profiles: [] });
      } else {
        output.writeln(message);
      }
      return { success: true, data: { profiles: [] } };
    }

    const withConsistency = shown.map((p) => {
      const missingConsent = p.scopes.filter((scope) => {
        const domain = domainForScope(scope);
        return domain !== undefined && !hasConsent(domain);
      });
      return { ...p, isDefault: p.profile === defaultProfile, missingConsent };
    });

    const checked = await Promise.all(
      withConsistency.map(async (p) => {
        if (!ctx.flags.check) return { ...p, credentialStatus: 'not-checked' as const };
        try {
          await getValidAccessToken(p.profile);
          return { ...p, credentialStatus: 'valid' as const };
        } catch (e) {
          const message = e instanceof Error ? e.message : String(e);
          return {
            ...p,
            credentialStatus:
              e instanceof NotLoggedInError || e instanceof SessionOnlyExpiredError
                ? ('login-required' as const)
                : ('unavailable' as const),
            credentialError: message,
          };
        }
      }),
    );

    if (ctx.flags.json) {
      output.printJson({ profiles: checked });
      return { success: true, data: { profiles: checked } };
    }

    for (const p of checked) {
      output.writeln(`Profile: ${p.profile}${p.isDefault ? ' (default)' : ''}`);
      output.writeln(`  account: ${p.accountId}`);
      output.writeln(`  scopes: ${p.scopes.join(', ')}`);
      output.writeln(`  access token expires: ${p.accessTokenExpiresAt}`);
      output.writeln(`  refresh token: ${p.keychainRef ? 'in OS keychain' : 'session-only (not persisted)'}`);
      if (ctx.flags.check) {
        output.writeln(`  credential check: ${p.credentialStatus}`);
        if ('credentialError' in p && p.credentialError) output.writeln(`    ${p.credentialError}`);
      }
      if (p.missingConsent.length > 0) {
        output.printError(
          `  scope-vs-consent mismatch: ${p.missingConsent.join(', ')} granted without a matching consent receipt`,
        );
      }
      output.writeln('');
    }
    return { success: true, data: { profiles: checked } };
  },
};

export const authCommand: Command = {
  name: 'auth',
  description: 'Cognitum identity — login, logout, status (ADR-306)',
  subcommands: [loginCommand, logoutCommand, statusCommand],
  examples: [
    { command: 'ruflo auth login', description: 'Sign in via the browser PKCE flow' },
    { command: 'ruflo auth login --no-browser', description: 'Sign in via the headless OOB copy-paste flow' },
    { command: 'ruflo auth status', description: 'Show signed-in profile(s)' },
    { command: 'ruflo auth status --check', description: 'Validate or silently refresh credentials now' },
    { command: 'ruflo auth logout', description: 'Sign out of the default profile' },
  ],
  action: statusCommand.action,
};

export default authCommand;
