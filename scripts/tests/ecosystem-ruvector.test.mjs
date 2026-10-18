import test from 'node:test';
import assert from 'node:assert/strict';
import { projectDependencyGraph, connectedComponents, referenceCuts, analyzeWithRuVector } from '../lib/ecosystem-ruvector.mjs';

const edge = (source, target, type = 'dependency') => ({ source, target, type, internal: true });
const snapshot = { nodes: ['a', 'b', 'c', 'd', 'isolated'], edges: [edge('a','b'), edge('b','c'), edge('c','a'), edge('c','d')] };
// Deliberate test double: production execution requires the real installed RuVector package.
const fixtureApi = {
  buildGraph(nodes, edges) {
    const adjacency = new Map(nodes.map(n => [n, new Map()]));
    for (const e of edges) { adjacency.get(e.from).set(e.to, 1); adjacency.get(e.to).set(e.from, 1); }
    return { nodes, edges, adjacency };
  },
  findArticulationPoints() { return ['c']; },
  findBridges() { return [{ from: 'd', to: 'c' }]; },
};

test('projection preserves isolates and collapses typed duplicates, reciprocal edges and loops', () => {
  const p = projectDependencyGraph({ ...snapshot, edges: [...snapshot.edges, edge('b','a','peer'), edge('a','a'), {...edge('a','external'),internal:false}] });
  assert.equal(p.edges.length, 4);
  assert.deepEqual(connectedComponents(p), [['a','b','c','d'],['isolated']]);
});

test('required projection excludes optional and peer declarations', () => {
  const s = { nodes: ['a','b','c'], edges: [edge('a','b','optional'),edge('b','c','peer')] };
  assert.equal(projectDependencyGraph(s,{requiredOnly:true}).edges.length,0);
  assert.equal(projectDependencyGraph(s).edges.length,2);
});

test('independent removal oracle finds cuts despite disconnected isolates and cycles', () => {
  assert.deepEqual(referenceCuts(projectDependencyGraph(snapshot)), { articulationPoints:['c'], bridges:[{from:'c',to:'d'}] });
  assert.deepEqual(referenceCuts(projectDependencyGraph({nodes:['a'],edges:[]})),{articulationPoints:[],bridges:[]});
});

test('actual API contract checked against oracle and repeated deterministically', async () => {
  const result = await analyzeWithRuVector(snapshot,{importer:async()=>fixtureApi,benchmarkRuns:3,version:'fixture'});
  assert.equal(result.verification.exactAgreement,true);
  assert.equal(result.algorithmBackend,'javascript');
  assert.equal(result.engine.nativeAcceleration,false);
  assert.deepEqual(result.articulationPoints,[{name:'c',additionalComponentsOnRemoval:1,degree:3}]);
  assert.equal(result.benchmark.measuredRuns,3);
  assert.ok(result.benchmark.medianMs >= 0);
});

test('wrong RuVector result is rejected rather than silently replaced by oracle', async () => {
  await assert.rejects(analyzeWithRuVector(snapshot,{importer:async()=>({...fixtureApi,findBridges:()=>[]})}),/disagrees/);
});

test('missing package and partial API fail explicitly; compatible default export works', async () => {
  await assert.rejects(analyzeWithRuVector(snapshot,{importer:async()=>{throw new Error('absent');}}),/unavailable/);
  await assert.rejects(analyzeWithRuVector(snapshot,{importer:async()=>({})}),/API missing/);
  await assert.rejects(analyzeWithRuVector(snapshot,{importer:async()=>null}),/API missing/);
  assert.equal((await analyzeWithRuVector(snapshot,{importer:async()=>({default:fixtureApi})})).nodeCount,5);
});

test('malformed inventory and unbounded benchmark requests fail', async () => {
  assert.throws(()=>projectDependencyGraph({nodes:['a','a'],edges:[]}),/unique/);
  assert.throws(()=>projectDependencyGraph({nodes:['a'],edges:[edge('a','b')]}),/absent/);
  await assert.rejects(analyzeWithRuVector(snapshot,{benchmarkRuns:101}),/1..100/);
});
