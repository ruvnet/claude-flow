/**
 * Lazy loader for `@claude-flow/security`'s OAuth + keychain surface
 * (ADR-306). `@claude-flow/security` is an `optionalDependency` of this
 * package (see package.json) — `ruflo auth` is the one capability that
 * genuinely cannot function without it, so this module's job is turning "the
 * optional package failed to install" into one clear, actionable error
 * instead of a raw `ERR_MODULE_NOT_FOUND` stack trace. Mirrors the
 * lazy-`require`-in-try/catch idiom already used for this same package in
 * src/mcp-client.ts's `applyContentBoundaryGuardrail`, but as an async
 * dynamic `import()` (the security package is itself `"type": "module"`).
 *
 * Only `import type` is used for the package's real types below — type-only
 * imports are fully erased at compile time and never touch the runtime
 * module resolver, so this file type-checks whether or not the optional
 * dependency happens to be installed in a given consumer's node_modules.
 */

import type {
  authorizeUrl as AuthorizeUrlFn,
  exchangeCode as ExchangeCodeFn,
  refreshToken as RefreshTokenFn,
  exchangeManualCode as ExchangeManualCodeFn,
  generatePkce as GeneratePkceFn,
  OAuthTokenResponse,
  PkceRequest,
  CallbackServer as CallbackServerClass,
  CallbackResult,
  openBrowser as OpenBrowserFn,
  createKeychainAdapter as CreateKeychainAdapterFn,
  KeychainAdapter,
  OAuthError as OAuthErrorClass,
} from '@claude-flow/security';

export interface SecurityOAuthModule {
  authorizeUrl: typeof AuthorizeUrlFn;
  exchangeCode: typeof ExchangeCodeFn;
  refreshToken: typeof RefreshTokenFn;
  exchangeManualCode: typeof ExchangeManualCodeFn;
  generatePkce: typeof GeneratePkceFn;
  CallbackServer: typeof CallbackServerClass;
  openBrowser: typeof OpenBrowserFn;
  createKeychainAdapter: typeof CreateKeychainAdapterFn;
  OAuthError: typeof OAuthErrorClass;
  OOB_REDIRECT_URI: string;
}

export type { OAuthTokenResponse, PkceRequest, CallbackResult, KeychainAdapter };

export class SecurityPackageMissingError extends Error {
  constructor(cause: unknown) {
    super(
      "ruflo auth needs the '@claude-flow/security' package, which isn't installed " +
        "(it's an optional dependency — install/reinstall failed or was skipped for this " +
        `platform). Try: npm install @claude-flow/security. Underlying error: ${
          cause instanceof Error ? cause.message : String(cause)
        }`,
    );
    this.name = 'SecurityPackageMissingError';
  }
}

let cached: SecurityOAuthModule | null = null;

/** Loads `@claude-flow/security`'s OAuth surface, throwing a clear error if it's absent. */
export async function loadSecurityOAuth(): Promise<SecurityOAuthModule> {
  if (cached) return cached;
  try {
    const mod = (await import('@claude-flow/security')) as unknown as SecurityOAuthModule;
    if (!mod.authorizeUrl || !mod.createKeychainAdapter) {
      throw new Error('module loaded but is missing expected OAuth exports');
    }
    cached = mod;
    return mod;
  } catch (e) {
    throw new SecurityPackageMissingError(e);
  }
}
