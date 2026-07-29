import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';

import { parseAdr } from '../lib/parse-adrs.mjs';

test('adr-create bullet metadata and relationship lines round-trip through adr-index', () => {
  const root = mkdtempSync(join(tmpdir(), 'ruflo-adr-contract-'));
  try {
    const adrDir = join(root, 'docs', 'adr');
    mkdirSync(adrDir, { recursive: true });
    const file = join(adrDir, 'ADR-007-bullet-contract.md');
    writeFileSync(file, `# ADR-007: Bullet contract

- **Status**: accepted
- **Date**: 2026-07-29
- **Tags**: agentdb, lifecycle, graph
- **Supersedes**: ADR-006
- **Amends**: ADR-005
- **Related**: ADR-004
- **Depends-on**: ADR-003

## Context

The adr-create template and adr-index parser must agree.
`);

    const parsed = parseAdr(file, root);
    assert.equal(parsed.status, 'accepted');
    assert.equal(parsed.date, '2026-07-29');
    assert.deepEqual(parsed.tags, ['agentdb', 'lifecycle', 'graph']);
    assert.deepEqual(
      new Set(parsed.links.map(({ from, to, relation }) => `${relation}:${from}->${to}`)),
      new Set([
        'supersedes:ADR-006->ADR-007',
        'amends:ADR-007->ADR-005',
        'related:ADR-007->ADR-004',
        'depends-on:ADR-007->ADR-003',
      ]),
    );
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
