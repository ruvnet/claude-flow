/**
 * #2661 root-fix — one-time upgrade migration warning.
 *
 * A pre-existing multi-daemon fleet with AI workers enabled somewhere in it
 * is the exact P0 shape the issue describes. This must warn exactly ONCE
 * ever (a persisted marker, not a per-command check) and only for that
 * specific risky shape — never for a harmless multi-daemon fleet where AI
 * workers are off everywhere (the existing always-shown notice already
 * covers that case, and duplicating it here would just be noise).
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync, mkdirSync, writeFileSync, existsSync, readFileSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import { maybeShowMultiDaemonMigrationWarning } from '../src/commands/daemon.js';

describe('#2661 root-fix — maybeShowMultiDaemonMigrationWarning', () => {
  let dir: string;
  let markerFile: string;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'migration-warning-test-'));
    markerFile = join(dir, '.claude-flow', 'multi-daemon-warning-shown.json');
  });

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  const wtWithState = (aiWorkersEnabled: boolean): string => {
    const wt = mkdtempSync(join(dir, 'wt-'));
    mkdirSync(join(wt, '.claude-flow'), { recursive: true });
    writeFileSync(join(wt, '.claude-flow', 'daemon-state.json'), JSON.stringify({ config: { aiWorkersEnabled } }));
    return wt;
  };

  it('does nothing for a single daemon (no fanout)', async () => {
    const wt = wtWithState(true);
    await maybeShowMultiDaemonMigrationWarning({
      markerFile,
      fleetScanner: async () => [{ pid: 1, workspace: wt }],
    });
    expect(existsSync(markerFile)).toBe(false);
  });

  it('writes the marker but shows nothing for a multi-daemon fleet with AI workers off everywhere', async () => {
    const wt1 = wtWithState(false);
    const wt2 = wtWithState(false);
    await maybeShowMultiDaemonMigrationWarning({
      markerFile,
      fleetScanner: async () => [{ pid: 1, workspace: wt1 }, { pid: 2, workspace: wt2 }],
    });
    expect(existsSync(markerFile)).toBe(true);
    const marker = JSON.parse(readFileSync(markerFile, 'utf-8'));
    expect(marker.anyAiEnabled).toBe(false);
  });

  it('writes the marker for a multi-daemon fleet where AT LEAST ONE has AI workers enabled', async () => {
    const wt1 = wtWithState(false);
    const wt2 = wtWithState(true);
    await maybeShowMultiDaemonMigrationWarning({
      markerFile,
      fleetScanner: async () => [{ pid: 1, workspace: wt1 }, { pid: 2, workspace: wt2 }],
    });
    expect(existsSync(markerFile)).toBe(true);
    const marker = JSON.parse(readFileSync(markerFile, 'utf-8'));
    expect(marker.anyAiEnabled).toBe(true);
    expect(marker.fleetSize).toBe(2);
  });

  it('is a true ONE-TIME warning — never re-checks the fleet once the marker exists', async () => {
    let scanCount = 0;
    const scanner = async () => {
      scanCount++;
      return [{ pid: 1, workspace: wtWithState(true) }, { pid: 2, workspace: wtWithState(true) }];
    };

    await maybeShowMultiDaemonMigrationWarning({ markerFile, fleetScanner: scanner });
    expect(scanCount).toBe(1);

    await maybeShowMultiDaemonMigrationWarning({ markerFile, fleetScanner: scanner });
    expect(scanCount).toBe(1); // marker already exists — scanner not called again
  });

  it('tolerates an unreadable/missing daemon-state.json without throwing', async () => {
    const wt = mkdtempSync(join(dir, 'wt-nostate-'));
    await expect(
      maybeShowMultiDaemonMigrationWarning({
        markerFile,
        fleetScanner: async () => [{ pid: 1, workspace: wt }, { pid: 2, workspace: null }],
      })
    ).resolves.toBeUndefined();
    expect(existsSync(markerFile)).toBe(true); // still writes the marker
  });

  it('never throws even if the fleet scanner itself throws', async () => {
    await expect(
      maybeShowMultiDaemonMigrationWarning({
        markerFile,
        fleetScanner: async () => { throw new Error('ps failed'); },
      })
    ).resolves.toBeUndefined();
  });
});
