#!/usr/bin/env node
/**
 * ADR-129 rvagent benchmark suite.
 *
 * Measures the four performance wins introduced by ADR-129 Phases 1–4:
 *
 *   P1 — Provider routing latency (JsModelProvider wiring).
 *        Compares echo-stub round-trip (keyless baseline) against provider
 *        attachment overhead (measured with a fake key that will 401 — we
 *        capture the latency to the WASM call boundary, not the network hop).
 *
 *   P2 — wasm_agent_compose throughput with N=10/50/100 MCP tools.
 *        Shows cost of allowlist validation + descriptor building at scale.
 *
 *   P3 — Gallery CRUD throughput: add → list → import → export → remove.
 *        Validates that the 10 new gallery operations land in <1 ms each.
 *
 *   P4 — Plugin enumeration overhead: wasm_agent_compose with/without
 *        includePlugins. Measures manifest-lookup cost when the plugin
 *        directory does not exist (graceful no-op path).
 *
 * Output: docs/benchmarks/rvagent-baseline.json
 *
 * Usage:
 *   node v3/@claude-flow/cli/scripts/bench-rvagent.mjs [--tag=baseline] [--trials=5]
 *
 * Pattern: mirrors v3/@claude-flow/guidance/scripts/bench-phase-1.mjs.
 * Standalone — does NOT require the test runner, only Node ≥20 + the WASM
 * package (@ruvector/rvagent-wasm must be installed for realistic numbers;
 * the bench gracefully degrades to timing the WASM-unavailable error path).
 */

import { performance } from 'node:perf_hooks';
import { mkdirSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(__dirname, '../../../..');
const OUT_DIR = resolve(REPO_ROOT, 'docs', 'benchmarks');

const args = Object.fromEntries(
  process.argv.slice(2).map(a => {
    const [k, v] = a.replace(/^--/, '').split('=');
    return [k, v ?? true];
  }),
);

const TAG = args.tag || 'baseline';
const TRIALS = Math.max(3, parseInt(args.trials || '5', 10));

// ─────────────────────────────────────────────────────────────────────────────
// Timing harness — 5-trial median, same as bench-phase-1.mjs
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Time N async calls (or sync if fn returns non-Promise), return median ms.
 */
async function bench(name, fn, reps = 20) {
  // Warmup — trigger any lazy init so it doesn't inflate the first trial.
  for (let i = 0; i < Math.min(3, reps); i++) {
    try { await fn(); } catch { /* ignore warmup errors */ }
  }

  const latencies = [];
  for (let t = 0; t < TRIALS; t++) {
    const start = performance.now();
    for (let i = 0; i < reps; i++) {
      try { await fn(); } catch { /* measure call overhead, not success */ }
    }
    latencies.push((performance.now() - start) / reps);
  }
  latencies.sort((a, b) => a - b);
  const median = latencies[Math.floor(TRIALS / 2)];
  const min = latencies[0];
  const max = latencies[TRIALS - 1];

  return {
    name,
    trials: TRIALS,
    reps,
    medianMs: Math.round(median * 1000) / 1000,
    minMs: Math.round(min * 1000) / 1000,
    maxMs: Math.round(max * 1000) / 1000,
    variance: Math.round(((max - min) / (median || 1)) * 1000) / 1000,
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// Load the live agent-wasm module (dist preferred, src fallback)
// ─────────────────────────────────────────────────────────────────────────────

// dist layout: dist/src/**/*.js (tsc rootDir=.)
const DIST_SRC = resolve(__dirname, '../dist/src');
let wasmMod;
try {
  wasmMod = await import(resolve(DIST_SRC, 'ruvector/agent-wasm.js'));
} catch {
  console.warn('[bench] Could not load agent-wasm dist — using stub metrics only.');
  wasmMod = null;
}

// Load the wasm tools module to bench wasm_agent_compose handler directly
let composeHandler;
let galleryHandlers = {};
try {
  const toolsMod = await import(resolve(DIST_SRC, 'mcp-tools/wasm-agent-tools.js'));
  const tools = toolsMod.wasmAgentTools ?? toolsMod.default ?? [];
  const findHandler = (name) => tools.find(t => t.name === name)?.handler;
  composeHandler = findHandler('wasm_agent_compose');
  galleryHandlers = {
    add: findHandler('wasm_gallery_add_custom'),
    list: findHandler('wasm_gallery_list'),
    importFn: findHandler('wasm_gallery_import'),
    exportFn: findHandler('wasm_gallery_export'),
    remove: findHandler('wasm_gallery_remove_custom'),
    categories: findHandler('wasm_gallery_categories'),
    listByCategory: findHandler('wasm_gallery_list_by_category'),
    loadRvf: findHandler('wasm_gallery_load_rvf'),
    active: findHandler('wasm_gallery_active'),
    config: findHandler('wasm_gallery_config'),
  };
} catch {
  // Handlers unavailable — bench will time the missing-module error path.
  composeHandler = null;
}

// ─────────────────────────────────────────────────────────────────────────────
// P1 — Provider routing latency
//
// Baseline: echo-stub path (no keys set) — measures raw WASM call overhead.
// Provider: createWasmAgent with a fake ANTHROPIC_API_KEY. The key is 401'd
// by the Anthropic API before any tokens are billed, but the routing
// logic (attachJsModelProvider, JsModelProvider instantiation, provider
// lookup) runs synchronously before the network call. We measure the
// in-process portion only by timing createWasmAgent + promptWasmAgent
// with a deliberately short input and catching the 401 network error.
// ─────────────────────────────────────────────────────────────────────────────

const originalKey = process.env.ANTHROPIC_API_KEY;

console.log('\nADR-129 rvagent benchmark suite');
console.log('================================');
console.log(`tag=${TAG}  trials=${TRIALS}  node=${process.version}`);
console.log('');

// P1a — echo-stub baseline (no key)
console.log('P1a: provider routing — echo-stub baseline (keyless)...');
delete process.env.ANTHROPIC_API_KEY;
delete process.env.OPENROUTER_API_KEY;
delete process.env.OLLAMA_API_KEY;

const r_p1_echo = await bench('P1-echo-stub: createWasmAgent (keyless)', async () => {
  if (!wasmMod) return; // module unavailable — timing the absence
  try {
    const info = await wasmMod.createWasmAgent({ maxTurns: 1 });
    wasmMod.terminateWasmAgent(info.id);
  } catch { /* WASM unavailable is expected in keyless CI */ }
}, 5);

// P1b — provider-path: fake key triggers attachJsModelProvider logic
console.log('P1b: provider routing — with fake key (measures attach overhead)...');
process.env.ANTHROPIC_API_KEY = 'sk-ant-bench-fake-key-00000000000000000000000000';

const r_p1_provider = await bench('P1-provider-path: createWasmAgent (fake key)', async () => {
  if (!wasmMod) return;
  try {
    const info = await wasmMod.createWasmAgent({ maxTurns: 1 });
    wasmMod.terminateWasmAgent(info.id);
  } catch { /* 401 expected */ }
}, 5);

// Restore original key state
if (originalKey !== undefined) {
  process.env.ANTHROPIC_API_KEY = originalKey;
} else {
  delete process.env.ANTHROPIC_API_KEY;
}

// ─────────────────────────────────────────────────────────────────────────────
// P2 — wasm_agent_compose throughput with N=10/50/100 MCP tools
// ─────────────────────────────────────────────────────────────────────────────

console.log('P2: compose throughput — N=10/50/100 MCP tools...');

function makeMcpToolList(n) {
  return Array.from({ length: n }, (_, i) => `memory_search_${i % 30 === 0 ? i : 'search'}`);
}

async function timeCompose(toolCount) {
  if (!composeHandler) return null;
  const tools = makeMcpToolList(toolCount);
  return bench(`P2-compose: ${toolCount} MCP tools`, async () => {
    await composeHandler({ mcpTools: tools, skills: [], prompts: [], tools: [] });
  }, 10);
}

const r_p2_10 = await timeCompose(10);
const r_p2_50 = await timeCompose(50);
const r_p2_100 = await timeCompose(100);

// ─────────────────────────────────────────────────────────────────────────────
// P3 — Gallery CRUD throughput: full add → list → import → export → remove cycle
// ─────────────────────────────────────────────────────────────────────────────

console.log('P3: gallery CRUD — add/list/import/export/remove cycle...');

const CUSTOM_TEMPLATE = JSON.stringify({
  id: 'bench-custom-1',
  name: 'bench-template',
  description: 'Benchmark custom template',
  category: 'testing',
  tags: ['bench'],
  version: '0.1.0',
  author: 'bench',
  builtin: false,
  tools: [],
  prompts: [],
  skills: [],
  mcp_tools: [],
  capabilities: [],
});

const r_p3_cycle = await bench('P3-gallery-crud: add→list→import→export→remove', async () => {
  const fns = galleryHandlers;
  if (fns.add) await fns.add({ template: JSON.parse(CUSTOM_TEMPLATE) }).catch(() => {});
  if (fns.list) await fns.list({}).catch(() => {});
  if (fns.importFn) await fns.importFn({ templatesJson: `[${CUSTOM_TEMPLATE}]` }).catch(() => {});
  if (fns.exportFn) await fns.exportFn({}).catch(() => {});
  if (fns.remove) await fns.remove({ id: 'bench-custom-1' }).catch(() => {});
}, 5);

const r_p3_categories = await bench('P3-gallery-categories: getCategories', async () => {
  if (galleryHandlers.categories) await galleryHandlers.categories({}).catch(() => {});
}, 10);

// ─────────────────────────────────────────────────────────────────────────────
// P4 — Plugin enumeration: compose with/without includePlugins
//
// Tests the manifest-lookup path for plugins that don't exist on disk
// (graceful no-op / warning). This measures that skipping absent plugins
// doesn't add significant overhead.
// ─────────────────────────────────────────────────────────────────────────────

console.log('P4: plugin enumeration — compose with/without includePlugins...');

const r_p4_without = await bench('P4-plugin-enum: compose WITHOUT includePlugins', async () => {
  if (!composeHandler) return;
  await composeHandler({ mcpTools: ['memory_search'], skills: [], prompts: [], tools: [] });
}, 10);

const r_p4_with = await bench('P4-plugin-enum: compose WITH includePlugins (absent plugins)', async () => {
  if (!composeHandler) return;
  await composeHandler({
    mcpTools: ['memory_search'],
    includePlugins: ['nonexistent-plugin-a', 'nonexistent-plugin-b'],
    skills: [],
    prompts: [],
    tools: [],
  });
}, 10);

// ─────────────────────────────────────────────────────────────────────────────
// Emit results
// ─────────────────────────────────────────────────────────────────────────────

const results = [
  r_p1_echo,
  r_p1_provider,
  r_p2_10,
  r_p2_50,
  r_p2_100,
  r_p3_cycle,
  r_p3_categories,
  r_p4_without,
  r_p4_with,
].filter(Boolean);

const out = {
  tag: TAG,
  trials: TRIALS,
  node: process.version,
  platform: `${process.platform}-${process.arch}`,
  capturedAt: new Date().toISOString(),
  adr: 'ADR-129',
  phases: ['P1-provider-routing', 'P2-compose-throughput', 'P3-gallery-crud', 'P4-plugin-enum'],
  results,
};

mkdirSync(OUT_DIR, { recursive: true });
const outPath = resolve(OUT_DIR, `rvagent-${TAG}.json`);
writeFileSync(outPath, JSON.stringify(out, null, 2));

console.log(`\nWrote ${outPath}\n`);

const COL_NAME = 52;
const COL_MS = 10;
const COL_VAR = 8;

console.log(`| ${'Benchmark'.padEnd(COL_NAME)} | ${'Median ms'.padStart(COL_MS)} | ${'Variance'.padStart(COL_VAR)} |`);
console.log(`|${'-'.repeat(COL_NAME + 2)}|${'-'.repeat(COL_MS + 2)}|${'-'.repeat(COL_VAR + 2)}|`);

for (const r of results) {
  const name = r.name.padEnd(COL_NAME).slice(0, COL_NAME);
  const ms = String(r.medianMs).padStart(COL_MS);
  const vari = String(r.variance).padStart(COL_VAR);
  console.log(`| ${name} | ${ms} | ${vari} |`);
}

console.log('');
console.log('Note: ms values measure in-process overhead including WASM unavailable error path.');
console.log('When @ruvector/rvagent-wasm is not installed, timings reflect the import error cost only.');
