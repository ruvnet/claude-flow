/**
 * distill-oracle.test.ts — unit tests for the tiered `resolved` labeler.
 *
 * Every external boundary is MOCKED: the Tier-1 SSH runner is injected (no real
 * ssh), and the Tier-2 Fable harness is injected (no real claude / spend). The
 * suite asserts:
 *   • the ZERO-EXTERNAL-CALL default path (no opts ⇒ dry-run + structural proxy)
 *   • provenance tagging on every tier (oracle:test-exec / judge:fable / proxy:structural)
 *   • tier fallback order (oracle → fable → proxy) per trajectory
 *   • Tier-1 command construction + remote parameterization (no hard-coded host)
 *   • graceful degradation (probe failure, harness omission → proxy fallback)
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
  labelResolved,
  reflectFailures,
  buildOraclePlan,
  hasMechanicalSpec,
  resolveRemote,
  createSshOracleRunner,
  type Trajectory,
  type OracleRunner,
  type CommandExec,
} from '../../src/services/distill-oracle.js';
import type { FableHarness, JudgeResult, ReflectResult } from '../../src/services/fable-harness.js';

// A trajectory with a mechanical spec (SWE-bench shape).
const specTraj = (id: string): Trajectory => ({
  id,
  task: 'Fix the null deref in parser',
  output: 'export function parse(x){ return x?.value ?? null; }',
  testSpec: { failToPass: ['test_parse_null'], repo: 'acme/parser', baseCommit: 'abc123', patch: 'diff --git a b' },
});

// A trajectory with NO mechanical spec (only task/output).
const proseTraj = (id: string, output = 'export function add(a,b){ return a+b; }'): Trajectory => ({
  id,
  task: 'Implement add',
  output,
});

/** A runner spy that records calls and returns canned outcomes. */
function spyRunner(overrides: Partial<OracleRunner> = {}): OracleRunner & { probeCalls: number; evalCalls: number } {
  const r = {
    probeCalls: 0,
    evalCalls: 0,
    async preflight() { r.probeCalls++; return { ok: true, reason: 'ok' }; },
    async runEval() { r.evalCalls++; return { resolved: true, reason: 'FAIL_TO_PASS green' }; },
    ...overrides,
  } as OracleRunner & { probeCalls: number; evalCalls: number };
  return r;
}

/** A harness stub with only the methods labelResolved uses. */
function stubHarness(verdicts: JudgeResult[], reflections: ReflectResult[] = []): FableHarness {
  return {
    isEnabled: () => true,
    judgeBatch: vi.fn(async () => verdicts),
    reflectFailures: vi.fn(async () => reflections),
    getSpentUsd: () => 0,
  } as unknown as FableHarness;
}

describe('labelResolved — ZERO-external-call default path', () => {
  it('labels a spec trajectory via dry-run preflight + structural proxy, touching nothing', async () => {
    const runner = spyRunner();
    const harness = stubHarness([]);
    const [out] = await labelResolved([specTraj('a')], { runner, harness });

    // Provenance is the structural proxy — the honest weakest tier.
    expect(out.resolvedBy).toBe('proxy:structural');
    // The oracle plan is attached as a DRY-RUN preflight (transparency)…
    expect(out.oraclePreflight?.dryRun).toBe(true);
    expect(out.oraclePreflight?.plan.evalCommands.length).toBeGreaterThan(0);
    // …but NEITHER the SSH runner NOR the Fable harness was ever invoked.
    expect(runner.probeCalls).toBe(0);
    expect(runner.evalCalls).toBe(0);
    expect(harness.judgeBatch).not.toHaveBeenCalled();
    expect(typeof out.resolved).toBe('boolean');
    expect(typeof out.resolvedConfidence).toBe('number');
  });

  it('labels a prose trajectory via structural proxy only', async () => {
    const [good] = await labelResolved([proseTraj('g')]);
    expect(good.resolvedBy).toBe('proxy:structural');
    expect(good.resolved).toBe(true); // clean code passes structural signals

    const [bad] = await labelResolved([proseTraj('b', 'I cannot help with that.')]);
    expect(bad.resolvedBy).toBe('proxy:structural');
    expect(bad.resolved).toBe(false); // refusal → not resolved
  });

  it('preserves passthrough fields and ids', async () => {
    const t: Trajectory = { id: 'keep', task: 'x', output: 'export const y=1;', extra: 42 };
    const [out] = await labelResolved([t]);
    expect(out.id).toBe('keep');
    expect((out as { extra?: number }).extra).toBe(42);
  });
});

describe('labelResolved — Tier 1 mechanical oracle (execute)', () => {
  it('runs the real eval and tags oracle:test-exec on success', async () => {
    const runner = spyRunner();
    const [out] = await labelResolved([specTraj('a')], { remote: 'testhost', execute: true, runner });
    expect(out.resolvedBy).toBe('oracle:test-exec');
    expect(out.resolved).toBe(true);
    expect(out.resolvedConfidence).toBe(1);
    expect(out.oraclePreflight?.dryRun).toBe(false);
    expect(runner.probeCalls).toBe(1);
    expect(runner.evalCalls).toBe(1);
  });

  it('propagates a failing eval as resolved=false with oracle provenance', async () => {
    const runner = spyRunner({ async runEval() { return { resolved: false, reason: 'still red' }; } });
    const [out] = await labelResolved([specTraj('a')], { remote: 'testhost', execute: true, runner });
    expect(out.resolvedBy).toBe('oracle:test-exec');
    expect(out.resolved).toBe(false);
    expect(out.resolvedReason).toContain('still red');
  });

  it('falls through to the proxy when the preflight probe fails (non-fatal)', async () => {
    const runner = spyRunner({ async preflight() { return { ok: false, reason: 'ssh unreachable' }; } });
    const [out] = await labelResolved([specTraj('a')], { remote: 'testhost', execute: true, runner });
    expect(out.resolvedBy).toBe('proxy:structural'); // probe failed → fell through
    expect(runner.evalCalls).toBe(0); // never ran the eval after a failed probe
    expect(out.oraclePreflight?.probe?.ok).toBe(false);
    expect(out.oraclePreflight?.fellThroughBecause).toContain('preflight failed');
  });
});

describe('labelResolved — Tier 2 Fable judge (opt-in + budget)', () => {
  it('judges prose trajectories via the harness and tags judge:fable', async () => {
    const harness = stubHarness([{ id: 'g', resolved: true, confidence: 0.77, reason: 'looks correct' }]);
    const [out] = await labelResolved([proseTraj('g')], { fableJudge: true, maxBudgetUsd: 1, harness });
    expect(out.resolvedBy).toBe('judge:fable');
    expect(out.resolved).toBe(true);
    expect(out.resolvedConfidence).toBeCloseTo(0.77, 2);
    expect(out.resolvedReason).toBe('looks correct');
    expect(harness.judgeBatch).toHaveBeenCalledTimes(1);
  });

  it('does NOT call fable when fableJudge is set but no budget cap is given', async () => {
    const harness = stubHarness([{ id: 'g', resolved: true, confidence: 1, reason: 'x' }]);
    const [out] = await labelResolved([proseTraj('g')], { fableJudge: true, harness }); // no maxBudgetUsd
    expect(out.resolvedBy).toBe('proxy:structural');
    expect(harness.judgeBatch).not.toHaveBeenCalled();
  });

  it('falls back to proxy for any id the model omits', async () => {
    const harness = stubHarness([{ id: 'g0', resolved: false, confidence: 0.2, reason: 'wrong' }]); // omits g1
    const out = await labelResolved([proseTraj('g0'), proseTraj('g1')], { fableJudge: true, maxBudgetUsd: 1, harness });
    expect(out[0].resolvedBy).toBe('judge:fable');
    expect(out[1].resolvedBy).toBe('proxy:structural');
  });
});

describe('labelResolved — tier fallback ORDER', () => {
  it('spec + execute:false + fableJudge ⇒ dry-run oracle THEN fable (order preserved)', async () => {
    const runner = spyRunner();
    const harness = stubHarness([{ id: 'a', resolved: true, confidence: 0.9, reason: 'judged' }]);
    const [out] = await labelResolved([specTraj('a')], { fableJudge: true, maxBudgetUsd: 1, runner, harness });
    // Tier 1 was dry-run (no exec) so it fell through to Tier 2 (fable).
    expect(out.resolvedBy).toBe('judge:fable');
    expect(out.oraclePreflight?.dryRun).toBe(true); // Tier-1 plan still attached
    expect(runner.evalCalls).toBe(0); // never executed
  });

  it('mixed batch: spec+execute → oracle, prose → fable, refusal via fable', async () => {
    const runner = spyRunner();
    const harness = stubHarness([{ id: 'p', resolved: false, confidence: 0.3, reason: 'incomplete' }]);
    const out = await labelResolved([specTraj('s'), proseTraj('p')], {
      remote: 'h', execute: true, fableJudge: true, maxBudgetUsd: 1, runner, harness,
    });
    const byId = Object.fromEntries(out.map((o) => [o.id, o.resolvedBy]));
    expect(byId['s']).toBe('oracle:test-exec');
    expect(byId['p']).toBe('judge:fable');
  });
});

describe('buildOraclePlan — command construction & remote parameterization', () => {
  it('builds a SWE-bench eval plan and injects the remote host (never hard-coded)', () => {
    const plan = buildOraclePlan(
      { failToPass: ['t_a', 't_b'], passToPass: ['t_c'], repo: 'acme/x', baseCommit: 'deadbeef', patch: 'diff' },
      'my-remote-host',
    );
    expect(plan.kind).toBe('ssh-swebench-eval');
    expect(plan.remote).toBe('my-remote-host');
    const all = [...plan.probeCommands, ...plan.evalCommands].join('\n');
    expect(all).toContain('my-remote-host');
    expect(all).toContain('--fail-to-pass');
    expect(all).not.toMatch(/ruvultra|\d+\.\d+\.\d+\.\d+/); // no hard-coded host or IP
    expect(plan.probeCommands.some((c) => c.includes('command -v docker'))).toBe(true);
  });

  it('builds a darwin bench-suite plan when benchSuite/benchCase present', () => {
    const plan = buildOraclePlan({ benchSuite: 'shield', benchCase: 'cve-42' }, 'h');
    expect(plan.kind).toBe('ssh-darwin-bench');
    expect(plan.evalCommands.join(' ')).toContain('darwin bench run');
    expect(plan.evalCommands.join(' ')).toContain("--suite 'shield'");
  });

  it('renders a <remote> placeholder (not a real host) when no remote is configured', () => {
    const plan = buildOraclePlan({ evalCommand: 'pytest -q' }, null);
    expect(plan.remote).toBeNull();
    expect(plan.evalCommands.join(' ')).toContain('<remote>');
    expect(plan.evalCommands.join(' ')).toContain('pytest -q');
  });
});

describe('createSshOracleRunner — mocked SSH exec', () => {
  it('runs each plan command via sh -c and reports resolved on exit 0', async () => {
    const calls: Array<{ cmd: string; args: string[] }> = [];
    const exec: CommandExec = async (cmd, args) => {
      calls.push({ cmd, args });
      return { stdout: '{"passed":true}', stderr: '', code: 0 };
    };
    const runner = createSshOracleRunner(exec);
    const plan = buildOraclePlan({ failToPass: ['t'], repo: 'r' }, 'host');
    const probe = await runner.preflight(plan);
    expect(probe.ok).toBe(true);
    const outcome = await runner.runEval(plan, { failToPass: ['t'] });
    expect(outcome.resolved).toBe(true);
    // Every shell-out went through `sh -c <fully-rendered-command>`.
    expect(calls.every((c) => c.cmd === 'sh' && c.args[0] === '-c')).toBe(true);
  });

  it('interprets json passed:false as NOT resolved', async () => {
    const exec: CommandExec = async () => ({ stdout: '{"passed":false}', stderr: '', code: 0 });
    const runner = createSshOracleRunner(exec);
    const plan = buildOraclePlan({ evalCommand: 'run' }, 'host');
    const outcome = await runner.runEval(plan, { evalCommand: 'run' });
    expect(outcome.resolved).toBe(false);
  });

  it('reports probe failure (non-zero exit) without throwing', async () => {
    const exec: CommandExec = async () => ({ stdout: '', stderr: 'connection refused', code: 255 });
    const runner = createSshOracleRunner(exec);
    const plan = buildOraclePlan({ evalCommand: 'run' }, 'host');
    const probe = await runner.preflight(plan);
    expect(probe.ok).toBe(false);
    expect(probe.reason).toContain('probe failed');
  });

  it('preflight is false when no remote is configured', async () => {
    const exec: CommandExec = vi.fn(async () => ({ stdout: '', stderr: '', code: 0 }));
    const runner = createSshOracleRunner(exec as unknown as CommandExec);
    const plan = buildOraclePlan({ evalCommand: 'run' }, null);
    const probe = await runner.preflight(plan);
    expect(probe.ok).toBe(false);
    expect(exec).not.toHaveBeenCalled(); // no remote ⇒ no shell-out at all
  });
});

describe('helpers', () => {
  it('hasMechanicalSpec detects actionable specs only', () => {
    expect(hasMechanicalSpec(specTraj('a'))).toBe(true);
    expect(hasMechanicalSpec({ id: 'x', testSpec: { benchSuite: 's' } })).toBe(true);
    expect(hasMechanicalSpec({ id: 'x', testSpec: { repo: 'only-repo' } })).toBe(false);
    expect(hasMechanicalSpec(proseTraj('p'))).toBe(false);
  });

  describe('resolveRemote', () => {
    const saved = process.env.RUFLO_DISTILL_REMOTE;
    beforeEach(() => { delete process.env.RUFLO_DISTILL_REMOTE; });
    afterEach(() => { if (saved === undefined) delete process.env.RUFLO_DISTILL_REMOTE; else process.env.RUFLO_DISTILL_REMOTE = saved; });

    it('prefers explicit opt, then env, then null', () => {
      expect(resolveRemote('explicit')).toBe('explicit');
      process.env.RUFLO_DISTILL_REMOTE = 'from-env';
      expect(resolveRemote()).toBe('from-env');
      delete process.env.RUFLO_DISTILL_REMOTE;
      expect(resolveRemote()).toBeNull();
    });
  });
});

describe('reflectFailures', () => {
  it('is a no-op ($0) without a budget cap', async () => {
    const out = await reflectFailures([{ id: 'a', task: 't', output: 'o' }]);
    expect(out).toEqual([]);
  });

  it('delegates to an enabled harness', async () => {
    const harness = stubHarness([], [{ id: 'a', failureClass: 'oops', diagnosis: 'd', mutationHint: 'm' }]);
    const out = await reflectFailures([{ id: 'a', task: 't', output: 'o' }], { harness });
    expect(out).toEqual([{ id: 'a', failureClass: 'oops', diagnosis: 'd', mutationHint: 'm' }]);
  });
});
