/**
 * Funnel events — ADR-305 attribution / ADR-309 constrained schema.
 *
 * LOCAL-ONLY by design: this module performs no network I/O. Events are
 * appended to a bounded local queue only when the telemetry consent domain
 * is granted (ADR-302). Server-side ingestion (POST /v1/events, ADR-308)
 * is a separate opt-in transport that does not exist in this build — until
 * it does, the queue is simply a bounded local record the user can inspect
 * and delete.
 *
 * Constraints enforced here, permanently (ADR-309): closed event set, daily
 * timestamp buckets (never full timestamps), no raw prompts/commands/paths/
 * repo names — the schema has no field that could carry them.
 */

import * as fs from 'fs';
import { randomUUID } from 'crypto';
import type { FunnelEvent, FunnelEventName, FunnelSurface } from './types.js';
import { hasConsent } from './consent.js';
import { deleteStateFile, funnelStateDir, readStateJson, statePath, writeStateJson } from './state.js';

const EVENTS_FILE = 'funnel-events.jsonl';
const FUNNEL_ID_FILE = 'funnel-id.json';

/** Bounded queue: ≤ 1000 events / ≤ 256 KiB — telemetry never grows unbounded. */
const MAX_QUEUE_BYTES = 256 * 1024;
const MAX_QUEUE_EVENTS = 1000;

const EVENT_NAMES: readonly FunnelEventName[] = [
  'disclosure_shown',
  'funnel_disabled',
  'signup_opened',
  'account_created',
  'proxy_activated',
  'promo_impression',
  'promo_open',
  'sponsor_mode_enabled',
  'sponsor_mode_disabled',
  'sponsor_capacity_exhausted',
  'power_saver_enabled',
  'power_saver_disabled',
  'toggle_cooldown_blocked',
  'training_share_enabled',
  'training_share_disabled',
  'advisor_tip_enabled',
  'advisor_tip_disabled',
];
const SURFACES: readonly FunnelSurface[] = ['statusline', 'init', 'credit_exhaustion'];

interface FunnelIdRecord {
  id: string;
  createdAt: string;
}

/** Rotate the pseudonymous ID every 90 days (ADR-305). */
const FUNNEL_ID_TTL_MS = 90 * 24 * 60 * 60 * 1000;

/**
 * Lazily created pseudonymous funnel ID — random UUID, derived from nothing
 * (no hardware, account, email, or path). Exists only when attribution
 * consent (telemetry domain) is granted; deleted on opt-out.
 */
export function getFunnelId(now: Date = new Date()): string | null {
  if (!hasConsent('telemetry')) return null;
  const existing = readStateJson<FunnelIdRecord>(FUNNEL_ID_FILE);
  if (existing?.id) {
    const created = Date.parse(existing.createdAt);
    if (!Number.isNaN(created) && now.getTime() - created < FUNNEL_ID_TTL_MS) return existing.id;
  }
  const record: FunnelIdRecord = { id: randomUUID(), createdAt: now.toISOString() };
  writeStateJson(FUNNEL_ID_FILE, record);
  return record.id;
}

/** Opt-out: stop emission, delete the ID and the local queue (ADR-305). */
export function deleteFunnelData(): void {
  deleteStateFile(FUNNEL_ID_FILE);
  deleteStateFile(EVENTS_FILE);
}

/**
 * Most recent local record of `event`, as a daily bucket (`YYYY-MM-DD`) —
 * events never carry a full timestamp (ADR-309). Returns null when nothing
 * is recorded, which is also what you get with telemetry consent off (the
 * queue is never written at all in that case) — this can't distinguish
 * "never happened" from "not being recorded," by design.
 */
export function lastRecordedEvent(event: FunnelEventName): string | null {
  try {
    const raw = fs.readFileSync(statePath(EVENTS_FILE), 'utf-8');
    const lines = raw.split('\n').filter(Boolean);
    for (let i = lines.length - 1; i >= 0; i--) {
      const parsed = JSON.parse(lines[i]) as FunnelEvent;
      if (parsed.event === event) return parsed.timestampBucket;
    }
    return null;
  } catch {
    return null;
  }
}

function dailyBucket(now: Date): string {
  return now.toISOString().slice(0, 10);
}

/**
 * Record a funnel event to the local queue. No-op (returns false) when
 * telemetry consent is absent — consent-off means zero funnel records.
 * `messageId` is only carried for promo_impression / promo_open events; on
 * every other event it is dropped so the schema stays clean.
 */
export function recordFunnelEvent(
  event: FunnelEventName,
  surface: FunnelSurface,
  release: string,
  optsOrNow: Date | { now?: Date; messageId?: string } = new Date(),
): boolean {
  if (!EVENT_NAMES.includes(event) || !SURFACES.includes(surface)) return false;
  if (!hasConsent('telemetry')) return false;
  const now = optsOrNow instanceof Date ? optsOrNow : (optsOrNow.now ?? new Date());
  const messageId = optsOrNow instanceof Date ? undefined : optsOrNow.messageId;
  const payload: FunnelEvent = {
    schemaVersion: 1,
    event,
    surface,
    release,
    timestampBucket: dailyBucket(now),
  };
  const id = getFunnelId(now);
  if (id) payload.pseudonymousId = id;
  // messageId is only carried on promo events; validated + length-capped so
  // the schema stays predictable.
  if (messageId && (event === 'promo_impression' || event === 'promo_open')) {
    if (typeof messageId === 'string' && messageId.length > 0 && messageId.length <= 64) {
      payload.messageId = messageId;
    }
  }
  try {
    fs.mkdirSync(funnelStateDir(), { recursive: true, mode: 0o700 });
    const file = statePath(EVENTS_FILE);
    let existing = '';
    try {
      existing = fs.readFileSync(file, 'utf-8');
    } catch {
      // first event
    }
    const lines = existing ? existing.split('\n').filter(Boolean) : [];
    lines.push(JSON.stringify(payload));
    let out = lines.slice(-MAX_QUEUE_EVENTS).join('\n') + '\n';
    while (Buffer.byteLength(out, 'utf-8') > MAX_QUEUE_BYTES) {
      const trimmed = out.split('\n').filter(Boolean);
      trimmed.shift();
      out = trimmed.join('\n') + '\n';
    }
    fs.writeFileSync(file, out, { encoding: 'utf-8', mode: 0o600 });
    return true;
  } catch {
    // Telemetry must never block or break the CLI (ADR-308 failure policy).
    return false;
  }
}
