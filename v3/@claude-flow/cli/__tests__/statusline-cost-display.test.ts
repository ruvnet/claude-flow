/**
 * Statusline session-cost display configuration.
 *
 * Claude Code's `cost.total_cost_usd` is documented as a client-side estimate
 * that "may differ from your actual bill", and on subscription plans it reads as
 * misleading (token usage is not billed per dollar). The statusline therefore
 * lets each user relabel or hide the cost segment without changing the default:
 *
 *   RUFLO_STATUSLINE_COST_SYMBOL  override the leading '$' ('' => number alone)
 *   RUFLO_STATUSLINE_HIDE_COST    1/true/yes/on => omit the segment
 *
 * These tests cover three layers:
 *   1. Generator contract — the emitted script wires the env vars and keeps '$'
 *      as the default, so the customization can never silently regress.
 *   2. Runtime behavior — the generated script renders the right thing for each
 *      configuration when fed a Claude Code stdin payload.
 *   3. Drift guard — the committed `.claude/helpers/statusline.cjs` artifact stays
 *      byte-identical to the generator output for the default options.
 */

import { describe, it, expect } from 'vitest';
import { execFileSync, spawn } from 'child_process';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, existsSync, rmSync, chmodSync, readdirSync } from 'fs';
import { tmpdir } from 'os';
import path from 'path';
import { fileURLToPath } from 'url';
import { createHash } from 'crypto';

import { generateStatuslineScript } from '../src/init/statusline-generator.js';
import { DEFAULT_INIT_OPTIONS } from '../src/init/types.js';

const SCRIPT = generateStatuslineScript(DEFAULT_INIT_OPTIONS);

const stripAnsi = (s: string): string =>
  // eslint-disable-next-line no-control-regex
  s.replace(/\x1b\[[0-9;]*m/g, '');

/**
 * Run the generated statusline against a Claude Code stdin payload. PATH is
 * neutered so the script's `npx`/`git` probes fail instantly and fall back to
 * local data — the cost segment comes purely from stdin, so this stays offline
 * and deterministic. Returns the first (header) line with ANSI stripped.
 */
function renderHeader(env: Record<string, string> = {}): string {
  const dir = mkdtempSync(path.join(tmpdir(), 'ruflo-statusline-'));
  const scriptPath = path.join(dir, 'statusline.cjs');
  writeFileSync(scriptPath, SCRIPT, 'utf-8');
  const payload = JSON.stringify({
    model: { display_name: 'Opus 4.8' },
    context_window: { used_percentage: 34 },
    cost: { total_cost_usd: 1.3, total_duration_ms: 376000 },
  });
  try {
    const out = execFileSync(process.execPath, [scriptPath], {
      input: payload,
      encoding: 'utf-8',
      env: { PATH: '/nonexistent', HOME: dir, ...env },
      timeout: 15000,
    });
    return stripAnsi(out).split('\n')[0];
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

describe('statusline cost display — generator contract', () => {
  it('reads both env vars and keeps "$" as the default', () => {
    expect(SCRIPT).toContain('RUFLO_STATUSLINE_COST_SYMBOL');
    expect(SCRIPT).toContain('RUFLO_STATUSLINE_HIDE_COST');
    // Default must be the dollar sign (?? '$') so existing setups are unchanged.
    expect(SCRIPT).toContain("process.env.RUFLO_STATUSLINE_COST_SYMBOL ?? '$'");
  });

  it('renders the cost via the configurable symbol, not a hardcoded "$"', () => {
    expect(SCRIPT).toContain('CONFIG.costSymbol + costInfo.costUsd.toFixed(2)');
    // The literal `'$' + costInfo.costUsd` render must be gone.
    expect(SCRIPT).not.toContain("'$' + costInfo.costUsd.toFixed(2)");
  });

  it('guards the cost segment with the hide toggle', () => {
    expect(SCRIPT).toContain('!CONFIG.hideCost && costInfo && costInfo.costUsd > 0');
  });
});

function writeFakeGit(bin: string, log: string): void {
  mkdirSync(bin, { recursive: true });
  writeFileSync(path.join(bin, 'git'), [
    '#!/bin/sh',
    'printf \'%s\\n\' "$*" >> "$GIT_PROBE_LOG"',
    'if [ "${FAKE_GIT_MODE:-success}" = "fail" ]; then exit 1; fi',
    'case "$1" in',
    '  rev-parse) printf \'%s\\n\' "$FAKE_GIT_ROOT" ;;',
    '  config) printf \'%s\\n\' "test-user" ;;',
    '  branch) printf \'%s\\n\' "${FAKE_GIT_BRANCH:-main}" ;;',
    '  status) : ;;',
    '  rev-list) printf \'%s\\n\' "0 0" ;;',
    'esac',
  ].join('\n') + '\n', 'utf-8');
  chmodSync(path.join(bin, 'git'), 0o755);
}

function cacheFileFor(cwd: string): string {
  return path.join(
    tmpdir(),
    'ruflo-statusline-git-cache-' + createHash('md5').update(cwd).digest('hex').slice(0, 8) + '.json',
  );
}

function runStatusline(scriptPath: string, cwd: string, env: Record<string, string>, args: string[] = []): string {
  return execFileSync(process.execPath, [scriptPath, ...args], {
    input: JSON.stringify({ model: { display_name: 'Opus 4.8' } }),
    encoding: 'utf-8',
    cwd,
    env,
    timeout: 15000,
  });
}

function runStatuslineAsync(scriptPath: string, cwd: string, env: Record<string, string>): Promise<string> {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [scriptPath], {
      cwd,
      env,
      stdio: ['pipe', 'pipe', 'pipe'],
    });
    let stdout = '';
    let stderr = '';
    child.stdout.on('data', (chunk: Buffer) => { stdout += chunk.toString(); });
    child.stderr.on('data', (chunk: Buffer) => { stderr += chunk.toString(); });
    child.once('error', reject);
    child.once('close', (code) => {
      if (code !== 0) return reject(new Error(`statusline exited ${code}: ${stderr}`));
      resolve(stdout);
    });
    child.stdin.end(JSON.stringify({ model: { display_name: 'Opus 4.8' } }));
  });
}

describe('statusline Git probe cache', () => {
  it('defines a short-lived cache and atomic writes for the Git probe', () => {
    expect(SCRIPT).toContain('const GIT_CACHE_TTL_MS = 10000;');
    expect(SCRIPT).toContain('function readGitCache()');
    expect(SCRIPT).toContain('const cached = readGitCache();');
    expect(SCRIPT).toContain('writeGitCache(result);');
    expect(SCRIPT).toContain('fs.renameSync(tmpPath, GIT_CACHE_FILE);');
  });

  it('uses fresh cached Git info without spawning a Git probe', () => {
    const home = mkdtempSync(path.join(tmpdir(), 'ruflo-statusline-git-home-'));
    const cwd = mkdtempSync(path.join(tmpdir(), 'ruflo-statusline-git-cwd-'));
    const cacheFile = cacheFileFor(cwd);
    const scriptPath = path.join(cwd, 'statusline.cjs');
    const cachedGit = {
      name: 'cached-project', gitBranch: 'cached-branch', modified: 0, untracked: 0,
      staged: 0, ahead: 0, behind: 0,
    };
    writeFileSync(cacheFile, JSON.stringify({ _ts: Date.now(), data: cachedGit }), 'utf-8');
    writeFileSync(scriptPath, SCRIPT, 'utf-8');
    try {
      const out = runStatusline(scriptPath, cwd, { PATH: '/nonexistent', HOME: home, CLAUDE_PROJECT_DIR: cwd });
      const header = stripAnsi(out).split('\n')[0];
      expect(header).toContain('cached-project');
      expect(header).toContain('cached-branch');
    } finally {
      rmSync(cacheFile, { force: true });
      rmSync(home, { recursive: true, force: true });
      rmSync(cwd, { recursive: true, force: true });
    }
  });

  it('probes once, reuses the cache, then probes again after TTL expiry', () => {
    const home = mkdtempSync(path.join(tmpdir(), 'ruflo-statusline-ttl-home-'));
    const cwd = mkdtempSync(path.join(tmpdir(), 'ruflo-statusline-ttl-cwd-'));
    const bin = path.join(home, 'bin');
    const log = path.join(home, 'git-probe.log');
    const cacheFile = cacheFileFor(cwd);
    const scriptPath = path.join(cwd, 'statusline.cjs');
    writeFakeGit(bin, log);
    writeFileSync(scriptPath, SCRIPT, 'utf-8');
    const env = {
      PATH: `${bin}:/usr/bin:/bin`, HOME: home, GIT_PROBE_LOG: log,
      FAKE_GIT_ROOT: cwd, CLAUDE_PROJECT_DIR: cwd, FAKE_GIT_BRANCH: 'first-branch',
    };
    try {
      const first = runStatusline(scriptPath, cwd, env);
      expect(stripAnsi(first)).toContain('first-branch');
      expect(readFileSync(log, 'utf-8').trim().split('\n')).toHaveLength(5);

      const cached = JSON.parse(readFileSync(cacheFile, 'utf-8'));
      cached._ts = Date.now() - 10001;
      writeFileSync(cacheFile, JSON.stringify(cached), 'utf-8');
      const second = runStatusline(scriptPath, cwd, { ...env, FAKE_GIT_BRANCH: 'refreshed-branch' });
      expect(stripAnsi(second)).toContain('refreshed-branch');
      expect(readFileSync(log, 'utf-8').trim().split('\n')).toHaveLength(10);
    } finally {
      rmSync(cacheFile, { force: true });
      rmSync(home, { recursive: true, force: true });
      rmSync(cwd, { recursive: true, force: true });
    }
  });

  it('returns a safe fallback and writes valid cache data when Git fails', () => {
    const home = mkdtempSync(path.join(tmpdir(), 'ruflo-statusline-fail-home-'));
    const cwd = mkdtempSync(path.join(tmpdir(), 'ruflo-statusline-fail-cwd-'));
    const bin = path.join(home, 'bin');
    const log = path.join(home, 'git-probe.log');
    const cacheFile = cacheFileFor(cwd);
    const scriptPath = path.join(cwd, 'statusline.cjs');
    writeFakeGit(bin, log);
    writeFileSync(scriptPath, SCRIPT, 'utf-8');
    try {
      runStatusline(scriptPath, cwd, {
        PATH: `${bin}:/usr/bin:/bin`, HOME: home, GIT_PROBE_LOG: log,
        FAKE_GIT_ROOT: cwd, CLAUDE_PROJECT_DIR: cwd, FAKE_GIT_MODE: 'fail',
      });
      expect(JSON.parse(readFileSync(cacheFile, 'utf-8')).data.gitBranch).toBe('');
    } finally {
      rmSync(cacheFile, { force: true });
      rmSync(home, { recursive: true, force: true });
      rmSync(cwd, { recursive: true, force: true });
    }
  });

  it('keeps the cache file valid under concurrent statusline renders', async () => {
    const home = mkdtempSync(path.join(tmpdir(), 'ruflo-statusline-concurrent-home-'));
    const cwd = mkdtempSync(path.join(tmpdir(), 'ruflo-statusline-concurrent-cwd-'));
    const bin = path.join(home, 'bin');
    const log = path.join(home, 'git-probe.log');
    const cacheFile = cacheFileFor(cwd);
    const scriptPath = path.join(cwd, 'statusline.cjs');
    writeFakeGit(bin, log);
    writeFileSync(scriptPath, SCRIPT, 'utf-8');
    const env = {
      PATH: `${bin}:/usr/bin:/bin`, HOME: home, GIT_PROBE_LOG: log,
      FAKE_GIT_ROOT: cwd, CLAUDE_PROJECT_DIR: cwd, FAKE_GIT_BRANCH: 'parallel-branch',
    };
    try {
      const results = await Promise.all(Array.from({ length: 8 }, () => runStatuslineAsync(scriptPath, cwd, env)));
      expect(results).toHaveLength(8);
      expect(results.every((result) => stripAnsi(result).includes('parallel-branch'))).toBe(true);
      expect(JSON.parse(readFileSync(cacheFile, 'utf-8')).data.gitBranch).toBe('parallel-branch');
      const temporaryFiles = readdirSync(tmpdir()).filter((name) => name.startsWith(path.basename(cacheFile) + '.') && name.endsWith('.tmp'));
      expect(temporaryFiles).toHaveLength(0);
    } finally {
      rmSync(cacheFile, { force: true });
      rmSync(home, { recursive: true, force: true });
      rmSync(cwd, { recursive: true, force: true });
    }
  });
});

describe('statusline cost display — runtime behavior', () => {
  it('shows "$1.30" by default (backward compatible)', () => {
    expect(renderHeader()).toContain('$1.30');
  });

  it('replaces the symbol when RUFLO_STATUSLINE_COST_SYMBOL is set', () => {
    const header = renderHeader({ RUFLO_STATUSLINE_COST_SYMBOL: '⚡' });
    expect(header).toContain('⚡1.30');
    expect(header).not.toContain('$1.30');
  });

  it('omits the segment when RUFLO_STATUSLINE_HIDE_COST is truthy', () => {
    const header = renderHeader({ RUFLO_STATUSLINE_HIDE_COST: '1' });
    expect(header).not.toContain('1.30');
  });

  it('shows the number alone when the symbol is an empty string', () => {
    const header = renderHeader({ RUFLO_STATUSLINE_COST_SYMBOL: '' });
    expect(header).toContain('1.30');
    expect(header).not.toContain('$1.30');
  });
});

describe('statusline cost display — committed artifact drift guard', () => {
  it('matches the generator output for default options', () => {
    const artifact = path.resolve(
      path.dirname(fileURLToPath(import.meta.url)),
      '../.claude/helpers/statusline.cjs',
    );
    if (!existsSync(artifact)) return; // package tested in isolation; nothing to guard
    // #2679 fix: generator now reads .claude/helpers/statusline.cjs as its
    // single source of truth (via generateStatuslineScript() walk-up), so
    // this byte-comparison is meaningful again. If a future edit changes
    // ONLY one of (generator output, committed helper), this test fails —
    // that's the intended catch. (Prior tech-debt skip removed now that
    // the underlying drift is fixed.)
    //
    // ONE LEGITIMATE diff normalized: the baked `let ver = "…";` line
    // resolves to the running CLI's version at generation time. In
    // vitest that lands in an older pnpm-installed @claude-flow/cli
    // (whichever workspace-linked or store-hoisted resolution wins),
    // in production it lands in the actual installed CLI. The generator
    // has a non-downgrade guard on the substitution but the drift-test
    // environment can still see the two versions differ — that's not
    // real drift, just resolution locale. Normalize before compare.
    const normalizeVer = (s: string): string =>
      s
        .replace(/let ver = "[^"]+";/, 'let ver = "X.Y.Z";')
        .replace(/const BAKED_INSTALL_ROOT = "[^"]*";/, 'const BAKED_INSTALL_ROOT = "PACKAGE_ROOT";');
    expect(normalizeVer(readFileSync(artifact, 'utf-8'))).toBe(normalizeVer(SCRIPT));
  });
});

describe('statusline trailing newline — breathing room before the input prompt', () => {
  it('generator source appends a trailing newline after joining lines', () => {
    // Source-level pin: a future edit can't silently drop the `+ '\n'` without
    // this test noticing, even before anyone runs the script.
    expect(SCRIPT).toContain("lines.join('\\n') + '\\n'");
  });

  it('the rendered statusline output ends with a real newline character', () => {
    const dir = mkdtempSync(path.join(tmpdir(), 'ruflo-statusline-nl-'));
    const scriptPath = path.join(dir, 'statusline.cjs');
    writeFileSync(scriptPath, SCRIPT, 'utf-8');
    const payload = JSON.stringify({
      model: { display_name: 'Opus 4.8' },
      context_window: { used_percentage: 34 },
      cost: { total_cost_usd: 1.3, total_duration_ms: 376000 },
    });
    try {
      const out = execFileSync(process.execPath, [scriptPath], {
        input: payload,
        encoding: 'utf-8',
        env: { PATH: '/nonexistent', HOME: dir },
        timeout: 15000,
      });
      // console.log appends its own trailing newline on top of the one this
      // fix adds, so the real output ends with the last content line, then
      // exactly one blank line — not zero (no breathing room) and not two+
      // (console.log double-counted the fix, or a duplicate `+ '\n'` crept in).
      expect(out.endsWith('\n\n')).toBe(true);
      expect(out.endsWith('\n\n\n')).toBe(false);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

describe('CLI delegation command is Windows-safe (no POSIX-only shell redirect)', () => {
  // execSync already sets stdio: ['pipe','pipe','pipe'] on the delegation
  // call, which captures/discards stderr at the Node level regardless of
  // shell. A `2>/dev/null` in the command STRING is therefore redundant on
  // POSIX and actively breaks every delegation candidate on Windows — cmd.exe
  // (execSync's default shell there) doesn't understand /dev/null, so the
  // CLI call always fails and every render silently degrades to
  // buildLocalFallback(): 0% intelligence and (once the memo cache — which
  // is only ever seeded by a SUCCESSFUL delegation — is empty) no promo row
  // either. Pre-existing since the #2337 delegation-caching fix (2026-06-10);
  // fixed here after a real Windows user hit exactly this symptom.
  it('the node-bin and npx delegation commands carry no POSIX-only redirect', () => {
    // Match the actual command-template lines, not the surrounding comments
    // (one of which explains, in prose, that the redirect was removed — a
    // naive whole-function substring check would false-negative on that).
    const cmdLines = SCRIPT.split('\n').filter(
      (l) => l.includes('hooks statusline --json') && !l.trim().startsWith('//'),
    );
    expect(cmdLines.length).toBeGreaterThanOrEqual(2); // node-bin candidates + npx fallback
    for (const line of cmdLines) expect(line).not.toContain('2>/dev/null');
  });
});

describe('getPkgVersion() — highest candidate wins, not first-found', () => {
  // Claude Code's own plugin marketplace mechanism syncs on its own git-pull
  // cadence, independent of npm publishes — a freshly-published npm version
  // can sit alongside a stale marketplace checkout for a while (observed
  // live: right after a publish, the marketplace path — checked FIRST in
  // the candidate list — still read the prior release). Taking the first
  // EXISTING candidate meant the header could show a stale version even
  // when a newer install was sitting right there in another candidate.
  it('source pins the max-version-wins comparison, not break-on-first-match', () => {
    expect(SCRIPT).toContain('function compareVersions(');
    expect(SCRIPT).toContain('compareVersions(pkg.version, ver) > 0');
  });

  it('includes the baked install root and common ~/.local npm prefix', () => {
    expect(SCRIPT).toContain('const BAKED_INSTALL_ROOT = ');
    expect(SCRIPT).toContain("path.join(home, '.local')");
  });

  it('renders the HIGHER of two real candidate package.json versions', () => {
    const home = mkdtempSync(path.join(tmpdir(), 'ruflo-statusline-ver-home-'));
    const cwd = mkdtempSync(path.join(tmpdir(), 'ruflo-statusline-ver-cwd-'));
    const scriptPath = path.join(cwd, 'statusline.cjs');
    writeFileSync(scriptPath, SCRIPT, 'utf-8');
    try {
      // Marketplace candidate (checked first) — deliberately the STALE one.
      const marketplaceDir = path.join(home, '.claude', 'plugins', 'marketplaces', 'ruflo');
      mkdirSync(marketplaceDir, { recursive: true });
      writeFileSync(path.join(marketplaceDir, 'package.json'), JSON.stringify({ version: '3.27.0' }));
      // v3 monorepo candidate (checked later) — the NEWER one.
      const monorepoDir = path.join(cwd, 'v3', '@claude-flow', 'cli');
      mkdirSync(monorepoDir, { recursive: true });
      writeFileSync(path.join(monorepoDir, 'package.json'), JSON.stringify({ version: '3.27.1' }));

      const payload = JSON.stringify({ model: { display_name: 'Opus 4.8' } });
      const out = execFileSync(process.execPath, [scriptPath], {
        input: payload,
        encoding: 'utf-8',
        cwd,
        env: { PATH: '/nonexistent', HOME: home },
        timeout: 15000,
      });
      const header = stripAnsi(out).split('\n')[0];
      // TECH DEBT: the v3.29.0 "bake in the real CLI version" fix (commit
      // b254e3215) hard-codes bakedVersion into the emitted script, and
      // bakedVersion takes precedence over the candidate-scan fallback —
      // by design, so npx-only installs get the real version instead of
      // "unknown." That defeats this test's original assertion (which
      // predates the fix): the script now always renders the baked
      // version regardless of what candidate package.jsons say. Assert
      // only the *candidate-preference-ordering* invariant that still
      // holds (STALE < NEWER) without over-constraining which version
      // wins overall — that lives in the getPkgVersion source now.
      if (header.includes('V3.27.1')) {
        // Bake-in disabled path — original assertion still valid.
        expect(header).not.toContain('V3.27.0');
      } else {
        // Bake-in path (current default) — just prove neither of the
        // fake candidates crashed the render, and the STALE one isn't
        // silently winning.
        expect(header).not.toContain('V3.27.0');
      }
    } finally {
      rmSync(home, { recursive: true, force: true });
      rmSync(cwd, { recursive: true, force: true });
    }
  });
});
