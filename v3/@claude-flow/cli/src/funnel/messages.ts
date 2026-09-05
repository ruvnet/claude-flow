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
  if (m.class !== 'educational' && m.class !== 'promotional' && m.class !== 'disclosure') return false;
  if (typeof m.text !== 'string' || m.text.length === 0) return false;
  if (containsForbiddenSequences(m.text)) return false;
  if (displayWidth(m.text) > MAX_MESSAGE_COLUMNS) return false;
  // Disclosure messages MUST carry the exact ADR-301 manage-instruction tail
  // — losing that on a truncated/malformed remote message is an invariant
  // violation, not a cosmetic issue. Never repaired; dropped instead.
  if (m.class === 'disclosure' && !m.text.includes(' · manage: ruflo settings')) return false;
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
 * Local promo/message content: cold-start seed (ADR-311 amendment
 * revisited, issue #2787).
 *
 * The remote pool is authoritative — `eligibleMessagesFromPools` in
 * `rotation.ts` merges by id with remote winning — but on new installs
 * the remote fetch races the very first render and the promo row shows
 * NOTHING until the pool has been fetched at least once. The disclosure
 * gate can't unlock either, so several 20-second slots go by blank.
 *
 * The fix is a small local seed of educational tips, one bootstrap
 * disclosure, and a single sponsor promo, all validating cleanly through
 * `isValidMessage` and using only URLs on the exact-host allowlist. Each
 * carries a stable id so the remote pool can override or retire any of
 * them without a CLI release.
 */
export const MESSAGES: FunnelMessage[] = [
  {
    schemaVersion: 1,
    id: 'local.disclosure.v1',
    class: 'disclosure',
    text: 'Ruflo shows occasional tips and sponsor notes here · manage: ruflo settings',
  },
  {
    schemaVersion: 1,
    id: 'local.edu.status-watch',
    class: 'educational',
    text: '📊 ruflo status watch — real-time system + swarm health dashboard',
    url: 'https://cognitum.one/docs/statusline',
  },
  {
    schemaVersion: 1,
    id: 'local.edu.memory-search',
    class: 'educational',
    text: '🧠 ruflo memory search — semantic search over your project decisions',
    url: 'https://cognitum.one/docs/memory',
  },
  {
    schemaVersion: 1,
    id: 'local.edu.swarm-init',
    class: 'educational',
    text: '🐝 ruflo swarm init — hierarchical anti-drift multi-agent coordination',
    url: 'https://cognitum.one/docs/swarm',
  },
  {
    schemaVersion: 1,
    id: 'local.edu.security-scan',
    class: 'educational',
    text: '🔒 ruflo security scan --depth deep — audits dependencies and config',
    url: 'https://cognitum.one/docs/security',
  },
  {
    schemaVersion: 1,
    id: 'local.edu.doctor',
    class: 'educational',
    text: '🩺 ruflo doctor --fix — diagnose and auto-repair install issues',
    url: 'https://cognitum.one/docs/doctor',
  },
  {
    schemaVersion: 1,
    id: 'local.edu.hooks-route',
    class: 'educational',
    text: '🪝 ruflo hooks route — 3-tier model routing cuts token cost 30–75%',
    url: 'https://cognitum.one/docs/hooks',
  },
  {
    schemaVersion: 1,
    id: 'local.edu.adr-index',
    class: 'educational',
    text: '📚 ruflo adr index — every architecture decision indexed and searchable',
    url: 'https://github.com/ruvnet/ruflo/tree/main/docs/adr',
  },
  {
    schemaVersion: 1,
    id: 'local.edu.agent-spawn',
    class: 'educational',
    text: '⚡ ruflo agent spawn -t coder — background agents with anti-drift topology',
    url: 'https://cognitum.one/docs/agents',
  },
  {
    schemaVersion: 1,
    id: 'local.promo.cognitum',
    class: 'promotional',
    text: '✨ Cognitum • sponsored capacity for community jobs · manage: ruflo settings',
    url: 'https://cognitum.one',
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
