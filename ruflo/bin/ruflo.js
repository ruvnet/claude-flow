#!/usr/bin/env node
// Ruflo CLI - thin wrapper around @claude-flow/cli with ruflo branding
import { fileURLToPath, pathToFileURL } from 'node:url';
import { dirname, resolve, join } from 'node:path';
import { existsSync, readFileSync } from 'node:fs';

const __dirname = dirname(fileURLToPath(import.meta.url));

// #2256 / ADR-170 fast paths: --version / -V and --help / -h must NOT
// trigger heavy imports (the downstream @claude-flow/cli dist eagerly loads
// ruvector + a 23 MB ONNX model on cold cache, blocking 60+ s and causing
// SIGTERM under common timeout windows: npx default, MCP stdio 30s window).
// Guard fires whenever the flag is present and there is NO command word —
// i.e. every argument starts with '-' (so `-V --no-color` is served here,
// but `agent --version` still reaches the real CLI). Resolve version from
// this wrapper's own package.json and exit before any heavy import.
// (bin/cli.js has the same guards for the direct path; needed here too
// because the wrapper imports dist/src/index.js, bypassing bin/cli.js.)
{
  const _argv = process.argv.slice(2);
  const _flagsOnly = _argv.length > 0 && _argv.every((a) => a.startsWith('-'));
  if (_flagsOnly && (_argv.includes('--version') || _argv.includes('-V'))) {
    try {
      const pkg = JSON.parse(readFileSync(join(__dirname, '..', 'package.json'), 'utf-8'));
      process.stdout.write(`ruflo v${pkg.version || '0.0.0'}\n`);
    } catch {
      process.stdout.write('ruflo v0.0.0\n');
    }
    process.exit(0);
  }
  if (_flagsOnly && (_argv.includes('--help') || _argv.includes('-h'))) {
    // ADR-170 Phase 1.3: static help fast path. `<command> --help` still
    // goes through the real CLI (it has a command word, so _flagsOnly is
    // false). KEEP THIS TEXT IN SYNC with the top-level command registry in
    // v3/@claude-flow/cli/src/commands/index.ts (commandLoaders keys) — it
    // is intentionally static so `ruflo --help` needs no node_modules.
    let _v = '0.0.0';
    try {
      _v = JSON.parse(readFileSync(join(__dirname, '..', 'package.json'), 'utf-8')).version || _v;
    } catch { /* best-effort */ }
    process.stdout.write(`ruflo v${_v} — AI Agent Orchestration Platform

USAGE:
  ruflo <command> [subcommand] [options]

CORE COMMANDS:
  init         Initialize RuFlo in the current directory
  start        Start the RuFlo orchestration system
  status       Show system status
  agent        Agent management commands
  swarm        Swarm coordination commands
  memory       Memory management commands
  task         Task management commands
  session      Session management commands
  mcp          MCP server management
  hooks        Self-learning hooks system

MORE COMMANDS:
  config, daemon, doctor, update, plugins, security, neural, performance,
  workflow, hive-mind, providers, deployment, claims, embeddings, migrate,
  completions, verify, analyze, route, progress, issues, ruvector, benchmark,
  guidance, appliance, appliance-advanced, transfer-store, cleanup, autopilot,
  gaia-bench, metaharness, eject, process

OPTIONS:
  -h, --help       Show help (use \`ruflo <command> --help\` for command details)
  -V, --version    Show version
  --no-color       Disable colored output

Run \`ruflo <command> --help\` for detailed usage of a command.
`);
    process.exit(0);
  }
}

// Walk up from ruflo/bin/ to find @claude-flow/cli in node_modules
function findCliPath() {
  let dir = resolve(__dirname, '..');
  for (let i = 0; i < 10; i++) {
    const candidate = join(dir, 'node_modules', '@claude-flow', 'cli', 'bin', 'cli.js');
    if (existsSync(candidate)) return dir;
    const parent = dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  return null;
}

// Convert path to file:// URL for cross-platform ESM import (Windows requires this)
function toImportURL(filePath) {
  return pathToFileURL(filePath).href;
}

const pkgDir = findCliPath();
const cliBase = pkgDir
  ? join(pkgDir, 'node_modules', '@claude-flow', 'cli')
  : resolve(__dirname, '../../v3/@claude-flow/cli');

// MCP mode: delegate to cli.js directly (branding irrelevant for JSON-RPC)
const cliArgs = process.argv.slice(2);
const isExplicitMCP = cliArgs.length >= 1 && cliArgs[0] === 'mcp' && (cliArgs.length === 1 || cliArgs[1] === 'start');
const isMCPMode = !process.stdin.isTTY && (process.argv.length === 2 || isExplicitMCP);

if (isMCPMode) {
  // ADR-170 Phase 1.4: autodetected MCP mode (piped stdin, no args) used to
  // silently absorb the invocation into a stdio server. Emit a one-line
  // stderr notice so piped callers can tell what happened. stderr only —
  // stdout must stay clean for JSON-RPC.
  if (!isExplicitMCP) {
    process.stderr.write('ruflo: no TTY on stdin and no args — starting MCP stdio server (use `ruflo --help` for CLI usage)\n');
  }
  await import(toImportURL(join(cliBase, 'bin', 'cli.js')));
} else {
  // CLI mode: use ruflo branding
  const { CLI } = await import(toImportURL(join(cliBase, 'dist', 'src', 'index.js')));
  const cli = new CLI({
    name: 'ruflo',
    description: 'Ruflo - AI Agent Orchestration Platform',
  });
  cli.run()
    .then(() => {
      // #1641/#1653: Exit cleanly after one-shot commands.
      // HNSW VectorDb, sql.js WASM, and ONNX worker threads keep the
      // event loop alive after the command handler returns.
      process.exit(0);
    })
    .catch((error) => {
      console.error('Fatal error:', error.message);
      process.exit(1);
    });
}
