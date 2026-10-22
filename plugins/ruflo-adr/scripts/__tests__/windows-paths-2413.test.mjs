import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { findAdrs, isAdrPath, parseAdr } from '../lib/parse-adrs.mjs';

// Support both the repository's Vitest collection and the standalone Node smoke.
const { test } = process.env.VITEST ? await import('vitest') : await import('node:test');

test('recognizes docs/adr paths with either separator (#2413)', () => {
  assert.equal(isAdrPath('C:\\repo\\docs\\adr\\ADR-001.md'), true);
  assert.equal(isAdrPath('C:\\repo\\docs\\adrs\\ADR-001.md'), true);
  assert.equal(isAdrPath('/repo/docs/adr/ADR-001.md'), true);
  assert.equal(isAdrPath('/repo/docs/adrs/ADR-001.md'), true);
  assert.equal(isAdrPath('docs/adr/ADR-001.md'), true);
  assert.equal(isAdrPath('/repo/docs/architecture/ADR-001.md'), false);
  assert.equal(isAdrPath('/repo/adr/ADR-001.md'), false);
});

test('finds ADRs and reports repo-relative POSIX paths (#2413)', () => {
  const root = mkdtempSync(join(tmpdir(), 'ruflo-adr-paths-'));
  try {
    mkdirSync(join(root, 'docs', 'adr'), { recursive: true });
    mkdirSync(join(root, 'docs', 'adrs', 'nested'), { recursive: true });
    mkdirSync(join(root, 'docs', 'other'), { recursive: true });
    writeFileSync(
      join(root, 'docs', 'adr', 'ADR-001-test.md'),
      '# ADR-001: Test\n\n**Status**: accepted\n',
    );
    writeFileSync(
      join(root, 'docs', 'adrs', 'nested', 'ADR-002-nested.md'),
      '# ADR-002: Nested\n\n**Status**: accepted\n',
    );
    writeFileSync(
      join(root, 'docs', 'other', 'ADR-003-ignored.md'),
      '# ADR-003: Ignored\n\n**Status**: accepted\n',
    );

    const files = findAdrs(root);
    assert.equal(files.length, 2);
    assert.ok(files.some((file) => file.endsWith('ADR-001-test.md')));
    assert.ok(files.some((file) => file.endsWith('ADR-002-nested.md')));

    const parsed = parseAdr(join(root, 'docs', 'adr', 'ADR-001-test.md'), root);
    assert.equal(parsed.id, 'ADR-001');
    assert.equal(parsed.file, 'docs/adr/ADR-001-test.md');
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
