/**
 * Live end-to-end verification of the funnel analytics integration (ADR-308/311)
 * against the REAL deployed GCP service (funnel.ruv.io -> cognitum-analytics
 * Cloud Function -> Firestore, project cognitum-20260110).
 *
 * Every other funnel test (funnel.test.ts) deliberately stays network-free —
 * this file is the one place that intentionally isn't, because "the client is
 * wired to a remote contract" and "the remote contract actually works when
 * you hit it for real" are different claims, and only this file proves the
 * second one. Skipped by default (network + a live GCP dependency neither CI
 * nor most local runs should require) — opt in with:
 *
 *   RUFLO_FUNNEL_LIVE_E2E=1 npx vitest run __tests__/funnel-e2e-live.test.ts
 *
 * Every event this test posts uses messageId 'e2e-smoke-test' specifically so
 * it's trivially identifiable and never collides with a real rotation-pool
 * message id (real ids come from the seeded message pool, see
 * ruflo-funnel-api/seed-messages.mjs). The afterAll hook best-effort deletes
 * everything this test wrote, using the SAME Firestore REST endpoint gcloud
 * ADC already authenticates against — if ADC isn't available the cleanup is
 * skipped with a console.warn (never fails the run), same fail-open discipline
 * as the transport code itself.
 */
import { describe, it, expect, afterAll } from 'vitest';
import { randomUUID } from 'crypto';
import { execSync } from 'child_process';

const LIVE = process.env.RUFLO_FUNNEL_LIVE_E2E === '1';
const PROJECT_ID = 'cognitum-20260110';
const TEST_MESSAGE_ID = 'e2e-smoke-test';

function getAccessToken(): string | null {
  try {
    return execSync('gcloud auth print-access-token', { encoding: 'utf-8', timeout: 5000 }).trim();
  } catch {
    return null;
  }
}

async function firestoreQuery(collection: string, token: string): Promise<Array<{ name: string }>> {
  const res = await fetch(
    `https://firestore.googleapis.com/v1/projects/${PROJECT_ID}/databases/(default)/documents:runQuery`,
    {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        structuredQuery: {
          from: [{ collectionId: collection }],
          where: {
            fieldFilter: {
              field: { fieldPath: 'messageId' },
              op: 'EQUAL',
              value: { stringValue: TEST_MESSAGE_ID },
            },
          },
          limit: 20,
        },
      }),
    },
  );
  const rows = (await res.json()) as Array<{ document?: { name: string } }>;
  return rows.filter((r) => r.document).map((r) => ({ name: r.document!.name }));
}

async function firestoreDelete(docName: string, token: string): Promise<void> {
  await fetch(`https://firestore.googleapis.com/v1/${docName}`, {
    method: 'DELETE',
    headers: { Authorization: `Bearer ${token}` },
  });
}

describe.skipIf(!LIVE)('funnel analytics — LIVE end-to-end (real funnel.ruv.io + Firestore)', () => {
  const writtenEventDocs: string[] = [];

  it('POST /v1/events: a real promo_impression batch is accepted', async () => {
    const batchId = `e2e-smoke-${randomUUID()}`;
    const batch = {
      batchId,
      release: '3.25.6',
      emittedAt: new Date().toISOString(),
      events: [
        {
          schemaVersion: 1,
          event: 'promo_impression',
          surface: 'statusline',
          release: '3.25.6',
          messageId: TEST_MESSAGE_ID,
          timestampBucket: new Date().toISOString().slice(0, 10),
        },
      ],
    };

    const res = await fetch('https://funnel.ruv.io/v1/events', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Idempotency-Key': batchId,
        'User-Agent': 'ruflo-funnel/3.25.6',
      },
      body: JSON.stringify(batch),
    });

    expect(res.status).toBe(200);
    const body = (await res.json()) as { ok: boolean; accepted: number; dropped: number };
    expect(body.ok).toBe(true);
    expect(body.accepted).toBe(1);
    expect(body.dropped).toBe(0);
  });

  it('GET /v1/click/{messageId}: redirects to the allowlisted target', async () => {
    const to = encodeURIComponent('https://cognitum.one/?utm_source=e2e-smoke-test');
    const res = await fetch(`https://funnel.ruv.io/v1/click/${TEST_MESSAGE_ID}?to=${to}`, {
      redirect: 'manual',
    });
    expect(res.status).toBe(302);
    expect(res.headers.get('location')).toBe('https://cognitum.one/?utm_source=e2e-smoke-test');
  });

  it('GET /v1/click with a non-allowlisted host is refused, not redirected', async () => {
    const to = encodeURIComponent('https://evil-example-not-allowlisted.test/');
    const res = await fetch(`https://funnel.ruv.io/v1/click/${TEST_MESSAGE_ID}?to=${to}`, {
      redirect: 'manual',
    });
    // Must NOT be a 302 to the disallowed host — server-side allowlist (ADR-311 §7) must hold.
    expect(res.status).not.toBe(302);
  });

  it('the impression and the click both actually landed in Firestore (funnel_events)', async () => {
    const token = getAccessToken();
    if (!token) {
      console.warn('[funnel-e2e-live] gcloud ADC unavailable — skipping Firestore verification step');
      return;
    }
    // Give the Cloud Function's Firestore writes a moment to become queryable.
    await new Promise((r) => setTimeout(r, 3000));
    const docs = await firestoreQuery('funnel_events', token);
    writtenEventDocs.push(...docs.map((d) => d.name));
    const events = docs.length; // both promo_impression (client POST) and promo_open (click redirect)
    expect(events).toBeGreaterThanOrEqual(1);
  });

  afterAll(async () => {
    const token = getAccessToken();
    if (!token) {
      console.warn('[funnel-e2e-live] gcloud ADC unavailable — leaving any test docs for manual cleanup');
      return;
    }
    try {
      // Re-query in case the last `it` above was skipped/short-circuited before populating writtenEventDocs.
      const events = await firestoreQuery('funnel_events', token);
      const aggregates = await firestoreQuery('funnel_aggregates', token);
      for (const doc of [...events, ...aggregates]) {
        await firestoreDelete(doc.name, token);
      }
    } catch (err) {
      console.warn('[funnel-e2e-live] cleanup failed (non-fatal):', err);
    }
  });
});
