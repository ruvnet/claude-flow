/**
 * fallbackLouvain() complexity-class regression test.
 *
 * `loadRuVector()` never successfully resolves native acceleration against
 * any real published `ruvector`/`@ruvector/wasm` version (confirmed: the
 * installed `ruvector` package exports no `hooks_graph_mincut`/
 * `hooks_graph_cluster`, and `@ruvector/wasm` isn't a resolvable package at
 * all) — so `fallbackLouvain()` is the only community-detection path that
 * ever actually runs, reached from the shipped `claude-flow analyze modules`
 * CLI command via `analyzeGraph()` → `analyzeModuleCommunities()`.
 *
 * `fallbackLouvain()`'s local-moving loop used to rebuild a `communityTotal`
 * map from a full scan of every node, once per node, once per pass — O(n)
 * work repeated n times per pass, i.e. O(n^2) per pass regardless of how
 * sparse the graph is. `legacyFallbackLouvain` below is a frozen, verbatim
 * copy of that pre-fix logic (community/degree bookkeeping identical to the
 * current `fallbackLouvain`, only the inner-loop total computation differs)
 * so both the correctness-parity and performance-regression assertions below
 * are self-contained and don't depend on `git stash` during CI.
 */
import { describe, it, expect } from 'vitest';
import { fallbackLouvain } from '../../src/ruvector/graph-analyzer.js';

type Edge = [string, string, number];

function legacyFallbackLouvain(
  nodes: string[],
  edges: Edge[]
): { communities: Array<{ id: number; members: string[] }>; modularity: number } {
  if (nodes.length === 0) return { communities: [], modularity: 0 };

  const adj = new Map<string, Map<string, number>>();
  for (const node of nodes) adj.set(node, new Map());
  let totalWeight = 0;
  for (const [u, v, w] of edges) {
    if (adj.has(u) && adj.has(v)) {
      adj.get(u)!.set(v, (adj.get(u)!.get(v) || 0) + w);
      adj.get(v)!.set(u, (adj.get(v)!.get(u) || 0) + w);
      totalWeight += w * 2;
    }
  }
  if (totalWeight === 0) {
    return { communities: nodes.map((n, i) => ({ id: i, members: [n] })), modularity: 0 };
  }

  const community = new Map<string, number>();
  let nextCommunityId = 0;
  for (const node of nodes) community.set(node, nextCommunityId++);

  const degree = new Map<string, number>();
  for (const node of nodes) {
    let d = 0;
    for (const [, w] of Array.from(adj.get(node)!.entries())) d += w;
    degree.set(node, d);
  }

  let improved = true;
  const maxIterations = 10;
  let iteration = 0;

  while (improved && iteration < maxIterations) {
    improved = false;
    iteration++;

    for (const node of nodes) {
      const currentCommunity = community.get(node)!;
      const nodeAdj = adj.get(node)!;
      const nodeDegree = degree.get(node)!;

      const communityWeights = new Map<number, number>();
      for (const [neighbor, weight] of Array.from(nodeAdj.entries())) {
        const neighborCommunity = community.get(neighbor)!;
        communityWeights.set(neighborCommunity, (communityWeights.get(neighborCommunity) || 0) + weight);
      }

      // The pre-fix defect: a full O(n) rebuild, inside the per-node loop.
      const communityTotal = new Map<number, number>();
      for (const [n, c] of Array.from(community.entries())) {
        communityTotal.set(c, (communityTotal.get(c) || 0) + (degree.get(n) || 0));
      }

      let bestCommunity = currentCommunity;
      let bestGain = 0;

      for (const [targetCommunity, edgeWeight] of Array.from(communityWeights.entries())) {
        if (targetCommunity === currentCommunity) continue;
        const currentTotal = communityTotal.get(currentCommunity) || 0;
        const targetTotal = communityTotal.get(targetCommunity) || 0;
        const currentEdges = communityWeights.get(currentCommunity) || 0;
        const gain =
          (edgeWeight - currentEdges) / totalWeight -
          (nodeDegree * (targetTotal - currentTotal + nodeDegree)) / (totalWeight * totalWeight);
        if (gain > bestGain) {
          bestGain = gain;
          bestCommunity = targetCommunity;
        }
      }

      if (bestCommunity !== currentCommunity) {
        community.set(node, bestCommunity);
        improved = true;
      }
    }
  }

  const communityMembers = new Map<number, string[]>();
  for (const [node, comm] of Array.from(community.entries())) {
    if (!communityMembers.has(comm)) communityMembers.set(comm, []);
    communityMembers.get(comm)!.push(node);
  }
  const communities: Array<{ id: number; members: string[] }> = [];
  let id = 0;
  for (const members of Array.from(communityMembers.values())) communities.push({ id: id++, members });

  let modularity = 0;
  for (const [u, v, w] of edges) {
    const cu = community.get(u)!;
    const cv = community.get(v)!;
    if (cu === cv) {
      const du = degree.get(u)!;
      const dv = degree.get(v)!;
      modularity += w - (du * dv) / totalWeight;
    }
  }
  modularity /= totalWeight;

  return { communities, modularity };
}

/** Deterministic LCG PRNG — no Math.random, so fixtures are byte-identical across runs. */
function makeRng(seed: number): () => number {
  let s = seed >>> 0;
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 4294967296;
  };
}

function buildClusteredGraph(
  numClusters: number,
  clusterSize: number,
  seed: number
): { nodes: string[]; edges: Edge[] } {
  const rng = makeRng(seed);
  const nodes: string[] = [];
  for (let c = 0; c < numClusters; c++) {
    for (let i = 0; i < clusterSize; i++) nodes.push(`c${c}n${i}`);
  }
  const edges: Edge[] = [];
  for (let c = 0; c < numClusters; c++) {
    const members = nodes.slice(c * clusterSize, (c + 1) * clusterSize);
    for (let i = 0; i < members.length; i++) {
      for (let j = i + 1; j < members.length; j++) {
        if (rng() < 0.6) edges.push([members[i], members[j], 1]);
      }
    }
  }
  for (let c = 0; c < numClusters - 1; c++) {
    const a = nodes[c * clusterSize + Math.floor(rng() * clusterSize)];
    const b = nodes[(c + 1) * clusterSize + Math.floor(rng() * clusterSize)];
    edges.push([a, b, 1]);
  }
  return { nodes, edges };
}

function normalize(result: { communities: Array<{ members: string[] }>; modularity: number }) {
  const members = result.communities
    .map(c => [...c.members].sort())
    .sort((a, b) => (a[0] > b[0] ? 1 : a[0] < b[0] ? -1 : 0));
  return { members, modularity: Number(result.modularity.toFixed(9)) };
}

describe('fallbackLouvain complexity fix', () => {
  it('produces byte-identical community partitions to the pre-fix algorithm', () => {
    const { nodes, edges } = buildClusteredGraph(6, 10, 42);
    const current = normalize(fallbackLouvain(nodes, edges));
    const legacy = normalize(legacyFallbackLouvain(nodes, edges));
    expect(current).toEqual(legacy);
    // Not a degenerate all-one-community or all-singleton result.
    expect(current.members.length).toBeGreaterThan(1);
    expect(current.members.length).toBeLessThan(nodes.length);
  });

  it('produces byte-identical output on a second, differently-shaped graph', () => {
    const { nodes, edges } = buildClusteredGraph(4, 25, 1337);
    const current = normalize(fallbackLouvain(nodes, edges));
    const legacy = normalize(legacyFallbackLouvain(nodes, edges));
    expect(current).toEqual(legacy);
  });

  it('handles the zero-edge and single-node degenerate cases identically', () => {
    expect(normalize(fallbackLouvain([], []))).toEqual(normalize(legacyFallbackLouvain([], [])));
    expect(normalize(fallbackLouvain(['solo'], []))).toEqual(normalize(legacyFallbackLouvain(['solo'], [])));
  });

  it('scales near-linearly with node count at fixed average degree, unlike the pre-fix O(n^2) rebuild', () => {
    // Fixed cluster size (20) keeps average degree roughly constant as
    // numClusters grows, isolating the complexity-class difference from
    // any confound where a denser graph also has a larger `communityWeights`
    // inner loop (which is correctly O(degree) in both versions).
    const small = buildClusteredGraph(10, 20, 7); // n=200
    const large = buildClusteredGraph(80, 20, 7); // n=1600 (8x nodes)

    function bestOf(fn: (n: string[], e: Edge[]) => unknown, nodes: string[], edges: Edge[]): number {
      fn(nodes, edges); // warmup (JIT)
      let best = Infinity;
      for (let t = 0; t < 2; t++) {
        const start = performance.now();
        fn(nodes, edges);
        const dur = performance.now() - start;
        if (dur < best) best = dur;
      }
      return best;
    }

    const currentSmall = bestOf(fallbackLouvain, small.nodes, small.edges);
    const currentLarge = bestOf(fallbackLouvain, large.nodes, large.edges);
    const legacySmall = bestOf(legacyFallbackLouvain, small.nodes, small.edges);
    const legacyLarge = bestOf(legacyFallbackLouvain, large.nodes, large.edges);

    const currentGrowth = currentLarge / Math.max(currentSmall, 0.001);
    const legacyGrowth = legacyLarge / Math.max(legacySmall, 0.001);

    // 8x nodes: true O(n) would grow ~8x, true O(n^2) would grow ~64x.
    // Generous thresholds (CI-timing headroom): fixed algorithm stays well
    // under half the quadratic growth the legacy algorithm exhibits, and
    // the legacy algorithm itself must show clearly super-linear growth —
    // otherwise this fixture isn't actually exercising the O(n^2) path.
    expect(legacyGrowth).toBeGreaterThan(20); // legacy is genuinely ~quadratic
    expect(currentGrowth).toBeLessThan(legacyGrowth / 2); // fixed algorithm is materially better
    expect(currentLarge).toBeLessThan(legacyLarge); // and strictly faster in absolute terms at n=1600
  }, 30000); // the legacy O(n^2) algorithm at n=1600 (warmup+2 trials, both algorithms,
  // both sizes) can run well past vitest's default 5000ms per-test timeout
  // on a loaded/shared CI runner — same failure mode independently hit and
  // fixed by PR #3754 (2026-10-05).
});

/**
 * Differential test: the incremental `communityTotal` must be observationally
 * identical to the frozen pre-fix rebuild on arbitrary graphs, not just the two
 * clustered fixtures above. Seeded (no Math.random) so failures reproduce.
 * Covers unit, small-integer (the shipped re-export weight is 2) and
 * fractional weights, disconnected graphs, self-loops, parallel/duplicate
 * edges, and edges naming nodes that are not in the node list (ignored).
 */
describe('fallbackLouvain differential vs the pre-fix algorithm', () => {
  type Kind = 'unit' | 'int' | 'fractional';

  function randomGraph(seed: number, kind: Kind): { nodes: string[]; edges: Edge[] } {
    const r = makeRng(seed);
    const n = Math.floor(r() * 60);
    const nodes = Array.from({ length: n }, (_, i) => `n${i}`);
    const density = [0.02, 0.08, 0.3][seed % 3]; // sparse/disconnected -> dense
    const edges: Edge[] = [];
    for (let i = 0; i < n; i++) {
      for (let j = i; j < n; j++) {
        if (i === j && r() > 0.1) continue; // occasional self-loop
        if (r() >= density) continue;
        const w = kind === 'unit' ? 1 : kind === 'int' ? 1 + Math.floor(r() * 3) : r() * 5 + 0.01;
        edges.push([nodes[i], nodes[j], w]);
        if (r() < 0.1) edges.push([nodes[j], nodes[i], w]); // parallel edge
      }
    }
    if (n > 2) edges.push(['not-a-node', nodes[0], 1]);
    return { nodes, edges };
  }

  it.each(['unit', 'int', 'fractional'] as Kind[])('matches the pre-fix output exactly on 600 random %s-weight graphs', kind => {
    let nonTrivial = 0;
    for (let seed = 0; seed < 600; seed++) {
      const { nodes, edges } = randomGraph(seed * 7919 + kind.length, kind);
      const current = fallbackLouvain(nodes, edges);
      // Same communities, same member order, same ids and same modularity (not just a sorted/rounded view).
      expect(current, `seed ${seed}`).toEqual(legacyFallbackLouvain(nodes, edges));
      if (current.communities.length < nodes.length) nonTrivial++;
    }
    // Guard against a generator that only produces all-singleton results.
    expect(nonTrivial).toBeGreaterThan(300);
  });
});
