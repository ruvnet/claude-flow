/**
 * Credit-error taxonomy and fail-closed classifier — ADR-303.
 *
 * Adapters map machine-readable provider codes into the canonical
 * CreditErrorCode enum. Message text is NEVER parsed. Anything unmapped
 * stays unclassified (confidence 0) and falls through to the ordinary
 * error path. Only COGNITUM_CREDIT_EXHAUSTED — asserted by the Cognitum
 * ledger, the single credit authority — may trigger the funnel surface.
 */

import { CreditErrorCode, type NormalizedCreditError } from './types.js';

/**
 * Provider-code → canonical-code table. Keys are exact machine-readable
 * code strings from provider error payloads (mirrors the ADR-308 server
 * taxonomy 1:1). Versioned by code review; unmapped codes land nowhere.
 */
const PROVIDER_CODE_TABLE: Record<string, { code: CreditErrorCode; retryable: boolean }> = {
  // Cognitum ledger (the single credit authority — ADR-303)
  cognitum_credit_exhausted: { code: CreditErrorCode.COGNITUM_CREDIT_EXHAUSTED, retryable: false },
  // Upstream provider quota/billing — NOT a Cognitum upsell moment
  insufficient_quota: { code: CreditErrorCode.PROVIDER_QUOTA_EXHAUSTED, retryable: false },
  billing_hard_limit_reached: { code: CreditErrorCode.PROVIDER_QUOTA_EXHAUSTED, retryable: false },
  quota_exceeded: { code: CreditErrorCode.PROVIDER_QUOTA_EXHAUSTED, retryable: false },
  // Retryable rate limits
  rate_limit_exceeded: { code: CreditErrorCode.PROVIDER_RATE_LIMITED, retryable: true },
  rate_limit_error: { code: CreditErrorCode.PROVIDER_RATE_LIMITED, retryable: true },
  overloaded_error: { code: CreditErrorCode.SERVICE_UNAVAILABLE, retryable: true },
  // Auth
  authentication_error: { code: CreditErrorCode.AUTHENTICATION_FAILED, retryable: false },
  invalid_api_key: { code: CreditErrorCode.AUTHENTICATION_FAILED, retryable: false },
  permission_error: { code: CreditErrorCode.AUTHENTICATION_FAILED, retryable: false },
  // Outages
  api_error: { code: CreditErrorCode.SERVICE_UNAVAILABLE, retryable: true },
  service_unavailable: { code: CreditErrorCode.SERVICE_UNAVAILABLE, retryable: true },
};

export interface ProviderErrorLike {
  /** Machine-readable provider error code (e.g. `error.type` / `error.code`). */
  providerCode?: string;
  /** HTTP status, when the transport exposes one. */
  status?: number;
}

export function classifyCreditError(err: ProviderErrorLike): NormalizedCreditError {
  const key = err.providerCode?.trim().toLowerCase();
  if (key && Object.prototype.hasOwnProperty.call(PROVIDER_CODE_TABLE, key)) {
    const mapped = PROVIDER_CODE_TABLE[key];
    return { code: mapped.code, confidence: 1, retryable: mapped.retryable, cause: err };
  }
  // Status-only signals are structural (401/403 → auth; 5xx → outage), but a
  // bare 429 is ambiguous between rate-limit and quota — leave it unmapped.
  if (err.status === 401 || err.status === 403) {
    return { code: CreditErrorCode.AUTHENTICATION_FAILED, confidence: 1, retryable: false, cause: err };
  }
  if (err.status !== undefined && err.status >= 500) {
    return { code: CreditErrorCode.SERVICE_UNAVAILABLE, confidence: 1, retryable: true, cause: err };
  }
  return { code: null, confidence: 0, retryable: false, cause: err };
}

export interface CreditPromptSession {
  creditPromptShown: boolean;
}

/**
 * The ADR-303 gate, fail-closed and frequency-capped: fires only for a
 * confident, non-retryable Cognitum-ledger exhaustion, at most once per
 * session. Everything else falls through to the ordinary error path.
 */
export function shouldShowCreditRecovery(
  error: NormalizedCreditError,
  session: CreditPromptSession,
): boolean {
  return (
    error.code === CreditErrorCode.COGNITUM_CREDIT_EXHAUSTED &&
    error.confidence === 1 &&
    !error.retryable &&
    !session.creditPromptShown
  );
}

/** Full contextual screen (interactive TTY, first occurrence). */
export function renderCreditRecovery(authenticated: boolean): string {
  const lines = [
    'Daily hosted credits exhausted.',
    '',
    'Continue immediately by enabling',
    'your free local Meta LLM Proxy.',
    '',
    'Benefits',
    '  ✓ Unlimited local requests',
    '  ✓ Automatic model routing',
    '  ✓ Lower latency',
    '  ✓ Privacy preserving',
    '  ✓ Cloud fallback',
    '',
  ];
  if (authenticated) {
    lines.push('Start local proxy?', '  ruflo proxy enable');
  } else {
    lines.push('Sign in:', '  ruflo auth login');
  }
  return lines.join('\n');
}

/** Single-line hint (non-TTY, CI, or repeat occurrences in a session). */
export const CREDIT_RECOVERY_HINT =
  'Hint: ruflo auth login enables the free local Meta LLM proxy';
