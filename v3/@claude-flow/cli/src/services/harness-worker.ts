/**
 * Harness loop daemon worker (ADR-176 phase 8, part 2).
 *
 * Runs runHarnessLoop() on the daemon's schedule — but strictly bounded, given
 * the runaway-resource posture:
 *   - OPT-IN: no-op unless RUFLO_HARNESS_LOOP is truthy. The self-optimizing
 *     loop never runs autonomously without an explicit opt-in.
 *   - $0: with no optimizer/verifier/canary wired (the default), runHarnessLoop
 *     qualifies + benchmarks but promotes nothing (fail-closed). No LLM, no
 *     metaharness subprocess, no spend unless the operator opts those in too.
 *   - bounded: trajectories capped per tick; the daemon adds single-flight
 *     (maxConcurrent) + a 16-min worker timeout + TTL/idle shutdown.
 *   - never throws: a worker must not crash the daemon.
 *
 * On acceptance it STAGES the (unsigned) champion manifest for the separate
 * publish/sign step — the worker never signs (no key material in the daemon).
 */
import * as fs from 'fs';
import * as path from 'path';
import { runHarnessLoop, type HarnessLoopOptions, type HarnessLoopResult } from './harness-loop.js';

export const STAGED_CHAMPION_FILE = 'harness-champion.manifest.json';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type HarnessWorkerInput = HarnessLoopOptions<any>;
export type LoadHarnessInput = (projectRoot: string) => HarnessWorkerInput | null;

/** No built-in input source yet — the operator wires a corpus + optimizer. */
const defaultLoadInput: LoadHarnessInput = () => null;

export interface HarnessWorkerResult {
  ran: boolean;
  reason: string;
  accepted?: boolean;
  staged?: boolean;
  admitted?: number;
  rejected?: number;
}

export function harnessLoopOptedIn(): boolean {
  return /^(1|true|yes|on)$/i.test(process.env.RUFLO_HARNESS_LOOP ?? '');
}

/**
 * Execute one bounded, opt-in harness-loop tick for `projectRoot`. Injectable
 * `loadInput`/`optInOverride` for tests. Best-effort; never throws.
 */
export async function runHarnessLoopWorker(
  projectRoot: string,
  opts: { loadInput?: LoadHarnessInput; maxTrajectories?: number; optInOverride?: boolean } = {},
): Promise<HarnessWorkerResult> {
  try {
    const optedIn = opts.optInOverride ?? harnessLoopOptedIn();
    if (!optedIn) return { ran: false, reason: 'opt-in required (RUFLO_HARNESS_LOOP=1)' };

    const input = (opts.loadInput ?? defaultLoadInput)(projectRoot);
    if (!input) return { ran: false, reason: 'no harness input (corpus/optimizer) configured' };

    const cap = opts.maxTrajectories ?? 2000;
    const bounded: HarnessWorkerInput = { ...input, trajectories: input.trajectories.slice(0, cap) };
    const result: HarnessLoopResult = await runHarnessLoop(bounded);

    let staged = false;
    if (result.accepted && result.manifest) {
      // Stage the UNSIGNED champion for the separate publish/sign step.
      try {
        const dir = path.join(projectRoot, '.claude-flow');
        fs.mkdirSync(dir, { recursive: true });
        fs.writeFileSync(path.join(dir, STAGED_CHAMPION_FILE), JSON.stringify(result.manifest, null, 2), 'utf-8');
        staged = true;
      } catch { /* non-fatal */ }
    }

    return {
      ran: true,
      reason: result.reason,
      accepted: result.accepted,
      staged,
      admitted: result.admitted,
      rejected: result.rejected,
    };
  } catch (e) {
    return { ran: false, reason: `error: ${(e as Error)?.message ?? e}` };
  }
}
