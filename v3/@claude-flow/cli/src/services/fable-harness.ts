/**
 * fable-harness.ts — Cost-disciplined headless Fable LLM-as-judge harness.
 *
 * This is TIER 2 of the tiered `resolved` oracle (see distill-oracle.ts). When
 * a trajectory has NO mechanical test spec to execute, we judge whether its
 * completion actually resolved the task with a headless Fable model — a smarter
 * proxy than the structural verifier, but still a proxy (provenance tag
 * `judge:fable`, never presented as ground truth per ADR-169).
 *
 * ── MEASURED COST DATA (load-bearing — this file is built around it) ────────
 * `claude -p --model claude-fable-5 --output-format json` costs, per call:
 *   • ~$1.56  when launched FROM THE PROJECT DIR — it auto-loads CLAUDE.md and
 *             ~56k cache tokens of project context we do NOT want for judging.
 *   • ~$0.34  from a CLEAN empty cwd with `--append-system-prompt` for the role.
 *   • ~$0.02/item when we BATCH ~20 items into a single call (context amortizes
 *             ~free across the batch).
 *
 * Therefore this harness MUST, and does:
 *   1. run `claude -p` from a FRESH EMPTY TEMP cwd — never the project dir, so
 *      no CLAUDE.md / project context is loaded (the 5x cost driver);
 *   2. carry the judge/reflect role via `--append-system-prompt`, not a project
 *      system prompt;
 *   3. BATCH N items per call (default 20) so per-item cost collapses to ~$0.02;
 *   4. pass `--max-budget-usd` as a hard per-call cap and stop launching batches
 *      once the cumulative measured spend reaches the caller's budget;
 *   5. be OPT-IN and OFF BY DEFAULT — nothing here runs unless a caller
 *      explicitly constructs the harness AND provides a budget cap.
 *
 * SAFETY: constructing this class spends nothing. Only `judgeBatch` /
 * `reflectFailures` spawn `claude`, and only when `maxBudgetUsd > 0`. The
 * `spawnClaude` implementation is injectable so tests never touch the real CLI.
 *
 * @module services/fable-harness
 */

import { spawn } from 'child_process';
import { mkdtemp, rm } from 'fs/promises';
import { tmpdir } from 'os';
import { join } from 'path';

// ── Cost model (measured — exported so callers/docs share one source) ────────

export const FABLE_COST_MODEL = {
  /** Measured $/call when launched from the project dir (loads CLAUDE.md). Anti-pattern. */
  perCallProjectCwdUsd: 1.56,
  /** Measured $/call from a clean cwd with --append-system-prompt. */
  perCallCleanCwdUsd: 0.34,
  /** Measured amortized $/item when batching ~20 items per call. */
  perItemBatchedUsd: 0.02,
  /** Default items per `claude -p` call. */
  defaultBatchSize: 20,
  /** The judge model. */
  model: 'claude-fable-5',
} as const;

/**
 * Estimate the USD cost of judging `itemCount` items in batches of `batchSize`.
 * Uses the measured amortized per-item figure; callers use this to size a
 * budget cap before opting in.
 */
export function estimateFableCostUsd(itemCount: number, batchSize: number = FABLE_COST_MODEL.defaultBatchSize): number {
  if (itemCount <= 0) return 0;
  const batches = Math.ceil(itemCount / Math.max(1, batchSize));
  // Amortized per-item dominates; add a tiny floor per batch for the base call.
  const perItem = itemCount * FABLE_COST_MODEL.perItemBatchedUsd;
  const perBatchFloor = batches * 0.0; // per-item figure already includes base amortization
  return Number((perItem + perBatchFloor).toFixed(4));
}

// ── Types ────────────────────────────────────────────────────────────────

/** One item to judge: did `output` actually resolve `task`? */
export interface JudgeItem {
  id: string;
  task: string;
  output: string;
}

/** Verdict for a single judged item. */
export interface JudgeResult {
  id: string;
  resolved: boolean;
  /** 0..1 self-reported judge confidence. */
  confidence: number;
  reason: string;
}

/** One item for reflective failure analysis (GEPA/evolve mutation input). */
export interface ReflectItem {
  id: string;
  task: string;
  output: string;
  /** Optional signal that this trajectory is believed to have failed. */
  failureHint?: string;
}

/** Reflective diagnosis for a single item (the reflective-mutation SOTA trick). */
export interface ReflectResult {
  id: string;
  failureClass: string;
  diagnosis: string;
  mutationHint: string;
}

/**
 * ADR-316 — a compact, STRUCTURAL-ONLY snapshot of the current coding
 * session for the statusline's co-pilot advisor tip. Every field here
 * mirrors funnel/insights.ts's LocalInsightContext — no raw prompt/command/
 * file content, ever (same bar as ADR-309, applied to a different, opt-in
 * data flow). The model sees only what's already surfaced structurally
 * elsewhere in the statusline.
 */
export interface CoPilotSnapshot {
  security?: { status: string; findings?: number; cvesFixed: number; totalCves: number };
  swarm?: { activeAgents: number; maxAgents: number; coordinationActive: boolean };
  gitUncommittedCount?: number;
  contextPctUsed?: number;
}

/** A single proactive suggestion for the insight ticker. */
export interface CoPilotTip {
  /** Short enough for a single statusline row (caller truncates further). */
  headline: string;
  /** One actionable sentence of extra detail. */
  detail: string;
  confidence: number;
}

/** Result of a raw claude spawn. */
export interface ClaudeSpawnResult {
  stdout: string;
  stderr: string;
  code: number | null;
  /** Measured spend for this call, parsed from the JSON envelope when present. */
  costUsd?: number;
}

/**
 * Injectable spawner. Receives the argv (after `claude`), the prompt to pipe to
 * stdin, and the cwd (a fresh empty temp dir). Default implementation shells out
 * to the real `claude` CLI; tests inject a fake.
 */
export type ClaudeSpawnFn = (
  argv: string[],
  stdinPrompt: string,
  cwd: string,
  opts: { timeoutMs: number },
) => Promise<ClaudeSpawnResult>;

export interface FableHarnessOptions {
  /** Model id (default claude-fable-5). */
  model?: string;
  /** Items per `claude -p` call (default 20). */
  batchSize?: number;
  /**
   * Hard budget cap in USD across all calls this harness makes. REQUIRED to be
   * > 0 for any spend to happen — 0/undefined means the harness refuses to
   * spawn (safe default).
   */
  maxBudgetUsd?: number;
  /** Per-call timeout (default 5 min). */
  timeoutMs?: number;
  /** Injected spawner for tests; defaults to the real `claude` CLI. */
  spawnClaude?: ClaudeSpawnFn;
}

// ── Prompt templates (carried via --append-system-prompt) ────────────────────

const JUDGE_SYSTEM_PROMPT = [
  'You are a strict evaluator judging whether an agent trajectory RESOLVED its task.',
  'You receive a JSON array of items: [{id, task, output}].',
  'For each item decide if `output` genuinely and correctly resolves `task`.',
  'Be conservative: plausible-but-unverified or partial completions are NOT resolved.',
  'Reply with ONLY a JSON array, one object per input id, no prose:',
  '[{"id": "...", "resolved": true|false, "confidence": 0.0-1.0, "reason": "<one sentence>"}]',
].join('\n');

const REFLECT_SYSTEM_PROMPT = [
  'You are a failure-analysis expert supporting reflective mutation (GEPA/evolve).',
  'You receive a JSON array of items: [{id, task, output, failureHint?}].',
  'For each item, classify the failure and propose a concrete mutation hint.',
  'Reply with ONLY a JSON array, one object per input id, no prose:',
  '[{"id":"...","failureClass":"<short label>","diagnosis":"<one sentence>","mutationHint":"<actionable>"}]',
].join('\n');

const ADVISOR_SYSTEM_PROMPT = [
  "You are RuFlo's co-pilot advisor: ONE short, proactive, actionable tip for",
  'a developer, based on a single JSON object describing STRUCTURAL signals',
  'from their current coding session (security scan status, swarm/agent',
  'state, count of uncommitted files, context-window usage). There is no',
  'prompt, command, or file content in the input — never assume or invent any.',
  'If nothing in the snapshot genuinely warrants a tip, say so by returning',
  'an empty array. Never pad with generic advice not grounded in the snapshot.',
  'Reply with ONLY a JSON array containing zero or one object, no prose:',
  '[] or [{"headline":"<=60 chars","detail":"<one actionable sentence>","confidence":0.0-1.0}]',
].join('\n');

// ── Default spawner (real CLI) ───────────────────────────────────────────────

/**
 * Default `claude -p` spawner. Pipes the prompt via stdin (never as an argv
 * positional — mirrors the #1852 fix so shell metachars in prompts are never
 * re-tokenized), runs in the provided (temp) cwd, and returns stdout/stderr.
 * Parses `total_cost_usd` from the `--output-format json` envelope when present.
 */
export const defaultSpawnClaude: ClaudeSpawnFn = (argv, stdinPrompt, cwd, opts) =>
  new Promise<ClaudeSpawnResult>((resolve) => {
    let child;
    try {
      child = spawn('claude', argv, {
        cwd,
        env: { ...process.env, CLAUDE_ENTRYPOINT: 'fable-judge' },
        stdio: ['pipe', 'pipe', 'pipe'],
        windowsHide: true,
      });
    } catch (err) {
      resolve({ stdout: '', stderr: err instanceof Error ? err.message : String(err), code: null });
      return;
    }

    let stdout = '';
    let stderr = '';
    let done = false;
    const finish = (r: ClaudeSpawnResult) => {
      if (done) return;
      done = true;
      clearTimeout(timer);
      resolve(r);
    };

    const timer = setTimeout(() => {
      try { child.kill('SIGTERM'); } catch { /* already dead */ }
      finish({ stdout, stderr: stderr || `timed out after ${opts.timeoutMs}ms`, code: null });
    }, opts.timeoutMs);
    timer.unref?.();

    try { child.stdin?.end(stdinPrompt); } catch { /* surfaced via error */ }
    child.stdout?.on('data', (d: Buffer) => { stdout += d.toString(); });
    child.stderr?.on('data', (d: Buffer) => { stderr += d.toString(); });
    child.on('error', (e: Error) => finish({ stdout, stderr: e.message, code: null }));
    child.on('close', (code: number | null) => {
      finish({ stdout, stderr, code, costUsd: parseCostFromEnvelope(stdout) });
    });
  });

/** Pull `total_cost_usd`/`cost_usd` out of a claude `--output-format json` envelope. */
export function parseCostFromEnvelope(stdout: string): number | undefined {
  const env = tryParseJson(stdout);
  if (env && typeof env === 'object') {
    const o = env as Record<string, unknown>;
    for (const k of ['total_cost_usd', 'cost_usd', 'costUsd']) {
      if (typeof o[k] === 'number') return o[k] as number;
    }
  }
  return undefined;
}

// ── Harness ──────────────────────────────────────────────────────────────

export class FableHarness {
  private readonly model: string;
  private readonly batchSize: number;
  private readonly maxBudgetUsd: number;
  private readonly timeoutMs: number;
  private readonly spawnClaude: ClaudeSpawnFn;
  private spentUsd = 0;

  constructor(opts: FableHarnessOptions = {}) {
    this.model = opts.model ?? FABLE_COST_MODEL.model;
    this.batchSize = Math.max(1, opts.batchSize ?? FABLE_COST_MODEL.defaultBatchSize);
    this.maxBudgetUsd = opts.maxBudgetUsd ?? 0;
    this.timeoutMs = opts.timeoutMs ?? 5 * 60 * 1000;
    this.spawnClaude = opts.spawnClaude ?? defaultSpawnClaude;
  }

  /** Cumulative measured spend across all calls this harness has made. */
  getSpentUsd(): number {
    return Number(this.spentUsd.toFixed(4));
  }

  /** True when a positive budget cap is configured (a precondition for any spend). */
  isEnabled(): boolean {
    return this.maxBudgetUsd > 0;
  }

  /**
   * Judge a set of items in batches. Returns one JudgeResult per input id that
   * the model returned. Items that fall outside the budget, or that the model
   * omits, are simply absent from the result — the caller (distill-oracle) is
   * responsible for falling back to the structural proxy for those.
   *
   * Spends $0 and returns [] when no budget cap is configured.
   */
  async judgeBatch(items: JudgeItem[]): Promise<JudgeResult[]> {
    if (items.length === 0) return [];
    if (!this.isEnabled()) return [];
    const out: JudgeResult[] = [];
    for (const batch of chunk(items, this.batchSize)) {
      if (this.spentUsd >= this.maxBudgetUsd) break;
      const parsed = await this.runBatch(JUDGE_SYSTEM_PROMPT, batch);
      for (const raw of parsed) {
        const r = normalizeJudge(raw);
        if (r) out.push(r);
      }
    }
    return out;
  }

  /**
   * Reflective failure analysis over items — the second cost-disciplined entry
   * point, used by GEPA/evolve for mutation hints. Same batching + budget
   * discipline as judgeBatch. Returns [] when no budget cap is configured.
   */
  async reflectFailures(items: ReflectItem[]): Promise<ReflectResult[]> {
    if (items.length === 0) return [];
    if (!this.isEnabled()) return [];
    const out: ReflectResult[] = [];
    for (const batch of chunk(items, this.batchSize)) {
      if (this.spentUsd >= this.maxBudgetUsd) break;
      const parsed = await this.runBatch(REFLECT_SYSTEM_PROMPT, batch);
      for (const raw of parsed) {
        const r = normalizeReflect(raw);
        if (r) out.push(r);
      }
    }
    return out;
  }

  /**
   * ADR-316 — one proactive co-pilot tip from a structural session snapshot
   * (no raw prompt/command/file content). A single-item "batch" — same
   * budget/cwd/parsing discipline as judgeBatch/reflectFailures, just with
   * exactly one call instead of a loop. Returns null when disabled, over
   * budget, or the model found nothing worth surfacing (an empty verdict
   * array is a valid, non-error answer here, not a parse failure).
   */
  async adviseCoPilotTip(snapshot: CoPilotSnapshot): Promise<CoPilotTip | null> {
    if (!this.isEnabled()) return null;
    if (this.spentUsd >= this.maxBudgetUsd) return null;
    const parsed = await this.runBatch(ADVISOR_SYSTEM_PROMPT, [snapshot]);
    if (parsed.length === 0) return null;
    return normalizeCoPilotTip(parsed[0]);
  }

  /** Build the argv for a `claude -p` call. Exposed shape for testability. */
  buildArgv(systemPrompt: string): string[] {
    const perCallCap = Math.max(0, this.maxBudgetUsd - this.spentUsd);
    return [
      '-p',
      '--model', this.model,
      '--output-format', 'json',
      '--append-system-prompt', systemPrompt,
      '--max-budget-usd', String(round(perCallCap)),
    ];
  }

  /**
   * Run one batch: create a FRESH EMPTY temp cwd (critical — no project
   * context), spawn `claude -p` there with the role via --append-system-prompt,
   * pipe the batch JSON to stdin, parse the verdict array out of the envelope,
   * and account the measured spend.
   */
  private async runBatch(systemPrompt: string, batch: readonly unknown[]): Promise<unknown[]> {
    const argv = this.buildArgv(systemPrompt);
    const stdinPrompt = JSON.stringify(batch);
    const cwd = await mkdtemp(join(tmpdir(), 'ruflo-fable-'));
    try {
      const res = await this.spawnClaude(argv, stdinPrompt, cwd, { timeoutMs: this.timeoutMs });
      // Account spend: prefer measured envelope cost, else the amortized estimate.
      this.spentUsd += typeof res.costUsd === 'number'
        ? res.costUsd
        : estimateFableCostUsd(batch.length, this.batchSize);
      if (res.code !== 0 && !res.stdout) return [];
      return extractVerdictArray(res.stdout);
    } finally {
      await rm(cwd, { recursive: true, force: true }).catch(() => { /* best-effort cleanup */ });
    }
  }
}

// ── Parsing helpers ──────────────────────────────────────────────────────

/**
 * Extract the model's verdict array. `claude -p --output-format json` wraps the
 * assistant text in an envelope `{ result: "<text>", ... }`; the text is itself
 * the JSON array we asked for. Handle both the enveloped and bare forms, and
 * arrays fenced in ```json blocks.
 */
export function extractVerdictArray(stdout: string): unknown[] {
  const trimmed = (stdout ?? '').trim();
  if (!trimmed) return [];

  // 1. Enveloped: parse envelope, then its `result` field.
  const env = tryParseJson(trimmed);
  if (env && typeof env === 'object' && !Array.isArray(env)) {
    const result = (env as Record<string, unknown>).result;
    if (typeof result === 'string') {
      const inner = findJsonArray(result);
      if (inner) return inner;
    }
    // Some envelopes embed the array directly.
    const direct = (env as Record<string, unknown>).results;
    if (Array.isArray(direct)) return direct;
  }
  if (Array.isArray(env)) return env;

  // 2. Bare text: find a JSON array anywhere in stdout.
  const arr = findJsonArray(trimmed);
  return arr ?? [];
}

function findJsonArray(text: string): unknown[] | null {
  const fenced = text.match(/```(?:json)?\s*(\[[\s\S]*?\])\s*```/);
  if (fenced) {
    const v = tryParseJson(fenced[1]);
    if (Array.isArray(v)) return v;
  }
  const bare = text.match(/\[[\s\S]*\]/);
  if (bare) {
    const v = tryParseJson(bare[0]);
    if (Array.isArray(v)) return v;
  }
  return null;
}

function normalizeJudge(raw: unknown): JudgeResult | null {
  if (!raw || typeof raw !== 'object') return null;
  const o = raw as Record<string, unknown>;
  if (typeof o.id !== 'string') return null;
  return {
    id: o.id,
    resolved: o.resolved === true || o.resolved === 'true',
    confidence: clamp01(typeof o.confidence === 'number' ? o.confidence : Number(o.confidence)),
    reason: typeof o.reason === 'string' ? o.reason : '',
  };
}

function normalizeReflect(raw: unknown): ReflectResult | null {
  if (!raw || typeof raw !== 'object') return null;
  const o = raw as Record<string, unknown>;
  if (typeof o.id !== 'string') return null;
  return {
    id: o.id,
    failureClass: typeof o.failureClass === 'string' ? o.failureClass : 'unknown',
    diagnosis: typeof o.diagnosis === 'string' ? o.diagnosis : '',
    mutationHint: typeof o.mutationHint === 'string' ? o.mutationHint : '',
  };
}

function normalizeCoPilotTip(raw: unknown): CoPilotTip | null {
  if (!raw || typeof raw !== 'object') return null;
  const o = raw as Record<string, unknown>;
  if (typeof o.headline !== 'string' || !o.headline.trim()) return null;
  return {
    headline: o.headline.slice(0, 80),
    detail: typeof o.detail === 'string' ? o.detail.slice(0, 200) : '',
    confidence: clamp01(typeof o.confidence === 'number' ? o.confidence : Number(o.confidence)),
  };
}

function tryParseJson(s: string): unknown {
  try { return JSON.parse(s); } catch { return undefined; }
}

function chunk<T>(arr: T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < arr.length; i += size) out.push(arr.slice(i, i + size));
  return out;
}

function clamp01(n: number): number {
  if (!Number.isFinite(n)) return 0;
  return Math.max(0, Math.min(1, n));
}

function round(n: number): number {
  return Math.round(n * 100) / 100;
}

export default FableHarness;
