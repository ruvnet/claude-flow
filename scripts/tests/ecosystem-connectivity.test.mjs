import test from 'node:test';
import assert from 'node:assert/strict';
import { createConnectivityIndex, referenceNaiveAffected } from '../lib/ecosystem-connectivity.mjs';
const graph = (names, edges = []) => ({ nodes: names.map(name => ({ name, status: 'captured', version: '1.0.0' })), edges: edges.map(([source, target, type = 'dependency', optionalPeer = false]) => ({ source, target, type, optionalPeer, internal: names.includes(target) })) });

test('chain separates product entry, foundation, true isolate and root reachability', () => {
  const index = createConnectivityIndex(graph(['ruflo', 'cli', 'core', 'alone'], [['ruflo', 'cli'], ['cli', 'core']]));
  const report = index.analyze();
  assert.deepEqual(report.required.weakComponents, [['alone'], ['cli', 'core', 'ruflo']]);
  assert.deepEqual(report.required.trueIsolates, ['alone']);
  assert.deepEqual(report.required.noInternalConsumers, ['alone', 'ruflo']);
  assert.deepEqual(report.required.foundationalLeaves, ['core']);
  assert.deepEqual(report.required.rootReachability.ruflo, ['cli', 'core', 'ruflo']);
  assert.equal(report.required.rootReachability['claude-flow'], null);
  assert.deepEqual(index.planChanges(['core']).batches, [[['core']], [['cli']], [['ruflo']]]);
});

test('optional and both peer kinds affect capabilities only', () => {
  const index = createConnectivityIndex(graph(['app', 'opt', 'peer', 'optional-peer'], [['app', 'opt', 'optional'], ['app', 'peer', 'peer'], ['app', 'optional-peer', 'peer', true]]));
  assert.equal(index.analyze().required.trueIsolates.length, 4);
  assert.equal(index.analyze().capabilities.weakComponents.length, 1);
  for (const name of ['opt', 'peer', 'optional-peer']) {
    assert.deepEqual(index.planChanges([name]).affected, [name]);
    assert.deepEqual(index.planChanges([name], { mode: 'capabilities' }).affected, ['app', name].sort());
  }
});

test('cycles form SCC groups and prevent graph readiness, without claiming install cycles', () => {
  const index = createConnectivityIndex(graph(['a', 'b', 'consumer', 'unaffected'], [['a', 'b'], ['b', 'a'], ['consumer', 'a'], ['consumer', 'unaffected']]));
  const plan = index.planChanges(['a']);
  assert.deepEqual(plan.batches, [[['a', 'b']], [['consumer']]]);
  assert.deepEqual(plan.declarationCycles, [['a', 'b']]);
  assert.equal(plan.graphPlanAvailable, false);
  assert.equal(plan.releaseAuthorized, false);
  assert.match(plan.semantics, /not version-resolved/);
  assert.deepEqual(index.planChanges(['consumer']).batches, [[['consumer']]]);
});

test('diamond batches independent consumers together; SCC cross edges remain separate', () => {
  const index = createConnectivityIndex(graph(['a', 'b', 'c', 'd'], [['a', 'b'], ['a', 'c'], ['b', 'd'], ['c', 'd']]));
  assert.deepEqual(index.planChanges(['d']).batches, [[['d']], [['b'], ['c']], [['a']]]);
  const cross = createConnectivityIndex(graph(['a', 'b', 'c'], [['a', 'b'], ['a', 'c'], ['b', 'c']]));
  assert.deepEqual(cross.planChanges(['c']).batches, [[['c']], [['b']], [['a']]]);
});

test('missing metadata prevents readiness even outside affected set', () => {
  const g = graph(['a', 'missing']); g.nodes[1] = { name: 'missing', status: 'missing' };
  const index = createConnectivityIndex(g);
  assert.equal(index.analyze().metadataComplete, false);
  assert.equal(index.planChanges(['a']).graphPlanAvailable, false);
  assert.deepEqual(index.planChanges(['a']).missingMetadata, ['missing']);
});

test('external declarations ignored explicitly and self loops remain cycles', () => {
  const index = createConnectivityIndex(graph(['a'], [['a', 'external'], ['a', 'a']]));
  assert.equal(index.analyze().externalEdgesIgnored, 1);
  assert.deepEqual(index.analyze().required.declarationCycles, [['a']]);
  assert.equal(index.planChanges(['a']).graphPlanAvailable, false);
});

test('ordering and duplicate declarations do not change topology or plans', () => {
  const g = graph(['a', 'b', 'c'], [['a', 'b'], ['b', 'c'], ['a', 'b']]);
  const reversed = { nodes: [...g.nodes].reverse(), edges: [...g.edges].reverse() };
  assert.deepEqual(createConnectivityIndex(g).analyze(), createConnectivityIndex(reversed).analyze());
  assert.deepEqual(createConnectivityIndex(g).planChanges(['c', 'c']), createConnectivityIndex(reversed).planChanges(['c']));
});

test('reject malformed identities, status and endpoint flags', () => {
  for (const mutate of [g => g.nodes.push(g.nodes[0]), g => delete g.nodes[0].name, g => delete g.nodes[0].version, g => g.nodes[0].status = 'ok', g => g.edges[0].source = 'missing', g => g.edges[0].target = 'missing', g => g.edges[0].internal = false, g => g.edges[0].type = 'imagined', g => g.edges[0].optionalPeer = true]) {
    const g = graph(['a', 'b'], [['a', 'b']]); mutate(g);
    assert.throws(() => createConnectivityIndex(g));
  }
  const index = createConnectivityIndex(graph(['a']));
  assert.throws(() => index.planChanges(['absent']), /Unknown changed/);
  assert.throws(() => index.planChanges(['a'], { mode: '__proto__' }), /Unknown graph mode/);
  assert.deepEqual(index.planChanges([]).affected, []);
});

test('cached traversal equals independent naive scan for generated graphs and every seed', () => {
  let random = 12345;
  const next = () => (random = (Math.imul(random, 1664525) + 1013904223) >>> 0) / 2 ** 32;
  for (let trial = 0; trial < 15; trial++) {
    const names = Array.from({ length: 20 }, (_, i) => `p${i}`), edges = [];
    for (const a of names) for (const b of names) if (next() < 0.1) edges.push([a, b, next() < 0.5 ? 'dependency' : 'optional']);
    const g = graph(names, edges), index = createConnectivityIndex(g);
    for (const mode of ['required', 'capabilities']) for (const seed of names) {
      const plan = index.planChanges([seed], { mode });
      assert.deepEqual(plan.affected, referenceNaiveAffected(g, [seed], { mode }));
      assert.deepEqual(plan.batches.flat(2).sort(), plan.affected);
      const groups = plan.batches.flat();
      const membership = new Map(groups.flatMap((group, i) => group.map(name => [name, i])));
      const reverseReach = new Map(plan.affected.map(name => [name, new Set(referenceNaiveAffected(g, [name], { mode }))]));
      for (const a of plan.affected) for (const b of plan.affected) {
        assert.equal(membership.get(a) === membership.get(b), reverseReach.get(a).has(b) && reverseReach.get(b).has(a));
      }
      const batch = new Map(plan.batches.flatMap((groups, i) => groups.flat().map(name => [name, i])));
      for (const edge of g.edges) if ((mode === 'capabilities' || edge.type === 'dependency') && batch.has(edge.source) && batch.has(edge.target)) assert.ok(batch.get(edge.target) <= batch.get(edge.source));
    }
  }
});
