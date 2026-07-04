/**
 * Version-stamped critical-helper auto-refresh.
 *
 * The propagation gap: Claude Code hooks run the project-local
 * `.claude/helpers/*.cjs`, not the npm package, so hook fixes don't reach
 * existing users without a manual re-init. This test proves the stamp-and-
 * refresh path closes it: a stale-stamped project silently re-copies the
 * current helpers on the next CLI startup; a current one is a no-op; and a
 * non-ruflo directory is never touched.
 */
import { describe, it, expect, beforeEach } from 'vitest';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

import { autoRefreshHelpersIfStale, getInstalledCliVersion, HELPERS_STAMP_FILE } from '../src/init/helper-refresh.js';

function makeProject(): { cwd: string; helpersDir: string } {
  const cwd = mkdtempSync(join(tmpdir(), 'helper-refresh-'));
  const helpersDir = join(cwd, '.claude', 'helpers');
  mkdirSync(helpersDir, { recursive: true });
  return { cwd, helpersDir };
}

describe('autoRefreshHelpersIfStale', () => {
  let version: string;
  beforeEach(() => { version = getInstalledCliVersion(); });

  it('refreshes a project whose helpers are stamped with an older version', async () => {
    const { cwd, helpersDir } = makeProject();
    // Old, hardcoded-success hook-handler + a stale stamp.
    writeFileSync(join(helpersDir, 'hook-handler.cjs'), 'intelligence.feedback(true); // OLD, no failure capture\n');
    writeFileSync(join(helpersDir, HELPERS_STAMP_FILE), '0.0.1-old');

    const r = await autoRefreshHelpersIfStale(cwd);
    expect(r.refreshed).toBe(true);
    expect(r.from).toBe('0.0.1-old');
    expect(r.to).toBe(version);

    // The stamp now matches the installed version.
    expect(readFileSync(join(helpersDir, HELPERS_STAMP_FILE), 'utf-8').trim()).toBe(version);
    // And the copied hook-handler carries the NEW failure-capture logic.
    const refreshed = readFileSync(join(helpersDir, 'hook-handler.cjs'), 'utf-8');
    expect(refreshed).toMatch(/toolFailed/);
    expect(refreshed).not.toContain('// OLD, no failure capture');
  });

  it('is a no-op when the stamp already matches the installed version', async () => {
    const { cwd, helpersDir } = makeProject();
    const marker = 'CURRENT-HANDLER-DO-NOT-OVERWRITE';
    writeFileSync(join(helpersDir, 'hook-handler.cjs'), marker);
    writeFileSync(join(helpersDir, HELPERS_STAMP_FILE), version);

    const r = await autoRefreshHelpersIfStale(cwd);
    expect(r.refreshed).toBe(false);
    // Untouched — the fast path never copied over our marker file.
    expect(readFileSync(join(helpersDir, 'hook-handler.cjs'), 'utf-8')).toBe(marker);
  });

  it('refreshes an UNSTAMPED (pre-feature) project on first run', async () => {
    const { cwd, helpersDir } = makeProject();
    writeFileSync(join(helpersDir, 'hook-handler.cjs'), 'intelligence.feedback(true);\n');
    // no stamp file at all

    const r = await autoRefreshHelpersIfStale(cwd);
    expect(r.refreshed).toBe(true);
    expect(r.from).toBe('(unstamped)');
    expect(existsSync(join(helpersDir, HELPERS_STAMP_FILE))).toBe(true);
  });

  it('is a safe no-op outside a ruflo project (never creates files)', async () => {
    const cwd = mkdtempSync(join(tmpdir(), 'not-ruflo-'));
    const r = await autoRefreshHelpersIfStale(cwd);
    expect(r.refreshed).toBe(false);
    expect(existsSync(join(cwd, '.claude'))).toBe(false); // did not scaffold anything
  });
});
