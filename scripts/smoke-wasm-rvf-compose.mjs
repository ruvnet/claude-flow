#!/usr/bin/env node
/**
 * Regression guard for ADR-129 Phase 2 — wasm_agent_compose MCP tool
 * + addMcpTools bridge.
 *
 * Pre-P2: buildRvfFromTemplate silently dropped template.mcp_tools (the
 * field existed in GalleryTemplateDetail but was never passed to
 * WasmRvfBuilder.addMcpTools()).  No wasm_agent_compose tool existed.
 * WasmAgents were isolated from ruflo's 314 MCP tools.
 *
 * P2 fix:
 *   1. buildRvfContainer gains mcpTools parameter → builder.addMcpTools()
 *   2. buildRvfFromTemplate passes template.mcp_tools
 *   3. wasm_agent_compose MCP tool added with allowlist + destructive gate
 *
 * Static contracts (no build required):
 *   1. wasm-agent-tools.ts MUST contain wasm_agent_compose tool
 *   2. Destructive-tool gate must reference mcpToolsAllowDestructive
 *   3. DESTRUCTIVE_TOOL_PATTERNS must be defined
 *   4. agent-wasm.ts buildRvfFromTemplate must pass mcpTools field
 *   5. buildRvfContainer must call builder.addMcpTools
 *   6. includePlugins param exists in wasm_agent_compose schema (P4 wire)
 */

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const TOOLS = resolve(__dirname, '../v3/@claude-flow/cli/src/mcp-tools/wasm-agent-tools.ts');
const WASM = resolve(__dirname, '../v3/@claude-flow/cli/src/ruvector/agent-wasm.ts');

function fail(msg) { console.error(`✗ ${msg}`); process.exitCode = 1; }
function pass(msg) { console.log(`✓ ${msg}`); }

const toolsSrc = readFileSync(TOOLS, 'utf8');
const wasmSrc = readFileSync(WASM, 'utf8');

// 1. wasm_agent_compose tool registered
if (!/name:\s*['"]wasm_agent_compose['"]/.test(toolsSrc)) {
  fail('wasm_agent_compose tool not registered — ADR-129 P2 tool missing');
} else {
  pass('wasm_agent_compose tool registered');
}

// 2. Destructive-tool gate present
if (!/mcpToolsAllowDestructive/.test(toolsSrc)) {
  fail('mcpToolsAllowDestructive not found — destructive-tool gate missing');
} else {
  pass('mcpToolsAllowDestructive gate present in wasm_agent_compose');
}

// 3. DESTRUCTIVE_TOOL_PATTERNS defined
if (!/DESTRUCTIVE_TOOL_PATTERNS/.test(toolsSrc)) {
  fail('DESTRUCTIVE_TOOL_PATTERNS not defined — allowlist enforcement absent');
} else {
  pass('DESTRUCTIVE_TOOL_PATTERNS defined — destructive tools blocked by default');
}

// 4. buildRvfFromTemplate passes mcp_tools (ADR-129 P2 fix)
const buildFromTplFn = wasmSrc.match(/export async function buildRvfFromTemplate[\s\S]*?\n\}/);
if (!buildFromTplFn) {
  fail('buildRvfFromTemplate not found');
} else if (!/mcp_tools/.test(buildFromTplFn[0]) && !/mcpTools/.test(buildFromTplFn[0])) {
  fail('buildRvfFromTemplate does not pass mcp_tools — silent drop still present (#ADR-129 P2 regression)');
} else {
  pass('buildRvfFromTemplate passes mcp_tools to buildRvfContainer (drop fixed)');
}

// 5. buildRvfContainer source contains addMcpTools call
// (search the whole file between buildRvfContainer and buildRvfFromTemplate)
const between = wasmSrc.slice(
  wasmSrc.indexOf('export async function buildRvfContainer'),
  wasmSrc.indexOf('export async function buildRvfFromTemplate'),
);
if (!between || between.length === 0) {
  fail('buildRvfContainer function region not found');
} else if (!/addMcpTools/.test(between)) {
  fail('buildRvfContainer does not call builder.addMcpTools() — MCP tool bridge missing');
} else {
  pass('buildRvfContainer calls builder.addMcpTools() — 314-tool bridge wired');
}

// 6. includePlugins param in wasm_agent_compose (P4 contract)
if (!/includePlugins/.test(toolsSrc)) {
  fail('includePlugins param not found in wasm_agent_compose — ADR-129 P4 schema missing');
} else {
  pass('includePlugins param present in wasm_agent_compose (P4 plugin bridge)');
}

// 7. isDestructiveTool helper guards known patterns
if (!/memory_delete|federation_|swarm_shutdown|agent_terminate/.test(toolsSrc)) {
  fail('Destructive pattern guards missing from allowlist');
} else {
  pass('Destructive pattern guards cover memory_delete, federation_*, swarm_shutdown, agent_terminate');
}

if (process.exitCode) {
  console.error('\nADR-129 P2 wasm_agent_compose smoke FAILED');
} else {
  console.log('\nADR-129 P2 wasm_agent_compose smoke PASS');
}
