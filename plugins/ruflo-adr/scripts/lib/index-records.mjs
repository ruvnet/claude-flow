// Pure record construction helpers shared by adr-index and adr-reindex.
//
// Keeping identity and CLI argv construction here makes the persistence
// contract directly testable without spawning `npx` or touching memory.db.

import { basename } from 'node:path';

export const CLI_PKG = '@claude-flow/cli@latest';

export function adrRecordKey(adr) {
  return `${adr.id}::${basename(adr.file, '.md')}`;
}

export function adrRecordValue(adr) {
  return `${adr.title} — ${adr.context || '(no context)'}\n\n` +
    `file: ${adr.file}\n` +
    `status: ${adr.status}\n` +
    `date: ${adr.date}\n` +
    `tags: ${adr.tags.join(',')}`;
}

// An ADR relationship's identity is its semantic triple. Timestamps describe
// an observation; they must not be part of identity or every index run creates
// another logically-identical edge (#2660).
export function edgeKey(edge) {
  return `${edge.relation}:${edge.from}->${edge.to}`;
}

// Accept the deterministic #2660 key and the legacy timestamp-random suffix
// so existing installations remain verifiable after upgrading.
export function parseEdgeKey(key) {
  const match = /^([\w-]+):([^:]+)->([^:]+?)(?::\d+-[a-z0-9]+)?$/i.exec(key);
  if (!match) return null;
  return { relation: match[1], from: match[2], to: match[3], key };
}

export function edgeValue(edge, capturedAt = new Date().toISOString()) {
  return JSON.stringify({ ...edge, capturedAt });
}

export function uniqueEdges(edges) {
  const byIdentity = new Map();
  for (const edge of edges) {
    const key = edgeKey(edge);
    if (!byIdentity.has(key)) byIdentity.set(key, edge);
  }
  return [...byIdentity.values()];
}

export function memoryStoreArgs(namespace, key, value) {
  const valueStr = typeof value === 'string' ? value : JSON.stringify(value);
  return [
    CLI_PKG, 'memory', 'store',
    `--namespace=${namespace}`,
    `--key=${key}`,
    '--upsert',
    `--value=${valueStr}`,
  ];
}
