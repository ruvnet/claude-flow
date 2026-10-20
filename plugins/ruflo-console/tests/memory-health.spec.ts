/**
 * Memory health (ADR-457): the pure analysis, the probe's reader, and the view's honest states. Run with
 *   npx vitest run plugins/ruflo-console/tests/memory-health.spec.ts
 */
import { describe, expect, it } from 'vitest'

import { analyseHealth, HEALTH_CAP, jaccard, keyTokens, memoryHealthProbe, normaliseKey, type HealthEntry } from '../hooks/data/memory-health'
import { newState } from '../hooks/state'
import type { Ctx } from '../hooks/views/common'
import { healthRows, limitsLine } from '../hooks/views/memory-health'

const DAY = 86_400_000
const NOW = 1_800_000_000_000
const e = (namespace: string, key: string, size: number, accessCount: number, ageDays: number): HealthEntry => ({ namespace, key, size, accessCount, updatedAtMs: NOW - ageDays * DAY })

describe('memory health analysis', () => {
  it('normalises keys across case and separators and tokenises humps', () => {
    expect(normaliseKey('Api/Auth_Token')).toBe('apiauthtoken')
    expect([...keyTokens('authTokenRefresh')]).toEqual(['auth', 'token', 'refresh'])
    expect(jaccard(new Set(['a', 'b']), new Set(['b', 'c']))).toBeCloseTo(1 / 3)
    expect(jaccard(new Set(), new Set())).toBe(0)
  })

  it('clusters exact duplicates (same normalised key and size) and near ones (similar words, close size)', () => {
    const report = analyseHealth(
      { listed: 5, entries: [e('a', 'api/auth', 100, 1, 1), e('b', 'api-auth', 100, 1, 2), e('a', 'jwt-refresh-token-rotation', 200, 1, 3), e('a', 'jwt-refresh-token-rotation-v2', 210, 1, 4), e('a', 'unrelated', 50, 1, 5)] },
      NOW,
    )

    expect(report.clusterCount).toBe(2)
    expect(report.clusters[0]).toMatchObject({ kind: 'exact', size: 2 })
    expect(report.clusters[1]).toMatchObject({ kind: 'near', size: 2 })
    expect(report.duplicateEntries).toBe(4)
  })

  it('does not call far-apart sizes near, and a single entry is never a cluster', () => {
    const report = analyseHealth({ listed: 2, entries: [e('a', 'jwt-refresh-token-rotation', 100, 1, 1), e('a', 'jwt-refresh-token-rotation-v2', 900, 1, 2)] }, NOW)

    expect(report.clusterCount).toBe(0)
  })

  it('does not cluster unlike keys that merely share a size, and a same-key different-size pair is near, not exact', () => {
    const unlike = analyseHealth({ listed: 2, entries: [e('a', 'payment-gateway-config', 100, 1, 1), e('a', 'user-avatar-cache', 100, 1, 2)] }, NOW)
    const resized = analyseHealth({ listed: 2, entries: [e('a', 'api/auth', 100, 1, 1), e('b', 'api-auth', 500, 1, 2)] }, NOW)

    expect(unlike.clusterCount).toBe(0)
    expect(resized.clusters[0]).toMatchObject({ kind: 'near', size: 2 })
  })

  it('the same namespace and key listed twice is not a duplicate of itself', () => {
    expect(analyseHealth({ listed: 2, entries: [e('a', 'same-key', 10, 1, 1), e('a', 'same-key', 10, 1, 2)] }, NOW).clusterCount).toBe(0)
  })

  it('the pair budget drops the OLDEST entries: a duplicate among the oldest is not found, one among the newest is', () => {
    const filler = Array.from({ length: 30 }, (_, index) => e('f', `filler-${index}-zz${index}`, 10 + index * 7, 1, 10 + index))
    const newest = [e('n', 'fresh-dup-key', 999, 1, 0), e('m', 'fresh-dup-key', 999, 1, 0.5)]
    const oldest = [e('o', 'ancient-dup-key', 777, 1, 400), e('p', 'ancient-dup-key', 777, 1, 401)]
    const report = analyseHealth({ listed: 34, entries: [...oldest, ...filler, ...newest] }, NOW, { pairCap: 120 })

    expect(report.isTruncated).toBe(true)
    expect(report.clusters.flatMap(cluster => cluster.members.map(member => member.key))).toEqual(['fresh-dup-key', 'fresh-dup-key'])
  })

  it('stale means never recalled and not updated for the window; a recalled or undated entry is never stale', () => {
    const undated: HealthEntry = { namespace: 'a', key: 'undated', size: 1, accessCount: 0 }
    const report = analyseHealth({ listed: 4, entries: [e('a', 'old-unread', 1, 0, 90), e('a', 'old-read', 1, 3, 90), e('a', 'new-unread', 1, 0, 2), undated] }, NOW)

    expect(report.stale.map(entry => entry.key)).toEqual(['old-unread'])
    expect(report.staleCount).toBe(1)
    expect(report.neverRecalledEntries).toBe(3)
  })

  it('reports namespaces where nothing was ever recalled', () => {
    const report = analyseHealth({ listed: 3, entries: [e('cold', 'x1', 1, 0, 1), e('cold', 'x2', 1, 0, 1), e('warm', 'y1', 1, 2, 1)] }, NOW)

    expect(report.neverRecalledNamespaces).toEqual(['cold'])
    expect(report.namespaces.find(space => space.name === 'warm')).toMatchObject({ recalled: 1, isNeverRecalled: false })
  })

  it('stops at the pair budget, compares the newest first, and says so', () => {
    const entries = Array.from({ length: 40 }, (_, index) => e('a', `entry-number-${index}-${index % 2 === 0 ? 'even' : 'odd'}`, 10, 1, index))
    const full = analyseHealth({ listed: 40, entries }, NOW)
    const cut = analyseHealth({ listed: 40, entries }, NOW, { pairCap: 100 })

    expect(full.isTruncated).toBe(false)
    expect(full.pairsCompared).toBe(780)
    expect(cut.isTruncated).toBe(true)
    expect(cut.pairsCompared).toBe(100)
    expect(cut.entriesCompared).toBeLessThan(40)
    expect(limitsLine(cut, 5000)).toMatch(/pair budget .* reached: only the newest \d+ entries were compared/)
    expect(limitsLine(cut, 5000)).toMatch(/of 5000 stored \(the newest 1000 are read\)/)
  })

  it('an empty sample yields an empty report, not a crash', () => {
    const report = analyseHealth({ listed: 0, entries: [] }, NOW)

    expect(report).toMatchObject({ analysed: 0, clusterCount: 0, staleCount: 0, isTruncated: false })
  })
})

describe('the health probe reader', () => {
  const stdout = JSON.stringify([
    { key: 'api/auth', namespace: 'default', size: 12, accessCount: 2, createdAt: '2026-01-01T00:00:00Z', updatedAt: '2026-02-01T00:00:00Z', hasEmbedding: true, content: 'must-not-be-kept' },
    { namespace: 'default', size: 1 },
    { key: 'k2', size: 'x' },
  ])

  it('keeps key, namespace, size, access count and times, drops rows without a key, and never carries a value', () => {
    const sample = memoryHealthProbe.parse(`[INFO] noise\n${stdout}`)

    expect(sample?.listed).toBe(3)
    expect(sample?.entries).toHaveLength(2)
    expect(sample?.entries[0]).toMatchObject({ key: 'api/auth', namespace: 'default', size: 12, accessCount: 2 })
    expect(JSON.stringify(sample)).not.toContain('must-not-be-kept')
    expect(sample?.entries[1]).toMatchObject({ key: 'k2', namespace: '(none)', size: 0, accessCount: 0 })
    expect(memoryHealthProbe.parse('not json')).toBeNull()
  })

  it('reads at most HEALTH_CAP rows even if the CLI ignores --limit', () => {
    const rows = Array.from({ length: HEALTH_CAP + 50 }, (_, index) => ({ key: `k${index}`, namespace: 'n', size: 1, accessCount: 0 }))
    const sample = memoryHealthProbe.parse(JSON.stringify(rows))

    expect(sample?.entries).toHaveLength(HEALTH_CAP)
    expect(sample?.listed).toBe(HEALTH_CAP)
  })

  it('asks for exactly the cap, read-only, through the fixed memory list argv', () => {
    expect(memoryHealthProbe.args).toEqual(['memory', 'list', '--format', 'json', '--limit', String(HEALTH_CAP)])
  })
})

type El = { kind: string; props: Record<string, unknown> }
const make = (kind: string) => (props: Record<string, unknown>): El => ({ kind, props })
const kit = { Box: make('Box'), Text: make('Text'), Button: make('Button'), Input: make('Input') }
const act = new Proxy({}, { get: () => new Proxy({}, { get: () => () => undefined }) }) as unknown as Ctx['act']
const flat = (node: unknown): El[] => {
  if (Array.isArray(node)) return node.flatMap(flat)
  if (typeof node !== 'object' || node === null) return []
  const el = node as El
  const children = el.props.children

  return [el, ...(Array.isArray(children) ? children.flatMap(flat) : flat(children))]
}
const textOf = (nodes: unknown): string => flat(nodes).filter(el => el.kind === 'Text').map(el => String(el.props.children)).join('\n')

function draw(probes: [string, unknown][]): { out: string; buttons: string[] } {
  const state = newState({ boot: false })

  for (const [id, result] of probes) state.probes.set(id, result as never)

  const nodes = healthRows({ kit, state, act, columns: 120, nowMs: NOW, pictures: new Map() } as unknown as Ctx)

  return { out: textOf(nodes), buttons: flat(nodes).filter(el => el.kind === 'Button').map(el => String(el.props.key)) }
}

describe('the health view', () => {
  it('shows an honest line, no invented numbers, when the probe has not answered', () => {
    expect(draw([]).out).toMatch(/not registered in this build/)
    expect(draw([['memory-health', { value: null, okAtMs: null, error: 'boom', errorAtMs: NOW, isRunning: false }]]).out).toMatch(/boom/)
  })

  it('shows an empty-store line for an empty sample', () => {
    expect(draw([['memory-health', { value: { listed: 0, entries: [] }, okAtMs: NOW, error: null, errorAtMs: null }]]).out).toMatch(/no entries to analyse/)
  })

  it('draws the figures, the limits line and the consolidate button from a real sample', () => {
    const sample = { listed: 3, entries: [e('a', 'api/auth', 100, 0, 90), e('b', 'api-auth', 100, 0, 91), e('c', 'solo', 5, 4, 1)] }
    const { out, buttons } = draw([['memory-health', { value: sample, okAtMs: NOW, error: null, errorAtMs: null }]])

    expect(out).toMatch(/3 entries · 3 of 3 pairs compared · from key and size only, no values read/)
    expect(out).toMatch(/2 entries in 1 cluster/)
    expect(out).toMatch(/same ×2/)
    expect(out).toMatch(/2 never retrieved and not updated for 30d/)
    expect(buttons).toContain('mem-health-consolidate')
  })
})

describe('the analysis cost at the cap', () => {
  it('analyses HEALTH_CAP entries inside the pair budget quickly (generous bound, the measured time is printed)', () => {
    const entries = Array.from({ length: HEALTH_CAP }, (_, index) => e(`ns${index % 7}`, `topic-${index % 90}-item-${index}`, 50 + (index % 40), index % 3, index % 120))
    const started = performance.now()
    const report = analyseHealth({ listed: HEALTH_CAP, entries }, NOW)
    const ms = performance.now() - started

    console.log(`memory health: ${HEALTH_CAP} entries, ${report.pairsCompared} pairs, ${report.clusterCount} clusters in ${ms.toFixed(0)} ms`)
    expect(report.analysed).toBe(HEALTH_CAP)
    expect(ms).toBeLessThan(5000)
  })
})

describe('the per-frame cost', () => {
  it('computes the report once per sample and minute, not once per render', async () => {
    const { reportFor } = await import('../hooks/views/memory-health')
    const sample = { listed: 2, entries: [e('a', 'x-y', 10, 0, 1), e('b', 'x-y', 10, 0, 2)] }

    expect(reportFor(sample, NOW)).toBe(reportFor(sample, NOW + 1000))
    expect(reportFor(sample, NOW + 120_000)).not.toBe(reportFor(sample, NOW))
    expect(reportFor({ ...sample }, NOW)).not.toBe(reportFor(sample, NOW))
  })
})
