/**
 * CASA authority envelope schema (ADR-380 §3 / ADR-240 §4).
 *
 * The envelope is the bounded, serializable authorization contract that
 * gates every tool/agent dispatch under CASA (Continuous Agentic Semantic
 * Authorization). Its shape is fixed by the two ADRs and MUST NOT be
 * extended without updating both documents:
 *
 *   {
 *     "objective": "review repository security",
 *     "allow": ["repository.read", "tests.execute"],
 *     "deny": ["git.push", "secret.export", "deployment.create"],
 *     "budget_usd": 8,
 *     "expires_at": "2026-07-30T22:00:00Z"
 *   }
 *
 * This module only validates the envelope's shape. It performs no
 * authorization logic — see `enforce.ts` for the deterministic gate that
 * actually checks a requested action against `allow`/`deny`/`expires_at`.
 *
 * Zod is used for validation-at-boundaries per this repo's security
 * convention (root CLAUDE.md: "Always validate user input at system
 * boundaries").
 */

import { z } from 'zod';

/**
 * A resource-scope string, e.g. `repository.read`, `git.push`,
 * `secret.export`. Deliberately just `string` (not an enum) — the set of
 * scopes is open-ended and governed by whatever CASA-compatible network
 * the envelope targets, not by this repo. Must be non-empty.
 */
const CasaScopeSchema = z.string().min(1, 'scope must be a non-empty string');

/**
 * True if `value` carries an explicit UTC/offset marker (`Z`/`z` or a
 * trailing `±HH:MM`). Mirrors the Rust reference parser
 * (`v3/crates/ruflo-agntcy/src/envelope.rs::parse_rfc3339_to_epoch_seconds`),
 * which rejects a timezone-less timestamp outright rather than guessing.
 * Required because `Date.parse()` on an offset-less ISO string is parsed
 * in the *host's local timezone*, not UTC — two machines with different
 * `TZ` settings would silently disagree on the same nominal timestamp.
 */
export function hasExplicitTimezone(value: string): boolean {
  return /(?:Z|z|[+-]\d{2}:\d{2})$/.test(value.trim());
}

/**
 * ISO 8601 timestamp string, with an explicit UTC/offset marker required
 * (see {@link hasExplicitTimezone}). Validated for parseability (via
 * `Date` rejecting malformed strings) on top of that requirement, since
 * ISO 8601 has multiple valid representations (with/without milliseconds,
 * etc). Enforcement (`enforce.ts`) re-parses this value itself and is the
 * authority on expiry semantics — this schema rejects strings that cannot
 * represent an unambiguous instant at all.
 */
const Iso8601Schema = z.string().refine(
  (value) => hasExplicitTimezone(value) && !Number.isNaN(Date.parse(value)),
  {
    message:
      'expires_at must be a valid ISO 8601 timestamp string with an explicit UTC/offset marker (Z or ±HH:MM)',
  },
);

export const CasaEnvelopeSchema = z
  .object({
    /** Free-text objective the envelope was compiled from. */
    objective: z.string().min(1, 'objective must be a non-empty string'),
    /** Explicitly permitted action scopes. Deny-by-default: anything not
     *  listed here is denied, even if it is also absent from `deny`. */
    allow: z.array(CasaScopeSchema),
    /** Explicitly forbidden action scopes. Deny always wins over allow. */
    deny: z.array(CasaScopeSchema),
    /** Maximum USD spend authorized under this envelope. */
    budget_usd: z.number().positive('budget_usd must be a positive number'),
    /** Envelope expiry, ISO 8601. */
    expires_at: Iso8601Schema,
  })
  .strict();

export type CasaEnvelope = z.infer<typeof CasaEnvelopeSchema>;
