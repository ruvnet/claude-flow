/** Registry metadata graph only. Never installs or executes package contents. */
export function inventoryNames(inventory) {
  const names = [];
  for (const field of ['packages', 'unavailable_packages', 'unavailablePackages', 'missing_packages', 'missingPackages']) {
    for (const entry of inventory[field] ?? []) {
      const name = typeof entry === 'string' ? entry : entry.package ?? entry.name;
      if (typeof name !== 'string' || !/^(?:@[a-z0-9._~-]+\/)?[a-z0-9._~-]+$/.test(name)) {
        throw new Error(`Invalid npm package name in ${field}`);
      }
      names.push(name);
    }
  }
  return [...new Set(names)].sort();
}

function stronglyConnected(names, adjacency) {
  let next = 0;
  const index = new Map(), low = new Map(), stack = [], active = new Set(), cycles = [];
  function visit(name) {
    index.set(name, next); low.set(name, next++); stack.push(name); active.add(name);
    for (const dep of adjacency.get(name)) {
      if (!index.has(dep)) { visit(dep); low.set(name, Math.min(low.get(name), low.get(dep))); }
      else if (active.has(dep)) low.set(name, Math.min(low.get(name), index.get(dep)));
    }
    if (low.get(name) !== index.get(name)) return;
    const component = []; let member;
    do { member = stack.pop(); active.delete(member); component.push(member); } while (member !== name);
    if (component.length > 1 || adjacency.get(name).has(name)) cycles.push(component.sort());
  }
  for (const name of names) if (!index.has(name)) visit(name);
  return cycles.sort((a, b) => a[0].localeCompare(b[0]));
}

function reverseCascades(names, adjacency) {
  const reverse = new Map(names.map(name => [name, new Set()]));
  for (const [name, deps] of adjacency) for (const dep of deps) reverse.get(dep).add(name);
  return Object.fromEntries(names.map(name => {
    const seen = new Set([name]), queue = [name];
    for (let i = 0; i < queue.length; i++) for (const dependent of reverse.get(queue[i])) {
      if (!seen.has(dependent)) { seen.add(dependent); queue.push(dependent); }
    }
    seen.delete(name);
    return [name, [...seen].sort()];
  }));
}

/** manifests: map of inventory name to captured npm version manifest or null. */
export function buildDependencyGraph(inventory, manifests, { capturedAt = new Date().toISOString(), errors = {} } = {}) {
  const names = inventoryNames(inventory), cohort = new Set(names), edges = [], nodes = [];
  const hard = new Map(names.map(name => [name, new Set()]));
  const all = new Map(names.map(name => [name, new Set()]));
  for (const name of names) {
    const manifest = manifests[name];
    if (!manifest || manifest.name !== name || typeof manifest.version !== 'string' || !manifest.version) {
      nodes.push({ name, status: 'missing', reason: errors[name] ?? 'manifest unavailable or identity invalid' });
      continue;
    }
    const dist = manifest.dist ?? {};
    nodes.push({ name, status: 'captured', version: manifest.version,
      registryUrl: `https://registry.npmjs.org/${encodeURIComponent(name)}/${encodeURIComponent(manifest.version)}`,
      integrity: dist.integrity ?? null, shasum: dist.shasum ?? null, gitHead: manifest.gitHead ?? null,
      provenance: { attestations: dist.attestations ?? null, signatures: dist.signatures ?? [] },
      // Capture exact declarations as evidence, including external relationships.
      dependencies: manifest.dependencies ?? {}, optionalDependencies: manifest.optionalDependencies ?? {},
      peerDependencies: manifest.peerDependencies ?? {}, peerDependenciesMeta: manifest.peerDependenciesMeta ?? {},
    });
    for (const [field, type] of [['dependencies', 'dependency'], ['optionalDependencies', 'optional'], ['peerDependencies', 'peer']]) {
      for (const [target, range] of Object.entries(manifest[field] ?? {}).sort(([a], [b]) => a.localeCompare(b))) {
        if (field === 'dependencies' && Object.hasOwn(manifest.optionalDependencies ?? {}, target)) continue;
        const optionalPeer = type === 'peer' && manifest.peerDependenciesMeta?.[target]?.optional === true;
        const internal = cohort.has(target);
        edges.push({ source: name, target, range, type, optionalPeer, internal });
        if (internal) { all.get(name).add(target); if (type === 'dependency') hard.get(name).add(target); }
      }
    }
  }
  const hardCycles = stronglyConnected(names, hard), visited = new Set(), order = [];
  function orderVisit(name) {
    if (visited.has(name)) return;
    visited.add(name);
    for (const dep of [...hard.get(name)].sort()) orderVisit(dep);
    order.push(name);
  }
  if (!hardCycles.length) for (const name of names) orderVisit(name);
  const missing = nodes.filter(node => node.status === 'missing').map(node => node.name);
  return { schema: 'ruflo-ecosystem-dependency-graph/v1', capturedAt,
    source: 'Public npm registry latest manifests, pinned to captured versions; metadata only. Ranges are declarations, not resolved installations.',
    counts: { inventory: names.length, captured: names.length - missing.length, missing: missing.length,
      edges: edges.length, internalEdges: edges.filter(edge => edge.internal).length, hardInternalEdges: [...hard.values()].reduce((sum, deps) => sum + deps.size, 0) },
    nodes, edges, missing, hardCycles, hardDependenciesAcyclic: hardCycles.length === 0,
    metadataComplete: missing.length === 0,
    // Publishing requires completeness as well as acyclicity; no plan on partial evidence.
    releaseReady: !hardCycles.length && !missing.length,
    releaseOrder: hardCycles.length || missing.length ? null : order,
    reverseImpact: reverseCascades(names, hard), capabilityReverseImpact: reverseCascades(names, all),
  };
}
