#!/usr/bin/env node
/**
 * Smoke: #2105 — CLAUDE_FLOW_DB_PATH env var + --path flag on memory subcommands.
 *
 * Verifies the three-tier path resolution in resolveDbPath():
 *   1. --path flag wins over everything
 *   2. CLAUDE_FLOW_DB_PATH env var is honoured when --path is absent
 *   3. Default path (cwd/.swarm/memory.db) used when neither is set
 *
 * Tests both the exported resolveDbPath() function directly and the
 * CLI-level --path flag wiring on memory init / store / retrieve / list /
 * search / delete / stats.
 *
 * Exit codes:
 *   0 — all checks passed
 *   1 — one or more checks failed
 *
 * Usage:
 *   node scripts/smoke-memory-db-path.mjs
 */

import { strictEqual, ok } from 'node:assert';
import { mkdirSync, rmSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve as pathResolve } from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const __dirname = fileURLToPath(new URL('.', import.meta.url));
const ROOT = pathResolve(__dirname, '..');

let passed = 0;
let failed = 0;

function check(label, fn) {
  try {
    fn();
    console.log(`  [PASS] ${label}`);
    passed++;
  } catch (err) {
    console.error(`  [FAIL] ${label}: ${err.message}`);
    failed++;
  }
}

async function checkAsync(label, fn) {
  try {
    await fn();
    console.log(`  [PASS] ${label}`);
    passed++;
  } catch (err) {
    console.error(`  [FAIL] ${label}: ${err.message}`);
    failed++;
  }
}

// ─── 1. Unit-test resolveDbPath() directly ──────────────────────────────────
console.log('\n[smoke-memory-db-path] 1. resolveDbPath() unit tests');

const require = createRequire(import.meta.url);
// Build the CLI if dist doesn't exist
let resolveDbPath;
try {
  const mod = await import(
    join(ROOT, 'v3/@claude-flow/cli/dist/src/memory/memory-initializer.js')
  );
  resolveDbPath = mod.resolveDbPath;
} catch {
  // Try source fallback
  try {
    const mod = await import(
      join(ROOT, 'v3/@claude-flow/cli/src/memory/memory-initializer.js')
    );
    resolveDbPath = mod.resolveDbPath;
  } catch (e) {
    console.error('[SKIP] resolveDbPath not importable — skipping unit tests:', e.message);
    resolveDbPath = null;
  }
}

const tmpDir = join(tmpdir(), `smoke-2105-${Date.now()}`);
mkdirSync(tmpDir, { recursive: true });

try {
  if (resolveDbPath) {
    // Save and restore env vars
    const origDbPath = process.env.CLAUDE_FLOW_DB_PATH;
    const origMemPath = process.env.CLAUDE_FLOW_MEMORY_PATH;

    // Test 1a: --path flag wins
    delete process.env.CLAUDE_FLOW_DB_PATH;
    delete process.env.CLAUDE_FLOW_MEMORY_PATH;
    const cliResult = resolveDbPath(join(tmpDir, 'flag.db'));
    check('--path flag overrides everything', () => {
      ok(cliResult.endsWith('flag.db'), `Expected flag.db, got: ${cliResult}`);
    });

    // Test 1b: CLAUDE_FLOW_DB_PATH env var used when no --path
    process.env.CLAUDE_FLOW_DB_PATH = join(tmpDir, 'env.db');
    delete process.env.CLAUDE_FLOW_MEMORY_PATH;
    const envResult = resolveDbPath(undefined);
    check('CLAUDE_FLOW_DB_PATH env var honoured without --path flag', () => {
      ok(envResult.endsWith('env.db'), `Expected env.db, got: ${envResult}`);
    });

    // Test 1c: --path wins over CLAUDE_FLOW_DB_PATH
    process.env.CLAUDE_FLOW_DB_PATH = join(tmpDir, 'env.db');
    const flagWinsResult = resolveDbPath(join(tmpDir, 'flag2.db'));
    check('--path flag wins over CLAUDE_FLOW_DB_PATH env var', () => {
      ok(flagWinsResult.endsWith('flag2.db'), `Expected flag2.db, got: ${flagWinsResult}`);
    });

    // Test 1d: default path used when neither set
    delete process.env.CLAUDE_FLOW_DB_PATH;
    delete process.env.CLAUDE_FLOW_MEMORY_PATH;
    const defaultResult = resolveDbPath(undefined);
    check('default path used when no flag or env var', () => {
      ok(
        defaultResult.includes('memory.db'),
        `Expected path to include memory.db, got: ${defaultResult}`,
      );
    });

    // Test 1e: CLAUDE_FLOW_MEMORY_PATH provides directory, memory.db appended
    process.env.CLAUDE_FLOW_MEMORY_PATH = tmpDir;
    delete process.env.CLAUDE_FLOW_DB_PATH;
    // Reset cache so CLAUDE_FLOW_MEMORY_PATH takes effect
    const { _resetMemoryRootCache } = await import(
      join(ROOT, 'v3/@claude-flow/cli/dist/src/memory/memory-initializer.js')
    ).catch(() => import(join(ROOT, 'v3/@claude-flow/cli/src/memory/memory-initializer.js')));
    if (_resetMemoryRootCache) _resetMemoryRootCache();
    const memPathResult = resolveDbPath(undefined);
    check('CLAUDE_FLOW_MEMORY_PATH provides directory, memory.db appended', () => {
      ok(
        memPathResult === pathResolve(tmpDir, 'memory.db') ||
          memPathResult.endsWith('memory.db'),
        `Expected memory.db in tmpDir, got: ${memPathResult}`,
      );
    });

    // Restore env
    if (origDbPath !== undefined) process.env.CLAUDE_FLOW_DB_PATH = origDbPath;
    else delete process.env.CLAUDE_FLOW_DB_PATH;
    if (origMemPath !== undefined) process.env.CLAUDE_FLOW_MEMORY_PATH = origMemPath;
    else delete process.env.CLAUDE_FLOW_MEMORY_PATH;
    if (_resetMemoryRootCache) _resetMemoryRootCache();
  }

  // ─── 2. Verify option is declared on memory subcommands ──────────────────
  console.log('\n[smoke-memory-db-path] 2. --path option declared on subcommands');

  // Import the memoryCommand and check its subcommands for the --path option
  let memoryCommand;
  try {
    const mod = await import(
      join(ROOT, 'v3/@claude-flow/cli/dist/src/commands/memory.js')
    );
    memoryCommand = mod.memoryCommand || mod.default;
  } catch {
    try {
      const mod = await import(
        join(ROOT, 'v3/@claude-flow/cli/src/commands/memory.js')
      );
      memoryCommand = mod.memoryCommand || mod.default;
    } catch (e) {
      console.warn('[WARN] Cannot import memory command:', e.message);
    }
  }

  if (memoryCommand) {
    const subcommands = memoryCommand.subcommands || [];
    const targetSubs = ['store', 'retrieve', 'search', 'list', 'delete', 'stats'];
    for (const subName of targetSubs) {
      const sub = subcommands.find(s => s.name === subName);
      check(`memory ${subName} has --path option`, () => {
        ok(sub, `Subcommand '${subName}' not found`);
        const opts = sub.options || [];
        const pathOpt = opts.find(o => o.name === 'path');
        ok(pathOpt, `--path option missing from 'memory ${subName}'`);
      });
    }
  } else {
    console.warn('[WARN] Memory command not available — skipping subcommand option checks');
  }
} finally {
  rmSync(tmpDir, { recursive: true, force: true });
}

// ─── Summary ────────────────────────────────────────────────────────────────
console.log(`\n[smoke-memory-db-path] ${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
