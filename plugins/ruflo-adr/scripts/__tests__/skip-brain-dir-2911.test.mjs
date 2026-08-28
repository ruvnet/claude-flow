import assert from 'node:assert/strict';
import test from 'node:test';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

import { SKIP_DIRS, findAdrs } from '../lib/parse-adrs.mjs';

// #2911: ruvnet-brain clones ~50 external repos under `.brain/repo/clones/`,
// many with their own docs/adr/. Without `.brain` in SKIP_DIRS, findAdrs()
// walks into those clones and returns hundreds of foreign ADRs alongside
// the project's own — and since `.brain` sorts before `docs`, the
// project's ADRs land at the end of the walk, dead last.

test('SKIP_DIRS includes .brain', () => {
  assert.ok(SKIP_DIRS.has('.brain'));
});

test('findAdrs does not descend into .brain', () => {
  const root = mkdtempSync(join(tmpdir(), 'ruflo-adr-2911-'));
  try {
    // Project's own ADR
    mkdirSync(join(root, 'docs', 'adr'), { recursive: true });
    writeFileSync(join(root, 'docs', 'adr', 'ADR-001-real.md'), '# ADR-001\n');

    // A foreign clone under .brain with its own docs/adr/
    mkdirSync(join(root, '.brain', 'repo', 'clones', 'some-external-repo', 'docs', 'adr'), {
      recursive: true,
    });
    writeFileSync(
      join(root, '.brain', 'repo', 'clones', 'some-external-repo', 'docs', 'adr', 'ADR-999-foreign.md'),
      '# ADR-999\n',
    );

    const found = findAdrs(root);
    const names = found.map((p) => p.split('/').pop());

    assert.deepEqual(names, ['ADR-001-real.md']);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
