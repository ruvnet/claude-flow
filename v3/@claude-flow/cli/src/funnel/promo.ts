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
 *   4. ADR-313 sponsored-downtime override — preempts everything below
 *      while rate-limited (unconditional, not slot-based).
 *   5. Local insight ticker (insights.ts) — a reserved 1-in-5 slot shows an
 *      environment/task-aware suggestion (CVEs, uncommitted changes,
 *      power-saver state) when one exists; otherwise falls through.
 *   6. Rotation — 4:1 educational:promotional, 30-min promo repeat cap.
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
import { selectMessage, ROTATION_SLOT_MS } from './rotation.js';
import { recordFunnelEvent } from './events.js';
import { getInstalledCliVersion } from '../init/helper-refresh.js';
import { hasConsent } from './consent.js';
import { readRateLimitStatus } from './rate-limit-notifier.js';
import { selectLocalInsight, type LocalInsightContext } from './insights.js';

/**
 * ADR-313 priority override: when the user has manually flagged a Claude
 * usage limit (ADR-312 Phase 0), preempt normal rotation with a dedicated
 * CTA — same precedent as ADR-303's credit-exhaustion recovery surface.
 * Two states depending on whether sponsored-downtime consent is granted:
 *   - not yet enabled: an actionable CTA to enable it
 *   - already enabled: a quiet status line confirming it's active
 * Both message strings use the exact " · manage: " anchor the renderer
 * already splits on (statusline-generator.ts getPromoRow) — no renderer
 * change needed; the command portion renders bold, never as a fake link.
 * Returns null when the rate-limit flag isn't set (no override).
 */
function getSponsoredDowntimeOverride(now: Date): PromoRow | null {
  const status = readRateLimitStatus(now);
  if (!status.limited) return null;

  if (hasConsent('sponsored-downtime')) {
    return {
      text: '⚡ Running on sponsored Cognitum capacity · manage: ruflo proxy sponsor-disable',
      kind: 'promotional',
    };
  }
  return {
    text: '⚡ Free Cognitum capacity while you wait · manage: ruflo proxy sponsor-enable',
    kind: 'promotional',
  };
}

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
  /**
   * Local environment/task signal for the insight ticker (insights.ts) —
   * optional and additive. Callers that don't pass it simply never see a
   * local insight; the remote rotation is entirely unaffected either way.
   */
  localInsights?: LocalInsightContext;
}

/** 1 in 5 slots, a different phase than rotation.ts's promo slot (slot%5==4)
 * so the two never collide — reserved for a local insight IF one exists;
 * otherwise falls through to the normal remote rotation untouched. This is
 * the "ticker" cadence: insights appear periodically, never permanently
 * take over the row, and never appear at all when nothing is actionable. */
const INSIGHT_SLOT_MODULO = 5;
const INSIGHT_SLOT_PHASE = 2;

function isInsightSlot(now: Date): boolean {
  const slot = Math.floor(now.getTime() / ROTATION_SLOT_MS);
  return slot % INSIGHT_SLOT_MODULO === INSIGHT_SLOT_PHASE;
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

  // ADR-313 priority override: a self-reported usage-limit flag preempts
  // normal rotation, exactly the way ADR-303's credit-exhaustion recovery
  // is designed to preempt it. Only reachable here — i.e. only after the
  // disclosure invariant (ADR-301 "no promotional content before
  // disclosure") has already been satisfied above.
  const override = getSponsoredDowntimeOverride(now);
  if (override) return override;

  // Local insight ticker: on its reserved 1-in-5 slot, show the highest-
  // priority environment/task insight if one exists — CVEs pending,
  // uncommitted changes, power-saver active, etc. (insights.ts). No
  // insight this render (or no context passed) → fall straight through to
  // the untouched remote rotation below, same as any other slot.
  if (ctx.localInsights && isInsightSlot(now)) {
    const insight = selectLocalInsight(ctx.localInsights);
    if (insight) return { text: insight.text, kind: 'insight' };
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
