#!/usr/bin/env node
/**
 * Regression guard for ADR-129 Phase 1 — JsModelProvider integration.
 *
 * Pre-P1: promptWasmAgent detected the echo stub and routed through
 * callAnthropicMessages as a bypass.  set_model_provider() and
 * new JsModelProvider() were never called; the WASM agent's internal
 * conversation loop never ran against a real LLM.
 *
 * P1 fix: attachJsModelProvider() is called at agent-creation time in
 * createWasmAgent().  The JsModelProvider callback bridges the WASM
 * runtime to callAnthropicMessages, which dispatches Anthropic /
 * OpenRouter / Ollama by env-var / key-presence (same routing as
 * agent_execute, #2042).  The echo-stub detection block is preserved
 * as a fallback for keyless environments.
 *
 * Static contracts (no build required):
 *   1. agent-wasm.ts MUST contain `new JsModelProvider(`
 *   2. agent-wasm.ts MUST contain `set_model_provider(`
 *   3. agent-wasm.ts MUST contain `callAnthropicMessages`
 *   4. The echo-stub bypass is still present as a fallback
 *      (for keyless CI environments).
 *   5. attachJsModelProvider is called from createWasmAgent.
 */

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const SOURCE = resolve(__dirname, '../v3/@claude-flow/cli/src/ruvector/agent-wasm.ts');

function fail(msg) { console.error(`✗ ${msg}`); process.exitCode = 1; }
function pass(msg) { console.log(`✓ ${msg}`); }

const src = readFileSync(SOURCE, 'utf8');

// 1. JsModelProvider constructor is called
if (!/new mod\.JsModelProvider\(/.test(src)) {
  fail('new JsModelProvider( not found — ADR-129 P1 provider bridge missing');
} else {
  pass('new JsModelProvider( found — WASM provider bridge wired');
}

// 2. set_model_provider is called
if (!/agent\.set_model_provider\(/.test(src)) {
  fail('agent.set_model_provider( not found — provider not attached to agent');
} else {
  pass('agent.set_model_provider( found — provider attached at creation time');
}

// 3. callAnthropicMessages is referenced
if (!/callAnthropicMessages/.test(src)) {
  fail('callAnthropicMessages not referenced — v3 provider router not bridged');
} else {
  pass('callAnthropicMessages referenced — routes through v3 provider system');
}

// 4. Echo-stub fallback preserved (keyless CI environments)
if (!/echo: /.test(src)) {
  fail('Echo-stub detection removed — keyless fallback broken');
} else {
  pass('Echo-stub detection preserved — keyless fallback intact');
}

// 5. attachJsModelProvider is called from createWasmAgent
const createFn = src.match(/export async function createWasmAgent[\s\S]*?\n\}\n/);
if (!createFn) {
  fail('createWasmAgent not found');
} else if (!/attachJsModelProvider/.test(createFn[0])) {
  fail('attachJsModelProvider not called from createWasmAgent — provider not wired at creation time');
} else {
  pass('attachJsModelProvider called from createWasmAgent — provider wired at creation time');
}

// 6. resolveAnthropicModel is imported/used in the provider callback
if (!/resolveAnthropicModel/.test(src)) {
  fail('resolveAnthropicModel not used — model resolution missing from provider callback');
} else {
  pass('resolveAnthropicModel used — model resolution present in provider callback');
}

if (process.exitCode) {
  console.error('\nADR-129 P1 provider bridge smoke FAILED');
} else {
  console.log('\nADR-129 P1 provider bridge smoke PASS');
}
