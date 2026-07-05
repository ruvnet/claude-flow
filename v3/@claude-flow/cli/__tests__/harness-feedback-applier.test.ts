/**
 * Feedback applier — close the loop (ADR-176 phase 9).
 */
import { describe, it, expect, beforeEach } from 'vitest';
import { mkdtempSync, mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { applyChampion, rollbackActivePolicy, activeChampion, ADOPTED_CONFIG_FILE } from '../src/config/harness-feedback-applier.js';

function project(champion?: { championId: string; layer?: string; previous?: string | null }): string {
  const cwd = mkdtempSync(join(tmpdir(), 'feedback-'));
  mkdirSync(join(cwd, '.claude'), { recursive: true });
  if (champion) {
    writeFileSync(join(cwd, '.claude', ADOPTED_CONFIG_FILE), JSON.stringify({
      championId: champion.championId,
      manifest: { layer: champion.layer },
      previous: champion.previous ?? null,
    }));
  }
  return cwd;
}

describe('applyChampion', () => {
  it('applies the adopted champion to the active policy, provenance-tagged', () => {
    const cwd = project({ championId: 'sha256:aaa', layer: 'framework/node-cli' });
    const r = applyChampion(cwd, { now: 1000 });
    expect(r.applied).toBe(true);
    expect(r.to).toBe('sha256:aaa');
    const active = activeChampion(cwd)!;
    expect(active.championId).toBe('sha256:aaa');
    expect(active.provenanceTier).toBe('oracle:test-exec'); // never proxy
    expect(active.layer).toBe('framework/node-cli');
  });

  it('is idempotent — re-applying the same champion is a no-op', () => {
    const cwd = project({ championId: 'sha256:bbb' });
    expect(applyChampion(cwd, { now: 1 }).applied).toBe(true);
    expect(applyChampion(cwd, { now: 2 }).applied).toBe(false); // already active
  });

  it('carries the manifest policy.value into the active policy params (ADR-176/177 last mile)', () => {
    const cwd = mkdtempSync(join(tmpdir(), 'feedback-'));
    mkdirSync(join(cwd, '.claude'), { recursive: true });
    writeFileSync(join(cwd, '.claude', ADOPTED_CONFIG_FILE), JSON.stringify({
      championId: 'sha256:ccc',
      manifest: { layer: 'framework/node-cli', policy: { value: { alpha: 0.6, subjectWeight: 3.0 } } },
      previous: null,
    }));
    expect(applyChampion(cwd, { now: 5 }).applied).toBe(true);
    const active = activeChampion(cwd)!;
    expect(active.params).toEqual({ alpha: 0.6, subjectWeight: 3.0 }); // consumers read these
  });

  it('records the superseded champion as the rollback pointer', () => {
    const cwd = project({ championId: 'sha256:v1' });
    applyChampion(cwd, { now: 1 });
    // adopt a newer champion
    writeFileSync(join(cwd, '.claude', ADOPTED_CONFIG_FILE), JSON.stringify({ championId: 'sha256:v2', manifest: {} }));
    const r = applyChampion(cwd, { now: 2 });
    expect(r.applied).toBe(true);
    expect(activeChampion(cwd)!.previous).toBe('sha256:v1'); // rollback pointer
  });

  it('no-ops when there is no adopted champion', () => {
    const cwd = project(); // no proven-config.json
    expect(applyChampion(cwd).applied).toBe(false);
  });
});

describe('rollbackActivePolicy — reversibility', () => {
  it('reverts to the previous champion', () => {
    const cwd = project({ championId: 'sha256:v1' });
    applyChampion(cwd, { now: 1 });
    writeFileSync(join(cwd, '.claude', ADOPTED_CONFIG_FILE), JSON.stringify({ championId: 'sha256:v2', manifest: {} }));
    applyChampion(cwd, { now: 2 });
    const r = rollbackActivePolicy(cwd, { now: 3 });
    expect(r.applied).toBe(true);
    expect(r.to).toBe('sha256:v1');
    const active = activeChampion(cwd)!;
    expect(active.championId).toBe('sha256:v1');
    expect(active.rolledBack).toBe(true);
  });

  it('no-ops when there is nothing to roll back to', () => {
    const cwd = project({ championId: 'sha256:only' });
    applyChampion(cwd, { now: 1 }); // previous = null
    expect(rollbackActivePolicy(cwd).applied).toBe(false);
  });
});
