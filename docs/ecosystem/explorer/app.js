const RUNTIME_TYPES = new Set(['runtime-command', 'native-fallback']);
export function buildAdjacency(nodes, edges) {
  const map = new Map(nodes.map(node => [node.name, { incoming: [], outgoing: [], neighbors: new Set(), runtime: false }]));
  for (const edge of edges) {
    if (!map.has(edge.source) || !map.has(edge.target)) continue;
    const source = map.get(edge.source), target = map.get(edge.target);
    source.outgoing.push(edge); target.incoming.push(edge);
    source.neighbors.add(edge.target); target.neighbors.add(edge.source);
    if (RUNTIME_TYPES.has(edge.type)) source.runtime = target.runtime = true;
  }
  return map;
}
export function classifyNode(name, adjacency) {
  const node = adjacency.get(name);
  return !node || node.neighbors.size === 0 ? 'isolated' : node.runtime ? 'runtime' : 'connected';
}
export function filterNodes(nodes, adjacency, query = '', filter = 'all') {
  const text = query.trim().toLowerCase();
  return nodes.filter(node => node.name.toLowerCase().includes(text) && (filter === 'all' ||
    filter === 'connected' && classifyNode(node.name, adjacency) !== 'isolated' ||
    classifyNode(node.name, adjacency) === filter)).sort((a, b) => a.name.localeCompare(b.name));
}
export function layoutNodes(nodes, adjacency, selected = null) {
  const sorted = [...nodes].sort((a, b) => a.name.localeCompare(b.name));
  const visible = selected ? sorted.filter(node => node.name === selected || adjacency.get(selected)?.neighbors.has(node.name)) : sorted;
  const result = new Map();
  if (selected) {
    result.set(selected, { x: 450, y: 300 });
    const peers = visible.filter(node => node.name !== selected);
    peers.forEach((node, index) => {
      const angle = index * Math.PI * 2 / Math.max(peers.length, 1) - Math.PI / 2;
      const radius = peers.length > 30 && index % 2 ? 195 : 265;
      result.set(node.name, { x: 450 + Math.cos(angle) * radius * 1.35, y: 300 + Math.sin(angle) * radius });
    });
    return result;
  }
  const connected = visible.filter(node => classifyNode(node.name, adjacency) !== 'isolated');
  const isolated = visible.filter(node => classifyNode(node.name, adjacency) === 'isolated');
  connected.forEach((node, index) => {
    const radius = 245 * Math.sqrt((index + .5) / Math.max(connected.length, 1));
    const angle = index * Math.PI * (3 - Math.sqrt(5));
    result.set(node.name, { x: 450 + Math.cos(angle) * radius * 1.45, y: 300 + Math.sin(angle) * radius });
  });
  isolated.forEach((node, index) => {
    const angle = index * Math.PI * 2 / Math.max(isolated.length, 1);
    result.set(node.name, { x: 450 + Math.cos(angle) * 410, y: 300 + Math.sin(angle) * 285 });
  });
  return result;
}
export function graphSummary(nodes, edges) {
  const adjacency = buildAdjacency(nodes, edges), seen = new Set();
  let components = 0, largest = 0;
  for (const node of nodes) {
    if (seen.has(node.name)) continue;
    components++; let size = 0; const queue = [node.name];
    while (queue.length) {
      const name = queue.pop(); if (seen.has(name)) continue;
      seen.add(name); size++; queue.push(...adjacency.get(name).neighbors);
    }
    largest = Math.max(largest, size);
  }
  return { nodes: nodes.length, edges: edges.length, isolates: nodes.filter(node => !adjacency.get(node.name).neighbors.size).length, components, largest };
}
export function receiptMatches(receipt, hashes) {
  const p = receipt?.provenance;
  return p?.verified === true && typeof hashes.dependencySnapshotSha256 === 'string' &&
    ['dependencySnapshotSha256', 'runtimeSnapshotSha256', 'registrySha256'].every(key => hashes[key] && p[key] === hashes[key]);
}
export function capabilityStatus(capability, receipt, verified) {
  const state = verified ? receipt?.capabilities?.find(item => item.id === capability.id)?.status : 'unknown';
  if (state === 'passed') return { state, label: capability.kind === 'contract' ? 'Contract checks passed' : 'Integration checks passed' };
  if (state === 'failed') return { state, label: 'Checks failed' };
  return { state: 'unknown', label: 'No verified check result' };
}

if (typeof document !== 'undefined') boot();
async function boot() {
  const $ = id => document.getElementById(id);
  const el = (tag, text, className) => { const node = document.createElement(tag); if (text !== undefined) node.textContent = text; if (className) node.className = className; return node; };
  const svgEl = (tag, attributes) => { const node = document.createElementNS('http://www.w3.org/2000/svg', tag); for (const [key, value] of Object.entries(attributes)) node.setAttribute(key, value); return node; };
  const warnings = [];
  async function read(name, required = false) {
    try {
      const response = await fetch(`../../../data/${name}`, { cache: 'no-store', credentials: 'same-origin' });
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      const text = await response.text(); return { data: JSON.parse(text), text };
    } catch (error) {
      if (required) throw new Error(`${name}: ${error.message}`);
      warnings.push(`${name} unavailable`); return { data: null, text: null };
    }
  }
  async function digest(text) {
    if (text === null || !globalThis.crypto?.subtle) return null;
    const buffer = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text));
    return [...new Uint8Array(buffer)].map(value => value.toString(16).padStart(2, '0')).join('');
  }
  try {
    const [graphFile, runtimeFile, registryFile, receiptFile] = await Promise.all([
      read('npm-dependencies.latest.json', true), read('npm-runtime-relationships.latest.json'),
      read('ecosystem-capabilities.json'), read('ecosystem-web.latest.json')]);
    const graph = graphFile.data;
    if (!Array.isArray(graph.nodes) || !Array.isArray(graph.edges) || graph.nodes.some(node => typeof node.name !== 'string')) throw new Error('Invalid dependency snapshot');
    const [graphHash, runtimeHash, registryHash] = await Promise.all([digest(graphFile.text), digest(runtimeFile.text), digest(registryFile.text)]);
    const overlay = runtimeFile.data;
    const overlayValid = graphHash && overlay?.sourceSnapshotSha256 === graphHash && Array.isArray(overlay.relationships);
    if (overlay && !overlayValid) warnings.push('Runtime overlay has a different snapshot binding or cannot be verified; excluded');
    const names = new Set(graph.nodes.map(node => node.name));
    const declared = graph.edges.filter(edge => edge.internal && names.has(edge.source) && names.has(edge.target));
    const observed = overlayValid ? overlay.relationships.filter(edge => RUNTIME_TYPES.has(edge.type) && names.has(edge.source) && names.has(edge.target) && edge.sourceVersion === graph.nodes.find(node => node.name === edge.source)?.version) : [];
    const edges = [...declared, ...observed], adjacency = buildAdjacency(graph.nodes, edges);
    const registry = registryFile.data?.schema === 'ruflo-capabilities/v1' && Array.isArray(registryFile.data.capabilities) ? registryFile.data : { capabilities: [] };
    const receipt = receiptFile.data;
    const verified = receiptMatches(receipt, { dependencySnapshotSha256: graphHash, runtimeSnapshotSha256: runtimeHash, registrySha256: registryHash });
    let selected = null;
    const summary = graphSummary(graph.nodes, edges);
    const statValues = [[summary.nodes, 'Packages in the snapshot'], [edges.length, 'Declared + observed relationships'], [summary.isolates, 'Packages without mapped links'], [summary.largest, 'Packages in the largest component']];
    $('stats').replaceChildren(...statValues.map(([number, label]) => { const item = el('div', undefined, 'stat'); item.append(el('strong', number.toLocaleString()), el('span', label)); return item; }));
    $('message').textContent = `${declared.length} declared links · ${observed.length} source-observed links · ${summary.components} connected components. ${warnings.length ? warnings.join('. ') + '.' : 'Every runtime annotation is bound to this dependency snapshot.'}`;
    $('search').placeholder = `Search ${graph.nodes.length} packages…`;
    function choose(name) { selected = name; render(); renderDetail(); }
    function visibleNodes() { return filterNodes(graph.nodes, adjacency, $('search').value, $('filter').value); }
    function render() {
      const visible = visibleNodes();
      $('result-count').textContent = `${visible.length} of ${graph.nodes.length} packages`;
      $('package-list').replaceChildren(...visible.map(node => {
        const button = el('button', node.name, `package-item${selected === node.name ? ' active' : ''}`); button.type = 'button'; button.setAttribute('aria-pressed', String(selected === node.name));
        button.append(el('small', `${node.version || 'Unknown version'} · ${adjacency.get(node.name).neighbors.size} neighbors`)); button.addEventListener('click', () => choose(node.name)); return button;
      }));
      if (!visible.length) $('package-list').append(el('p', 'No matching packages. Try another name or view.', 'empty'));
      const positions = layoutNodes(selected ? graph.nodes : visible, adjacency, selected);
      $('graph-title').textContent = selected || 'Ecosystem overview';
      $('graph-subtitle').textContent = selected ? 'Focused neighborhood. Lines show direction in the inspector below.' : 'Spatial arrangement is illustrative. Select a package to inspect its links.';
      const svg = $('graph'); svg.replaceChildren();
      if (!selected) svg.append(svgEl('ellipse', { cx: 450, cy: 300, rx: 410, ry: 285, class: 'orbit' }));
      const visibleEdges = edges.filter(edge => positions.has(edge.source) && positions.has(edge.target) && (!selected || edge.source === selected || edge.target === selected));
      if (selected || $('show-edges').checked) for (const edge of visibleEdges) {
        const source = positions.get(edge.source), target = positions.get(edge.target);
        svg.append(svgEl('line', { x1: source.x, y1: source.y, x2: target.x, y2: target.y, class: `edge${RUNTIME_TYPES.has(edge.type) ? ' runtime' : ''}${selected ? ' focus' : ''}` }));
      }
      const focusable = [];
      for (const [name, position] of positions) {
        const type = classifyNode(name, adjacency);
        const node = svgEl('g', { transform: `translate(${position.x},${position.y})`, class: `node ${type}${name === selected ? ' selected' : ''}`, role: 'button', tabindex: '0', 'aria-label': `${name}, ${adjacency.get(name).neighbors.size} neighbors`, 'aria-pressed': String(name === selected) });
        node.append(svgEl('circle', { r: name === selected ? 13 : selected ? 7 : 4.5 }));
        const title = svgEl('title', {}); title.textContent = name; node.append(title);
        if (selected && positions.size < 45) { const label = svgEl('text', { y: name === selected ? -23 : 23 }); label.textContent = name.length > 35 ? name.slice(0, 32) + '…' : name; node.append(label); }
        const index = focusable.length; focusable.push(node);
        node.addEventListener('click', () => choose(name));
        node.addEventListener('keydown', event => {
          if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); choose(name); }
          if (['ArrowRight', 'ArrowDown', 'ArrowLeft', 'ArrowUp'].includes(event.key)) { event.preventDefault(); const delta = ['ArrowRight', 'ArrowDown'].includes(event.key) ? 1 : -1; focusable[(index + delta + focusable.length) % focusable.length]?.focus(); }
        });
        svg.append(node);
      }
      $('edge-count').textContent = `${positions.size} nodes · ${visibleEdges.length} relationships`;
    }
    function renderDetail() {
      const container = $('detail'); container.replaceChildren(); container.append(el('p', 'PACKAGE INSPECTOR', 'eyebrow'));
      if (!selected) { container.append(el('h2', 'Select any package'), el('p', 'Inspect incoming consumers, outgoing dependencies and source evidence.')); return; }
      const node = graph.nodes.find(item => item.name === selected), relation = adjacency.get(selected);
      container.append(el('h2', selected));
      const meta = el('div', undefined, 'detail-meta');
      for (const value of [`Version ${node.version || 'unknown'}`, `${relation.neighbors.size} mapped neighbors`, 'Availability: Not probed']) meta.append(el('span', value, 'status-chip'));
      container.append(meta);
      if (!relation.neighbors.size) container.append(el('p', 'No relationships are mapped in this snapshot. This can represent an independent tool, an unrecorded integration or an unfinished connection; it is not proof of a broken package.'));
      const columns = el('div', undefined, 'neighbor-columns');
      for (const [title, links, direction] of [['Used by', relation.incoming, 'source'], ['Uses', relation.outgoing, 'target']]) {
        const column = el('div'); column.append(el('h3', `${title} (${links.length})`)); const list = el('ul', undefined, 'neighbor-list');
        for (const link of links) { const item = el('li'), button = el('button', link[direction]); button.type = 'button'; button.addEventListener('click', () => choose(link[direction])); item.append(button, el('small', `${RUNTIME_TYPES.has(link.type) ? 'Observed' : 'Declared'} · ${link.type} · ${link.range || link.targetSelector || 'No selector recorded'}`)); list.append(item); }
        if (!links.length) list.append(el('li', 'None mapped')); column.append(list); columns.append(column);
      }
      container.append(columns);
      const evidence = el('ul', undefined, 'evidence-list');
      for (const link of [...relation.incoming, ...relation.outgoing].filter(item => RUNTIME_TYPES.has(item.type))) {
        const item = el('li'); item.append(el('strong', `${link.source} → ${link.target}`), el('code', link.evidence?.excerpt || 'No excerpt recorded'), el('span', `${link.evidence?.sourceFile || 'Unknown source'}:${link.evidence?.line || '?'} · source version ${link.sourceVersion}`));
        try { const url = new URL(link.evidence.tarballUrl); if (url.protocol === 'https:' && url.hostname === 'registry.npmjs.org') { const anchor = el('a', ' Inspect published archive ↗'); anchor.href = url.href; anchor.rel = 'noopener noreferrer'; anchor.target = '_blank'; item.append(anchor); } } catch { /* Missing evidence URL stays text-only. */ }
        evidence.append(item);
      }
      container.append(evidence);
    }
    $('receipt-state').textContent = verified ? 'Receipt matches all three snapshots' : 'No verified receipt';
    $('receipt-state').className = `status-chip ${verified ? 'passed' : 'unknown'}`;
    $('capability-list').replaceChildren(...registry.capabilities.map(capability => {
      const card = el('article', undefined, 'capability-card'), status = capabilityStatus(capability, receipt, verified);
      card.append(el('p', capability.kind || 'Unspecified contract', 'kind'), el('h3', capability.title || capability.id), el('span', status.label, `status-chip ${status.state}`));
      card.append(el('p', `Packages: ${(capability.packages || []).join(', ') || 'None declared'}`), el('p', `Checks: ${(capability.checks || []).join(', ') || 'None declared'}`), el('p', 'Availability: Not probed'));
      return card;
    }));
    if (!registry.capabilities.length) $('capability-list').append(el('p', 'Capability registry unavailable. Package relationships remain inspectable.', 'empty'));
    if (verified && receipt.cycle) {
      const cycle = receipt.cycle, checks = Array.isArray(cycle.checks) ? cycle.checks : [];
      $('cycle-summary').textContent = `${checks.filter(check => check.status === 'passed').length} of ${checks.length} registered checks passed. ${cycle.completedIterations ?? 0} cycles, ${cycle.newSourceIdentities ?? 0} new source identity records. ${cycle.uncoveredPackages?.length ?? 0} affected packages without selected checks. ${cycle.gate?.reason ?? 'No promotion authority.'}`;
      if (cycle.artifactReview?.status === 'review-ready') $('cycle-summary').append(document.createTextNode(` Relationship evidence explains ${cycle.artifactReview.baselineIsolates - cycle.artifactReview.candidateIsolates} previously isolated packages (${cycle.artifactReview.improvementPercent.toFixed(1)}%). This revalidates captured evidence, not new adoption.`));
      $('proposal-list').replaceChildren(...(Array.isArray(receipt.proposals) ? receipt.proposals : []).slice(0, 12).map(proposal => {
        const card = el('article', undefined, 'capability-card');
        card.append(el('p', `Priority ${proposal.priority ?? 'unranked'}`, 'kind'), el('h3', String(proposal.kind || 'Review').replaceAll('-', ' ')));
        card.append(el('p', (proposal.packages || []).join(', ') || proposal.checkId || 'Ecosystem evidence'));
        if (Number.isFinite(proposal.additionalBytes)) card.append(el('strong', `${(proposal.additionalBytes / 1e6).toFixed(2)} MB additional downloads`));
        card.append(el('p', proposal.reason || proposal.nextAction || 'Review the source evidence.')); return card;
      }));
    }
    $('search').addEventListener('input', () => { selected = null; render(); renderDetail(); });
    $('filter').addEventListener('change', () => { selected = null; render(); renderDetail(); });
    $('show-edges').addEventListener('change', render);
    $('reset').addEventListener('click', () => { selected = null; $('search').value = ''; $('filter').value = 'all'; render(); renderDetail(); });
    render(); renderDetail();
  } catch (error) {
    $('message').className = 'message error';
    $('message').textContent = `Could not load the ecosystem snapshots. ${error.message}\nServe the repository over HTTP: python3 -m http.server 8000\nThen open http://localhost:8000/docs/ecosystem/explorer/. Opening index.html directly with file:// cannot load the JSON snapshots.`;
  }
}
