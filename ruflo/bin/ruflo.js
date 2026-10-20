#!/usr/bin/env node
// Ruflo CLI - thin wrapper around @claude-flow/cli with ruflo branding
import { fileURLToPath, pathToFileURL } from 'node:url';
import { dirname, resolve, join } from 'node:path';
import { existsSync, readFileSync } from 'node:fs';

const __dirname = dirname(fileURLToPath(import.meta.url));

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

// The exact dependency pin prevents mismatches in normal installs. Existing
// partial upgrades can still resolve a different CLI (#3306); make that
// visible on stderr without taking an otherwise working command offline.
let wrapperVersion = '0.0.0';
let cliVersion = 'unknown';
let versionProblem;
try {
  wrapperVersion = JSON.parse(readFileSync(join(__dirname, '..', 'package.json'), 'utf-8')).version;
  cliVersion = JSON.parse(readFileSync(join(cliBase, 'package.json'), 'utf-8')).version;
} catch (error) {
  versionProblem = `cannot verify installed CLI version: ${error.message}`;
}
if (!versionProblem && wrapperVersion !== cliVersion) {
  versionProblem = `wrapper v${wrapperVersion} expects @claude-flow/cli v${wrapperVersion}, but resolved v${cliVersion} at ${cliBase}`;
}
if (versionProblem) {
  console.error(`ruflo: warning: ${versionProblem}; continuing. Reinstall ruflo to restore matching versions.`);
}

// #2256: --version / -V must not trigger heavy CLI/model imports.
if (process.argv.length === 3 && ['--version', '-V'].includes(process.argv[2])) {
  process.stdout.write(`ruflo v${wrapperVersion}\n`);
  process.exit(0);
}

// MCP mode: delegate to cli.js directly (branding irrelevant for JSON-RPC)
const cliArgs = process.argv.slice(2);
const isExplicitMCP = cliArgs.length >= 1 && cliArgs[0] === 'mcp' && (cliArgs.length === 1 || cliArgs[1] === 'start');
const isMCPMode = !process.stdin.isTTY && (process.argv.length === 2 || isExplicitMCP);

if (isMCPMode) {
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
