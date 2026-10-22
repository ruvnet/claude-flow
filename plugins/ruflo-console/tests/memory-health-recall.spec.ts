/**
 * Memory health with the hook's recall log and stored vectors (ADR-472): "stale" judged by the log where it can speak, and the
 * accessCount rule everywhere else; similar-by-meaning clusters only when vectors were read. Run with
 *   npx vitest run plugins/ruflo-console/tests/memory-health-recall.spec.ts
 */
import { describe, expect, it } from 'vitest'

import { analyseHealth, recallEvidenceOf, SEMANTIC_CAP, semanticDuplicates, SIMILAR_COSINE, type HealthEntry } from '../hooks/data/memory-health'
import { parseRanked, parseRecallLog, type RecallFacts } from '../hooks/data/recall'
import type { MapEntry } from '../hooks/gfx/memmap'
import { newState } from '../hooks/state'
import type { Ctx } from '../hooks/views/common'
import { healthRows, staleRule } from '../hooks/views/memory-health'

const DAY = 86_400_000
const NOW = 1_800_000_000_000
const e = (namespace: string, key: string, accessCount: number, updatedDaysAgo: number): HealthEntry => ({ namespace, key, size: 100, accessCount, updatedAtMs: NOW - updatedDaysAgo * DAY })
const ranked = JSON.stringify({ computedAt: 1, entries: [{ id: 'mem_old', category: 'project_old', summary: 's', words: [], pageRank: 0.1 }, { id: 'mem_hot', category: 'project_hot', summary: 's', words: [], pageRank: 0.1 }] })
const rec = (daysAgo: number, id: string, cat = 'auto-memory') => JSON.stringify({ at: NOW - daysAgo * DAY, digest: 'abcdabcdabcdabcd', surfaced: [{ id, score: 0.2, rank: 1, cat }] })
const factsOf = (lines: string[]): RecallFacts => ({ ranked: parseRanked(ranked), sessions: [], prompts: [], neural: null, log: parseRecallLog(lines.join('\n')), reads: { ranked: 'ok', sessions: 'ok', prompts: 'ok', neural: 'missing', bank: 'ok', log: 'ok' } })

describe('stale by the recall log', () => {
  // A 60-day log: the hook surfaced project_hot 3 days ago and nothing else lately.
  const facts = factsOf([rec(60, 'mem_old', 'project_old'), rec(3, 'mem_hot', 'project_hot'), rec(1, 'other', 'x')])
  const sample = { listed: 4, entries: [e('claude-memories', 'project_old', 5, 90), e('claude-memories', 'project_hot', 0, 90), e('notes', 'plain', 0, 90), e('notes', 'plain-used', 2, 90)] }

  it('judges an entry the hook can recall by the log (not surfaced in the window), whatever its access count says', () => {
    const report = analyseHealth(sample, NOW, { evidence: recallEvidenceOf(facts, NOW) })
    const byKey = new Map(report.stale.map(entry => [entry.key, entry.by]))

    expect(byKey.get('project_old')).toBe('log') // accessCount 5, but the hook last surfaced it 60 days ago
    expect(byKey.has('project_hot')).toBe(false) // accessCount 0, but surfaced 3 days ago
    expect(byKey.get('plain')).toBe('count') // the hook cannot recall it: the access-count rule
    expect(byKey.has('plain-used')).toBe(false)
    expect(report).toMatchObject({ staleCount: 2, staleByLog: 1, staleByCount: 1, logChecked: 2 })
    expect(report.log?.records).toBe(3)
  })

  it('never calls an entry updated inside the window stale, even if the hook has not surfaced it', () => {
    const report = analyseHealth({ listed: 1, entries: [e('claude-memories', 'project_old', 0, 2)] }, NOW, { evidence: recallEvidenceOf(facts, NOW) })

    expect(report.staleCount).toBe(0)
  })

  it('does not let a log shorter than the window speak: the access-count rule applies and the report says the log was not used', () => {
    const short = factsOf([rec(5, 'other', 'x')])
    const report = analyseHealth(sample, NOW, { evidence: recallEvidenceOf(short, NOW) })

    expect(report.logChecked).toBe(0)
    expect(report.staleByLog).toBe(0)
    expect(report.stale.every(entry => entry.by === 'count')).toBe(true)
    expect(report.stale.map(entry => entry.key).sort()).toEqual(['plain', 'project_hot'])
    expect(staleRule(report)).toMatch(/shorter than 30d/)
  })

  it('has no evidence without a log or without the ranked file, and then matches the old rule exactly', () => {
    expect(recallEvidenceOf(null, NOW)).toBeNull()
    expect(recallEvidenceOf(factsOf([]), NOW)).toBeNull()
    expect(recallEvidenceOf({ ...facts, ranked: null }, NOW)).toBeNull()

    const plain = analyseHealth(sample, NOW)

    expect(plain.log).toBeNull()
    expect(plain.stale.map(entry => [entry.key, entry.by]).sort()).toEqual([['plain', 'count'], ['project_hot', 'count']])
    expect(staleRule(plain)).toMatch(/access count only/)
  })

  it('names both rules in the rule line and in the view', () => {
    const report = analyseHealth(sample, NOW, { evidence: recallEvidenceOf(facts, NOW) })

    expect(staleRule(report)).toMatch(/log for 2 entries whose key the hook can recall/)
    expect(staleRule(report)).toMatch(/access count for the rest/)

    const state = newState({ boot: false })
    const kit = { Box: (props: object) => ({ kind: 'Box', props }), Text: (props: object) => ({ kind: 'Text', props }), Button: (props: object) => ({ kind: 'Button', props }) }

    state.snapshot = { recall: facts } as never
    state.probes.set('memory-health', { value: sample, okAtMs: NOW, error: null, errorAtMs: null } as never)

    const nodes = healthRows({ kit, state, act: new Proxy({}, { get: () => new Proxy({}, { get: () => () => undefined }) }), columns: 200, nowMs: NOW, pictures: new Map() } as unknown as Ctx)
    const flat = (node: unknown): { kind: string; props: Record<string, unknown> }[] => (Array.isArray(node) ? node.flatMap(flat) : typeof node === 'object' && node !== null ? [node as never, ...flat((node as { props: { children?: unknown } }).props.children)] : [])
    const shown = flat(nodes).filter(el => el.kind === 'Text').map(el => String(el.props.children)).join('\n')

    expect(shown).toContain('by recall log')
    expect(shown).toContain('by access count')
    expect(shown).toContain('(retrievals by memory retrieve or search, not the hook)')
  })
})

const unit = (n: number, seed: number): number[] => {
  const v = Array.from({ length: n }, (_, i) => Math.sin(seed * 12.9898 + i * 78.233))
  const norm = Math.sqrt(v.reduce((sum, x) => sum + x * x, 0))

  return v.map(x => x / norm)
}
const vec = (key: string, vector: number[] | undefined, namespace = 'a'): MapEntry => ({ key, namespace, hasVector: vector !== undefined, ...(vector !== undefined && { vector }) })

describe('similar by meaning', () => {
  it('clusters stored vectors at or above the cosine threshold, and only those', () => {
    const base = unit(64, 1)
    const twin = base.map((x, i) => x + 0.001 * Math.cos(i))
    const report = semanticDuplicates([vec('base', base), vec('twin', twin, 'b'), vec('other', unit(64, 50)), vec('none', undefined)])

    expect(report).toMatchObject({ compared: 3, withVector: 3, listed: 4, clusterCount: 1, entries: 2, cap: SEMANTIC_CAP })
    expect(report?.clusters[0]?.members.map(member => `${member.namespace}/${member.key}`).sort()).toEqual(['a/base', 'b/twin'])
    expect(report?.clusters[0]?.minCosine).toBeGreaterThanOrEqual(SIMILAR_COSINE)
  })

  it('does not run, and says so, when no or one entry carries a vector', () => {
    expect(semanticDuplicates([vec('a', undefined), vec('b', undefined)])).toBeNull()
    expect(semanticDuplicates([vec('a', unit(8, 1))])).toBeNull()
    expect(semanticDuplicates([])).toBeNull()
  })

  it('compares at most the cap and reports how many it left out', () => {
    const many = Array.from({ length: SEMANTIC_CAP + 25 }, (_, i) => vec(`k${i}`, unit(8, i)))
    const report = semanticDuplicates(many)

    expect(report?.compared).toBe(SEMANTIC_CAP)
    expect(report?.withVector).toBe(SEMANTIC_CAP + 25)
    expect(report?.pairs).toBe((SEMANTIC_CAP * (SEMANTIC_CAP - 1)) / 2)
  })

  it('handles vectors of unequal length and an all-zero vector without throwing or inventing a match', () => {
    const report = semanticDuplicates([vec('a', [1, 0, 0]), vec('b', [1, 0]), vec('z', [0, 0, 0])])

    expect(report?.clusterCount).toBe(1) // [1,0,0] and [1,0] are the same direction once padded; the zero vector matches nothing
    expect(report?.clusters[0]?.members.map(member => member.key).sort()).toEqual(['a', 'b'])
  })

  it('costs a bounded amount at 500 x 384', () => {
    const entries = Array.from({ length: SEMANTIC_CAP }, (_, i) => vec(`k${i}`, unit(384, i)))
    const started = performance.now()
    const report = semanticDuplicates(entries)
    const ms = performance.now() - started

    console.log(`similar by meaning: ${SEMANTIC_CAP} x 384, ${report?.pairs} pairs in ${ms.toFixed(0)} ms`)
    expect(ms).toBeLessThan(3000)
  })
})
