// node --test tests/check-guard-tool-names.test.mjs
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { cpSync, mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';

import { check, extractCandidates, extractRegistryNames, extractServerNames, gather } from '../scripts/check-guard-tool-names.mjs';

const SCRIPT = fileURLToPath(new URL('../scripts/check-guard-tool-names.mjs', import.meta.url));

test('extractCandidates keeps quoted tool-shaped names only', () => {
  const src = "const W = new Set(['agentdb_hierarchical-store', `memory_store`, \"x_federation_publish\", 'plain', 'Not_Shaped', 'a b_c'])";
  assert.deepEqual([...extractCandidates(src)].sort(), ['agentdb_hierarchical-store', 'memory_store', 'x_federation_publish']);
});

test('extractRegistryNames reads name: fields', () => {
  assert.deepEqual([...extractRegistryNames("{ name: 'memory_store', description: 'x' }, { name: \"hooks_pre-edit\" }, { name: 'plain' }")].sort(), ['hooks_pre-edit', 'memory_store']);
});

test('extractServerNames reads .tool( and registerTool( calls', () => {
  assert.deepEqual([...extractServerNames("mcp.tool('claims_issue', 'd', {}); server.registerTool(\"channel_list\", {})")].sort(), ['channel_list', 'claims_issue']);
});

test('check reports a watched name that has no registry match', () => {
  const r = check(new Set(['memory_store', 'memory_stor']), new Set(['memory_store']), {});
  assert.deepEqual(r.unmatched, ['memory_stor']);
});

test('check ignores strings whose family is unknown, but not those in a known family', () => {
  const r = check(new Set(['in_progress', 'text_delta', 'memory_gone']), new Set(['memory_store']), {});
  assert.deepEqual(r.ignored, ['in_progress', 'text_delta']);
  assert.deepEqual(r.unmatched, ['memory_gone']);
});

test('check honours the allowlist and reports it as allowed', () => {
  const r = check(new Set(['hooks_recall']), new Set(['hooks_route']), { hooks_recall: 'ruvector' });
  assert.deepEqual(r.unmatched, []);
  assert.deepEqual(r.allowed, ['hooks_recall']);
});

function fixture(files) {
  const root = mkdtempSync(join(tmpdir(), 'guard-names-'));
  for (const [path, body] of Object.entries(files)) {
    mkdirSync(join(root, path, '..'), { recursive: true });
    writeFileSync(join(root, path), body);
  }
  return root;
}

test('gather skips test files, reads plugin server names, and merges the allowlist', () => {
  const root = fixture({
    'plugins/p/hooks/guard.ts': "const W = ['memory_store', 'channel_list']",
    'plugins/p/hooks/guard.test.ts': "const W = ['memory_ghost']",
    'plugins/p/.mcp.json': '{}',
    'plugins/p/src/server.mjs': "mcp.tool('channel_list', 'd')",
    'v3/@claude-flow/cli/src/mcp-tools/memory-tools.ts': "{ name: 'memory_store' }",
    'scripts/guard-tool-names.allow.json': '{"x_y":"r"}',
  });
  try {
    const g = gather(root);
    assert.deepEqual([...g.watched.keys()].sort(), ['channel_list', 'memory_store']);
    assert.deepEqual([...g.registry].sort(), ['channel_list', 'memory_store']);
    assert.deepEqual(g.allow, { x_y: 'r' });
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

function runIn(files, useSymlink = false) {
  const root = fixture(files);
  mkdirSync(join(root, 'scripts'), { recursive: true });
  cpSync(SCRIPT, join(root, 'scripts/check-guard-tool-names.mjs'));
  try {
    const entry = join(root, 'scripts/check-guard-tool-names.mjs');
    const alias = join(root, 'scripts/check-guard-alias.mjs');
    if (useSymlink) symlinkSync(entry, alias);
    return spawnSync(process.execPath, [useSymlink ? alias : entry], { encoding: 'utf8' });
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
}

test('CLI fails loud (exit 3) when nothing was extracted', () => {
  const r = runIn({ 'plugins/p/hooks/guard.ts': 'export {}', 'v3/@claude-flow/cli/src/mcp-tools/a.ts': "{ name: 'memory_store' }" });
  assert.equal(r.status, 3);
  assert.match(r.stderr, /check is broken/);
});

test('CLI fails loud (exit 3) when the registry is empty', () => {
  const r = runIn({ 'plugins/p/hooks/guard.ts': "['memory_store']", 'v3/@claude-flow/cli/src/mcp-tools/a.ts': 'export {}' });
  assert.equal(r.status, 3);
});

test('CLI exits 1 naming the plugin for a renamed tool, 0 once it matches', () => {
  const base = { 'plugins/p/hooks/guard.ts': "['memory_store', 'memory_renamed']" };
  const bad = runIn({ ...base, 'v3/@claude-flow/cli/src/mcp-tools/a.ts': "{ name: 'memory_store' }" });
  assert.equal(bad.status, 1);
  assert.match(bad.stderr, /UNMATCHED memory_renamed \(watched by p\)/);
  const ok = runIn({ ...base, 'v3/@claude-flow/cli/src/mcp-tools/a.ts': "{ name: 'memory_store' }, { name: 'memory_renamed' }" });
  assert.equal(ok.status, 0);
});

test('the real repo passes', () => {
  const r = spawnSync(process.execPath, [SCRIPT], { encoding: 'utf8' });
  assert.equal(r.status, 0, r.stderr);
});

test("symlinked CLI entry still rejects renamed tools", () => {
  const result = runIn({ "plugins/p/hooks/guard.ts": "['memory_missing']", "v3/@claude-flow/cli/src/mcp-tools/a.ts": "{name: 'memory_store'}" }, true);
  assert.equal(result.status, 1);
  assert.match(result.stderr, /UNMATCHED memory_missing/);
});
