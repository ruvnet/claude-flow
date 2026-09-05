#!/usr/bin/env node
/**
 * Regression guard for ADR-129 Phase 3 — 16 new MCP tools (10 gallery
 * CRUD + 6 agent introspection) with AIDefence gate on wasm_gallery_import.
 *
 * Pre-P3: only 3 of 13 WasmGallery methods were exposed as MCP tools.
 * Agent introspection (get_state, get_todos, reset) had no MCP surface.
 *
 * P3 adds:
 *   Gallery (10): load_rvf, configure, categories, list_by_category,
 *                 add_custom, remove_custom, import (AIDefence-gated),
 *                 export, active, config
 *   Introspect (6): state, todos, tools, turn_count, is_stopped, reset
 *
 * Static contracts (no build required):
 *   1. All 16 new tools registered in wasm-agent-tools.ts
 *   2. wasm_gallery_import has HIGH_RISK marker + AIDefence call
 *   3. wasm_agent_reset calls resetWasmAgent
 *   4. wasm_agent_todos exists
 *   5. wasm_agent_state exists
 *   6. agent-wasm.ts exports the 9 new gallery functions
 *   7. agent-wasm.ts exports resetWasmAgent
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

const NEW_GALLERY_TOOLS = [
  'wasm_gallery_load_rvf',
  'wasm_gallery_configure',
  'wasm_gallery_categories',
  'wasm_gallery_list_by_category',
  'wasm_gallery_add_custom',
  'wasm_gallery_remove_custom',
  'wasm_gallery_import',
  'wasm_gallery_export',
  'wasm_gallery_active',
  'wasm_gallery_config',
];

const NEW_INTROSPECT_TOOLS = [
  'wasm_agent_state',
  'wasm_agent_todos',
  'wasm_agent_tools',
  'wasm_agent_turn_count',
  'wasm_agent_is_stopped',
  'wasm_agent_reset',
];

// 1. All gallery tools registered
let allGalleryOk = true;
for (const t of NEW_GALLERY_TOOLS) {
  const re = new RegExp(`name:\\s*['"]${t}['"]`);
  if (!re.test(toolsSrc)) {
    fail(`Gallery tool not registered: ${t}`);
    allGalleryOk = false;
  }
}
if (allGalleryOk) pass(`All 10 gallery CRUD tools registered (${NEW_GALLERY_TOOLS.join(', ')})`);

// 2. All introspection tools registered
let allIntrospectOk = true;
for (const t of NEW_INTROSPECT_TOOLS) {
  const re = new RegExp(`name:\\s*['"]${t}['"]`);
  if (!re.test(toolsSrc)) {
    fail(`Introspection tool not registered: ${t}`);
    allIntrospectOk = false;
  }
}
if (allIntrospectOk) pass(`All 6 introspection tools registered (${NEW_INTROSPECT_TOOLS.join(', ')})`);

// 3. wasm_gallery_import has HIGH_RISK marker + AIDefence call
// Search the section between wasm_gallery_import tool name and wasm_gallery_export
const importStart = toolsSrc.indexOf("'wasm_gallery_import'");
const importEnd = toolsSrc.indexOf("'wasm_gallery_export'");
if (importStart < 0) {
  fail('wasm_gallery_import tool not found');
} else {
  const importSection = toolsSrc.slice(importStart, importEnd > importStart ? importEnd : importStart + 2000);
  if (!/HIGH.?RISK|HIGH_RISK/.test(importSection)) {
    fail('wasm_gallery_import missing HIGH_RISK marker (ADR-129 P3 security requirement)');
  } else {
    pass('wasm_gallery_import has HIGH_RISK marker');
  }
  if (!/aidefence|AIDefence|createAIDefence/.test(importSection)) {
    fail('wasm_gallery_import missing AIDefence gate call (ADR-129 P3 security requirement)');
  } else {
    pass('wasm_gallery_import has AIDefence gate');
  }
}

// 4. agent-wasm.ts exports new gallery functions
const NEW_WASM_EXPORTS = [
  'galleryLoadRvf',
  'galleryConfigure',
  'galleryListByCategory',
  'galleryAddCustom',
  'galleryRemoveCustom',
  'galleryImportCustom',
  'galleryExportCustom',
  'galleryGetActive',
  'galleryGetConfig',
  'resetWasmAgent',
];

let allExportsOk = true;
for (const fn of NEW_WASM_EXPORTS) {
  if (!new RegExp(`export (?:async )?function ${fn}`).test(wasmSrc)) {
    fail(`agent-wasm.ts missing export: ${fn}`);
    allExportsOk = false;
  }
}
if (allExportsOk) pass(`agent-wasm.ts exports all 10 new functions`);

// 5. resetWasmAgent calls agent.reset()
const resetFn = wasmSrc.match(/export function resetWasmAgent[\s\S]*?\n\}/);
if (!resetFn) {
  fail('resetWasmAgent not found in agent-wasm.ts');
} else if (!/\.reset\(\)/.test(resetFn[0])) {
  fail('resetWasmAgent does not call agent.reset()');
} else {
  pass('resetWasmAgent calls agent.reset()');
}

if (process.exitCode) {
  console.error('\nADR-129 P3 gallery CRUD smoke FAILED');
} else {
  console.log('\nADR-129 P3 gallery CRUD smoke PASS');
}
