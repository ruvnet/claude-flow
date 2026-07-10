/**
 * Funnel message registry and content pipeline — ADR-301 signed content
 * boundaries.
 *
 * Messages are inert data. Regardless of how a message reached this process
 * (in-package today; the signed helper channel later), the renderer treats
 * it as untrusted and enforces, before display:
 *   - schema validation (invalid → dropped, never repaired)
 *   - length bound (≤ 80 display columns → over-length dropped)
 *   - URL host allowlist (exact hosts, in code — lookalikes/IPs dropped)
 *   - expiry
 *   - zero terminal control sequences (any control char, ANSI/OSC/DCS
 *     escape, or bidi override → dropped, not stripped-and-shown)
 *
 * There is no eval path and no styling in the payload: color comes only
 * from the renderer's own fixed styles.
 */

import type { FunnelMessage } from './types.js';

export const MAX_MESSAGE_COLUMNS = 80;

/**
 * Exact-host allowlist (ADR-301). Ships in code, never in the payload.
 * github.com is allowed only under /ruvnet/.
 */
const ALLOWED_URL_HOSTS = new Set([
  'cognitum.one', 'www.cognitum.one', 'docs.cognitum.one',
  // agentics.org — the rUv-authored OSS foundation. Distinct sponsor from
  // cognitum.one; carries its own promotional messages in the rotation.
  'agentics.org', 'www.agentics.org',
]);
const GITHUB_HOST = 'github.com';
const GITHUB_PATH_PREFIX = '/ruvnet/';

/**
 * C0/C1 controls (incl. ESC, so every ANSI/OSC/DCS sequence trips this),
 * DEL, and Unicode bidirectional overrides/isolates.
 */
// eslint-disable-next-line no-control-regex
const FORBIDDEN_CHARS = /[\u0000-\u001f\u007f-\u009f\u202a-\u202e\u2066-\u2069]/;

export function containsForbiddenSequences(text: string): boolean {
  return FORBIDDEN_CHARS.test(text);
}

/** Approximate terminal display width: wide CJK/emoji count 2. */
export function displayWidth(text: string): number {
  let width = 0;
  for (const ch of text) {
    const cp = ch.codePointAt(0) ?? 0;
    if (cp === 0xfe0f || cp === 0x200d) continue; // variation selector / ZWJ
    const wide =
      (cp >= 0x1100 && cp <= 0x115f) ||
      (cp >= 0x2e80 && cp <= 0xa4cf) ||
      (cp >= 0xac00 && cp <= 0xd7a3) ||
      (cp >= 0xf900 && cp <= 0xfaff) ||
      (cp >= 0xff00 && cp <= 0xff60) ||
      (cp >= 0x1f000 && cp <= 0x1faff) ||
      (cp >= 0x20000 && cp <= 0x3fffd);
    width += wide ? 2 : 1;
  }
  return width;
}

export function isAllowedUrl(url: string): boolean {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return false;
  }
  if (parsed.protocol !== 'https:') return false;
  if (ALLOWED_URL_HOSTS.has(parsed.hostname)) return true;
  if (parsed.hostname === GITHUB_HOST && parsed.pathname.startsWith(GITHUB_PATH_PREFIX)) return true;
  return false;
}

/**
 * Full validation gate. Returns true only when every ADR-301 content
 * boundary passes. Failures are silent drops by design — a bad message
 * must never produce a visible error in the statusline.
 */
export function isValidMessage(msg: unknown, now: Date = new Date()): msg is FunnelMessage {
  if (typeof msg !== 'object' || msg === null) return false;
  const m = msg as Record<string, unknown>;
  if (m.schemaVersion !== 1) return false;
  if (typeof m.id !== 'string' || m.id.length === 0 || m.id.length > 64) return false;
  if (m.class !== 'educational' && m.class !== 'promotional') return false;
  if (typeof m.text !== 'string' || m.text.length === 0) return false;
  if (containsForbiddenSequences(m.text)) return false;
  if (displayWidth(m.text) > MAX_MESSAGE_COLUMNS) return false;
  if (m.url !== undefined) {
    if (typeof m.url !== 'string' || !isAllowedUrl(m.url)) return false;
  }
  if (m.expiresAt !== undefined) {
    if (typeof m.expiresAt !== 'string') return false;
    const exp = Date.parse(m.expiresAt);
    if (Number.isNaN(exp) || exp <= now.getTime()) return false;
  }
  return true;
}

/**
 * Curated in-package rotation (reviewed in PR like any code change — ADR-309
 * content approval). Ratio discipline (≥4:1 educational:promotional) is
 * enforced structurally by the scheduler in rotation.ts, not by this list.
 */
export const MESSAGES: FunnelMessage[] = [
  // Educational
  {
    id: 'edu-doctor',
    schemaVersion: 1,
    class: 'educational',
    text: '🩺 npx ruflo doctor --fix diagnoses and repairs common setup issues',
  },
  {
    id: 'edu-memory-search',
    schemaVersion: 1,
    class: 'educational',
    text: '🧠 ruflo memory search --query "..." finds past patterns semantically',
  },
  {
    id: 'edu-hooks-route',
    schemaVersion: 1,
    class: 'educational',
    text: '⚡ ruflo hooks route --task "..." picks the cheapest capable model tier',
  },
  {
    id: 'edu-daemon-workers',
    schemaVersion: 1,
    class: 'educational',
    text: '🛠 ruflo daemon start enables 12 background workers (audit, testgaps, map…)',
  },
  {
    id: 'edu-statusline-cost',
    schemaVersion: 1,
    class: 'educational',
    text: '💡 RUFLO_STATUSLINE_HIDE_COST=1 hides the session-cost segment',
  },
  {
    id: 'edu-completions',
    schemaVersion: 1,
    class: 'educational',
    text: '⌨️  ruflo completions bash|zsh|fish installs shell tab-completion',
  },
  {
    id: 'edu-security-scan',
    schemaVersion: 1,
    class: 'educational',
    text: '🔒 ruflo security scan --depth full audits dependencies and config',
  },
  {
    id: 'edu-funnel-optout',
    schemaVersion: 1,
    class: 'educational',
    text: 'ℹ️  These notices are configurable: ruflo funnel disable turns them off',
  },
  // More ruflo tips + tricks — deepens the educational rotation so the
  // 4:1 ratio doesn't cycle the same 8 tips too often.
  {
    id: 'edu-swarm-init',
    schemaVersion: 1,
    class: 'educational',
    text: '🐝 ruflo swarm init --topology hierarchical spawns anti-drift agent teams',
  },
  {
    id: 'edu-hive-mind',
    schemaVersion: 1,
    class: 'educational',
    text: '👑 ruflo hive-mind spawn — queen-led coordination with Byzantine consensus',
  },
  {
    id: 'edu-agent-spawn',
    schemaVersion: 1,
    class: 'educational',
    text: '🤖 ruflo agent spawn -t coder --name mycoder starts a specialized worker',
  },
  {
    id: 'edu-session-restore',
    schemaVersion: 1,
    class: 'educational',
    text: '💾 ruflo session restore --latest brings back your last session state',
  },
  {
    id: 'edu-neural-train',
    schemaVersion: 1,
    class: 'educational',
    text: '🧬 ruflo neural train --pattern-type coordination learns from prior runs',
  },
  {
    id: 'edu-hooks-list',
    schemaVersion: 1,
    class: 'educational',
    text: '🪝 ruflo hooks list shows all 17 hooks + 12 background workers available',
  },
  {
    id: 'edu-plugin-install',
    schemaVersion: 1,
    class: 'educational',
    text: '🔌 ruflo plugins install <name> — 20+ plugins for extended capabilities',
  },
  {
    id: 'edu-status-watch',
    schemaVersion: 1,
    class: 'educational',
    text: '📊 ruflo status watch — real-time system + swarm health dashboard',
  },
  // Promotional (Cognitum) — capped by the scheduler at ≤1 in 5 rotations
  {
    id: 'promo-meta-llm-routing',
    schemaVersion: 1,
    class: 'promotional',
    text: '✨ Unlock Meta LLM routing → cognitum.one',
    url: 'https://cognitum.one',
  },
  {
    id: 'promo-one-endpoint',
    schemaVersion: 1,
    class: 'promotional',
    text: '⚡ Run Claude + GPT + Gemini behind one local endpoint → cognitum.one',
    url: 'https://cognitum.one',
  },
  {
    id: 'promo-cognitum-governance',
    schemaVersion: 1,
    class: 'promotional',
    text: '🔐 Enterprise agent governance and policy → cognitum.one',
    url: 'https://cognitum.one',
  },
  {
    id: 'promo-cognitum-credits',
    schemaVersion: 1,
    class: 'promotional',
    text: '💳 Bring your own key or use Cognitum credits → cognitum.one',
    url: 'https://cognitum.one',
  },
  // Promotional (agentics.org — the OSS foundation, distinct sponsor)
  {
    id: 'promo-agentics-foundation',
    schemaVersion: 1,
    class: 'promotional',
    text: '🌱 Support the open agent stack → agentics.org',
    url: 'https://agentics.org',
  },
  {
    id: 'promo-agentics-docs',
    schemaVersion: 1,
    class: 'promotional',
    text: '📚 Open specs, RFCs and governance for OSS AI → agentics.org',
    url: 'https://agentics.org',
  },
  {
    id: 'promo-agentics-community',
    schemaVersion: 1,
    class: 'promotional',
    text: '🏛 Join the open agent foundation → agentics.org',
    url: 'https://agentics.org',
  },
];

/** Messages that survive every content boundary right now. */
export function eligibleMessages(now: Date = new Date()): FunnelMessage[] {
  return MESSAGES.filter((m) => isValidMessage(m, now));
}

/**
 * Merge the remote (cached) message pool with the in-code fallback pool.
 * The remote pool is authoritative when populated; the in-code pool
 * covers cold starts and API-down periods. Deduplication is by `id` —
 * remote wins over in-code for a given id so admins can override without
 * a client release.
 */
export function eligibleMessagesFromPools(
  inCodePool: readonly FunnelMessage[],
  remotePool: readonly FunnelMessage[],
  now: Date = new Date(),
): FunnelMessage[] {
  const seen = new Set<string>();
  const out: FunnelMessage[] = [];
  for (const m of remotePool) {
    if (!isValidMessage(m, now)) continue;
    if (seen.has(m.id)) continue;
    seen.add(m.id);
    out.push(m);
  }
  for (const m of inCodePool) {
    if (!isValidMessage(m, now)) continue;
    if (seen.has(m.id)) continue;
    seen.add(m.id);
    out.push(m);
  }
  return out;
}
