import { execFileSync } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, bench, describe } from 'vitest';
import { captureRepositorySourceState } from '../src/harness/index.js';

const roots: string[] = [];
let cleanRoot = '';
let dirtyRoot = '';

function repository(label: string): string {
  const root = mkdtempSync(join(tmpdir(), `ruflo-source-state-${label}-`));
  roots.push(root);
  execFileSync('git', ['init', '--quiet', root]);
  execFileSync('git', ['-C', root, 'config', 'user.email', 'bench@example.com']);
  execFileSync('git', ['-C', root, 'config', 'user.name', 'Harness Benchmark']);
  for (let index = 0; index < 200; index += 1) {
    writeFileSync(join(root, `source-${index.toString().padStart(3, '0')}.ts`), `export const n = ${index};\n`);
  }
  execFileSync('git', ['-C', root, 'add', '.']);
  execFileSync('git', ['-C', root, 'commit', '--quiet', '-m', 'benchmark fixture']);
  return root;
}

beforeAll(() => {
  cleanRoot = repository('clean');
  dirtyRoot = repository('dirty');
  writeFileSync(join(dirtyRoot, 'source-100.ts'), 'export const n = 999;\n');
  for (let index = 0; index < 25; index += 1) {
    writeFileSync(join(dirtyRoot, `untracked-${index}.json`), JSON.stringify({ index }));
  }
});

afterAll(() => {
  for (const root of roots) rmSync(root, { recursive: true, force: true });
});

describe('repository source-state capture', () => {
  bench('clean 200-file repository fast preflight', () => {
    captureRepositorySourceState(cleanRoot);
  }, { iterations: 10, warmupIterations: 2 });

  bench('dirty patch plus 25-file manifest', () => {
    captureRepositorySourceState(dirtyRoot);
  }, { iterations: 10, warmupIterations: 2 });
});

