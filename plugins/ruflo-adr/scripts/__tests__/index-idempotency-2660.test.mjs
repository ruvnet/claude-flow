import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';

import {
  adrRecordKey,
  adrRecordValue,
  edgeKey,
  memoryStoreArgs,
  parseEdgeKey,
  uniqueEdges,
} from '../lib/index-records.mjs';

test('stable ADR keys are explicitly upserted when mutable metadata changes', () => {
  const proposed = {
    id: 'ADR-007',
    file: 'docs/adr/ADR-007-bullet-contract.md',
    title: 'Bullet contract',
    context: 'Context',
    status: 'proposed',
    date: '2026-07-29',
    tags: ['agentdb'],
  };
  const accepted = { ...proposed, status: 'accepted', tags: ['agentdb', 'accepted'] };

  assert.equal(adrRecordKey(proposed), adrRecordKey(accepted));
  assert.notEqual(adrRecordValue(proposed), adrRecordValue(accepted));

  const args = memoryStoreArgs('adr-patterns', adrRecordKey(accepted), adrRecordValue(accepted));
  assert.equal(args.filter((arg) => arg === '--upsert').length, 1);
  assert.ok(args.includes('--key=ADR-007::ADR-007-bullet-contract'));
  assert.ok(args.some((arg) => arg.includes('status: accepted')));
});

test('edge identity is deterministic and duplicate semantic triples collapse', () => {
  const edge = { relation: 'depends-on', from: 'ADR-007', to: 'ADR-003' };
  assert.equal(edgeKey(edge), 'depends-on:ADR-007->ADR-003');
  assert.equal(edgeKey({ ...edge }), edgeKey(edge));

  const unique = uniqueEdges([
    edge,
    { ...edge },
    { relation: 'related', from: 'ADR-007', to: 'ADR-003' },
  ]);
  assert.deepEqual(unique.map(edgeKey), [
    'depends-on:ADR-007->ADR-003',
    'related:ADR-007->ADR-003',
  ]);

  const args = memoryStoreArgs('adr-edges', edgeKey(edge), edge);
  assert.ok(args.includes('--upsert'));
  assert.ok(args.includes('--key=depends-on:ADR-007->ADR-003'));

  assert.deepEqual(parseEdgeKey('depends-on:ADR-007->ADR-003'), {
    relation: 'depends-on',
    from: 'ADR-007',
    to: 'ADR-003',
    key: 'depends-on:ADR-007->ADR-003',
  });
  assert.deepEqual(parseEdgeKey('depends-on:ADR-007->ADR-003:1721061000000-a1b2c3'), {
    relation: 'depends-on',
    from: 'ADR-007',
    to: 'ADR-003',
    key: 'depends-on:ADR-007->ADR-003:1721061000000-a1b2c3',
  });
});

function runImport(format, { failure = '', dryRun = false, empty = false, warnings = false } = {}) {
  const root = mkdtempSync(join(tmpdir(), 'ruflo-adr-import-'));
  try {
    if (!empty) {
      const adrDir = join(root, 'docs', 'adr');
      mkdirSync(adrDir, { recursive: true });
      writeFileSync(join(adrDir, 'ADR-001-first.md'), `---
id: ADR-001
title: First
status: Accepted
related: [${warnings ? 'ADR-999' : 'ADR-002, ADR-002'}]
${warnings ? 'supersedes: [ADR-002]\n' : ''}---
`);
      writeFileSync(join(adrDir, 'ADR-002-second.md'), `---
id: ADR-002
title: Second
status: Accepted
---
`);
    }

    const callLog = join(root, 'store-calls.json');
    const importer = new URL('../import.mjs', import.meta.url).href;
    // Run the real importer, replacing only the external storage process.
    const script = failure === 'missing-npx' ? `await import(${JSON.stringify(importer)});` : `
      import childProcess from 'node:child_process';
      import { writeFileSync } from 'node:fs';
      import { syncBuiltinESMExports } from 'node:module';
      const calls = [];
      childProcess.spawnSync = (command, args, options) => {
        calls.push({ command, args, cwd: options.cwd });
        const failed = ${JSON.stringify(failure)} === 'all'
          || (${JSON.stringify(failure)} === 'record' && args.includes('--key=ADR-001::ADR-001-first'))
          || (${JSON.stringify(failure)} === 'edge' && args.includes('--namespace=adr-edges'));
        return { status: failed ? 1 : 0, stdout: '', stderr: failed ? 'storage unavailable' : '' };
      };
      syncBuiltinESMExports();
      process.on('exit', () => writeFileSync(${JSON.stringify(callLog)}, JSON.stringify(calls)));
      await import(${JSON.stringify(importer)});
    `;
    const result = spawnSync(process.execPath, ['--input-type=module', '--eval', script], {
      cwd: root,
      encoding: 'utf8',
      timeout: 10_000,
      env: {
        ...process.env,
        ADR_ROOT: root,
        IMPORT_FORMAT: format,
        IMPORT_DRY_RUN: dryRun ? '1' : '0',
        CLI_CORE: '0',
        PATH: '',
      },
    });
    assert.ifError(result.error);
    assert.equal(result.signal, null);
    assert.equal(result.stderr, '');
    const calls = failure === 'missing-npx' ? null : JSON.parse(readFileSync(callLog, 'utf8'));
    for (const call of calls || []) {
      assert.equal(call.command, 'npx');
      assert.equal(call.cwd, root);
      assert.ok(call.args.includes('--upsert'));
    }
    return { ...result, calls };
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
}

function assertSummary(result, format, { total = 2, records = 2, edges = 1, storedEdges = 1, errors = 0, warnings = 0 } = {}) {
  if (format === 'json') {
    const summary = JSON.parse(result.stdout);
    assert.equal(summary.total, total);
    assert.equal(summary.storedRecords, records);
    assert.equal(summary.edges, edges);
    assert.equal(summary.storedEdges, storedEdges);
    assert.equal(summary.errors.length, errors);
    assert.equal(summary.danglingRefs.length, warnings);
    assert.equal(summary.statusMismatches.length, warnings);
  } else {
    assert.ok(result.stdout.includes(`Records stored to \`adr-patterns\`: ${records}/${total}`));
    assert.ok(result.stdout.includes(`Edges stored to \`adr-edges\`: ${storedEdges}/${edges}`));
    assert.ok(result.stdout.includes(`- Storage errors: ${errors}`));
    assert.ok(result.stdout.includes(`- Dangling refs (edge → non-existent ADR): ${warnings}`));
    assert.ok(result.stdout.includes(`- Status mismatches (superseded but not marked): ${warnings}`));
    assert.ok(result.stdout.includes('### Source breakdown'));
  }
}

for (const format of ['json', 'markdown']) {
  for (const [failure, records, storedEdges, errors] of [
    ['', 2, 1, 0],
    ['all', 0, 0, 3],
    ['record', 1, 1, 1],
    ['edge', 2, 0, 1],
    ['missing-npx', 0, 0, 3],
  ]) {
    test(`import ${format} reports ${failure || 'successful upserts'} in its exit status`, () => {
      const result = runImport(format, { failure });
      assertSummary(result, format, { records, storedEdges, errors });
      if (result.calls) assert.equal(result.calls.length, 3);
      assert.equal(result.status, errors ? 1 : 0);
    });
  }

  test(`import ${format} dry-run succeeds without storing records or edges`, () => {
    const result = runImport(format, { failure: 'all', dryRun: true });
    assertSummary(result, format, { records: 0, storedEdges: 0 });
    assert.deepEqual(result.calls, []);
    assert.equal(result.status, 0);
  });

  test(`import ${format} succeeds when no ADRs exist`, () => {
    const result = runImport(format, { empty: true });
    assertSummary(result, format, { total: 0, records: 0, edges: 0, storedEdges: 0 });
    assert.deepEqual(result.calls, []);
    assert.equal(result.status, 0);
  });

  test(`import ${format} keeps dangling references and status mismatches non-fatal`, () => {
    const result = runImport(format, { warnings: true });
    assertSummary(result, format, { edges: 2, storedEdges: 2, warnings: 1 });
    assert.equal(result.calls.length, 4);
    assert.equal(result.status, 0);
  });
}
