import test from 'node:test';
import assert from 'node:assert/strict';
import { applyRuntimeRelationships } from '../lib/ecosystem-runtime-relationships.mjs';
import { createConnectivityIndex } from '../lib/ecosystem-connectivity.mjs';
const snapshot = { nodes: ['wrapper', 'core'].map(name => ({ name, version: '1.0.0', status: 'captured', integrity: 'sha512-YQ==' })), edges: [] };
const overlay = () => ({ schema: 'ruvnet.runtime-relationships.v1', sourceSnapshotSha256: 'a'.repeat(64), unresolved: [], relationships: [{ source: 'wrapper', target: 'core', sourceVersion: '1.0.0', type: 'runtime-command', targetSelector: 'latest', evidence: { tarballUrl: 'https://registry.npmjs.org/wrapper/-/wrapper-1.0.0.tgz', integrity: 'sha512-YQ==', sourceFile: 'package/bin/run.mjs', line: 1, excerpt: 'npx core@latest', sourceSha256: 'b'.repeat(64) } }] });
test('runtime evidence expands consumer checks without changing required installs or source graph', () => {
  for (const type of ['runtime-command', 'native-fallback']) {
    const evidence = overlay(); evidence.relationships[0].type = type;
    const graph = applyRuntimeRelationships(snapshot, evidence, 'a'.repeat(64));
    const index = createConnectivityIndex(graph);
    assert.deepEqual(index.planChanges(['core']).affected, ['core']);
    assert.deepEqual(index.planChanges(['core'], { mode: 'capabilities' }).affected, ['core', 'wrapper']);
    assert.deepEqual(index.planChanges(['core'], { mode: 'capabilities' }).batches, [[['core']], [['wrapper']]]);
    assert.equal(snapshot.edges.length, 0);
    assert.equal(index.planChanges(['core']).releaseAuthorized, false);
  }
});
test('reject stale, mismatched, missing and duplicate runtime provenance', () => {
  const mutations = [e => e.sourceSnapshotSha256 = 'stale', e => e.relationships[0].sourceVersion = '2.0.0', e => e.relationships[0].target = 'unknown', e => e.relationships[0].type = 'dependency', e => e.relationships[0].evidence.integrity = 'wrong', e => e.relationships[0].evidence.tarballUrl = 'https://example.com/file', e => e.relationships[0].evidence.sourceSha256 = '', e => e.relationships[0].evidence.sourceFile = 'package/../run.js', e => e.relationships[0].evidence.line = 0, e => e.relationships.push(e.relationships[0])];
  for (const mutate of mutations) { const e = overlay(); mutate(e); assert.throws(() => applyRuntimeRelationships(snapshot, e, 'a'.repeat(64))); }
});
