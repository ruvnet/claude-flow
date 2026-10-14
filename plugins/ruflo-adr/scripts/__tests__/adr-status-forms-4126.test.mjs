// #4126: real-world status lines must not fall to "Unknown", README-style index files
// are not ADRs, and `adr-verify` surfaces any ADR left at Unknown.
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';

import { findAdrs, parseAdr } from '../lib/parse-adrs.mjs';
import { unknownStatusIds } from '../lib/index-records.mjs';

function withAdrs(files, fn) {
  const root = mkdtempSync(join(tmpdir(), 'ruflo-adr-4126-'));
  try {
    const dir = join(root, 'docs', 'adr');
    mkdirSync(dir, { recursive: true });
    for (const [name, body] of Object.entries(files)) writeFileSync(join(dir, name), body);
    return fn(root, dir);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
}

const adr = (n, statusLine, extra = '') => `# ADR-${n}: Decision ${n}\n\n${statusLine}\n- **Date**: 2026-07-02\n${extra}\n## Context\n\nSomething.\n`;

test('status keyword is read from the start of the line, whatever follows it', () => {
  const cases = [
    ['- **Status**: superseded by [ADR-025](ADR-025-next.md) (2026-07-02)', 'superseded'],
    ['- **Status**: accepted (2026-07-02) — de-risking spike closed all items', 'accepted'],
    ['**Status:** Accepted (2026-08-18) · **AMENDED 2026-08-20 — see Amendment 1 for the details**', 'Accepted'],
    ['- **Status**: accepted', 'accepted'],
    ['**Status**: Proposed (v3.6.x)', 'Proposed'],
    ['**Status:** Deprecated, replaced by ADR-040', 'Deprecated'],
    ['- **Status**: Rejected — not needed', 'Rejected'],
  ];
  withAdrs(Object.fromEntries(cases.map(([line], i) => [`ADR-${100 + i}-x.md`, adr(100 + i, line)])), (root, dir) => {
    cases.forEach(([line, want], i) => {
      const parsed = parseAdr(join(dir, `ADR-${100 + i}-x.md`), root);
      assert.equal(parsed.status, want, `status line: ${line}`);
    });
  });
});

test('existing forms keep their result: frontmatter status, multi-word status, no status', () => {
  withAdrs({
    'ADR-200-fm.md': '---\nid: ADR-200\nstatus: accepted\n---\n# ADR-200: fm\n',
    'ADR-201-multi.md': adr(201, '- **Status**: In Progress'),
    'ADR-202-none.md': '# ADR-202: nothing\n\nNo status line here.\n',
  }, (root, dir) => {
    assert.equal(parseAdr(join(dir, 'ADR-200-fm.md'), root).status, 'accepted');
    assert.equal(parseAdr(join(dir, 'ADR-201-multi.md'), root).status, 'In Progress');
    assert.equal(parseAdr(join(dir, 'ADR-202-none.md'), root).status, 'Unknown');
  });
});

test('"superseded by ADR-X" in the status line records the superseding ADR', () => {
  withAdrs({
    'ADR-009-old.md': adr(9, '- **Status**: superseded by [ADR-025](ADR-025-new.md) (2026-07-02)'),
  }, (root, dir) => {
    const parsed = parseAdr(join(dir, 'ADR-009-old.md'), root);
    assert.deepEqual(
      parsed.links.map(({ from, to, relation }) => `${relation}:${from}->${to}`),
      ['supersedes:ADR-009->ADR-025'],
    );
  });
});

test('index and template files in docs/adr are not ADRs', () => {
  withAdrs({
    'README.md': '# Architecture decisions\n\n| ADR | Title |\n|---|---|\n| 1 | x |\n',
    'index.md': '# Index\n',
    'template.md': '# ADR-000: template\n',
    'template-madr.md': '# ADR-000: template\n',
    'ADR-001-real.md': adr(1, '- **Status**: accepted'),
  }, (root) => {
    const found = findAdrs(root).map((p) => p.split('/').pop());
    assert.deepEqual(found, ['ADR-001-real.md']);
  });
});

test('unknownStatusIds lists the ADRs the importer could not classify', () => {
  const value = (status) => `Title — Context.\n\nfile: docs/adr/x.md\nstatus: ${status}\ndate: 2026-07-02\ntags: a`;
  const entries = [
    { key: 'ADR-001::accepted', value: value('accepted') },
    { key: 'ADR-002::b', value: value('Unknown') },
    { key: 'ADR-003::c', value: value('unknown') },
    { key: 'ADR-004::d', value: 'no status line at all' },
    { key: 'ADR-005::e' },
  ];
  assert.deepEqual(unknownStatusIds(entries), ['ADR-002', 'ADR-003']);
});
