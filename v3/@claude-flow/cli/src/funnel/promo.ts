/**
 * Promo-row orchestrator — the single entry point the statusline hook calls
 * (ADR-301). Applies, in order:
 *
 *   1. Control precedence (env / enterprise / user / project / remote) —
 *      any disable → nothing renders, ever.
 *   2. Environment gates — CI never sees funnel content.
 *   3. Disclosure gate — an upgraded install shows the disclosure text
 *      (with the disable instruction) before any message; promotional
 *      content only after the grace window.
 *   4. Rotation — 4:1 educational:promotional, 30-min promo repeat cap.
 *
 * Output is plain text (no ANSI — the renderer applies its own fixed
 * style), ≤ 80 columns, already sanitized by the message pipeline.
 */

import type { PromoRow } from './types.js';
import { resolveFunnelEnabled } from './precedence.js';
import { isCI } from './environment.js';
import { DISCLOSURE_TEXT, getDisclosure, promoEligible, recordDisclosureShown } from './disclosure.js';
import { selectMessage } from './rotation.js';

export interface PromoContext {
  cwd?: string;
  env?: NodeJS.ProcessEnv;
  now?: Date;
  /**
   * Whether the calling surface is an interactive session. The statusline
   * hook is spawned with piped stdio by an interactive host, so the caller
   * asserts interactivity; directly-run non-TTY invocations pass false.
   */
  interactive: boolean;
}

export function getFunnelPromo(ctx: PromoContext): PromoRow | null {
  const env = ctx.env ?? process.env;
  const now = ctx.now ?? new Date();

  if (!ctx.interactive) return null;
  if (isCI(env)) return null;

  const decision = resolveFunnelEnabled(ctx.cwd ?? process.cwd(), env);
  if (!decision.enabled) return null;

  // Disclosure gate: never a message before the disclosure has been shown
  // and its grace window has passed.
  const disclosure = getDisclosure();
  if (disclosure.state === 'never_seen') {
    recordDisclosureShown(now);
    return { text: DISCLOSURE_TEXT, kind: 'disclosure' };
  }
  if (!promoEligible(now)) {
    if (disclosure.state === 'disclosed_enabled') {
      return { text: DISCLOSURE_TEXT, kind: 'disclosure' };
    }
    return null; // disclosed_disabled is caught by precedence, but stay fail-closed
  }

  const msg = selectMessage(now);
  if (!msg) return null;
  return { text: msg.text, kind: msg.class, url: msg.url };
}
