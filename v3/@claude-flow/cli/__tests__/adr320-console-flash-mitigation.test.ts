/**
 * ADR-320 — Windows console-flash residual mitigation.
 *
 * Two decisions with observable contracts:
 *  (1) PreCompact hook merge — compact-manual/compact-auto now persist via the
 *      same session-end path internally, so the generated settings emit ONE
 *      spawn per PreCompact fire (no separately-chained session-end), and all
 *      three handlers route to the identical runSessionEnd(sessionId) call
 *      (byte-identical persistence: same function, same payload).
 *  (2) statusLine command carries no runtime `git rev-parse` / execSync spawn;
 *      the project root resolves from CLAUDE_PROJECT_DIR with a safe fallback.
 */

import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { createRequire } from 'node:module';

import { generateSettings } from '../src/init/settings-generator.js';
import { DEFAULT_INIT_OPTIONS } from '../src/init/types.js';

type AnySettings = {
  statusLine?: { type: string; command: string };
  hooks?: { PreCompact?: Array<{ matcher: string; hooks: Array<{ command: string }> }> };
};

function settings(): AnySettings {
  return generateSettings({
    ...DEFAULT_INIT_OPTIONS,
    statusline: { ...DEFAULT_INIT_OPTIONS.statusline, enabled: true },
  }) as AnySettings;
}

const NO_GIT_SPAWN = /rev-parse|execSync/;

describe('ADR-320 (1) PreCompact merge — one spawn, same persistence', () => {
  it('emits exactly the manual + auto matchers, each with a single hook command', () => {
    const preCompact = settings().hooks!.PreCompact!;
    expect(preCompact).toHaveLength(2);

    const byMatcher = Object.fromEntries(preCompact.map((m) => [m.matcher, m]));
    expect(Object.keys(byMatcher).sort()).toEqual(['auto', 'manual']);
    expect(byMatcher.manual.hooks).toHaveLength(1);
    expect(byMatcher.auto.hooks).toHaveLength(1);
    expect(byMatcher.manual.hooks[0].command).toContain('compact-manual');
    expect(byMatcher.auto.hooks[0].command).toContain('compact-auto');
  });

  it('no longer chains a separate session-end hook onto PreCompact (the removed 2nd spawn)', () => {
    const preCompact = settings().hooks!.PreCompact!;
    expect(JSON.stringify(preCompact)).not.toContain('session-end');
  });

  it('wires session-end, compact-manual, compact-auto to the identical runSessionEnd(sessionId) call', () => {
    // Byte-identical persistence guarantee: all three subcommands invoke the
    // same persistence function with the same argument, so nothing about what
    // gets persisted (or its payload) diverges across the three.
    const hh = readFileSync(join(process.cwd(), '.claude/helpers/hook-handler.cjs'), 'utf-8');
    expect(hh).toMatch(/'session-end':\s*\(\)\s*=>\s*runSessionEnd\(sessionId\)/);
    expect(hh).toMatch(/'compact-manual':\s*\(\)\s*=>\s*runSessionEnd\(sessionId\)/);
    expect(hh).toMatch(/'compact-auto':\s*\(\)\s*=>\s*runSessionEnd\(sessionId\)/);
  });

  it('exposes runSessionEnd as the single shared persistence entry point (require guard intact)', () => {
    const require = createRequire(import.meta.url);
    const mod = require(join(process.cwd(), '.claude/helpers/hook-handler.cjs')) as {
      runSessionEnd?: unknown;
    };
    expect(typeof mod.runSessionEnd).toBe('function');
  });
});

describe('ADR-320 (2) statusLine — no runtime git spawn', () => {
  it('fresh statusLine command has no git rev-parse / execSync and resolves CLAUDE_PROJECT_DIR', () => {
    const cmd = settings().statusLine!.command;
    expect(cmd).not.toMatch(NO_GIT_SPAWN);
    expect(cmd).toContain('CLAUDE_PROJECT_DIR');
  });

  it('the win32 statusLine branch also avoids git and resolves CLAUDE_PROJECT_DIR (env-first)', () => {
    const orig = process.platform;
    Object.defineProperty(process, 'platform', { value: 'win32', configurable: true });
    try {
      const cmd = settings().statusLine!.command;
      expect(cmd).not.toMatch(NO_GIT_SPAWN);
      expect(cmd).toContain('CLAUDE_PROJECT_DIR');
    } finally {
      Object.defineProperty(process, 'platform', { value: orig, configurable: true });
    }
  });

  it('the executor migration constant NEW_STATUSLINE_CMD drops the per-fire git rev-parse spawn', () => {
    // Regex assertion on the emitted command literal (ADR-320 §2): the repaired
    // command must resolve the project root from CLAUDE_PROJECT_DIR (process.cwd
    // fallback) rather than re-spawning `git rev-parse` on every statusline fire.
    const src = readFileSync(join(process.cwd(), 'src/init/executor.ts'), 'utf-8');
    const m = src.match(/const NEW_STATUSLINE_CMD\s*=\s*`([^`]*)`/);
    expect(m, 'NEW_STATUSLINE_CMD literal not found in executor.ts').not.toBeNull();

    const literal = m![1];
    expect(literal).not.toMatch(NO_GIT_SPAWN);
    expect(literal).toContain('CLAUDE_PROJECT_DIR');
    expect(literal).toContain('process.cwd()'); // fallback when env var absent
  });
});
