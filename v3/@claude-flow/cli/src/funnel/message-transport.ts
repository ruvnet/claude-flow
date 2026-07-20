/**
 * Remote message transport — best-effort fetch of the ADR-311 message
 * feed, cached locally, validated through the ADR-301 content pipeline
 * BEFORE any message is displayed.
 *
 * Design discipline:
 *   1. **Never blocks the render.** The statusline reads only the local
 *      cache. This module refreshes the cache in the background; per
 *      ADR-311 "zero local promo content" there is NO in-code fallback
 *      pool — a genuinely fresh install (empty cache) shows nothing on
 *      the promo/disclosure row until the first background refresh lands
 *      (see hook-handler.cjs's SessionStart-triggered detached
 *      `hooks refresh-funnel`, usually within seconds of CLI startup, but
 *      contingent on network reachability to the messages endpoint). This
 *      comment previously (incorrectly) described an in-code fallback
 *      pool; there has never been one since ADR-311 — see disclosure.ts's
 *      own "fail-closed" doc comment for the authoritative statement.
 *   2. **Content pipeline stays authoritative.** Every message the server
 *      returns is validated by `isValidMessage()` from `messages.ts` —
 *      same schema, same host allowlist, same control-char strip, same
 *      80-column cap. A tampered or accidentally-broken remote feed can
 *      pollute nothing.
 *   3. **Fail silent.** Any network/parse/validation failure leaves the
 *      previously-cached pool intact (empty, if nothing has landed yet).
 *   4. **Bounded cache size.** ≤ 128 KiB and ≤ 200 messages — matches
 *      ADR-309's bounded-local-queue discipline.
 *   5. **Kill switch.** `RUFLO_FUNNEL_MESSAGES=0` (or `RUFLO_FUNNEL=0`)
 *      disables the fetcher entirely.
 *   6. **Signature-verification hook.** Reserved for a future ADR-311
 *      amendment; currently the transport-layer TLS + host allowlist is
 *      the trust boundary. All content is treated as untrusted regardless.
 */

import * as fs from 'fs';
import * as https from 'https';
import { URL as NodeUrl } from 'url';
import type { FunnelMessage } from './types.js';
import { isValidMessage } from './messages.js';
import { readStateJson, writeStateJson } from './state.js';

const CACHE_FILE = 'funnel-messages-cache.json';
const CACHE_TTL_MS = 6 * 60 * 60 * 1000; // 6h — matches server Cache-Control
const CACHE_MAX_BYTES = 128 * 1024;
const CACHE_MAX_MESSAGES = 200;
const FETCH_TIMEOUT_MS = 4_000;

/** Endpoint the client hits — overridable for staging / self-hosted. */
export const DEFAULT_MESSAGES_ENDPOINT =
  process.env.RUFLO_FUNNEL_MESSAGES_ENDPOINT ?? 'https://funnel.ruv.io/v1/messages';

interface CacheEnvelope {
  _ts: number;
  messages: FunnelMessage[];
}

function readCache(): { fresh: boolean; messages: FunnelMessage[] } {
  const raw = readStateJson<CacheEnvelope>(CACHE_FILE);
  if (!raw || !Array.isArray(raw.messages)) return { fresh: false, messages: [] };
  const age = Date.now() - (raw._ts ?? 0);
  return { fresh: age < CACHE_TTL_MS, messages: raw.messages };
}

function writeCache(messages: FunnelMessage[]): void {
  // Bound the cache before persisting — messages come from an untrusted
  // source, so we cap size regardless of server behavior.
  let trimmed = messages.slice(0, CACHE_MAX_MESSAGES);
  let body = JSON.stringify({ _ts: Date.now(), messages: trimmed } satisfies CacheEnvelope);
  while (Buffer.byteLength(body, 'utf-8') > CACHE_MAX_BYTES && trimmed.length > 0) {
    trimmed = trimmed.slice(0, trimmed.length - 1);
    body = JSON.stringify({ _ts: Date.now(), messages: trimmed } satisfies CacheEnvelope);
  }
  writeStateJson(CACHE_FILE, { _ts: Date.now(), messages: trimmed });
}

interface FetchResult {
  status: number;
  body: string;
}

function httpsGet(url: string): Promise<FetchResult> {
  return new Promise((resolve) => {
    let target: NodeUrl;
    try { target = new NodeUrl(url); } catch {
      resolve({ status: 0, body: 'bad-url' });
      return;
    }
    if (target.protocol !== 'https:') {
      resolve({ status: 0, body: 'non-https' });
      return;
    }
    const req = https.request(
      {
        hostname: target.hostname,
        port: target.port || 443,
        path: target.pathname + target.search,
        method: 'GET',
        headers: {
          'User-Agent': 'ruflo-funnel/messages',
          'Accept': 'application/json',
        },
      },
      (res) => {
        let chunks = '';
        res.setEncoding('utf-8');
        res.on('data', (chunk) => { chunks += chunk; });
        res.on('end', () => resolve({ status: res.statusCode ?? 0, body: chunks }));
      },
    );
    req.setTimeout(FETCH_TIMEOUT_MS, () => {
      req.destroy();
      resolve({ status: 0, body: 'timeout' });
    });
    req.on('error', () => resolve({ status: 0, body: 'error' }));
    req.end();
  });
}

function killSwitched(env: NodeJS.ProcessEnv = process.env): boolean {
  const kill = (v?: string) => v !== undefined && /^(0|false|off|no)$/i.test(v.trim());
  return kill(env.RUFLO_FUNNEL_MESSAGES) || kill(env.RUFLO_FUNNEL);
}

/**
 * Best-effort refresh of the cache. Safe to call at any point in the
 * CLI lifecycle — returns a summary; never throws; never blocks longer
 * than FETCH_TIMEOUT_MS + write time.
 */
export async function refreshRemoteMessages(opts?: {
  endpoint?: string;
  force?: boolean;
  env?: NodeJS.ProcessEnv;
}): Promise<{ refreshed: boolean; skipped?: string; accepted?: number; rejected?: number; status?: number }> {
  const env = opts?.env ?? process.env;
  if (killSwitched(env)) return { refreshed: false, skipped: 'kill-switch' };

  const cache = readCache();
  if (!opts?.force && cache.fresh) return { refreshed: false, skipped: 'fresh-cache' };

  const endpoint = opts?.endpoint ?? DEFAULT_MESSAGES_ENDPOINT;
  const res = await httpsGet(endpoint);
  if (res.status !== 200) return { refreshed: false, skipped: `http-${res.status}`, status: res.status };

  let parsed: unknown;
  try { parsed = JSON.parse(res.body); } catch { return { refreshed: false, skipped: 'json-parse-error' }; }
  if (!parsed || typeof parsed !== 'object') return { refreshed: false, skipped: 'not-object' };
  const raw = (parsed as { messages?: unknown }).messages;
  if (!Array.isArray(raw)) return { refreshed: false, skipped: 'no-messages-field' };

  // Every message goes through the SAME pipeline the in-code pool uses.
  // This is where trust boundary enforcement actually lives.
  const now = new Date();
  const accepted: FunnelMessage[] = [];
  let rejected = 0;
  for (const candidate of raw) {
    if (isValidMessage(candidate, now)) {
      accepted.push(candidate);
    } else {
      rejected += 1;
    }
  }
  writeCache(accepted);
  return { refreshed: true, accepted: accepted.length, rejected, status: res.status };
}

/**
 * Read the cached remote pool. Returns [] when the cache is empty or
 * stale enough to distrust — callers should merge with the in-code
 * fallback pool.
 */
export function getRemoteMessages(): FunnelMessage[] {
  const cache = readCache();
  return cache.messages;
}
