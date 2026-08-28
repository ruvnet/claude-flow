import { describe, expect, it } from 'vitest';
import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { resolve } from 'node:path';
import { tmpdir } from 'node:os';

const HELPER = resolve(__dirname, '../.claude/helpers/intelligence.cjs');

type Entry = { id?: string; content: string; namespace?: string };

function run(root: string, expr: string): string {
  return execFileSync(process.execPath, ['-e', expr], {
    cwd: root,
    env: { ...process.env, CLAUDE_PROJECT_DIR: root },
    encoding: 'utf-8',
    timeout: 2_000,
    stdio: ['ignore', 'pipe', 'pipe'],
  });
}

function callInit(root: string): { message?: string } {
  const script = [
    `const intelligence = require(${JSON.stringify(HELPER)});`,
    'process.stdout.write(JSON.stringify(intelligence.init()));',
  ].join('');
  return JSON.parse(run(root, script));
}

function callConsolidate(root: string): unknown {
  const script = [
    `const intelligence = require(${JSON.stringify(HELPER)});`,
    'process.stdout.write(JSON.stringify(intelligence.consolidate()));',
  ].join('');
  return JSON.parse(run(root, script));
}

function writeStore(root: string, entries: Entry[]): string {
  const dataDir = join(root, '.claude-flow', 'data');
  mkdirSync(dataDir, { recursive: true });
  writeFileSync(join(dataDir, 'auto-memory-store.json'), JSON.stringify(entries), 'utf-8');
  return dataDir;
}

describe('#2920 intelligence: same-ID content edits must not stay cached/unpersisted', () => {
  it('init() rebuilds ranked-context.json when an entry\'s content changes but its ID and the entry count do not', () => {
    const root = mkdtempSync(join(tmpdir(), 'ruflo-2920-init-'));
    const dataDir = writeStore(root, [{ id: 'sec-1', content: 'ORIGINAL BODY', namespace: 'auto-memory' }]);

    try {
      callInit(root);
      const rankedBefore = JSON.parse(readFileSync(join(dataDir, 'ranked-context.json'), 'utf-8'));
      expect(rankedBefore.entries[0].content).toBe('ORIGINAL BODY');

      // Same ID, same entry count — only the body changed, as a hand-edit to
      // a MEMORY.md section would look once re-imported.
      writeStore(root, [{ id: 'sec-1', content: 'EDITED BODY', namespace: 'auto-memory' }]);

      const second = callInit(root);
      const rankedAfter = JSON.parse(readFileSync(join(dataDir, 'ranked-context.json'), 'utf-8'));

      expect(second.message).not.toBe('Graph cache hit');
      expect(rankedAfter.entries[0].content).toBe('EDITED BODY');
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it('consolidate() persists an ID assigned to a previously ID-less entry instead of silently discarding it', () => {
    const root = mkdtempSync(join(tmpdir(), 'ruflo-2920-consolidate-'));
    // No id/key — consolidate() must assign one to build edges/nodes. Entry
    // count and dedup outcome are unchanged (1 entry in, 1 entry out, no
    // pending insights), which is exactly the condition the old persist
    // gate (`newEntries > 0 || store.length < preDedupCount`) treated as
    // "nothing to persist" — silently dropping the assigned id every time.
    const dataDir = writeStore(root, [{ content: 'a section with no id or key', namespace: 'auto-memory' }]);

    try {
      const result = callConsolidate(root) as { entries: number };
      expect(result.entries).toBe(1);

      const persisted = JSON.parse(readFileSync(join(dataDir, 'auto-memory-store.json'), 'utf-8')) as Entry[];
      expect(persisted).toHaveLength(1);
      expect(persisted[0].id).toBeTruthy();

      const graph = JSON.parse(readFileSync(join(dataDir, 'graph-state.json'), 'utf-8')) as {
        nodes: Record<string, unknown>;
      };
      // The id consolidate() computed for the graph must be the same one
      // that landed in the persisted store, not a fresh one assigned again
      // next run.
      expect(Object.keys(graph.nodes)).toContain(persisted[0].id);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it('init() cache-hits right after consolidate() when content is unchanged (consolidate must stamp contentFingerprint too)', () => {
    const root = mkdtempSync(join(tmpdir(), 'ruflo-2920-consolidate-cache-'));
    writeStore(root, [{ id: 'sec-1', content: 'STABLE BODY', namespace: 'auto-memory' }]);

    try {
      // consolidate() is the session-end path and writes graph-state.json
      // itself (step 6) — it must stamp the same contentFingerprint init()
      // computes, or every init() immediately after a consolidate misses
      // the cache and does a full rebuild even though nothing changed.
      callConsolidate(root);
      const afterConsolidate = callInit(root);
      expect(afterConsolidate.message).toBe('Graph cache hit');
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
});
