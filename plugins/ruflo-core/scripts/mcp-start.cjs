#!/usr/bin/env node
'use strict';

// mcp-start.cjs — resolve which @claude-flow/cli build backs ruflo-core's MCP
// server, then run it with inherited stdio.
//
// Invoked from .mcp.json via the #2721 node bootstrap (see hooks.json):
//   node -e "require(require('path').join(process.env.CLAUDE_PLUGIN_ROOT,'scripts','mcp-start.cjs'))"
// That keeps the exact same command string cross-platform (no bash/sh/cmd, no
// jq, no `${VAR}`/`%VAR%` shell expansion — CLAUDE_PLUGIN_ROOT is resolved
// inside Node), so Windows works too.
//
// Why a wrapper: the MCP server is a long-lived writer against the shared
// `.swarm/memory.db`. On a host running a locally patched CLI build, starting
// the registry build (`npx @claude-flow/cli@latest`) reintroduces an unsafe
// whole-image writer against that same DB. This wrapper honours a pin so the
// daemon runs the intended build.
//
// Resolution order (matches ruflo-cost-tracker/scripts/_npx.mjs resolveCli;
// a pinned bin always wins):
//   a. RUFLO_CLI_BIN                        — abs path to a cli.js / executable
//   b. <cwd>/.claude-flow/cli-pin.json .bin — parsed with JSON.parse (no jq).
//      A pin is NOT a permanent fork: when the pin carries an
//      `expiresWhenRegistryHas` semver floor and the registry is known to have
//      reached it, the pin self-expires and resolution returns to the registry
//      (source 'pin-expired'). The registry version comes from a local cache
//      refreshed OPPORTUNISTICALLY in the background — never blocks startup, no
//      network on the hot path.
//   c. npx -y @claude-flow/cli@latest       — registry fallback (+ stderr WARN)
//
// CRITICAL: the MCP server speaks JSON-RPC over STDOUT. This wrapper writes
// NOTHING to stdout — diagnostics go to stderr — and spawns the CLI with
// stdio:'inherit', so the child owns fds 0/1/2 directly (no interposition on
// the protocol). The bare invocation and the CLAUDE_FLOW_MCP_TRANSPORT=stdio
// env from .mcp.json are preserved (no subcommand is injected).

const { spawn, spawnSync } = require('child_process');
const { accessSync, constants, existsSync, readFileSync } = require('fs');
const { dirname, join } = require('path');

const REGISTRY_VERSION_TTL_MS = 24 * 60 * 60 * 1000;

function parseSemverTriple(v) {
  const m = /^(\d+)\.(\d+)\.(\d+)/.exec(String(v == null ? '' : v).trim());
  return m ? [Number(m[1]), Number(m[2]), Number(m[3])] : null;
}

function semverGte(a, b) {
  const pa = parseSemverTriple(a);
  const pb = parseSemverTriple(b);
  if (!pa || !pb) return false;
  for (let i = 0; i < 3; i++) {
    if (pa[i] > pb[i]) return true;
    if (pa[i] < pb[i]) return false;
  }
  return true;
}

// Last-known registry version of @claude-flow/cli, from a cache file refreshed
// in the background at most once per TTL. Decisions use the cached value only —
// starting the server never waits on the network.
//
// A STALE (>TTL) cached version still decides expiry, deliberately: registry
// versions are monotonic, so a cache that ever truthfully recorded
// registry >= floor implies the live registry is also >= floor. Staleness can
// only delay an expiry (unknown → pin holds), never trigger one prematurely.
function cachedRegistryVersion(cwd) {
  const cachePath = join(cwd, '.claude-flow', 'registry-version.json');
  let cached = null;
  try {
    cached = JSON.parse(readFileSync(cachePath, 'utf-8'));
  } catch { /* absent or malformed — treat as unknown */ }

  const fresh = cached && typeof cached.version === 'string'
    && typeof cached.checkedAt === 'number'
    && Date.now() - cached.checkedAt < REGISTRY_VERSION_TTL_MS;

  if (!fresh) {
    // Fire-and-forget refresh; unref'd so this process exits freely. The NEXT
    // startup sees the refreshed value.
    try {
      const probe = spawn(process.execPath, ['-e', `
        const { execFileSync } = require('node:child_process');
        const fs = require('node:fs');
        try {
          const v = execFileSync('npm', ['view', '@claude-flow/cli', 'version'], { encoding: 'utf-8', timeout: 20000 }).trim();
          if (/^\\d+\\.\\d+\\.\\d+/.test(v)) {
            fs.mkdirSync(${JSON.stringify(join(cwd, '.claude-flow'))}, { recursive: true });
            fs.writeFileSync(${JSON.stringify(cachePath)}, JSON.stringify({ version: v, checkedAt: Date.now() }));
          }
        } catch { /* offline — keep the stale cache */ }
      `], { detached: true, stdio: 'ignore' });
      probe.unref();
    } catch { /* spawn unavailable — decisions keep using the stale cache */ }
  }

  return cached && typeof cached.version === 'string' ? cached.version : null;
}

// A .js/.cjs/.mjs entrypoint runs through node (a shebang is not honoured on
// win32); a non-.js executable is run directly.
function binInvocation(bin) {
  if (/\.[cm]?js$/i.test(bin)) return { cmd: process.execPath, prefix: [bin] };
  try {
    accessSync(bin, constants.X_OK);
    return { cmd: bin, prefix: [] };
  } catch {
    return { cmd: process.execPath, prefix: [bin] };
  }
}

function resolveCli() {
  const cwd = process.cwd();
  const envBin = process.env.RUFLO_CLI_BIN;
  if (envBin && existsSync(envBin)) {
    return { mode: 'bin', bin: envBin, source: 'env' };
  }
  const pinPath = join(cwd, '.claude-flow', 'cli-pin.json');
  if (existsSync(pinPath)) {
    try {
      const pin = JSON.parse(readFileSync(pinPath, 'utf-8'));
      if (pin && typeof pin.bin === 'string' && existsSync(pin.bin)) {
        // Self-expiry: once the registry demonstrably carries the fix floor,
        // the pin steps aside and upstream tracking resumes.
        if (typeof pin.expiresWhenRegistryHas === 'string') {
          const registryVersion = cachedRegistryVersion(cwd);
          if (registryVersion && semverGte(registryVersion, pin.expiresWhenRegistryHas)) {
            return {
              mode: 'registry', source: 'pin-expired',
              expiredBy: `registry ${registryVersion} >= floor ${pin.expiresWhenRegistryHas}`,
            };
          }
        }
        return { mode: 'bin', bin: pin.bin, source: 'pin' };
      }
    } catch {
      // A malformed pin file must not stop the server from starting — fall
      // through to the registry path (which also warns).
    }
  }
  return { mode: 'registry', source: 'registry' };
}

// Forwarded args differ by launch mode:
//   node -e "require(this)" [args]  -> process.argv = [node, ...args]
//   node mcp-start.cjs [args]       -> process.argv = [node, __filename, ...args]
// The .mcp.json bootstrap forwards none (bare invocation); this stays robust if
// args are ever added.
const tail = process.argv.slice(1);
const forwarded = tail[0] === __filename ? tail.slice(1) : tail;

const resolved = resolveCli();

let cmd;
let args;
if (resolved.mode === 'bin') {
  const inv = binInvocation(resolved.bin);
  cmd = inv.cmd;
  args = [...inv.prefix, ...forwarded];
} else {
  process.stderr.write(
    '[ruflo] MCP server using unpinned registry CLI (@claude-flow/cli@latest); ' +
    'create .claude-flow/cli-pin.json or set RUFLO_CLI_BIN to pin a local build\n',
  );
  if (process.platform === 'win32') {
    // Windows npm exposes npx through a .cmd shim; invoke npm's JS entry point
    // so no shell is required.
    const npxCli = join(dirname(process.execPath), 'node_modules', 'npm', 'bin', 'npx-cli.js');
    cmd = process.execPath;
    args = [npxCli, '-y', '@claude-flow/cli@latest', ...forwarded];
  } else {
    cmd = 'npx';
    args = ['-y', '@claude-flow/cli@latest', ...forwarded];
  }
}

const child = spawnSync(cmd, args, { stdio: 'inherit', shell: false });
if (child.error) {
  process.stderr.write(`[ruflo] failed to start MCP server CLI: ${child.error.message}\n`);
  process.exit(1);
}
process.exit(child.status === null ? 1 : child.status);
