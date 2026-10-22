import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { parseAdr } from '../lib/parse-adrs.mjs';

// Support both the repository's Vitest collection and the standalone Node smoke.
const { test } = process.env.VITEST ? await import('vitest') : await import('node:test');

function links(body) {
  const dir = mkdtempSync(join(tmpdir(), 'adr-relations-'));
  try {
    const file = join(dir, 'ADR-032-example.md');
    writeFileSync(file, `# ADR-032: Example\n\n**Status**: accepted\n\n${body}\n`);
    return parseAdr(file, dir).links;
  } finally { rmSync(dir, { recursive: true, force: true }); }
}

for (const label of ['Supersedes in part', 'Amends by scope', 'Relates', 'Depends-on / confirms']) {
  test(`retains a relation with the ${label} label`, () => {
    assert.equal(links(`**${label}**: ADR-031`).length, 1);
  });
}
test('narrative continuation cannot invent an ADR edge', () => {
  const edges = links('**Amends (by scope)**: ADR-031 surveyed two sites\nand missed a third.\nADR-031 itself applied a correction to ADR-030.');
  assert.deepEqual(edges, [{ from: 'ADR-032', to: 'ADR-031', relation: 'amends' }]);
});
test('wrapped reference-only lists still retain every reference', () => {
  const edges = links('**Related**: ADR-030,\nADR-031, [ADR-029](ADR-029.md)\n\n## Context\nADR-028 is background.');
  assert.deepEqual(edges.map(e => e.to), ['ADR-030', 'ADR-031', 'ADR-029']);
});
test('supports repeated fields without treating ordinary prose as metadata', () => {
  const edges = links('**Related**: ADR-030\n\n**Related (implementation)**: ADR-031\n\nRelated: ADR-029');
  assert.deepEqual(edges.map(e => e.to), ['ADR-030', 'ADR-031']);
});
