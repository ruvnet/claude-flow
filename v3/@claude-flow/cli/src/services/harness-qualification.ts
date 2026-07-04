/**
 * Qualification + anti-pattern archive (ADR-176 phase 1).
 *
 * Separates OBSERVATION from TRAINING DATA. Raw observed trajectories are NOT
 * training data — they enter optimization only through the Qualification gate,
 * which enforces:
 *
 *   Invariant Q: a trajectory is admitted iff it has
 *     (a) complete provenance   — every step attributed, tier >= oracle/judge
 *                                  (ADR-171; proxy:structural is triage-only),
 *     (b) deterministic replay   — re-running its recorded inputs reproduces its
 *                                  recorded outputs, and
 *     (c) benchmark attribution  — it maps to a task in the versioned corpus.
 *
 * Rejected trajectories are not discarded — they are recorded to the
 * ANTI-PATTERN ARCHIVE (negative learning), so future optimization runs avoid
 * re-discovering identical failures. Zero dependencies, $0.
 */
import * as fs from 'fs';
import * as path from 'path';
import { createHash } from 'crypto';

export type ProvenanceTier = 'oracle:test-exec' | 'judge:fable' | 'proxy:structural';

export interface TrajectoryStep {
  action: string;
  tier: ProvenanceTier;
}

export interface Trajectory {
  id: string;
  steps: TrajectoryStep[];
  outcome: 'success' | 'failure';
  benchmarkTaskId?: string;   // (c) benchmark attribution
  inputs: unknown;            // replay inputs
  recordedOutputs: unknown;   // recorded outputs, for the (b) determinism check
}

/** Re-execute a trajectory's recorded inputs and return the outputs. */
export type ReplayFn = (t: Trajectory) => unknown;

export interface QualificationResult { qualified: boolean; reasons: string[] }

/** Deterministic JSON for the replay comparison (recursively key-sorted). */
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

/** Fingerprint a trajectory by its shape (step actions + outcome) so identical failures dedupe. */
export function fingerprintTrajectory(t: Trajectory): string {
  const shape = t.steps.map(s => s.action).join('→') + '#' + t.outcome + '#' + (t.benchmarkTaskId ?? '');
  return createHash('sha256').update(shape).digest('hex').slice(0, 32);
}

/**
 * Invariant Q. `replay` is required — determinism cannot be asserted without
 * re-executing; a trajectory with no verifiable replay is REJECTED (fail-closed).
 */
export function qualifyTrajectory(t: Trajectory, replay?: ReplayFn): QualificationResult {
  const reasons: string[] = [];

  // (a) complete provenance
  if (!t.steps || t.steps.length === 0) reasons.push('incomplete: no steps');
  else {
    if (t.steps.some(s => !s.action)) reasons.push('incomplete provenance: a step has no action');
    if (t.steps.some(s => s.tier === 'proxy:structural')) reasons.push('proxy-tier step present (below oracle/judge; ADR-171)');
  }

  // (c) benchmark attribution
  if (!t.benchmarkTaskId) reasons.push('no benchmark attribution');

  // (b) deterministic replay
  if (!replay) {
    reasons.push('deterministic replay not verified (no replay fn)');
  } else {
    let out: unknown;
    try { out = replay(t); } catch (e) { reasons.push(`replay threw: ${(e as Error)?.message ?? e}`); out = undefined; }
    if (reasons.every(r => !r.startsWith('replay threw')) && stable(out) !== stable(t.recordedOutputs)) {
      reasons.push('replay non-deterministic (outputs differ from recorded)');
    }
  }

  return { qualified: reasons.length === 0, reasons };
}

// ── Anti-pattern archive (negative learning) ────────────────────────────────

export interface AntiPattern {
  fingerprint: string;
  stage: string;       // where it was rejected (qualification | verify | canary | accept)
  reasons: string[];
  ts: number;
}

/**
 * File-backed avoid-list of rejected trajectories/mutations. JSONL, append-only
 * with a bounded cap: once the file exceeds `maxEntries` it is rewritten to the
 * newest `maxEntries` (rotation), so the archive can never grow unbounded —
 * runaway-storage guard. Deduped by fingerprint at the call site.
 */
export class AntiPatternArchive {
  constructor(private readonly filePath: string, private readonly maxEntries = 10000) {}

  private load(): AntiPattern[] {
    try {
      return fs.readFileSync(this.filePath, 'utf-8').split('\n').filter(Boolean).map(l => JSON.parse(l) as AntiPattern);
    } catch { return []; }
  }

  record(entry: AntiPattern): void {
    try {
      fs.mkdirSync(path.dirname(this.filePath), { recursive: true });
      const existing = this.load();
      if (existing.length >= this.maxEntries) {
        // Rotate: keep the newest (maxEntries-1) + the new entry.
        const kept = existing.slice(existing.length - (this.maxEntries - 1));
        fs.writeFileSync(this.filePath, kept.concat(entry).map(e => JSON.stringify(e)).join('\n') + '\n', 'utf-8');
      } else {
        fs.appendFileSync(this.filePath, JSON.stringify(entry) + '\n', 'utf-8');
      }
    } catch { /* best-effort */ }
  }

  has(fingerprint: string): boolean {
    return this.load().some(a => a.fingerprint === fingerprint);
  }

  list(): AntiPattern[] { return this.load(); }
}

export interface AdmissionReport {
  qualified: Trajectory[];
  rejected: Array<{ id: string; reasons: string[] }>;
  admittedCount: number;
  rejectedCount: number;
}

/**
 * Admit a batch of observed trajectories into the candidate dataset. Rejects are
 * recorded to the anti-pattern archive (deduped by fingerprint).
 */
export function admitTrajectories(
  trajectories: Trajectory[],
  opts: { replay?: ReplayFn; archive?: AntiPatternArchive; ts?: number } = {},
): AdmissionReport {
  const qualified: Trajectory[] = [];
  const rejected: Array<{ id: string; reasons: string[] }> = [];
  const ts = opts.ts ?? Date.now();

  for (const t of trajectories) {
    const r = qualifyTrajectory(t, opts.replay);
    if (r.qualified) {
      qualified.push(t);
    } else {
      rejected.push({ id: t.id, reasons: r.reasons });
      const fp = fingerprintTrajectory(t);
      if (opts.archive && !opts.archive.has(fp)) {
        opts.archive.record({ fingerprint: fp, stage: 'qualification', reasons: r.reasons, ts });
      }
    }
  }

  return { qualified, rejected, admittedCount: qualified.length, rejectedCount: rejected.length };
}
