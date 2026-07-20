// cli-resolve.mjs — writer-ownership pinning for ruflo-adr's memory operations.
//
// import.mjs and reindex.mjs shell out to the @claude-flow/cli for memory
// store/purge/list against the shared SQLite DB. On a host running a locally
// patched CLI build, spawning the registry build (`npx @claude-flow/cli@latest`)
// reintroduces an unsafe whole-image writer against that same DB. This module
// resolves which build a memory op should use, using the SAME convention as
// ruflo-cost-tracker/scripts/_npx.mjs (the modules are duplicated because
// plugins ship as independent packages and cannot import across each other).
//
// Resolution order (a pinned bin ALWAYS wins over the CLI_CORE lite path):
//   a. env RUFLO_CLI_BIN — abs path to a cli.js / executable; used if it exists.
//   b. <cwd>/.claude-flow/cli-pin.json — { "bin", "reason", "pinnedAt",
//      "expiresWhenRegistryHas" }; used if it parses and `bin` exists. For these
//      scripts cwd is ADR_ROOT, which is also the DB root (#2666), so the pin
//      and the DB stay in agreement. A pin is NOT a permanent fork: when
//      `expiresWhenRegistryHas` (a semver floor, e.g. "3.33.0") is set and the
//      registry is known to have reached it, the pin self-expires and resolution
//      returns to the registry — upstream tracking resumes automatically the
//      release the fixes ship. The registry version is read from a local cache
//      refreshed OPPORTUNISTICALLY in the background (never blocks a hook, no
//      network on the hot path).
//   c. registry fallback — npx -y <pkg> (@claude-flow/cli-core@alpha when
//      CLI_CORE=1 else @claude-flow/cli@latest) + a single stderr WARN.

import { spawn, spawnSync } from 'node:child_process';
import { accessSync, constants, existsSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';

function spawnNpxSync(args, options = {}) {
  const npxArgs = args[0] === '-y' ? args : ['-y', ...args];
  const { shell: _ignoredShell, ...safeOptions } = options;
  if (process.platform === 'win32') {
    const npxCli = join(dirname(process.execPath), 'node_modules', 'npm', 'bin', 'npx-cli.js');
    return spawnSync(process.execPath, [npxCli, ...npxArgs], { ...safeOptions, shell: false });
  }
  return spawnSync('npx', npxArgs, { ...safeOptions, shell: false });
}

const REGISTRY_VERSION_TTL_MS = 24 * 60 * 60 * 1000;

function parseSemverTriple(v) {
  const m = /^(\d+)\.(\d+)\.(\d+)/.exec(String(v ?? '').trim());
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

// Last-known registry version of @claude-flow/cli, from a cache file the
// resolver refreshes in the background at most once per TTL. Decisions use
// the cached value only — a hook fire never waits on the network.
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
    // Fire-and-forget refresh; unref'd so a short-lived hook process exits
    // freely. The NEXT resolution sees the refreshed value.
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

export function resolveCli({ cwd = process.cwd(), cliCore = process.env.CLI_CORE === '1' } = {}) {
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
            const pkg = cliCore ? '@claude-flow/cli-core@alpha' : '@claude-flow/cli@latest';
            return {
              mode: 'registry', pkg, source: 'pin-expired',
              expiredBy: `registry ${registryVersion} >= floor ${pin.expiresWhenRegistryHas}`,
            };
          }
        }
        return { mode: 'bin', bin: pin.bin, source: 'pin', reason: pin.reason };
      }
    } catch {
      // A malformed pin file must not abort a reindex — fall through to registry.
    }
  }

  const pkg = cliCore ? '@claude-flow/cli-core@alpha' : '@claude-flow/cli@latest';
  return { mode: 'registry', pkg, source: 'registry' };
}

function binInvocation(bin) {
  if (/\.[cm]?js$/i.test(bin)) return { cmd: process.execPath, prefix: [bin] };
  try {
    accessSync(bin, constants.X_OK);
    return { cmd: bin, prefix: [] };
  } catch {
    return { cmd: process.execPath, prefix: [bin] };
  }
}

let warnedUnpinned = false;

// Spawn a @claude-flow/cli subcommand against the resolved build. `cliArgs` is
// the subcommand + flags only; the package/binary is chosen by resolveCli.
// `cwd` governs pin-file lookup AND the subprocess cwd (the CLI resolves its
// .swarm/memory.db relative to its own cwd — #2666).
export function spawnCliSync(cliArgs, options = {}) {
  const {
    cwd = process.cwd(),
    cliCore = process.env.CLI_CORE === '1',
    warnLabel = 'memory write',
    shell: _ignoredShell,
    ...rest
  } = options;

  const resolved = resolveCli({ cwd, cliCore });
  const spawnOptions = { ...rest, cwd, shell: false };

  if (resolved.mode === 'bin') {
    const { cmd, prefix } = binInvocation(resolved.bin);
    return spawnSync(cmd, [...prefix, ...cliArgs], spawnOptions);
  }

  if (!warnedUnpinned) {
    warnedUnpinned = true;
    process.stderr.write(
      `[ruflo] ${warnLabel} using unpinned registry CLI (${resolved.pkg}); ` +
      'create .claude-flow/cli-pin.json or set RUFLO_CLI_BIN to pin a local build\n',
    );
  }
  return spawnNpxSync([resolved.pkg, ...cliArgs], spawnOptions);
}
