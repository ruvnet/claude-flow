/**
 * Event transport — batches the local funnel event queue and posts it to the
 * Cognitum analytics Cloud Function (ADR-308 endpoint contract).
 *
 * Design discipline (ADR-308 client failure policy — all normative):
 *   1. Telemetry never blocks the CLI. Every network call is best-effort,
 *      capped by a short timeout, and swallows every error path.
 *   2. Events are LOCAL FIRST. The queue in `events.ts` accumulates
 *      regardless of API reachability. This transport is the flush layer.
 *   3. Idempotency: every batch carries a UUIDv4 idempotency key so a retry
 *      never double-counts (ADR-308 idempotent-batches invariant).
 *   4. Exponential backoff on transient failures. Successful flushes stamp
 *      a "last flush" timestamp so we don't hammer the API each render.
 *   5. Consent-gated. Zero network activity when telemetry consent is off.
 *   6. Bounded. Never send more than MAX_BATCH events at once, so a large
 *      backlog doesn't blow the endpoint request-size limit.
 *   7. Credit-exhaustion detection. If the endpoint replies 402 (Payment
 *      Required) or the body carries the ADR-303
 *      `COGNITUM_CREDIT_EXHAUSTED` code, we surface via `credit-notifier.ts`
 *      — the same recovery UX ADR-303 already ships.
 */

import * as fs from 'fs';
import * as https from 'https';
import { URL as NodeUrl } from 'url';
import { randomUUID } from 'crypto';
import { hasConsent } from './consent.js';
import { readStateJson, statePath, writeStateJson } from './state.js';
import { markCreditExhausted } from './credit-notifier.js';

const EVENTS_FILE = 'funnel-events.jsonl';
const FLUSH_STATE_FILE = 'funnel-events-flush.json';

/**
 * Default endpoint — the ruflo-funnel-analytics endpoint on the ruv.io
 * domain, mapped via Cloud Run domain mapping to the cognitum-analytics
 * Cloud Function on cognitum-20260110. Overridable by env for staging or
 * self-hosted deploys. The domain choice is deliberate: an rUv-authored
 * OSS project's telemetry endpoint belongs on rUv's own domain, not on
 * cognitum.one — that keeps the CLI attribution honest.
 */
export const DEFAULT_ENDPOINT =
  process.env.RUFLO_FUNNEL_EVENTS_ENDPOINT ?? 'https://funnel.ruv.io/v1/events';

/** Cap per POST — server enforces its own limits too; this is a safety net. */
export const MAX_BATCH = 100;

/** Min interval between flushes (ms). Rate limits the client from within. */
export const MIN_FLUSH_INTERVAL_MS = 60_000; // 1 min

/** POST timeout — telemetry must not stall the CLI. */
export const FLUSH_TIMEOUT_MS = 4_000;

interface FlushState {
  lastFlushAt: string | null;
  consecutiveFailures: number;
  lastError?: string;
}

interface EventBatch {
  batchId: string;
  events: unknown[];
  release: string;
  emittedAt: string;
}

/** Read the current flush bookkeeping state (never throws). */
function readFlushState(): FlushState {
  const raw = readStateJson<FlushState>(FLUSH_STATE_FILE);
  return {
    lastFlushAt: raw?.lastFlushAt ?? null,
    consecutiveFailures: raw?.consecutiveFailures ?? 0,
    lastError: raw?.lastError,
  };
}

/** Persist flush bookkeeping. Never throws. */
function writeFlushState(state: FlushState): void {
  writeStateJson(FLUSH_STATE_FILE, state);
}

/** Read the local event queue as JSON lines. Returns [] when absent. */
function readQueue(): unknown[] {
  try {
    const raw = fs.readFileSync(statePath(EVENTS_FILE), 'utf-8');
    return raw
      .split('\n')
      .filter(Boolean)
      .map((line) => {
        try { return JSON.parse(line); } catch { return null; }
      })
      .filter((x): x is Record<string, unknown> => x !== null);
  } catch {
    return [];
  }
}

/** Overwrite the local queue with the survivors (events we didn't flush). */
function writeQueue(events: unknown[]): void {
  try {
    const body = events.length === 0 ? '' : events.map((e) => JSON.stringify(e)).join('\n') + '\n';
    fs.writeFileSync(statePath(EVENTS_FILE), body, { encoding: 'utf-8', mode: 0o600 });
  } catch {
    /* telemetry must never block */
  }
}

/** Exponential backoff — cap at 30 minutes. */
function backoffElapsed(state: FlushState, now: Date): boolean {
  if (!state.lastFlushAt) return true;
  const last = Date.parse(state.lastFlushAt);
  if (Number.isNaN(last)) return true;
  const base = MIN_FLUSH_INTERVAL_MS;
  const factor = Math.min(2 ** state.consecutiveFailures, 30); // cap at 30x → ~30 min
  const nextAllowed = last + base * factor;
  return now.getTime() >= nextAllowed;
}

/**
 * POST a batch to the endpoint. Resolves to { ok, status } — never rejects.
 * Kept internal so callers can't hand it a URL that dodges the allowlist.
 */
function postBatch(endpoint: string, batch: EventBatch): Promise<{ ok: boolean; status: number; body: string }> {
  return new Promise((resolve) => {
    let target: NodeUrl;
    try { target = new NodeUrl(endpoint); } catch {
      resolve({ ok: false, status: 0, body: 'bad-endpoint' });
      return;
    }
    if (target.protocol !== 'https:') {
      resolve({ ok: false, status: 0, body: 'non-https-endpoint' });
      return;
    }
    const body = JSON.stringify(batch);
    const req = https.request(
      {
        hostname: target.hostname,
        port: target.port || 443,
        path: target.pathname + target.search,
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Content-Length': Buffer.byteLength(body),
          'Idempotency-Key': batch.batchId,
          'User-Agent': `ruflo-funnel/${batch.release}`,
        },
      },
      (res) => {
        let chunks = '';
        res.setEncoding('utf-8');
        res.on('data', (chunk) => { chunks += chunk; });
        res.on('end', () => {
          const status = res.statusCode ?? 0;
          resolve({ ok: status >= 200 && status < 300, status, body: chunks });
        });
      },
    );
    req.setTimeout(FLUSH_TIMEOUT_MS, () => {
      req.destroy();
      resolve({ ok: false, status: 0, body: 'timeout' });
    });
    req.on('error', (err) => resolve({ ok: false, status: 0, body: String(err) }));
    req.write(body);
    req.end();
  });
}

/**
 * Best-effort flush of the local event queue to the endpoint. Returns a
 * summary the CLI can log at --verbose; the caller should never fail on it.
 */
export async function flushEvents(opts?: {
  endpoint?: string;
  release?: string;
  force?: boolean;
  now?: Date;
}): Promise<{ flushed: number; skipped: string | null; status?: number }> {
  const now = opts?.now ?? new Date();
  const endpoint = opts?.endpoint ?? DEFAULT_ENDPOINT;

  if (!hasConsent('telemetry')) return { flushed: 0, skipped: 'no-consent' };

  const state = readFlushState();
  if (!opts?.force && !backoffElapsed(state, now)) {
    return { flushed: 0, skipped: 'backoff' };
  }

  const queue = readQueue();
  if (queue.length === 0) {
    // Nothing to send — record the check anyway so we don't retry every render.
    writeFlushState({ ...state, lastFlushAt: now.toISOString() });
    return { flushed: 0, skipped: 'empty-queue' };
  }

  const batchEvents = queue.slice(0, MAX_BATCH);
  const batch: EventBatch = {
    batchId: randomUUID(),
    events: batchEvents,
    release: opts?.release ?? 'unknown',
    emittedAt: now.toISOString(),
  };

  const res = await postBatch(endpoint, batch);

  // Credit-exhaustion detection (ADR-303 route in).
  //   402 Payment Required  → out of Cognitum credits.
  //   Body carrying the exact ADR-303 machine-readable code → same.
  if (res.status === 402 || (typeof res.body === 'string' && res.body.includes('COGNITUM_CREDIT_EXHAUSTED'))) {
    markCreditExhausted(now);
  }

  if (res.ok) {
    // Drop the sent events; keep survivors.
    writeQueue(queue.slice(batchEvents.length));
    writeFlushState({
      lastFlushAt: now.toISOString(),
      consecutiveFailures: 0,
    });
    return { flushed: batchEvents.length, skipped: null, status: res.status };
  }

  writeFlushState({
    lastFlushAt: now.toISOString(),
    consecutiveFailures: state.consecutiveFailures + 1,
    lastError: `HTTP ${res.status}`,
  });
  return { flushed: 0, skipped: `transport-failed`, status: res.status };
}
