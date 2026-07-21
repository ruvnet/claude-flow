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
import { readFileSync, existsSync } from 'fs';
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
    expect(body).toContain('@claude-flow/cli');
    expect(body).toContain('--prefer-offline');
    expect(body).not.toContain('if (!cliBin) return;');
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
