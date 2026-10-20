/**
 * ADR-404 — the CLI surface through the built binary: `init --mods`,
 * `doctor --component mods`, and `mods status|uninstall`. Skipped where the
 * CLI is not built, as the other bin-level tests are (#2952).
 */
import { describe, it, expect } from 'vitest';
import { execFileSync } from 'node:child_process';
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { delimiter, join } from 'node:path';
import { tmpdir } from 'node:os';

const CLI_BIN = fileURLToPath(new URL('../../bin/cli.js', import.meta.url));
const CLI_BUILT = existsSync(CLI_BIN);

function isolated() {
  const home = mkdtempSync(join(tmpdir(), 'ruflo-mods-bin-home-'));
  const cwd = mkdtempSync(join(tmpdir(), 'ruflo-mods-bin-'));
  const bin = join(home, 'bin');
  mkdirSync(bin, { recursive: true });
  writeFileSync(join(bin, 'codex'), '#!/bin/sh\nexit 1\n');
  chmodSync(join(bin, 'codex'), 0o755);
  const env = { ...process.env, HOME: home, USERPROFILE: home, CLAUDE_CONFIG_DIR: join(home, '.claude'), CODEX_HOME: join(home, '.codex'), PATH: `${bin}${delimiter}${process.env.PATH ?? ''}`, CI: '1' };
  const run = (...args: string[]) => execFileSync(process.execPath, [CLI_BIN, ...args], { cwd, env, encoding: 'utf8', timeout: 120_000 });
  return { home, cwd, run, done: () => { rmSync(home, { recursive: true, force: true }); rmSync(cwd, { recursive: true, force: true }); } };
}

describe.skipIf(!CLI_BUILT)('ADR-404 mods through the built CLI', () => {
  it('bare init enables the mod plugins in the committed settings beside the classic hooks; uninstall reverses exactly', () => {
    const t = isolated();
    try {
      // VITEST is in the spawned env, so init skips the claude step and prints the manual commands.
      const out = t.run('init', '--no-signup', '--no-global', '--no-codex-detect');
      expect(out).toContain('claude plugin step skipped (VITEST set)');
      expect(out).toContain('claude plugin install ruflo-mods@ruflo --scope project');
      expect(out).toContain('with them off, or the rollout switch off, they do nothing and the classic hooks keep every event');
      const shared = JSON.parse(readFileSync(join(t.cwd, '.claude', 'settings.json'), 'utf8'));
      for (const id of ['ruflo-mods@ruflo', 'ruflo-swarm@ruflo', 'ruflo-console@ruflo']) expect(shared.enabledPlugins[id]).toBe(true);
      expect(shared.extraKnownMarketplaces.ruflo.source).toEqual({ source: 'github', repo: 'ruvnet/ruflo' });
      expect(shared.env.CLAUDE_CODE_ENABLE_FUNCTION_HOOKS).toBe('1');
      // Classic hooks are untouched: still the default and the fallback.
      expect(JSON.stringify(shared.hooks.UserPromptSubmit)).toContain('hook-handler.cjs');
      expect(existsSync(join(t.cwd, '.claude', 'settings.local.json'))).toBe(false);

      // No marketplace clone in this isolated config yet: a warning (Claude
      // Code clones it at its next interactive start), not a failure.
      // Startup integrity warnings begin with [WARN]; the JSON array begins on its own line.
      const statusOutput = t.run('mods', 'status', '--json');
      const status = JSON.parse(statusOutput.match(/^\[\s*\n[\s\S]*^\]$/m)?.[0] ?? statusOutput);
      const named = (name: string) => status.find((f: { name: string }) => f.name === name);
      expect(named('ruflo-mods plugin').status).toBe('pass'); // enabled in settings
      expect(named('ruflo marketplace')).toMatchObject({ status: 'warn', fix: expect.stringContaining('--scope project') });
      expect(t.run('doctor', '--component', 'mods')).toContain('ruflo mods (ADR-404)');

      const before = { ...shared };
      for (const k of ['enabledPlugins', 'extraKnownMarketplaces']) delete (before as Record<string, unknown>)[k];
      const env = { ...shared.env };
      delete env.CLAUDE_CODE_ENABLE_FUNCTION_HOOKS;
      if (Object.keys(env).length) (before as Record<string, unknown>).env = env;
      else delete (before as Record<string, unknown>).env;
      t.run('mods', 'uninstall');
      expect(JSON.parse(readFileSync(join(t.cwd, '.claude', 'settings.json'), 'utf8'))).toEqual(before);
    } finally {
      t.done();
    }
  });

  it('init --no-mods writes none of the mod keys', () => {
    const t = isolated();
    try {
      t.run('init', '--no-mods', '--no-signup', '--no-global', '--no-codex-detect');
      const shared = JSON.parse(readFileSync(join(t.cwd, '.claude', 'settings.json'), 'utf8'));
      expect(shared.enabledPlugins?.['ruflo-mods@ruflo']).toBeUndefined();
      expect(shared.extraKnownMarketplaces?.ruflo).toBeUndefined();
      expect(shared.env?.CLAUDE_CODE_ENABLE_FUNCTION_HOOKS).toBeUndefined();
      expect(existsSync(join(t.cwd, '.claude-flow', 'mods', 'install.json'))).toBe(false);
      expect(t.run('doctor', '--component', 'mods')).toContain('not enabled; classic hooks handle every event');
    } finally {
      t.done();
    }
  });
});
