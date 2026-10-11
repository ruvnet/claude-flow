#!/usr/bin/env node
/**
 * Auto Memory Bridge Hook (ADR-048/049)
 *
 * Wires AutoMemoryBridge + LearningBridge + MemoryGraph into Claude Code
 * session lifecycle. Called by settings.json SessionStart/SessionEnd hooks.
 *
 * Usage:
 *   node auto-memory-hook.mjs import   # SessionStart: import auto memory files into backend
 *   node auto-memory-hook.mjs sync     # SessionEnd: sync insights back to MEMORY.md
 *   node auto-memory-hook.mjs status   # Show bridge status
 */

import { existsSync, mkdirSync, readFileSync, writeFileSync, renameSync, unlinkSync, rmdirSync, rmSync, statSync } from 'fs';
import { execFileSync } from 'child_process';
import { homedir } from 'os';
import { join, dirname, resolve, sep } from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
// Executable modules resolve only from the helper's own install root. A
// home-level helper can serve an untrusted project, so CLAUDE_PROJECT_DIR must
// never decide which JavaScript gets imported.
const MODULE_ROOT = join(__dirname, '../..');
// Home-level helpers can serve a different project. Keep the memory writer on
// the same project root as intelligence.cjs, which reads CLAUDE_PROJECT_DIR.
// PROJECT_ROOT is for data only.
const PROJECT_ROOT = process.env.CLAUDE_PROJECT_DIR
  ? resolve(process.env.CLAUDE_PROJECT_DIR)
  : MODULE_ROOT;
const DATA_DIR = join(PROJECT_ROOT, '.claude-flow', 'data');
const STORE_PATH = join(DATA_DIR, 'auto-memory-store.json');

// Colors
const GREEN = '\x1b[0;32m';
const CYAN = '\x1b[0;36m';
const DIM = '\x1b[2m';
const RESET = '\x1b[0m';

const YELLOW = '\x1b[0;33m';
const log = (msg) => console.log(`${CYAN}[AutoMemory] ${msg}${RESET}`);
const success = (msg) => console.log(`${GREEN}[AutoMemory] ✓ ${msg}${RESET}`);
const dim = (msg) => console.log(`  ${DIM}${msg}${RESET}`);

// #2545: fail LOUD instead of a silent dim skip. When @claude-flow/memory cannot
// be resolved, self-learning imports are a no-op — the user must see this and be
// told exactly how to fix it (on both stdout, so it shows in the Claude Code hook
// transcript, and stderr, per the issue's requested channel).
function warnMemoryUnavailable() {
  const line1 = `[AutoMemory] @claude-flow/memory not resolvable from ${MODULE_ROOT} — self-learning imports are DISABLED.`;
  const line2 = '             Fix: npm i -D @claude-flow/memory   (or re-run: npx ruflo@latest init, then npx ruflo@latest doctor --fix)';
  console.log(`${YELLOW}${line1}${RESET}`);
  console.log(`${YELLOW}${line2}${RESET}`);
  process.stderr.write(`${line1}\n${line2}\n`);
}

const DEBUG = !!(process.env.RUFLO_DEBUG || process.env.DEBUG);

// ── Graceful shutdown (FIX 3) ───────────────────────────────────────────────
// Track the backend in use so a SIGTERM/SIGINT mid-run can still flush it
// (the JSON backend persists; a SQLite-backed one closes/flushes WAL) instead
// of leaving a half-written store or a stale lock behind.
let activeBackend = null;
let shuttingDown = false;
function trackBackend(b) { activeBackend = b; return b; }
async function gracefulExit(signal) {
  if (shuttingDown) return;
  shuttingDown = true;
  if (DEBUG) process.stderr.write(`[AutoMemory] received ${signal}, flushing backend before exit\n`);
  try {
    if (activeBackend && typeof activeBackend.shutdown === 'function') await activeBackend.shutdown();
  } catch { /* best effort — never block exit on cleanup */ }
  process.exit(0);
}
process.on('SIGTERM', () => { gracefulExit('SIGTERM'); });
process.on('SIGINT', () => { gracefulExit('SIGINT'); });

// Ensure data dir
if (!existsSync(DATA_DIR)) mkdirSync(DATA_DIR, { recursive: true });

// ============================================================================
// Store write safety (#4058): intelligence.cjs read-modify-writes the same
// file from the session-end hook, so writes are atomic (temp + rename) and
// serialised by a short directory lock. The lock is advisory and fails open:
// a hook must never hang, so after ~2 s it proceeds without it.
// ============================================================================

const LOCK_WAIT_MS = 2000;
const LOCK_STALE_MS = 10000;
function sleepSync(ms) { Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms); }

function withStoreLock(storePath, fn) {
  const lock = storePath + '.lock';
  const deadline = Date.now() + LOCK_WAIT_MS;
  let held = false;
  for (;;) {
    try { mkdirSync(lock); held = true; break; } catch (e) {
      if (!e || e.code !== 'EEXIST') break;
      try {
        if (Date.now() - statSync(lock).mtimeMs > LOCK_STALE_MS) { rmSync(lock, { recursive: true, force: true }); continue; }
      } catch { /* lock vanished: retry */ }
      if (Date.now() > deadline) break;
      sleepSync(10);
    }
  }
  try { return fn(); } finally { if (held) { try { rmdirSync(lock); } catch { /* already gone */ } } }
}

function writeFileAtomic(filePath, text) {
  const tmp = filePath + '.' + process.pid + '.tmp';
  try {
    writeFileSync(tmp, text, 'utf-8');
    renameSync(tmp, filePath);
  } catch (e) {
    try { unlinkSync(tmp); } catch { /* nothing to clean */ }
    throw e;
  }
}

// Claude Code shares one auto-memory directory across every worktree of a
// repository, but findGitRoot() in the memory package stops at a worktree's
// `.git` FILE and keys the directory by the worktree path (#4058). Resolve the
// main checkout through git's common dir so both agree. No shell is involved.
function mainCheckoutRoot(dir) {
  try {
    if (!statSync(join(dir, '.git')).isFile()) return null;
    const common = execFileSync('git', ['rev-parse', '--git-common-dir'], { cwd: dir, encoding: 'utf8', timeout: 5000, stdio: ['ignore', 'pipe', 'ignore'] }).trim();
    if (!common) return null;
    const abs = resolve(dir, common);
    return abs.endsWith('/.git') || abs.endsWith('\\.git') ? dirname(abs) : null;
  } catch { return null; }
}

function worktreeMemoryDir() {
  const main = mainCheckoutRoot(PROJECT_ROOT);
  if (!main) return undefined;
  const key = main.split(sep).join('/').replace(/[\/_:]/g, '-');
  return join(process.env.HOME || process.env.USERPROFILE || homedir(), '.claude', 'projects', key, 'memory');
}

// ============================================================================
// Simple JSON File Backend (implements IMemoryBackend interface)
// ============================================================================

class JsonFileBackend {
  constructor(filePath) {
    this.filePath = filePath;
    this.entries = new Map();
    this.loadedIds = new Set();
    this.deletedIds = new Set();
  }

  async initialize() {
    if (existsSync(this.filePath)) {
      try {
        const data = JSON.parse(readFileSync(this.filePath, 'utf-8'));
        if (Array.isArray(data)) {
          for (const entry of data) { this.entries.set(entry.id, entry); this.loadedIds.add(entry.id); }
        }
      } catch { /* start fresh */ }
    }
  }

  async shutdown() { this._persist(); }
  async store(entry) { this.entries.set(entry.id, entry); this._persist(); }
  async get(id) { return this.entries.get(id) ?? null; }
  async getByKey(key, ns) {
    for (const e of this.entries.values()) {
      if (e.key === key && (!ns || e.namespace === ns)) return e;
    }
    return null;
  }
  async update(id, updates) {
    const e = this.entries.get(id);
    if (!e) return null;
    if (updates.metadata) Object.assign(e.metadata, updates.metadata);
    if (updates.content !== undefined) e.content = updates.content;
    if (updates.tags) e.tags = updates.tags;
    e.updatedAt = Date.now();
    this._persist();
    return e;
  }
  async delete(id) { this.deletedIds.add(id); return this.entries.delete(id); }
  async query(opts) {
    let results = [...this.entries.values()];
    if (opts?.namespace) results = results.filter(e => e.namespace === opts.namespace);
    // MemoryQuery.type is the query mode (semantic|exact|prefix|tag|hybrid), not
    // the entry's memory type: the bridge asks for { type: 'hybrid' } and a strict
    // entry-type match returned nothing, so sync always reported 0 (#4058).
    const MODES = ['semantic', 'exact', 'prefix', 'tag', 'hybrid'];
    if (opts?.type && !MODES.includes(opts.type)) results = results.filter(e => e.type === opts.type);
    if (opts?.memoryType) results = results.filter(e => e.type === opts.memoryType);
    if (opts?.key) results = results.filter(e => e.key === opts.key);
    if (opts?.keyPrefix) results = results.filter(e => typeof e.key === 'string' && e.key.startsWith(opts.keyPrefix));
    if (Array.isArray(opts?.tags) && opts.tags.length) results = results.filter(e => opts.tags.every(t => (e.tags || []).includes(t)));
    if (opts?.updatedAfter) results = results.filter(e => (e.updatedAt || 0) > opts.updatedAfter);
    if (opts?.limit) results = results.slice(0, opts.limit);
    return results;
  }
  async search() { return []; } // No vector search in JSON backend
  async bulkInsert(entries) { for (const e of entries) this.entries.set(e.id, e); this._persist(); }
  async bulkDelete(ids) { let n = 0; for (const id of ids) { this.deletedIds.add(id); if (this.entries.delete(id)) n++; } this._persist(); return n; }
  async count() { return this.entries.size; }
  async listNamespaces() {
    const ns = new Set();
    for (const e of this.entries.values()) ns.add(e.namespace || 'default');
    return [...ns];
  }
  async clearNamespace(ns) {
    let n = 0;
    for (const [id, e] of this.entries) {
      if (e.namespace === ns) { this.deletedIds.add(id); this.entries.delete(id); n++; }
    }
    this._persist();
    return n;
  }
  async getStats() {
    return {
      totalEntries: this.entries.size,
      entriesByNamespace: {},
      entriesByType: { semantic: 0, episodic: 0, procedural: 0, working: 0, cache: 0 },
      memoryUsage: 0, avgQueryTime: 0, avgSearchTime: 0,
    };
  }
  async healthCheck() {
    return {
      status: 'healthy',
      components: {
        storage: { status: 'healthy', latency: 0 },
        index: { status: 'healthy', latency: 0 },
        cache: { status: 'healthy', latency: 0 },
      },
      timestamp: Date.now(), issues: [], recommendations: [],
    };
  }

  _persist() {
    try {
      withStoreLock(this.filePath, () => {
        // Keep entries another writer (intelligence.cjs, a parallel hook) added
        // after we loaded; ours win on the same id, and our own deletes stay deleted.
        const merged = new Map(this.entries);
        try {
          const onDisk = JSON.parse(readFileSync(this.filePath, 'utf-8'));
          if (Array.isArray(onDisk)) {
            for (const e of onDisk) {
              if (e && !merged.has(e.id) && !this.loadedIds.has(e.id) && !this.deletedIds.has(e.id)) merged.set(e.id, e);
            }
          }
        } catch { /* missing or unreadable: write ours */ }
        writeFileAtomic(this.filePath, JSON.stringify([...merged.values()], null, 2));
        for (const id of merged.keys()) this.loadedIds.add(id);
        this.entries = merged;
      });
    } catch { /* best effort */ }
  }
}

// ============================================================================
// Resolve memory package path (local dev or npm installed)
// ============================================================================

async function loadMemoryPackage() {
  // Strategy 0 (#2545): sidecar recorded by `init` / `doctor --fix`. On the
  // documented `npx ruflo` path @claude-flow/memory (an optionalDependency of
  // the CLI) lands in the npx cache, which is NOT on the walk-up path from the
  // project — so init resolves it from the CLI's own context and records the
  // absolute path here. This is the only strategy that works on that install.
  try {
    const sidecar = join(MODULE_ROOT, '.claude-flow', 'memory-package.json');
    if (existsSync(sidecar)) {
      const rec = JSON.parse(readFileSync(sidecar, 'utf-8'));
      if (rec?.distPath && existsSync(rec.distPath)) {
        return await import(`file://${rec.distPath}`);
      }
    }
  } catch { /* fall through */ }

  // Strategy 1: Local dev (built dist)
  const localDist = join(MODULE_ROOT, 'v3/@claude-flow/memory/dist/index.js');
  if (existsSync(localDist)) {
    try {
      return await import(`file://${localDist}`);
    } catch { /* fall through */ }
  }

  // Strategy 2: Use createRequire for CJS-style resolution (handles nested node_modules
  // when installed as a transitive dependency via npx ruflo / npx claude-flow)
  try {
    const { createRequire } = await import('module');
    const require = createRequire(join(MODULE_ROOT, 'package.json'));
    return require('@claude-flow/memory');
  } catch { /* fall through */ }

  // Strategy 3: ESM import (works when @claude-flow/memory is a direct dependency)
  try {
    return await import('@claude-flow/memory');
  } catch { /* fall through */ }

  // Strategy 4: Walk up from MODULE_ROOT looking for @claude-flow/memory in any node_modules
  let searchDir = MODULE_ROOT;
  const { parse } = await import('path');
  while (searchDir !== parse(searchDir).root) {
    const candidate = join(searchDir, 'node_modules', '@claude-flow', 'memory', 'dist', 'index.js');
    if (existsSync(candidate)) {
      try {
        return await import(`file://${candidate}`);
      } catch { /* fall through */ }
    }
    searchDir = dirname(searchDir);
  }

  return null;
}

// ============================================================================
// Read config from .claude-flow/config.yaml
// ============================================================================

function readConfig() {
  const configPath = join(PROJECT_ROOT, '.claude-flow', 'config.yaml');
  const defaults = {
    learningBridge: { enabled: true, sonaMode: 'balanced', confidenceDecayRate: 0.005, accessBoostAmount: 0.03, consolidationThreshold: 10 },
    memoryGraph: { enabled: true, pageRankDamping: 0.85, maxNodes: 5000, similarityThreshold: 0.8 },
    agentScopes: { enabled: true, defaultScope: 'project' },
  };

  if (!existsSync(configPath)) return defaults;

  try {
    const yaml = readFileSync(configPath, 'utf-8');
    // Simple YAML parser for the memory section
    const getBool = (key) => {
      const match = yaml.match(new RegExp(`${key}:\\s*(true|false)`, 'i'));
      return match ? match[1] === 'true' : undefined;
    };

    const lbEnabled = getBool('learningBridge[\\s\\S]*?enabled');
    if (lbEnabled !== undefined) defaults.learningBridge.enabled = lbEnabled;

    const mgEnabled = getBool('memoryGraph[\\s\\S]*?enabled');
    if (mgEnabled !== undefined) defaults.memoryGraph.enabled = mgEnabled;

    const asEnabled = getBool('agentScopes[\\s\\S]*?enabled');
    if (asEnabled !== undefined) defaults.agentScopes.enabled = asEnabled;

    return defaults;
  } catch {
    return defaults;
  }
}

// ============================================================================
// Commands
// ============================================================================

async function doImport() {
  log('Importing auto memory files into bridge...');

  const memPkg = await loadMemoryPackage();
  if (!memPkg || !memPkg.AutoMemoryBridge) {
    warnMemoryUnavailable();
    return;
  }

  const config = readConfig();
  const backend = trackBackend(new JsonFileBackend(STORE_PATH));
  await backend.initialize();

  const bridgeConfig = {
    workingDir: PROJECT_ROOT,
    syncMode: 'on-session-end',
  };
  const wtDir = worktreeMemoryDir();
  if (wtDir) bridgeConfig.memoryDir = wtDir;

  // Wire learning if enabled and available
  if (config.learningBridge.enabled && memPkg.LearningBridge) {
    bridgeConfig.learning = {
      sonaMode: config.learningBridge.sonaMode,
      confidenceDecayRate: config.learningBridge.confidenceDecayRate,
      accessBoostAmount: config.learningBridge.accessBoostAmount,
      consolidationThreshold: config.learningBridge.consolidationThreshold,
    };
  }

  // Wire graph if enabled and available
  if (config.memoryGraph.enabled && memPkg.MemoryGraph) {
    bridgeConfig.graph = {
      pageRankDamping: config.memoryGraph.pageRankDamping,
      maxNodes: config.memoryGraph.maxNodes,
      similarityThreshold: config.memoryGraph.similarityThreshold,
    };
  }

  const bridge = new memPkg.AutoMemoryBridge(backend, bridgeConfig);

  try {
    const result = await bridge.importFromAutoMemory();
    success(`Imported ${result.imported} entries (${result.skipped} skipped)`);
    dim(`├─ Backend entries: ${await backend.count()}`);
    dim(`├─ Learning: ${config.learningBridge.enabled ? 'active' : 'disabled'}`);
    dim(`├─ Graph: ${config.memoryGraph.enabled ? 'active' : 'disabled'}`);
    dim(`└─ Agent scopes: ${config.agentScopes.enabled ? 'active' : 'disabled'}`);
  } catch (err) {
    dim(`Import failed (non-critical): ${err.message}`);
  }

  await backend.shutdown();
}

async function doSync() {
  log('Syncing insights to auto memory files...');

  const memPkg = await loadMemoryPackage();
  if (!memPkg || !memPkg.AutoMemoryBridge) {
    warnMemoryUnavailable();
    return;
  }

  const config = readConfig();
  const backend = trackBackend(new JsonFileBackend(STORE_PATH));
  await backend.initialize();

  const entryCount = await backend.count();
  if (entryCount === 0) {
    dim('No entries to sync');
    await backend.shutdown();
    return;
  }

  const bridgeConfig = {
    workingDir: PROJECT_ROOT,
    syncMode: 'on-session-end',
  };
  const wtDir = worktreeMemoryDir();
  if (wtDir) bridgeConfig.memoryDir = wtDir;

  if (config.learningBridge.enabled && memPkg.LearningBridge) {
    bridgeConfig.learning = {
      sonaMode: config.learningBridge.sonaMode,
      confidenceDecayRate: config.learningBridge.confidenceDecayRate,
      consolidationThreshold: config.learningBridge.consolidationThreshold,
    };
  }

  if (config.memoryGraph.enabled && memPkg.MemoryGraph) {
    bridgeConfig.graph = {
      pageRankDamping: config.memoryGraph.pageRankDamping,
      maxNodes: config.memoryGraph.maxNodes,
    };
  }

  const bridge = new memPkg.AutoMemoryBridge(backend, bridgeConfig);

  try {
    const syncResult = await bridge.syncToAutoMemory();
    success(`Synced ${syncResult.synced} entries to auto memory`);
    dim(`├─ Categories updated: ${syncResult.categories?.join(', ') || 'none'}`);
    dim(`└─ Backend entries: ${entryCount}`);

    // Curate MEMORY.md index with graph-aware ordering
    let indexSkipped = null;
    if (typeof bridge.on === 'function') bridge.on('index:skipped', (info) => { indexSkipped = info; });
    await bridge.curateIndex();
    if (indexSkipped) dim(`MEMORY.md index unchanged (${indexSkipped.reason || 'nothing to curate'})`);
    else success('Curated MEMORY.md index');
  } catch (err) {
    dim(`Sync failed (non-critical): ${err.message}`);
  }

  if (bridge.destroy) bridge.destroy();
  await backend.shutdown();
}

async function doStatus() {
  const memPkg = await loadMemoryPackage();
  const config = readConfig();

  const sidecar = join(MODULE_ROOT, '.claude-flow', 'memory-package.json');
  const hasSidecar = existsSync(sidecar);

  console.log('\n=== Auto Memory Bridge Status ===\n');
  console.log(`  Package:        ${memPkg ? '✅ Available' : '❌ Not found — self-learning DISABLED (fix: npm i -D @claude-flow/memory)'}`);
  console.log(`  Resolver:       ${hasSidecar ? '✅ .claude-flow/memory-package.json' : '⏸ no sidecar (run: npx ruflo@latest doctor --fix)'}`);
  console.log(`  Store:          ${existsSync(STORE_PATH) ? '✅ ' + STORE_PATH : '⏸ Not initialized'}`);
  console.log(`  LearningBridge: ${config.learningBridge.enabled ? '✅ Enabled' : '⏸ Disabled'}`);
  console.log(`  MemoryGraph:    ${config.memoryGraph.enabled ? '✅ Enabled' : '⏸ Disabled'}`);
  console.log(`  AgentScopes:    ${config.agentScopes.enabled ? '✅ Enabled' : '⏸ Disabled'}`);

  if (existsSync(STORE_PATH)) {
    try {
      const data = JSON.parse(readFileSync(STORE_PATH, 'utf-8'));
      console.log(`  Entries:        ${Array.isArray(data) ? data.length : 0}`);
    } catch { /* ignore */ }
  }

  console.log('');
}

// ============================================================================
// Main
// ============================================================================

// Older settings.json files run `node -e "…import(file)" import`, where the
// subcommand lands in argv[1] and argv[2] is empty, so both hooks fell through
// to `status` and never imported or synced (#4058). Accept that shape too.
const COMMANDS = ['import', 'sync', 'status'];
const command = process.argv[2] || (COMMANDS.includes(process.argv[1]) ? process.argv[1] : 'status');

// Dynamic import() failures can surface as unhandled rejections on a later
// microtask even when the awaiting call site already caught them, which would
// otherwise force a non-zero exit. Swallow to keep hooks exit-0, but surface the
// reason under RUFLO_DEBUG/DEBUG so genuine async bugs aren't silently hidden
// (FIX 2 — the previous `() => {}` discarded every rejection process-wide).
process.on('unhandledRejection', (reason) => {
  if (DEBUG) {
    const detail = reason && reason.message ? reason.message : String(reason);
    process.stderr.write(`[AutoMemory] unhandledRejection (suppressed): ${detail}\n`);
  }
});

try {
  switch (command) {
    case 'import': await doImport(); break;
    case 'sync': await doSync(); break;
    case 'status': await doStatus(); break;
    default:
      console.log('Usage: auto-memory-hook.mjs <import|sync|status>');
      break;
  }
} catch (err) {
  // Hooks must never crash Claude Code - fail silently
  try { dim(`Error (non-critical): ${err.message}`); } catch (_) {}
}
// Force clean exit — process.exitCode alone isn't enough if async errors override it
process.exit(0);
