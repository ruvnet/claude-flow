import assert from 'node:assert/strict';
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
