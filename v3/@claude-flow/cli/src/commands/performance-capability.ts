/**
 * V3 CLI Performance Capability Benchmark
 *
 * Runs a small verifiable-answer corpus through the Anthropic API and reports
 * pass-rate, latency, and cost. Closes the capability-evaluation gap that
 * `performance benchmark --suite agent` does NOT cover — that suite measures
 * the agent control plane (router, memory, hooks) without LLM calls; this
 * subcommand measures the actual model's ability to solve agent-style tasks.
 *
 * Features:
 *   - Parallel execution with configurable concurrency
 *   - Multi-model comparison in a single run (`--models a,b,c`)
 *   - Per-task max-tokens overrides (declared in the fixture)
 *   - Configurable corpus via `--questions <path>`
 *
 * Inspired by GAIA / SWE-bench / GSM8K but text-only and scoreable via
 * substring / exact match — no web browsing, no file attachments, no
 * Hugging Face dataset download.
 *
 * API key resolution (in order):
 *   1. $ANTHROPIC_API_KEY env var
 *   2. `gcloud secrets versions access latest --secret=ANTHROPIC_API_KEY`
 *   3. Fail with a clear error
 *
 * Refs: #2156 (Dream Cycle 2026-05-27 capabilities scan)
 */

import { execSync } from 'node:child_process';
import * as fs from 'node:fs';
import * as path from 'node:path';
import type { Command, CommandContext, CommandResult } from '../types.js';
import { output } from '../output.js';
import { BUILTIN_CAPABILITY_TASKS } from '../benchmarks/capability-tasks.js';

interface Task {
  id: string;
  category: string;
  prompt: string;
  expected: string;
  matchMode: 'exact' | 'substring' | 'regex';
  /** Optional per-task max_tokens override. Defaults to the run-level --max-tokens. */
  maxTokens?: number;
}

interface TaskFile {
  version: string;
  description?: string;
  answerFormat?: string;
  tasks: Task[];
}

interface RunResult {
  id: string;
  category: string;
  model: string;
  correct: boolean;
  answer: string;
  expected: string;
  latencyMs: number;
  inputTokens: number;
  outputTokens: number;
  error?: string;
}

// Anthropic pricing (per 1M tokens, USD)
const PRICING: Record<string, { in: number; out: number }> = {
  'claude-haiku-4-5': { in: 1.0, out: 5.0 },
  'claude-haiku-4-5-20251001': { in: 1.0, out: 5.0 },
  'claude-sonnet-4-6': { in: 3.0, out: 15.0 },
  'claude-opus-4-7': { in: 15.0, out: 75.0 },
};

const DEFAULT_MAX_TOKENS = 256;

function resolveApiKey(): string {
  const envKey = process.env.ANTHROPIC_API_KEY;
  if (envKey && envKey.trim()) return envKey.trim();

  try {
    const out = execSync(
      'gcloud secrets versions access latest --secret=ANTHROPIC_API_KEY 2>/dev/null',
      { encoding: 'utf-8', timeout: 10_000 },
    ).trim();
    if (out) return out;
  } catch {
    /* fall through */
  }

  throw new Error(
    'ANTHROPIC_API_KEY not found. Set the env var or store it as a gcloud secret named ANTHROPIC_API_KEY (e.g. `echo -n "$KEY" | gcloud secrets versions add ANTHROPIC_API_KEY --data-file=-`).',
  );
}

function loadTaskFile(custom?: string): TaskFile {
  if (custom) {
    const resolved = path.resolve(custom);
    if (!fs.existsSync(resolved)) throw new Error(`questions file not found: ${resolved}`);
    return JSON.parse(fs.readFileSync(resolved, 'utf-8')) as TaskFile;
  }
  return BUILTIN_CAPABILITY_TASKS as unknown as TaskFile;
}

function buildPrompt(task: Task): string {
  return `You are answering an agent-capability benchmark question. Show only the key reasoning steps (one or two lines), then wrap your final answer in <answer>...</answer> tags. Be exact — the harness compares the tag contents to a ground-truth string.

Question: ${task.prompt}`;
}

function extractAnswer(text: string): string {
  const m = text.match(/<answer>([\s\S]*?)<\/answer>/i);
  if (m && m[1] !== undefined) return m[1].trim();
  // Fallback: take last non-empty line. Strip leading markdown bullets/quotes/heading marks
  // and trailing sentence-ending punctuation. Models sometimes give the bare answer on the
  // final line without the <answer> tags, often prefixed with "- " or "* " from a list.
  const lines = text.split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
  const last = lines[lines.length - 1] || '';
  return last
    .replace(/^[-*>#\s]+/, '')      // leading bullet / quote / heading
    .replace(/^\*\*|\*\*$/g, '')    // bold markers
    .replace(/[.,!?]+$/, '')        // trailing punctuation
    .trim();
}

function check(answer: string, task: Task): boolean {
  const a = answer.trim().toLowerCase();
  const e = task.expected.trim().toLowerCase();
  switch (task.matchMode) {
    case 'exact':
      return a === e;
    case 'substring':
      return a.includes(e);
    case 'regex':
      try {
        return new RegExp(task.expected, 'i').test(answer);
      } catch {
        return false;
      }
    default:
      return false;
  }
}

async function callAnthropic(
  apiKey: string,
  model: string,
  prompt: string,
  maxTokens: number,
  timeoutMs: number,
): Promise<{ text: string; inputTokens: number; outputTokens: number }> {
  const ac = new AbortController();
  const timer = setTimeout(() => ac.abort(), timeoutMs);
  try {
    const resp = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'x-api-key': apiKey,
        'anthropic-version': '2023-06-01',
        'Content-Type': 'application/json',
      },
      signal: ac.signal,
      body: JSON.stringify({
        model,
        max_tokens: maxTokens,
        messages: [{ role: 'user', content: prompt }],
      }),
    });
    if (!resp.ok) {
      const body = await resp.text().catch(() => '');
      throw new Error(`HTTP ${resp.status}: ${body.slice(0, 200)}`);
    }
    const body = (await resp.json()) as {
      content?: { text?: string }[];
      usage?: { input_tokens?: number; output_tokens?: number };
    };
    const text = body.content?.[0]?.text ?? '';
    return {
      text,
      inputTokens: body.usage?.input_tokens ?? 0,
      outputTokens: body.usage?.output_tokens ?? 0,
    };
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Concurrency-limited parallel mapper. Avoids a p-limit dep; rate-limits via
 * a sliding window of in-flight promises. Anthropic Haiku tier-1 has 50 RPM
 * + 50K TPM headroom — concurrency 4 keeps us well under both.
 */
async function parallelMap<T, R>(
  items: T[],
  concurrency: number,
  fn: (item: T, idx: number) => Promise<R>,
): Promise<R[]> {
  const results: R[] = new Array(items.length);
  let cursor = 0;
  async function worker(): Promise<void> {
    while (true) {
      const i = cursor++;
      if (i >= items.length) return;
      results[i] = await fn(items[i], i);
    }
  }
  const workers = Array.from({ length: Math.min(concurrency, items.length) }, () => worker());
  await Promise.all(workers);
  return results;
}

async function runOne(
  task: Task,
  model: string,
  apiKey: string,
  defaultMaxTokens: number,
  timeoutMs: number,
): Promise<RunResult> {
  const maxTokens = task.maxTokens ?? defaultMaxTokens;
  const start = performance.now();
  try {
    const { text, inputTokens, outputTokens } = await callAnthropic(
      apiKey,
      model,
      buildPrompt(task),
      maxTokens,
      timeoutMs,
    );
    const answer = extractAnswer(text);
    return {
      id: task.id,
      category: task.category,
      model,
      correct: check(answer, task),
      answer,
      expected: task.expected,
      latencyMs: performance.now() - start,
      inputTokens,
      outputTokens,
    };
  } catch (err) {
    return {
      id: task.id,
      category: task.category,
      model,
      correct: false,
      answer: '',
      expected: task.expected,
      latencyMs: performance.now() - start,
      inputTokens: 0,
      outputTokens: 0,
      error: (err as Error).message.slice(0, 120),
    };
  }
}

function summarizeModel(results: RunResult[]): {
  model: string;
  passed: number;
  total: number;
  passRate: number;
  meanLatencyMs: number;
  totalInputTokens: number;
  totalOutputTokens: number;
  estCostUsd: number;
} {
  const model = results[0]?.model ?? '';
  const passed = results.filter((r) => r.correct).length;
  const meanLatencyMs = results.reduce((a, b) => a + b.latencyMs, 0) / results.length;
  const totalInputTokens = results.reduce((a, b) => a + b.inputTokens, 0);
  const totalOutputTokens = results.reduce((a, b) => a + b.outputTokens, 0);
  const price = PRICING[model] ?? { in: 3.0, out: 15.0 };
  const estCostUsd = (totalInputTokens / 1_000_000) * price.in + (totalOutputTokens / 1_000_000) * price.out;
  return {
    model,
    passed,
    total: results.length,
    passRate: passed / results.length,
    meanLatencyMs,
    totalInputTokens,
    totalOutputTokens,
    estCostUsd,
  };
}

const capabilityCommand: Command = {
  name: 'capability',
  description: 'Run a real LLM-driven agent-capability benchmark against the Anthropic API',
  options: [
    { name: 'model', short: 'm', type: 'string', description: 'Single model id (default: claude-haiku-4-5). Overridden by --models.', default: 'claude-haiku-4-5' },
    { name: 'models', short: 'M', type: 'string', description: 'Comma-separated list of models for cross-model comparison (e.g. claude-haiku-4-5,claude-sonnet-4-6)' },
    { name: 'questions', short: 'q', type: 'string', description: 'Path to a custom tasks JSON file (default: built-in fixture)' },
    { name: 'concurrency', short: 'c', type: 'number', description: 'Parallel in-flight requests', default: '4' },
    { name: 'max-tokens', type: 'number', description: 'Default max_tokens cap (per-task overrides in fixture take precedence)', default: String(DEFAULT_MAX_TOKENS) },
    { name: 'timeout', short: 't', type: 'number', description: 'Per-question timeout (ms)', default: '30000' },
    { name: 'limit', short: 'l', type: 'number', description: 'Run only the first N questions' },
    { name: 'output', short: 'o', type: 'string', description: 'Output format: text, json', default: 'text' },
  ],
  examples: [
    { command: 'claude-flow performance capability', description: 'Run the built-in fixture against Haiku (parallel, default)' },
    { command: 'claude-flow performance capability -M claude-haiku-4-5,claude-sonnet-4-6', description: 'Compare Haiku vs Sonnet on every question' },
    { command: 'claude-flow performance capability -c 8 -o json', description: 'Higher concurrency, emit JSON' },
    { command: 'claude-flow performance capability -q ./my-eval.json -l 3', description: 'Custom dataset, first 3 only' },
  ],
  action: async (ctx: CommandContext): Promise<CommandResult> => {
    const modelsFlag = ctx.flags.models as string | undefined;
    const singleModel = (ctx.flags.model as string) || 'claude-haiku-4-5';
    const models = modelsFlag
      ? modelsFlag.split(',').map((m) => m.trim()).filter(Boolean)
      : [singleModel];
    const customPath = ctx.flags.questions as string | undefined;
    const outputFormat = (ctx.flags.output as string) || 'text';
    const timeoutMs = parseInt(String(ctx.flags.timeout ?? '30000'), 10);
    const limit = ctx.flags.limit ? parseInt(String(ctx.flags.limit), 10) : undefined;
    const concurrency = Math.max(1, parseInt(String(ctx.flags.concurrency ?? '4'), 10));
    const defaultMaxTokens = Math.max(32, parseInt(String(ctx.flags['max-tokens'] ?? DEFAULT_MAX_TOKENS), 10));

    output.writeln();
    output.writeln(output.bold('Agent Capability Benchmark (Anthropic API)'));
    output.writeln(output.dim('─'.repeat(60)));

    let apiKey: string;
    try {
      apiKey = resolveApiKey();
    } catch (err) {
      output.writeln(output.error((err as Error).message));
      return { success: false, message: (err as Error).message, exitCode: 1 };
    }

    let file: TaskFile;
    try {
      file = loadTaskFile(customPath);
    } catch (err) {
      output.writeln(output.error((err as Error).message));
      return { success: false, message: (err as Error).message, exitCode: 1 };
    }

    const tasks = limit ? file.tasks.slice(0, limit) : file.tasks;
    output.writeln(`Models:        ${models.join(', ')}`);
    output.writeln(`Questions:     ${tasks.length}${customPath ? ` (custom: ${customPath})` : ' (built-in fixture)'}`);
    output.writeln(`Concurrency:   ${concurrency}`);
    output.writeln(`Default cap:   ${defaultMaxTokens} tokens (per-task override allowed)`);
    output.writeln();

    const startWall = performance.now();
    const spinner = output.createSpinner({ text: `Running ${models.length * tasks.length} requests...`, spinner: 'dots' });
    spinner.start();

    // Build flat list of (task, model) pairs, then parallel-execute with concurrency limiter.
    const work: Array<{ task: Task; model: string }> = [];
    for (const model of models) {
      for (const task of tasks) work.push({ task, model });
    }

    const results = await parallelMap(work, concurrency, async ({ task, model }) => {
      return runOne(task, model, apiKey, defaultMaxTokens, timeoutMs);
    });

    const wallMs = performance.now() - startWall;
    spinner.succeed(`Completed ${results.length} requests in ${(wallMs / 1000).toFixed(2)}s`);

    // Group by model for per-model summary
    const byModel = new Map<string, RunResult[]>();
    for (const r of results) {
      const arr = byModel.get(r.model) ?? [];
      arr.push(r);
      byModel.set(r.model, arr);
    }
    const summaries = [...byModel.entries()].map(([, arr]) => summarizeModel(arr));

    if (outputFormat === 'json') {
      output.printJson({
        models,
        questions: tasks.length,
        concurrency,
        wallMs,
        summaries,
        results,
      });
      const overallPass = summaries.every((s) => s.passRate >= 0.5);
      return { success: overallPass, data: { summaries, results } };
    }

    // Per-model detail tables
    for (const [model, arr] of byModel) {
      output.writeln();
      output.writeln(output.bold(`${model}`));
      output.printTable({
        columns: [
          { key: 'id', header: 'Question', width: 22 },
          { key: 'category', header: 'Category', width: 24 },
          { key: 'correct', header: 'Pass', width: 6 },
          { key: 'latency', header: 'Latency', width: 10 },
          { key: 'answer', header: 'Answer (got vs expected)', width: 36 },
        ],
        data: arr.map((r) => ({
          id: r.id,
          category: r.category,
          correct: r.correct ? output.success('✓') : output.error('✗'),
          latency: `${r.latencyMs.toFixed(0)}ms`,
          answer: r.error
            ? output.dim(`error: ${r.error}`)
            : r.correct
              ? r.answer.slice(0, 34)
              : `${r.answer.slice(0, 14)} ≠ ${r.expected.slice(0, 14)}`,
        })),
      });
    }

    // Cross-model summary table
    output.writeln();
    output.writeln(output.bold('Summary'));
    output.printTable({
      columns: [
        { key: 'model', header: 'Model', width: 26 },
        { key: 'pass', header: 'Pass', width: 14 },
        { key: 'mean', header: 'Mean Lat', width: 12 },
        { key: 'tokens', header: 'Tokens (in/out)', width: 18 },
        { key: 'cost', header: 'Est. Cost', width: 12 },
      ],
      data: summaries.map((s) => ({
        model: s.model,
        pass: `${(s.passRate * 100).toFixed(1)}% (${s.passed}/${s.total})`,
        mean: `${s.meanLatencyMs.toFixed(0)}ms`,
        tokens: `${s.totalInputTokens} / ${s.totalOutputTokens}`,
        cost: `$${s.estCostUsd.toFixed(4)}`,
      })),
    });

    output.writeln();
    output.writeln(output.dim(`Wall time: ${(wallMs / 1000).toFixed(2)}s (concurrency=${concurrency})`));

    const overallPass = summaries.every((s) => s.passRate >= 0.5);
    return { success: overallPass, data: { summaries, wallMs, results } };
  },
};

export default capabilityCommand;
