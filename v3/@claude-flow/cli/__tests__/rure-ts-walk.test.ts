import { describe, expect, it } from 'vitest';
import { analyzeModuleSource } from '../src/rure/ts-walk.js';

describe('ruRE ts-walk: analyzeModuleSource', () => {
  it('records ESM imports with evidence', () => {
    const src = `import { foo } from 'bar';\nconsole.log(foo);\n`;
    const result = analyzeModuleSource('mod.ts', src);
    expect(result.imports).toHaveLength(1);
    expect(result.imports[0]).toMatchObject({ source: 'bar', names: ['foo'] });
    expect(result.imports[0].evidence).toMatchObject({ file: 'mod.ts', lineStart: 1, lineEnd: 1 });
  });

  it('detects require("electron") as an electron boundary', () => {
    const src = `const { ipcMain } = require('electron');\nipcMain.on('x', () => {});\n`;
    const result = analyzeModuleSource('main.js', src);
    const kinds = result.electronBoundaries.map((b) => b.kind);
    expect(kinds).toContain('require-electron');
    expect(kinds).toContain('ipcMain');
  });

  it('detects contextBridge and nodeIntegration in a preload/config context', () => {
    const src = `
      const { contextBridge } = require('electron');
      contextBridge.exposeInMainWorld('api', {});
      const opts = { webPreferences: { nodeIntegration: true } };
    `;
    const result = analyzeModuleSource('preload.js', src);
    const kinds = result.electronBoundaries.map((b) => b.kind);
    expect(kinds).toContain('contextBridge');
    expect(kinds).toContain('nodeIntegration-flag');
  });

  it('records exported function/class declarations', () => {
    const src = `export function search(q) { return q; }\nexport class Store {}\n`;
    const result = analyzeModuleSource('lib.ts', src);
    const names = result.exports.map((e) => e.name);
    expect(names).toContain('search');
    expect(names).toContain('Store');
  });

  it('never throws on malformed source — it degrades to a best-effort parse, not an exception', () => {
    const src = `function broken( {{{ not valid js at all`;
    expect(() => analyzeModuleSource('broken.js', src)).not.toThrow();
  });

  it('collects raw snippets for every finding, for the AIDefence gate to scan', () => {
    const src = `import { x } from 'y';\n`;
    const result = analyzeModuleSource('mod.ts', src);
    expect(result.rawSnippets.length).toBeGreaterThan(0);
  });
});
