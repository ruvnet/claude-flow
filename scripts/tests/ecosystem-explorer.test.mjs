import test from 'node:test';
import assert from 'node:assert/strict';
import { buildAdjacency, classifyNode, filterNodes, layoutNodes, graphSummary, receiptMatches, capabilityStatus } from '../../docs/ecosystem/explorer/app.js';
const nodes = [{ name: 'alpha' }, { name: '@scope/beta' }, { name: 'gamma' }, { name: 'alone' }];
const edges = [{ source: 'alpha', target: '@scope/beta', type: 'dependency' }, { source: 'gamma', target: 'alpha', type: 'runtime-command' }, { source: 'alpha', target: 'external', type: 'dependency' }];
const adjacency = buildAdjacency(nodes, edges);
test('adjacency includes incoming and outgoing typed edges but no phantom external nodes', () => {
  assert.equal(adjacency.size, 4); assert.equal(adjacency.get('alpha').incoming.length, 1); assert.equal(adjacency.get('alpha').outgoing.length, 1);
  assert.equal(classifyNode('alone', adjacency), 'isolated'); assert.equal(classifyNode('gamma', adjacency), 'runtime');
});
test('filters compose case-insensitive search and relationship categories', () => {
  assert.deepEqual(filterNodes(nodes, adjacency, 'SCOPE', 'connected').map(n => n.name), ['@scope/beta']);
  assert.deepEqual(filterNodes(nodes, adjacency, '', 'isolated').map(n => n.name), ['alone']);
  assert.equal(filterNodes(nodes, adjacency, 'absent').length, 0);
  assert.equal(filterNodes(nodes, adjacency, '', 'runtime').length, 2);
});
test('layout is deterministic and contains finite in-bounds positions for 401 nodes', () => {
  const cohort = Array.from({ length: 401 }, (_, index) => ({ name: `package-${index}` }));
  const map = buildAdjacency(cohort, []), positions = layoutNodes(cohort, map);
  assert.equal(positions.size, 401); assert.deepEqual(positions, layoutNodes([...cohort].reverse(), map));
  for (const { x, y } of positions.values()) { assert.ok(Number.isFinite(x) && x > 0 && x < 900); assert.ok(Number.isFinite(y) && y > 0 && y < 620); }
});
test('focused layout includes selected package and direct neighbors only', () => {
  const positions = layoutNodes(nodes, adjacency, 'alpha'); assert.equal(positions.size, 3); assert.equal(positions.has('alone'), false); assert.deepEqual(positions.get('alpha'), { x: 450, y: 300 });
});
test('summary detects singleton and larger weak component', () => {
  assert.deepEqual(graphSummary(nodes, edges.slice(0, 2)), { nodes: 4, edges: 2, isolates: 1, components: 2, largest: 3 });
});
test('receipt needs verified provenance and all three exact snapshot hashes', () => {
  const hashes = { dependencySnapshotSha256: 'a', runtimeSnapshotSha256: 'b', registrySha256: 'c' };
  assert.equal(receiptMatches({ provenance: { verified: true, ...hashes } }, hashes), true);
  for (const key of Object.keys(hashes)) assert.equal(receiptMatches({ provenance: { verified: true, ...hashes, [key]: 'stale' } }, hashes), false);
  assert.equal(receiptMatches({ provenance: { ...hashes } }, hashes), false);
  assert.equal(receiptMatches(null, hashes), false);
});
test('unchecked receipt never upgrades capability status, contracts remain explicit', () => {
  const capability = { id: 'vector', kind: 'contract' }, receipt = { capabilities: [{ id: 'vector', status: 'passed' }] };
  assert.equal(capabilityStatus(capability, receipt, false).state, 'unknown');
  assert.equal(capabilityStatus(capability, receipt, true).label, 'Contract checks passed');
  assert.equal(capabilityStatus({ ...capability, kind: 'integration' }, receipt, true).label, 'Integration checks passed');
  assert.equal(capabilityStatus(capability, { capabilities: [{ id: 'vector', status: 'invented' }] }, true).state, 'unknown');
});
