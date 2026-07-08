/**
 * V3 CLI Doctor Command
 * System diagnostics, dependency checks, config validation
 *
 * Created with ruv.io
 */

import type { Command, CommandContext, CommandResult } from '../types.js';
import { output } from '../output.js';
import { existsSync, readFileSync, statSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import { createHash } from 'crypto';
import { execSync, exec } from 'child_process';
import { promisify } from 'util';
import { decodeKey, isEncryptionEnabled } from '../encryption/vault.js';
import { isEncryptedBlob } from '../encryption/vault.js';
import {
  resolveMemoryPackageFromProject,
  readMemoryPackageVersion,
  recordMemoryPackagePath,
} from '../init/memory-package-resolver.js';

// Promisified exec with proper shell and env inheritance for cross-platform support
const execAsync = promisify(exec);

/**
 * Execute command asynchronously with proper environment inheritance
 * Critical for Windows where PATH may not be inherited properly
 */
async function runCommand(command: string, timeoutMs: number = 5000): Promise<string> {
  const { stdout } = await execAsync(command, {
    encoding: 'utf8' as BufferEncoding,
    timeout: timeoutMs,
    shell: process.platform === 'win32' ? 'cmd.exe' : '/bin/sh', // Use proper shell per platform
    env: { ...process.env }, // Explicitly inherit full environment
    windowsHide: true, // Hide window on Windows
  });
  return (stdout as string).trim();
}

interface HealthCheck {
  name: string;
  status: 'pass' | 'warn' | 'fail';
  message: string;
  fix?: string;
}

// Check Node.js version
async function checkNodeVersion(): Promise<HealthCheck> {
  const requiredMajor = 20;
  const version = process.version;
  const major = parseInt(version.slice(1).split('.')[0], 10);

  if (major >= requiredMajor) {
    return { name: 'Node.js Version', status: 'pass', message: `${version} (>= ${requiredMajor} required)` };
  } else if (major >= 18) {
    return { name: 'Node.js Version', status: 'warn', message: `${version} (>= ${requiredMajor} recommended)`, fix: 'nvm install 20 && nvm use 20' };
  } else {
    return { name: 'Node.js Version', status: 'fail', message: `${version} (>= ${requiredMajor} required)`, fix: 'nvm install 20 && nvm use 20' };
  }
}

// Check npm version (async with proper env inheritance)
async function checkNpmVersion(): Promise<HealthCheck> {
  try {
    const version = await runCommand('npm --version');
    const major = parseInt(version.split('.')[0], 10);
    if (major >= 9) {
      return { name: 'npm Version', status: 'pass', message: `v${version}` };
    } else {
      return { name: 'npm Version', status: 'warn', message: `v${version} (>= 9 recommended)`, fix: 'npm install -g npm@latest' };
    }
  } catch {
    return { name: 'npm Version', status: 'fail', message: 'npm not found', fix: 'Install Node.js from https://nodejs.org' };
  }
}

// Check config file
async function checkConfigFile(): Promise<HealthCheck> {
  // JSON configs (parse-validated). The first three are LEGACY shapes from
  // pre-v3 init flows; v3 init writes only `.claude-flow/config.yaml`.
  const jsonPaths = [
    '.claude-flow/config.json',
    'claude-flow.config.json',
    '.claude-flow.json'
  ];
  // YAML configs (existence-checked only — no heavy yaml parser dependency).
  const yamlPaths = [
    '.claude-flow/config.yaml',
    '.claude-flow/config.yml',
    'claude-flow.config.yaml'
  ];

  // #1798 — collect ALL configs that exist instead of returning at the first
  // hit. The previous early-return masked silent collisions: if both a v2
  // JSON and a v3 YAML existed, doctor reported only the JSON while the
  // daemon was actually reading from the YAML. Surfacing both lets the user
  // see and resolve the disagreement.
  const foundJson: string[] = [];
  const invalidJson: string[] = [];
  for (const configPath of jsonPaths) {
    if (!existsSync(configPath)) continue;
    try {
      JSON.parse(readFileSync(configPath, 'utf8'));
      foundJson.push(configPath);
    } catch {
      invalidJson.push(configPath);
    }
  }
  const foundYaml = yamlPaths.filter(p => existsSync(p));

  // Hard failures first: malformed JSON wins.
  if (invalidJson.length > 0) {
    return { name: 'Config File', status: 'fail', message: `Invalid JSON: ${invalidJson.join(', ')}`, fix: 'Fix JSON syntax in config file' };
  }

  // #1798 — collision: legacy JSON + new YAML both present. Subsystems can
  // disagree on which to read; surface this as a warn with the recommended
  // resolution (keep the YAML, archive the JSON).
  if (foundJson.length > 0 && foundYaml.length > 0) {
    return {
      name: 'Config File',
      status: 'warn',
      message: `Config collision: legacy ${foundJson.join(', ')} + ${foundYaml.join(', ')} — subsystems may disagree silently`,
      fix: `Archive the legacy JSON (mv ${foundJson[0]} ${foundJson[0]}.bak) and keep ${foundYaml[0]} as the canonical config`,
    };
  }

  if (foundYaml.length > 0) {
    return { name: 'Config File', status: 'pass', message: `Found: ${foundYaml[0]}` };
  }
  if (foundJson.length > 0) {
    return { name: 'Config File', status: 'pass', message: `Found: ${foundJson[0]}` };
  }

  return { name: 'Config File', status: 'warn', message: 'No config file (using defaults)', fix: 'claude-flow config init' };
}

// Check daemon status
/**
 * #2448 — Detect the runaway `npx @claude-flow/cli@latest` statusLine / hook
 * commands left over in `.claude/settings.json` from pre-#2337 installs.
 *
 * These fire on every Claude Code event (statusLine refires every few hundred
 * ms, hooks fire per tool-use), each spawning a cold Node process + npm
 * registry round-trip. On the reporter's 48 GB macOS box this produced
 * load average 49, jetsam, and a kernel watchdog panic two minutes after
 * boot. Severity is CRITICAL when present; users who installed before #2337
 * and never re-ran `ruflo init` still have it.
 *
 * Detection only — does not modify settings. Fix path is `ruflo init` (the
 * executor's migration logic, also patched in #2448, will now regenerate
 * the broken commands).
 */
async function checkStaleSettingsNpx(): Promise<HealthCheck> {
  // Same regex pattern the executor migration uses — kept in sync.
  const BROKEN_RE = /npx\s+(?:--?\S+\s+)*@?claude-flow\/cli@latest\s+hooks\s+(?:statusline|\S+)/;

  // Look in both project-local and home-dir settings.
  const candidates = [
    join(process.cwd(), '.claude', 'settings.json'),
    join(process.env.HOME ?? '', '.claude', 'settings.json'),
  ].filter((p, i, a) => p && a.indexOf(p) === i);

  const offenders: Array<{ path: string; where: string }> = [];
  for (const settingsPath of candidates) {
    if (!existsSync(settingsPath)) continue;
    let settings: Record<string, unknown>;
    try {
      settings = JSON.parse(readFileSync(settingsPath, 'utf8'));
    } catch {
      continue; // checkConfigFile reports JSON errors separately
    }

    // statusLine.command
    const sl = settings.statusLine as { command?: string } | undefined;
    if (sl?.command && BROKEN_RE.test(sl.command)) {
      offenders.push({ path: settingsPath, where: 'statusLine' });
    }

    // hooks.<event>[].hooks[].command
    const hooks = settings.hooks as Record<string, Array<{ hooks?: Array<{ command?: string }> }>> | undefined;
    if (hooks) {
      for (const [eventName, groups] of Object.entries(hooks)) {
        if (!Array.isArray(groups)) continue;
        for (const group of groups) {
          if (!Array.isArray(group.hooks)) continue;
          for (const h of group.hooks) {
            if (typeof h?.command === 'string' && BROKEN_RE.test(h.command)) {
              offenders.push({ path: settingsPath, where: `hooks.${eventName}` });
            }
          }
        }
      }
    }
  }

  if (offenders.length === 0) {
    return { name: 'Stale npx@latest in settings (#2448)', status: 'pass', message: 'no runaway commands detected' };
  }

  // Group by file for readable output
  const byFile = offenders.reduce((acc, o) => {
    (acc[o.path] ??= []).push(o.where);
    return acc;
  }, {} as Record<string, string[]>);
  const summary = Object.entries(byFile)
    .map(([p, wheres]) => `${p} [${[...new Set(wheres)].join(', ')}]`)
    .join('; ');

  return {
    name: 'Stale npx@latest in settings (#2448)',
    status: 'fail',
    message: `CRITICAL — runaway \`npx @claude-flow/cli@latest\` commands detected: ${summary}`,
    fix: 'Re-run `npx ruflo init` to migrate (the v3.13.3+ init migrator regenerates these to local-helper form). On macOS this prevents the process-storm / kernel-panic class reported in #2448.',
  };
}

async function checkDaemonStatus(): Promise<HealthCheck> {
  try {
    const pidFile = '.claude-flow/daemon.pid';
    if (existsSync(pidFile)) {
      const pid = readFileSync(pidFile, 'utf8').trim();
      try {
        process.kill(parseInt(pid, 10), 0); // Check if process exists
        return { name: 'Daemon Status', status: 'pass', message: `Running (PID: ${pid})` };
      } catch {
        return { name: 'Daemon Status', status: 'warn', message: 'Stale PID file', fix: 'rm .claude-flow/daemon.pid && claude-flow daemon start' };
      }
    }
    return { name: 'Daemon Status', status: 'warn', message: 'Not running', fix: 'claude-flow daemon start' };
  } catch {
    return { name: 'Daemon Status', status: 'warn', message: 'Unable to check', fix: 'claude-flow daemon status' };
  }
}

// Check memory database
async function checkMemoryDatabase(): Promise<HealthCheck> {
  // Authoritative path comes from `getMemoryRoot()` (honors
  // `CLAUDE_FLOW_MEMORY_PATH`, claude-flow.config.json's `memory.persistPath`,
  // then defaults to `.swarm/`). #1946: the previous hard-coded list missed
  // `data/memory/memory.db` (a common config) and ignored the env var
  // entirely, so doctor reported "Not initialized" on perfectly-init'd DBs.
  // Try the configured path first, then fall back to the historic candidates.
  const candidates: string[] = [];
  try {
    const { getMemoryRoot } = await import('../memory/memory-initializer.js');
    candidates.push(join(getMemoryRoot(), 'memory.db'));
  } catch {
    /* memory-initializer not available — fall through to legacy candidates */
  }
  candidates.push(
    '.swarm/memory.db',
    '.claude-flow/memory.db',
    'data/memory/memory.db', // matches `CLAUDE_FLOW_MEMORY_PATH=data/memory`
    'data/memory.db',
  );

  for (const dbPath of candidates) {
    if (existsSync(dbPath)) {
      try {
        const stats = statSync(dbPath);
        const sizeMB = (stats.size / 1024 / 1024).toFixed(2);
        return { name: 'Memory Database', status: 'pass', message: `${dbPath} (${sizeMB} MB)` };
      } catch {
        return { name: 'Memory Database', status: 'warn', message: `${dbPath} (unable to stat)` };
      }
    }
  }

  return { name: 'Memory Database', status: 'warn', message: 'Not initialized', fix: 'claude-flow memory configure --backend hybrid' };
}

// #2545: Check that the self-learning bridge can actually load @claude-flow/memory
// the SAME way the SessionStart auto-memory hook does. On the documented `npx ruflo`
// path the package lands in the npx cache — unreachable from the project — so the
// hook silently no-op'd with no signal anywhere. This surfaces it.
async function checkLearningBridge(): Promise<HealthCheck> {
  const cwd = process.cwd();
  const hookPath = join(cwd, '.claude', 'helpers', 'auto-memory-hook.mjs');

  // Only relevant once init has deployed the hook; otherwise stay quiet.
  if (!existsSync(hookPath)) {
    return {
      name: 'Learning Bridge',
      status: 'pass',
      message: 'auto-memory hook not installed (run: npx ruflo@latest init)',
    };
  }

  const distPath = resolveMemoryPackageFromProject(cwd);
  if (distPath) {
    const version = readMemoryPackageVersion(distPath);
    return {
      name: 'Learning Bridge',
      status: 'pass',
      message: `@claude-flow/memory resolvable${version ? ` (v${version})` : ''}`,
    };
  }

  // #2599: Self-heal on plain `doctor` (not just --fix). The project-side resolver
  // fails when the sidecar is stale or missing (e.g. npx cache generation rotated),
  // but the CLI process itself can resolve @claude-flow/memory from its own module
  // context. Write the sidecar automatically instead of hard-failing the check.
  const record = recordMemoryPackagePath(cwd, 'doctor-auto');
  if (record) {
    const version = readMemoryPackageVersion(record.distPath);
    return {
      name: 'Learning Bridge',
      status: 'pass',
      message: `@claude-flow/memory resolvable via auto-recorded sidecar${version ? ` (v${version})` : ''}`,
    };
  }

  return {
    name: 'Learning Bridge',
    status: 'fail',
    message: '@claude-flow/memory NOT resolvable — SessionStart self-learning imports are a silent no-op',
    fix: 'npm i -D @claude-flow/memory   (optional dep appears absent — likely --omit=optional install)',
  };
}

// Check API keys
async function checkApiKeys(): Promise<HealthCheck> {
  const keys = ['ANTHROPIC_API_KEY', 'CLAUDE_API_KEY', 'OPENAI_API_KEY'];
  const found: string[] = [];

  for (const key of keys) {
    if (process.env[key]) {
      found.push(key);
    }
  }

  // Detect Claude Code environment — API keys are managed internally
  const inClaudeCode = !!(process.env.CLAUDE_CODE || process.env.CLAUDE_PROJECT_DIR || process.env.MCP_SESSION_ID);

  if (found.includes('ANTHROPIC_API_KEY') || found.includes('CLAUDE_API_KEY')) {
    return { name: 'API Keys', status: 'pass', message: `Found: ${found.join(', ')}` };
  } else if (inClaudeCode) {
    return { name: 'API Keys', status: 'pass', message: 'Claude Code (managed internally)' };
  } else if (found.length > 0) {
    return { name: 'API Keys', status: 'warn', message: `Found: ${found.join(', ')} (no Claude key)`, fix: 'export ANTHROPIC_API_KEY=your_key' };
  } else {
    return { name: 'API Keys', status: 'warn', message: 'No API keys found', fix: 'export ANTHROPIC_API_KEY=your_key' };
  }
}

// Check git (async with proper env inheritance)
async function checkGit(): Promise<HealthCheck> {
  try {
    const version = await runCommand('git --version');
    return { name: 'Git', status: 'pass', message: version.replace('git version ', 'v') };
  } catch {
    return { name: 'Git', status: 'warn', message: 'Not installed', fix: 'Install git from https://git-scm.com' };
  }
}

// Check if in git repo (async with proper env inheritance)
//
// #1791.7 — `git rev-parse` was reported as failing on hosts where `.git`
// clearly exists in cwd (linux-arm64 daemon contexts). Treat the git binary
// as authoritative when it succeeds, but fall back to a `.git` walk-up so a
// present repository is recognized even when the git invocation fails for
// environment reasons (PATH, broken global config, EBADCWD, etc.).
async function checkGitRepo(): Promise<HealthCheck> {
  try {
    await runCommand('git rev-parse --is-inside-work-tree');
    return { name: 'Git Repository', status: 'pass', message: 'In a git repository' };
  } catch {
    // Walk parents of cwd for a .git directory before reporting "not a repo"
    let dir = process.cwd();
    while (true) {
      if (existsSync(join(dir, '.git'))) {
        return {
          name: 'Git Repository',
          status: 'warn',
          message: `Repo detected on disk (${join(dir, '.git')}) but \`git rev-parse\` failed — check git installation and PATH`,
          fix: 'Verify git is on PATH (try `git --version`) and that the working tree is not corrupted',
        };
      }
      const parent = dirname(dir);
      if (parent === dir) break;
      dir = parent;
    }
    return { name: 'Git Repository', status: 'warn', message: 'Not a git repository', fix: 'git init' };
  }
}

// Check AIDefence package availability (#1807)
//
// `aidefence_*` MCP tools (scan, analyze, has_pii, stats, learn) require
// `@claude-flow/aidefence` to be installed and loadable. The package is an
// optional dependency — present in some installs (project-local) but
// missing in others (npm-global of `claude-flow`). Without it, every
// aidefence MCP call fails at runtime with "Cannot find module".
//
// Surface that state in `doctor` so operators know BEFORE they rely on
// AI-defence scanning. The probe is the same dynamic `import()` the MCP
// tool's handler uses, so a `pass` here means the actual tools will work.
async function checkAIDefence(): Promise<HealthCheck> {
  try {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    await import('@claude-flow/aidefence');
    return {
      name: 'AIDefence',
      status: 'pass',
      message: '@claude-flow/aidefence loadable — aidefence_* MCP tools functional',
    };
  } catch {
    return {
      name: 'AIDefence',
      status: 'warn',
      message: '@claude-flow/aidefence not loadable — aidefence_* MCP tools will fail (optional package)',
      fix: 'npm install --save @claude-flow/aidefence  (in your project), or run `claude-flow mcp start` from a directory that has it installed',
    };
  }
}

/**
 * ADR-097 Phase 4: federation peer-state surface for doctor.
 *
 * Probes the federation plugin loadability + asserts the breaker entity
 * layer is present in the installed version. Without the plugin
 * installed this is a "not configured" pass — federation is opt-in.
 *
 * Live coordinator state (per-peer counts) requires a running MCP server
 * with `federation_init` called; operators inspect that via the
 * `federation_breaker_status` MCP tool, not the doctor (which is a
 * one-shot CLI process with no coordinator session).
 */
async function checkFederationBreaker(): Promise<HealthCheck> {
  try {
    // Optional plugin — not a hard dep of @claude-flow/cli. Build the
    // module specifier dynamically so TypeScript cannot statically
    // resolve it (which would emit TS2307); at runtime the import
    // either resolves (plugin installed) or throws (handled below).
    const specifier = ['@claude-flow', 'plugin-agent-federation'].join('/');
    const mod: { FederationNodeState?: unknown } = await import(specifier);
    if (!mod.FederationNodeState) {
      return {
        name: 'Federation Breaker',
        status: 'warn',
        message:
          '@claude-flow/plugin-agent-federation loaded but FederationNodeState export missing — version older than ADR-097 Phase 2',
        fix: 'Upgrade: npm install @claude-flow/plugin-agent-federation@alpha',
      };
    }
    return {
      name: 'Federation Breaker',
      status: 'pass',
      message:
        'ADR-097 breaker loadable — federation_breaker_status / federation_evict / federation_reactivate MCP tools available',
    };
  } catch {
    return {
      name: 'Federation Breaker',
      status: 'pass',
      message:
        'Federation plugin not installed (optional) — install only if you need cross-installation peering',
      fix: 'npm install --save @claude-flow/plugin-agent-federation@alpha',
    };
  }
}

// Check MCP servers
async function checkMcpServers(): Promise<HealthCheck> {
  const home = process.env.HOME || process.env.USERPROFILE || '';
  // #1842: ~/.claude.json holds project-scoped registrations under
  // parsed.projects[<projectPath>].mcpServers.ruflo, in addition to any
  // top-level mcpServers. Check both shapes plus the legacy desktop and
  // local .mcp.json paths.
  const mcpConfigPaths = [
    join(home, '.claude.json'),
    join(home, '.claude/claude_desktop_config.json'),
    join(home, '.config/claude/mcp.json'),
    '.mcp.json',
  ];

  const isRufloKey = (k: string) =>
    k === 'ruflo' || k === 'ruflo_alpha' || k === 'claude-flow' || k === 'claude-flow_alpha';

  for (const configPath of mcpConfigPaths) {
    if (!existsSync(configPath)) continue;
    try {
      const content = JSON.parse(readFileSync(configPath, 'utf8'));
      // Top-level mcpServers (legacy / desktop form)
      const topServers = content.mcpServers || content.servers || {};
      const topServerKeys = Object.keys(topServers);
      const topHasRuflo = topServerKeys.some(isRufloKey);

      // Project-scoped (Claude Code shape): projects[*].mcpServers.ruflo
      let projectHits = 0;
      let projectScannedServers = 0;
      if (content.projects && typeof content.projects === 'object') {
        for (const projectVal of Object.values(content.projects)) {
          const pm = (projectVal as { mcpServers?: Record<string, unknown> })?.mcpServers;
          if (pm && typeof pm === 'object') {
            const keys = Object.keys(pm);
            projectScannedServers += keys.length;
            if (keys.some(isRufloKey)) projectHits += 1;
          }
        }
      }

      const totalServers = topServerKeys.length + projectScannedServers;
      if (topHasRuflo || projectHits > 0) {
        const where = topHasRuflo
          ? 'top-level'
          : `${projectHits} project-scoped`;
        return {
          name: 'MCP Servers',
          status: 'pass',
          message: `${totalServers} servers (ruflo configured: ${where})`,
        };
      }
      if (totalServers > 0) {
        return {
          name: 'MCP Servers',
          status: 'warn',
          message: `${totalServers} servers (ruflo not found)`,
          fix: 'claude mcp add ruflo -- npx -y ruflo@latest mcp start',
        };
      }
    } catch {
      // continue to next path
    }
  }

  return {
    name: 'MCP Servers',
    status: 'warn',
    message: 'No MCP config found',
    fix: 'claude mcp add ruflo -- npx -y ruflo@latest mcp start',
  };
}

// Check disk space (async with proper env inheritance)
async function checkDiskSpace(): Promise<HealthCheck> {
  try {
    if (process.platform === 'win32') {
      return { name: 'Disk Space', status: 'pass', message: 'Check skipped on Windows' };
    }
    // Use df -Ph for POSIX mode (guarantees single-line output even with long device names)
    const output_str = await runCommand('df -Ph . | tail -1');
    const parts = output_str.split(/\s+/);
    // POSIX format: Filesystem Size Used Avail Capacity Mounted
    const available = parts[3];
    const usePercent = parseInt(parts[4]?.replace('%', '') || '0', 10);
    if (isNaN(usePercent)) {
      return { name: 'Disk Space', status: 'warn', message: `${available || 'unknown'} available (unable to parse usage)` };
    }

    if (usePercent > 90) {
      return { name: 'Disk Space', status: 'fail', message: `${available} available (${usePercent}% used)`, fix: 'Free up disk space' };
    } else if (usePercent > 80) {
      return { name: 'Disk Space', status: 'warn', message: `${available} available (${usePercent}% used)` };
    }
    return { name: 'Disk Space', status: 'pass', message: `${available} available` };
  } catch {
    return { name: 'Disk Space', status: 'warn', message: 'Unable to check' };
  }
}

// Check TypeScript/build (async with proper env inheritance)
async function checkBuildTools(): Promise<HealthCheck> {
  try {
    const tscVersion = await runCommand('npx tsc --version', 10000); // tsc can be slow
    if (!tscVersion || tscVersion.includes('not found')) {
      return { name: 'TypeScript', status: 'warn', message: 'Not installed locally', fix: 'npm install -D typescript' };
    }
    return { name: 'TypeScript', status: 'pass', message: tscVersion.replace('Version ', 'v') };
  } catch {
    return { name: 'TypeScript', status: 'warn', message: 'Not installed locally', fix: 'npm install -D typescript' };
  }
}

// Check for stale npx cache (version freshness)
async function checkVersionFreshness(): Promise<HealthCheck> {
  try {
    // Get current CLI version from package.json
    // Use import.meta.url to reliably locate our own package.json,
    // regardless of how deep the compiled file sits (e.g. dist/src/commands/).
    let currentVersion = '0.0.0';
    try {
      const thisFile = fileURLToPath(import.meta.url);
      let dir = dirname(thisFile);

      // Walk up from the current file's directory until we find the
      // package.json that belongs to @claude-flow/cli (or claude-flow/cli).
      // Walk until dirname(dir) === dir (filesystem root on any platform).
      for (;;) {
        const candidate = join(dir, 'package.json');
        try {
          if (existsSync(candidate)) {
            const pkg = JSON.parse(readFileSync(candidate, 'utf8'));
            if (
              pkg.version &&
              typeof pkg.name === 'string' &&
              (pkg.name === '@claude-flow/cli' || pkg.name === 'claude-flow' || pkg.name === 'ruflo')
            ) {
              currentVersion = pkg.version;
              break;
            }
          }
        } catch {
          // Unreadable/invalid JSON -- skip and keep walking up
        }
        const parent = dirname(dir);
        if (parent === dir) break; // reached root
        dir = parent;
      }
    } catch {
      // Fall back to a default
      currentVersion = '0.0.0';
    }

    // Check if running via npx (look for _npx in process path or argv)
    const isNpx = process.argv[1]?.includes('_npx') ||
                  process.env.npm_execpath?.includes('npx') ||
                  process.cwd().includes('_npx');

    // Query npm for latest version (using alpha tag since that's what we publish to)
    let latestVersion = currentVersion;
    try {
      const npmInfo = await runCommand('npm view @claude-flow/cli@alpha version', 5000);
      latestVersion = npmInfo.trim();
    } catch {
      // Can't reach npm registry - skip check
      return {
        name: 'Version Freshness',
        status: 'warn',
        message: `v${currentVersion} (cannot check registry)`
      };
    }

    // Parse version numbers for comparison (handle prerelease like 3.0.0-alpha.84)
    const parseVersion = (v: string): { major: number; minor: number; patch: number; prerelease: number } => {
      const match = v.match(/^(\d+)\.(\d+)\.(\d+)(?:-[a-zA-Z]+\.(\d+))?/);
      if (!match) return { major: 0, minor: 0, patch: 0, prerelease: 0 };
      return {
        major: parseInt(match[1], 10) || 0,
        minor: parseInt(match[2], 10) || 0,
        patch: parseInt(match[3], 10) || 0,
        prerelease: parseInt(match[4], 10) || 0
      };
    };

    const current = parseVersion(currentVersion);
    const latest = parseVersion(latestVersion);

    // Compare versions (including prerelease number)
    const isOutdated = (
      latest.major > current.major ||
      (latest.major === current.major && latest.minor > current.minor) ||
      (latest.major === current.major && latest.minor === current.minor && latest.patch > current.patch) ||
      (latest.major === current.major && latest.minor === current.minor && latest.patch === current.patch && latest.prerelease > current.prerelease)
    );

    if (isOutdated) {
      const fix = isNpx
        ? 'rm -rf ~/.npm/_npx/* && npx -y @claude-flow/cli@latest'
        : 'npm update @claude-flow/cli';

      return {
        name: 'Version Freshness',
        status: 'warn',
        message: `v${currentVersion} (latest: v${latestVersion})${isNpx ? ' [npx cache stale]' : ''}`,
        fix
      };
    }

    return {
      name: 'Version Freshness',
      status: 'pass',
      message: `v${currentVersion} (up to date)`
    };
  } catch (error) {
    return {
      name: 'Version Freshness',
      status: 'warn',
      message: 'Unable to check version freshness'
    };
  }
}

// Check Claude Code CLI (async with proper env inheritance)
// ADR-150 — surface MetaHarness availability + harnessFit score in
// the standard ruflo doctor flow. Graceful degradation: when metaharness
// is not installed (no network, optionalDep skipped), the check returns
// `warn` with a hint instead of `fail` — ruflo continues to function.
/**
 * iter 45 — verify the ruflo-side MetaHarness integration is intact.
 *
 * The existing `checkMetaharness` verifies the UPSTREAM `metaharness`
 * package is reachable (warn if missing — it's optional per ADR-150).
 * This check verifies the INTEGRATION LAYER (plugin scripts, production
 * module, subprocess bridge) is intact. Unlike upstream, the integration
 * layer is shipped with ruflo — missing files mean ruflo's install is
 * corrupted, not that an optional dep is absent.
 *
 * Status mapping:
 *   pass — all required files present + module loads + similarity() smoke OK
 *   fail — any required file missing OR module fails to import
 *   warn — files present but module import errored at runtime
 *
 * Verified files (iter 36-53 surfaces — full ADR-150 deep-integration set):
 *   - plugins/ruflo-metaharness/scripts/_harness.mjs                (subprocess bridge)
 *   - plugins/ruflo-metaharness/scripts/_similarity.mjs             (ADR-152 §3.1 module, iter 36)
 *   - plugins/ruflo-metaharness/scripts/similarity.mjs              (CLI skill, iter 36)
 *   - plugins/ruflo-metaharness/scripts/_spike-similarity.mjs       (regression anchor, iter 35)
 *   - plugins/ruflo-metaharness/scripts/drift-from-history.mjs      (1-command primitive, iter 53)
 *   - plugins/ruflo-metaharness/skills/harness-similarity/SKILL.md
 *   - plugins/ruflo-metaharness/skills/harness-drift-from-history/SKILL.md  (iter 53)
 */
async function checkMetaharnessIntegration(): Promise<HealthCheck> {
  // Locate plugins dir.
  //
  // Pre-#2437 fix this only walked up from `process.cwd()` + checked one
  // hard-coded `<cwd>/node_modules/@claude-flow/cli/...` candidate. That
  // missed the two cases users actually run from:
  //   (a) `npx @claude-flow/cli@<tag>` → resolves to a per-version cache
  //       under `~/.npm/_npx/<hash>/node_modules/@claude-flow/cli/...`
  //   (b) `npm install -g @claude-flow/cli` → lives at
  //       `$(npm prefix -g)/lib/node_modules/@claude-flow/cli/...`
  //
  // The bulletproof fix: resolve relative to THIS file's own location via
  // `import.meta.url`. The plugins dir is always a sibling of the package
  // root regardless of where the package was installed. Walk up from
  // `dist/src/commands/doctor.js` (built) or `src/commands/doctor.ts`
  // (dev) until we find a directory containing `plugins/ruflo-metaharness/`.
  const candidates: string[] = [];

  // Strategy 1: walk up from this module's own URL — covers npx + global install.
  try {
    const selfDir = dirname(fileURLToPath(import.meta.url));
    let q = selfDir;
    for (let i = 0; i < 8; i++) {
      candidates.push(join(q, 'plugins', 'ruflo-metaharness'));
      q = dirname(q);
    }
  } catch {
    // import.meta.url unavailable under some bundlers — fall through to cwd walk.
  }

  // Strategy 2: walk up from cwd — covers monorepo dev (running from a sub-package).
  let p = process.cwd();
  for (let i = 0; i < 8; i++) {
    candidates.push(join(p, 'plugins', 'ruflo-metaharness'));
    p = dirname(p);
  }

  // Strategy 3: explicit node_modules path relative to cwd — covers project-local install.
  candidates.push(join(process.cwd(), 'node_modules', '@claude-flow', 'cli', 'plugins', 'ruflo-metaharness'));

  let pluginDir: string | null = null;
  for (const c of candidates) {
    if (existsSync(join(c, 'scripts', '_harness.mjs'))) {
      pluginDir = c;
      break;
    }
  }

  if (!pluginDir) {
    // #2437: MetaHarness is documented as an optional dependency in
    // optionalDependencies (per ADR-150 architectural constraint #2 —
    // "Optional in package.json"). A genuinely-absent plugin therefore
    // warrants WARN, not FAIL — same posture as the runtime path which
    // returns {degraded: true, exit 0}. FAIL is reserved for misconfigured
    // installs where the plugin SHOULD be present but is broken.
    return {
      name: 'MetaHarness integration (ADR-150)',
      status: 'warn',
      message: 'plugins/ruflo-metaharness/ not found — MetaHarness skills will degrade gracefully',
      fix: 'Optional: install via `npm i -D @metaharness/darwin metaharness` or run `ruflo plugins install ruflo-metaharness`',
    };
  }

  // Required files (iter 36+44 surfaces, +ADR-153 darwin surfaces in v3.13.0)
  const required = [
    'scripts/_harness.mjs',
    'scripts/_similarity.mjs',
    'scripts/similarity.mjs',
    'scripts/_spike-similarity.mjs',
    // iter 53 surfaces — gated against silent deletion
    'scripts/drift-from-history.mjs',
    'skills/harness-similarity/SKILL.md',
    'skills/harness-drift-from-history/SKILL.md',
    // ADR-153 Darwin Mode surfaces (v3.13.0) — added to gate against silent deletion
    'scripts/_darwin.mjs',
    'scripts/evolve.mjs',
    'scripts/security-bench.mjs',
    'scripts/bench.mjs',
    'skills/harness-evolve/SKILL.md',
    'skills/harness-security-bench/SKILL.md',
    'skills/harness-bench/SKILL.md',
  ];
  const missing = required.filter((f) => !existsSync(join(pluginDir, f)));
  if (missing.length > 0) {
    return {
      name: 'MetaHarness integration (ADR-150)',
      status: 'fail',
      message: `Missing files: ${missing.join(', ')}`,
      fix: 'Reinstall ruflo or restore from git: `git checkout HEAD -- plugins/ruflo-metaharness/`',
    };
  }

  // Runtime smoke: import the similarity module and exercise it
  try {
    const modPath = join(pluginDir, 'scripts', '_similarity.mjs');
    const mod = await import(modPath) as { similarity?: (a: unknown, b: unknown) => { overall?: number } };
    if (typeof mod.similarity !== 'function') {
      return {
        name: 'MetaHarness integration (ADR-150)',
        status: 'fail',
        message: '_similarity.mjs does not export similarity()',
        fix: 'Reinstall ruflo or restore the file from git',
      };
    }
    const result = mod.similarity({}, {});
    if (typeof result?.overall !== 'number') {
      return {
        name: 'MetaHarness integration (ADR-150)',
        status: 'warn',
        message: 'similarity() returned unexpected shape; module may be stale',
      };
    }

    // iter 52 — also verify the iter-50 mcp-scan text parser exports
    // correctly. parseMcpScanText is the shared util both mcp-scan.mjs
    // and oia-audit.mjs depend on; if it's missing the audit-trend
    // introduced/cleared diff silently degrades to dead code.
    //
    // iter 61 — additionally verify iter-56's async exports
    // (runHarnessAsync / runMetaharnessAsync). These are the
    // parallelization primitives oia-audit depends on; if they're
    // missing, oia-audit's import fails and the whole pipeline breaks.
    const harnessPath = join(pluginDir, 'scripts', '_harness.mjs');
    const harnessMod = await import(harnessPath) as {
      parseMcpScanText?: (s: string) => unknown;
      runHarnessAsync?: (args: string[]) => Promise<unknown>;
      runMetaharnessAsync?: (args: string[]) => Promise<unknown>;
    };
    if (typeof harnessMod.parseMcpScanText !== 'function') {
      return {
        name: 'MetaHarness integration (ADR-150)',
        status: 'fail',
        message: '_harness.mjs does not export parseMcpScanText (iter 50 — needed by mcp-scan + oia-audit)',
        fix: 'Reinstall ruflo or restore _harness.mjs from git',
      };
    }
    if (typeof harnessMod.runHarnessAsync !== 'function' || typeof harnessMod.runMetaharnessAsync !== 'function') {
      return {
        name: 'MetaHarness integration (ADR-150)',
        status: 'fail',
        message: '_harness.mjs missing iter-56 async exports (runHarnessAsync / runMetaharnessAsync) — oia-audit parallelization will fail',
        fix: 'Reinstall ruflo or restore _harness.mjs from git',
      };
    }
    // Smoke: parser handles empty input gracefully
    const parsed = harnessMod.parseMcpScanText('') as { findings?: unknown };
    if (!Array.isArray(parsed?.findings)) {
      return {
        name: 'MetaHarness integration (ADR-150)',
        status: 'warn',
        message: 'parseMcpScanText returned unexpected shape on empty input',
      };
    }

    return {
      name: 'MetaHarness integration (ADR-150)',
      status: 'pass',
      message: 'plugin scripts intact, _similarity.mjs + parseMcpScanText load, smoke OK',
    };
  } catch (e) {
    return {
      name: 'MetaHarness integration (ADR-150)',
      status: 'warn',
      message: `Module import errored: ${(e as Error).message.slice(0, 60)}`,
    };
  }
}

async function checkMetaharness(): Promise<HealthCheck> {
  try {
    const version = await runCommand('npx -y metaharness@latest --version 2>&1', 15000);
    // metaharness emits multi-line stdout; parse a version-shaped line.
    const versionMatch = version.match(/(\d+\.\d+\.\d+)/);
    if (!versionMatch) {
      return {
        name: 'MetaHarness (ADR-150)',
        status: 'warn',
        message: 'Installed but version-string not parseable; integration may still work',
      };
    }
    return {
      name: 'MetaHarness (ADR-150)',
      status: 'pass',
      message: `v${versionMatch[1]} — run \`npx ruflo metaharness score\` for the full scorecard`,
    };
  } catch {
    return {
      name: 'MetaHarness (ADR-150)',
      status: 'warn',
      message: 'Not installed — `npx ruflo metaharness *` commands will degrade gracefully',
      fix: 'npm install --include=optional  # to enable the metaharness optional dep',
    };
  }
}

async function checkClaudeCode(): Promise<HealthCheck> {
  try {
    const version = await runCommand('claude --version');
    // Parse version from output like "claude 1.0.0" or "Claude Code v1.0.0"
    const versionMatch = version.match(/v?(\d+\.\d+\.\d+)/);
    const versionStr = versionMatch ? `v${versionMatch[1]}` : version;
    return { name: 'Claude Code CLI', status: 'pass', message: versionStr };
  } catch {
    return {
      name: 'Claude Code CLI',
      status: 'warn',
      message: 'Not installed',
      fix: 'npm install -g @anthropic-ai/claude-code'
    };
  }
}

// Install Claude Code CLI
async function installClaudeCode(): Promise<boolean> {
  try {
    output.writeln();
    output.writeln(output.bold('Installing Claude Code CLI...'));
    execSync('npm install -g @anthropic-ai/claude-code', {
      encoding: 'utf8',
      stdio: 'inherit'
    });
    output.writeln(output.success('Claude Code CLI installed successfully!'));
    return true;
  } catch (error) {
    output.writeln(output.error('Failed to install Claude Code CLI'));
    if (error instanceof Error) {
      output.writeln(output.dim(error.message));
    }
    return false;
  }
}

// Check agentic-flow v3 integration (filesystem-based to avoid slow WASM/DB init)
async function checkAgenticFlow(): Promise<HealthCheck> {
  try {
    // Walk common node_modules paths to find agentic-flow/package.json
    const candidates = [
      join(process.cwd(), 'node_modules', 'agentic-flow', 'package.json'),
      join(process.cwd(), '..', 'node_modules', 'agentic-flow', 'package.json'),
    ];
    let pkgJsonPath: string | null = null;
    for (const p of candidates) {
      if (existsSync(p)) { pkgJsonPath = p; break; }
    }
    if (!pkgJsonPath) {
      return {
        name: 'agentic-flow',
        status: 'warn',
        message: 'Not installed (optional — embeddings/routing will use fallbacks)',
        fix: 'npm install agentic-flow@latest'
      };
    }
    const pkg = JSON.parse(readFileSync(pkgJsonPath, 'utf-8'));
    const version = pkg.version || 'unknown';
    const exports = pkg.exports || {};
    const features = [
      exports['./reasoningbank'] ? 'ReasoningBank' : null,
      exports['./router'] ? 'Router' : null,
      exports['./transport/quic'] ? 'QUIC' : null,
    ].filter(Boolean);
    return {
      name: 'agentic-flow',
      status: 'pass',
      message: `v${version} (${features.join(', ')})`
    };
  } catch {
    return { name: 'agentic-flow', status: 'warn', message: 'Check failed' };
  }
}

// Check encryption-at-rest status (ADR-096 Phase 5)
//
// Reports four facets without disclosing the key itself:
//   1. Gate status — is CLAUDE_FLOW_ENCRYPT_AT_REST set?
//   2. Key resolution — does CLAUDE_FLOW_ENCRYPTION_KEY resolve to a valid
//      32-byte key (env-var path only; keychain/passphrase are deferred)?
//   3. Key fingerprint — first 16 hex chars of sha256(key) so users can
//      sanity-check across machines without ever logging the key bytes.
//   4. High-tier store presence — for sessions/, terminals/, .swarm/memory.db
//      report whether on-disk bytes carry the RFE1 magic (encrypted) or not.
async function checkEncryptionAtRest(): Promise<HealthCheck> {
  if (!isEncryptionEnabled()) {
    return {
      name: 'Encryption at Rest',
      status: 'warn',
      message: 'Off — session/terminal/memory stores are plaintext (mode 0600 only)',
      fix: 'export CLAUDE_FLOW_ENCRYPT_AT_REST=1 && export CLAUDE_FLOW_ENCRYPTION_KEY=<64-char-hex>',
    };
  }

  // Gate is on — try to resolve the key. Fail-closed if missing or malformed.
  const rawKey = process.env.CLAUDE_FLOW_ENCRYPTION_KEY;
  if (!rawKey) {
    return {
      name: 'Encryption at Rest',
      status: 'fail',
      message: 'Gate is on but CLAUDE_FLOW_ENCRYPTION_KEY is unset (fail-closed)',
      fix: 'Generate a key: openssl rand -hex 32 → export CLAUDE_FLOW_ENCRYPTION_KEY=<value>',
    };
  }
  let keyFingerprint: string;
  try {
    const key = decodeKey(rawKey);
    keyFingerprint = createHash('sha256').update(key).digest('hex').slice(0, 16);
  } catch (err) {
    return {
      name: 'Encryption at Rest',
      status: 'fail',
      message: `CLAUDE_FLOW_ENCRYPTION_KEY invalid: ${err instanceof Error ? err.message : String(err)}`,
      fix: 'Provide a 64-char hex or 44-char base64 key (32 bytes)',
    };
  }

  // Check the three high-tier store paths for RFE1 magic
  const cwd = process.cwd();
  const stores: Array<{ label: string; path: string }> = [
    { label: 'sessions/', path: join(cwd, '.claude-flow', 'sessions') },
    { label: 'terminals', path: join(cwd, '.claude-flow', 'terminals', 'store.json') },
    { label: 'memory.db', path: join(cwd, '.swarm', 'memory.db') },
  ];
  const status: string[] = [];
  for (const s of stores) {
    if (!existsSync(s.path)) {
      status.push(`${s.label}=∅`);
      continue;
    }
    try {
      const stat = statSync(s.path);
      if (stat.isDirectory()) {
        // Sessions: probe the first .json file
        const { readdirSync } = await import('fs');
        const files = readdirSync(s.path).filter(f => f.endsWith('.json'));
        if (files.length === 0) { status.push(`${s.label}=∅`); continue; }
        const first = readFileSync(join(s.path, files[0]));
        status.push(`${s.label}=${isEncryptedBlob(first) ? 'enc' : 'plain'}`);
      } else {
        const buf = readFileSync(s.path);
        status.push(`${s.label}=${isEncryptedBlob(buf) ? 'enc' : 'plain'}`);
      }
    } catch {
      status.push(`${s.label}=err`);
    }
  }

  return {
    name: 'Encryption at Rest',
    status: 'pass',
    message: `On — key fp:${keyFingerprint}… (${status.join(' ')})`,
  };
}

// Format health check result
function formatCheck(check: HealthCheck): string {
  const icon = check.status === 'pass' ? output.success('✓') :
               check.status === 'warn' ? output.warning('⚠') :
               output.error('✗');
  return `${icon} ${check.name}: ${check.message}`;
}

// Main doctor command
export const doctorCommand: Command = {
  name: 'doctor',
  description: 'System diagnostics and health checks',
  options: [
    {
      name: 'fix',
      short: 'f',
      // #1791.5 — flag name was misleading: it does NOT auto-apply fixes,
      // it only prints the suggested commands so the user can run them
      // themselves. Make that explicit in the help output.
      description: 'Print suggested fix commands (does not auto-apply — copy/paste them yourself)',
      type: 'boolean',
      default: false
    },
    {
      name: 'install',
      short: 'i',
      description: 'Auto-install missing dependencies (Claude Code CLI)',
      type: 'boolean',
      default: false
    },
    {
      name: 'component',
      short: 'c',
      description: 'Check specific component (version, node, npm, config, daemon, memory, api, git, mcp, claude, disk, typescript, agentic-flow, encryption, federation, metaharness)',
      type: 'string'
    },
    {
      name: 'verbose',
      short: 'v',
      description: 'Verbose output',
      type: 'boolean',
      default: false
    }
  ],
  examples: [
    { command: 'claude-flow doctor', description: 'Run full health check' },
    { command: 'claude-flow doctor --fix', description: 'Print suggested fix commands (does not auto-apply)' },
    { command: 'claude-flow doctor --install', description: 'Auto-install missing dependencies' },
    { command: 'claude-flow doctor -c version', description: 'Check for stale npx cache' },
    { command: 'claude-flow doctor -c claude', description: 'Check Claude Code CLI only' }
  ],
  action: async (ctx: CommandContext): Promise<CommandResult> => {
    const showFix = ctx.flags.fix as boolean;
    const autoInstall = ctx.flags.install as boolean;
    const component = ctx.flags.component as string;
    const verbose = ctx.flags.verbose as boolean;

    output.writeln();
    output.writeln(output.bold('RuFlo Doctor'));
    output.writeln(output.dim('System diagnostics and health check'));
    output.writeln(output.dim('─'.repeat(50)));
    output.writeln();

    const allChecks: (() => Promise<HealthCheck>)[] = [
      checkVersionFreshness,
      checkNodeVersion,
      checkNpmVersion,
      checkClaudeCode,
      checkGit,
      checkGitRepo,
      checkConfigFile,
      checkStaleSettingsNpx, // #2448 — runaway `npx @latest` in statusLine/hooks
      checkDaemonStatus,
      checkMemoryDatabase,
      checkLearningBridge, // #2545 — can the auto-memory hook actually load @claude-flow/memory?
      checkApiKeys,
      checkMcpServers,
      checkAIDefence, // #1807
      checkDiskSpace,
      checkBuildTools,
      checkAgenticFlow,
      checkEncryptionAtRest, // ADR-096 Phase 5
      checkFederationBreaker, // ADR-097 Phase 4
      checkMetaharness, // ADR-150 — MetaHarness upstream package
      checkMetaharnessIntegration, // iter 45 — ruflo-side integration layer
    ];

    const componentMap: Record<string, () => Promise<HealthCheck>> = {
      'version': checkVersionFreshness,
      'freshness': checkVersionFreshness,
      'node': checkNodeVersion,
      'npm': checkNpmVersion,
      'claude': checkClaudeCode,
      'config': checkConfigFile,
      'stale-settings': checkStaleSettingsNpx, // #2448
      'daemon': checkDaemonStatus,
      'memory': checkMemoryDatabase,
      'learning': checkLearningBridge, // #2545
      'learning-bridge': checkLearningBridge, // #2545
      'api': checkApiKeys,
      'git': checkGit,
      'mcp': checkMcpServers,
      'aidefence': checkAIDefence, // #1807
      'disk': checkDiskSpace,
      'typescript': checkBuildTools,
      'agentic-flow': checkAgenticFlow,
      'encryption': checkEncryptionAtRest, // ADR-096 Phase 5
      'federation': checkFederationBreaker, // ADR-097 Phase 4
      'metaharness': checkMetaharness, // ADR-150 — upstream package
      'metaharness-integration': checkMetaharnessIntegration, // iter 45 — ruflo-side
    };

    let checksToRun = allChecks;
    if (component && componentMap[component]) {
      checksToRun = [componentMap[component]];
    }

    const results: HealthCheck[] = [];
    const fixes: string[] = [];

    // OPTIMIZATION: Run all checks in parallel for 3-5x faster execution
    const spinner = output.createSpinner({ text: 'Running health checks in parallel...', spinner: 'dots' });
    spinner.start();

    try {
      // Execute all checks concurrently
      const checkResults = await Promise.allSettled(checksToRun.map(check => check()));
      spinner.stop();

      // Process results in order
      for (const settledResult of checkResults) {
        if (settledResult.status === 'fulfilled') {
          const result = settledResult.value;
          results.push(result);
          output.writeln(formatCheck(result));

          if (result.fix && (result.status === 'fail' || result.status === 'warn')) {
            fixes.push(`${result.name}: ${result.fix}`);
          }
        } else {
          const errorResult: HealthCheck = {
            name: 'Check',
            status: 'fail',
            message: settledResult.reason?.message || 'Unknown error'
          };
          results.push(errorResult);
          output.writeln(formatCheck(errorResult));
        }
      }
    } catch (error) {
      spinner.stop();
      output.writeln(output.error('Failed to run health checks'));
    }

    // #2545: --fix / --install can actually repair the Learning Bridge by
    // recording the resolver sidecar. When doctor runs via `npx ruflo`, the CLI
    // CAN resolve its optional @claude-flow/memory dep (it is in the same npx
    // cache), so writing the sidecar makes the SessionStart hook find it.
    if ((showFix || autoInstall)) {
      const lbResult = results.find(r => r.name === 'Learning Bridge');
      if (lbResult && lbResult.status === 'fail') {
        const record = recordMemoryPackagePath(process.cwd(), 'doctor');
        if (record) {
          const newCheck = await checkLearningBridge();
          const idx = results.findIndex(r => r.name === 'Learning Bridge');
          if (idx !== -1) results[idx] = newCheck;
          const fixIdx = fixes.findIndex(f => f.startsWith('Learning Bridge:'));
          if (fixIdx !== -1 && newCheck.status === 'pass') fixes.splice(fixIdx, 1);
          output.writeln(output.success(`Repaired Learning Bridge — wrote .claude-flow/memory-package.json → ${record.distPath}`));
          output.writeln(formatCheck(newCheck));
        }
      }
    }

    // Auto-install missing dependencies if requested
    if (autoInstall) {
      const claudeCodeResult = results.find(r => r.name === 'Claude Code CLI');
      if (claudeCodeResult && claudeCodeResult.status !== 'pass') {
        const installed = await installClaudeCode();
        if (installed) {
          // Re-check Claude Code after installation
          const newCheck = await checkClaudeCode();
          const idx = results.findIndex(r => r.name === 'Claude Code CLI');
          if (idx !== -1) {
            results[idx] = newCheck;
            // Update fixes list
            const fixIdx = fixes.findIndex(f => f.startsWith('Claude Code CLI:'));
            if (fixIdx !== -1 && newCheck.status === 'pass') {
              fixes.splice(fixIdx, 1);
            }
          }
          output.writeln(formatCheck(newCheck));
        }
      }
    }

    // Summary
    const passed = results.filter(r => r.status === 'pass').length;
    const warnings = results.filter(r => r.status === 'warn').length;
    const failed = results.filter(r => r.status === 'fail').length;

    output.writeln();
    output.writeln(output.dim('─'.repeat(50)));
    output.writeln();

    const summaryParts = [
      output.success(`${passed} passed`),
      warnings > 0 ? output.warning(`${warnings} warnings`) : null,
      failed > 0 ? output.error(`${failed} failed`) : null
    ].filter(Boolean);

    output.writeln(`Summary: ${summaryParts.join(', ')}`);

    // Show fixes — #1791.5: header makes it explicit these are commands you
    // run yourself, not actions doctor took.
    if (showFix && fixes.length > 0) {
      output.writeln();
      output.writeln(output.bold('Suggested commands (run them yourself):'));
      output.writeln();
      for (const fix of fixes) {
        output.writeln(output.dim(`  ${fix}`));
      }
    } else if (fixes.length > 0 && !showFix) {
      output.writeln();
      output.writeln(output.dim(`Run with --fix to see ${fixes.length} suggested command${fixes.length > 1 ? 's' : ''} (does not auto-apply)`));
    }

    // Overall result
    if (failed > 0) {
      output.writeln();
      output.writeln(output.error('Some checks failed. Please address the issues above.'));
      return { success: false, exitCode: 1, data: { passed, warnings, failed, results } };
    } else if (warnings > 0) {
      output.writeln();
      output.writeln(output.warning('All checks passed with some warnings.'));
      return { success: true, data: { passed, warnings, failed, results } };
    } else {
      output.writeln();
      output.writeln(output.success('All checks passed! System is healthy.'));
      return { success: true, data: { passed, warnings, failed, results } };
    }
  }
};

export default doctorCommand;
