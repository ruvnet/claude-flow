import { performance } from 'node:perf_hooks';

const compare = (a, b) => a < b ? -1 : a > b ? 1 : 0;
const pair = (a, b) => [a, b].sort(compare);
const key = (a, b) => JSON.stringify(pair(a, b));

/** Package declaration topology only. Never interprets a cut as a runtime outage. */
export function projectDependencyGraph(snapshot, { requiredOnly = false } = {}) {
  if (!Array.isArray(snapshot?.nodes) || !Array.isArray(snapshot?.edges)) throw new TypeError('Expected nodes and edges');
  const nodes = snapshot.nodes.map(n => typeof n === 'string' ? n : n.name);
  if (nodes.some(n => typeof n !== 'string' || !n) || new Set(nodes).size !== nodes.length) throw new TypeError('Expected unique named nodes');
  nodes.sort(compare);
  const names = new Set(nodes);
  const edges = new Map();
  for (const edge of snapshot.edges) {
    if (!edge.internal || (requiredOnly && edge.type !== 'dependency')) continue;
    if (!names.has(edge.source) || !names.has(edge.target)) throw new TypeError('Internal edge endpoint absent from inventory');
    if (edge.source === edge.target) continue;
    const [from, to] = pair(edge.source, edge.target);
    edges.set(key(from, to), { from, to, weight: 1 });
  }
  return { nodes, edges: [...edges.values()].sort((a, b) => compare(key(a.from, a.to), key(b.from, b.to))) };
}

/** Independent BFS oracle, intentionally distinct from RuVector's Tarjan implementation. */
export function connectedComponents({ nodes, edges }, { omitNode, omitEdge } = {}) {
  const adjacency = new Map(nodes.filter(n => n !== omitNode).map(n => [n, []]));
  for (const { from, to } of edges) {
    if (from === omitNode || to === omitNode || key(from, to) === omitEdge) continue;
    adjacency.get(from).push(to);
    adjacency.get(to).push(from);
  }
  const seen = new Set();
  const groups = [];
  for (const node of adjacency.keys()) {
    if (seen.has(node)) continue;
    const group = [node];
    seen.add(node);
    for (let i = 0; i < group.length; i++) {
      for (const neighbor of adjacency.get(group[i])) if (!seen.has(neighbor)) {
        seen.add(neighbor);
        group.push(neighbor);
      }
    }
    groups.push(group.sort(compare));
  }
  return groups.sort((a, b) => b.length - a.length || compare(a[0], b[0]));
}

export function referenceCuts(projection) {
  const baseline = connectedComponents(projection).length;
  const articulationPoints = projection.nodes.filter(omitNode => connectedComponents(projection, { omitNode }).length > baseline);
  const bridges = projection.edges.filter(e => connectedComponents(projection, { omitEdge: key(e.from, e.to) }).length > baseline)
    .map(({ from, to }) => ({ from, to }));
  return { articulationPoints, bridges };
}

function canonicalCuts(cuts) {
  return JSON.stringify({
    articulationPoints: [...cuts.articulationPoints].sort(compare),
    bridges: cuts.bridges.map(e => pair(e.from, e.to)).sort((a, b) => compare(JSON.stringify(a), JSON.stringify(b))),
  });
}

/** Requires the real RuVector API by default. Importer injection is solely for isolated tests/load paths. */
export async function analyzeWithRuVector(snapshot, {
  importer = () => import('ruvector'), requiredOnly = false, benchmarkRuns = 5, version = null,
} = {}) {
  if (!Number.isInteger(benchmarkRuns) || benchmarkRuns < 1 || benchmarkRuns > 100) throw new RangeError('benchmarkRuns must be 1..100');
  let namespace;
  try { namespace = await importer(); } catch (cause) { throw new Error('RuVector unavailable: install the pinned analysis dependency', { cause }); }
  const api = typeof namespace?.buildGraph === 'function' ? namespace : namespace?.default;
  for (const name of ['buildGraph', 'findArticulationPoints', 'findBridges']) {
    if (typeof api?.[name] !== 'function') throw new Error(`RuVector required API missing: ${name}`);
  }
  const projection = projectDependencyGraph(snapshot, { requiredOnly });
  const graph = api.buildGraph(projection.nodes, projection.edges);
  const run = () => ({ articulationPoints: api.findArticulationPoints(graph), bridges: api.findBridges(graph) });
  const cuts = run();
  const referenceStart = performance.now();
  const reference = referenceCuts(projection);
  const referenceMs = performance.now() - referenceStart;
  if (canonicalCuts(cuts) !== canonicalCuts(reference)) throw new Error('RuVector cut analysis disagrees with independent removal/BFS oracle');
  const samples = [];
  for (let i = 0; i < benchmarkRuns; i++) {
    const start = performance.now();
    const repeated = run();
    samples.push(performance.now() - start);
    if (canonicalCuts(repeated) !== canonicalCuts(reference)) throw new Error('RuVector cut analysis is nondeterministic');
  }
  samples.sort((a, b) => a - b);
  const groups = connectedComponents(projection);
  const cutNodes = reference.articulationPoints.map(name => ({
    name,
    additionalComponentsOnRemoval: connectedComponents(projection, { omitNode: name }).length - groups.length,
    degree: graph.adjacency.get(name).size,
  })).sort((a, b) => b.additionalComponentsOnRemoval - a.additionalComponentsOnRemoval || b.degree - a.degree || compare(a.name, b.name));
  return {
    version,
    algorithmBackend: 'javascript',
    engine: { package: 'ruvector', implementation: 'JavaScript graph algorithms', algorithms: ['buildGraph', 'findArticulationPoints', 'findBridges'], nativeAcceleration: false },
    semantics: 'Undirected simple projection of internal package relationships. Declaration and supplied runtime evidence edges are not proof of runtime reachability, compatibility, or resolved installation topology.',
    projection: requiredOnly ? 'required internal declarations' : 'all supplied internal relationships',
    nodeCount: projection.nodes.length,
    edgeCount: projection.edges.length,
    componentCount: groups.length,
    components: groups,
    isolates: groups.filter(g => g.length === 1).flat(),
    articulationPoints: cutNodes,
    bridges: reference.bridges,
    verification: { oracle: 'independent edge/node removal and BFS', exactAgreement: true, checkedNodes: projection.nodes.length, checkedEdges: projection.edges.length },
    benchmark: { warmupRuns: 1, measuredRuns: benchmarkRuns, scope: 'RuVector cut algorithms only; excludes import, projection, and oracle', medianMs: samples[Math.floor(samples.length / 2)], minMs: samples[0], maxMs: samples.at(-1), referenceMs },
  };
}
