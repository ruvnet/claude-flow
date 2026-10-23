/**
 * cost-governor/turn-counter.ts — ADR-179 sub-feature 1 (context trim).
 *
 * Per-session_id turn counter, persisted as JSON so it survives daemon
 * restarts within a bounded TTL. Also keeps a small bounded per-session
 * history of {turn, ts} snapshots so a pattern's wall-clock `updatedAt`
 * can be mapped back to "which turn was this last touched in" — the
 * mapping `trim.ts` needs when a `GuidancePattern` has no explicit
 * `lastAccessTurn` yet.
 *
 * Never throws — a persistence failure degrades to in-memory-only
 * counting for that call, matching the ADR-150 recorder discipline.
 *
 * @module @claude-flow/hooks/cost-governor/turn-counter
 */

import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve as resolvePath } from 'node:path';

export interface TurnSnapshot {
  turn: number;
  ts: number;
}

export interface TurnCounterEntry {
  turn: number;
  updatedAt: number;
  history: TurnSnapshot[];
}

export type TurnCounterState = Record<string, TurnCounterEntry>;

const DEFAULT_TTL_MS = 24 * 60 * 60 * 1000; // bounded TTL — stale sessions are pruned on write
const DEFAULT_HISTORY_SIZE = 64;
const DEFAULT_STORE_PATH = '.claude-flow/cost-governor-turns.json';

export class TurnCounter {
  constructor(
    private readonly path: string = resolvePath(DEFAULT_STORE_PATH),
    private readonly ttlMs: number = DEFAULT_TTL_MS,
    private readonly historySize: number = DEFAULT_HISTORY_SIZE,
  ) {}

  /** Increment and persist the turn counter for a session. Returns the new turn number. */
  increment(sessionId: string): number {
    const state = this.prune(this.load());
    const prev = state[sessionId];
    const next = (prev?.turn ?? 0) + 1;
    const now = Date.now();
    const history = [...(prev?.history ?? []), { turn: next, ts: now }].slice(-this.historySize);
    state[sessionId] = { turn: next, updatedAt: now, history };
    this.save(state);
    return next;
  }

  /** Read the current turn number for a session without incrementing (0 if unseen). */
  current(sessionId: string): number {
    return this.load()[sessionId]?.turn ?? 0;
  }

  /**
   * Map a wall-clock timestamp back to the turn active at that time, using
   * the session's bounded history. Falls back to 0 (fully aged out) when
   * the session has no recorded history or the timestamp predates it.
   */
  turnAt(sessionId: string, timestampMs: number): number {
    const entry = this.load()[sessionId];
    if (!entry || entry.history.length === 0) return 0;
    let matched = 0;
    for (const snapshot of entry.history) {
      if (snapshot.ts <= timestampMs) matched = snapshot.turn;
      else break;
    }
    return matched;
  }

  private load(): TurnCounterState {
    try {
      if (!existsSync(this.path)) return {};
      return JSON.parse(readFileSync(this.path, 'utf-8')) as TurnCounterState;
    } catch {
      return {};
    }
  }

  private save(state: TurnCounterState): void {
    try {
      const dir = dirname(this.path);
      if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
      writeFileSync(this.path, JSON.stringify(state));
    } catch {
      // best-effort persistence — degrades to in-memory-only counting, never throws
    }
  }

  private prune(state: TurnCounterState): TurnCounterState {
    const now = Date.now();
    const pruned: TurnCounterState = {};
    for (const [sessionId, entry] of Object.entries(state)) {
      if (now - entry.updatedAt <= this.ttlMs) pruned[sessionId] = entry;
    }
    return pruned;
  }
}

export const defaultTurnCounter = new TurnCounter();
