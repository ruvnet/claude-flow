/**
 * Adversarial + drift verify gate (ADR-176 phase 4).
 *
 * Produces the two verdicts accept() consumes beyond held-out benchmarking:
 *   - redblue: an adversarial red-team pass (@metaharness/redblue, mock-judge/$0
 *     by default, loopback-only, cost-capped),
 *   - drift:   distance from the current champion (@metaharness/drift_from_history).
 *
 * FAIL-CLOSED: if the adversarial verifier is unavailable (metaharness is an
 * optional dependency — ADR-150), redblue is SKIPPED, and since accept() requires
 * redblue === 'PASS', a candidate CANNOT be promoted without real adversarial
 * evidence. The loop then safely degrades to "observe + benchmark, don't
 * promote" and the current signed champion stands. Runners are injectable so the
 * orchestrator supplies the real metaharness bridge; defaults degrade. $0.
 */
export type RedblueVerdict = 'PASS' | 'FAIL' | 'SKIPPED';
export type RedblueRunner = () => Promise<RedblueVerdict>;
/** Returns the drift distance from the champion (>=0), or a negative value = unavailable. */
export type DriftRunner = () => Promise<number>;

export interface VerifyResult {
  redblue: RedblueVerdict;
  drift: number;
  driftThreshold: number;
  driftVerdict: 'ok' | 'regressed' | 'skipped';
  adversarialPass: boolean; // redblue PASS AND drift ok — the pre-promotion verify verdict
}

export interface VerifyOptions {
  redblue?: RedblueRunner;   // default: SKIPPED (degrade — no metaharness wired here)
  drift?: DriftRunner;       // default: 0 (no baseline drift)
  driftThreshold?: number;   // default 0.05
}

/** Default redblue: no verifier wired in this module → SKIPPED (fail-closed). */
const defaultRedblue: RedblueRunner = async () => 'SKIPPED';
/** Default drift: no baseline → 0. */
const defaultDrift: DriftRunner = async () => 0;

export async function runVerify(opts: VerifyOptions = {}): Promise<VerifyResult> {
  const driftThreshold = opts.driftThreshold ?? 0.05;

  let redblue: RedblueVerdict;
  try { redblue = await (opts.redblue ?? defaultRedblue)(); }
  catch { redblue = 'SKIPPED'; } // a throwing verifier is not a PASS

  let drift: number;
  try { drift = await (opts.drift ?? defaultDrift)(); }
  catch { drift = -1; }

  const driftVerdict: VerifyResult['driftVerdict'] = drift < 0 ? 'skipped' : (drift <= driftThreshold ? 'ok' : 'regressed');
  // Fail-closed: promotion requires a real PASS and a non-regressing, non-skipped drift.
  const adversarialPass = redblue === 'PASS' && driftVerdict === 'ok';

  return { redblue, drift, driftThreshold, driftVerdict, adversarialPass };
}
