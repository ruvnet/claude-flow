/** Exact declaration topology. No installs, range resolution or inferred integrations. */
const compare = (a, b) => a < b ? -1 : a > b ? 1 : 0;
const sorted = values => [...values].sort(compare);
const DEFAULT_ROOTS = ['ruflo', 'claude-flow', '@claude-flow/cli'];
const SEMANTICS = 'Captured package-name declarations and, when supplied, separately evidenced runtime links; not version-resolved installations. External dependencies are excluded. Connectivity does not prove compatibility or standalone intent.';

function walk(seeds, adjacency) {
  const seen = new Set(seeds), queue = [...seeds];
  for (let i = 0; i < queue.length; i++) for (const next of adjacency.get(queue[i])) {
    if (!seen.has(next)) { seen.add(next); queue.push(next); }
  }
  return sorted(seen);
}

// Iterative Kosaraju avoids recursion limits for larger ecosystem snapshots.
function components(names, forward, reverse) {
  const allowed = new Set(names), seen = new Set(), finish = [];
  for (const seed of names) {
    if (seen.has(seed)) continue;
    seen.add(seed);
    const stack = [[seed, forward.get(seed).values()]];
    while (stack.length) {
      const [name, iterator] = stack[stack.length - 1];
      const next = iterator.next();
      if (next.done) { finish.push(name); stack.pop(); continue; }
      if (allowed.has(next.value) && !seen.has(next.value)) {
        seen.add(next.value); stack.push([next.value, forward.get(next.value).values()]);
      }
    }
  }
  seen.clear();
  const groups = [];
  for (const seed of finish.reverse()) {
    if (seen.has(seed)) continue;
    const group = [], stack = [seed]; seen.add(seed);
    while (stack.length) {
      const name = stack.pop(); group.push(name);
      for (const next of reverse.get(name)) if (allowed.has(next) && !seen.has(next)) {
        seen.add(next); stack.push(next);
      }
    }
    groups.push(sorted(group));
  }
  return groups.sort((a, b) => compare(a[0], b[0]));
}

function cycles(groups, forward) {
  return groups.filter(group => group.length > 1 || forward.get(group[0]).has(group[0]));
}

function dependencyBatches(names, forward, reverse) {
  const groups = components(names, forward, reverse);
  const membership = new Map(groups.flatMap((group, i) => group.map(name => [name, i])));
  const dependencies = groups.map(() => new Set());
  for (const name of names) for (const dependency of forward.get(name)) {
    if (membership.has(dependency) && membership.get(name) !== membership.get(dependency)) {
      dependencies[membership.get(name)].add(membership.get(dependency));
    }
  }
  const remaining = new Set(groups.map((_, i) => i)), batches = [];
  while (remaining.size) {
    const ready = [...remaining].filter(i => [...dependencies[i]].every(dep => !remaining.has(dep)));
    if (!ready.length) throw new Error('Invalid SCC condensation');
    batches.push(ready.map(i => groups[i]));
    for (const i of ready) remaining.delete(i);
  }
  return { batches, declarationCycles: cycles(groups, forward) };
}

export function createConnectivityIndex(graph) {
  if (!graph || !Array.isArray(graph.nodes) || !Array.isArray(graph.edges)) throw new Error('Graph nodes and edges must be arrays');
  const nodes = new Map();
  for (const node of graph.nodes) {
    if (!node || typeof node.name !== 'string' || !node.name.trim()) throw new Error('Missing node name');
    if (nodes.has(node.name)) throw new Error(`Duplicate node: ${node.name}`);
    if (!['captured', 'missing'].includes(node.status)) throw new Error(`Invalid node status: ${node.name}`);
    if (node.status === 'captured' && (typeof node.version !== 'string' || !node.version)) throw new Error(`Missing captured version: ${node.name}`);
    nodes.set(node.name, { ...node });
  }
  const names = sorted(nodes.keys());
  const modes = Object.fromEntries(['required', 'capabilities'].map(mode => [mode, {
    forward: new Map(names.map(name => [name, new Set()])),
    reverse: new Map(names.map(name => [name, new Set()])),
    weak: new Map(names.map(name => [name, new Set()])),
  }]));
  let externalEdgesIgnored = 0;
  for (const edge of graph.edges) {
    if (!edge || !nodes.has(edge.source)) throw new Error(`Unknown edge source: ${edge?.source}`);
    if (typeof edge.target !== 'string' || !edge.target.trim()) throw new Error('Missing edge target');
    if (!['dependency', 'optional', 'peer', 'runtime-command', 'native-fallback'].includes(edge.type)) throw new Error(`Invalid edge type: ${edge.type}`);
    if (typeof edge.internal !== 'boolean' || edge.internal !== nodes.has(edge.target)) throw new Error(`Invalid internal endpoint: ${edge.target}`);
    if (edge.optionalPeer !== undefined && (typeof edge.optionalPeer !== 'boolean' || (edge.optionalPeer && edge.type !== 'peer'))) throw new Error('Invalid optionalPeer');
    if (!edge.internal) { externalEdgesIgnored++; continue; }
    for (const mode of edge.type === 'dependency' ? ['required', 'capabilities'] : ['capabilities']) {
      const { forward, reverse, weak } = modes[mode];
      forward.get(edge.source).add(edge.target); reverse.get(edge.target).add(edge.source);
      weak.get(edge.source).add(edge.target); weak.get(edge.target).add(edge.source);
    }
  }
  // Stable iteration makes output independent of registry manifest ordering.
  for (const mode of Object.values(modes)) for (const adjacency of Object.values(mode)) {
    for (const [name, neighbors] of adjacency) adjacency.set(name, new Set(sorted(neighbors)));
  }
  const missingMetadata = names.filter(name => nodes.get(name).status === 'missing');
  function select(mode) {
    if (!Object.hasOwn(modes, mode)) throw new Error(`Unknown graph mode: ${mode}`);
    return modes[mode];
  }
  return {
    analyze({ roots = DEFAULT_ROOTS } = {}) {
      if (!Array.isArray(roots) || roots.some(root => typeof root !== 'string' || !root)) throw new Error('Roots must be package names');
      const views = {};
      for (const [mode, { forward, reverse, weak }] of Object.entries(modes)) {
        const visited = new Set(), weakComponents = [];
        for (const name of names) if (!visited.has(name)) {
          const group = walk([name], weak); group.forEach(member => visited.add(member)); weakComponents.push(group);
        }
        const rootReachability = Object.fromEntries(sorted(new Set(roots)).map(root => [root, nodes.has(root) ? walk([root], forward) : null]));
        const reachable = new Set(Object.values(rootReachability).filter(Boolean).flat());
        views[mode] = {
          weakComponents,
          trueIsolates: names.filter(name => weak.get(name).size === 0),
          noInternalConsumers: names.filter(name => reverse.get(name).size === 0),
          foundationalLeaves: names.filter(name => forward.get(name).size === 0 && reverse.get(name).size > 0),
          rootReachability,
          unreachableFromRoots: names.filter(name => !reachable.has(name)),
          declarationCycles: cycles(components(names, forward, reverse), forward),
        };
      }
      return { schema: 'ruflo-ecosystem-connectivity/v1', semantics: SEMANTICS,
        modeSemantics: { required: 'dependencies only', capabilities: 'dependencies, optional dependencies, all peer declarations and any supplied runtime evidence links' },
        nodeCount: names.length, externalEdgesIgnored, metadataComplete: missingMetadata.length === 0, missingMetadata: [...missingMetadata], ...views };
    },
    planChanges(changedNames, { mode = 'required' } = {}) {
      const { forward, reverse } = select(mode);
      if (!Array.isArray(changedNames)) throw new Error('Changed packages must be an array');
      for (const name of changedNames) if (!nodes.has(name)) throw new Error(`Unknown changed package: ${name}`);
      const changed = sorted(new Set(changedNames)), affected = walk(changed, reverse);
      const { batches, declarationCycles } = dependencyBatches(affected, forward, reverse);
      return { semantics: SEMANTICS, mode, changed, affected, batches, declarationCycles,
        metadataComplete: missingMetadata.length === 0, missingMetadata: [...missingMetadata],
        graphPlanAvailable: missingMetadata.length === 0 && declarationCycles.length === 0,
        releaseAuthorized: false };
    },
  };
}

/** Deliberately naive reference for parity/benchmarking, not the production query path. */
export function referenceNaiveAffected(graph, changedNames, { mode = 'required' } = {}) {
  if (!['required', 'capabilities'].includes(mode)) throw new Error(`Unknown graph mode: ${mode}`);
  const names = new Set(graph.nodes.map(node => node.name));
  for (const name of changedNames) if (!names.has(name)) throw new Error(`Unknown changed package: ${name}`);
  const seen = new Set(changedNames), queue = [...seen];
  for (let i = 0; i < queue.length; i++) for (const edge of graph.edges) {
    if (edge.internal && edge.target === queue[i] && (mode === 'capabilities' || edge.type === 'dependency') && !seen.has(edge.source)) {
      seen.add(edge.source); queue.push(edge.source);
    }
  }
  return sorted(seen);
}
