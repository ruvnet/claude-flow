/**
 * BbsRoomBudgetTracker — Atomic reserve / commit / release token-bucket
 * backed by better-sqlite3 (ADR-164.1 §3-§5).
 *
 * Closes the read-then-write race in ADR-164's first-draft tracker by routing
 * every state transition through a single `BEGIN IMMEDIATE` transaction that
 * acquires the SQLite write lock atomically with the gate check. The
 * `_lock_bump` column write is a belt-and-suspenders explicit write inside
 * the transaction so the lock acquisition is visible to code review and
 * query-log analysis (§3.2 peer-review clarification).
 *
 * Architectural constraints (ADR-164.1):
 *   - Default OFF: this module is opt-in behind `CLAUDE_FLOW_BBS_ATOMIC_BUDGET=1`.
 *     The pod-tick.mjs file-based stub remains the default until the flag is
 *     flipped per ADR-164.1 §12.4.
 *   - `committed_post_expiry` state machine implemented per §5.3 — late
 *     commits on expired reservations ARE accepted (the API spend already
 *     happened), transition to `committed_post_expiry`, charge the budget,
 *     and return `warned: 'COMMIT_AFTER_EXPIRY'`. This closes the §8.1
 *     Expired Commit Leak surfaced by peer review on 2026-06-29.
 *   - `expires_at` is clamped to [5_000, 300_000] ms (§3.2).
 *   - WAL + synchronous=NORMAL + busy_timeout=500 for write throughput.
 *
 * The sweeper interval (`sweepExpired()`) is exposed as a manual method;
 * callers are expected to drive it on a setInterval — that integration lives
 * at the call site, not in this file, per ADR-164.1 §7.1.
 *
 * @module @claude-flow/cli/business-pods/bbs-budget-tracker
 */

import { randomUUID } from 'node:crypto';

// `better-sqlite3` is a transitive dep (hoisted from v3 monorepo). We type
// the Database interface structurally here so the module compiles even when
// better-sqlite3 has not been installed at this package's depth — at runtime
// the caller passes a Database instance constructed from their own require.
export interface SqliteDatabase {
  pragma(name: string): unknown;
  prepare(sql: string): SqliteStatement;
  exec(sql: string): void;
  close(): void;
}

export interface SqliteStatement {
  run(...params: unknown[]): { changes: number; lastInsertRowid: number | bigint };
  get(...params: unknown[]): Record<string, unknown> | undefined;
  all(...params: unknown[]): Record<string, unknown>[];
}

// ---------- expiry-window clamp -------------------------------------------

export const RESERVATION_EXPIRY_FLOOR_MS = 5_000;
export const RESERVATION_EXPIRY_CEILING_MS = 300_000;
export const RESERVATION_EXPIRY_DEFAULT_MS = 60_000;

export function clampReservationExpiry(raw: number | undefined): number {
  if (raw === undefined || !Number.isFinite(raw)) {
    const envVal = Number(process.env.CLAUDE_FLOW_BBS_RESERVATION_EXPIRY_MS);
    if (Number.isFinite(envVal) && envVal > 0) {
      return Math.max(RESERVATION_EXPIRY_FLOOR_MS, Math.min(RESERVATION_EXPIRY_CEILING_MS, envVal));
    }
    return RESERVATION_EXPIRY_DEFAULT_MS;
  }
  return Math.max(RESERVATION_EXPIRY_FLOOR_MS, Math.min(RESERVATION_EXPIRY_CEILING_MS, raw));
}

// ---------- error / result shapes (match ADR-164.1 §4.1 verbatim) ---------

export type ReserveResult =
  | { ok: true; reservationId: string; remainingAfterReserve: number }
  | { ok: false; error: 'BUDGET_EXCEEDED' | 'ROOM_NOT_FOUND' };

export type CommitResult =
  | { ok: true; committed: true; finalRemaining: number }
  | { ok: true; warned: 'COMMIT_AFTER_EXPIRY'; finalRemaining: number }
  | { ok: false; error: 'NOT_FOUND' | 'ALREADY_FINALIZED' };

export type ReleaseResult =
  | { ok: true; released: true }
  | { ok: false; error: 'NOT_FOUND' | 'ALREADY_FINALIZED' };

// ---------- schema migration ----------------------------------------------

export const SCHEMA_SQL = `
PRAGMA journal_mode = WAL;
PRAGMA synchronous = NORMAL;
PRAGMA busy_timeout = 500;

CREATE TABLE IF NOT EXISTS bbs_budget_rooms (
  room_id         TEXT NOT NULL PRIMARY KEY,
  monthly_cap_usd REAL NOT NULL CHECK (monthly_cap_usd >= 0),
  billing_month   TEXT NOT NULL,
  _lock_bump      INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS bbs_budget_reservations (
  reservation_id    TEXT NOT NULL PRIMARY KEY,
  room_id           TEXT NOT NULL REFERENCES bbs_budget_rooms(room_id),
  caller_node_id    TEXT NOT NULL,
  estimated_usd     REAL NOT NULL CHECK (estimated_usd >= 0),
  actual_usd        REAL,
  state             TEXT NOT NULL
                    CHECK (state IN ('reserved','committed','released','expired','committed_post_expiry')),
  reserved_at       INTEGER NOT NULL,
  expires_at        INTEGER NOT NULL,
  committed_at      INTEGER,
  audit_envelope_id TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_reservations_room_month
  ON bbs_budget_reservations (room_id, reserved_at);

CREATE INDEX IF NOT EXISTS idx_reservations_expiry
  ON bbs_budget_reservations (state, expires_at);
`;

// ---------- helpers --------------------------------------------------------

function currentBillingMonth(now: number): string {
  const d = new Date(now);
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`;
}

function billingMonthStartMs(billingMonth: string): number {
  const [y, m] = billingMonth.split('-').map((n) => Number(n));
  return Date.UTC(y!, (m! - 1), 1, 0, 0, 0, 0);
}

// ---------- audit hook -----------------------------------------------------

export interface BudgetAuditSink {
  emit(eventType: 'reservation.committed_post_expiry' | 'reservation.committed' | 'reservation.released' | 'reservation.reserved' | 'reservation.budget_exceeded',
       payload: Record<string, unknown>): void;
}

const noopAudit: BudgetAuditSink = { emit: () => undefined };

// ---------- the tracker ----------------------------------------------------

export interface AtomicBbsRoomBudgetTrackerOptions {
  /** SQLite database handle (caller-owned, opened in WAL mode). */
  db: SqliteDatabase;
  /** Override the default 60s reservation window (clamped to [5s, 300s]). */
  defaultExpiryMs?: number;
  /** Audit sink — receives reservation lifecycle events. */
  audit?: BudgetAuditSink;
  /** Inject Date.now() for tests. */
  clock?: () => number;
}

export class AtomicBbsRoomBudgetTracker {
  private readonly db: SqliteDatabase;
  private readonly defaultExpiryMs: number;
  private readonly audit: BudgetAuditSink;
  private readonly clock: () => number;

  constructor(opts: AtomicBbsRoomBudgetTrackerOptions) {
    this.db = opts.db;
    this.defaultExpiryMs = clampReservationExpiry(opts.defaultExpiryMs);
    this.audit = opts.audit ?? noopAudit;
    this.clock = opts.clock ?? Date.now;

    // Ensure schema is present. exec() is a no-op for tables that already
    // exist due to IF NOT EXISTS.
    this.db.exec(SCHEMA_SQL);
  }

  /**
   * Register (or update) a room and its monthly cap. Idempotent.
   */
  registerRoom(roomId: string, monthlyCapUsd: number): void {
    const billingMonth = currentBillingMonth(this.clock());
    this.db
      .prepare(
        `INSERT INTO bbs_budget_rooms (room_id, monthly_cap_usd, billing_month, _lock_bump)
         VALUES (?, ?, ?, 0)
         ON CONFLICT(room_id) DO UPDATE SET monthly_cap_usd = excluded.monthly_cap_usd`,
      )
      .run(roomId, monthlyCapUsd, billingMonth);
  }

  /**
   * Atomically check budget and insert a reservation row in a single
   * BEGIN IMMEDIATE transaction. See ADR-164.1 §5.2.
   */
  reserve(
    roomId: string,
    callerId: string,
    estimatedUsd: number,
    opts?: { auditEnvelopeId?: string; expiryMs?: number },
  ): ReserveResult {
    if (!Number.isFinite(estimatedUsd) || estimatedUsd < 0) {
      throw new Error('estimatedUsd must be a non-negative finite number');
    }
    const auditEnvelopeId = opts?.auditEnvelopeId ?? `audit-${randomUUID()}`;
    const expiryMs = clampReservationExpiry(opts?.expiryMs ?? this.defaultExpiryMs);

    const nowMs = this.clock();
    const billingMonth = currentBillingMonth(nowMs);
    const billingMonthStart = billingMonthStartMs(billingMonth);

    const beginStmt = this.db.prepare('BEGIN IMMEDIATE');
    const commitStmt = this.db.prepare('COMMIT');
    const rollbackStmt = this.db.prepare('ROLLBACK');

    beginStmt.run();
    let transactionOpen = true;
    try {
      // Step 1: touch the room header row (the _lock_bump write makes the
      // lock acquisition visible per §3.2 peer-review note).
      const bumpRes = this.db
        .prepare(
          `UPDATE bbs_budget_rooms
             SET _lock_bump = _lock_bump + 1,
                 billing_month = CASE WHEN billing_month = ? THEN billing_month ELSE ? END
             WHERE room_id = ?`,
        )
        .run(billingMonth, billingMonth, roomId);

      if (bumpRes.changes === 0) {
        rollbackStmt.run();
        transactionOpen = false;
        return { ok: false, error: 'ROOM_NOT_FOUND' };
      }

      const roomRow = this.db
        .prepare(`SELECT monthly_cap_usd, billing_month FROM bbs_budget_rooms WHERE room_id = ?`)
        .get(roomId) as { monthly_cap_usd: number; billing_month: string } | undefined;

      if (!roomRow) {
        rollbackStmt.run();
        transactionOpen = false;
        return { ok: false, error: 'ROOM_NOT_FOUND' };
      }

      const monthlyCap = roomRow.monthly_cap_usd;

      // Step 3: compute committed + live-reserved totals within this billing month.
      const totals = this.db
        .prepare(
          `SELECT
             COALESCE(SUM(CASE WHEN state IN ('committed','committed_post_expiry') THEN actual_usd ELSE 0 END), 0) AS committed_total,
             COALESCE(SUM(CASE WHEN state = 'reserved' AND expires_at > ? THEN estimated_usd ELSE 0 END), 0) AS reserved_total
           FROM bbs_budget_reservations
           WHERE room_id = ? AND reserved_at >= ?`,
        )
        .get(nowMs, roomId, billingMonthStart) as { committed_total: number; reserved_total: number };

      const committedTotal = totals.committed_total ?? 0;
      const reservedTotal = totals.reserved_total ?? 0;
      const projected = committedTotal + reservedTotal + estimatedUsd;

      if (projected > monthlyCap + 1e-9) {
        rollbackStmt.run();
        transactionOpen = false;
        this.audit.emit('reservation.budget_exceeded', {
          roomId, callerId, estimatedUsd, committedTotal, reservedTotal, monthlyCap,
        });
        return { ok: false, error: 'BUDGET_EXCEEDED' };
      }

      // Step 5: insert the reservation.
      const reservationId = `res-${randomUUID()}`;
      const expiresAt = nowMs + expiryMs;
      this.db
        .prepare(
          `INSERT INTO bbs_budget_reservations
             (reservation_id, room_id, caller_node_id, estimated_usd, actual_usd,
              state, reserved_at, expires_at, committed_at, audit_envelope_id)
           VALUES (?, ?, ?, ?, NULL, 'reserved', ?, ?, NULL, ?)`,
        )
        .run(reservationId, roomId, callerId, estimatedUsd, nowMs, expiresAt, auditEnvelopeId);

      commitStmt.run();
      transactionOpen = false;

      const remaining = monthlyCap - (committedTotal + reservedTotal + estimatedUsd);
      this.audit.emit('reservation.reserved', {
        reservationId, roomId, callerId, estimatedUsd, expiresAt, remaining,
      });
      return { ok: true, reservationId, remainingAfterReserve: remaining };
    } catch (err) {
      if (transactionOpen) {
        try { rollbackStmt.run(); } catch { /* already-rolled */ }
      }
      throw err;
    }
  }

  /**
   * Commit the reservation with the actual cost. Late commits (expired
   * before commit landed) ARE accepted, transitioned to
   * 'committed_post_expiry', charged to the budget, and surfaced via
   * `warned: 'COMMIT_AFTER_EXPIRY'` plus a `reservation.committed_post_expiry`
   * audit emit. See ADR-164.1 §5.3 + §8.1.
   */
  commit(reservationId: string, actualUsd: number): CommitResult {
    if (!Number.isFinite(actualUsd) || actualUsd < 0) {
      throw new Error('actualUsd must be a non-negative finite number');
    }
    const nowMs = this.clock();

    const beginStmt = this.db.prepare('BEGIN IMMEDIATE');
    const commitStmt = this.db.prepare('COMMIT');
    const rollbackStmt = this.db.prepare('ROLLBACK');

    beginStmt.run();
    let transactionOpen = true;
    try {
      const row = this.db
        .prepare(
          `SELECT state, room_id, estimated_usd, reserved_at, expires_at
             FROM bbs_budget_reservations
             WHERE reservation_id = ?`,
        )
        .get(reservationId) as
        | { state: string; room_id: string; estimated_usd: number; reserved_at: number; expires_at: number }
        | undefined;

      if (!row) {
        rollbackStmt.run();
        transactionOpen = false;
        return { ok: false, error: 'NOT_FOUND' };
      }

      if (row.state === 'committed' || row.state === 'committed_post_expiry' ||
          row.state === 'released' || row.state === 'expired') {
        rollbackStmt.run();
        transactionOpen = false;
        return { ok: false, error: 'ALREADY_FINALIZED' };
      }

      // state is 'reserved' here. Decide committed vs committed_post_expiry.
      const lateCommit = row.expires_at <= nowMs;
      const newState = lateCommit ? 'committed_post_expiry' : 'committed';

      this.db
        .prepare(
          `UPDATE bbs_budget_reservations
             SET state = ?, actual_usd = ?, committed_at = ?
             WHERE reservation_id = ?`,
        )
        .run(newState, actualUsd, nowMs, reservationId);

      // Re-compute remaining for the return value.
      const billingMonth = currentBillingMonth(nowMs);
      const billingMonthStart = billingMonthStartMs(billingMonth);
      const totals = this.db
        .prepare(
          `SELECT
             COALESCE(SUM(CASE WHEN state IN ('committed','committed_post_expiry') THEN actual_usd ELSE 0 END), 0) AS committed_total,
             COALESCE(SUM(CASE WHEN state = 'reserved' AND expires_at > ? THEN estimated_usd ELSE 0 END), 0) AS reserved_total
           FROM bbs_budget_reservations
           WHERE room_id = ? AND reserved_at >= ?`,
        )
        .get(nowMs, row.room_id, billingMonthStart) as { committed_total: number; reserved_total: number };

      const roomRow = this.db
        .prepare(`SELECT monthly_cap_usd FROM bbs_budget_rooms WHERE room_id = ?`)
        .get(row.room_id) as { monthly_cap_usd: number } | undefined;

      const monthlyCap = roomRow?.monthly_cap_usd ?? 0;
      const finalRemaining = monthlyCap - ((totals.committed_total ?? 0) + (totals.reserved_total ?? 0));

      commitStmt.run();
      transactionOpen = false;

      if (lateCommit) {
        // Emit the high-priority audit envelope per §8.1.
        this.audit.emit('reservation.committed_post_expiry', {
          reservationId, roomId: row.room_id, actualUsd, finalRemaining,
          reservedAt: row.reserved_at, expiresAt: row.expires_at, committedAt: nowMs,
        });
        return { ok: true, warned: 'COMMIT_AFTER_EXPIRY', finalRemaining };
      }

      this.audit.emit('reservation.committed', {
        reservationId, roomId: row.room_id, actualUsd, finalRemaining,
      });
      return { ok: true, committed: true, finalRemaining };
    } catch (err) {
      if (transactionOpen) {
        try { rollbackStmt.run(); } catch { /* already-rolled */ }
      }
      throw err;
    }
  }

  /**
   * Release a reservation (caller decided not to proceed). State must be
   * 'reserved'; any other state is ALREADY_FINALIZED.
   */
  release(reservationId: string): ReleaseResult {
    const beginStmt = this.db.prepare('BEGIN IMMEDIATE');
    const commitStmt = this.db.prepare('COMMIT');
    const rollbackStmt = this.db.prepare('ROLLBACK');

    beginStmt.run();
    let transactionOpen = true;
    try {
      const row = this.db
        .prepare(`SELECT state, room_id FROM bbs_budget_reservations WHERE reservation_id = ?`)
        .get(reservationId) as { state: string; room_id: string } | undefined;

      if (!row) {
        rollbackStmt.run();
        transactionOpen = false;
        return { ok: false, error: 'NOT_FOUND' };
      }

      if (row.state !== 'reserved') {
        rollbackStmt.run();
        transactionOpen = false;
        return { ok: false, error: 'ALREADY_FINALIZED' };
      }

      this.db
        .prepare(`UPDATE bbs_budget_reservations SET state = 'released' WHERE reservation_id = ?`)
        .run(reservationId);

      commitStmt.run();
      transactionOpen = false;

      this.audit.emit('reservation.released', { reservationId, roomId: row.room_id });
      return { ok: true, released: true };
    } catch (err) {
      if (transactionOpen) {
        try { rollbackStmt.run(); } catch { /* already-rolled */ }
      }
      throw err;
    }
  }

  /**
   * Sweep expired reservations: transition 'reserved' rows whose expiry has
   * passed to 'expired'. Callers should drive this on a setInterval per
   * ADR-164.1 §7.1 (default cadence 5s; this method does NOT install the
   * timer — that's the integration site's responsibility).
   * Returns the number of rows updated.
   */
  sweepExpired(): number {
    const result = this.db
      .prepare(
        `UPDATE bbs_budget_reservations
           SET state = 'expired'
           WHERE state = 'reserved' AND expires_at < ?`,
      )
      .run(this.clock());
    return result.changes;
  }

  /**
   * Diagnostic read: list reservations for a room. Not on the hot path.
   */
  listReservations(roomId: string): Array<Record<string, unknown>> {
    return this.db
      .prepare(`SELECT * FROM bbs_budget_reservations WHERE room_id = ? ORDER BY reserved_at`)
      .all(roomId);
  }
}

/**
 * Feature-flagged factory per ADR-164.1 §12.3. Returns an atomic tracker
 * when `CLAUDE_FLOW_BBS_ATOMIC_BUDGET=1`, otherwise returns null so the
 * caller can keep using the file-based stub in pod-tick.mjs.
 */
export function createAtomicTrackerIfEnabled(
  opts: AtomicBbsRoomBudgetTrackerOptions,
): AtomicBbsRoomBudgetTracker | null {
  if (process.env.CLAUDE_FLOW_BBS_ATOMIC_BUDGET !== '1') return null;
  return new AtomicBbsRoomBudgetTracker(opts);
}
