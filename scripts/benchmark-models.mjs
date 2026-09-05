#!/usr/bin/env node
/**
 * benchmark-models.mjs — Real measured benchmark of cheap-tier model
 * alternatives via OpenRouter (ADR-148 phase 2 follow-up).
 *
 * What this measures, per model, on the machine it runs on:
 *   - latency: per-query mean, p50, p95 (wall-clock, includes network)
 *   - quality: pass rate against a hand-crafted pattern check
 *   - cost:    USD per query from OpenRouter's `usage` field (tokens × price)
 *
 * The test corpus is hand-crafted to be representative of cheap-tier work
 * (single-file structural edits, naming, adds/removes) — the kind of task
 * that #2334's hybrid router should be confident on. Each row has a
 * `check` regex that the model's response must contain to count as a pass.
 *
 * USAGE
 *   # Dry run — print what would be called + cost estimate, no API calls
 *   node scripts/benchmark-models.mjs
 *
 *   # Live run — REAL OpenRouter API calls, spends real money
 *   OPENROUTER_API_KEY=sk-or-... node scripts/benchmark-models.mjs --live
 *
 *   # Custom model list
 *   node scripts/benchmark-models.mjs --live --models google/gemini-flash-1.5,openai/gpt-4o-mini
 *
 *   # Custom max-cost cap (default $0.50 — refuses to run if estimate exceeds)
 *   node scripts/benchmark-models.mjs --live --max-cost 1.00
 *
 * OUTPUT: markdown to stdout + JSON after `===BENCH_JSON===`. Writes a
 * timestamped copy under docs/benchmarks/runs/cheap-models-*.{txt,json}.
 *
 * Co-Authored-By: RuFlo <ruv@ruv.net>
 */

import { mkdirSync, writeFileSync } from 'node:fs';
import { resolve as resolvePath } from 'node:path';
import { fileURLToPath } from 'node:url';
import { dirname } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolvePath(__dirname, '..');

// ============================================================================
// Models under test (cheap-tier focus)
// ============================================================================

/**
 * Default cheap-tier candidate list. Prices are quoted public list prices in
 * USD per million tokens (input / output) as of 2026-06-15 — re-verify
 * before relying on them for cost projections.
 */
const DEFAULT_MODELS = [
  // Anthropic baseline
  { id: 'anthropic/claude-haiku-4.5',         in_per_m: 1.00,  out_per_m: 5.00, family: 'anthropic' },
  // Google (current OpenRouter slugs as of 2026-06-15)
  { id: 'google/gemini-2.5-flash-lite',       in_per_m: 0.10,  out_per_m: 0.40, family: 'google' },
  { id: 'google/gemini-2.5-flash',            in_per_m: 0.30,  out_per_m: 2.50, family: 'google' },
  // OpenAI
  { id: 'openai/gpt-4o-mini',                 in_per_m: 0.15,  out_per_m: 0.60, family: 'openai' },
  // Meta
  { id: 'meta-llama/llama-3.3-70b-instruct',  in_per_m: 0.13,  out_per_m: 0.40, family: 'meta' },
  { id: 'meta-llama/llama-3.1-8b-instruct',   in_per_m: 0.02,  out_per_m: 0.03, family: 'meta' },
  // Mistral
  { id: 'mistralai/ministral-3b-2512',        in_per_m: 0.10,  out_per_m: 0.10, family: 'mistral' },
  // Qwen
  { id: 'qwen/qwen-2.5-7b-instruct',          in_per_m: 0.05,  out_per_m: 0.10, family: 'qwen' },
  // InclusionAI — extreme cheap
  { id: 'inclusionai/ling-2.6-flash',         in_per_m: 0.01,  out_per_m: 0.03, family: 'inclusionai' },
  // NVIDIA — free Nemotron tier (cost=$0 but rate-limited; useful as a fallback / budget tier)
  { id: 'nvidia/nemotron-nano-9b-v2:free',    in_per_m: 0.00,  out_per_m: 0.00, family: 'nvidia' },
  { id: 'nvidia/nemotron-3-super-120b-a12b:free', in_per_m: 0.00, out_per_m: 0.00, family: 'nvidia' },
];

// ============================================================================
// Hand-crafted cheap-tier test corpus
// ============================================================================

const CORPUS = [
  {
    id: 'rename-1',
    task: 'Rename the variable `count` to `total` in this code. Return ONLY the corrected JavaScript, no explanation:\n\nlet count = 0;\nfor (const x of items) { count += x; }\nreturn count;',
    check: /\btotal\b[^]*\bcount\b\s*\+=|\btotal\s*\+=/,  // total appears + assignment uses it
    bannedCheck: /count/,  // and the old name shouldn't dominate
  },
  {
    id: 'console-log-1',
    task: 'Add a console.log("debug:", value) on the line before the return. Return ONLY the JavaScript, no explanation:\n\nfunction f(value) {\n  return value * 2;\n}',
    check: /console\.log\(\s*['"`]debug:?['"`]\s*,\s*value\s*\)/,
  },
  {
    id: 'var-to-const-1',
    task: 'Convert this `var` declaration to `const`. Return ONLY the JavaScript, no explanation:\n\nvar name = "alice";',
    check: /^\s*const\s+name\s*=\s*['"`]alice['"`]\s*;?\s*$/m,
  },
  {
    id: 'add-types-1',
    task: 'Add TypeScript type annotations to the parameter and return value. The function adds two numbers. Return ONLY the corrected TS, no explanation:\n\nfunction add(a, b) { return a + b; }',
    check: /function\s+add\s*\(\s*a\s*:\s*number\s*,\s*b\s*:\s*number\s*\)\s*:\s*number/,
  },
  {
    id: 'try-catch-1',
    task: 'Wrap this in a try/catch that logs the error. Return ONLY the JavaScript, no explanation:\n\nconst data = JSON.parse(input);',
    check: /try\s*\{[^]*JSON\.parse[^]*\}\s*catch/,
  },
  {
    id: 'typo-fix-1',
    task: 'Fix the spelling in the comment. Return ONLY the JavaScript, no explanation:\n\n// Recieves data from the server\nfunction handle() {}',
    check: /Receives/,
    bannedCheck: /Recieves/,
  },
  {
    id: 'remove-unused-1',
    task: 'Remove the unused import `path`. Return ONLY the JavaScript, no explanation:\n\nimport { readFileSync } from "fs";\nimport path from "path";\n\nconsole.log(readFileSync("./x"));',
    check: /^(?!.*import\s+path).*/s,
    bannedCheck: /import\s+path/,
  },
  {
    id: 'add-return-type-1',
    task: 'Add the TypeScript return type annotation. The function returns a string. Return ONLY the TS, no explanation:\n\nfunction greet(name: string) { return `hello ${name}`; }',
    check: /function\s+greet\s*\([^)]*\)\s*:\s*string/,
  },
  {
    id: 'kebab-case-1',
    task: 'Convert this camelCase variable name to kebab-case (as a string). Return ONLY the string in quotes, nothing else: myHelperFunction',
    check: /"my-helper-function"|'my-helper-function'/,
  },
  {
    id: 'increment-1',
    task: 'Increment the counter variable by 1. Return ONLY the JavaScript, no explanation:\n\nlet counter = 0;',
    check: /counter\s*\+\+|counter\s*\+=\s*1|counter\s*=\s*counter\s*\+\s*1/,
  },
  {
    id: 'simple-json-1',
    task: 'Return ONLY the JSON object {"status":"ok","code":200}, nothing else.',
    check: /\{\s*"status"\s*:\s*"ok"\s*,\s*"code"\s*:\s*200\s*\}|\{\s*"code"\s*:\s*200\s*,\s*"status"\s*:\s*"ok"\s*\}/,
  },
  {
    id: 'capitalize-1',
    task: 'Capitalize the first letter of "hello world" and return ONLY the resulting string in quotes: ',
    check: /"Hello world"|'Hello world'/,
  },
  {
    id: 'arrow-fn-1',
    task: 'Convert this function expression to an arrow function. Return ONLY the JavaScript, no explanation:\n\nconst double = function(n) { return n * 2; };',
    check: /const\s+double\s*=\s*\(?n\)?\s*=>\s*n\s*\*\s*2/,
  },
  {
    id: 'add-default-param-1',
    task: 'Add a default value of 10 for parameter `n`. Return ONLY the JavaScript, no explanation:\n\nfunction times(n) { return n * 3; }',
    check: /function\s+times\s*\(\s*n\s*=\s*10\s*\)/,
  },
  {
    id: 'snake-to-camel-1',
    task: 'Convert the snake_case name to camelCase as a string. Return ONLY the string in quotes, nothing else: get_user_profile',
    check: /"getUserProfile"|'getUserProfile'/,
  },
];

// ============================================================================
// CLI args
// ============================================================================

function parseArgs(argv) {
  const a = { live: false, models: null, maxCost: 0.50, repeat: 1, maxTokens: 256, save: true };
  for (let i = 2; i < argv.length; i++) {
    const k = argv[i];
    if (k === '--live') a.live = true;
    else if (k === '--models') a.models = argv[++i].split(',').map(s => s.trim()).filter(Boolean);
    else if (k === '--max-cost') a.maxCost = parseFloat(argv[++i]);
    else if (k === '--repeat') a.repeat = parseInt(argv[++i], 10) || 1;
    else if (k === '--max-tokens') a.maxTokens = parseInt(argv[++i], 10) || 256;
    else if (k === '--no-save') a.save = false;
    else if (k === '--help' || k === '-h') {
      console.log('Usage: node scripts/benchmark-models.mjs [--live] [--models a,b,c] [--max-cost USD] [--repeat N] [--max-tokens N] [--no-save]');
      process.exit(0);
    }
  }
  return a;
}
const ARGS = parseArgs(process.argv);

const MODELS = ARGS.models
  ? DEFAULT_MODELS.filter(m => ARGS.models.includes(m.id)).concat(
      ARGS.models.filter(id => !DEFAULT_MODELS.find(m => m.id === id))
        .map(id => ({ id, in_per_m: 0, out_per_m: 0, family: 'unknown' }))
    )
  : DEFAULT_MODELS;

// ============================================================================
// Cost estimation (used in dry-run and as a refuse-to-run gate)
// ============================================================================

/** Rough projection: assume avg 80 input tokens + 60 output tokens per query. */
const AVG_IN_TOK = 80;
const AVG_OUT_TOK = 60;

function projectedCost() {
  let total = 0;
  for (const m of MODELS) {
    const perQuery = (AVG_IN_TOK * m.in_per_m + AVG_OUT_TOK * m.out_per_m) / 1_000_000;
    total += perQuery * CORPUS.length * ARGS.repeat;
  }
  return total;
}

// ============================================================================
// OpenRouter chat-completion call
// ============================================================================

async function callOpenRouter(modelId, userPrompt, apiKey) {
  const t0 = performance.now();
  const res = await fetch('https://openrouter.ai/api/v1/chat/completions', {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
      'HTTP-Referer': 'https://github.com/ruvnet/ruflo',
      'X-Title': 'ruflo-benchmark-models',
    },
    body: JSON.stringify({
      model: modelId,
      messages: [{ role: 'user', content: userPrompt }],
      max_tokens: ARGS.maxTokens,
      temperature: 0.0,
    }),
  });
  const dt = performance.now() - t0;
  const text = await res.text();
  let body;
  try { body = JSON.parse(text); } catch { body = { _raw: text }; }
  if (!res.ok) {
    return { ok: false, status: res.status, error: body?.error?.message ?? text.slice(0, 200), latencyMs: dt };
  }
  const content = body?.choices?.[0]?.message?.content ?? '';
  const usage = body?.usage ?? {};
  return {
    ok: true,
    content,
    latencyMs: dt,
    promptTokens: usage.prompt_tokens ?? 0,
    completionTokens: usage.completion_tokens ?? 0,
    totalTokens: usage.total_tokens ?? 0,
  };
}

// ============================================================================
// Grading
// ============================================================================

function gradeResponse(row, content) {
  if (!content || typeof content !== 'string') return { pass: false, reason: 'empty response' };
  const checkPass = row.check.test(content);
  const banned = row.bannedCheck ? row.bannedCheck.test(content) : false;
  if (!checkPass) return { pass: false, reason: 'check regex did not match' };
  if (banned) return { pass: false, reason: 'banned pattern present' };
  return { pass: true };
}

// ============================================================================
// Main
// ============================================================================

async function main() {
  const apiKey = process.env.OPENROUTER_API_KEY;

  console.log('# Cheap-tier model benchmark (ADR-148 phase 2)\n');
  console.log(`- ts: ${new Date().toISOString().slice(0, 19)}Z`);
  console.log(`- node: ${process.version}  platform: ${process.platform}-${process.arch}`);
  console.log(`- corpus: ${CORPUS.length} queries × ${ARGS.repeat} repeat`);
  console.log(`- models: ${MODELS.length} (${MODELS.map(m => m.id).join(', ')})`);
  console.log(`- max-tokens per response: ${ARGS.maxTokens}`);
  const projected = projectedCost();
  console.log(`- projected total cost (rough): ~$${projected.toFixed(4)} USD (~$${(projected / MODELS.length).toFixed(4)}/model)`);
  console.log(`- max-cost gate: $${ARGS.maxCost.toFixed(2)}`);
  console.log(`- live mode: ${ARGS.live ? '**YES — real API calls**' : 'no (dry run)'}\n`);

  if (!ARGS.live) {
    console.log('Dry run — no API calls. To run for real:');
    console.log(`  OPENROUTER_API_KEY=sk-or-... node scripts/benchmark-models.mjs --live\n`);
    console.log('===BENCH_JSON===');
    console.log(JSON.stringify({ dryRun: true, projectedCostUSD: projected, models: MODELS.map(m => m.id), corpusSize: CORPUS.length }, null, 2));
    return;
  }

  if (!apiKey) {
    console.error('[bench] --live requires OPENROUTER_API_KEY in env.');
    process.exit(2);
  }

  if (projected > ARGS.maxCost) {
    console.error(`[bench] projected cost $${projected.toFixed(4)} exceeds --max-cost $${ARGS.maxCost.toFixed(2)}; refusing to run. Override with --max-cost.`);
    process.exit(3);
  }

  // Per-model accumulator
  const results = MODELS.map(m => ({
    model: m.id, family: m.family,
    latencies: [], passes: 0, total: 0, errors: [], usdCost: 0,
    promptTokens: 0, completionTokens: 0,
  }));

  for (let r = 0; r < ARGS.repeat; r++) {
    for (const row of CORPUS) {
      // Per-row, parallel over models (small fan-out — OR rate limits allowing)
      const tasks = MODELS.map((m, mi) => async () => {
        try {
          const resp = await callOpenRouter(m.id, row.task, apiKey);
          const acc = results[mi];
          acc.total++;
          acc.latencies.push(resp.latencyMs);
          if (!resp.ok) {
            acc.errors.push({ row: row.id, status: resp.status, error: resp.error });
            return;
          }
          const grade = gradeResponse(row, resp.content);
          if (grade.pass) acc.passes++;
          acc.promptTokens += resp.promptTokens;
          acc.completionTokens += resp.completionTokens;
          acc.usdCost += (resp.promptTokens * m.in_per_m + resp.completionTokens * m.out_per_m) / 1_000_000;
        } catch (e) {
          results[mi].total++;
          results[mi].errors.push({ row: row.id, error: e instanceof Error ? e.message : String(e) });
        }
      });
      await Promise.all(tasks.map(t => t()));
    }
  }

  // Aggregate + print
  const rows = results.map(r => {
    const sorted = r.latencies.slice().sort((a, b) => a - b);
    const mean = sorted.length ? sorted.reduce((s, x) => s + x, 0) / sorted.length : 0;
    const p50 = sorted.length ? sorted[Math.floor(sorted.length * 0.5)] : 0;
    const p95 = sorted.length ? sorted[Math.floor(sorted.length * 0.95)] : 0;
    // Sample std-dev of per-call latency; useful when --repeat > 1 to see how
    // stable a model's latency is across redundant runs.
    let stdev = 0;
    if (sorted.length > 1) {
      const variance = sorted.reduce((s, x) => s + (x - mean) ** 2, 0) / (sorted.length - 1);
      stdev = Math.sqrt(variance);
    }
    return {
      model: r.model, family: r.family,
      passRate: r.total ? r.passes / r.total : 0,
      passes: r.passes, total: r.total,
      latency: { mean, p50, p95, stdev },
      usdCost: r.usdCost,
      promptTokens: r.promptTokens, completionTokens: r.completionTokens,
      errorCount: r.errors.length,
      errorSample: r.errors.slice(0, 2),
    };
  });

  // Sort by pass rate desc, then by cost asc — Pareto-friendly view
  rows.sort((a, b) => b.passRate - a.passRate || a.usdCost - b.usdCost);

  const showStdev = ARGS.repeat > 1;
  console.log(`| Model | Family | Pass | Latency mean${showStdev ? ' ± σ' : ''} | p95 | $/run | $/1k passes |`);
  console.log(`|---|---|---|---|---|---|---|`);
  for (const r of rows) {
    const dollarPer1kPasses = r.passes > 0 ? (r.usdCost / r.passes) * 1000 : Infinity;
    const lat = showStdev
      ? `${r.latency.mean.toFixed(0)} ± ${r.latency.stdev.toFixed(0)} ms`
      : `${r.latency.mean.toFixed(0)} ms`;
    console.log(`| \`${r.model}\` | ${r.family} | **${r.passes}/${r.total} = ${(r.passRate * 100).toFixed(1)}%** | ${lat} | ${r.latency.p95.toFixed(0)} ms | $${r.usdCost.toFixed(5)} | ${dollarPer1kPasses === Infinity ? '∞' : '$' + dollarPer1kPasses.toFixed(4)} |`);
  }
  console.log('');
  console.log(`Total spend: $${rows.reduce((s, r) => s + r.usdCost, 0).toFixed(5)}`);
  console.log(`Total errors: ${rows.reduce((s, r) => s + r.errorCount, 0)}`);
  console.log(`\nPareto recommendation: pick the model on the upper-left of the (pass-rate, $/run) plane. Higher is better for accuracy; lower is better for cost.\n`);

  // Save artifacts
  if (ARGS.save) {
    const ts = new Date().toISOString().slice(0, 19).replace(/[:T]/g, '-') + 'Z';
    const outDir = resolvePath(REPO_ROOT, 'docs', 'benchmarks', 'runs');
    mkdirSync(outDir, { recursive: true });
    const jsonPath = resolvePath(outDir, `cheap-models-${ts}.json`);
    writeFileSync(jsonPath, JSON.stringify({
      meta: { ts: new Date().toISOString(), node: process.version, platform: `${process.platform}-${process.arch}`, args: ARGS, corpusSize: CORPUS.length },
      results: rows,
    }, null, 2));
    console.log(`Saved: ${jsonPath}`);
  }

  console.log('\n===BENCH_JSON===');
  console.log(JSON.stringify({ rows, totalSpendUSD: rows.reduce((s, r) => s + r.usdCost, 0) }, null, 2));
}

main().catch(e => { console.error('[bench] fatal:', e); process.exit(1); });
