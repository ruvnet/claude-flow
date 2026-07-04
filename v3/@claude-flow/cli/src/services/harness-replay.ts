/**
 * Deterministic replay engine (ADR-176 phase 3).
 *
 * The `replay == deterministic` predicate in Invariant Q (qualification) and in
 * accept() requires re-executing a recorded run's inputs and confirming they
 * reproduce the recorded outputs. This module records an output DIGEST at
 * capture time and verifies a replay reproduces it — so a trajectory only
 * counts as training data / promotion evidence if its behavior is reproducible.
 * Zero deps, $0.
 */
import * as fs from 'fs';
import * as path from 'path';
import { createHash } from 'crypto';

function stable(v: unknown): string {
  const c = (x: unknown): unknown => {
    if (Array.isArray(x)) return x.map(c);
    if (x && typeof x === 'object') {
      const o: Record<string, unknown> = {};
      for (const k of Object.keys(x as Record<string, unknown>).sort()) o[k] = c((x as Record<string, unknown>)[k]);
      return o;
    }
    return x;
  };
  return JSON.stringify(c(v));
}

/** Content digest of a value (canonical, order-independent). */
export function digest(v: unknown): string {
  return createHash('sha256').update(stable(v)).digest('hex');
}

export interface RecordedRun {
  id: string;
  inputs: unknown;
  outputDigest: string;
  recordedAt?: number;
}

/** Re-executable unit: given inputs, produce outputs. Must be pure for determinism. */
export type RunFn = (inputs: unknown) => unknown;

/** Capture a run: execute once and record the output digest. */
export function recordRun(id: string, inputs: unknown, run: RunFn, ts?: number): RecordedRun {
  return { id, inputs, outputDigest: digest(run(inputs)), recordedAt: ts };
}

export interface ReplayResult { deterministic: boolean; expectedDigest: string; actualDigest: string }

/** Replay a recorded run and check it reproduces the recorded output digest. */
export function verifyReplay(recorded: RecordedRun, run: RunFn): ReplayResult {
  let actual: string;
  try { actual = digest(run(recorded.inputs)); } catch { actual = 'THREW'; }
  return { deterministic: actual === recorded.outputDigest, expectedDigest: recorded.outputDigest, actualDigest: actual };
}

/** Batch predicate for accept(): all recorded runs replay deterministically. */
export function allDeterministic(recorded: RecordedRun[], run: RunFn): boolean {
  return recorded.every(r => verifyReplay(r, run).deterministic);
}

/**
 * File-backed store of recorded runs (JSONL). Append-only with a bounded cap:
 * once it exceeds `maxEntries` it rotates to the newest `maxEntries` — so the
 * store can never grow unbounded (runaway-storage guard). `get` returns the
 * latest for an id.
 */
export class ReplayStore {
  constructor(private readonly filePath: string, private readonly maxEntries = 10000) {}

  private load(): RecordedRun[] {
    try {
      return fs.readFileSync(this.filePath, 'utf-8').split('\n').filter(Boolean).map(l => JSON.parse(l) as RecordedRun);
    } catch { return []; }
  }

  record(r: RecordedRun): void {
    try {
      fs.mkdirSync(path.dirname(this.filePath), { recursive: true });
      const existing = this.load();
      if (existing.length >= this.maxEntries) {
        const kept = existing.slice(existing.length - (this.maxEntries - 1));
        fs.writeFileSync(this.filePath, kept.concat(r).map(e => JSON.stringify(e)).join('\n') + '\n', 'utf-8');
      } else {
        fs.appendFileSync(this.filePath, JSON.stringify(r) + '\n', 'utf-8');
      }
    } catch { /* best-effort */ }
  }

  get(id: string): RecordedRun | undefined {
    const all = this.load().filter(r => r.id === id);
    return all.length ? all[all.length - 1] : undefined; // latest wins
  }

  all(): RecordedRun[] { return this.load(); }
}
