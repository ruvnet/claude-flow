#!/usr/bin/env node
/**
 * ruflo-hook.cjs — cross-platform Node.js port of ruflo-hook.sh (#2132)
 *
 * The bash shim (ruflo-hook.sh) works on Mac/Linux but fails on native
 * Windows (exit 126 — "cannot execute binary file"). This .cjs shim
 * provides identical behaviour via Node.js child_process so Windows users
 * get working hooks without WSL or Git Bash.
 *
 * Mac/Linux continue to use ruflo-hook.sh via the plugin hooks.json files
 * (unchanged). On Windows, ruflo init writes a .claude/settings.json that
 * overrides those entries with node-based equivalents pointing here.
 *
 * Behaviour mirrors ruflo-hook.sh:
 *   1. Reads hook JSON payload from stdin.
 *   2. Prefers a locally installed `ruflo` or `claude-flow` binary.
 *   3. Falls back to `npx --prefer-offline ruflo@latest`.
 *   4. Always exits 0 — hook subcommands are best-effort telemetry.
 *   5. Swallows all stderr — nothing should surface to Claude Code.
 *
 * Usage: node ruflo-hook.cjs <hook-subcommand> [args...]
 *   e.g. node ruflo-hook.cjs post-edit --file "x.ts" --train-patterns
 */

'use strict';

const { spawnSync } = require('child_process');
const fs = require('fs');
const path = require('path');

/** Exit 0 unconditionally — hooks must never block a turn */
function done() {
  process.exit(0);
}

/** Resolve stdin to a JSON object, or null if not parseable */
function readStdinJson() {
  try {
    let buf = '';
    // Read synchronously — hooks fire synchronously in Claude Code
    const fd = fs.openSync('/dev/stdin', 'r');
    const chunk = Buffer.alloc(64 * 1024);
    let bytesRead;
    while ((bytesRead = fs.readSync(fd, chunk, 0, chunk.length, null)) > 0) {
      buf += chunk.slice(0, bytesRead).toString('utf8');
    }
    fs.closeSync(fd);
    return buf.trim() ? JSON.parse(buf) : null;
  } catch {
    return null;
  }
}

/** Read stdin via process.stdin in sync mode (Windows-safe alternative) */
function readStdinSync() {
  try {
    // On Windows /dev/stdin doesn't exist; use fd 0 directly
    const chunk = Buffer.alloc(64 * 1024);
    let buf = '';
    let bytesRead;
    while (true) {
      try {
        bytesRead = fs.readSync(0 /* STDIN_FILENO */, chunk, 0, chunk.length, null);
        if (bytesRead === 0) break;
        buf += chunk.slice(0, bytesRead).toString('utf8');
      } catch {
        break;
      }
    }
    return buf.trim() ? JSON.parse(buf) : null;
  } catch {
    return null;
  }
}

/** Case-insensitive env lookup — Windows env keys are not case-stable. */
function envValue(env, name) {
  const key = Object.keys(env).find((c) => c.toLowerCase() === name.toLowerCase());
  return key ? env[key] : undefined;
}

/**
 * Where the npx fallback resolves ruflo from: the plugin's data dir or the
 * user's home, never the cwd (the opened project). `--prefix` only changes
 * package resolution; the CLI still runs with the project as its cwd.
 */
function npxPrefix(env = process.env) {
  return envValue(env, 'CLAUDE_PLUGIN_DATA') || envValue(env, 'PLUGIN_DATA') || require('os').homedir();
}

/**
 * Locate a command on PATH using fs only.
 *
 * Deliberately NOT `execSync('where ...')` / `command -v`: that spawns a
 * shell on every hook invocation, which is both the thing this file is
 * trying to get away from and a per-turn cost. Taking `env` and `platform`
 * as arguments is what lets the Windows branch be exercised from a
 * Linux/macOS CI run — see the Windows argv tests.
 */
function resolveCommandPath(command, env = process.env, platform = process.platform) {
  const hasSeparator = command.includes('/') || command.includes('\\');
  const dirs = hasSeparator
    ? ['']
    : (envValue(env, 'PATH') || '').split(platform === 'win32' ? ';' : path.delimiter);
  const hasExtension = path.extname(command) !== '';
  const extensions = platform === 'win32' && !(hasSeparator && hasExtension)
    ? (envValue(env, 'PATHEXT') || '.COM;.EXE;.BAT;.CMD').split(';')
    : [''];
  for (const dir of dirs) {
    // A relative or empty PATH entry resolves against the cwd, i.e. the
    // opened project; never resolve the CLI from there.
    if (!hasSeparator && !(platform === 'win32' ? path.win32 : path.posix).isAbsolute(dir)) continue;
    for (const ext of extensions) {
      const base = path.resolve(dir || '.', command);
      const candidates = ext
        ? [base + ext.toLowerCase(), base + ext.toUpperCase()]
        : [base];
      for (const file of candidates) {
        try {
          fs.accessSync(file, platform === 'win32' ? fs.constants.F_OK : fs.constants.X_OK);
          if (fs.statSync(file).isFile()) return file;
        } catch { /* keep searching */ }
      }
    }
  }
  return null;
}

/**
 * Map an npm-generated Windows shim (ruflo.cmd / npx.cmd / …) to the .js
 * entrypoint it would have run, so it can be executed as `node <entry>`
 * with no shell.
 *
 * Handles both npm layouts: a global prefix (`<prefix>/ruflo.cmd` beside
 * `<prefix>/node_modules/ruflo`) and a local one (`node_modules/.bin/ruflo.cmd`
 * beside `node_modules/ruflo`). `npx` lives in the `npm` package, hence the
 * command→package mapping rather than assuming they match.
 *
 * The entrypoint comes from the package's own `bin` field, never a guessed
 * filename, and is required to resolve inside the package directory — a
 * manifest pointing outside it is refused rather than followed.
 */
function resolveNpmShim(shimPath) {
  const command = path.basename(shimPath, path.extname(shimPath)).toLowerCase();
  const packageName = command === 'npx' ? 'npm' : command;
  if (!['ruflo', 'claude-flow', 'npm'].includes(packageName)) return null;
  try {
    const shimDir = path.dirname(shimPath);
    const packageDir = path.basename(shimDir).toLowerCase() === '.bin'
      ? path.resolve(shimDir, '..', packageName)
      : path.resolve(shimDir, 'node_modules', packageName);
    const manifest = JSON.parse(fs.readFileSync(path.join(packageDir, 'package.json'), 'utf8'));
    const declared = typeof manifest.bin === 'string' ? manifest.bin : manifest.bin?.[command];
    if (typeof declared !== 'string') return null;
    const canonicalPackageDir = fs.realpathSync(packageDir);
    const canonicalEntry = fs.realpathSync(path.resolve(packageDir, declared));
    const relativeEntry = path.relative(canonicalPackageDir, canonicalEntry);
    if (relativeEntry.startsWith('..' + path.sep) || path.isAbsolute(relativeEntry)) return null;
    if (!fs.statSync(canonicalEntry).isFile()) return null;
    return { command: process.execPath, args: [canonicalEntry] };
  } catch { return null; }
}

/**
 * Decide how to run `bin` without a shell. Returns {command, args}, or null
 * when no shell-free invocation could be identified (Windows shim that is
 * not an npm package entry) — the caller then falls back to the escaped
 * cmd.exe path rather than dropping the hook.
 */
function resolveInvocation(bin, binArgs, options = {}) {
  const env = options.env || process.env;
  const platform = options.platform || process.platform;
  const commandPath = resolveCommandPath(bin, env, platform);
  if (!commandPath) return null;
  if (platform === 'win32' && /\.(?:cmd|bat|ps1)$/i.test(commandPath)) {
    const npmBin = resolveNpmShim(commandPath);
    return npmBin ? { command: npmBin.command, args: [...npmBin.args, ...binArgs] } : null;
  }
  return { command: commandPath, args: binArgs };
}

/**
 * Escape one argv element so it survives BOTH parsers a Windows shell:true
 * spawn puts it through before the target CLI ever sees it:
 *   1. cmd.exe's own line tokenizer, which still scans for & | < > ^ % ! " ( )
 *      even inside a per-argument quoted segment — quoting alone does not
 *      shield cmd.exe metacharacters, and this runs a SECOND time when the
 *      resolved binary is itself a .cmd shim (npm's `ruflo`/`claude-flow`/
 *      `npx` global installs on Windows), because launching a .cmd file is
 *      cmd.exe re-invoking itself on the command line.
 *   2. The eventual CommandLineToArgvW argv parse in the target process,
 *      which needs backslash-before-quote sequences doubled and the value
 *      quoted so it lands as ONE argument.
 * Without this, a hook-derived value (e.g. a Bash tool's `command`, or a
 * file path) containing a shell metacharacter can be reinterpreted as a
 * separate command / redirection instead of reaching the CLI as literal
 * data — this is the class of bug in CVE-2024-27980 (Node's own .bat/.cmd
 * argument-injection advisory). Algorithm: https://qntm.org/cmd, the same
 * reference the `cross-spawn` package's Windows escaping is built from.
 *
 * Byte-identical to plugins/ruflo-core/scripts/ruflo-hook.cjs so the four
 * copies can be diffed against each other. This is the fallback, not the
 * primary defence: resolveInvocation() above is preferred because it removes
 * cmd.exe from the chain entirely rather than out-guessing its tokenizer.
 */
function escapeCmdArg(arg) {
  let s = String(arg);
  s = s.replace(/(\\*)"/g, '$1$1\\"').replace(/(\\*)$/, '$1$1');
  s = `"${s}"`;
  return s.replace(/[()%!^"<>&|;,]/g, '^$&');
}

/** Build the argv for the ruflo/claude-flow/npx invocation */
function buildArgs(subcommand, extraArgs) {
  // The `hooks` word is prepended here, matching ruflo-hook.sh convention.
  return ['hooks', subcommand, ...extraArgs];
}

/**
 * Spawn the CLI with the hook subcommand.
 * Passes the raw stdin payload as the child's stdin so the CLI can read
 * the hook event JSON if needed (same as the bash pipe).
 *
 * Returns true on success (exit 0), false otherwise.
 */
function invokeHook(bin, binArgs, hookArgs, stdinData, options = {}) {
  const env = options.env || process.env;
  const platform = options.platform || process.platform;
  const spawnOpts = {
    input: stdinData || '',
    encoding: 'utf8',
    stdio: ['pipe', 'ignore', 'ignore'],
    timeout: 30_000,
    env,
  };

  // Layer 1: no shell. CreateProcess/execve receives the argv array
  // verbatim, so nothing in it can be reinterpreted as syntax.
  const invocation = resolveInvocation(bin, binArgs, { env, platform });
  if (invocation) {
    const result = spawnSync(invocation.command, [...invocation.args, ...hookArgs], {
      ...spawnOpts,
      shell: false,
    });
    return result.status === 0;
  }

  // Layer 2: Windows shim we could not map to an entrypoint. cmd.exe is
  // unavoidable here (CreateProcess cannot launch a .cmd, and Node has
  // refused to since CVE-2024-27980), so every element is escaped. Losing
  // the hook entirely would be the wrong trade — telemetry is best-effort,
  // but silently doing nothing hides breakage.
  const useShell = platform === 'win32';
  const args = [...binArgs, ...hookArgs];
  const result = spawnSync(
    useShell ? escapeCmdArg(bin) : bin,
    useShell ? args.map(escapeCmdArg) : args,
    { ...spawnOpts, shell: useShell },
  );
  return result.status === 0;
}

function main() {
  const args = process.argv.slice(2);
  if (args.length === 0) {
    // No subcommand — no-op, same as bash version
    done();
  }

  const [subcommand, ...rest] = args;

  // Read stdin (the hook event payload) — best effort
  let stdinData = '';
  try {
    stdinData = fs.readFileSync(0 /* fd 0 = stdin */, 'utf8');
  } catch {
    // stdin may not be available when invoked directly for testing
    stdinData = '';
  }

  const hookArgs = buildArgs(subcommand, rest);

  // Priority 1: locally installed ruflo binary
  if (resolveCommandPath('ruflo')) {
    invokeHook('ruflo', [], hookArgs, stdinData);
    done();
  }

  // Priority 2: locally installed claude-flow binary
  if (resolveCommandPath('claude-flow')) {
    invokeHook('claude-flow', [], hookArgs, stdinData);
    done();
  }

  // Priority 3: npx --prefer-offline fallback (avoids cold registry resolve).
  //
  // SKIP this when RUFLO_HOOK_SKIP_NPX=1 — used by CI smokes that test
  // the shim's *control flow* without exercising npm install network paths.
  // Without the skip, npx can take 30+s on a cold runner (no warm cache,
  // no offline tarball), exceeding the smoke's 15s timeout and producing
  // a spurious failure even though the shim itself works correctly.
  // The bash version doesn't hit this because it backgrounded the work.
  if (process.env.RUFLO_HOOK_SKIP_NPX !== '1') {
    invokeHook('npx', ['--prefer-offline', '--yes', '--prefix', npxPrefix(), 'ruflo@latest'], hookArgs, stdinData);
  }

  done();
}

// Test seam: the Windows argv suite require()s this file to drive resolveInvocation()
// and invokeHook() with a simulated { platform: 'win32', env } — which is how
// the Windows branch is proved from a Linux/macOS CI run. hooks.json always
// invokes this file directly, so main() runs unconditionally otherwise.
if (!globalThis.__RUFLO_HOOK_IMPORT_ONLY__) main();

module.exports = { invokeHook, npxPrefix, resolveCommandPath, resolveInvocation, resolveNpmShim, escapeCmdArg };
