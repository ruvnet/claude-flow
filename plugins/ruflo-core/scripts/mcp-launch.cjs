#!/usr/bin/env node
'use strict';

/**
 * .mcp.json's command/args are static strings, so they can't run
 * resolution logic inline. This launcher exists to do that work before
 * exec'ing the real server: it resolves a local @claude-flow/cli install
 * and runs its MCP server directly (`<bin>/cli.js mcp start`), falling
 * back to `npx -y @claude-flow/cli@latest mcp start` only when no local
 * install resolves.
 *
 * Without this, plugins/ruflo-core/.mcp.json's `npx -y
 * @claude-flow/cli@latest` always re-resolved to whatever was newest on
 * the registry, independent of — and frequently diverging from — any
 * version a user separately pinned via `npm install @claude-flow/cli`
 * (ADR-382 Gap 3 / issue #2971).
 *
 * The dist/src/index.js existence guard mirrors
 * .claude/helpers/hook-handler.cjs's resolveCliBinForHook(): a
 * marketplace-plugin checkout is installed by `git clone`/`git pull`
 * with no build step, so bin/cli.js can be present on disk while
 * importing dist/src/index.js throws ERR_MODULE_NOT_FOUND on every real
 * command. Checking for dist/ alongside bin/ prevents that doomed
 * candidate from winning ahead of a real local install or the npx
 * fallback. RUFLO_MCP_CLI_OVERRIDE can pin a built bin/cli.js when
 * an install lives outside the standard project or global npm layouts;
 * RUFLO_MCP_SKIP_NPX=1 rejects an unpinned fallback.
 *
 * A resolved local CLI is run in THIS process (argv rewritten to the exact
 * `<node> <bin>/cli.js mcp start` the child used to receive) rather than in
 * a spawned child. The child-process hop cost every Claude Code session a
 * second, otherwise idle node.exe (~21 MB private / ~60 MB working set on
 * Windows) plus a second node startup. Stdio, env, cwd and signals are the
 * same process's, so the server sees an identical environment.
 * RUFLO_MCP_SPAWN=1 restores the old child-process behaviour.
 */

const { existsSync, statSync } = require('fs');
const { join, dirname, resolve, isAbsolute, delimiter, parse } = require('path');
const { spawn } = require('child_process');
const os = require('os');
const { pathToFileURL } = require('url');

const MCP_ARGS = ['mcp', 'start'];

function comparablePath(p) {
  // resolve() normalises separators and drops trailing slashes (except on a root).
  const r = resolve(p);
  return process.platform === 'win32' ? r.toLowerCase() : r;
}

/**
 * A directory that cannot be a project root: a filesystem root ('/', 'C:\')
 * or the user's home directory. Home is compared against os.homedir() as well
 * as $HOME/$USERPROFILE because $HOME is normally unset on Windows, which made
 * a $HOME-only guard a no-op there.
 */
function isNonProjectDir(dir, home, env = process.env) {
  const target = comparablePath(dir);
  if (target === comparablePath(parse(target).root)) return true;
  for (const h of [home, env.HOME, env.USERPROFILE]) {
    if (h && comparablePath(h) === target) return true;
  }
  return false;
}

function isDirectory(dir) {
  try {
    return statSync(dir).isDirectory();
  } catch {
    return false;
  }
}

/**
 * The directory the MCP server should treat as the project. Claude Code
 * exposes the session's project as CLAUDE_PROJECT_DIR; an explicit
 * CLAUDE_FLOW_CWD is honoured next; the launcher's own cwd is the
 * backwards-compatible fallback. Home/root/missing values are skipped so a
 * stale global variable cannot redirect every session into ~/.claude-flow.
 */
function resolveProjectDir(env = process.env, cwd = process.cwd(), home = os.homedir()) {
  for (const candidate of [env.CLAUDE_PROJECT_DIR, env.CLAUDE_FLOW_CWD]) {
    if (!candidate) continue;
    const dir = resolve(cwd, candidate);
    if (isDirectory(dir) && !isNonProjectDir(dir, home, env)) return dir;
  }
  return resolve(cwd);
}

function isRunnableCli(candidate) {
  try {
    const distEntry = join(dirname(candidate), '..', 'dist', 'src', 'index.js');
    return existsSync(candidate) && existsSync(distEntry);
  } catch {
    return false;
  }
}

function resolveLocalCliBin(cwd, home, env = process.env) {
  // An explicit pin must fail closed if it disappears; silently running
  // @latest instead would defeat the override's purpose.
  if (env.RUFLO_MCP_CLI_OVERRIDE) {
    const override = resolve(cwd, env.RUFLO_MCP_CLI_OVERRIDE);
    if (!isRunnableCli(override)) {
      throw new Error(`RUFLO_MCP_CLI_OVERRIDE is not a built @claude-flow/cli bin: ${override}`);
    }
    return override;
  }

  const candidates = [join(home, '.claude', 'plugins', 'marketplaces', 'ruflo', 'bin', 'cli.js')];
  // Node resolves node_modules from the current directory and its ancestors.
  // A literal cwd-only probe misses installs from every nested project dir.
  for (let dir = resolve(cwd); ; dir = dirname(dir)) {
    candidates.push(
      join(dir, 'node_modules', '@claude-flow', 'cli', 'bin', 'cli.js'),
      join(dir, 'node_modules', 'ruflo', 'node_modules', '@claude-flow', 'cli', 'bin', 'cli.js'),
      join(dir, 'node_modules', 'ruflo', 'bin', 'cli.js'),
      join(dir, 'v3', '@claude-flow', 'cli', 'bin', 'cli.js'),
    );
    if (dirname(dir) === dir) break;
  }

  // npm global installs live next to bin/ on POSIX and under the shim
  // directory on Windows. Probe PATH roots without spawning npm or npx.
  for (const binDir of String(env.PATH || env.Path || '').split(delimiter)) {
    if (!isAbsolute(binDir)) continue;
    const modulesDir = process.platform === 'win32'
      ? join(binDir, 'node_modules')
      : join(binDir, '..', 'lib', 'node_modules');
    candidates.push(
      join(modulesDir, '@claude-flow', 'cli', 'bin', 'cli.js'),
      join(modulesDir, 'ruflo', 'node_modules', '@claude-flow', 'cli', 'bin', 'cli.js'),
      join(modulesDir, 'claude-flow', 'node_modules', '@claude-flow', 'cli', 'bin', 'cli.js'),
    );
  }
  for (const candidate of candidates) {
    if (isRunnableCli(candidate)) return candidate;
  }
  return null;
}

function buildLaunchSpec(localBin, env = process.env, projectDir = null) {
  // Start the server *in* the project and say so explicitly: tools built on
  // getProjectCwd() read CLAUDE_FLOW_CWD, tools that call process.cwd() read
  // the spawn cwd. Both must match the folder the CLI writes state to.
  const placement = projectDir
    ? { cwd: projectDir, env: { ...env, CLAUDE_FLOW_CWD: projectDir } }
    : {};
  if (localBin) {
    return { command: process.execPath, args: [localBin, ...MCP_ARGS], shell: false, ...placement };
  }
  if (env.RUFLO_MCP_SKIP_NPX === '1') {
    throw new Error('No built local CLI found and RUFLO_MCP_SKIP_NPX=1 forbids the @latest fallback');
  }
  const npxCmd = process.platform === 'win32' ? 'npx.cmd' : 'npx';
  // Windows .cmd shims aren't directly executable via CreateProcess — they
  // need shell:true (or an explicit cmd.exe /c wrapper) or spawn throws
  // EINVAL/ENOENT. Args here are hardcoded constants, not user input, so
  // shell:true carries no injection risk on this branch.
  return {
    command: npxCmd,
    args: ['-y', '@claude-flow/cli@latest', ...MCP_ARGS],
    shell: process.platform === 'win32',
    ...placement,
  };
}

function runInProcess(localBin, projectDir = null) {
  // Same placement the spawned child got from buildLaunchSpec(): run in the
  // project and advertise it via CLAUDE_FLOW_CWD, before the CLI is imported
  // (it reads both at import/start time).
  if (projectDir) {
    process.chdir(projectDir);
    process.env.CLAUDE_FLOW_CWD = projectDir;
  }
  // Same argv shape the spawned child saw: [node, <bin>/cli.js, 'mcp', 'start'].
  // cli.js decides MCP mode from process.argv and stdin at import time.
  process.argv = [process.execPath, localBin, ...MCP_ARGS];
  return import(pathToFileURL(localBin).href);
}

function launch({ command, args, shell, cwd, env }) {
  const child = spawn(command, args, { stdio: 'inherit', env: env || process.env, shell, cwd });

  // Forward termination signals so Claude Code can stop the MCP server the
  // same way it would if it had spawned the real binary directly.
  const forward = (signal) => child.kill(signal);
  for (const signal of ['SIGINT', 'SIGTERM']) {
    process.on(signal, forward);
  }

  child.on('exit', (code, signal) => {
    if (signal) {
      process.kill(process.pid, signal);
    } else {
      process.exit(code === null ? 1 : code);
    }
  });
  child.on('error', (err) => {
    process.stderr.write(`[mcp-launch] failed to start ${command}: ${err.message}\n`);
    process.exit(1);
  });
}

if (require.main === module) {
  try {
    const home = os.homedir();
    const projectDir = resolveProjectDir(process.env, process.cwd(), home);
    if (isNonProjectDir(projectDir, home)) {
      // stderr only: stdout is the MCP stdio channel.
      process.stderr.write(
        `[mcp-launch] warning: no project directory (session started in ${projectDir}); ` +
        'MCP state will be kept there, not in folders CLI commands run from. ' +
        'Start Claude Code inside the project or set CLAUDE_FLOW_CWD.\n',
      );
    }
    const localBin = resolveLocalCliBin(projectDir, home);
    if (localBin && process.env.RUFLO_MCP_SPAWN !== '1') {
      runInProcess(localBin, projectDir).catch((error) => {
        process.stderr.write(`[mcp-launch] failed to load ${localBin}: ${error && error.message}\n`);
        process.exit(1);
      });
    } else {
      launch(buildLaunchSpec(localBin, process.env, projectDir));
    }
  } catch (error) {
    process.stderr.write(`[mcp-launch] ${error.message}\n`);
    process.exitCode = 1;
  }
}

module.exports = { resolveLocalCliBin, resolveProjectDir, isNonProjectDir, buildLaunchSpec, runInProcess, MCP_ARGS };
