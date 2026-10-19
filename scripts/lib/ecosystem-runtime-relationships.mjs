/** Validate provenance bindings before adding non-install runtime relationships. */
export function applyRuntimeRelationships(snapshot, overlay, sourceHash) {
  if (overlay?.schema !== 'ruvnet.runtime-relationships.v1' || overlay.sourceSnapshotSha256 !== sourceHash) throw new Error('Runtime evidence snapshot mismatch');
  if (!Array.isArray(overlay.relationships) || !Array.isArray(overlay.unresolved)) throw new Error('Invalid runtime evidence arrays');
  const nodes = new Map(snapshot.nodes.map(n => [n.name, n])), seen = new Set();
  const edges = overlay.relationships.map(link => {
    const node = nodes.get(link.source), evidence = link.evidence;
    if (!node || !nodes.has(link.target) || node.status !== 'captured' || link.sourceVersion !== node.version) throw new Error('Runtime evidence package/version mismatch');
    if (!['runtime-command', 'native-fallback'].includes(link.type)) throw new Error('Invalid runtime relationship type');
    const basename = node.name.split('/').at(-1);
    const expectedUrl = `https://registry.npmjs.org/${node.name}/-/${basename}-${node.version}.tgz`;
    if (!evidence || evidence.tarballUrl !== expectedUrl || evidence.integrity !== node.integrity || !/^sha512-[A-Za-z0-9+/]+={0,2}$/.test(evidence.integrity)) throw new Error('Runtime evidence integrity mismatch');
    if (!/^package\//.test(evidence.sourceFile) || evidence.sourceFile.split('/').includes('..') || !Number.isInteger(evidence.line) || evidence.line < 1 || !evidence.excerpt || !/^[a-f0-9]{64}$/.test(evidence.sourceSha256) || !link.targetSelector) throw new Error('Incomplete runtime source evidence');
    const key = JSON.stringify([link.source, link.target, link.type]);
    if (seen.has(key)) throw new Error('Duplicate runtime relationship'); seen.add(key);
    return { source: link.source, target: link.target, type: link.type, range: link.targetSelector, internal: true, evidence: { ...evidence } };
  });
  return { ...snapshot, edges: [...snapshot.edges, ...edges] };
}
