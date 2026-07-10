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
  DISCLOSURE_SPONSOR_URL,
  getDisclosure,
  promoEligible,
  recordDisclosureShown,
  selectDisclosureText,
  DISCLOSURE_TEXTS,
} from './disclosure.js';
import { attributionUrl } from './attribution.js';
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
  // Disclosure — attribute the render so a landing at cognitum.one can be
  // tied back to the surface + variant. UTM content is the variant index so
  // rotation performance is measurable; fid is only appended when telemetry
  // consent is present (ADR-309), so a non-consenting user still gets a
  // functioning link, just without the attribution join key.
  if (disclosure.state === 'never_seen') {
    recordDisclosureShown(now);
    const text = selectDisclosureText(now);
    const content = disclosureContentId(text);
    return {
      text,
      kind: 'disclosure',
      url: attributionUrl(DISCLOSURE_SPONSOR_URL, {
        medium: 'statusline', campaign: 'disclosure', content, now,
      }),
    };
  }
  if (!promoEligible(now)) {
    if (disclosure.state === 'disclosed_enabled') {
      const text = selectDisclosureText(now);
      const content = disclosureContentId(text);
      return {
        text,
        kind: 'disclosure',
        url: attributionUrl(DISCLOSURE_SPONSOR_URL, {
          medium: 'statusline', campaign: 'disclosure', content, now,
        }),
      };
    }
    return null; // disclosed_disabled is caught by precedence, but stay fail-closed
  }

  const msg = selectMessage(now);
  if (!msg) return null;
  // Educational tips have no URL; promotional messages carry a base URL to
  // an allowlisted host, and we wrap it with attribution here so both the
  // OSC 8 renderer allowlist AND the analytics join key stay in the
  // renderer/promo boundary.
  const url = msg.url
    ? attributionUrl(msg.url, {
        medium: 'statusline', campaign: msg.class, content: msg.id, now,
      })
    : undefined;
  return { text: msg.text, kind: msg.class, url };
}

/** Stable content id for the currently-selected disclosure variant. */
function disclosureContentId(text: string): string {
  const idx = DISCLOSURE_TEXTS.indexOf(text);
  return idx >= 0 ? `disclosure-${idx + 1}` : 'disclosure-1';
}
