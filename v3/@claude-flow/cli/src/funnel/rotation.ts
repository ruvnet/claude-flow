/**
 * Rotation scheduler — ADR-301 content ratio, enforced structurally.
 *
 *   - Educational: at least 4 of every 5 rotation slots.
 *   - Promotional: at most 1 of every 5 slots (slot % 5 === 4), and only
 *     when no promotion has shown in the last 30 minutes.
 *   - Deterministic: selection is a pure function of (time slot, registry,
 *     last-promo state) — no Math.random, so renders are reproducible and
 *     the statusline cache can't skew the ratio.
 */

import type { FunnelMessage } from './types.js';
import { MESSAGES, eligibleMessagesFromPools } from './messages.js';
import { getRemoteMessages, refreshRemoteMessages } from './message-transport.js';
import { readStateJson, writeStateJson } from './state.js';
import { recordFunnelEvent } from './events.js';

const ROTATION_FILE = 'funnel-rotation.json';

/** One rotation slot — ADR-301 allows 15–30s; 20s sits inside the band. */
export const ROTATION_SLOT_MS = 20_000;
/** The same promotion appears at most once every 30 minutes (ADR-301). */
export const PROMO_REPEAT_CAP_MS = 30 * 60 * 1000;
/** 1 promotional slot per 5 (ADR-301: ≤ 1 in 5 rotations). */
export const PROMO_SLOT_MODULO = 5;

interface RotationState {
  lastPromoAt?: string;
  lastPromoId?: string;
}

export function selectMessage(now: Date = new Date(), release: string = 'unknown'): FunnelMessage | null {
  // Kick a background refresh — never awaited, never blocks render. The
  // remote pool becomes visible on subsequent selects once cached.
  void refreshRemoteMessages();
  // Merge: remote pool authoritative, in-code pool fallback (by id).
  const pool = eligibleMessagesFromPools(MESSAGES, getRemoteMessages(), now);
  const educational = pool.filter((m) => m.class === 'educational');
  const promotional = pool.filter((m) => m.class === 'promotional');
  if (educational.length === 0 && promotional.length === 0) return null;

  const slot = Math.floor(now.getTime() / ROTATION_SLOT_MS);
  const promoSlot = slot % PROMO_SLOT_MODULO === PROMO_SLOT_MODULO - 1;

  let selected: FunnelMessage | null = null;
  if (promoSlot && promotional.length > 0 && promoCapClear(now)) {
    selected = promotional[Math.floor(slot / PROMO_SLOT_MODULO) % promotional.length];
    recordPromoShown(selected, now);
  } else if (educational.length > 0) {
    selected = educational[slot % educational.length];
  }

  // Fire an impression event for whichever message was selected. Consent-gated
  // (recordFunnelEvent no-ops without telemetry consent). Idempotency across
  // renders in the same slot is handled by the same-slot deduplication in
  // the events transport — we don't try to dedupe here because the slot
  // math already returns the same id for the same slot, giving downstream
  // aggregation a per-slot boolean.
  if (selected) {
    recordFunnelEvent('promo_impression', 'statusline', release, {
      now, messageId: selected.id,
    });
  }
  return selected;
}

function promoCapClear(now: Date): boolean {
  const state = readStateJson<RotationState>(ROTATION_FILE);
  if (!state?.lastPromoAt) return true;
  const last = Date.parse(state.lastPromoAt);
  if (Number.isNaN(last)) return true;
  return now.getTime() - last >= PROMO_REPEAT_CAP_MS;
}

function recordPromoShown(msg: FunnelMessage, now: Date): void {
  writeStateJson(ROTATION_FILE, {
    lastPromoAt: now.toISOString(),
    lastPromoId: msg.id,
  } satisfies RotationState);
}
