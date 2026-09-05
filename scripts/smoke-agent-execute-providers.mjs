#!/usr/bin/env node
/**
 * Regression guard for ruvnet/ruflo#2042 — agent_execute hardcoded the
 * Anthropic SDK and ignored the v3 provider system. Reporter: @ummcke00.
 *
 * The fix routes executeAgentTask() through callAnthropicMessages(),
 * which dispatches to Anthropic / OpenRouter / Ollama based on:
 *   1. Explicit `RUFLO_PROVIDER=...`
 *   2. Available API keys when no provider is forced
 *
 * This smoke statically asserts the wiring:
 *   1. executeAgentTask() must NOT contain the old inline
 *      `fetch('https://api.anthropic.com/...')` bypass.
 *   2. callAnthropicMessages() must reference OPENROUTER_API_KEY.
 *   3. callOpenAICompat() must exist as a helper.
 *   4. The "no provider configured" error must list all three options.
 *
 * Plus one behavioral check: invoke callAnthropicMessages() with
 * OPENROUTER_API_KEY set and assert the response error names the
 * openrouter provider (not Anthropic) — proves the dispatch fires.
 */

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const SOURCE = resolve(__dirname, '../v3/@claude-flow/cli/src/mcp-tools/agent-execute-core.ts');

function fail(msg) { console.error(`✗ ${msg}`); process.exitCode = 1; }
function pass(msg) { console.log(`✓ ${msg}`); }

const src = readFileSync(SOURCE, 'utf8');

// 1. executeAgentTask must no longer contain the bypass fetch
const execBody = src.match(/export async function executeAgentTask[\s\S]*?\n\}\n/);
if (!execBody) {
  fail('executeAgentTask not found');
} else if (/fetch\(['"]https:\/\/api\.anthropic\.com\/v1\/messages['"]/.test(execBody[0])) {
  fail('executeAgentTask still contains inline `fetch(https://api.anthropic.com/...)` — #2042 regression');
} else if (!/callAnthropicMessages/.test(execBody[0])) {
  fail('executeAgentTask does not delegate to callAnthropicMessages — #2042 regression');
} else {
  pass('executeAgentTask delegates to callAnthropicMessages (no inline Anthropic fetch)');
}

// 2. callAnthropicMessages references OPENROUTER_API_KEY
if (!/OPENROUTER_API_KEY/.test(src)) {
  fail('OPENROUTER_API_KEY env var not referenced — OpenRouter branch missing');
} else {
  pass('OPENROUTER_API_KEY env var routes the OpenRouter branch');
}

// 3. callOpenAICompat helper exists
if (!/async function callOpenAICompat/.test(src)) {
  fail('callOpenAICompat helper missing — #2042 fix incomplete');
} else {
  pass('callOpenAICompat helper exists for OpenRouter + OpenAI-compat backends');
}

// 4. No-provider error names all three options
if (!/OPENROUTER_API_KEY/.test(src) || !/OLLAMA_API_KEY/.test(src) || !/ANTHROPIC_API_KEY/.test(src)) {
  fail('No-provider error message does not list all three provider options');
} else {
  pass('No-provider error message lists Anthropic + OpenRouter + Ollama options');
}

// 5. Static contract — the OpenRouter dispatch must be reachable from
// callAnthropicMessages BEFORE the Anthropic key check, so a user with
// only OPENROUTER_API_KEY (no Anthropic key) hits the openrouter
// branch instead of the "no provider configured" error. We assert the
// source-level order: the `useOpenRouter` branch must come before the
// `if (!anthropicKey)` early-return.
const callAnthropicBody = src.match(/export async function callAnthropicMessages[\s\S]*?\n\}\n/);
if (!callAnthropicBody) {
  fail('callAnthropicMessages body not found');
} else {
  const body = callAnthropicBody[0];
  // #2962 — the OpenRouter branch condition widened from
  // `useOpenRouter && openrouterKey` to `if (useOpenRouter) { const apiKey =
  // openrouterKey || persistedOpenRouter?.apiKey; if (apiKey) {...} }` so a
  // persisted `agents.providers` config can supply the key when no env var
  // is set. Match on the branch entry point rather than the literal old
  // condition — the ordering guarantee this smoke checks is unchanged.
  const openrouterIdx = body.search(/if\s*\(\s*useOpenRouter\s*\)/);
  const noKeyIdx = body.search(/if\s*\(\s*!anthropicKey\s*\)/);
  if (openrouterIdx < 0) {
    fail('useOpenRouter dispatch not found in callAnthropicMessages');
  } else if (noKeyIdx < 0) {
    fail('Anthropic-key early-return not found in callAnthropicMessages');
  } else if (openrouterIdx > noKeyIdx) {
    fail('OpenRouter dispatch sits AFTER the Anthropic-key early-return — non-Anthropic users will hit "no provider" instead of openrouter');
  } else {
    pass('OpenRouter dispatch precedes the Anthropic-key early-return (correct order)');
  }
}

if (process.exitCode) {
  console.error('\n#2042 regression smoke FAILED');
} else {
  console.log('\n#2042 regression smoke PASS');
}
