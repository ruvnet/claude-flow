/**
 * ruRE Phase 1 benchmark — parse throughput on a synthetic Electron-sized
 * bundle (ADR-0002 "benchmarked" done-criterion). Run with:
 *   npx tsx plugins/ruflo-rure/scripts/benchmark.ts
 *
 * Generates a synthetic bundle shaped like a real Electron app (a main
 * process entry with ipcMain wiring, a preload script with contextBridge,
 * and N "feature module" files with a realistic mix of imports/exports) so
 * the measured throughput reflects ruRE's actual analysis path, not a
 * degenerate single-file case.
 */

import { mkdtempSync, writeFileSync, mkdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const CLI_SRC = new URL('../../../v3/@claude-flow/cli/src/', import.meta.url);

async function loadRure() {
  const { analyzeJsApp } = await import(new URL('rure/analyze-js-app.ts', CLI_SRC).href);
  return { analyzeJsApp };
}

function buildSyntheticApp(root: string, featureModuleCount: number): { fileCount: number; totalBytes: number } {
  mkdirSync(root, { recursive: true });
  let totalBytes = 0;
  const write = (p: string, content: string) => {
    writeFileSync(p, content);
    totalBytes += Buffer.byteLength(content, 'utf8');
  };

  write(
    join(root, 'main.js'),
    `
      const { app, BrowserWindow, ipcMain } = require('electron');
      ipcMain.on('do-thing', (event, payload) => { event.reply('thing-done', payload); });
      app.whenReady().then(() => { new BrowserWindow({ webPreferences: { nodeIntegration: false } }); });
    `,
  );
  write(
    join(root, 'preload.js'),
    `
      const { contextBridge, ipcRenderer } = require('electron');
      contextBridge.exposeInMainWorld('api', { doThing: (p) => ipcRenderer.send('do-thing', p) });
    `,
  );

  mkdirSync(join(root, 'features'), { recursive: true });
  for (let i = 0; i < featureModuleCount; i++) {
    write(
      join(root, 'features', `feature-${i}.js`),
      `
        import { helperA } from './shared-helpers.js';
        import { helperB } from './shared-helpers.js';
        export function featureEntry${i}(input) {
          const a = helperA(input);
          const b = helperB(a);
          return { a, b, id: ${i} };
        }
        export class Feature${i}Controller {
          run(x) { return featureEntry${i}(x); }
        }
      `,
    );
  }
  write(
    join(root, 'features', 'shared-helpers.js'),
    `
      export function helperA(x) { return x + 1; }
      export function helperB(x) { return x * 2; }
    `,
  );

  return { fileCount: featureModuleCount + 3, totalBytes };
}

async function main() {
  const { analyzeJsApp } = await loadRure();
  const root = mkdtempSync(join(tmpdir(), 'ruflo-rure-bench-'));
  try {
    for (const featureModuleCount of [50, 200, 500]) {
      const { fileCount, totalBytes } = buildSyntheticApp(join(root, `size-${featureModuleCount}`), featureModuleCount);
      const start = process.hrtime.bigint();
      const result = await analyzeJsApp(join(root, `size-${featureModuleCount}`));
      const elapsedMs = Number(process.hrtime.bigint() - start) / 1e6;
      const filesPerSec = (fileCount / elapsedMs) * 1000;
      const mbPerSec = (totalBytes / (1024 * 1024)) / (elapsedMs / 1000);
      console.log(
        `files=${fileCount} bytes=${totalBytes} elapsed=${elapsedMs.toFixed(1)}ms ` +
          `throughput=${filesPerSec.toFixed(0)} files/s, ${mbPerSec.toFixed(1)} MB/s ` +
          `modulesAnalyzed=${result.modules.length} filesScanned=${result.filesScanned} truncated=${result.truncated}`,
      );
    }
    const { parseBinary, extractStrings } = await import(new URL('rure/binary-parse.ts', CLI_SRC).href);
    const big = Buffer.alloc(64 * 1024 * 1024, 0x41);
    for (let i = 0; i < big.length; i += 97) big[i] = 0;
    big.write('\x7fELF', 0, 'latin1');
    big[4] = 2;
    big[5] = 1;
    const t0 = process.hrtime.bigint();
    parseBinary(big);
    const parseMs = Number(process.hrtime.bigint() - t0) / 1e6;
    big.fill(0x41);
    for (let i = 0; i < big.length; i += 4) big[i] = 0; // runs of 3: never reaches minLen, forces a full scan
    const t1 = process.hrtime.bigint();
    extractStrings(big);
    const strMs = Number(process.hrtime.bigint() - t1) / 1e6;
    console.log(`binary 64MiB: parseBinary=${parseMs.toFixed(1)}ms extractStrings(worst-case full scan)=${strMs.toFixed(1)}ms`);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
}

main().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
