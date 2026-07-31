/**
 * CASA envelope enforcement (ADR-380 §3 / ADR-240 §4).
 *
 * LOAD-BEARING INVARIANT (stated in both ADRs, restated here verbatim in
 * spirit): translation of free-text intent into a {@link CasaEnvelope}
 * MAY use an LLM (see `compile.ts`'s `translator` extension point).
 * ENFORCEMENT of the envelope — checking a requested action against
 * `allow`/`deny`/`expires_at` — must NEVER call an LLM or any
 * nondeterministic judgment. `checkAuthorization` below is a pure,
 * synchronous function: no I/O, no network calls, no randomness, no
 * calls to any model or external service. It is deny-by-default:
 * anything not explicitly present in `envelope.allow` is denied, even if
 * it is also absent from `envelope.deny`. Any change to this file that
 * introduces async behavior, an API call, or lets a model's runtime
 * judgment influence the `allowed` result is a security regression, not
 * a feature — see ADR-380 §3's explicit call for "bypass-attempt tests,
 * not just translation-quality tests" before this gate is trusted.
 */

import { CasaEnvelopeSchema, hasExplicitTimezone, type CasaEnvelope } from './schema.js';

export interface AuthorizationResult {
  readonly allowed: boolean;
  readonly reason: string;
}

/**
 * Parses an ISO 8601 timestamp to epoch milliseconds, requiring an
 * explicit UTC/offset marker (see {@link hasExplicitTimezone} in
 * `schema.ts`). Returns `NaN` — matching `Date.parse`'s own
 * not-a-timestamp sentinel — for anything else, including a string
 * `Date.parse` would otherwise happily (and ambiguously, under the host's
 * local timezone) accept.
 */
function parseTimestampStrict(value: string): number {
  if (typeof value !== 'string' || !hasExplicitTimezone(value)) {
    return NaN;
  }
  return Date.parse(value);
}

/**
 * Check whether `requestedAction` is authorized under `envelope`.
 *
 * Evaluation order (first match wins):
 *   0. `envelope` fails schema validation             -> denied, "invalid envelope..."
 *   1. Expiry unparseable, OR `now >= expires_at`      -> denied, "expired"
 *   2. In `envelope.deny`                              -> denied, "explicit deny"
 *   3. NOT in `envelope.allow`                         -> denied, "not in allow list (deny-by-default)"
 *   4. Otherwise                                       -> allowed
 *
 * This function defends its own precondition rather than trusting the
 * caller's (erased-at-runtime) TypeScript type: `envelope` is re-validated
 * against {@link CasaEnvelopeSchema} before anything else runs, so a
 * caller that hands in a structurally malformed envelope (e.g. `allow`
 * as a bare string instead of `string[]`, which would otherwise silently
 * fall through to `String.prototype.includes`'s substring-match overload
 * instead of `Array.prototype.includes`'s exact-value match) gets denied
 * outright instead of authorized. A malformed/unparseable `now` is
 * likewise treated as expired (fail closed) rather than silently
 * skipping the expiry gate — matching the Rust reference implementation
 * in `v3/crates/ruflo-agntcy/src/envelope.rs::check_authorization`, which
 * also denies at `now >= expires_at` (strict "before expiry", not
 * "on-or-before") for the same reason: the two enforcement points must
 * agree bit-for-bit on this load-bearing boundary.
 *
 * Deny always wins over allow: an action present in both lists is
 * denied at step 2, before `allow` is ever consulted. This function
 * takes no dependency on wall-clock time other than through the
 * `nowIso` parameter (defaulting to `new Date().toISOString()` at call
 * time), so it remains a pure function of its inputs for testing.
 */
export function checkAuthorization(
  envelope: CasaEnvelope,
  requestedAction: string,
  nowIso: string = new Date().toISOString(),
): AuthorizationResult {
  const parsed = CasaEnvelopeSchema.safeParse(envelope);
  if (!parsed.success) {
    return { allowed: false, reason: 'invalid envelope (failed schema validation)' };
  }
  const safeEnvelope = parsed.data;

  const now = parseTimestampStrict(nowIso);
  const expiresAt = parseTimestampStrict(safeEnvelope.expires_at);

  if (Number.isNaN(now) || Number.isNaN(expiresAt) || now >= expiresAt) {
    return { allowed: false, reason: 'expired' };
  }

  if (safeEnvelope.deny.includes(requestedAction)) {
    return { allowed: false, reason: 'explicit deny' };
  }

  if (!safeEnvelope.allow.includes(requestedAction)) {
    return { allowed: false, reason: 'not in allow list (deny-by-default)' };
  }

  return { allowed: true, reason: 'allowed' };
}
