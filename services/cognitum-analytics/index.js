/**
 * Cognitum funnel-analytics Cloud Function (v1) — reference implementation
 * for the client transport shipped in v3/@claude-flow/cli/src/funnel/event-transport.ts.
 *
 * Endpoint: POST /v1/events
 *
 * Contract (from ADR-308):
 *   - Idempotency-Key header REQUIRED — same key = same batch, at-least-once safe.
 *   - Closed event vocabulary — unknown event names are dropped, batch still 200s.
 *   - Rate-limits documented in headers.
 *   - Failure mode: server outage = client keeps queue and retries with backoff.
 *
 * Storage discipline (ADR-309):
 *   - Raw events retained ≤ 90 days.
 *   - Aggregates keyed by (surface, event, timestampBucket, release).
 *   - No PII fields — the schema doesn't carry any.
 *
 * Credit-exhaustion surface:
 *   - When the caller's tenant has hit their credit ceiling we reply
 *     402 Payment Required with body `{ error: 'COGNITUM_CREDIT_EXHAUSTED' }`.
 *     The client picks this up via markCreditExhausted() and surfaces it
 *     to the user through the ADR-303 recovery UX.
 *
 * Local dev:
 *   npm start                       # runs functions-framework on :8080
 *   npm run test:local              # posts a sample batch
 *
 * Deploy:
 *   ./deploy.sh                     # see deploy.sh — DOES NOT run automatically
 */
const { Firestore } = require('@google-cloud/firestore');
const functions = require('@google-cloud/functions-framework');

const FIRESTORE_COLLECTION = process.env.FIRESTORE_COLLECTION || 'funnel_events';
const AGG_COLLECTION = process.env.AGG_COLLECTION || 'funnel_aggregates';
const CREDIT_CEILING_PER_DAY = parseInt(process.env.CREDIT_CEILING_PER_DAY || '1000000', 10);

const KNOWN_EVENTS = new Set([
  'disclosure_shown',
  'funnel_disabled',
  'signup_opened',
  'account_created',
  'proxy_activated',
]);
const KNOWN_SURFACES = new Set(['statusline', 'init', 'credit_exhaustion']);

const firestore = new Firestore();

function validEvent(e) {
  return (
    e &&
    typeof e === 'object' &&
    e.schemaVersion === 1 &&
    typeof e.event === 'string' &&
    KNOWN_EVENTS.has(e.event) &&
    typeof e.surface === 'string' &&
    KNOWN_SURFACES.has(e.surface) &&
    typeof e.release === 'string' &&
    e.release.length > 0 &&
    e.release.length < 64 &&
    typeof e.timestampBucket === 'string' &&
    /^\d{4}-\d{2}-\d{2}$/.test(e.timestampBucket)
  );
}

async function checkCreditBudget(tenant, now) {
  // Simple per-tenant per-day cap. A real deployment would swap this for
  // a tenant-aware ledger; keeping it minimal in the reference impl.
  const dayKey = now.toISOString().slice(0, 10);
  const ref = firestore.collection('funnel_credit').doc(`${tenant}_${dayKey}`);
  const snap = await ref.get();
  return (snap.exists ? snap.data().count : 0) < CREDIT_CEILING_PER_DAY;
}

async function bumpCreditCounter(tenant, now, count) {
  const dayKey = now.toISOString().slice(0, 10);
  const ref = firestore.collection('funnel_credit').doc(`${tenant}_${dayKey}`);
  await firestore.runTransaction(async (tx) => {
    const snap = await tx.get(ref);
    const current = snap.exists ? snap.data().count : 0;
    tx.set(ref, { count: current + count, updatedAt: now }, { merge: true });
  });
}

functions.http('v1Events', async (req, res) => {
  // Basic CORS — CLI clients don't need it but staging dashboards do.
  res.set('Access-Control-Allow-Origin', '*');
  res.set('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.set('Access-Control-Allow-Headers', 'Content-Type, Idempotency-Key, User-Agent');
  if (req.method === 'OPTIONS') { res.status(204).send(''); return; }
  if (req.method !== 'POST') { res.status(405).json({ error: 'METHOD_NOT_ALLOWED' }); return; }

  const idempotencyKey = req.get('Idempotency-Key');
  if (!idempotencyKey || idempotencyKey.length < 8 || idempotencyKey.length > 128) {
    res.status(400).json({ error: 'MISSING_IDEMPOTENCY_KEY' });
    return;
  }

  const body = req.body;
  if (!body || !Array.isArray(body.events) || body.events.length === 0) {
    res.status(400).json({ error: 'MALFORMED_BATCH' });
    return;
  }

  const now = new Date();
  const tenant = (req.get('User-Agent') || 'unknown').split('/')[0];

  // Credit ceiling check BEFORE Firestore writes — this is what makes the
  // 402 possible. In production, wire to a real ledger; ADR-303 says the
  // Cognitum credit authority is the sole source of truth for this signal.
  const withinBudget = await checkCreditBudget(tenant, now);
  if (!withinBudget) {
    res.status(402).json({ error: 'COGNITUM_CREDIT_EXHAUSTED', tenant, day: now.toISOString().slice(0, 10) });
    return;
  }

  // Idempotency: if we already processed this batch id, return 200 with no-op.
  const idemRef = firestore.collection('funnel_idem').doc(idempotencyKey);
  const idemSnap = await idemRef.get();
  if (idemSnap.exists) {
    res.status(200).json({ ok: true, deduped: true, accepted: 0 });
    return;
  }

  const validEvents = body.events.filter(validEvent);
  const droppedCount = body.events.length - validEvents.length;

  // Bulk write raw events.
  const batchWrite = firestore.batch();
  for (const ev of validEvents) {
    const ref = firestore.collection(FIRESTORE_COLLECTION).doc();
    batchWrite.set(ref, { ...ev, receivedAt: now, batchId: idempotencyKey });
  }
  batchWrite.set(idemRef, { at: now, count: validEvents.length });
  await batchWrite.commit();

  // Aggregates — one write per (surface, event, timestampBucket, release).
  const aggWrites = firestore.batch();
  const aggKeys = new Map();
  for (const ev of validEvents) {
    const key = `${ev.surface}_${ev.event}_${ev.timestampBucket}_${ev.release}`;
    aggKeys.set(key, (aggKeys.get(key) || 0) + 1);
  }
  for (const [key, count] of aggKeys.entries()) {
    const ref = firestore.collection(AGG_COLLECTION).doc(key);
    aggWrites.set(ref, { count: Firestore.FieldValue.increment(count), updatedAt: now }, { merge: true });
  }
  await aggWrites.commit();

  // Credit-ledger bump — one per accepted event (adjust as your model needs).
  await bumpCreditCounter(tenant, now, validEvents.length);

  res.status(200).json({
    ok: true,
    accepted: validEvents.length,
    dropped: droppedCount,
    batchId: idempotencyKey,
  });
});
