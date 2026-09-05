/**
 * weft-export.test.ts — ADR-150 weight-eft slice.
 *
 * Covers:
 *   1. Archive-builder: ruflo run records → DarwinTrajectory[] mapping + the
 *      honest resolved-proxy accounting.
 *   2. distill-export E2E: synthetic archive → weight-eft export produces
 *      sft.jsonl / dpo.jsonl / export-report.json (weight-eft installed in the
 *      worktree; skipped if the optional dep is genuinely absent).
 *   3. Degraded path: weight-eft absent (injected failing importer) → {degraded:true}.
 *   4. Remote-train: pure command construction (ssh/rsync/ruvllm argv) + dry-run
 *      output. NEVER touches a live host — spawn is stubbed.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { rmSync, mkdtempSync, mkdirSync, writeFileSync, existsSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import {
  buildArchiveFromRecords,
  runExport,
  runPlan,
  buildRemoteTrainInvocation,
  runRemoteTrain,
  loadWeightEft,
  DEFAULT_BASE_MODEL,
  type DarwinTrajectory,
  type SpawnLike,
} from '../src/services/weight-eft.js';
import type { RunTranscriptRecord } from '../src/ruvector/run-transcript-recorder.js';
import {
  recordRunTranscript,
  readRunTranscripts,
  tierForModel,
  runTranscriptRecorderStatus,
  __resetRunTranscriptRecorderForTests,
} from '../src/ruvector/run-transcript-recorder.js';

// NOTE: the CLI command surface (neuralCommand) is intentionally NOT imported
// here — it pulls in `@claude-flow/cli-core/output`, whose built subpath is not
// resolvable under vitest in a fresh worktree (the same reason the repo's
// existing __tests__/commands.test.ts loads no tests in this env). We exercise
// the command's SERVICE layer (runExport → files on disk) directly, and the
// built-CLI command is smoke-tested out-of-band via `node dist … neural distill`.

// --- fixtures ---------------------------------------------------------------

function rec(over: Partial<RunTranscriptRecord>): RunTranscriptRecord {
  return {
    v: 1,
    ts: new Date().toISOString(),
    instance_id: 'inst-1',
    task_hash: 'deadbeef',
    model: 'z-ai/glm-5.2',
    tier: 'cheap',
    resolved: true,
    resolved_source: 'api-success',
    messages: [
      { role: 'system', content: 'You are a coding agent.' },
      { role: 'user', content: 'Fix the null-deref in cache.ts' },
      { role: 'assistant', content: 'Here is the patch.' },
    ],
    model_patch: 'diff --git a/cache.ts b/cache.ts\n+ if (x) return;',
    sample: 0,
    source: 'agent-execute',
    ...over,
  };
}

/** A resolved + a failed sample on the SAME instance/model — enough for a DPO pair. */
function dpoPairRecords(): RunTranscriptRecord[] {
  return [
    rec({ instance_id: 'inst-dpo', sample: 0, resolved: true }),
    rec({
      instance_id: 'inst-dpo', sample: 1, resolved: false, model_patch: '',
      messages: [
        { role: 'system', content: 'You are a coding agent.' },
        { role: 'user', content: 'Fix the null-deref in cache.ts' },
        { role: 'assistant', content: 'I could not solve it.' },
      ],
    }),
  ];
}

let weftAvailable = false;
beforeEach(async () => { weftAvailable = (await loadWeightEft()) !== null; });

// --- 0. capture module: run-transcript recorder (opt-in) --------------------

describe('run-transcript-recorder (the capture path)', () => {
  let dir: string;
  let prevEnabled: string | undefined;
  let prevPath: string | undefined;
  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'weft-cap-'));
    prevEnabled = process.env.CLAUDE_FLOW_RUN_TRANSCRIPTS;
    prevPath = process.env.CLAUDE_FLOW_RUN_TRANSCRIPTS_PATH;
    __resetRunTranscriptRecorderForTests();
  });
  afterEach(() => {
    if (prevEnabled === undefined) delete process.env.CLAUDE_FLOW_RUN_TRANSCRIPTS; else process.env.CLAUDE_FLOW_RUN_TRANSCRIPTS = prevEnabled;
    if (prevPath === undefined) delete process.env.CLAUDE_FLOW_RUN_TRANSCRIPTS_PATH; else process.env.CLAUDE_FLOW_RUN_TRANSCRIPTS_PATH = prevPath;
    __resetRunTranscriptRecorderForTests();
    rmSync(dir, { recursive: true, force: true });
  });

  it('is OFF by default — recordRunTranscript is a no-op (no file written)', () => {
    delete process.env.CLAUDE_FLOW_RUN_TRANSCRIPTS;
    const p = join(dir, 'run-transcripts.jsonl');
    process.env.CLAUDE_FLOW_RUN_TRANSCRIPTS_PATH = p;
    __resetRunTranscriptRecorderForTests();
    const r = recordRunTranscript({ task: 't', model: 'claude-haiku-4', tier: 'cheap', resolved: true, resolvedSource: 'api-success', messages: [{ role: 'user', content: 'hi' }] });
    expect(r.recorded).toBe(false);
    expect(existsSync(p)).toBe(false);
  });

  it('when enabled, writes a record that round-trips through readRunTranscripts', () => {
    const p = join(dir, 'run-transcripts.jsonl');
    process.env.CLAUDE_FLOW_RUN_TRANSCRIPTS = '1';
    process.env.CLAUDE_FLOW_RUN_TRANSCRIPTS_PATH = p;
    __resetRunTranscriptRecorderForTests();
    const r = recordRunTranscript({
      task: 'Fix bug', model: 'claude-haiku-4', tier: 'cheap', resolved: true,
      resolvedSource: 'output-verifier', messages: [{ role: 'user', content: 'Fix bug' }],
      modelPatch: 'diff', source: 'agent-execute',
    });
    expect(r.recorded).toBe(true);
    expect(r.instanceId).toBe(`run-${r.taskHash}`);
    const { records, malformed } = readRunTranscripts(p);
    expect(malformed).toBe(0);
    expect(records).toHaveLength(1);
    expect(records[0]).toMatchObject({ v: 1, model: 'claude-haiku-4', tier: 'cheap', resolved: true, resolved_source: 'output-verifier', model_patch: 'diff' });
    expect(runTranscriptRecorderStatus().enabled).toBe(true);
  });

  it('tierForModel maps haiku→cheap, sonnet/opus→frontier', () => {
    expect(tierForModel('claude-haiku-4')).toBe('cheap');
    expect(tierForModel('claude-sonnet-4')).toBe('frontier');
    expect(tierForModel('anthropic/claude-opus')).toBe('frontier');
    expect(tierForModel(undefined)).toBe('frontier');
  });
});

// --- 1. archive-builder -----------------------------------------------------

describe('buildArchiveFromRecords', () => {
  it('maps ruflo run records to DarwinTrajectory[] preserving the contract fields', () => {
    const { trajectories, stats } = buildArchiveFromRecords([
      rec({ instance_id: 'a', tier: 'cheap', resolved: true }),
      rec({ instance_id: 'b', tier: 'frontier', resolved: false, model: 'anthropic/claude-opus' }),
    ]);
    expect(trajectories).toHaveLength(2);
    const a = trajectories[0];
    expect(a).toMatchObject({
      instance_id: 'a', model: 'z-ai/glm-5.2', tier: 'cheap', resolved: true, sample: 0,
    });
    expect(a.messages[0].role).toBe('system');
    expect(a.model_patch).toContain('diff --git');
    expect(trajectories[1]).toMatchObject({ instance_id: 'b', tier: 'frontier', resolved: false });
    expect(stats.total).toBe(2);
    expect(stats.resolved).toBe(1);
    expect(stats.byTier).toEqual({ cheap: 1, frontier: 1 });
  });

  it('skips records missing an instance_id or messages (never throws)', () => {
    const { trajectories, stats } = buildArchiveFromRecords([
      rec({ instance_id: 'ok' }),
      rec({ instance_id: '', messages: [] }),
      rec({ instance_id: 'empty', messages: [] }),
    ]);
    expect(trajectories.map((t) => t.instance_id)).toEqual(['ok']);
    expect(stats.skipped).toBe(2);
  });

  it('tallies resolved provenance and emits an honest PROXY note (no gold oracle)', () => {
    const { stats, proxyNote } = buildArchiveFromRecords([
      rec({ instance_id: 'a', resolved_source: 'api-success' }),
      rec({ instance_id: 'b', resolved_source: 'output-verifier' }),
    ]);
    expect(stats.byResolvedSource).toEqual({ 'api-success': 1, 'output-verifier': 1 });
    expect(proxyNote).toMatch(/PROXY/);
    expect(proxyNote).toMatch(/no SWE-bench gold oracle/i);
  });
});

// --- 2. distill-export E2E (real weight-eft) --------------------------------

describe('runExport (E2E against real weight-eft)', () => {
  it('produces SFT + DPO jsonl and a guard report from a synthetic archive', async () => {
    if (!weftAvailable) { console.warn('weight-eft not installed — skipping E2E'); return; }
    const { trajectories } = buildArchiveFromRecords(dpoPairRecords());
    const res = await runExport({ archive: trajectories, evalHoldout: [] });
    expect(res.degraded).toBe(false);
    if (res.degraded) return;
    // SFT: at least the resolved trajectory becomes a training row.
    expect(res.sftRows).toBeGreaterThanOrEqual(1);
    expect(res.sftJsonl.trim().split('\n').length).toBe(res.sftRows);
    expect(JSON.parse(res.sftJsonl.trim().split('\n')[0])).toHaveProperty('messages');
    // DPO: the resolved+failed pair on the same instance yields a preference row.
    expect(res.dpoRows).toBeGreaterThanOrEqual(1);
    const dpo0 = JSON.parse(res.dpoJsonl.trim().split('\n')[0]);
    expect(dpo0).toHaveProperty('chosen');
    expect(dpo0).toHaveProperty('rejected');
    // Report carries the guard accounting.
    expect(res.report).toMatchObject({ sftRows: res.sftRows, dpoRows: res.dpoRows });
    expect(res.report).toHaveProperty('droppedRewardHacked');
    expect(res.report).toHaveProperty('excludedByHoldout');
  });

  it('honors the contamination guard: holdout instances are excluded', async () => {
    if (!weftAvailable) return;
    const { trajectories } = buildArchiveFromRecords([rec({ instance_id: 'held' }), rec({ instance_id: 'kept', task_hash: 'x' })]);
    const res = await runExport({ archive: trajectories, evalHoldout: ['held'] });
    expect(res.degraded).toBe(false);
    if (res.degraded) return;
    expect(res.report.excludedByHoldout).toBe(1);
    expect(res.report.sftInstanceIds).not.toContain('held');
  });

  it('runPlan emits a two-stage GPU plan with a ruvllm command ($0 dry-run)', async () => {
    if (!weftAvailable) return;
    const res = await runPlan({ sftPath: '/tmp/sft.jsonl', dpoPath: '/tmp/dpo.jsonl' });
    expect(res.degraded).toBe(false);
    if (res.degraded) return;
    expect(res.base).toEqual(DEFAULT_BASE_MODEL);
    expect(res.sft.command).toMatch(/ruvllm|microlora|sft/i);
    expect(res.dpo.command).toBeTruthy();
  });
});

// --- 2b. export → files on disk (the command's service path) ----------------

describe('distill-export writes sft.jsonl / dpo.jsonl / export-report.json', () => {
  let dir: string;
  beforeEach(() => { dir = mkdtempSync(join(tmpdir(), 'weft-cli-')); });
  afterEach(() => { rmSync(dir, { recursive: true, force: true }); });

  it('persists the exact artifacts the CLI `neural distill export` emits', async () => {
    if (!weftAvailable) return;
    const { trajectories, stats, proxyNote } = buildArchiveFromRecords(dpoPairRecords());
    const res = await runExport({ archive: trajectories, evalHoldout: [] });
    expect(res.degraded).toBe(false);
    if (res.degraded) return;

    // Mirror the command's write path.
    const outDir = join(dir, 'out');
    mkdirSync(outDir, { recursive: true });
    writeFileSync(join(outDir, 'sft.jsonl'), res.sftJsonl);
    writeFileSync(join(outDir, 'dpo.jsonl'), res.dpoJsonl);
    writeFileSync(join(outDir, 'export-report.json'), JSON.stringify({ report: res.report, archiveStats: stats, proxyNote }, null, 2));

    expect(existsSync(join(outDir, 'sft.jsonl'))).toBe(true);
    expect(existsSync(join(outDir, 'dpo.jsonl'))).toBe(true);
    expect(existsSync(join(outDir, 'export-report.json'))).toBe(true);
    const report = JSON.parse(readFileSync(join(outDir, 'export-report.json'), 'utf8'));
    expect(report).toHaveProperty('report');
    expect(report.proxyNote).toMatch(/PROXY/);
    expect(readFileSync(join(outDir, 'sft.jsonl'), 'utf8').trim().length).toBeGreaterThan(0);
  });
});

// --- 3. degraded path (weight-eft absent) -----------------------------------

describe('graceful degradation (ADR-150)', () => {
  const failingImporter = async () => { throw new Error("Cannot find module '@metaharness/weight-eft'"); };

  it('runExport returns {degraded:true} when weight-eft cannot load', async () => {
    const { trajectories } = buildArchiveFromRecords([rec({})]);
    const res = await runExport({ archive: trajectories, importer: failingImporter });
    expect(res).toEqual({ degraded: true, reason: 'weight-eft-not-available' });
  });

  it('runPlan degrades without throwing', async () => {
    const res = await runPlan({ sftPath: 'a', dpoPath: 'b', importer: failingImporter });
    expect(res.degraded).toBe(true);
  });

  it('loadWeightEft returns null (not throw) on a broken import', async () => {
    expect(await loadWeightEft(failingImporter)).toBeNull();
  });
});

// --- 4. remote-train construction + dry-run ---------------------------------

describe('buildRemoteTrainInvocation (pure command construction)', () => {
  it('builds correct ssh/rsync/ruvllm argv for host + model + paths', () => {
    const plan = buildRemoteTrainInvocation({
      host: 'gpu-box', base: 'Qwen/Qwen2.5-Coder-7B-Instruct',
      sftPath: '/local/sft.jsonl', dpoPath: '/local/dpo.jsonl',
      adapterDir: '/local/adapters', sshUser: 'ruv', sshPort: 2222,
      runId: 'run42', adapterPrefix: 'ruflo-weft',
    });
    // ssh reachability probe targets user@host on the chosen port
    expect(plan.preflight[0].argv).toEqual(['ssh', '-o', 'BatchMode=yes', '-o', 'ConnectTimeout=8', '-p', '2222', 'ruv@gpu-box', 'true']);
    // rsync sends the LOCAL sft file up to the remote workdir
    const rsyncSft = plan.steps.find((s) => s.label === 'rsync sft up')!;
    expect(rsyncSft.argv[0]).toBe('rsync');
    expect(rsyncSft.argv).toContain('/local/sft.jsonl');
    expect(rsyncSft.argv[rsyncSft.argv.length - 1]).toContain('ruv@gpu-box:');
    // ruvllm sft uses the base model + writes an sft adapter
    const sftStep = plan.steps.find((s) => s.label.startsWith('ruvllm sft'))!;
    expect(sftStep.argv.join(' ')).toContain('ruvllm microlora sft --base Qwen/Qwen2.5-Coder-7B-Instruct --data sft.jsonl');
    expect(sftStep.argv.join(' ')).toContain('ruflo-weft-run42-sft');
    // ruvllm dpo initializes from the sft adapter (on-policy)
    const dpoStep = plan.steps.find((s) => s.label.startsWith('ruvllm dpo'))!;
    expect(dpoStep.argv.join(' ')).toContain('ruvllm microlora dpo --base Qwen/Qwen2.5-Coder-7B-Instruct --init-from ruflo-weft-run42-sft');
    // adapter fetched back into the local dir
    const back = plan.steps.find((s) => s.label === 'rsync adapter back')!;
    expect(back.argv[back.argv.length - 1]).toContain('/local/adapters/ruflo-weft-run42-dpo');
    expect(plan.humanCommands.length).toBe(plan.preflight.length + plan.steps.length);
  });

  it('defaults host param from args and uses port 22 + default base', () => {
    const plan = buildRemoteTrainInvocation({ host: 'h', sftPath: 's', dpoPath: 'd', runId: 'r' });
    expect(plan.base).toBe(DEFAULT_BASE_MODEL.id);
    expect(plan.preflight[0].argv).toContain('-p');
    expect(plan.preflight[0].argv[plan.preflight[0].argv.indexOf('-p') + 1]).toBe('22');
  });
});

describe('runRemoteTrain (spend-gated; spawn stubbed — never touches a live host)', () => {
  const okSpawn = (): SpawnLike => ({ status: 0, stdout: 'ok', stderr: '' });
  const args = { host: 'gpu-box', sftPath: '/l/sft.jsonl', dpoPath: '/l/dpo.jsonl', runId: 'r1' };

  it('BARE dry-run is fully OFFLINE — contacts nothing (no implicit remote exec)', async () => {
    const spawned: string[] = [];
    const spawn = (cmd: string, argv: string[]): SpawnLike => { spawned.push([cmd, ...argv].join(' ')); return okSpawn(); };
    const res = await runRemoteTrain({ ...args, spawn });
    expect(res.degraded).toBe(false);
    if (res.degraded) return;
    expect(res.mode).toBe('dry-run');
    expect(res.steps).toBeUndefined();
    expect(res.plan.humanCommands.some((c) => c.includes('ruvllm microlora sft'))).toBe(true);
    // NOTHING spawned — not even a reachability ssh (adversarial RC hardening).
    expect(spawned).toEqual([]);
    expect(res.reason).toMatch(/offline/i);
  });

  it('--preflight opts into the read-only probes (still no training)', async () => {
    const spawned: string[] = [];
    const spawn = (cmd: string, argv: string[]): SpawnLike => { spawned.push([cmd, ...argv].join(' ')); return okSpawn(); };
    const res = await runRemoteTrain({ ...args, preflight: true, spawn });
    expect(res.degraded).toBe(false);
    if (res.degraded) return;
    expect(res.mode).toBe('dry-run');
    // the 3 read-only preflight probes ran; no rsync / ruvllm training
    expect(spawned.length).toBeGreaterThan(0);
    expect(spawned.every((c) => c.startsWith('ssh'))).toBe(true);
    expect(spawned.some((c) => c.includes('rsync') || c.includes('microlora'))).toBe(false);
  });

  it('--execute WITHOUT --yes is refused (real GPU spend needs the second gate)', async () => {
    const res = await runRemoteTrain({ ...args, execute: true, spawn: okSpawn });
    expect(res.degraded).toBe(false);
    if (res.degraded) return;
    expect(res.mode).toBe('refused');
    expect(res.reason).toMatch(/--yes/);
  });

  it('--execute --yes on an UNREACHABLE host aborts before any data transfer', async () => {
    // ssh reachability probe fails → preflight-failed, no rsync/training
    const spawned: string[] = [];
    const spawn = (cmd: string, argv: string[]): SpawnLike => {
      spawned.push([cmd, ...argv].join(' '));
      return { status: 255, stdout: '', stderr: 'ssh: connect timed out' };
    };
    const res = await runRemoteTrain({ ...args, execute: true, yes: true, spawn });
    expect(res.degraded).toBe(false);
    if (res.degraded) return;
    expect(res.mode).toBe('preflight-failed');
    expect(spawned.some((c) => c.includes('rsync') || c.includes('microlora'))).toBe(false);
  });
});
