import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { pathToFileURL } from 'node:url';
import { readBoundRegularFile } from './bounded-file.mjs';

const moduleUrl = pathToFileURL(new URL('./bounded-file.mjs', import.meta.url).pathname).href;

function fixture(run) {
  const root = mkdtempSync(join(tmpdir(), 'ruflo-bounded-file-'));
  try { return run(root); } finally { rmSync(root, { recursive: true, force: true }); }
}

test('reads a regular file through a bounded descriptor', () => fixture(root => {
  const path = join(root, 'input');
  writeFileSync(path, 'bounded bytes', { mode: 0o600 });
  const result = readBoundRegularFile(path, 32, 'fixture');
  assert.equal(result.bytes.toString(), 'bounded bytes');
  assert.equal(result.size, 13);
  assert.equal(result.mode, 0o600);
}));

test('rejects empty and oversized regular files', () => fixture(root => {
  const empty = join(root, 'empty'), large = join(root, 'large');
  writeFileSync(empty, ''); writeFileSync(large, '12345');
  assert.throws(() => readBoundRegularFile(empty, 8, 'empty'), /regular bounded file/);
  assert.throws(() => readBoundRegularFile(large, 4, 'large'), /regular bounded file/);
}));

test('rejects a symlink without following it', () => fixture(root => {
  const target = join(root, 'target'), link = join(root, 'link');
  writeFileSync(target, 'bytes'); symlinkSync(target, link);
  assert.throws(() => readBoundRegularFile(link, 16, 'link'), error => error?.code === 'ELOOP');
}));

test('rejects a FIFO before reading without blocking', { skip: process.platform !== 'linux' }, () => fixture(root => {
  const fifo = join(root, 'fifo');
  const made = spawnSync('mkfifo', ['--', fifo], { encoding: 'utf8', timeout: 1000, shell: false });
  assert.equal(made.error, undefined); assert.equal(made.status, 0, made.stderr);
  const script = `import assert from 'node:assert/strict';\n` +
    `import { readBoundRegularFile } from ${JSON.stringify(moduleUrl)};\n` +
    `assert.throws(() => readBoundRegularFile(${JSON.stringify(fifo)}, 32, 'fifo'), /regular bounded file/);`;
  const checked = spawnSync(process.execPath, ['--input-type=module', '-e', script], {
    encoding: 'utf8', timeout: 1000, killSignal: 'SIGKILL', maxBuffer: 4096, shell: false,
  });
  assert.equal(checked.error, undefined);
  assert.equal(checked.status, 0, checked.stderr);
}));
