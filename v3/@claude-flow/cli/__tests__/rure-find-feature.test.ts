import { describe, expect, it, afterEach } from 'vitest';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { findFeature } from '../src/rure/find-feature.js';
import { analyzeJsApp } from '../src/rure/analyze-js-app.js';

const scratchDirs: string[] = [];
function scratch(): string {
  const d = mkdtempSync(join(tmpdir(), 'rure-find-feature-'));
  scratchDirs.push(d);
  return d;
}
afterEach(() => {
  for (const d of scratchDirs.splice(0)) {
    try { rmSync(d, { recursive: true, force: true }); } catch { /* best effort */ }
  }
});

describe('ruRE find-feature: deterministic lexical/structural search', () => {
  it('ranks the file whose content matches the query terms above an unrelated file', async () => {
    const dir = scratch();
    writeFileSync(join(dir, 'search.js'), `
      // Implements fuzzy search over the notes index.
      function searchNotes(query, notes) {
        return notes.filter((n) => n.text.includes(query));
      }
      module.exports = { searchNotes };
    `);
    writeFileSync(join(dir, 'unrelated.js'), `
      function formatDate(d) { return d.toISOString(); }
      module.exports = { formatDate };
    `);

    const result = await findFeature(dir, 'how does search work');
    expect(result.matches.length).toBeGreaterThan(0);
    expect(result.matches[0].file).toContain('search.js');
  });

  it('returns no matches for a query with no lexical overlap anywhere', async () => {
    const dir = scratch();
    writeFileSync(join(dir, 'a.js'), 'function add(a, b) { return a + b; }\n');
    const result = await findFeature(dir, 'quantum teleportation widget');
    expect(result.matches).toHaveLength(0);
  });

  it('every match carries a 1-indexed line range inside the file', async () => {
    const dir = scratch();
    writeFileSync(join(dir, 'a.js'), '\n\n\nfunction searchThing() { return 1; }\n');
    const result = await findFeature(dir, 'search thing');
    expect(result.matches[0].lineRange.start).toBeGreaterThanOrEqual(1);
    expect(result.matches[0].lineRange.end).toBeGreaterThanOrEqual(result.matches[0].lineRange.start);
  });
});

describe('ruRE analyze-js-app: whole-directory aggregation', () => {
  it('flags an app as Electron only when a boundary signal is actually present', async () => {
    const dir = scratch();
    writeFileSync(join(dir, 'plain.js'), 'function add(a, b) { return a + b; }\n');
    expect((await analyzeJsApp(dir)).isElectron).toBe(false);

    writeFileSync(join(dir, 'main.js'), "require('electron');\n");
    expect((await analyzeJsApp(dir)).isElectron).toBe(true);
  });

  it('skips unparseable files without failing the whole-app analysis', async () => {
    const dir = scratch();
    writeFileSync(join(dir, 'good.js'), 'export function ok() { return 1; }\n');
    writeFileSync(join(dir, 'bad.js'), 'function ((( totally not js');
    const result = await analyzeJsApp(dir);
    expect(result.filesScanned).toBe(2);
    expect(result.modules.some((m) => m.exports.some((e) => e.name === 'ok'))).toBe(true);
  });
});
