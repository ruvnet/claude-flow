/**
 * Local insight ticker — environment/task-aware suggestions sharing the
 * promo row's screen real estate, but a deliberately SEPARATE data path
 * from it.
 *
 * Why separate: the promo row is "zero local content, fully remote-served,
 * fail-closed" (an explicit earlier design call — nothing about WHAT shows
 * ships in the package). Insights are the opposite by nature — CVE counts,
 * uncommitted changes, sponsored-mode state — none of that is knowable
 * server-side. Conflating the two would mean either routing local logic
 * through the remote-content validation pipeline (messages.ts's
 * isValidMessage(), built for untrusted REMOTE content) or quietly giving
 * the promo row a second, unrelated job. So: same rendered slot, same
 * PromoRow shape, but a totally separate module, never touching
 * message-transport.ts or the remote message cache.
 *
 * Cheapness discipline (learned the hard way — see the funnel-cache fix):
 * every insight source here MUST be either (a) synchronous local file/state
 * reads, already-computed data the caller passes in, or (b) a read of a
 * cache some OTHER, separately-scheduled process populates. NEVER a network
 * call from here — that would reintroduce the exact bug where a statusline
 * render silently ate a multi-second fetch it could never actually finish.
 */

import { hasConsent } from './consent.js';
import { readQuotaLowStatus } from './power-saver-notifier.js';
import { readStateJson } from './state.js';
import { readAdvisorTip } from './advisor-tip.js';

export interface LocalInsight {
  id: string;
  text: string;
  /** Higher = shown first when multiple insights are candidates this slot. */
  priority: number;
}

export interface LocalInsightContext {
  security?: { status: string; cvesFixed: number; totalCves: number };
  swarm?: { activeAgents: number; maxAgents: number; coordinationActive: boolean };
  /** Count of uncommitted-changed files (git status --short line count). */
  gitUncommittedCount?: number;
  now?: Date;
}

const GIT_UNCOMMITTED_THRESHOLD = 20;

/**
 * ADR-315 hook point — NOT yet populated by anything. The real flywheel
 * self-optimization signal (e.g. "your sponsored traffic contributed to a
 * new MicroLoRA candidate") depends on ADR-315's client-side consent wiring
 * (the training-data-sharing domain + X-Cognitum-Training-Consent header),
 * which doesn't exist yet — building the actual fetch-and-cache pipeline
 * ahead of that consent groundwork would mean either faking data or wiring
 * a network call with no real signal behind it. This reads a local cache
 * file so the ticker is ready the moment that pipeline exists: whatever
 * populates ~/.ruflo/flywheel-status.json (a future detached, session-start
 * refresh — same pattern as the funnel message cache fix) is immediately
 * picked up here with zero ticker-side changes needed.
 */
interface FlywheelStatusCache {
  _ts: number;
  headline?: string;
}
const FLYWHEEL_STATUS_TTL_MS = 24 * 60 * 60 * 1000;

function flywheelInsight(now: Date): LocalInsight | null {
  const cache = readStateJson<FlywheelStatusCache>('flywheel-status.json');
  // `!cache._ts` would wrongly treat a legitimate epoch-zero timestamp as
  // absent (0 is falsy) — check the type explicitly instead (ADR-316 found
  // this exact defect pattern live via a test using new Date(0)).
  if (!cache || !cache.headline || typeof cache._ts !== 'number') return null;
  if (now.getTime() - cache._ts >= FLYWHEEL_STATUS_TTL_MS) return null;
  return { id: 'insight-flywheel-status', text: `🧬 ${cache.headline}`, priority: 40 };
}

function securityInsight(ctx: LocalInsightContext): LocalInsight | null {
  const s = ctx.security;
  if (!s) return null;
  const pending = s.totalCves - s.cvesFixed;
  if (pending > 0) {
    return {
      id: 'insight-cves-pending',
      text: `⚠ ${pending} CVE${pending === 1 ? '' : 's'} pending — Run ruflo security scan --depth full`,
      priority: 90,
    };
  }
  if (s.status === 'PENDING') {
    return { id: 'insight-scan-pending', text: '🛡 Security scan pending — Run ruflo security scan --depth full', priority: 70 };
  }
  return null;
}

function gitInsight(ctx: LocalInsightContext): LocalInsight | null {
  const n = ctx.gitUncommittedCount;
  if (n === undefined || n <= GIT_UNCOMMITTED_THRESHOLD) return null;
  return {
    id: 'insight-uncommitted',
    text: `📝 ${n} uncommitted changes — commit or stash before continuing`,
    priority: 50,
  };
}

/**
 * Power-saver mode state — genuinely local (consent + a self-reported flag
 * file, same pattern the rest of this module uses). Sponsored/rate-limited
 * state is deliberately NOT duplicated here — promo.ts's own
 * getSponsoredDowntimeOverride() already preempts rotation entirely for
 * that case (ADR-313), with higher precedence than this slot-based ticker.
 * Two insight sources for the same fact would mean picking which one wins;
 * simpler to just not have two.
 */
function proxyModeInsight(now: Date): LocalInsight | null {
  if (hasConsent('power-saver') && readQuotaLowStatus(now).low) {
    return { id: 'insight-power-saver-active', text: '🔋 Power saver mode active — routing via cognitum-auto', priority: 55 };
  }
  return null;
}

/**
 * ADR-316 — a co-pilot tip from ruflo's Fable Advisor Harness
 * (services/fable-harness.ts, ADR-172). Consent-gated (never surfaces a
 * stale cached tip after the user disables it, even though the cache file
 * itself isn't deleted on disable — this check is what actually enforces
 * "off means off"). Purely a cache read here — no network call, no spend;
 * the real `claude -p` call happens in advisor-tip.ts's
 * refreshAdvisorTipIfStale(), invoked from a detached background process,
 * never from this hot path.
 */
function advisorTipInsight(now: Date): LocalInsight | null {
  if (!hasConsent('advisor-tips')) return null;
  const tip = readAdvisorTip(now);
  if (!tip) return null;
  return { id: 'insight-advisor-tip', text: `🧭 ${tip.headline}`, priority: 45 };
}

/** All candidate insights for this render, unsorted. */
export function computeLocalInsights(ctx: LocalInsightContext): LocalInsight[] {
  const now = ctx.now ?? new Date();
  const candidates = [
    securityInsight(ctx),
    gitInsight(ctx),
    proxyModeInsight(now),
    advisorTipInsight(now),
    flywheelInsight(now),
  ];
  return candidates.filter((i): i is LocalInsight => i !== null);
}

/** Highest-priority insight this render, or null if nothing is actionable. */
export function selectLocalInsight(ctx: LocalInsightContext): LocalInsight | null {
  const candidates = computeLocalInsights(ctx);
  if (candidates.length === 0) return null;
  return candidates.reduce((best, c) => (c.priority > best.priority ? c : best));
}
