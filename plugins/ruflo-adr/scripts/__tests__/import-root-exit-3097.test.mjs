import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { chmodSync, mkdtempSync, mkdirSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';

const importer = fileURLToPath(new URL('../import.mjs', import.meta.url));

function fixture(t) {
  const temp = mkdtempSync(join(tmpdir(), 'ruflo-adr-import-3097-'));
  t.after(() => rmSync(temp, { recursive: true, force: true }));
  const project = join(temp, 'project');
  const scanRoot = join(project, 'docs', 'adr');
  const bin = join(temp, 'bin');
  mkdirSync(join(project, '.git'), { recursive: true });
  mkdirSync(scanRoot, { recursive: true });
  mkdirSync(bin);
  writeFileSync(join(scanRoot, 'ADR-001-test.md'), '# ADR-001: Test\n\n**Status**: Accepted\n');
  const shim = join(bin, 'npx');
  writeFileSync(shim, `#!/usr/bin/env node
const fs = require('node:fs');
fs.appendFileSync(process.env.ADR_TEST_CALLS, JSON.stringify({cwd: process.cwd(), args: process.argv.slice(2)}) + '\\n');
if (process.env.ADR_TEST_FAIL === '1') {
  process.stderr.write('writer unavailable\\n');
  process.exit(42);
}
`);
  chmodSync(shim, 0o755);
  return { temp, project, scanRoot, bin, calls: join(temp, 'calls.jsonl') };
}

function run(fixture, format, fail = false) {
  return spawnSync(process.execPath, [importer], {
    cwd: fixture.temp,
    encoding: 'utf-8',
    env: {
      ...process.env,
      ADR_ROOT: fixture.scanRoot,
      ADR_TEST_CALLS: fixture.calls,
      ADR_TEST_FAIL: fail ? '1' : '0',
      IMPORT_FORMAT: format,
      PATH: `${fixture.bin}:${process.env.PATH}`,
      // #3558: pin the npx shim — a built checkout or an installed ruflo on
      // PATH would otherwise be preferred over it (lib/ruflo-cli.mjs).
      RUFLO_PLUGIN_SKIP_LOCAL_CLI: '1',
      RUFLO_PLUGIN_SKIP_PATH_CLI: '1',
    },
  });
}

test('ADR_ROOT can select docs/adr while writes target its project root', (t) => {
  const f = fixture(t);
  const result = run(f, 'json');
  assert.equal(result.status, 0, result.stderr);
  assert.equal(JSON.parse(result.stdout).storedRecords, 1);
  const calls = readFileSync(f.calls, 'utf-8').trim().split('\n').map(JSON.parse);
  assert.equal(calls.length, 1);
  assert.equal(calls[0].cwd, realpathSync(f.project));
  assert.ok(calls[0].args.includes('--upsert'));
});

for (const format of ['json', 'markdown']) {
  test(`${format} import exits nonzero when a memory write fails`, (t) => {
    const f = fixture(t);
    const result = run(f, format, true);
    assert.equal(result.status, 1, result.stderr);
    if (format === 'json') {
      const report = JSON.parse(result.stdout);
      assert.equal(report.storedRecords, 0);
      assert.equal(report.errors.length, 1);
      assert.match(report.errors[0], /writer unavailable/);
    } else {
      assert.match(result.stdout, /Storage errors: 1/);
      assert.match(result.stdout, /writer unavailable/);
    }
  });
}
