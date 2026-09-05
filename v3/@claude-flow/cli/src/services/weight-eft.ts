/**
 * weight-eft.ts — Optional-dependency service wrapper around
 * `@metaharness/weight-eft` (agenticow / ADR-150 weight-eft slice).
 *
 * WHAT THIS SHIPS (and what it deliberately does NOT)
 * ---------------------------------------------------
 * This service turns ruflo's captured run transcripts into AUDITED TRAINING
 * DATA + a COST-PARETO measurement + a GPU TRAINING PLAN. It does NOT train a
 * model and it does NOT "reduce escalation":
 *   - `runExport`  → SFT (OpenAI chat) + DPO (TRL preference) JSONL + a guard
 *                    report (contamination / reward-hack / long-context). $0.
 *   - `runPlan`    → the GPU training plan + the exact `ruvllm microlora`
 *                    command a GPU host would run. $0 dry-run — never spawns.
 *   - `runEval`    → the cost-Pareto delta folded from two CascadeOutcome[]. $0.
 *   - `runRemoteTrain` → an SSH-based remote-GPU invocation. DRY-RUN by default
 *                    (prints commands + read-only preflight); real compute only
 *                    behind explicit `execute && yes`. This is the ONLY path
 *                    that can spend, and it spends on the USER's host, not $0.
 *
 * HARD HONESTY RULE (do not overclaim): weight-eft's own `train` never spawns
 * (its README §Status), and no GPU tune has run here. `resolved` in the
 * captured archive is a PROXY (ruflo has no SWE-bench gold oracle) — the SFT
 * data-quality caveat stands. Nothing here claims ruflo "trains a model" as a
 * $0/local capability.
 *
 * ADR-150 GRACEFUL DEGRADATION
 * ----------------------------
 * `@metaharness/weight-eft` is an OPTIONAL dependency. Every entry point loads
 * it via a dynamic import through `loadWeightEft()` and returns a structured
 * `{ degraded: true }` result when it is absent — never a throw. There is NO
 * static `import … from '@metaharness/weight-eft'` anywhere in this file; the
 * types below are LOCAL mirrors so tsc stays green with the package removed.
 *
 * @module services/weight-eft
 */

import { spawnSync } from 'node:child_process';

import type { RunTranscriptRecord } from '../ruvector/run-transcript-recorder.js';

// ============================================================================
// LOCAL type mirrors of @metaharness/weight-eft (no static import — ADR-150)
// ============================================================================

export interface WeftToolCall { id: string; type: 'function'; function: { name: string; arguments: string } }
export interface WeftChatMessage {
  role: 'system' | 'user' | 'assistant' | 'tool';
  content: string | null;
  tool_calls?: WeftToolCall[];
  tool_call_id?: string;
  name?: string;
}
export type WeftPolicyTier = 'cheap' | 'frontier';

/** Input contract for the exporter. Mirrors weight-eft's DarwinTrajectory. */
export interface DarwinTrajectory {
  instance_id: string;
  model: string;
  tier: WeftPolicyTier;
  resolved: boolean;
  messages: WeftChatMessage[];
  model_patch: string;
  sample?: number;
  source?: string;
}

export interface WeftExportReport {
  totalTrajectories: number;
  excludedByHoldout: number;
  droppedOverLength: number;
  truncatedOverLength: number;
  droppedRewardHacked: number;
  sftRows: number;
  dpoRows: number;
  sftInstanceIds: string[];
  dpoInstanceIds: string[];
  notes: string[];
}

export interface WeftCascadeOutcome {
  instance_id: string;
  cheapResolved: boolean;
  escalated: boolean;
  resolved: boolean;
  costUsd: number;
}

export interface WeftCostParetoDelta {
  base: unknown;
  adapter: unknown;
  cheapResolveLift: number;
  escalationRateReduction: number;
  costPerResolvedReduction: number;
  resolveRateDelta: number;
  verdict: string;
}

export interface WeftBaseModelSpec { id: string; paramsB: number }
export interface WeftTrainingPlan { config: unknown; command: string; summary: string }

/** The subset of the weight-eft module surface this service calls. */
interface WeightEftApi {
  exportTrainingData: (t: DarwinTrajectory[], o: {
    evalHoldout: string[]; maxTokens?: number; truncateOverLength?: boolean; dropRewardHacked?: boolean;
  }) => { sft: { messages: WeftChatMessage[] }[]; dpo: unknown[]; report: WeftExportReport };
  sftToJsonl: (rows: { messages: WeftChatMessage[] }[]) => string;
  dpoToJsonl: (rows: unknown[]) => string;
  costParetoDelta: (base: WeftCascadeOutcome[], adapter: WeftCascadeOutcome[]) => WeftCostParetoDelta;
  twoStagePlan: (base: WeftBaseModelSpec, sftPath: string, dpoPath: string, adapterPrefix: string) => {
    sft: WeftTrainingPlan; dpo: WeftTrainingPlan;
  };
}

/** Injectable importer so tests can force the degraded path deterministically. */
export type WeightEftImporter = () => Promise<unknown>;

const WEIGHT_EFT_PKG = '@metaharness/weight-eft';

/**
 * Load `@metaharness/weight-eft` (optional dep). Returns the module or `null`
 * when it is absent/broken. Never throws. The specifier is held in a variable
 * so tsc does not statically resolve the package (keeps the build green when
 * the optional dep is removed — ADR-150).
 */
export async function loadWeightEft(importer?: WeightEftImporter): Promise<WeightEftApi | null> {
  const load = importer ?? (() => import(/* @vite-ignore */ WEIGHT_EFT_PKG));
  try {
    const mod = (await load()) as Partial<WeightEftApi> & { default?: Partial<WeightEftApi> };
    const api = (mod && typeof mod.exportTrainingData === 'function' ? mod : mod?.default) as WeightEftApi | undefined;
    if (!api || typeof api.exportTrainingData !== 'function') return null;
    return api;
  } catch {
    return null; // MODULE_NOT_FOUND or any load error → degraded
  }
}

// ============================================================================
// Archive-builder: ruflo run records → DarwinTrajectory[]  (unit-tested)
// ============================================================================

export interface ArchiveBuildStats {
  total: number;
  resolved: number;
  byTier: Record<WeftPolicyTier, number>;
  /** Honest breakdown: how many `resolved` booleans came from which proxy. */
  byResolvedSource: Record<string, number>;
  skipped: number;
}

export interface ArchiveBuildResult {
  trajectories: DarwinTrajectory[];
  stats: ArchiveBuildStats;
  /** Load-bearing honesty banner surfaced to CLI/report output. */
  proxyNote: string;
}

/**
 * Map captured ruflo run transcripts to the DarwinTrajectory[] contract the
 * weight-eft exporter codes against. PURE + synchronous — this is the seam the
 * archive-builder unit test exercises.
 *
 * A record is skipped (not thrown) when it lacks the minimum an exporter needs:
 * an instance_id and a non-empty messages array. `resolved` is copied verbatim
 * and its proxy provenance is tallied so the caller can print an honest note.
 */
export function buildArchiveFromRecords(records: RunTranscriptRecord[]): ArchiveBuildResult {
  const trajectories: DarwinTrajectory[] = [];
  const stats: ArchiveBuildStats = {
    total: 0, resolved: 0, byTier: { cheap: 0, frontier: 0 }, byResolvedSource: {}, skipped: 0,
  };
  let hasGold = false;

  for (const r of records) {
    if (!r || !r.instance_id || !Array.isArray(r.messages) || r.messages.length === 0) {
      stats.skipped++;
      continue;
    }
    const tier: WeftPolicyTier = r.tier === 'cheap' ? 'cheap' : 'frontier';
    trajectories.push({
      instance_id: r.instance_id,
      model: r.model,
      tier,
      resolved: !!r.resolved,
      messages: r.messages as WeftChatMessage[],
      model_patch: r.model_patch ?? '',
      sample: r.sample ?? 0,
      ...(r.source ? { source: r.source } : {}),
    });
    stats.total++;
    stats.byTier[tier]++;
    if (r.resolved) stats.resolved++;
    const src = r.resolved_source ?? 'external';
    stats.byResolvedSource[src] = (stats.byResolvedSource[src] ?? 0) + 1;
    if (src === 'gold-oracle') hasGold = true;
  }

  const proxyNote = hasGold
    ? 'resolved: some records carry gold-oracle status; others are proxies (see byResolvedSource).'
    : 'resolved is a PROXY — ruflo has no SWE-bench gold oracle. `output-verifier`/`api-success` ' +
      'labels are explicitly-marked proxies, NOT conformant gold eval. SFT/DPO quality is bounded by this.';

  return { trajectories, stats, proxyNote };
}

// ============================================================================
// export | plan | eval  ($0, offline, no creds)
// ============================================================================

export type ExportOutcome =
  | {
      degraded: false;
      report: WeftExportReport;
      sftJsonl: string;
      dpoJsonl: string;
      sftRows: number;
      dpoRows: number;
    }
  | { degraded: true; reason: string };

/** Run the weight-eft exporter over a DarwinTrajectory[] archive. $0. */
export async function runExport(opts: {
  archive: DarwinTrajectory[];
  evalHoldout?: string[];
  maxTokens?: number;
  truncateOverLength?: boolean;
  dropRewardHacked?: boolean;
  importer?: WeightEftImporter;
}): Promise<ExportOutcome> {
  const api = await loadWeightEft(opts.importer);
  if (!api) return { degraded: true, reason: 'weight-eft-not-available' };
  try {
    const res = api.exportTrainingData(opts.archive, {
      evalHoldout: opts.evalHoldout ?? [],
      ...(opts.maxTokens != null ? { maxTokens: opts.maxTokens } : {}),
      ...(opts.truncateOverLength != null ? { truncateOverLength: opts.truncateOverLength } : {}),
      // reward-hack filter defaults ON inside weight-eft; only forward an explicit override
      ...(opts.dropRewardHacked != null ? { dropRewardHacked: opts.dropRewardHacked } : {}),
    });
    return {
      degraded: false,
      report: res.report,
      sftJsonl: api.sftToJsonl(res.sft),
      dpoJsonl: api.dpoToJsonl(res.dpo),
      sftRows: res.sft.length,
      dpoRows: res.dpo.length,
    };
  } catch (e) {
    // exportTrainingData throws on contamination-guard violation — surface it.
    return { degraded: true, reason: `export-failed: ${(e as Error).message}` };
  }
}

export type PlanOutcome =
  | { degraded: false; base: WeftBaseModelSpec; sft: WeftTrainingPlan; dpo: WeftTrainingPlan }
  | { degraded: true; reason: string };

/** Emit the two-stage (SFT → on-policy DPO) GPU training plan. $0 dry-run. */
export async function runPlan(opts: {
  base?: WeftBaseModelSpec;
  sftPath: string;
  dpoPath: string;
  adapterPrefix?: string;
  importer?: WeightEftImporter;
}): Promise<PlanOutcome> {
  const api = await loadWeightEft(opts.importer);
  if (!api) return { degraded: true, reason: 'weight-eft-not-available' };
  const base = opts.base ?? DEFAULT_BASE_MODEL;
  try {
    const plan = api.twoStagePlan(base, opts.sftPath, opts.dpoPath, opts.adapterPrefix ?? 'ruflo-weft');
    return { degraded: false, base, sft: plan.sft, dpo: plan.dpo };
  } catch (e) {
    return { degraded: true, reason: `plan-failed: ${(e as Error).message}` };
  }
}

export type EvalOutcome =
  | { degraded: false; delta: WeftCostParetoDelta }
  | { degraded: true; reason: string };

/** Fold base + adapter CascadeOutcome[] into the cost-Pareto delta. $0. */
export async function runEval(opts: {
  baseOutcomes: WeftCascadeOutcome[];
  adapterOutcomes: WeftCascadeOutcome[];
  importer?: WeightEftImporter;
}): Promise<EvalOutcome> {
  const api = await loadWeightEft(opts.importer);
  if (!api) return { degraded: true, reason: 'weight-eft-not-available' };
  try {
    return { degraded: false, delta: api.costParetoDelta(opts.baseOutcomes, opts.adapterOutcomes) };
  } catch (e) {
    return { degraded: true, reason: `eval-failed: ${(e as Error).message}` };
  }
}

/** Default cheap-tier tune target — a 7B coder in the tunable [1,14]B band. */
export const DEFAULT_BASE_MODEL: WeftBaseModelSpec = { id: 'Qwen/Qwen2.5-Coder-7B-Instruct', paramsB: 7 };

// ============================================================================
// Remote-GPU train construction (PURE + testable) + spend-gated runner
// ============================================================================

export interface RemoteTrainArgs {
  /** SSH host or tailscale name (parameterized; never hard-coded). */
  host: string;
  /** Base model id to tune. Default DEFAULT_BASE_MODEL.id. */
  base?: string;
  /** Local path to the exported SFT jsonl. */
  sftPath: string;
  /** Local path to the exported DPO jsonl. */
  dpoPath: string;
  /** Local dir to fetch the trained LoRA adapter back into. Default .claude-flow/neural. */
  adapterDir?: string;
  /** Remote working dir. Default ~/.ruflo-weft/<runId>. */
  remoteWorkdir?: string;
  /** SSH user (default: current, i.e. no user@ prefix). */
  sshUser?: string;
  /** SSH port. Default 22. */
  sshPort?: number;
  /** Stable run id used in remote workdir + adapter names. Default derived. */
  runId?: string;
  /** Adapter name prefix. Default 'ruflo-weft'. */
  adapterPrefix?: string;
}

export interface RemoteStep { label: string; argv: string[] }

export interface RemoteTrainPlan {
  host: string;
  base: string;
  runId: string;
  remoteWorkdir: string;
  adapterDir: string;
  sftAdapter: string;
  dpoAdapter: string;
  /** Read-only reachability/capability probes (safe to run in dry-run). */
  preflight: RemoteStep[];
  /** The mutating steps: rsync data up, train, fetch adapter back. */
  steps: RemoteStep[];
  /** Rendered one-line commands for human display. */
  humanCommands: string[];
}

function sshTarget(args: { host: string; sshUser?: string }): string {
  return args.sshUser ? `${args.sshUser}@${args.host}` : args.host;
}

function sshBase(port: number): string[] {
  return ['-o', 'BatchMode=yes', '-o', 'ConnectTimeout=8', '-p', String(port)];
}

/** Render an argv as a copy-pasteable shell line (quoting args with spaces). */
function renderCmd(argv: string[]): string {
  return argv.map((a) => (/[\s"'$]/.test(a) ? `'${a.replace(/'/g, `'\\''`)}'` : a)).join(' ');
}

/**
 * Construct the exact ssh/rsync/ruvllm invocations a remote GPU tune would run.
 * PURE — no spawning, no filesystem, deterministic. This is the seam the
 * command-construction unit test exercises. The ruvllm commands mirror the
 * canonical `ruvllm microlora sft … && ruvllm microlora dpo --init-from …`
 * plan weight-eft emits, wrapped for SSH execution on the remote host.
 */
export function buildRemoteTrainInvocation(args: RemoteTrainArgs): RemoteTrainPlan {
  const base = args.base ?? DEFAULT_BASE_MODEL.id;
  const port = args.sshPort ?? 22;
  const runId = args.runId ?? `weft-${Date.now().toString(36)}`;
  const prefix = args.adapterPrefix ?? 'ruflo-weft';
  const remoteWorkdir = args.remoteWorkdir ?? `~/.ruflo-weft/${runId}`;
  const adapterDir = args.adapterDir ?? '.claude-flow/neural';
  const target = sshTarget(args);
  const ssh = sshBase(port);
  const rsyncSsh = `ssh -p ${port}`;
  const sftAdapter = `${prefix}-${runId}-sft`;
  const dpoAdapter = `${prefix}-${runId}-dpo`;

  const preflight: RemoteStep[] = [
    { label: 'ssh reachability', argv: ['ssh', ...ssh, target, 'true'] },
    { label: 'ruvllm version', argv: ['ssh', ...ssh, target, 'ruvllm --version || echo RUVLLM_MISSING'] },
    { label: 'gpu probe', argv: ['ssh', ...ssh, target, 'nvidia-smi -L || echo NO_NVIDIA_SMI'] },
  ];

  const sftCmd =
    `cd ${remoteWorkdir} && ruvllm microlora sft --base ${base} --data sft.jsonl --output ${sftAdapter}`;
  const dpoCmd =
    `cd ${remoteWorkdir} && ruvllm microlora dpo --base ${base} --init-from ${sftAdapter} ` +
    `--data dpo.jsonl --output ${dpoAdapter}`;

  const steps: RemoteStep[] = [
    { label: 'remote mkdir', argv: ['ssh', ...ssh, target, `mkdir -p ${remoteWorkdir}`] },
    { label: 'rsync sft up', argv: ['rsync', '-az', '-e', rsyncSsh, args.sftPath, `${target}:${remoteWorkdir}/sft.jsonl`] },
    { label: 'rsync dpo up', argv: ['rsync', '-az', '-e', rsyncSsh, args.dpoPath, `${target}:${remoteWorkdir}/dpo.jsonl`] },
    { label: 'ruvllm sft (real GPU compute)', argv: ['ssh', ...ssh, target, sftCmd] },
    { label: 'ruvllm dpo (real GPU compute)', argv: ['ssh', ...ssh, target, dpoCmd] },
    { label: 'rsync adapter back', argv: ['rsync', '-az', '-e', rsyncSsh, `${target}:${remoteWorkdir}/${dpoAdapter}/`, `${adapterDir}/${dpoAdapter}/`] },
  ];

  return {
    host: args.host, base, runId, remoteWorkdir, adapterDir, sftAdapter, dpoAdapter,
    preflight, steps,
    humanCommands: [...preflight, ...steps].map((s) => renderCmd(s.argv)),
  };
}

/** Minimal spawn result shape (subset of child_process.SpawnSyncReturns). */
export interface SpawnLike { status: number | null; stdout?: string; stderr?: string; error?: Error }
export type SpawnFn = (cmd: string, argv: string[]) => SpawnLike;

export type RemoteTrainOutcome =
  | { degraded: true; reason: string }
  | {
      degraded: false;
      mode: 'dry-run' | 'refused' | 'preflight-failed' | 'executed';
      plan: RemoteTrainPlan;
      preflight?: { label: string; ok: boolean; detail: string }[];
      steps?: { label: string; ok: boolean; detail: string }[];
      reason?: string;
    };

/**
 * Run (or, by default, DRY-RUN) a remote-GPU tune. SAFETY MODEL:
 *   - DEFAULT (no execute): builds the plan, runs read-only preflight probes,
 *     and returns the commands that WOULD run. NO rsync of data, NO training.
 *   - execute && !yes → 'refused' (real GPU spend needs an explicit second gate).
 *   - execute && yes  → runs preflight; if unreachable → 'preflight-failed'
 *     WITHOUT training; else runs rsync + ssh ruvllm sft/dpo + fetch-back.
 *   - No `ssh` binary / host unreachable / any spawn error → structured
 *     degraded/preflight-failed. NEVER throws.
 *
 * `spawn` is injected for testing so CI never touches a live host.
 */
export async function runRemoteTrain(
  args: RemoteTrainArgs & { execute?: boolean; yes?: boolean; preflight?: boolean; spawn?: SpawnFn },
): Promise<RemoteTrainOutcome> {
  let plan: RemoteTrainPlan;
  try {
    plan = buildRemoteTrainInvocation(args);
  } catch (e) {
    return { degraded: true, reason: `plan-construction-failed: ${(e as Error).message}` };
  }

  const spawn: SpawnFn = args.spawn ?? defaultSpawn;

  // Preflight — read-only reachability/capability probes. These DO contact the
  // remote host (ssh ... true), so a bare dry-run must NOT run them: "no
  // implicit remote execution" (adversarial RC finding). Probes run only when
  // executing, or when the caller explicitly opts in with --preflight.
  const runProbe = (s: RemoteStep): { label: string; ok: boolean; detail: string } => {
    try {
      const r = spawn(s.argv[0], s.argv.slice(1));
      if (r.error) return { label: s.label, ok: false, detail: r.error.message };
      const out = `${r.stdout ?? ''}${r.stderr ?? ''}`.trim();
      const ok = (r.status ?? 1) === 0 && !/RUVLLM_MISSING|NO_NVIDIA_SMI/.test(out);
      return { label: s.label, ok, detail: out.slice(0, 200) || `exit ${r.status ?? 'null'}` };
    } catch (e) {
      return { label: s.label, ok: false, detail: (e as Error).message };
    }
  };
  const doProbe = args.execute === true || args.preflight === true;
  const preflight = doProbe ? plan.preflight.map(runProbe) : [];
  const reachable = preflight[0]?.ok === true;

  if (!args.execute) {
    // Bare dry-run is fully offline — plan + commands only, no host contact.
    return {
      degraded: false, mode: 'dry-run', plan, preflight,
      reason: doProbe ? undefined : 'offline dry-run — no host contacted. Add --preflight to probe reachability/GPU, or --execute --yes to train.',
    };
  }
  if (!args.yes) {
    return {
      degraded: false, mode: 'refused', plan, preflight,
      reason: '--execute runs REAL GPU compute on your host; re-run with --yes to confirm the spend.',
    };
  }
  if (!reachable) {
    return { degraded: false, mode: 'preflight-failed', plan, preflight, reason: 'ssh host not reachable — aborting before any data transfer or training.' };
  }

  // Execute the mutating steps sequentially, stopping at the first failure.
  const steps: { label: string; ok: boolean; detail: string }[] = [];
  for (const s of plan.steps) {
    let entry: { label: string; ok: boolean; detail: string };
    try {
      const r = spawn(s.argv[0], s.argv.slice(1));
      const out = `${r.stdout ?? ''}${r.stderr ?? ''}`.trim();
      entry = { label: s.label, ok: !r.error && (r.status ?? 1) === 0, detail: r.error ? r.error.message : (out.slice(0, 200) || `exit ${r.status ?? 'null'}`) };
    } catch (e) {
      entry = { label: s.label, ok: false, detail: (e as Error).message };
    }
    steps.push(entry);
    if (!entry.ok) break;
  }
  return { degraded: false, mode: 'executed', plan, preflight, steps };
}

/** Default spawn — synchronous child_process, imported lazily so this module
 *  stays importable in any environment. Never throws (spawnSync surfaces
 *  errors on the returned object). */
function defaultSpawn(cmd: string, argv: string[]): SpawnLike {
  try {
    const r = spawnSync(cmd, argv, { encoding: 'utf8', timeout: 30 * 60 * 1000 });
    return { status: r.status, stdout: r.stdout as string, stderr: r.stderr as string, error: r.error ?? undefined };
  } catch (e) {
    return { status: null, error: e as Error };
  }
}
