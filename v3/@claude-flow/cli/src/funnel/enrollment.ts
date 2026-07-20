/**
 * Post-initialization capability enrollment — ADR-302.
 *
 * One-time, non-blocking, skippable. Gates, all of which must pass:
 *   - interactive TTY (never in CI / piped / automation)
 *   - not skipped via --no-signup
 *   - funnel enabled under the ADR-305 precedence chain
 *   - never shown before (user-level record, not per-project)
 *
 * Accepting authorizes exactly ONE thing: a pointer to `ruflo auth login`.
 * It does not install the proxy, does not enable telemetry, and does not
 * enable cloud routing (separate consent domains — ADR-302). The enrollment
 * outcome never affects init's exit code.
 */

import { isCI, isInteractive } from './environment.js';
import { resolveFunnelEnabled } from './precedence.js';
import { recordConsent } from './consent.js';
import { readStateJson, writeStateJson } from './state.js';

const ENROLLMENT_FILE = 'enrollment.json';

interface EnrollmentRecord {
  shownAt: string;
  outcome: 'accepted' | 'skipped';
}

export function getEnrollmentRecord(): EnrollmentRecord | null {
  return readStateJson<EnrollmentRecord>(ENROLLMENT_FILE);
}

export const ENROLLMENT_SCREEN = [
  '────────────────────────────',
  'Unlock additional capabilities?',
  '',
  '  ✓ Local Meta LLM Proxy',
  '  ✓ Multi-model routing',
  '  ✓ Hosted memory',
  '  ✓ Enterprise rate limits',
  '  ✓ Premium agents',
  '  ✓ Cloud synchronization',
  '',
  'Free account: https://cognitum.one',
].join('\n');

export const ENROLLMENT_SKIP_TEXT = 'You can enable later:\n  ruflo auth login';

export interface EnrollmentGateContext {
  noSignup: boolean;
  cwd?: string;
  env?: NodeJS.ProcessEnv;
}

/** All ADR-302 gates. Pure check — does not write state. */
export function shouldOfferEnrollment(ctx: EnrollmentGateContext): boolean {
  const env = ctx.env ?? process.env;
  if (ctx.noSignup) return false;
  if (isCI(env)) return false;
  if (!isInteractive()) return false;
  if (!resolveFunnelEnabled(ctx.cwd ?? process.cwd(), env).enabled) return false;
  if (getEnrollmentRecord() !== null) return false; // one-time only
  return true;
}

/**
 * Record the user's decision. Both accept and skip are terminal — the
 * prompt never reappears (ADR-302). Accepting records the `account`
 * consent receipt; skipping records the decline.
 */
export function recordEnrollmentOutcome(accepted: boolean, now: Date = new Date()): void {
  writeStateJson(ENROLLMENT_FILE, {
    shownAt: now.toISOString(),
    outcome: accepted ? 'accepted' : 'skipped',
  } satisfies EnrollmentRecord);
  recordConsent('account', accepted, 'post-init', now);
}
