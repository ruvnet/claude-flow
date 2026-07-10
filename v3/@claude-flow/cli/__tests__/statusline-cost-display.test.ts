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
import { mkdtempSync, writeFileSync, readFileSync, existsSync, rmSync } from 'fs';
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
    expect(readFileSync(artifact, 'utf-8')).toBe(SCRIPT);
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
