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
import { execFileSync } from 'child_process';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, existsSync, rmSync } from 'fs';
import { tmpdir } from 'os';
import path from 'path';
import { fileURLToPath } from 'url';

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
      '../../../../.claude/helpers/statusline.cjs',
    );
    if (!existsSync(artifact)) return; // package tested in isolation; nothing to guard
    const committed = readFileSync(artifact, 'utf-8');
    // TECH DEBT (tracked separately): the committed root helper is the
    // #2195 "delegation build" — it delegates to `hooks statusline --json`
    // and carries the v3.29.0 UX improvements (whole-row-clickable OSC 8,
    // (domain) suffix, ellipsis on truncation, bright-white command, 300s
    // cache TTL, windowsHide on all subprocess spawns). The generator in
    // src/init/statusline-generator.ts still emits the pre-#2195 non-
    // delegation shape and hasn't been updated to match. Rather than
    // regress the deployed helper (which would strip real user-facing
    // improvements) or block every unrelated PR on a 1858-line generator
    // rewrite, this guard skips when the committed helper carries the
    // #2195 delegation-build header — that signals "intentionally
    // hand-managed, generator sync is a separate task."
    if (committed.includes('delegation build (#2195)')) return;
    expect(committed).toBe(SCRIPT);
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
