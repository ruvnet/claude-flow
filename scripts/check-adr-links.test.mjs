import assert from 'node:assert/strict'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'
import { checkDuplicates, checkLinks, checkRelations, listAdrs, relatedNumbers, relativeLinks, run } from './check-adr-links.mjs'

function fixture(files) {
  const dir = mkdtempSync(join(tmpdir(), 'adr-check-'))
  for (const [name, body] of Object.entries(files)) writeFileSync(join(dir, name), body)
  return dir
}

test('the real ADR directory is clean', () => {
  assert.deepEqual(run(), [])
})

test('a duplicate ADR number fails, a known one does not', () => {
  const dir = fixture({ 'ADR-401-a.md': '#', 'ADR-401-b.md': '#', 'ADR-430-a.md': '#', 'ADR-430-b.md': '#', 'ADR-430-c.md': '#' })
  try {
    const found = checkDuplicates(listAdrs(dir))
    assert.equal(found.length, 2)
    assert.match(found[0], /401/)
    assert.match(found[1], /430/)
    assert.deepEqual(checkDuplicates(listAdrs(dir).filter(a => a.file !== 'ADR-430-c.md')).filter(f => /430/.test(f)), [])
  } finally { rmSync(dir, { recursive: true }) }
})

test('a broken relative link fails; urls, anchors, code and fences are ignored', () => {
  const body = [
    '# ADR 410', '', '[ok](ADR-411-b.md#sec) [bad](missing.md) [web](https://x.test/a.md) [here](#top)',
    '`[inline](nope.md)`', '```', '[fenced](nope2.md)', '```',
  ].join('\n')
  const dir = fixture({ 'ADR-410-a.md': body, 'ADR-411-b.md': '# b' })
  try {
    assert.deepEqual(relativeLinks(body), ['ADR-411-b.md', 'missing.md'])
    assert.deepEqual(checkLinks(listAdrs(dir), dir), ['ADR-410-a.md: broken relative link missing.md'])
  } finally { rmSync(dir, { recursive: true }) }
})

test('relation lines name existing ADRs; other repos\' ADRs are not ours', () => {
  assert.deepEqual(relatedNumbers('Builds on: ADR-406 (missions), ADR 437 and ADR-441\nStatus: ADR-999'), [406, 437, 441])
  assert.deepEqual(relatedNumbers('Extends: ADR 404. Preserves ADR 322A, and ADR 324/325; ruOS ADR-043'), [404, 322, 324, 325])
  const dir = fixture({ 'ADR-410-a.md': '# t\n\nBuilds on: ADR-411, ADR-499\n', 'ADR-411-b.md': '# b' })
  try {
    assert.deepEqual(checkRelations(listAdrs(dir), dir), ['ADR-410-a.md: relation line names ADR 499, which has no file'])
  } finally { rmSync(dir, { recursive: true }) }
})
