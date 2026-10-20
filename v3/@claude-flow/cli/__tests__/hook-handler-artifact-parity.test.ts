/**
 * Drift guard: `.claude/helpers/hook-handler.cjs` (root) vs.
 * `v3/@claude-flow/cli/.claude/helpers/hook-handler.cjs` (package).
 *
 * These are two committed copies of the same critical helper (ADR-174) — the
 * package copy is what ships; the root copy is this repo's own dogfood
 * install. They are NOT generated from `helpers-generator.ts`'s
 * `generateHookHandler()` — that function is a deliberately simpler inline
 * fallback used only when copying the real file from the package fails
 * (see its own doc comment), so comparing against it would be the wrong
 * guard. The two committed .cjs files themselves must simply never diverge:
 * a prior session's hand-edits DID diverge (the fix for the promo-cache bug
 * and the ADR-312/313 rate-limit nudge landed in the package copy but never
 * got synced to root), and the drift went unnoticed until this test was
 * written, which is exactly the failure mode this guards against.
 */

import { describe, it, expect } from 'vitest';
import { readFileSync, existsSync, mkdtempSync, writeFileSync, rmSync } from 'fs';
import { spawnSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import path from 'path';
import { fileURLToPath } from 'url';
import { generateHookHandler } from '../src/init/helpers-generator.js';

describe('hook-handler.cjs — root/package artifact parity', () => {
  it('the root and package copies are byte-identical', () => {
    const here = path.dirname(fileURLToPath(import.meta.url));
    const rootArtifact = path.resolve(here, '../../../../.claude/helpers/hook-handler.cjs');
    const pkgArtifact = path.resolve(here, '../.claude/helpers/hook-handler.cjs');
    if (!existsSync(rootArtifact)) return; // package tested in isolation; nothing to guard
    expect(readFileSync(rootArtifact, 'utf-8')).toBe(readFileSync(pkgArtifact, 'utf-8'));
  });
});

describe('hook-handler.cjs — resolveCliBinForHook validates a real dist, not just bin/cli.js', () => {
  // Claude Code's own plugin marketplace mechanism installs by git clone/pull
  // with no build step, so ~/.claude/plugins/marketplaces/ruflo is a
  // source-only checkout by construction: bin/cli.js exists on disk, but
  // importing dist/src/index.js from it throws MODULE_NOT_FOUND on every
  // real command (confirmed live — only --version happens to survive it).
  // Before this fix, resolveCliBinForHook() picked that doomed candidate and
  // spawnDetachedFunnelRefresh()/spawnDetachedAdvisorRefresh() had no
  // fallback, so a marketplace install's promo/advisor refresh silently
  // never fired, on any OS.
  const here = path.dirname(fileURLToPath(import.meta.url));
  const rootArtifact = path.resolve(here, '../../../../.claude/helpers/hook-handler.cjs');
  const pkgArtifact = path.resolve(here, '../.claude/helpers/hook-handler.cjs');
  const source = readFileSync(existsSync(rootArtifact) ? rootArtifact : pkgArtifact, 'utf-8');

  it('checks for a compiled dist/src/index.js before trusting a candidate', () => {
    expect(source).toContain("path.join(path.dirname(p), '..', 'dist', 'src', 'index.js')");
  });

  it('falls back to npx (not a silent no-op) when no local candidate has a real dist', () => {
    const idx = source.indexOf('function spawnDetachedHookRefresh');
    expect(idx).toBeGreaterThan(-1);
    const body = source.slice(idx, idx + 700);
    expect(body).toContain('cliSpawnArgs(resolveCliBinForHook()');
    expect(body).not.toContain('if (!cliBin) return;');
    // cliSpawnArgs() builds the npx fallback when no local candidate resolves.
    const argsIdx = source.indexOf('function cliSpawnArgs');
    expect(argsIdx).toBeGreaterThan(-1);
    const argsBody = source.slice(argsIdx, argsIdx + 400);
    expect(argsBody).toContain('@claude-flow/cli');
    expect(argsBody).toContain('--prefer-offline');
  });
});

describe('generateHookHandler() fallback — funnel refresh wiring (#2661-adjacent)', () => {
  // Unlike the committed .cjs artifacts above, this fallback IS generated
  // from generateHookHandler() directly — it's the inline template used
  // when copying the real file from the package fails. Its own
  // session-restore handler must still spawn the funnel refresh, or a
  // fallback-only install would never populate the promo cache.
  const source = generateHookHandler();

  it('defines spawnFunnelRefresh as a detached, unref\'d, best-effort spawn', () => {
    expect(source).toContain('function spawnFunnelRefresh()');
    expect(source).toContain('detached: true');
    expect(source).toContain('child.unref()');
  });

  it('wires spawnFunnelRefresh() into the session-restore handler', () => {
    const idx = source.indexOf("'session-restore':");
    expect(idx).toBeGreaterThan(-1);
    const handlerBody = source.slice(idx, idx + 200);
    expect(handlerBody).toContain('spawnFunnelRefresh();');
  });

  it('is syntactically valid JavaScript', () => {
    const withoutShebang = source.replace(/^#!.*\n/, '');
    expect(() => new Function(withoutShebang)).not.toThrow();
  });
});

describe('generateHookHandler() fallback — PreToolUse blocking contract', () => {
  // Only the hook is executed. Dangerous commands are inert stdin JSON data.
  const cases = [
    ['snake_case destructive command', { tool_input: { command: 'rm -rf / --no-preserve-root' } }, 2],
    ['camelCase destructive command', { toolInput: { command: 'format c: /q /y' } }, 2],
    ['top-level destructive command', { command: ':(){:|:&};:' }, 2],
    ['tool command takes precedence over prompt', { prompt: 'safe description', tool_input: { command: 'rm -rf /' } }, 2],
    ['safe command', { tool_input: { command: 'ls -la' } }, 0],
    ['empty payload', {}, 0],
    ['null command', { tool_input: { command: null } }, 0],
    ['object command', { tool_input: { command: {} } }, 0],
  ] as const;

  it.each(cases)('%s', (_name, input, status) => {
    const dir = mkdtempSync(path.join(tmpdir(), 'ruflo-pre-bash-'));
    try {
      const helper = path.join(dir, 'hook-handler.cjs');
      writeFileSync(helper, generateHookHandler());
      const result = spawnSync(process.execPath, [helper, 'pre-bash'], {
        input: JSON.stringify(input), encoding: 'utf8', cwd: dir, timeout: 10_000,
        env: { ...process.env, RUFLO_MODS_OWNS: 'route,post-edit,pre-bash' },
      });
      expect(result.error).toBeUndefined();
      expect(result.status).toBe(status);
      if (status === 2) {
        expect(result.stderr).toContain('[BLOCKED]');
        expect(result.stdout).not.toContain('[OK]');
      } else {
        expect(result.stdout).toContain('[OK] Command validated');
        expect(result.stderr).not.toContain('[BLOCKED]');
      }
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
