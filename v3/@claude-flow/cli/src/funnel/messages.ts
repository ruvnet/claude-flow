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
 * Local promo/message content: INTENTIONALLY EMPTY (ADR-311 amendment).
 *
 * All rotation content (educational tips, promotional messages, and the
 * disclosure notice) is served exclusively from the remote message feed
 * (GET /v1/messages -> message-transport.ts -> Firestore). Zero message
 * text or URLs ship in the CLI package.
 *
 * Fail-closed by design: if the remote feed is unreachable (network down,
 * cert issue, server outage) and no prior successful fetch has populated
 * the local cache, the rotation has nothing to show and the promo row
 * simply does not render that cycle. There is no local content to fall
 * back to -- this is a deliberate choice, not an oversight.
 */
export const MESSAGES: FunnelMessage[] = [];

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
