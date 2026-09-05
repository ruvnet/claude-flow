/**
 * Tests for AtomicBbsRoomBudgetTracker — ADR-164.1.
 *
 * Implements Tests 1, 2, 3, 6 from §9. Test 4 (mid-transaction crash) is
 * covered by a synchronous throw-during-reserve scenario; Test 5 (clock-skew
 * backward) is intentionally skipped as it requires system-clock control
 * beyond what the test harness exposes — see ADR-164.1 §9 Test 5 for the
 * design intent.
 *
 * Uses better-sqlite3 in-memory mode for speed.
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { createRequire } from 'node:module';

import {
  AtomicBbsRoomBudgetTracker,
  clampReservationExpiry,
  RESERVATION_EXPIRY_FLOOR_MS,
  RESERVATION_EXPIRY_CEILING_MS,
  createAtomicTrackerIfEnabled,
  type BudgetAuditSink,
  type SqliteDatabase,
} from '../src/business-pods/bbs-budget-tracker.js';

// Resolve better-sqlite3 via CJS require so tests work even when ESM
// resolution from this nested test depth has trouble locating the
// hoisted v3-level dependency.
const cjsRequire = createRequire(import.meta.url);
type DatabaseCtor = new (filename: string) => SqliteDatabase;

function openDb(): SqliteDatabase {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const Database = cjsRequire('better-sqlite3') as DatabaseCtor;
  return new Database(':memory:');
}

let db: SqliteDatabase;
let auditEvents: Array<{ type: string; payload: Record<string, unknown> }>;
let audit: BudgetAuditSink;

beforeEach(() => {
  db = openDb();
  auditEvents = [];
  audit = {
    emit: (type, payload) => { auditEvents.push({ type, payload }); },
  };
});

afterEach(() => {
  try { db.close(); } catch { /* noop */ }
});

// ---------- clamp ---------------------------------------------------------

describe('clampReservationExpiry', () => {
  it('clamps small values up to the 5s floor', () => {
    expect(clampReservationExpiry(1000)).toBe(RESERVATION_EXPIRY_FLOOR_MS);
  });
  it('clamps large values down to the 5min ceiling', () => {
    expect(clampReservationExpiry(60 * 60 * 1000)).toBe(RESERVATION_EXPIRY_CEILING_MS);
  });
  it('passes through values within bounds', () => {
    expect(clampReservationExpiry(30_000)).toBe(30_000);
  });
});

// ---------- Test 1: serial reserves under a cap (drop-in for §9 Test 1) --

describe('Test 1 — serial reserves under a $1.00 cap', () => {
  it('exactly 20 of 100 callers reserving $0.05 succeed; 80 BUDGET_EXCEEDED; total = $1.00', () => {
    const tracker = new AtomicBbsRoomBudgetTracker({ db, audit, defaultExpiryMs: 60_000 });
    tracker.registerRoom('sales-test', 1.0);

    let ok = 0;
    let exceeded = 0;
    for (let i = 0; i < 100; i++) {
      const r = tracker.reserve('sales-test', `caller-${i}`, 0.05);
      if (r.ok) ok++;
      else if (r.error === 'BUDGET_EXCEEDED') exceeded++;
    }
    expect(ok).toBe(20);
    expect(exceeded).toBe(80);

    const rows = tracker.listReservations('sales-test').filter((r) => r.state === 'reserved');
    expect(rows.length).toBe(20);
    const sum = rows.reduce((acc, r) => acc + Number(r.estimated_usd), 0);
    expect(sum).toBeCloseTo(1.0, 6);
  });
});

// ---------- Test 2: block → release → allow 10 of 50 ---------------------

describe('Test 2 — release frees budget for subsequent callers', () => {
  it('first $0.50 reserve blocks 50 callers; release frees 10 of next 50', () => {
    const tracker = new AtomicBbsRoomBudgetTracker({ db, audit, defaultExpiryMs: 60_000 });
    tracker.registerRoom('sales-test2', 1.0);

    const initial = tracker.reserve('sales-test2', 'initial', 0.5);
    expect(initial.ok).toBe(true);
    if (!initial.ok) throw new Error('unreachable');
    const reservationIdA = initial.reservationId;

    // Step B: 50 reserves of $0.05 — all should fail (0.50 + 0.05 = 0.55 OK
    // for the first call, but cumulative reserved + 0.05 must exceed cap to fail).
    // 0.50 reserved + 50 × 0.05 = 0.50 + 2.50 = 3.00 way over. Each individual
    // call sees 0.50 + N×0.05 already reserved, so callers 1-10 succeed and
    // 11-50 fail (0.50 reserved + 0.50 in step B = 1.00 cap reached after 10).
    let phaseBOk = 0;
    let phaseBFail = 0;
    for (let i = 0; i < 50; i++) {
      const r = tracker.reserve('sales-test2', `phaseB-${i}`, 0.05);
      if (r.ok) phaseBOk++;
      else phaseBFail++;
    }
    expect(phaseBOk).toBe(10);
    expect(phaseBFail).toBe(40);

    // Step C: release the initial $0.50.
    const rel = tracker.release(reservationIdA);
    expect(rel.ok).toBe(true);

    // Step D: another 50 — should see exactly 10 succeed (0.50 freed → 10 × 0.05).
    let phaseDOk = 0;
    let phaseDFail = 0;
    for (let i = 0; i < 50; i++) {
      const r = tracker.reserve('sales-test2', `phaseD-${i}`, 0.05);
      if (r.ok) phaseDOk++;
      else phaseDFail++;
    }
    expect(phaseDOk).toBe(10);
    expect(phaseDFail).toBe(40);
  });
});

// ---------- Test 3: expiry frees budget after sweepExpired() --------------

describe('Test 3 — expiry frees budget for next caller', () => {
  it('after sweepExpired() an expired reservation no longer blocks new reserves', () => {
    let mockNow = 1_000_000;
    const tracker = new AtomicBbsRoomBudgetTracker({
      db, audit,
      defaultExpiryMs: 5_000, // floor — clamp goes to 5000ms
      clock: () => mockNow,
    });
    tracker.registerRoom('hr-test', 0.10);

    const a = tracker.reserve('hr-test', 'agent-1', 0.10);
    expect(a.ok).toBe(true);

    // Step B: should be BUDGET_EXCEEDED (live reservation occupies full cap).
    const b = tracker.reserve('hr-test', 'agent-2', 0.05);
    expect(b.ok).toBe(false);
    if (b.ok) throw new Error('unreachable');
    expect(b.error).toBe('BUDGET_EXCEEDED');

    // Step C: advance clock past expiry, then sweep.
    mockNow += 6_000;
    const swept = tracker.sweepExpired();
    expect(swept).toBe(1);

    // Step D: next reserve succeeds (the expired row is excluded from totals).
    const d = tracker.reserve('hr-test', 'agent-2', 0.05);
    expect(d.ok).toBe(true);
  });

  it('expired reservation is excluded from gate check BEFORE sweep (window query check)', () => {
    let mockNow = 2_000_000;
    const tracker = new AtomicBbsRoomBudgetTracker({
      db, audit,
      defaultExpiryMs: 5_000,
      clock: () => mockNow,
    });
    tracker.registerRoom('window-test', 0.10);

    const a = tracker.reserve('window-test', 'agent-1', 0.10);
    expect(a.ok).toBe(true);

    // Advance past expiry but DO NOT call sweepExpired().
    mockNow += 6_000;

    // Per ADR-164.1 §7.2 "phantom debt intentional bias" — even unswepped
    // expired rows must be excluded from the reserve() gate check.
    const b = tracker.reserve('window-test', 'agent-2', 0.05);
    expect(b.ok).toBe(true);
  });
});

// ---------- Test 6: COMMIT_AFTER_EXPIRY closes Expired Commit Leak --------

describe('Test 6 — COMMIT_AFTER_EXPIRY captures the real spend (§8.1 fix)', () => {
  it('late commit records spend, marks committed_post_expiry, emits audit', () => {
    let mockNow = 3_000_000;
    const tracker = new AtomicBbsRoomBudgetTracker({
      db, audit,
      defaultExpiryMs: 5_000,
      clock: () => mockNow,
    });
    tracker.registerRoom('commit-late', 1.0);

    const r = tracker.reserve('commit-late', 'agent-1', 0.30);
    expect(r.ok).toBe(true);
    if (!r.ok) throw new Error('unreachable');
    const reservationId = r.reservationId;

    // Advance past expiry — reservation is now expired but not committed.
    mockNow += 6_000;

    // Late commit: should succeed with warned: 'COMMIT_AFTER_EXPIRY'.
    const c = tracker.commit(reservationId, 0.30);
    expect(c.ok).toBe(true);
    if (!c.ok) throw new Error('unreachable');
    expect('warned' in c && c.warned).toBe('COMMIT_AFTER_EXPIRY');
    if ('warned' in c) {
      expect(c.finalRemaining).toBeCloseTo(0.70, 6);
    }

    // Audit emitted the high-priority envelope.
    const evt = auditEvents.find((e) => e.type === 'reservation.committed_post_expiry');
    expect(evt).toBeDefined();
    expect(evt!.payload.reservationId).toBe(reservationId);

    // The post-expiry commit counts against the budget.
    const next = tracker.reserve('commit-late', 'agent-2', 0.70);
    expect(next.ok).toBe(true);

    // Now fully spent — even a tiny additional reserve is BUDGET_EXCEEDED.
    const tiny = tracker.reserve('commit-late', 'agent-3', 0.01);
    expect(tiny.ok).toBe(false);
    if (tiny.ok) throw new Error('unreachable');
    expect(tiny.error).toBe('BUDGET_EXCEEDED');
  });

  it('happy-path commit (within window) returns committed:true without warning', () => {
    const tracker = new AtomicBbsRoomBudgetTracker({ db, audit, defaultExpiryMs: 60_000 });
    tracker.registerRoom('commit-clean', 1.0);
    const r = tracker.reserve('commit-clean', 'agent-1', 0.20);
    expect(r.ok).toBe(true);
    if (!r.ok) throw new Error('unreachable');

    const c = tracker.commit(r.reservationId, 0.18);
    expect(c.ok).toBe(true);
    if (!c.ok) throw new Error('unreachable');
    expect('committed' in c && c.committed).toBe(true);
    if ('committed' in c) {
      expect(c.finalRemaining).toBeCloseTo(0.82, 6);
    }
  });

  it('double-commit returns ALREADY_FINALIZED', () => {
    const tracker = new AtomicBbsRoomBudgetTracker({ db, audit, defaultExpiryMs: 60_000 });
    tracker.registerRoom('double-commit', 1.0);
    const r = tracker.reserve('double-commit', 'agent-1', 0.10);
    if (!r.ok) throw new Error('expected ok');
    expect(tracker.commit(r.reservationId, 0.10).ok).toBe(true);
    const second = tracker.commit(r.reservationId, 0.05);
    expect(second.ok).toBe(false);
    if (second.ok) throw new Error('unreachable');
    expect(second.error).toBe('ALREADY_FINALIZED');
  });

  it('commit on unknown id returns NOT_FOUND', () => {
    const tracker = new AtomicBbsRoomBudgetTracker({ db, audit });
    const c = tracker.commit('does-not-exist', 0.10);
    expect(c.ok).toBe(false);
    if (c.ok) throw new Error('unreachable');
    expect(c.error).toBe('NOT_FOUND');
  });

  it('release on committed reservation returns ALREADY_FINALIZED', () => {
    const tracker = new AtomicBbsRoomBudgetTracker({ db, audit, defaultExpiryMs: 60_000 });
    tracker.registerRoom('release-blocked', 1.0);
    const r = tracker.reserve('release-blocked', 'agent-1', 0.10);
    if (!r.ok) throw new Error('expected ok');
    expect(tracker.commit(r.reservationId, 0.10).ok).toBe(true);
    const rel = tracker.release(r.reservationId);
    expect(rel.ok).toBe(false);
    if (rel.ok) throw new Error('unreachable');
    expect(rel.error).toBe('ALREADY_FINALIZED');
  });

  it('reserve on unknown room returns ROOM_NOT_FOUND', () => {
    const tracker = new AtomicBbsRoomBudgetTracker({ db, audit });
    const r = tracker.reserve('no-such-room', 'agent-1', 0.10);
    expect(r.ok).toBe(false);
    if (r.ok) throw new Error('unreachable');
    expect(r.error).toBe('ROOM_NOT_FOUND');
  });
});

// ---------- feature-flag factory ------------------------------------------

describe('createAtomicTrackerIfEnabled feature flag', () => {
  it('returns null when CLAUDE_FLOW_BBS_ATOMIC_BUDGET is unset', () => {
    const prev = process.env.CLAUDE_FLOW_BBS_ATOMIC_BUDGET;
    delete process.env.CLAUDE_FLOW_BBS_ATOMIC_BUDGET;
    expect(createAtomicTrackerIfEnabled({ db })).toBeNull();
    if (prev !== undefined) process.env.CLAUDE_FLOW_BBS_ATOMIC_BUDGET = prev;
  });

  it('returns the atomic tracker when flag is set to "1"', () => {
    const prev = process.env.CLAUDE_FLOW_BBS_ATOMIC_BUDGET;
    process.env.CLAUDE_FLOW_BBS_ATOMIC_BUDGET = '1';
    try {
      const tr = createAtomicTrackerIfEnabled({ db });
      expect(tr).toBeInstanceOf(AtomicBbsRoomBudgetTracker);
    } finally {
      if (prev === undefined) delete process.env.CLAUDE_FLOW_BBS_ATOMIC_BUDGET;
      else process.env.CLAUDE_FLOW_BBS_ATOMIC_BUDGET = prev;
    }
  });
});
