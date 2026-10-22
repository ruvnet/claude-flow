import { describe, expect, it, afterEach } from 'vitest';
import { mkdtempSync, writeFileSync, mkdirSync, rmSync, existsSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { extractAsarWithCaps } from '../src/rure/extract-asar.js';

const scratchDirs: string[] = [];
function scratch(): string {
  const d = mkdtempSync(join(tmpdir(), 'rure-asar-fixture-'));
  scratchDirs.push(d);
  return d;
}

afterEach(() => {
  for (const d of scratchDirs.splice(0)) {
    try { rmSync(d, { recursive: true, force: true }); } catch { /* best effort */ }
  }
});

async function buildFixtureAsar(): Promise<string> {
  const asar = await import('@electron/asar');
  const src = scratch();
  mkdirSync(join(src, 'sub'), { recursive: true });
  writeFileSync(join(src, 'main.js'), "const { ipcMain } = require('electron');\nipcMain.on('x', () => {});\n");
  writeFileSync(join(src, 'sub', 'util.js'), 'module.exports = { add: (a, b) => a + b };\n');
  const dest = join(scratch(), 'app.asar');
  await asar.createPackage(src, dest);
  return dest;
}

describe('ruRE extract-asar: resource-capped extraction', () => {
  it('extracts a well-formed archive under default caps', async () => {
    const archivePath = await buildFixtureAsar();
    const result = await extractAsarWithCaps(archivePath);
    expect(result.truncated).toBe(false);
    expect(result.fileCount).toBe(2);
    expect(existsSync(join(result.unpackedPath, 'main.js'))).toBe(true);
    expect(readFileSync(join(result.unpackedPath, 'main.js'), 'utf8')).toContain('ipcMain');
  });

  it('refuses to extract when the archive exceeds the file-count cap, writing nothing', async () => {
    const archivePath = await buildFixtureAsar();
    const result = await extractAsarWithCaps(archivePath, { maxTotalBytes: 1024 * 1024, maxFileCount: 1 });
    expect(result.truncated).toBe(true);
    expect(result.reason).toMatch(/file/);
    expect(result.unpackedPath).toBe('');
  });

  it('refuses to extract when the archive exceeds the total-byte cap, writing nothing', async () => {
    const archivePath = await buildFixtureAsar();
    const result = await extractAsarWithCaps(archivePath, { maxTotalBytes: 1, maxFileCount: 10_000 });
    expect(result.truncated).toBe(true);
    expect(result.reason).toMatch(/bytes/);
    expect(result.unpackedPath).toBe('');
  });

  it('writes the unpacked output to a ruRE-owned scratch directory, not a path derived from the archive', async () => {
    const archivePath = await buildFixtureAsar();
    const result = await extractAsarWithCaps(archivePath);
    expect(result.unpackedPath).toContain('ruflo-rure-asar-');
    expect(result.unpackedPath.startsWith(tmpdir())).toBe(true);
  });
});
