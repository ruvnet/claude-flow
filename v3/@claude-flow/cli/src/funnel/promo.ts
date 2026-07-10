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
import {
  getDisclosure,
  promoEligible,
  recordDisclosureShown,
  selectDisclosureMessage,
} from './disclosure.js';
import { clickTrackedUrl } from './attribution.js';
import { selectMessage } from './rotation.js';
import { recordFunnelEvent } from './events.js';
import { getInstalledCliVersion } from '../init/helper-refresh.js';

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

  const release = getInstalledCliVersion();

  // Disclosure gate: never a message before the disclosure has been shown
  // and its grace window has passed. The disclosure MESSAGE itself is now
  // remote-sourced (ADR-311) — selectDisclosureMessage() returns null when
  // the remote pool hasn't populated yet (cold start / outage), and per the
  // "zero local promo content" design, null means show nothing this cycle.
  const disclosure = getDisclosure();
  if (disclosure.state === 'never_seen') {
    const msg = selectDisclosureMessage(now);
    if (!msg) return null; // fail-closed: no remote disclosure cached yet
    recordDisclosureShown(now);
    recordFunnelEvent('disclosure_shown', 'statusline', release, { now, messageId: msg.id });
    const url = msg.url ? clickTrackedUrl(msg.id, msg.url, {
      medium: 'statusline', campaign: 'disclosure', content: msg.id, now,
    }) : undefined;
    return { text: msg.text, kind: 'disclosure', url };
  }
  if (!promoEligible(now)) {
    if (disclosure.state === 'disclosed_enabled') {
      const msg = selectDisclosureMessage(now);
      if (!msg) return null; // fail-closed
      const url = msg.url ? clickTrackedUrl(msg.id, msg.url, {
        medium: 'statusline', campaign: 'disclosure', content: msg.id, now,
      }) : undefined;
      return { text: msg.text, kind: 'disclosure', url };
    }
    return null; // disclosed_disabled is caught by precedence, but stay fail-closed
  }

  const msg = selectMessage(now, release);
  if (!msg) return null;
  // Any message carrying a URL (educational tips included) routes through
  // the server click-redirect so `promo_open` + coarse geo are captured
  // before 302ing to the real target — click counting is uniform across
  // the whole rotation, not just the promotional slot. If the click
  // endpoint chain rejects the URL for any reason, fall back to the
  // UTM-decorated direct link so the click still lands where it should.
  let url: string | undefined;
  if (msg.url) {
    url = clickTrackedUrl(msg.id, msg.url, {
      medium: 'statusline', campaign: msg.class, content: msg.id, now,
    });
  }
  return { text: msg.text, kind: msg.class, url };
}
