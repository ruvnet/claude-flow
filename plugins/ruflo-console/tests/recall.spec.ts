/** Explain-a-recall and the pattern lifecycle (ADR-456): parsers, the hook's own scoring, the commands' argv, and what the rows say. */
import { existsSync, mkdirSync, mkdtempSync, writeFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'

import { describe, expect, it } from 'vitest'

import { compositeRank, digestOf, explainPrompt, jaccard, lifecycleOrder, parseNeuralStore, parsePrompts, parseRanked, parseSessionRecall, readRecall, tokenize, trigrams, wouldPrune, type RecallFacts } from '../hooks/data/recall'
import { promoteSpec, pruneSpec, pruneUnusedSpec, recallEntries } from '../hooks/recall'
import { readSnapshot } from '../hooks/data/snapshot'
import { paletteEntries } from '../hooks/palette'
import { newState } from '../hooks/state'
import type { Ctx } from '../hooks/views/common'
import { lifecycleRows, pickPrompt, recallRows } from '../hooks/views/recall-rows'

const ranked = (entries: unknown[]) => JSON.stringify({ version: 1, computedAt: 1_791_244_689_589, entries })
const entry = (id: string, summary: string, pageRank: number, confidence = 0.5, accessCount = 0) => ({ id, summary, content: summary, category: 'auto-memory', confidence, pageRank, accessCount, words: tokenize(summary) })

const RANKED = ranked([
  entry('mem_a', 'authentication token refresh for the login service', 0.04, 0.6, 3),
  entry('mem_b', 'deploy the cloud run gateway with traffic migration', 0.02),
  entry('mem_c', 'unrelated gardening notes about tomatoes', 0.001),
])

const MODELS = JSON.stringify({
  models: {},
  patterns: {
    'pattern-1-a': { id: 'pattern-1-a', name: 'fix: wire recordTrajectory', type: 'history-commit', embedding: [0.1], content: 'paths: hooks-tools.ts:142', metadata: { verdict: 'success' }, createdAt: '2026-09-27T17:34:15.801Z', usageCount: 0 },
    'pattern-2-b': { id: 'pattern-2-b', name: 'Dream Cycle scan', type: 'history-issue', content: 'MV-HNSW gap', metadata: { verdict: 'partial' }, createdAt: '2026-09-28T00:00:00.000Z', usageCount: 4 },
  },
  version: '3.0.0',
})

describe('the hook’s scoring, copied', () => {
  it('tokenizes, takes trigrams and compares like intelligence.cjs', () => {
    expect(tokenize('Fix the AUTH token, now!')).toEqual(['fix', 'auth', 'token', 'now'])
    expect([...trigrams(['auth'])].sort()).toEqual(['aut', 'uth'])
    expect(jaccard(new Set(['a', 'b']), new Set(['b', 'c']))).toBeCloseTo(1 / 3)
    expect(jaccard(new Set(), new Set())).toBe(0)
  })

  it('scores 0.6 * match + 0.4 * pageRank, drops what is under 0.05, best first', () => {
    const parsed = parseRanked(RANKED)
    const top = explainPrompt('authentication token refresh', parsed?.entries ?? [])

    expect(top[0]?.entry.id).toBe('mem_a')
    expect(top.map(item => item.entry.id)).not.toContain('mem_c')
    expect(top[0]?.score).toBeCloseTo(0.6 * (top[0]?.match ?? 0) + 0.4 * 0.04, 10)
    expect(explainPrompt('the of and', parsed?.entries ?? [])).toEqual([])
  })

  const helper = resolve(__dirname, '../../../.claude/helpers/intelligence.cjs')

  it.skipIf(!existsSync(helper))('gives the scores the real hook prints', () => {
    const root = mkdtempSync(join(tmpdir(), 'recall-'))

    mkdirSync(join(root, '.claude-flow', 'data'), { recursive: true })
    writeFileSync(join(root, '.claude-flow', 'data', 'ranked-context.json'), RANKED)
    process.env.CLAUDE_PROJECT_DIR = root

    try {
      const out: string = createRequire(import.meta.url)(helper).getContext('authentication token refresh login') as string
      const mine = explainPrompt('authentication token refresh login', parseRanked(RANKED)?.entries ?? [])
      const printed = [...out.matchAll(/\* \((\d\.\d\d)\)/g)].map(match => match[1])

      expect(printed).toEqual(mine.map(item => item.score.toFixed(2)))
      expect(printed.length).toBeGreaterThan(0)
    } finally {
      delete process.env.CLAUDE_PROJECT_DIR
    }
  })

  it('ranks entries by the hook’s composite', () => {
    expect(compositeRank({ pageRank: 0.1, confidence: 0.5 })).toBeCloseTo(0.26)
  })
})

describe('parsers read only what is recorded', () => {
  it('keeps ids, never a prompt, from a session file', () => {
    const got = parseSessionRecall('session-1.json', JSON.stringify({ startedAt: '2026-10-05T00:00:00Z', updatedAt: '2026-10-05T01:00:00Z', context: { lastMatchedPatterns: ['mem_a', 7, 'mem_b'] } }))

    expect(got?.ids).toEqual(['mem_a', 'mem_b'])
    expect(got?.updatedAtMs).toBe(Date.parse('2026-10-05T01:00:00Z'))
    expect(parseSessionRecall('x', '{"context":{}}')).toBeNull()
    expect(parseSessionRecall('x', 'not json')).toBeNull()
  })

  it('lists distinct past tasks newest first', () => {
    const out = parsePrompts(JSON.stringify({ outcomes: [{ task: 'a', agent: 'coder', success: true, timestamp: '2026-09-27T10:00:00Z' }, { task: 'b', agent: 'tester', success: false, timestamp: '2026-09-28T10:00:00Z' }, { task: 'a', agent: 'coder', success: true, timestamp: '2026-09-29T10:00:00Z' }, { agent: 'x' }] }))

    expect(out.map(prompt => prompt.task)).toEqual(['a', 'b'])
    expect(out[1]?.ok).toBe(false)
    expect(parsePrompts(null)).toEqual([])
  })

  it('reads the neural store without its embeddings or any field it lacks', () => {
    const rows = parseNeuralStore(MODELS) ?? []

    expect(rows.map(row => [row.id, row.usageCount, row.verdict])).toEqual([['pattern-1-a', 0, 'success'], ['pattern-2-b', 4, 'partial']])
    expect(JSON.stringify(rows)).not.toContain('embedding')
    expect(lifecycleOrder(rows).map(row => row.id)).toEqual(['pattern-2-b', 'pattern-1-a'])
    expect(wouldPrune(rows, 1)).toEqual(['pattern-1-a'])
    expect(parseNeuralStore('{}')).toBeNull()
  })
})

describe('the commands', () => {
  const facts: RecallFacts = { ranked: parseRanked(RANKED), sessions: [], prompts: [], neural: parseNeuralStore(MODELS), log: [], reads: { ranked: 'ok', sessions: 'ok', prompts: 'ok', neural: 'ok', bank: 'too-large', log: 'missing' } }
  const state = newState({ boot: false })

  state.snapshot = { recall: facts } as never

  it('prunes one pattern with fixed argv and says it is for good', () => {
    const spec = pruneSpec(' pattern-1-a ')

    expect(spec?.args).toEqual(['mcp', 'exec', '-t', 'neural_patterns', '-p', JSON.stringify({ action: 'delete', patternId: 'pattern-1-a' })])
    expect(spec?.note).toMatch(/DELETES FOR GOOD/)
    expect(spec?.isReadOnly).toBeUndefined()
    expect(pruneSpec('a b; c')).toBeNull()
    expect(pruneSpec('')).toBeNull()
  })

  it('promotes only a pattern the store holds, as feedback with its own text', () => {
    const spec = promoteSpec(state, 'pattern-1-a')

    expect(spec?.args).toEqual(['mcp', 'exec', '-t', 'agentdb_feedback', '-p', JSON.stringify({ taskId: 'promote-pattern-1-a', success: true, quality: 0.95, patterns: ['paths: hooks-tools.ts:142'] })])
    expect(spec?.note).toMatch(/adds a pattern/)
    expect(promoteSpec(state, 'pattern-unknown')).toBeNull()
  })

  it('prunes the never-used in bulk, with the count it would remove', () => {
    const spec = pruneUnusedSpec(state)

    expect(spec?.label).toBe('prune 1 of 2 patterns used fewer than 1 time')
    expect(spec?.args).toEqual(['mcp', 'exec', '-t', 'neural_compress', '-p', JSON.stringify({ method: 'prune', targetSize: 1 })])
    expect(pruneUnusedSpec(newState({ boot: false }))).toBeNull()
  })

  it('registers its entries under nn- ids so the result panel shows them', () => {
    expect(recallEntries(state).map(item => item.id)).toEqual(['nn-recall-prune', 'nn-recall-promote', 'nn-recall-prune-unused'])
  })
})

type El = { kind: string; props: Record<string, unknown> }
const make = (kind: string) => (props: Record<string, unknown>): El => ({ kind, props })
const kit = { Box: make('Box'), Text: make('Text'), Button: make('Button'), Input: make('Input') }
const flat = (node: unknown): El[] => {
  if (Array.isArray(node)) return node.flatMap(flat)
  if (typeof node !== 'object' || node === null) return []
  const el = node as El
  const children = el.props.children

  return [el, ...(Array.isArray(children) ? children.flatMap(flat) : flat(children))]
}
const words = (nodes: unknown): string => flat(nodes).filter(el => el.kind === 'Text' || el.kind === 'Button').map(el => String(el.props.children ?? el.props.label ?? '')).join('\n')

function ctxOf(recall: RecallFacts | undefined): Ctx {
  const state = newState({ boot: false })

  state.snapshot = (recall === undefined ? {} : { recall }) as never

  return { kit, state, nowMs: 1_791_250_000_000, columns: 140, pictures: new Map(), act: new Proxy({}, { get: () => () => undefined }) as unknown as Ctx['act'] } as unknown as Ctx
}

describe('the rows', () => {
  const facts: RecallFacts = {
    ranked: parseRanked(RANKED),
    sessions: [{ file: 'session-1.json', startedAtMs: 1, updatedAtMs: 1_791_249_000_000, ids: ['mem_a', 'mem_gone'] }],
    prompts: [{ task: 'authentication token refresh', agent: 'coder', ok: true, atMs: 1_791_000_000_000, digest: digestOf('authentication token refresh') }],
    neural: parseNeuralStore(MODELS),
    log: [],
    reads: { ranked: 'ok', sessions: 'ok', prompts: 'ok', neural: 'ok', bank: 'too-large', log: 'missing' },
  }

  it('shows the recorded recall as ids resolved, and says what is not recorded', () => {
    pickPrompt(null)

    const text = words(recallRows(ctxOf(facts)))

    expect(text).toMatch(/neither the prompt nor its scores/)
    expect(text).toMatch(/authentication token refresh for the login service/)
    expect(text).toMatch(/mem_gone.*no longer in the ranked file/)
  })

  it('explains a picked prompt as a recomputation with the formula’s parts', () => {
    pickPrompt('authentication token refresh')

    const text = words(recallRows(ctxOf(facts)))

    pickPrompt(null)
    expect(text).toMatch(/recomputed, not what surfaced then/)
    expect(text).toMatch(/0\.6·match .* \+ 0\.4·pr 0\.040/)
  })

  it('says so when nothing clears the threshold', () => {
    pickPrompt('zzz qqq')

    const text = words(recallRows(ctxOf(facts)))

    pickPrompt(null)
    expect(text).toMatch(/nothing clears the hook’s 0\.05 threshold/)
  })

  it('draws the lifecycle table with uses and verdict, and no rank or last-used column', () => {
    const text = words(lifecycleRows(ctxOf(facts)))

    expect(text).toMatch(/pattern-2-b/)
    expect(text).toMatch(/rank and last-used time are not recorded/)
    expect(text).toMatch(/1 of 2 never used/)
    expect(text).toMatch(/over the 2 MB read cap/)
  })

  it('shows honest empty states, never invented rows', () => {
    expect(words(recallRows(ctxOf(undefined)))).toMatch(/recall probe is not wired/)
    expect(words(lifecycleRows(ctxOf({ ...facts, neural: null, reads: { ...facts.reads, neural: 'missing' } })))).toMatch(/models\.json is missing/)
    expect(words(recallRows(ctxOf({ ...facts, ranked: null, reads: { ...facts.reads, ranked: 'too-large' } })))).toMatch(/is too-large/)
  })
})

describe('the reader', () => {
  it('reads the four files, the newest sessions only, and only stats the bank', async () => {
    const files = new Map<string, string>([
      ['/p/.claude-flow/data/ranked-context.json', RANKED],
      ['/p/.claude-flow/neural/models.json', MODELS],
      ['/p/.claude-flow/routing-outcomes.json', JSON.stringify({ outcomes: [{ task: 't', agent: 'coder', success: true, timestamp: '2026-09-27T10:00:00Z' }] })],
      ['/p/.claude-flow/sessions/session-1.json', JSON.stringify({ updatedAt: '2026-10-01T00:00:00Z', context: { lastMatchedPatterns: ['mem_a'] } })],
      ['/p/.claude-flow/sessions/session-2.json', JSON.stringify({ updatedAt: '2026-10-02T00:00:00Z', context: { lastMatchedPatterns: ['mem_b'] } })],
    ])
    const reads: string[] = []
    const fs = {
      read: async (path: string) => {
        reads.push(path)

        const text = files.get(path)

        if (text === undefined) throw new Error('missing')

        return text
      },
      stat: async (path: string) => (path.endsWith('patterns.json') ? { mtimeMs: 1, size: 3_919_854, kind: 'file' } : files.has(path) ? { mtimeMs: 1, size: files.get(path)?.length ?? 0, kind: 'file' } : undefined),
      list: async () => [{ name: 'session-1.json', kind: 'file', mtimeMs: 1 }, { name: 'session-2.json', kind: 'file', mtimeMs: 2 }, { name: 'current.json', kind: 'file', mtimeMs: 3 }],
    }
    const got = await readRecall(fs as never, new Map(), '/p')

    expect(got.ranked?.entries).toHaveLength(3)
    expect(got.sessions.map(session => session.ids[0])).toEqual(['mem_b', 'mem_a'])
    expect(got.prompts[0]?.task).toBe('t')
    expect(got.neural).toHaveLength(2)
    expect(got.reads).toMatchObject({ ranked: 'ok', neural: 'ok', bank: 'too-large' })
    expect(reads.some(path => path.endsWith('patterns.json') || path.endsWith('current.json'))).toBe(false)
  })

  it('never rejects when every file is missing', async () => {
    const fs = { read: async () => { throw new Error('x') }, stat: async () => { throw new Error('x') }, list: async () => { throw new Error('x') } }
    const got = await readRecall(fs as never, new Map(), '/none')

    expect(got).toMatchObject({ ranked: null, sessions: [], prompts: [], neural: null, reads: { ranked: 'missing', bank: 'missing' } })
  })
})

describe('wired into the console', () => {
  const fsOf = (files: Record<string, string>) => ({
    read: async (path: string) => files[path] ?? Promise.reject(new Error('ENOENT')),
    stat: async (path: string) => (files[path] !== undefined ? { mtimeMs: 1, size: files[path]?.length ?? 0, kind: 'file' } : Promise.reject(new Error('ENOENT'))),
    list: async () => Promise.reject(new Error('ENOENT')),
  })

  it('puts the recall facts in the snapshot and its ids in the palette, every mutation asking first', async () => {
    const state = newState({ boot: false })

    state.snapshot = await readSnapshot(fsOf({ '/w/.claude-flow/data/ranked-context.json': RANKED, '/w/.claude-flow/neural/models.json': MODELS }), new Map(), '/w', '/h', {}, 0)

    expect(state.snapshot.recall?.ranked?.entries).toHaveLength(3)
    expect(state.snapshot.recall?.neural).toHaveLength(2)

    const entries = paletteEntries(state, 0)
    const byId = (id: string) => entries.find(candidate => candidate.id === id)

    for (const id of ['nn-recall-prune', 'nn-recall-promote', 'nn-recall-prune-unused']) expect(byId(id), id).toBeDefined()

    const prune = byId('nn-recall-prune')?.run
    const bulk = byId('nn-recall-prune-unused')?.run
    const promote = byId('nn-recall-promote')?.run

    expect(prune?.kind === 'text' ? prune.make('pattern-1-a')?.isReadOnly : 'x').not.toBe(true)
    expect(promote?.kind === 'text' ? promote.make('pattern-2-b')?.isReadOnly : 'x').not.toBe(true)
    expect(bulk?.kind === 'spec' ? bulk.spec?.isReadOnly : 'x').not.toBe(true)
  })

  it('says it is not wired only when the probe is absent', async () => {
    const state = newState({ boot: false })

    state.snapshot = await readSnapshot(fsOf({}), new Map(), '/w', '/h', {}, 0)
    expect(state.snapshot.recall?.reads).toMatchObject({ ranked: 'missing', neural: 'missing' })
  })
})

describe('what the scoring and the table promise', () => {
  const many = ranked(Array.from({ length: 9 }, (_, index) => entry(`m${index}`, 'authentication token refresh login service', 0.02 + index / 1000)))

  it('surfaces at most five, as the hook does', () => {
    expect(explainPrompt('authentication token refresh login service', parseRanked(many)?.entries ?? [])).toHaveLength(5)
  })

  it('drops an entry that scores under 0.05 and keeps one that reaches it', () => {
    const low = parseRanked(ranked([{ ...entry('lo', 'zzz', 0.0499 / 0.4), words: [] }, { ...entry('hi', 'zzz', 0.05 / 0.4), words: [] }]))?.entries ?? []

    expect(explainPrompt('authentication', [{ ...low[0], pageRank: 0.1249 } as never, { ...low[1], pageRank: 0.125 } as never]).map(item => item.entry.id)).toEqual(['hi'])
  })

  it('prunes strictly below the threshold, never at it', () => {
    const rows = parseNeuralStore(MODELS) ?? []

    expect(wouldPrune(rows, 4)).toEqual(['pattern-1-a'])
    expect(wouldPrune(rows, 5)).toEqual(['pattern-1-a', 'pattern-2-b'])
  })

  it('masks a credential-shaped word in a task or summary and never draws a missing confidence as a number', () => {
    const key = `sk-${'a1'.repeat(20)}`
    const [past] = parsePrompts(JSON.stringify({ outcomes: [{ task: `deploy with ${key} now`, agent: 'coder', success: true, timestamp: '2026-09-27T10:00:00Z' }] }))
    const [bare] = parseRanked(JSON.stringify({ entries: [{ id: 'x', summary: `use ${key}`, pageRank: 0.1, words: [] }] }))?.entries ?? []

    expect(past?.task).toBe('deploy with •••• now')
    expect(bare?.summary).toBe('use ••••')
    expect(bare?.confidence).toBeNull()
    pickPrompt(`explain ${key}`)

    const facts: RecallFacts = { ranked: { computedAtMs: 1, entries: bare === undefined ? [] : [bare] }, sessions: [{ file: 's', startedAtMs: 1, updatedAtMs: 1, ids: ['x'] }], prompts: [], neural: null, log: [], reads: { ranked: 'ok', sessions: 'ok', prompts: 'ok', neural: 'missing', bank: 'missing', log: 'missing' } }
    const text = words(recallRows(ctxOf(facts)))

    pickPrompt(null)
    expect(text).toMatch(/conf n\/a/)
    expect(text).not.toContain(key)
  })

  it('fits the lifecycle table in 80, 120 and 160 columns, and shows only SHOWN rows with the rest counted', () => {
    const patterns = Object.fromEntries(Array.from({ length: 15 }, (_, index) => [`pattern-1791244689589-${index}-abcdefg`, { id: `pattern-1791244689589-${index}-abcdefg`, name: 'fix: wire recordTrajectory into the hooks tools handler for everything', type: 'history-commit', content: 'c', metadata: { verdict: 'success' }, createdAt: '2026-09-27T17:34:15.801Z', usageCount: index }]))
    const facts: RecallFacts = { ranked: null, sessions: [], prompts: [], neural: parseNeuralStore(JSON.stringify({ patterns })), log: [], reads: { ranked: 'missing', sessions: 'ok', prompts: 'missing', neural: 'ok', bank: 'ok', log: 'missing' } }

    for (const columns of [80, 120, 160]) {
      const ctx = { ...ctxOf(facts), columns } as Ctx
      const rows = lifecycleRows(ctx)
      const lines = rows.map(rowEl => flat(rowEl).filter(el => el.kind === 'Text' || el.kind === 'Button').map(el => String(el.props.children ?? el.props.label ?? '')).join(''))

      for (const line of lines) expect(line.length, `${columns}: ${line}`).toBeLessThanOrEqual(columns)
      expect(lines.some(line => /\+ 3 more in the file/.test(line))).toBe(true)
      expect(lines.filter(line => /pattern-1791/.test(line))).toHaveLength(12)
    }
  })
})
