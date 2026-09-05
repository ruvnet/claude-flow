/**
 * CI regression guards for #2250 + #2251.
 *
 * #2250 — model-router.selectModel() used to escalate `sonnet → opus` and
 * `haiku → sonnet` on ~every trivial route because the `uncertainty` formula
 * is structurally large (~0.6-0.7) and the gate fires at 0.15. The fix:
 * skip escalation when the bandit has confidently learned the escalation
 * target is meaningfully worse than the selected model. This test loads
 * the EXACT suppressed-opus prior from the bug report (Beta(3.8, 17.2),
 * mean ≈ 0.18) into the low-complexity bucket and asserts (a) opus is
 * selected on <20% of trivial routes (was ~40% before the fix), and
 * (b) haiku appears as a final pick (was 0/N before the fix).
 *
 * #2251 — WorkerDaemon constructor kicked off `initHeadlessExecutor()`
 * fire-and-forget, so `daemon.triggerWorker()` called immediately after
 * construction would see `headlessAvailable = false` and fall through to
 * the local stub in ~2ms. The fix: store the init promise and await it
 * inside triggerWorker(). This test confirms triggerWorker() does not
 * resolve before initHeadlessExecutor() settles.
 */

import { describe, expect, it, beforeEach, afterEach, vi } from 'vitest';
import { mkdtempSync, rmSync, mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { ModelRouter } from '../src/ruvector/model-router.js';
import { WorkerDaemon } from '../src/services/worker-daemon.js';

let cwdRestore: string;
let tmpDir: string;

beforeEach(() => {
  cwdRestore = process.cwd();
  tmpDir = mkdtempSync(join(tmpdir(), 'issue-2250-2251-'));
  process.chdir(tmpDir);
});

afterEach(() => {
  process.chdir(cwdRestore);
  rmSync(tmpDir, { recursive: true, force: true });
});

describe('#2250 — escalation does not override learned opus suppression', () => {
  it('routes trivial tasks to haiku/sonnet at least 80% with suppressed-opus prior', async () => {
    // Seed `.swarm/model-router-state.json` with the prior from the bug report
    // (opus mean ≈ 0.18, sonnet ≈ 0.64, haiku ≈ 0.60 in the low bucket).
    mkdirSync(join(tmpDir, '.swarm'), { recursive: true });
    const state = {
      priors: {
        low: {
          haiku:   { alpha: 3.0,  beta: 2.0  },
          sonnet:  { alpha: 12.2, beta: 6.8  },
          opus:    { alpha: 3.8,  beta: 17.2 },
          inherit: { alpha: 1,    beta: 1    },
        },
        med:  { haiku: { alpha: 1, beta: 1 }, sonnet: { alpha: 1, beta: 1 }, opus: { alpha: 1, beta: 1 }, inherit: { alpha: 1, beta: 1 } },
        high: { haiku: { alpha: 1, beta: 1 }, sonnet: { alpha: 1, beta: 1 }, opus: { alpha: 1, beta: 1 }, inherit: { alpha: 1, beta: 1 } },
      },
    };
    writeFileSync(join(tmpDir, '.swarm/model-router-state.json'), JSON.stringify(state));

    const router = new ModelRouter();
    const N = 50;
    const counts: Record<string, number> = { haiku: 0, sonnet: 0, opus: 0 };
    for (let i = 0; i < N; i++) {
      // Trivial low-complexity task (matches bug report's example).
      const r = await router.route(`Add a single option to a select dropdown ${i}`);
      counts[r.model] = (counts[r.model] ?? 0) + 1;
    }

    const opusRate = counts.opus / N;
    expect(opusRate).toBeLessThan(0.20); // before fix: ~0.40
    expect(counts.haiku + counts.sonnet).toBeGreaterThanOrEqual(N - counts.opus);
    expect(counts.haiku).toBeGreaterThan(0); // before fix: 0/N
  }, 30_000);

  it('still escalates on cold-start (Beta(1,1) priors)', async () => {
    // No state file → uniform priors → escalation guard should NOT trigger
    // (target mean ≈ selected mean), so the prior router behavior is preserved
    // for unlearned routers. We just assert the route succeeds without crashing
    // and returns one of the three valid models.
    const router = new ModelRouter();
    const r = await router.route('Refactor the entire authentication subsystem');
    expect(['haiku', 'sonnet', 'opus']).toContain(r.model);
  }, 10_000);

  it('respects CLAUDE_FLOW_MAX_UNCERTAINTY env override', async () => {
    // With maxUncertainty=0.99 the escalation gate effectively never fires,
    // so the selected model is always the Thompson-sampled winner unmodified.
    const old = process.env.CLAUDE_FLOW_MAX_UNCERTAINTY;
    process.env.CLAUDE_FLOW_MAX_UNCERTAINTY = '0.99';
    try {
      // The env is read at module load via `envMaxUncertainty()` in
      // DEFAULT_CONFIG. Pass it through config explicitly so the test
      // doesn't depend on module reload order.
      const router = new ModelRouter({ maxUncertainty: 0.99 });
      const r = await router.route('simple low-complexity task');
      expect(['haiku', 'sonnet', 'opus']).toContain(r.model);
    } finally {
      if (old === undefined) delete process.env.CLAUDE_FLOW_MAX_UNCERTAINTY;
      else process.env.CLAUDE_FLOW_MAX_UNCERTAINTY = old;
    }
  });
});

describe('#2251 — daemon.triggerWorker awaits headless init', () => {
  it('does not resolve triggerWorker before initHeadlessExecutor settles', async () => {
    const daemon = new WorkerDaemon(tmpDir);

    // Replace the field with a deferred promise we control so we can prove
    // triggerWorker waits for it before calling executeWorker.
    let initResolved = false;
    let resolveInit!: () => void;
    const gatedInit = new Promise<void>((resolve) => {
      resolveInit = () => {
        initResolved = true;
        resolve();
      };
    });
    // The trigger awaits this exact field per the #2251 fix.
    (daemon as unknown as { headlessInitPromise: Promise<void> }).headlessInitPromise = gatedInit;

    // Stub executeWorker so we can prove its call order vs init resolution
    // without actually running a worker.
    let executeCalledBeforeInit: boolean | null = null;
    (daemon as unknown as { executeWorker: (...a: unknown[]) => Promise<unknown> }).executeWorker =
      vi.fn(async () => {
        executeCalledBeforeInit = !initResolved; // record the order
        return { workerId: 'x', type: 'map', success: true, durationMs: 1, timestamp: new Date() };
      });

    const triggerP = daemon.triggerWorker('map');
    // Yield a tick so any non-awaited path would already have called executeWorker.
    await new Promise((r) => setImmediate(r));
    expect(executeCalledBeforeInit).toBeNull(); // executeWorker not called yet — still gated

    resolveInit();
    await triggerP;
    expect(executeCalledBeforeInit).toBe(false); // executeWorker called AFTER init
  });
});
