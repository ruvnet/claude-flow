/**
 * fable-harness.test.ts — unit tests for the cost-disciplined Fable judge.
 *
 * Every test MOCKS the `claude -p` spawn via the injectable `spawnClaude` — no
 * test ever launches the real CLI or spends a cent. Assertions cover:
 *   • command construction (argv: -p / --model / --output-format json /
 *     --append-system-prompt / --max-budget-usd)
 *   • the fresh-empty-temp-cwd requirement (never the project dir)
 *   • batching (ceil(n / batchSize) calls)
 *   • budget-cap enforcement (spend stops launching batches)
 *   • the OFF-BY-DEFAULT guarantee — no budget cap ⇒ ZERO spawns
 *   • verdict extraction from the JSON envelope
 *
 * One optional live smoke (RUFLO_FABLE_LIVE=1) a human can run is at the end.
 */

import { describe, it, expect, vi } from 'vitest';
import { tmpdir } from 'os';
import {
  FableHarness,
  estimateFableCostUsd,
  extractVerdictArray,
  parseCostFromEnvelope,
  FABLE_COST_MODEL,
  type ClaudeSpawnFn,
  type JudgeItem,
} from '../../src/services/fable-harness.js';

/** Build a fake spawnClaude that records every call and returns a canned envelope. */
function fakeSpawn(makeResult: (batchIndex: number, argv: string[], prompt: string, cwd: string) => {
  stdout?: string;
  stderr?: string;
  code?: number | null;
  costUsd?: number;
}) {
  const calls: Array<{ argv: string[]; prompt: string; cwd: string; timeoutMs: number }> = [];
  const fn: ClaudeSpawnFn = async (argv, prompt, cwd, opts) => {
    const idx = calls.length;
    calls.push({ argv, prompt, cwd, timeoutMs: opts.timeoutMs });
    const r = makeResult(idx, argv, prompt, cwd);
    return { stdout: r.stdout ?? '', stderr: r.stderr ?? '', code: r.code ?? 0, costUsd: r.costUsd };
  };
  return { fn, calls };
}

/** Envelope shaped like `claude -p --output-format json` output. */
function envelope(verdicts: unknown[], costUsd = 0.4): string {
  return JSON.stringify({ type: 'result', result: JSON.stringify(verdicts), total_cost_usd: costUsd });
}

const items = (n: number): JudgeItem[] =>
  Array.from({ length: n }, (_, i) => ({ id: `t${i}`, task: `task ${i}`, output: `output ${i}` }));

describe('FableHarness — command construction', () => {
  it('builds argv with -p, model, json output, append-system-prompt and budget cap', () => {
    const h = new FableHarness({ maxBudgetUsd: 5, spawnClaude: async () => ({ stdout: '', stderr: '', code: 0 }) });
    const argv = h.buildArgv('JUDGE ROLE');
    expect(argv).toContain('-p');
    expect(argv).toEqual(expect.arrayContaining(['--model', 'claude-fable-5']));
    expect(argv).toEqual(expect.arrayContaining(['--output-format', 'json']));
    expect(argv).toEqual(expect.arrayContaining(['--append-system-prompt', 'JUDGE ROLE']));
    const capIdx = argv.indexOf('--max-budget-usd');
    expect(capIdx).toBeGreaterThan(-1);
    expect(Number(argv[capIdx + 1])).toBeCloseTo(5, 2);
  });

  it('runs claude from a FRESH TEMP cwd, never the project dir', async () => {
    const { fn, calls } = fakeSpawn(() => ({ stdout: envelope([{ id: 't0', resolved: true, confidence: 0.9, reason: 'ok' }]) }));
    const h = new FableHarness({ maxBudgetUsd: 5, spawnClaude: fn });
    await h.judgeBatch(items(1));
    expect(calls).toHaveLength(1);
    expect(calls[0].cwd).toContain('ruflo-fable');
    expect(calls[0].cwd).not.toBe(process.cwd());
    // Temp dir lives under the OS temp root (allow macOS /private symlink drift).
    expect(calls[0].cwd.includes(tmpdir()) || calls[0].cwd.includes('ruflo-fable')).toBe(true);
    // The prompt piped to stdin is the batch JSON, not an argv positional.
    expect(calls[0].prompt).toContain('task 0');
    expect(calls[0].argv).not.toContain('task 0');
  });
});

describe('FableHarness — off by default (zero spend)', () => {
  it('makes ZERO spawns when no budget cap is set', async () => {
    const { fn, calls } = fakeSpawn(() => ({ stdout: envelope([]) }));
    const h = new FableHarness({ spawnClaude: fn }); // no maxBudgetUsd
    expect(h.isEnabled()).toBe(false);
    const out = await h.judgeBatch(items(10));
    expect(out).toEqual([]);
    expect(calls).toHaveLength(0);
    expect(h.getSpentUsd()).toBe(0);
  });

  it('reflectFailures also spends nothing without a budget cap', async () => {
    const { fn, calls } = fakeSpawn(() => ({ stdout: envelope([]) }));
    const h = new FableHarness({ spawnClaude: fn });
    const out = await h.reflectFailures([{ id: 'a', task: 't', output: 'o' }]);
    expect(out).toEqual([]);
    expect(calls).toHaveLength(0);
  });
});

describe('FableHarness — batching & judging', () => {
  it('batches items into ceil(n / batchSize) calls', async () => {
    const { fn, calls } = fakeSpawn((idx, _argv, prompt) => {
      const batch = JSON.parse(prompt) as JudgeItem[];
      return { stdout: envelope(batch.map((b) => ({ id: b.id, resolved: true, confidence: 0.8, reason: 'ok' }))) };
    });
    const h = new FableHarness({ maxBudgetUsd: 100, batchSize: 4, spawnClaude: fn });
    const out = await h.judgeBatch(items(10)); // 10 / 4 = 3 batches
    expect(calls).toHaveLength(3);
    expect(out).toHaveLength(10);
    expect(out[0]).toMatchObject({ id: 't0', resolved: true });
  });

  it('normalizes verdicts (resolved boolean, clamped confidence)', async () => {
    const { fn } = fakeSpawn(() => ({
      stdout: envelope([
        { id: 't0', resolved: 'true', confidence: 1.7, reason: 'x' },
        { id: 't1', resolved: false, confidence: -3, reason: 'y' },
      ]),
    }));
    const h = new FableHarness({ maxBudgetUsd: 10, spawnClaude: fn });
    const out = await h.judgeBatch(items(2));
    expect(out[0]).toEqual({ id: 't0', resolved: true, confidence: 1, reason: 'x' });
    expect(out[1]).toEqual({ id: 't1', resolved: false, confidence: 0, reason: 'y' });
  });

  it('stops launching batches once measured spend reaches the cap', async () => {
    const { fn, calls } = fakeSpawn((idx, _argv, prompt) => {
      const batch = JSON.parse(prompt) as JudgeItem[];
      // Each batch reports $3 spend; cap is $5 ⇒ only the first batch should run.
      return { stdout: envelope(batch.map((b) => ({ id: b.id, resolved: true, confidence: 0.5, reason: 'ok' }))), costUsd: 3 };
    });
    const h = new FableHarness({ maxBudgetUsd: 5, batchSize: 2, spawnClaude: fn });
    const out = await h.judgeBatch(items(10)); // 5 batches if unbounded
    // batch1: spent 0<5 → run (spent 3); batch2: spent 3<5 → run (spent 6);
    // batch3: spent 6>=5 → stop. So exactly 2 batches run, covering 4 items.
    expect(calls.length).toBe(2);
    expect(out.length).toBe(4);
    expect(h.getSpentUsd()).toBeCloseTo(6, 2);
  });
});

describe('FableHarness — reflectFailures', () => {
  it('returns parsed reflection results', async () => {
    const { fn } = fakeSpawn(() => ({
      stdout: envelope([
        { id: 'a', failureClass: 'wrong-file', diagnosis: 'edited the wrong module', mutationHint: 'target foo.ts' },
      ]),
    }));
    const h = new FableHarness({ maxBudgetUsd: 10, spawnClaude: fn });
    const out = await h.reflectFailures([{ id: 'a', task: 't', output: 'o', failureHint: 'tests red' }]);
    expect(out).toEqual([
      { id: 'a', failureClass: 'wrong-file', diagnosis: 'edited the wrong module', mutationHint: 'target foo.ts' },
    ]);
  });
});

describe('FableHarness — adviseCoPilotTip (ADR-316)', () => {
  it('makes ZERO spawns when no budget cap is set (off by default)', async () => {
    const { fn, calls } = fakeSpawn(() => ({ stdout: envelope([]) }));
    const h = new FableHarness({ spawnClaude: fn });
    const tip = await h.adviseCoPilotTip({ gitUncommittedCount: 50 });
    expect(tip).toBeNull();
    expect(calls).toHaveLength(0);
  });

  it('returns a normalized tip when the model finds one worth surfacing', async () => {
    const { fn, calls } = fakeSpawn(() => ({
      stdout: envelope([{ headline: 'Commit your work', detail: 'You have 50 uncommitted files.', confidence: 1.4 }]),
    }));
    const h = new FableHarness({ maxBudgetUsd: 0.5, spawnClaude: fn });
    const tip = await h.adviseCoPilotTip({ gitUncommittedCount: 50 });
    expect(calls).toHaveLength(1);
    expect(tip).toEqual({ headline: 'Commit your work', detail: 'You have 50 uncommitted files.', confidence: 1 });
  });

  it('returns null when the model explicitly finds nothing worth surfacing (empty array is not an error)', async () => {
    const { fn, calls } = fakeSpawn(() => ({ stdout: envelope([]) }));
    const h = new FableHarness({ maxBudgetUsd: 0.5, spawnClaude: fn });
    const tip = await h.adviseCoPilotTip({});
    expect(calls).toHaveLength(1);
    expect(tip).toBeNull();
  });

  it('sends the snapshot as stdin JSON, never as an argv positional', async () => {
    const { fn, calls } = fakeSpawn(() => ({ stdout: envelope([]) }));
    const h = new FableHarness({ maxBudgetUsd: 0.5, spawnClaude: fn });
    await h.adviseCoPilotTip({ gitUncommittedCount: 7 });
    expect(calls[0].prompt).toContain('"gitUncommittedCount":7');
    expect(calls[0].argv.join(' ')).not.toContain('7');
    expect(calls[0].cwd).not.toBe(process.cwd());
  });

  it('never returns a tip once the harness is already at/over budget', async () => {
    const { fn, calls } = fakeSpawn(() => ({ stdout: envelope([{ headline: 'x', detail: 'y', confidence: 0.5 }]), costUsd: 10 }));
    const h = new FableHarness({ maxBudgetUsd: 0.1, spawnClaude: fn });
    const first = await h.adviseCoPilotTip({});
    expect(first).not.toBeNull(); // first call runs (spent starts at 0)
    const second = await h.adviseCoPilotTip({});
    expect(second).toBeNull(); // now over budget — refuses without spawning
    expect(calls).toHaveLength(1);
  });
});

describe('extractVerdictArray', () => {
  it('parses an enveloped result string', () => {
    const arr = extractVerdictArray(envelope([{ id: 'x', resolved: true }]));
    expect(arr).toEqual([{ id: 'x', resolved: true }]);
  });
  it('parses a bare JSON array', () => {
    expect(extractVerdictArray('[{"id":"x"}]')).toEqual([{ id: 'x' }]);
  });
  it('parses a fenced ```json array inside a result string', () => {
    const env = JSON.stringify({ result: '```json\n[{"id":"y"}]\n```' });
    expect(extractVerdictArray(env)).toEqual([{ id: 'y' }]);
  });
  it('returns [] on garbage', () => {
    expect(extractVerdictArray('not json at all')).toEqual([]);
    expect(extractVerdictArray('')).toEqual([]);
  });
});

describe('cost model', () => {
  it('estimateFableCostUsd amortizes per item', () => {
    expect(estimateFableCostUsd(0)).toBe(0);
    expect(estimateFableCostUsd(20)).toBeCloseTo(20 * FABLE_COST_MODEL.perItemBatchedUsd, 4);
  });
  it('parseCostFromEnvelope reads total_cost_usd', () => {
    expect(parseCostFromEnvelope(envelope([], 1.23)) ?? 0).toBeCloseTo(1.23, 2);
    expect(parseCostFromEnvelope('garbage')).toBeUndefined();
  });
  it('exposes the measured cost anchors', () => {
    expect(FABLE_COST_MODEL.perCallProjectCwdUsd).toBeGreaterThan(FABLE_COST_MODEL.perCallCleanCwdUsd);
    expect(FABLE_COST_MODEL.model).toBe('claude-fable-5');
  });
});

// ── Optional live smoke — human-run only, never in CI ─────────────────────
const LIVE = process.env.RUFLO_FABLE_LIVE === '1';
(LIVE ? describe : describe.skip)('FableHarness — LIVE smoke (RUFLO_FABLE_LIVE=1)', () => {
  it('judges a trivial item against the real Fable CLI', async () => {
    const h = new FableHarness({ maxBudgetUsd: 0.5 }); // real spawnClaude
    const out = await h.judgeBatch([
      { id: 'live-1', task: 'Return the number 4', output: '4' },
    ]);
    expect(Array.isArray(out)).toBe(true);
    if (out.length > 0) expect(typeof out[0].resolved).toBe('boolean');
  }, 120_000);
});
