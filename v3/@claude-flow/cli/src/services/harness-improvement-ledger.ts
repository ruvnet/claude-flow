/**
 * Improvement ledger — the proof-of-improvement surface for the self-optimizing
 * flywheel (ADR-176). Every mint ATTEMPT (accepted or rejected) is appended to a
 * bounded, append-only JSONL. Because runHarnessLoop only ACCEPTS a strict
 * improvement (held_out_improves AND canary-no-worse AND anchor-no-regress), the
 * subsequence of accepted champions is monotonically non-decreasing in held-out
 * score BY CONSTRUCTION — and each accepted entry chains to its predecessor via
 * baselineRef == previous championRef. summarizeImprovement() turns that into an
 * auditable claim: "N champions shipped, each strictly beat the last, cumulative
 * +X; M attempts refused (the gate is not a rubber stamp)."
 *
 * Pure Node, $0. Rotation-capped so an always-on daemon can't grow it unbounded.
 */
import * as fs from 'fs';
import * as path from 'path';

export const LEDGER_FILE = 'harness-improvement.jsonl';
const MAX_ENTRIES = 5000; // rotation cap (keeps the most-recent tail)

export interface LedgerEntry {
  ts: number;
  corpusVersion: string;
  corpusHash: string;
  corpusSize: number;
  anchorSize: number;            // human-labeled anchor tasks in the corpus
  baselineRef: string;           // policy ref of the incumbent (active champion or shipped defaults)
  candidateRef: string;
  baselineScore: number;         // held-out fitness of the incumbent
  candidateScore: number;        // held-out fitness of the candidate
  delta: number;                 // candidate - baseline
  deltaCILow?: number;           // one-sided 95% bootstrap lower bound on the per-task delta
  significant?: boolean;         // deltaCILow > 0 — the gain is not small-N noise
  loopAccepted?: boolean;        // the accept() conjunction verdict (before the significance gate)
  anchorRegressed: boolean;      // did the candidate regress on the human anchor?
  accepted: boolean;             // FINAL decision = loopAccepted AND significant (what actually applied)
  gates: Record<string, boolean>;// accept() terms, for audit
  championRef?: string;          // == candidateRef when accepted
  reason: string;
}

/**
 * One-sided 95% bootstrap lower bound on the mean of paired per-task deltas.
 * Deterministic (seeded LCG) so the confidence bound is reproducible — the same
 * evidence yields the same verdict. A positive lower bound means the improvement
 * survives resampling: it is not an artifact of a lucky held-out task (small-N
 * noise guard, "measured not marketing").
 */
export function bootstrapDeltaCILow(deltas: number[], opts: { iters?: number; alpha?: number; seed?: number } = {}): number {
  const n = deltas.length;
  if (n === 0) return 0;
  const iters = opts.iters ?? 2000;
  const alpha = opts.alpha ?? 0.05;
  let seed = (opts.seed ?? 0x9e3779b1) >>> 0;
  const rnd = () => { seed = (1664525 * seed + 1013904223) >>> 0; return seed / 4294967296; };
  const means: number[] = new Array(iters);
  for (let b = 0; b < iters; b++) {
    let s = 0;
    for (let i = 0; i < n; i++) s += deltas[Math.floor(rnd() * n)];
    means[b] = s / n;
  }
  means.sort((a, b) => a - b);
  return means[Math.floor(alpha * iters)];
}

export interface ImprovementSummary {
  attempts: number;
  accepted: number;
  rejected: number;
  cumulativeDelta: number;       // sum of accepted deltas
  currentScore: number | null;   // held-out score of the latest champion
  firstScore: number | null;     // baseline of the first accepted champion
  monotonic: boolean;            // every accepted candidate strictly beat its baseline AND chained correctly
  chainIntact: boolean;          // each accepted.baselineRef == previous accepted.championRef
  trajectory: Array<{ ts: number; corpusVersion: string; baseline: number; candidate: number; delta: number; accepted: boolean }>;
}

function ledgerPath(dir: string): string {
  return path.join(dir, LEDGER_FILE);
}

/** Append one attempt. Best-effort, never throws; rotates when over the cap. */
export function appendLedger(dir: string, entry: LedgerEntry): void {
  try {
    fs.mkdirSync(dir, { recursive: true });
    const p = ledgerPath(dir);
    fs.appendFileSync(p, JSON.stringify(entry) + '\n', 'utf-8');
    // Rotate: if too many lines, keep the most-recent MAX_ENTRIES.
    const lines = fs.readFileSync(p, 'utf-8').split('\n').filter(Boolean);
    if (lines.length > MAX_ENTRIES) {
      fs.writeFileSync(p, lines.slice(lines.length - MAX_ENTRIES).join('\n') + '\n', 'utf-8');
    }
  } catch { /* non-fatal */ }
}

/** Read all ledger entries (oldest → newest). Never throws. */
export function readLedger(dir: string): LedgerEntry[] {
  try {
    const raw = fs.readFileSync(ledgerPath(dir), 'utf-8');
    return raw.split('\n').filter(Boolean).map((l) => JSON.parse(l) as LedgerEntry);
  } catch { return []; }
}

/**
 * Fold the ledger into an auditable improvement claim. Monotonicity + chain
 * integrity are the PROOF: they hold iff every shipped champion strictly beat
 * its predecessor and referenced it. A single violation flips the flag — the
 * summary cannot silently launder a regression.
 */
export function summarizeImprovement(dir: string): ImprovementSummary {
  const all = readLedger(dir);
  const accepted = all.filter((e) => e.accepted);
  let monotonic = true;
  let chainIntact = true;
  for (let i = 0; i < accepted.length; i++) {
    if (!(accepted[i].candidateScore > accepted[i].baselineScore)) monotonic = false;
    if (accepted[i].anchorRegressed) monotonic = false;
    if (i > 0 && accepted[i].baselineRef !== accepted[i - 1].championRef) chainIntact = false;
  }
  return {
    attempts: all.length,
    accepted: accepted.length,
    rejected: all.length - accepted.length,
    cumulativeDelta: accepted.reduce((s, e) => s + e.delta, 0),
    currentScore: accepted.length ? accepted[accepted.length - 1].candidateScore : null,
    firstScore: accepted.length ? accepted[0].baselineScore : null,
    monotonic,
    chainIntact,
    trajectory: all.map((e) => ({ ts: e.ts, corpusVersion: e.corpusVersion, baseline: e.baselineScore, candidate: e.candidateScore, delta: e.delta, accepted: e.accepted })),
  };
}
