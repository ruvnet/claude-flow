/**
 * Statusline Configuration Generator (Optimized)
 * Creates fast, reliable statusline for V3 progress display
 *
 * Performance:
 * - Single combined git execSync call (not 8+ separate ones)
 * - process.memoryUsage() instead of ps aux
 * - No recursive test file content reading
 * - Shared settings cache
 * - Strict 2s timeouts on all shell calls
 */

import type { InitOptions } from './types.js';

/**
 * Generate optimized statusline script
 * Output format:
 * ▊ RuFlo V3.6 ● user  │  ⎇ branch  │  Opus 4.7
 * ─────────────────────────────────────────────────────
 * 🏗️  DDD Domains    [●●○○○]  2/5    ⚡ HNSW 150x
 * 🤖 Swarm  ◉ [ 5/15]  👥 2    🪝 10/17    🟢 CVE 3/3    💾 4MB    🧠  63%
 * 🔧 Architecture    ADRs ●71%  │  DDD ● 13%  │  Security ●CLEAN
 * 📊 AgentDB    Vectors ●3104⚡  │  Size 216KB  │  Tests ●6 (~24 cases)  │  MCP ●1/1
 */
export function generateStatuslineScript(options: InitOptions): string {
  const maxAgents = options.runtime.maxAgents;

  return `#!/usr/bin/env node
/**
 * RuFlo V3 Statusline — delegation build (#2195)
 *
 * Fix for ruvnet/ruflo#2195: the previous version re-implemented all data
 * readers locally using fragile file probes that missed AgentDB patterns,
 * the v3/docs/adr/ ADR directory, and the real vector count.
 *
 * This version delegates to 'npx @claude-flow/cli hooks statusline --json'
 * as the single source of truth. That command queries AgentDB directly,
 * counts ADRs in both directories, and reports the real intelligence pct.
 *
 * ADR counting falls back to local file reads so the display still works
 * without network access (counts both v3/docs/adr/ and v3/implementation/adrs/).
 *
 * Cache: JSON result is cached in /tmp for 10s so rapid prompt triggers
 * (every keystroke in some shells) don't hammer the CLI on every call.
 *
 * Usage: node statusline.cjs [--json] [--compact] [--dashboard]
 */

/* eslint-disable @typescript-eslint/no-var-requires */
const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');
const os = require('os');

// Configuration
const CONFIG = {
  maxAgents: ${maxAgents},
  // Session-cost display. Claude Code's cost.total_cost_usd is a client-side
  // estimate that "may differ from your actual bill" and reads as misleading on
  // subscription plans, where token usage is not billed per dollar. These let
  // each user pick what the segment means to them without changing the default.
  //   RUFLO_STATUSLINE_COST_SYMBOL  override the leading '$' (e.g. ⚡, €, 🌱);
  //                                 set to an empty string for the number alone.
  //   RUFLO_STATUSLINE_HIDE_COST    1/true/yes/on removes the segment entirely.
  costSymbol: process.env.RUFLO_STATUSLINE_COST_SYMBOL ?? '$',
  hideCost: /^(1|true|yes|on)$/i.test(process.env.RUFLO_STATUSLINE_HIDE_COST || ''),
};

const CWD = process.cwd();

// ─── Delegation cache ───────────────────────────────────────────
// Cache the CLI JSON result for 60s so rapid prompt re-renders
// (Claude Code refreshes the statusline several times a second while
// streaming) don't re-invoke the CLI each time. #2337: bumped 10s→60s
// because 10s was far too short for how often Claude Code re-renders.
const CACHE_FILE = path.join(os.tmpdir(), 'ruflo-statusline-cache-' + require('crypto').createHash('md5').update(CWD).digest('hex').slice(0, 8) + '.json');
const CACHE_TTL_MS = 60000;

// #2337: resolve an already-installed @claude-flow/cli (or ruflo) bin so we
// can invoke it directly via \`node\`. The previous version called
// \`npx --yes @claude-flow/cli@latest\` on every uncached render, which forces
// a registry resolution + cold-start of the entire CLI per render. With
// multiple concurrent Claude Code sessions this storms the host (reporter
// saw load average 40-65 on a 12-core box).
//
// Returns the absolute path to bin/cli.js or null. Mirrors getPkgVersion()'s
// path probing (project, monorepo, plugin marketplace, global node_modules
// including custom-prefix layouts like ~/.npm-global).
function resolveCliBin() {
  try {
    const home = os.homedir();
    const candidates = [
      path.join(home, '.claude', 'plugins', 'marketplaces', 'ruflo', 'bin', 'cli.js'),
      path.join(CWD, 'node_modules', '@claude-flow', 'cli', 'bin', 'cli.js'),
      path.join(CWD, 'node_modules', 'ruflo', 'bin', 'cli.js'),
      path.join(CWD, 'v3', '@claude-flow', 'cli', 'bin', 'cli.js'),
    ];
    try {
      const binDir = path.dirname(process.execPath);
      const globalModuleDirs = [path.join(binDir, '..', 'lib', 'node_modules'), path.join(binDir, 'node_modules')];
      for (const prefix of [process.env.npm_config_prefix, process.env.PREFIX, path.join(home, '.npm-global')]) {
        if (prefix) globalModuleDirs.push(path.join(prefix, 'lib', 'node_modules'));
      }
      for (const gm of globalModuleDirs) {
        candidates.push(
          path.join(gm, 'ruflo', 'bin', 'cli.js'),
          path.join(gm, '@claude-flow', 'cli', 'bin', 'cli.js'),
        );
      }
    } catch { /* ignore */ }
    for (const p of candidates) {
      if (fs.existsSync(p)) return p;
    }
  } catch { /* ignore */ }
  return null;
}

// Return { fresh, data }. 'fresh' is true only if within the TTL — but data
// is returned regardless (stale-while-revalidate). This lets us serve last
// known state (specifically the promo row) when the CLI is slow/unavailable,
// so users don't see the funnel row flicker in and out on cache expiry.
function readCache() {
  try {
    if (fs.existsSync(CACHE_FILE)) {
      const raw = JSON.parse(fs.readFileSync(CACHE_FILE, 'utf-8'));
      if (raw && raw._ts && raw.data) {
        return { fresh: (Date.now() - raw._ts) < CACHE_TTL_MS, data: raw.data };
      }
    }
  } catch { /* ignore */ }
  return { fresh: false, data: null };
}

function writeCache(data) {
  try { fs.writeFileSync(CACHE_FILE, JSON.stringify({ _ts: Date.now(), data }), 'utf-8'); } catch { /* ignore */ }
}

/**
 * Single source of truth: delegate to the CLI hooks statusline --json command.
 * Falls back to a minimal static object on failure so the statusline still renders.
 *
 * Fix for ruflo#2195: the previous local readers returned 0 for AgentDB patterns
 * (missed the .swarm/memory.db → AgentDB path), computed dddProgress wrong,
 * and only counted ADRs in v3/implementation/adrs/ (missed v3/docs/adr/).
 */
function getStatuslineData() {
  const cache = readCache();
  if (cache.fresh) return cache.data;

  try {
    // #2337: prefer an already-installed CLI bin via direct \`node\` invocation
    // — no npx, no registry round-trip, no @latest re-resolve per render.
    // Fall back to \`npx --prefer-offline @claude-flow/cli\` (no @latest) only
    // when nothing is installed locally, so a cold environment still works.
    const cliBin = resolveCliBin();
    const cmd = cliBin
      ? '"' + process.execPath + '" "' + cliBin + '" hooks statusline --json 2>/dev/null'
      : 'npx --prefer-offline @claude-flow/cli hooks statusline --json 2>/dev/null';
    const raw = execSync(
      cmd,
      { encoding: 'utf-8', timeout: 8000, stdio: ['pipe', 'pipe', 'pipe'], cwd: CWD }
    ).trim();
    // The CLI may emit preamble lines before the JSON — find the first '{'.
    const jsonStart = raw.indexOf('{');
    if (jsonStart === -1) throw new Error('no JSON in CLI output');
    const data = JSON.parse(raw.slice(jsonStart));
    // Overlay every block the CLI JSON omits (adrs/agentdb/tests/hooks/integration)
    // with real local reads, so those segments reflect actual state instead of 0.
    applyLocalOverlays(data);
    writeCache(data);
    return data;
  } catch { /* CLI unavailable or timed out */ }

  // Stale-while-revalidate: if we have any cached data, keep serving it so the
  // funnel row doesn't flicker on CLI hiccups. Overlay fresh local reads for
  // the segments the CLI JSON doesn't populate; the promo row survives.
  if (cache.data) {
    applyLocalOverlays(cache.data);
    return cache.data;
  }

  // Fallback: use local file probes only (will be less accurate, but non-zero
  // when CLI is available and accurate when it's not).
  return buildLocalFallback();
}

// Count ADRs from BOTH known directories (fix for ruflo#2195: old code missed
// v3/docs/adr/ which holds ADR-088..ADR-137, i.e. 41 of the 128 total ADRs).
function getLocalADRCount() {
  const adrDirs = [
    path.join(CWD, 'v3', 'implementation', 'adrs'),
    path.join(CWD, 'v3', 'docs', 'adr'),
    path.join(CWD, 'docs', 'adrs'),
    path.join(CWD, '.claude-flow', 'adrs'),
  ];
  let total = 0;
  for (const dir of adrDirs) {
    try {
      if (fs.existsSync(dir)) {
        const files = fs.readdirSync(dir).filter(function(f) {
          return f.endsWith('.md') && (f.startsWith('ADR-') || f.startsWith('adr-') || /^\\d{4}-/.test(f));
        });
        total += files.length;
      }
    } catch { /* ignore */ }
  }
  return { count: total, implemented: total, compliance: 0 };
}

// ─── Local overlays for segments the CLI JSON omits ──────────────
// 'hooks statusline --json' only returns user/v3Progress/security/swarm/system.
// agentdb/tests/hooks/integration are never populated, so without these overlays
// they render as a permanent 0. Each reader is cheap and degrades to zeros.

// Real AgentDB stats from the local memory DB. Vectors live in .swarm/memory.db
// (sql.js + HNSW); ruvector.db is an opaque redb store counted only toward size.
// One read-only sqlite3 query (mode=ro never takes a write lock the daemon owns).
function getLocalAgentDB() {
  const result = { vectorCount: 0, dbSizeKB: 0, hasHnsw: false };
  try {
    let bytes = 0;
    for (const f of ['.swarm/memory.db', 'ruvector.db']) {
      try { bytes += fs.statSync(path.join(CWD, f)).size; } catch { /* missing */ }
    }
    result.dbSizeKB = Math.round(bytes / 1024);

    const memDb = path.join(CWD, '.swarm', 'memory.db');
    if (fs.existsSync(memDb)) {
      const Q = String.fromCharCode(34);
      // Two INDEPENDENT statements -- do NOT combine into one. Coupling the
      // vector count with the vector_indexes row count in a single statement
      // meant that on a DB missing the vector_indexes table (older/agentdb-
      // written DBs), the whole statement failed at PREPARE time (SQLite
      // compiles the full SQL before running), so the valid memory_entries
      // count was discarded too and the statusline showed Vectors 0 despite
      // thousands of real vectors. Split so a missing table can only zero the
      // HNSW flag, never the count. The init self-heal provisions the table so
      // the flag recovers on the next ruflo init / MCP start.
      const countSql = Q + 'SELECT COUNT(*) FROM memory_entries WHERE embedding IS NOT NULL;' + Q;
      const vc = safeExec("sqlite3 'file:" + memDb + "?mode=ro' " + countSql, 1500);
      if (vc) result.vectorCount = parseInt(vc, 10) || 0;
      // HNSW flag: separate statement. If vector_indexes is absent, sqlite3
      // exits non-zero and safeExec returns empty -- hasHnsw stays false (exact
      // original semantics: at least one index-config row present).
      const hnswSql = Q + 'SELECT COUNT(*) FROM vector_indexes;' + Q;
      const hn = safeExec("sqlite3 'file:" + memDb + "?mode=ro' " + hnswSql, 1500);
      if (hn) result.hasHnsw = (parseInt(hn, 10) || 0) > 0;
    }
  } catch { /* ignore */ }
  return result;
}

// Count test files via a bounded directory walk (no file reads).
function getLocalTests() {
  let testFiles = 0;
  function countTests(dir, depth) {
    if ((depth || 0) > 4) return;
    try {
      if (!fs.existsSync(dir)) return;
      for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
        if (e.isDirectory() && !e.name.startsWith('.') && e.name !== 'node_modules') {
          countTests(path.join(dir, e.name), (depth || 0) + 1);
        } else if (e.isFile() && (e.name.includes('.test.') || e.name.includes('.spec.') || e.name.startsWith('test_') || e.name.startsWith('spec_'))) {
          testFiles++;
        }
      }
    } catch { /* ignore */ }
  }
  for (const d of ['tests', 'test', '__tests__', 'src', 'v3']) countTests(path.join(CWD, d));
  return { testFiles, testCases: testFiles * 4 };
}

// Count configured hooks from project .claude/settings.json. Claude Code hooks
// have no enabled/disabled flag, so every configured hook counts as enabled.
function getLocalHooks() {
  const result = { enabled: 0, total: 0 };
  try {
    const settings = readJSON(path.join(CWD, '.claude', 'settings.json'));
    const hooks = settings && settings.hooks;
    if (hooks && typeof hooks === 'object') {
      let n = 0;
      for (const ev of Object.keys(hooks)) {
        const groups = hooks[ev];
        if (Array.isArray(groups)) {
          for (const g of groups) {
            if (g && Array.isArray(g.hooks)) n += g.hooks.length;
          }
        }
      }
      result.total = n;
      result.enabled = n;
    }
  } catch { /* ignore */ }
  return result;
}

// Best-effort integration block: DB presence + locally-configured stdio MCP
// servers (project .mcp.json + global ~/.claude.json). Remote connectors are
// account-managed and not present in local config, so they are not counted.
function getLocalIntegration() {
  const integration = { mcpServers: { enabled: 0, total: 0 }, hasDatabase: false };
  try {
    for (const f of ['.swarm/memory.db', 'ruvector.db']) {
      if (fs.existsSync(path.join(CWD, f))) { integration.hasDatabase = true; break; }
    }
    const names = new Set();
    const projMcp = readJSON(path.join(CWD, '.mcp.json'));
    if (projMcp && projMcp.mcpServers) for (const k of Object.keys(projMcp.mcpServers)) names.add(k);
    const claudeJson = readJSON(path.join(os.homedir(), '.claude.json'));
    if (claudeJson) {
      if (claudeJson.mcpServers) for (const k of Object.keys(claudeJson.mcpServers)) names.add(k);
      const proj = claudeJson.projects && claudeJson.projects[CWD];
      if (proj && proj.mcpServers && !Array.isArray(proj.mcpServers)) {
        for (const k of Object.keys(proj.mcpServers)) names.add(k);
      }
    }
    integration.mcpServers.total = names.size;
    integration.mcpServers.enabled = names.size;
  } catch { /* ignore */ }
  return integration;
}

// Overlay every locally-derived block onto the CLI data (mutates in place).
function applyLocalOverlays(data) {
  data.adrs = getLocalADRCount();
  data.agentdb = getLocalAgentDB();
  data.tests = getLocalTests();
  data.hooks = getLocalHooks();
  data.integration = getLocalIntegration();
  return data;
}

// Minimal local fallback when the CLI is not installed or times out.
// Returns a structure that matches the CLI JSON schema so the renderer works.
function buildLocalFallback() {
  const memMB = Math.floor(process.memoryUsage().heapUsed / 1024 / 1024);

  return applyLocalOverlays({
    user: { name: 'user', gitBranch: '', modelName: 'Claude Code' },
    v3Progress: { domainsCompleted: 0, totalDomains: 5, dddProgress: 0, patternsLearned: 0, sessionsCompleted: 0 },
    security: { status: 'NONE', cvesFixed: 0, totalCves: 0 },
    swarm: { activeAgents: 0, maxAgents: CONFIG.maxAgents, coordinationActive: false },
    system: { memoryMB: memMB, contextPct: 0, intelligencePct: 0, subAgents: 0 },
    lastUpdated: new Date().toISOString(),
  });
}

// ANSI colors
const c = {
  reset: '\\x1b[0m',
  bold: '\\x1b[1m',
  dim: '\\x1b[2m',
  red: '\\x1b[0;31m',
  green: '\\x1b[0;32m',
  yellow: '\\x1b[0;33m',
  blue: '\\x1b[0;34m',
  purple: '\\x1b[0;35m',
  cyan: '\\x1b[0;36m',
  brightRed: '\\x1b[1;31m',
  brightGreen: '\\x1b[1;32m',
  brightYellow: '\\x1b[1;33m',
  brightBlue: '\\x1b[1;34m',
  brightPurple: '\\x1b[1;35m',
  brightCyan: '\\x1b[1;36m',
  brightWhite: '\\x1b[1;37m',
};

// Safe execSync with strict timeout (returns empty string on failure)
function safeExec(cmd, timeoutMs) {
  try {
    return execSync(cmd, {
      encoding: 'utf-8',
      timeout: timeoutMs || 2000,
      stdio: ['pipe', 'pipe', 'pipe'],
    }).trim();
  } catch {
    return '';
  }
}

// Safe JSON file reader (returns null on failure)
function readJSON(filePath) {
  try {
    if (fs.existsSync(filePath)) {
      return JSON.parse(fs.readFileSync(filePath, 'utf-8'));
    }
  } catch { /* ignore */ }
  return null;
}

// ─── Git info (pure-Node / single exec — needed for branch display) ──────────

function getGitInfo() {
  const result = {
    name: 'user', gitBranch: '', modified: 0, untracked: 0,
    staged: 0, ahead: 0, behind: 0,
  };

  const script = [
    'git config user.name 2>/dev/null || echo user',
    'echo "---SEP---"',
    'git branch --show-current 2>/dev/null',
    'echo "---SEP---"',
    'git status --porcelain 2>/dev/null',
    'echo "---SEP---"',
    'git rev-list --left-right --count HEAD...@{upstream} 2>/dev/null || echo "0 0"',
  ].join('; ');

  const raw = safeExec("sh -c '" + script + "'", 3000);
  if (!raw) return result;

  const parts = raw.split('---SEP---').map(function(s) { return s.trim(); });
  if (parts.length >= 4) {
    result.name = parts[0] || 'user';
    result.gitBranch = parts[1] || '';

    if (parts[2]) {
      for (const line of parts[2].split('\\n')) {
        if (!line || line.length < 2) continue;
        const x = line[0], y = line[1];
        if (x === '?' && y === '?') { result.untracked++; continue; }
        if (x !== ' ' && x !== '?') result.staged++;
        if (y !== ' ' && y !== '?') result.modified++;
      }
    }

    const ab = (parts[3] || '0 0').split(/\\s+/);
    result.ahead = parseInt(ab[0]) || 0;
    result.behind = parseInt(ab[1]) || 0;
  }

  return result;
}

// Detect model name from Claude config (pure file reads, no exec)
function getModelName() {
  try {
    const claudeConfig = readJSON(path.join(os.homedir(), '.claude.json'));
    if (claudeConfig && claudeConfig.projects) {
      for (const [projectPath, projectConfig] of Object.entries(claudeConfig.projects)) {
        if (CWD === projectPath || CWD.startsWith(projectPath + '/')) {
          const usage = projectConfig.lastModelUsage;
          if (usage) {
            const ids = Object.keys(usage);
            if (ids.length > 0) {
              let modelId = ids[ids.length - 1];
              let latest = 0;
              for (const id of ids) {
                const ts = usage[id] && usage[id].lastUsedAt ? new Date(usage[id].lastUsedAt).getTime() : 0;
                if (ts > latest) { latest = ts; modelId = id; }
              }
              if (modelId.includes('opus')) return 'Opus 4.8';
              if (modelId.includes('sonnet')) return 'Sonnet 4.6';
              if (modelId.includes('haiku')) return 'Haiku 4.5';
              return modelId.split('-').slice(1, 3).join(' ');
            }
          }
          break;
        }
      }
    }
  } catch { /* ignore */ }

  // Fallback: settings.json model field
  const settings = getSettings();
  if (settings && settings.model) {
    const m = settings.model;
    if (m.includes('opus')) return 'Opus 4.8';
    if (m.includes('sonnet')) return 'Sonnet 4.6';
    if (m.includes('haiku')) return 'Haiku 4.5';
  }
  return 'Claude Code';
}

// ─── Stdin reader (Claude Code pipes session JSON) ──────────────
// Claude Code sends session JSON via stdin. Read synchronously so the
// script works both when invoked by Claude Code (stdin has JSON) and
// when run manually from terminal (stdin is empty/tty).
let _stdinData = null;
function getStdinData() {
  if (_stdinData !== undefined && _stdinData !== null) return _stdinData;
  try {
    if (process.stdin.isTTY) { _stdinData = null; return null; }
    const chunks = [];
    const buf = Buffer.alloc(4096);
    let bytesRead;
    try {
      while ((bytesRead = fs.readSync(0, buf, 0, buf.length, null)) > 0) {
        chunks.push(buf.slice(0, bytesRead));
      }
    } catch { /* EOF or read error */ }
    const raw = Buffer.concat(chunks).toString('utf-8').trim();
    _stdinData = (raw && raw.startsWith('{')) ? JSON.parse(raw) : null;
  } catch {
    _stdinData = null;
  }
  return _stdinData;
}

function getModelFromStdin() {
  const data = getStdinData();
  return (data && data.model && data.model.display_name) ? data.model.display_name : null;
}

function getContextFromStdin() {
  const data = getStdinData();
  if (data && data.context_window) {
    return { usedPct: Math.floor(data.context_window.used_percentage || 0) };
  }
  return null;
}

function getCostFromStdin() {
  const data = getStdinData();
  if (data && data.cost) {
    const durationMs = data.cost.total_duration_ms || 0;
    const mins = Math.floor(durationMs / 60000);
    const secs = Math.floor((durationMs % 60000) / 1000);
    return {
      costUsd: data.cost.total_cost_usd || 0,
      duration: mins > 0 ? mins + 'm' + secs + 's' : secs + 's',
    };
  }
  return null;
}

// Read package version from the first package.json we find.
function getPkgVersion() {
  let ver = '3.6';
  try {
    const home = os.homedir();
    const pkgPaths = [
      path.join(home, '.claude', 'plugins', 'marketplaces', 'ruflo', 'package.json'),
      path.join(CWD, 'node_modules', '@claude-flow', 'cli', 'package.json'),
      path.join(CWD, 'node_modules', 'ruflo', 'package.json'),
      path.join(CWD, 'v3', '@claude-flow', 'cli', 'package.json'),
    ];
    // #2221: global installs (npm i -g ruflo) live outside CWD/node_modules, so the
    // probes above all miss and the version falls back to the hard-coded default.
    // Derive the global node_modules dir from the running node binary (no npm spawn —
    // statusline renders often). Covers nvm/mise (bin/../lib/node_modules) and Windows
    // (bin/node_modules) layouts.
    try {
      const binDir = path.dirname(process.execPath);
      const globalModuleDirs = [path.join(binDir, '..', 'lib', 'node_modules'), path.join(binDir, 'node_modules')];
      // #2221 follow-up: a custom npm prefix (e.g. ~/.npm-global) is decoupled from
      // the node binary location, so the binDir-derived probes above all miss. Also
      // probe the npm prefix from the environment and the common ~/.npm-global default.
      for (const prefix of [process.env.npm_config_prefix, process.env.PREFIX, path.join(home, '.npm-global')]) {
        if (prefix) globalModuleDirs.push(path.join(prefix, 'lib', 'node_modules'));
      }
      for (const gm of globalModuleDirs) {
        pkgPaths.push(
          path.join(gm, 'ruflo', 'package.json'),
          path.join(gm, '@claude-flow', 'cli', 'package.json'),
        );
      }
    } catch { /* ignore */ }
    for (const p of pkgPaths) {
      if (!fs.existsSync(p)) continue;
      try {
        const pkg = JSON.parse(fs.readFileSync(p, 'utf-8'));
        if (pkg && typeof pkg.version === 'string' && pkg.version.length > 0) { ver = pkg.version; break; }
      } catch { /* ignore */ }
    }
  } catch { /* ignore */ }
  return ver;
}

// ─── Rendering ──────────────────────────────────────────────────

function progressBar(current, total) {
  const width = 5;
  const filled = Math.round((current / total) * width);
  return '[' + '●'.repeat(filled) + '○'.repeat(width - filled) + ']';
}

function generateStatusline() {
  const d = getStatuslineData();
  const git = getGitInfo();
  const modelName = getModelFromStdin() || (d.user && d.user.modelName) || 'Claude Code';
  const ctxInfo = getContextFromStdin();
  const costInfo = getCostFromStdin();
  const pkgVersion = getPkgVersion();

  const progress = d.v3Progress || {};
  const security = d.security || {};
  const swarm = d.swarm || {};
  const system = d.system || {};
  const adrs = d.adrs || {};
  const hooks = d.hooks || {};
  const agentdb = d.agentdb || {};
  const tests = d.tests || {};

  const domainsCompleted = progress.domainsCompleted || 0;
  const totalDomains = progress.totalDomains || 5;
  const dddProgress = progress.dddProgress || 0;
  const patternsLearned = progress.patternsLearned || 0;
  const activeAgents = swarm.activeAgents || 0;
  const maxAgents = swarm.maxAgents || CONFIG.maxAgents;
  const coordinationActive = swarm.coordinationActive || false;
  const intelligencePct = system.intelligencePct || 0;
  const memoryMB = system.memoryMB || 0;
  const subAgents = system.subAgents || 0;
  const cvesFixed = security.cvesFixed || 0;
  const totalCves = security.totalCves || 0;
  const secStatus = security.status || 'NONE';
  const adrCount = adrs.count || 0;
  const adrImpl = adrs.implemented || 0;
  const hooksEnabled = hooks.enabled || 0;
  const hooksTotal = hooks.total || 0;
  const vectorCount = agentdb.vectorCount || 0;
  const hasHnsw = agentdb.hasHnsw || false;
  const dbSizeKB = agentdb.dbSizeKB || 0;
  const testFiles = tests.testFiles || 0;
  const testCases = tests.testCases || testFiles * 4;

  const lines = [];

  // Header
  let header = c.bold + c.brightPurple + '▊ RuFlo V' + pkgVersion + ' ' + c.reset;
  header += (coordinationActive ? c.brightCyan : c.dim) + '● ' + c.brightCyan + git.name + c.reset;
  if (git.gitBranch) {
    header += '  ' + c.dim + '│' + c.reset + '  ' + c.brightBlue + '⏇ ' + git.gitBranch + c.reset;
    const changes = git.modified + git.staged + git.untracked;
    if (changes > 0) {
      let ind = '';
      if (git.staged > 0) ind += c.brightGreen + '+' + git.staged + c.reset;
      if (git.modified > 0) ind += c.brightYellow + '~' + git.modified + c.reset;
      if (git.untracked > 0) ind += c.dim + '?' + git.untracked + c.reset;
      header += ' ' + ind;
    }
    if (git.ahead > 0) header += ' ' + c.brightGreen + '↑' + git.ahead + c.reset;
    if (git.behind > 0) header += ' ' + c.brightRed + '↓' + git.behind + c.reset;
  }
  header += '  ' + c.dim + '│' + c.reset + '  ' + c.purple + modelName + c.reset;
  const duration = costInfo ? costInfo.duration : '';
  if (duration) header += '  ' + c.dim + '│' + c.reset + '  ' + c.cyan + '⏱ ' + duration + c.reset;
  if (ctxInfo && ctxInfo.usedPct > 0) {
    const ctxColor = ctxInfo.usedPct >= 90 ? c.brightRed : ctxInfo.usedPct >= 70 ? c.brightYellow : c.brightGreen;
    header += '  ' + c.dim + '│' + c.reset + '  ' + ctxColor + '● ' + ctxInfo.usedPct + '% ctx' + c.reset;
  }
  if (!CONFIG.hideCost && costInfo && costInfo.costUsd > 0) {
    header += '  ' + c.dim + '│' + c.reset + '  ' + c.brightYellow + CONFIG.costSymbol + costInfo.costUsd.toFixed(2) + c.reset;
  }
  lines.push(header);

  // Separator
  lines.push(c.dim + '─'.repeat(53) + c.reset);

  // Design discipline (ADR to follow in #2623):
  //   - show healthy state only when it confirms readiness,
  //   - show zero values only when zero is actionable,
  //   - show failures immediately,
  //   - diagnostic detail lives behind \`ruflo status --verbose\`.
  const domainsColor = domainsCompleted >= 3 ? c.brightGreen : domainsCompleted > 0 ? c.yellow : c.red;
  const agentsColor = activeAgents > 0 ? c.brightGreen : c.dim;
  const hooksColor = hooksEnabled > 0 ? c.brightGreen : c.dim;
  const intellColor = intelligencePct >= 80 ? c.brightGreen : intelligencePct >= 40 ? c.brightYellow : c.dim;
  const secColor = secStatus === 'CLEAN' ? c.brightGreen
                 : secStatus === 'PENDING' ? c.brightYellow
                 : (secStatus === 'IN_PROGRESS' || secStatus === 'STALE') ? c.brightYellow
                 : secStatus === 'NONE' ? c.dim : c.brightRed;
  const sizeDisp = dbSizeKB >= 1024 ? (dbSizeKB / 1024).toFixed(1) + 'MB' : dbSizeKB + 'KB';
  const integration = d.integration || {};
  const mcpServers = (integration.mcpServers) || {};

  // Row 1 — Architecture: Domains  ADRs   Goal (when no measured progress)
  let perfIndicator;
  if (hasHnsw && vectorCount > 0) {
    const speedup = vectorCount > 10000 ? '12500x' : vectorCount > 1000 ? '150x' : '10x';
    perfIndicator = c.brightGreen + 'HNSW ' + speedup + c.reset;
  } else if (patternsLearned > 0) {
    const pk = patternsLearned >= 1000 ? (patternsLearned / 1000).toFixed(1) + 'k' : String(patternsLearned);
    perfIndicator = c.brightYellow + pk + ' patterns' + c.reset;
  } else {
    perfIndicator = c.dim + 'Goal 150x-12500x' + c.reset;
  }
  const archParts = [
    c.cyan + 'Domains ' + c.reset + domainsColor + domainsCompleted + c.reset + '/' + c.brightWhite + totalDomains + c.reset,
  ];
  if (adrCount > 0) archParts.push(c.cyan + 'ADRs ' + c.brightWhite + adrCount + c.reset);
  archParts.push(perfIndicator);
  lines.push(c.brightCyan + '🏗️  Architecture' + c.reset + '   ' + archParts.join('   '));

  // Row 2 — Runtime: Swarm  [subAgents if >0]  Hooks  🧠pct  💾RAM (glyph-only
  // for the last two so the row reads lighter and doesn't repeat "Memory RAM").
  const swarmInd = coordinationActive ? c.brightGreen + '◉' + c.reset + ' ' : c.dim + '○' + c.reset + ' ';
  const runtimeParts = [
    c.cyan + 'Swarm ' + swarmInd + agentsColor + activeAgents + c.reset + '/' + c.brightWhite + maxAgents + c.reset,
  ];
  if (subAgents > 0) runtimeParts.push(c.brightPurple + '👥 ' + subAgents + c.reset);
  runtimeParts.push(c.cyan + 'Hooks ' + hooksColor + hooksEnabled + c.reset + '/' + c.brightWhite + hooksTotal + c.reset);
  runtimeParts.push(intellColor + '🧠 ' + intelligencePct + '%' + c.reset);
  runtimeParts.push(c.brightCyan + '💾 ' + memoryMB + 'MB' + c.reset);
  lines.push(c.brightYellow + '🤖 Runtime' + c.reset + '        ' + runtimeParts.join('   '));

  // Row 3 — Health: color-first, urgency-tuned copy.
  //   clean   → "✓ Security   ✓ No CVEs" (or just "✓" when nothing to certify)
  //   pending → "Security scan pending"
  //   problem → "N vulnerabilities" — never "CVE checks 0/3" (reads ambiguously)
  const secLower = secStatus.toLowerCase();
  const cvesClean = totalCves === 0 || cvesFixed === totalCves;
  const healthAllGreen = (secStatus === 'CLEAN' || secStatus === 'NONE') && cvesClean;
  const healthParts = [];
  if (healthAllGreen) {
    if (secStatus === 'CLEAN') healthParts.push(c.brightGreen + '✓ Security' + c.reset);
    if (totalCves > 0) healthParts.push(c.brightGreen + '✓ No CVEs' + c.reset);
    if (healthParts.length === 0) healthParts.push(c.brightGreen + '✓' + c.reset);
  } else {
    if (secStatus === 'PENDING') {
      healthParts.push(c.brightYellow + 'Security scan pending' + c.reset);
    } else if (secStatus === 'IN_PROGRESS') {
      healthParts.push(c.brightYellow + 'Security scanning…' + c.reset);
    } else if (secStatus === 'STALE') {
      healthParts.push(c.brightYellow + 'Security scan stale' + c.reset);
    } else if (secStatus !== 'NONE' && secStatus !== 'CLEAN') {
      healthParts.push(c.brightRed + 'Security ' + secLower + c.reset);
    }
    if (totalCves > 0 && cvesFixed < totalCves) {
      const unfixed = totalCves - cvesFixed;
      const word = unfixed === 1 ? 'vulnerability' : 'vulnerabilities';
      healthParts.push(c.brightRed + unfixed + ' ' + word + c.reset);
    }
  }
  if (healthParts.length > 0) {
    lines.push(c.brightRed + '🛡 Health' + c.reset + '         ' + healthParts.join('   '));
  }

  // Row 4 — AgentDB: size + vectors + MCP status. No opaque "◆ DB" marker;
  // the row header itself already says AgentDB.
  const dbParts = [];
  if (dbSizeKB > 0) dbParts.push(c.brightWhite + sizeDisp + c.reset);
  if (vectorCount > 0) {
    const hnswInd = hasHnsw ? c.brightGreen + '⚡' + c.reset : '';
    dbParts.push(c.cyan + vectorCount + ' vectors' + c.reset + hnswInd);
  }
  if (mcpServers.total > 0) {
    if (mcpServers.enabled === mcpServers.total) {
      dbParts.push(c.brightGreen + 'MCP ready' + c.reset);
    } else {
      const mcpCol = mcpServers.enabled > 0 ? c.brightYellow : c.red;
      dbParts.push(c.cyan + 'MCP ' + mcpCol + mcpServers.enabled + c.reset + '/' + c.brightWhite + mcpServers.total + c.reset);
    }
  }
  if (dbParts.length > 0) {
    lines.push(c.brightCyan + '🧠 AgentDB' + c.reset + '        ' + dbParts.join('   '));
  }

  // Bottom row: funnel promo/tips surface (ADR-301). All policy gates
  // (RUFLO_FUNNEL, enterprise policy, funnel.enabled, CI, disclosure,
  // 4:1 content ratio) run in the CLI that produced d.promo; this renderer
  // re-applies the cheap ones as defense-in-depth because the delegated
  // JSON passes through a tmp cache. Static text only — never animated.
  const promoRow = getPromoRow(d);
  if (promoRow) {
    // Color the row by content kind so it reads as *what it is*, not as noise:
    //   disclosure  → brightCyan  (announcement, one-time-ish, links to capability)
    //   promotional → brightPurple (Cognitum sponsor spot, distinct from tips)
    //   educational → yellow      (a tip — same tone as the RAM segment icons)
    const kind = (d && d.promo && d.promo.kind) || 'disclosure';
    const promoColor = kind === 'promotional' ? c.brightPurple
                     : kind === 'educational' ? c.yellow
                     : c.brightCyan;
    lines.push(promoColor + promoRow + c.reset);
  }

  return lines.join('\\n');
}

// ─── Funnel promo row (ADR-301) ─────────────────────────────────
// Allowlist for OSC 8 hyperlink targets. Ships in code (not in payload) so
// no message can smuggle a link to an unapproved host.
const PROMO_LINK_HOSTS = new Set(['cognitum.one', 'www.cognitum.one', 'docs.cognitum.one']);

// Emit OSC 8 hyperlinks unless the environment is known-broken. tmux mangles
// raw OSC 8 (see anthropics/claude-code#27047) — opt in via env if wrapped.
function terminalSupportsHyperlinks() {
  if (process.env.CI || process.env.GITHUB_ACTIONS) return false;
  if (process.env.TERM === 'dumb') return false;
  if (/^(0|false|off|no)$/i.test(String(process.env.RUFLO_STATUSLINE_HYPERLINKS || ''))) return false;
  if (process.env.TMUX && !process.env.RUFLO_STATUSLINE_HYPERLINKS_TMUX) return false;
  return true;
}

// Wrap a label in an OSC 8 hyperlink escape sequence. Falls back to the raw
// label whenever the URL is not an allowlisted https target, when the terminal
// can't render hyperlinks, or when parsing fails — a broken link must never
// leave a raw URL or stray escape in the statusline output.
function safeTerminalLink(label, url) {
  if (!terminalSupportsHyperlinks()) return label;
  if (typeof url !== 'string' || url.length === 0) return label;
  let parsed;
  try { parsed = new URL(url); } catch { return label; }
  if (parsed.protocol !== 'https:') return label;
  if (!PROMO_LINK_HOSTS.has(parsed.hostname)) return label;
  const cleanLabel = String(label).replace(/[\\u0000-\\u001f\\u007f-\\u009f\\u202a-\\u202e\\u2066-\\u2069]/g, '');
  if (cleanLabel.length === 0) return label;
  const ESC = '\\u001b';
  return ESC + ']8;;' + parsed.href + ESC + '\\\\' + cleanLabel + ESC + ']8;;' + ESC + '\\\\';
}

function getPromoRow(d) {
  try {
    if (process.env.CI || process.env.GITHUB_ACTIONS) return null;
    if (/^(0|false|off|no)$/i.test(String(process.env.RUFLO_FUNNEL || ''))) return null;
    const promo = d && d.promo;
    if (!promo || typeof promo.text !== 'string') return null;
    // Strip control chars / ANSI / bidi overrides and hard-cap length —
    // promo copy is data and must never emit its own terminal sequences.
    const text = promo.text
      .replace(/[\\u0000-\\u001f\\u007f-\\u009f\\u202a-\\u202e\\u2066-\\u2069]/g, '')
      .slice(0, 100)
      .trim();
    if (text.length === 0) return null;
    // If the payload carries an allowlisted https URL, wrap the visible text
    // in an OSC 8 hyperlink so the label is clickable without exposing the
    // URL. Disclosure/educational rows have no URL and pass through as-is.
    return safeTerminalLink(text, promo.url);
  } catch (e) {
    return null; // the promo row must never break the statusline
  }
}

// JSON output — delegates to CLI for accuracy; caller can use --json flag
function generateJSON() {
  const d = getStatuslineData();
  const git = getGitInfo();
  return Object.assign({}, d, {
    user: Object.assign({ name: git.name, gitBranch: git.gitBranch }, d.user || {}),
    git: { modified: git.modified, untracked: git.untracked, staged: git.staged, ahead: git.ahead, behind: git.behind },
    lastUpdated: new Date().toISOString(),
  });
}

// ─── Main ───────────────────────────────────────────────────────
if (process.argv.includes('--json')) {
  console.log(JSON.stringify(generateJSON(), null, 2));
} else if (process.argv.includes('--compact')) {
  console.log(JSON.stringify(generateJSON()));
} else {
  console.log(generateStatusline());
}
`;
}

/**
 * Generate statusline hook for shell integration
 */
export function generateStatuslineHook(options: InitOptions): string {
  if (!options.statusline.enabled) {
    return '#!/bin/bash\n# Statusline disabled\n';
  }

  return `#!/bin/bash
# RuFlo V3 Statusline Hook
# Source this in your .bashrc/.zshrc for terminal statusline

# Function to get statusline
claude_flow_statusline() {
  local statusline_script="\${CLAUDE_FLOW_DIR:-.claude}/helpers/statusline.cjs"
  if [ -f "$statusline_script" ]; then
    node "$statusline_script" 2>/dev/null || echo ""
  fi
}

# Bash: Add to PS1
# export PS1='$(claude_flow_statusline) \\n\\$ '

# Zsh: Add to RPROMPT
# export RPROMPT='$(claude_flow_statusline)'

# Claude Code: Add to .claude/settings.json
# "statusLine": {
#   "type": "command",
#   "command": "node .claude/helpers/statusline.cjs 2>/dev/null"
#   "when": "test -f .claude/helpers/statusline.cjs"
# }
`;
}
