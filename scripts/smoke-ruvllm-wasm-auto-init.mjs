#!/usr/bin/env node
/**
 * Regression guard for #2086 — ruvllm WASM auto-init via MCP tools.
 *
 * Reported by @seo-yas: every `ruvllm_*` MCP tool that touches the WASM
 * runtime requires `initRuvllmWasm()` to have run first, but no MCP tool
 * exposed that bootstrap call and `loadRuvllmWasm()` didn't trigger it.
 * Result: `ruvllm_status` reported `wasm.initialized=false` even after
 * calling `ruvllm_sona_create` / `ruvllm_microlora_create` / `ruvllm_hnsw_create`.
 *
 * Fix: `loadRuvllmWasm()` now calls `mod.initRuvllmWasm()` after import.
 * `ruvllm_status` deliberately keeps using the un-init loader so it can
 * report a non-initialized state for diagnostics.
 *
 * This smoke verifies:
 *   1. The `loadRuvllmWasm` helper exists AND calls `initRuvllmWasm`
 *      (regression catch — easy to delete the await in a refactor).
 *   2. The `ruvllm_status` handler does NOT call `initRuvllmWasm`
 *      (it must remain a pure diagnostic).
 *   3. The set of WASM-touching tools is exactly the expected list —
 *      adding a new ruvllm_* tool that talks to WASM without going
 *      through `loadRuvllmWasm()` is a regression of #2086.
 *
 * Run: `node scripts/smoke-ruvllm-wasm-auto-init.mjs`
 */

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const SOURCE = resolve(__dirname, '../v3/@claude-flow/cli/src/mcp-tools/ruvllm-tools.ts');

function fail(msg) {
  console.error(`✗ ${msg}`);
  process.exitCode = 1;
}
function pass(msg) {
  console.log(`✓ ${msg}`);
}

const src = readFileSync(SOURCE, 'utf8');

// Check 1: loadRuvllmWasm awaits mod.initRuvllmWasm()
const loaderBlock = src.match(/async function loadRuvllmWasm\(\)[\s\S]*?\n\}/);
if (!loaderBlock) {
  fail('loadRuvllmWasm() helper not found in ruvllm-tools.ts');
} else if (!/await\s+mod\.initRuvllmWasm\(\)/.test(loaderBlock[0])) {
  fail('loadRuvllmWasm() does NOT call `await mod.initRuvllmWasm()` — #2086 regression');
} else {
  pass('loadRuvllmWasm() invokes mod.initRuvllmWasm()');
}

// Check 2: loadRuvllmWasmModule helper exists (the un-init variant for status)
const moduleBlock = src.match(/async function loadRuvllmWasmModule\(\)[\s\S]*?\n\}/);
if (!moduleBlock) {
  fail('loadRuvllmWasmModule() helper missing — #2086 fix removed the diagnostic path');
} else if (/initRuvllmWasm/.test(moduleBlock[0])) {
  fail('loadRuvllmWasmModule() should NOT init — its purpose is to report uninitialized state');
} else {
  pass('loadRuvllmWasmModule() preserves un-initialized diagnostic path');
}

// Check 3: ruvllm_status handler uses the un-init loader
const statusHandler = src.match(/name:\s*'ruvllm_status'[\s\S]*?handler:\s*async[\s\S]*?\n\s{4,6}\},?\n/);
if (!statusHandler) {
  fail('Could not locate ruvllm_status handler in ruvllm-tools.ts');
} else if (/await\s+loadRuvllmWasm\(\)/.test(statusHandler[0])) {
  fail('ruvllm_status handler uses loadRuvllmWasm() — would auto-init, losing diagnostic value');
} else if (!/await\s+loadRuvllmWasmModule\(\)/.test(statusHandler[0])) {
  fail('ruvllm_status handler does not use loadRuvllmWasmModule()');
} else {
  pass('ruvllm_status handler uses loadRuvllmWasmModule() (no auto-init)');
}

// Check 4: every other WASM-touching tool routes through loadRuvllmWasm()
const wasmTouchingTools = [
  'ruvllm_hnsw_create',
  'ruvllm_hnsw_add',
  'ruvllm_hnsw_route',
  'ruvllm_sona_create',
  'ruvllm_sona_adapt',
  'ruvllm_microlora_create',
  'ruvllm_microlora_adapt',
  'ruvllm_chat_format',
];

for (const name of wasmTouchingTools) {
  const re = new RegExp(`name:\\s*'${name}'[\\s\\S]*?handler:\\s*async[\\s\\S]*?\\n\\s{4,6}\\},?\\n`);
  const block = src.match(re);
  if (!block) {
    fail(`Could not locate ${name} handler`);
    continue;
  }
  // Either it routes through loadRuvllmWasm (auto-init path) OR it uses
  // a previously created instance (sonaInstances / hnswRouters) where the
  // create handler already did the init.
  const usesAutoInit = /await\s+loadRuvllmWasm\(\)/.test(block[0]);
  const usesInstanceLookup = /(?:sonaInstances|hnswRouters|loraInstances)\.get/.test(block[0]);
  if (!usesAutoInit && !usesInstanceLookup) {
    fail(`${name} bypasses loadRuvllmWasm() AND has no instance lookup — #2086 regression`);
  } else {
    pass(`${name} ${usesAutoInit ? 'auto-inits via loadRuvllmWasm()' : 'uses prior instance from create handler'}`);
  }
}

// Check 5: ruvllm_generate_config is the only tool that legitimately
// doesn't touch the runtime (it just composes a config object). Verify
// we haven't added a new tool that bypasses loadRuvllmWasm by accident.
const allToolNames = [...src.matchAll(/name:\s*'(ruvllm_[a-z_]+)'/g)].map((m) => m[1]);
const expectedUnique = new Set([...wasmTouchingTools, 'ruvllm_status', 'ruvllm_generate_config']);
const unexpected = allToolNames.filter((n) => !expectedUnique.has(n));
if (unexpected.length > 0) {
  fail(
    `New ruvllm_* tools found that this smoke does not classify: ${unexpected.join(', ')}. ` +
      `If they touch WASM, ensure they call loadRuvllmWasm(); then add them to this smoke.`,
  );
} else {
  pass(`Tool surface = expected ${allToolNames.length} (${[...allToolNames].sort().join(', ')})`);
}

if (process.exitCode) {
  console.error('\n#2086 regression smoke FAILED');
} else {
  console.log('\n#2086 regression smoke PASS');
}
