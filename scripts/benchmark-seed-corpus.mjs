#!/usr/bin/env node
/**
 * benchmark-seed-corpus.mjs — DRACO-style measurement of the bundled
 * seed corpus (ADR-149).
 *
 * For each row in `v3/@claude-flow/cli/assets/model-router/seed-rows.json`,
 * runs the templated task against every candidate model in the registry,
 * LLM-judges each response (anthropic/claude-sonnet-4-6 by default) over a
 * 3-criterion rubric tuned to the row's expected tier, and writes the
 * measured `scores: {model_id: 0..1}` map back to the row.
 *
 * This is the data lift that makes ADR-149's qualityBar selection actually
 * cost-optimal — without measured scores, the bundled KRR fits to assumptions.
 *
 * USAGE
 *   # Dry-run (default — no API calls, prints projected cost)
 *   node scripts/benchmark-seed-corpus.mjs
 *
 *   # Live — REAL OpenRouter API calls, spends real money
 *   OPENROUTER_API_KEY=sk-or-... node scripts/benchmark-seed-corpus.mjs --live
 *
 *   # Subset (testing): first 8 rows only
 *   node scripts/benchmark-seed-corpus.mjs --live --max-rows 8
 *
 *   # Custom candidate list
 *   node scripts/benchmark-seed-corpus.mjs --live --models a,b,c
 *
 *   # Different judge
 *   node scripts/benchmark-seed-corpus.mjs --live --judge openai/gpt-4.1
 *
 * COST NOTE: 64 rows × ~5 candidates = ~320 candidate calls + ~320 judge calls.
 * Cheap-tier rows are short (~50 input / ~80 output tokens); strong-tier rows
 * are longer (~200 input / ~400 output). Projected: ~$1-3 USD. Default
 * --max-cost gate is $5.00.
 *
 * Co-Authored-By: RuFlo <ruv@ruv.net>
 */

import { existsSync, readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { resolve as resolvePath, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolvePath(__dirname, '..');
const SEED_PATH = resolvePath(REPO_ROOT, 'v3', '@claude-flow', 'cli', 'assets', 'model-router', 'seed-rows.json');
const PROVENANCE_PATH = resolvePath(REPO_ROOT, 'v3', '@claude-flow', 'cli', 'assets', 'model-router', 'seed-rows.provenance.json');

// ============================================================================
// Candidate registry — the models we'll score every row against.
// Prices: USD per million tokens (input / output) as of 2026-06-15.
// ============================================================================

const DEFAULT_CANDIDATES = [
  // Cheap-tier (measured 100% pass over 45 runs on the cheap bench)
  { id: 'inclusionai/ling-2.6-flash',          in_per_m: 0.01,  out_per_m: 0.03,  tier: 'haiku'  },
  { id: 'google/gemini-2.5-flash-lite',        in_per_m: 0.10,  out_per_m: 0.40,  tier: 'haiku'  },
  // Cheap-tier control: the Anthropic default
  { id: 'anthropic/claude-haiku-4.5',          in_per_m: 1.00,  out_per_m: 5.00,  tier: 'haiku'  },
  // Mid-tier (measured 81% / 70% on the midtier bench)
  { id: 'openai/gpt-4.1',                      in_per_m: 2.00,  out_per_m: 8.00,  tier: 'sonnet' },
  { id: 'meta-llama/llama-3.3-70b-instruct',   in_per_m: 0.13,  out_per_m: 0.40,  tier: 'sonnet' },
  // Mid-tier control: the Anthropic default
  { id: 'anthropic/claude-sonnet-4-6',         in_per_m: 3.00,  out_per_m: 15.00, tier: 'sonnet' },
  // Strong-tier: the Anthropic default (no measured alt yet)
  { id: 'anthropic/claude-opus-4',             in_per_m: 15.00, out_per_m: 75.00, tier: 'opus'   },
];

const DEFAULT_JUDGE = 'anthropic/claude-sonnet-4-6';

// ============================================================================
// CLI args
// ============================================================================

function parseArgs(argv) {
  const a = {
    live: false, models: null, judge: DEFAULT_JUDGE, maxCost: 5.00,
    maxRows: null, maxTokens: 512, save: true, writeRows: true,
  };
  for (let i = 2; i < argv.length; i++) {
    const k = argv[i];
    if (k === '--live') a.live = true;
    else if (k === '--models') a.models = argv[++i].split(',').map(s => s.trim()).filter(Boolean);
    else if (k === '--judge') a.judge = argv[++i];
    else if (k === '--max-cost') a.maxCost = parseFloat(argv[++i]);
    else if (k === '--max-rows') a.maxRows = parseInt(argv[++i], 10);
    else if (k === '--max-tokens') a.maxTokens = parseInt(argv[++i], 10);
    else if (k === '--no-save') a.save = false;
    else if (k === '--no-write-rows') a.writeRows = false;
    else if (k === '--help' || k === '-h') {
      console.log('Usage: node scripts/benchmark-seed-corpus.mjs [--live] [--models a,b,c] [--judge id] [--max-cost USD] [--max-rows N] [--max-tokens N] [--no-save] [--no-write-rows]');
      process.exit(0);
    }
  }
  return a;
}
const ARGS = parseArgs(process.argv);

const CANDIDATES = ARGS.models
  ? DEFAULT_CANDIDATES.filter(m => ARGS.models.includes(m.id)).concat(
      ARGS.models.filter(id => !DEFAULT_CANDIDATES.find(m => m.id === id))
        .map(id => ({ id, in_per_m: 0, out_per_m: 0, tier: 'unknown' }))
    )
  : DEFAULT_CANDIDATES;

// ============================================================================
// Load corpus + provenance
// ============================================================================

if (!existsSync(SEED_PATH)) {
  console.error(`[bench] seed corpus not found at ${SEED_PATH}`);
  process.exit(2);
}
const allRows = JSON.parse(readFileSync(SEED_PATH, 'utf8'));
const provenance = existsSync(PROVENANCE_PATH) ? JSON.parse(readFileSync(PROVENANCE_PATH, 'utf8')) : null;

// ADR-149 v2 — read task+tier directly from each row when present
// (gen-seed-corpus-v2.mjs persists them in the row). Fall back to the v1
// template-regeneration path when the corpus pre-dates v2.
const v2Rows = allRows.every(r => typeof r.task === 'string' && typeof r.tier === 'string');

let enrichedRows;
if (v2Rows) {
  enrichedRows = allRows.map((row, idx) => ({
    embedding: row.embedding,
    scores_prev: row.scores,
    task: row.task,
    tier: row.tier,
    _idx: idx,
  }));
  console.log(`[bench] v2 corpus detected — using row.task + row.tier directly (${allRows.length} rows).`);
} else {
  // v1 fallback — deterministic template regeneration.
  const CHEAP_TEMPLATES = [
    'rename {x} to {y}',
    'add a console.log to {x}',
    'fix typo in {x}',
    'remove unused import {x}',
    'add return type annotation to {x}',
    'format {x} as kebab-case',
    'increment counter in {x}',
    'add try/catch around {x}',
    'change var to const in {x}',
    'delete unused export {x}',
  ];
  const MID_TEMPLATES = [
    'implement a debounce helper for {x}',
    'add unit tests for {x}',
    'extract a hook from {x}',
    'refactor {x} to use async/await',
    'add input validation to {x}',
    'migrate {x} from callbacks to promises',
    'add a logging layer to {x}',
    'parameterize {x} with options object',
    'add a config schema for {x}',
    'write integration tests covering {x}',
  ];
  const STRONG_TEMPLATES = [
    'design a distributed consensus protocol with byzantine fault tolerance for {x}',
    'audit the {x} authentication flow for OWASP top-10 vulnerabilities',
    'architect a multi-tenant database schema with row-level security for {x}',
    'analyze why {x} has a memory leak under load — produce hypothesis with evidence',
    'refactor {x} to the strategy pattern and migrate all callers safely',
    'write a threat model for {x} including STRIDE categorization and mitigations',
    'compare CRDT-based and OT-based collaborative editing for {x} with citations',
    'design a backwards-compatible API deprecation path for {x}',
    'plan a zero-downtime migration of {x} from postgres to a sharded backend',
    'reason about consistency guarantees of {x} under partition and recovery',
    'debug a nondeterministic race condition in {x} across distributed workers',
    'design an event-sourced architecture for {x} with snapshots and replay',
  ];
  const NOUNS = ['cache','session','token','user','order','queue','router','schema','span','tenant','worker','feature-flag','rate-limiter','health-check','rpc-client','migration','dashboard','webhook','indexer','pipeline'];

  let _rngSeed = 1234567;
  const rng = () => { _rngSeed = (_rngSeed * 16807) % 2147483647; return _rngSeed / 2147483647; };

  const reconstructed = [];
  for (const [template, tier] of [
    ...CHEAP_TEMPLATES.map(t => [t, 'cheap']),
    ...MID_TEMPLATES.map(t => [t, 'mid']),
    ...STRONG_TEMPLATES.map(t => [t, 'strong']),
  ]) {
    for (let i = 0; i < 2; i++) {
      const x = NOUNS[Math.floor(rng() * NOUNS.length)];
      const y = NOUNS[Math.floor(rng() * NOUNS.length)];
      const task = template.replaceAll('{x}', x).replaceAll('{y}', y);
      reconstructed.push({ task, tier, template });
    }
  }
  if (reconstructed.length !== allRows.length) {
    console.error(`[bench] row count mismatch: corpus=${allRows.length}, reconstructed=${reconstructed.length}. Regenerate via scripts/gen-seed-corpus-v2.mjs (preferred) or scripts/gen-seed-corpus.mjs.`);
    process.exit(3);
  }
  enrichedRows = allRows.map((row, idx) => ({
    embedding: row.embedding,
    scores_prev: row.scores,
    task: reconstructed[idx].task,
    tier: reconstructed[idx].tier,
    template: reconstructed[idx].template,
    _idx: idx,
  }));
  console.log(`[bench] v1 corpus detected — regenerating task text from templates (${allRows.length} rows).`);
}

const ROWS = ARGS.maxRows ? enrichedRows.slice(0, ARGS.maxRows) : enrichedRows;

// ============================================================================
// Tier-aware rubrics — different criteria per tier
// ============================================================================

const RUBRICS = {
  cheap: [
    { name: 'correct_transform',  weight: 0.50, desc: 'The response performs the requested transformation correctly (e.g. var→const, rename X to Y, add console.log, etc.)' },
    { name: 'no_extraneous_prose', weight: 0.25, desc: 'Returns the corrected code/answer without surrounding explanation, markdown, or hedge prose' },
    { name: 'preserves_behavior', weight: 0.25, desc: 'Did not break or omit other parts of the original code/intent' },
  ],
  mid: [
    { name: 'solves_task',         weight: 0.40, desc: 'Actually addresses the requested mid-tier work (implements helper, refactors as asked, etc.) with reasonable depth' },
    { name: 'idiomatic',           weight: 0.20, desc: 'Code is idiomatic and follows current best practices for the language' },
    { name: 'completeness',        weight: 0.20, desc: 'Coverage is complete — does not stub out major parts or punt on the harder half' },
    { name: 'clarity',             weight: 0.10, desc: 'Reasoning / structure is clear; would be readable in a real codebase' },
    { name: 'no_extraneous_prose', weight: 0.10, desc: 'Stays close to the requested output format' },
  ],
  strong: [
    { name: 'technical_depth',     weight: 0.30, desc: 'Demonstrates real technical depth — not handwaving — on the topic (distributed systems, security, architecture, debugging)' },
    { name: 'tradeoffs',           weight: 0.25, desc: 'Surfaces trade-offs, alternatives, and gotchas appropriate to a senior engineer' },
    { name: 'actionable',          weight: 0.20, desc: 'The output is actionable — has steps, code, or a concrete plan, not just abstract advice' },
    { name: 'completeness',        weight: 0.15, desc: 'Covers the requested scope without major omissions' },
    { name: 'no_extraneous_prose', weight: 0.10, desc: 'Stays close to the requested output format and length' },
  ],
};

// ============================================================================
// Cost projection
// ============================================================================

// Per-tier avg lengths (approximate; cheap is short, strong is long).
const TIER_TOK = {
  cheap:  { in: 40,  out: 80  },
  mid:    { in: 100, out: 250 },
  strong: { in: 200, out: 450 },
};
const JUDGE_TOK = { in: 600, out: 200 };

function projectedCost() {
  let total = 0;
  for (const row of ROWS) {
    const tok = TIER_TOK[row.tier];
    for (const c of CANDIDATES) {
      total += (tok.in * c.in_per_m + tok.out * c.out_per_m) / 1_000_000;
    }
  }
  // Judge cost (Sonnet 4.6 listed price: $3 in / $15 out per Mtok)
  total += (JUDGE_TOK.in * 3.0 + JUDGE_TOK.out * 15.0) / 1_000_000 * ROWS.length * CANDIDATES.length;
  return total;
}

// ============================================================================
// OpenRouter chat-completion call
// ============================================================================

async function callOR(modelId, prompt, apiKey, opts = {}) {
  const t0 = performance.now();
  const res = await fetch('https://openrouter.ai/api/v1/chat/completions', {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
      'HTTP-Referer': 'https://github.com/ruvnet/ruflo',
      'X-Title': 'ruflo-benchmark-seed-corpus',
    },
    body: JSON.stringify({
      model: modelId,
      messages: [{ role: 'user', content: prompt }],
      max_tokens: opts.maxTokens ?? ARGS.maxTokens,
      temperature: opts.temperature ?? 0.0,
    }),
  });
  const dt = performance.now() - t0;
  const text = await res.text();
  let body; try { body = JSON.parse(text); } catch { body = { _raw: text }; }
  if (!res.ok) return { ok: false, status: res.status, error: body?.error?.message ?? text.slice(0, 200), latencyMs: dt };
  return {
    ok: true,
    content: body?.choices?.[0]?.message?.content ?? '',
    latencyMs: dt,
    promptTokens: body?.usage?.prompt_tokens ?? 0,
    completionTokens: body?.usage?.completion_tokens ?? 0,
  };
}

// ============================================================================
// Judge
// ============================================================================

function buildJudgePrompt(row, response) {
  const rubric = RUBRICS[row.tier];
  const rubricList = rubric.map(r => `  - ${r.name} (weight ${r.weight}): ${r.desc}`).join('\n');
  return `You are grading an AI model's response to a coding task. Score each rubric criterion as 0.0 (fails), 0.5 (partial), or 1.0 (meets). Return ONLY a JSON object: {"scores":{"<criterion>":<0|0.5|1>},"comment":"<≤80 char>"}. No prose outside the JSON.

USER PROMPT (tier=${row.tier}):
${row.task}

MODEL'S RESPONSE:
${response}

RUBRIC:
${rubricList}

Be strict — only award 1.0 if the criterion is unambiguously met.`;
}

function aggregateScore(row, judgeJson) {
  if (!judgeJson || typeof judgeJson !== 'object') return 0;
  const scores = judgeJson.scores ?? {};
  const rubric = RUBRICS[row.tier];
  let total = 0;
  for (const crit of rubric) {
    const v = typeof scores[crit.name] === 'number' ? Math.max(0, Math.min(1, scores[crit.name])) : 0;
    total += v * crit.weight;
  }
  return total;
}

async function judge(row, response, apiKey) {
  const r = await callOR(ARGS.judge, buildJudgePrompt(row, response), apiKey, { maxTokens: 256, temperature: 0.0 });
  if (!r.ok) return { score: 0, usdCost: 0, error: r.error };
  const match = r.content.match(/\{[\s\S]*\}/);
  let parsed = null;
  if (match) { try { parsed = JSON.parse(match[0]); } catch { /* fall through */ } }
  const score = aggregateScore(row, parsed);
  const usdCost = (r.promptTokens * 3.0 + r.completionTokens * 15.0) / 1_000_000;
  return { score, usdCost, comment: parsed?.comment ?? '', raw: parsed };
}

// ============================================================================
// Main
// ============================================================================

async function main() {
  const apiKey = process.env.OPENROUTER_API_KEY;

  console.log('# Seed-corpus DRACO measurement (ADR-149)\n');
  console.log(`- ts: ${new Date().toISOString().slice(0, 19)}Z`);
  console.log(`- corpus: ${ROWS.length} rows (${allRows.length} total${ARGS.maxRows ? `, capped to --max-rows=${ARGS.maxRows}` : ''})`);
  console.log(`- candidates: ${CANDIDATES.length} (${CANDIDATES.map(c => c.id).join(', ')})`);
  console.log(`- judge: ${ARGS.judge}`);
  console.log(`- max-tokens per response: ${ARGS.maxTokens}`);
  const projected = projectedCost();
  console.log(`- projected total cost (incl. judge): ~$${projected.toFixed(4)} USD`);
  console.log(`- max-cost gate: $${ARGS.maxCost.toFixed(2)}`);
  console.log(`- live mode: ${ARGS.live ? '**YES — real API calls + WILL overwrite seed-rows.json**' : 'no (dry run)'}\n`);

  if (!ARGS.live) {
    console.log('Dry run — no API calls and no file writes. To run live:');
    console.log(`  OPENROUTER_API_KEY=sk-or-... node scripts/benchmark-seed-corpus.mjs --live\n`);
    console.log('===BENCH_JSON===');
    console.log(JSON.stringify({ dryRun: true, projectedCostUSD: projected, candidates: CANDIDATES.map(c => c.id), judge: ARGS.judge, corpusSize: ROWS.length }, null, 2));
    return;
  }

  if (!apiKey) { console.error('[bench] --live requires OPENROUTER_API_KEY in env.'); process.exit(2); }
  if (projected > ARGS.maxCost) {
    console.error(`[bench] projected $${projected.toFixed(4)} > --max-cost $${ARGS.maxCost.toFixed(2)}; refusing. Override with --max-cost.`);
    process.exit(3);
  }

  // For each row, fan out across candidates, then judge each response.
  // Sequential per row (to avoid free-tier rate-limit blasts), parallel
  // across candidates within a row.
  const measured = [];
  let totalModelCost = 0;
  let totalJudgeCost = 0;
  for (let ri = 0; ri < ROWS.length; ri++) {
    const row = ROWS[ri];
    const candidateResults = await Promise.all(CANDIDATES.map(async (c) => {
      try {
        const resp = await callOR(c.id, row.task, apiKey);
        if (!resp.ok) return { id: c.id, score: 0, error: resp.error, status: resp.status, usdCost: 0 };
        const cCost = (resp.promptTokens * c.in_per_m + resp.completionTokens * c.out_per_m) / 1_000_000;
        const j = await judge(row, resp.content, apiKey);
        return {
          id: c.id, score: j.score, usdCost: cCost, judgeUsdCost: j.usdCost,
          latencyMs: resp.latencyMs, comment: j.comment,
          promptTokens: resp.promptTokens, completionTokens: resp.completionTokens,
        };
      } catch (e) {
        return { id: c.id, score: 0, error: e instanceof Error ? e.message : String(e), usdCost: 0 };
      }
    }));
    const scores = {};
    for (const cr of candidateResults) {
      scores[cr.id] = cr.score;
      totalModelCost += cr.usdCost ?? 0;
      totalJudgeCost += cr.judgeUsdCost ?? 0;
    }
    measured.push({ idx: row._idx, tier: row.tier, task: row.task, scores, details: candidateResults });
    if ((ri + 1) % 5 === 0 || ri === ROWS.length - 1) {
      console.log(`  [${ri + 1}/${ROWS.length}] tier=${row.tier} \`${row.task.slice(0, 60)}…\`  spend so far: model=$${totalModelCost.toFixed(4)} judge=$${totalJudgeCost.toFixed(4)}`);
    }
  }

  console.log(`\nTotal model spend: $${totalModelCost.toFixed(5)}`);
  console.log(`Total judge spend: $${totalJudgeCost.toFixed(5)}`);
  console.log(`Total spend:       $${(totalModelCost + totalJudgeCost).toFixed(5)}`);

  // Per-candidate aggregate
  const perCandidate = {};
  for (const c of CANDIDATES) {
    perCandidate[c.id] = { tier: c.tier, scoresByTier: { cheap: [], mid: [], strong: [] }, latencies: [], usdCost: 0, errors: 0 };
  }
  for (const m of measured) {
    for (const cr of m.details) {
      const e = perCandidate[cr.id];
      if (!e) continue;
      if (cr.error) e.errors++;
      e.scoresByTier[m.tier].push(cr.score ?? 0);
      if (typeof cr.latencyMs === 'number') e.latencies.push(cr.latencyMs);
      e.usdCost += cr.usdCost ?? 0;
    }
  }
  const aggRows = CANDIDATES.map(c => {
    const e = perCandidate[c.id];
    const mean = (arr) => arr.length ? arr.reduce((s, x) => s + x, 0) / arr.length : null;
    const meanLat = mean(e.latencies);
    return {
      id: c.id, tier: c.tier,
      cheap_avg_score:  mean(e.scoresByTier.cheap),
      mid_avg_score:    mean(e.scoresByTier.mid),
      strong_avg_score: mean(e.scoresByTier.strong),
      overall_avg_score: mean([...e.scoresByTier.cheap, ...e.scoresByTier.mid, ...e.scoresByTier.strong]),
      latency_mean_ms: meanLat,
      usd_cost_total: e.usdCost,
      cost_per_m_tok_in:  c.in_per_m,
      cost_per_m_tok_out: c.out_per_m,
      errors: e.errors,
    };
  });

  console.log(`\n| Model | Tier | Cheap | Mid | Strong | Overall | Latency | Errors |`);
  console.log(`|---|---|---|---|---|---|---|---|`);
  for (const r of aggRows.sort((a, b) => (b.overall_avg_score ?? 0) - (a.overall_avg_score ?? 0))) {
    const fmt = (v) => v == null ? '—' : (v * 100).toFixed(1) + '%';
    console.log(`| \`${r.id}\` | ${r.tier} | ${fmt(r.cheap_avg_score)} | ${fmt(r.mid_avg_score)} | ${fmt(r.strong_avg_score)} | **${fmt(r.overall_avg_score)}** | ${r.latency_mean_ms ? r.latency_mean_ms.toFixed(0) + ' ms' : '—'} | ${r.errors} |`);
  }
  console.log();

  // Save artifacts
  if (ARGS.save) {
    const ts = new Date().toISOString().slice(0, 19).replace(/[:T]/g, '-') + 'Z';
    const outDir = resolvePath(REPO_ROOT, 'docs', 'benchmarks', 'runs');
    mkdirSync(outDir, { recursive: true });
    const measuredPath = resolvePath(outDir, `seed-corpus-${ts}.json`);
    writeFileSync(measuredPath, JSON.stringify({
      meta: { ts: new Date().toISOString(), candidates: CANDIDATES, judge: ARGS.judge, corpusSize: ROWS.length, args: ARGS },
      perCandidate: aggRows,
      rows: measured,
    }, null, 2));
    console.log(`Saved measurement: ${measuredPath}`);
  }

  if (ARGS.writeRows) {
    // Overwrite seed-rows.json with measured scores per model id.
    // ADR-149 v2 — preserve ALL original row keys (notably `task` + `tier`,
    // which gen-seed-corpus-v2.mjs writes per row). The prior stripping
    // implementation dropped these fields and broke the v2-detection logic
    // in this script's reader on the next run, silently falling back to v1
    // template regeneration with a 64-row template count vs the actual 40
    // rows in the corpus.
    const updated = allRows.map((row, idx) => {
      const m = measured.find(x => x.idx === idx);
      if (!m) return row;
      return { ...row, scores: m.scores };
    });
    writeFileSync(SEED_PATH, JSON.stringify(updated, null, 0));
    console.log(`Wrote measured seed-rows.json (${updated.length} rows)`);
    // Update provenance to reflect the measurement run
    if (provenance) {
      provenance.measured_at = new Date().toISOString();
      provenance.measured_against = CANDIDATES.map(c => c.id);
      provenance.judge = ARGS.judge;
      provenance.measurement_run = `seed-corpus-${new Date().toISOString().slice(0,19).replace(/[:T]/g,'-')}Z.json`;
      provenance.caveat = 'Seed corpus is now measured (ADR-149). Re-measure quarterly via `scripts/benchmark-seed-corpus.mjs --live`. To regenerate the embeddings (not the scores), use `scripts/gen-seed-corpus.mjs`.';
      writeFileSync(PROVENANCE_PATH, JSON.stringify(provenance, null, 2));
      console.log('Updated provenance.');
    }
  }

  console.log('\n===BENCH_JSON===');
  console.log(JSON.stringify({ perCandidate: aggRows, totalModelUSD: totalModelCost, totalJudgeUSD: totalJudgeCost }, null, 2));
}

main().catch(e => { console.error('[bench] fatal:', e); process.exit(1); });
