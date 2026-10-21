/**
 * The hook's recall log in the console (ADR-472): the reader, the digest parity with the real helper, the recorded-recall rows, and
 * the lifecycle's surfaced counts. Run with
 *   npx vitest run plugins/ruflo-console/tests/recall-log.spec.ts
 */
import { execFileSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'

import { describe, expect, it } from 'vitest'

import { digestOf, logWindowMs, parseNeuralStore, parsePrompts, parseRanked, parseRecallLog, readRecall, surfacedCounts, tokenize, type RecallFacts } from '../hooks/data/recall'
import { newState } from '../hooks/state'
import type { Ctx } from '../hooks/views/common'
import { lifecycleRows, pickLogged, pickPrompt, recallRows } from '../hooks/views/recall-rows'

const NOW = 1_791_250_000_000
const HOUR = 3_600_000
const line = (at: number, digest: string, surfaced: { id: string; score: number; rank: number; cat?: string }[], router?: { agent: string; confidence: number }) => JSON.stringify({ v: 1, at, sid: 's1', digest, surfaced: surfaced.map(item => ({ ...item, cat: item.cat ?? 'auto-memory' })), ...(router !== undefined && { router }) })
const entry = (id: string, summary: string, pageRank: number) => ({ id, summary, content: summary, category: 'auto-memory', confidence: 0.5, pageRank, accessCount: 0, words: tokenize(summary) })
const RANKED = JSON.stringify({ computedAt: 1, entries: [entry('mem_a', 'authentication token refresh for the login service', 0.04), entry('mem_b', 'deploy the cloud run gateway', 0.02)] })
const MODELS = JSON.stringify({ patterns: { 'pattern-1': { id: 'pattern-1', name: 'p1', type: 't', content: 'c', createdAt: '2026-09-27T00:00:00Z', usageCount: 0 }, mem_a: { id: 'mem_a', name: 'joined', type: 't', content: 'c2', createdAt: '2026-09-27T00:00:00Z', usageCount: 1 } } })
const PROMPT = 'please explain the authentication token refresh flow'
const LOG = [
  line(NOW - 5 * HOUR, 'aaaaaaaaaaaaaaaa', [{ id: 'mem_b', score: 0.21, rank: 1 }]),
  line(NOW - 2 * HOUR, digestOf(PROMPT), [{ id: 'mem_a', score: 0.4321, rank: 1 }, { id: 'mem_gone', score: 0.1234, rank: 2 }], { agent: 'coder', confidence: 0.9 }),
  'not json',
  JSON.stringify({ at: NOW, digest: 'zz', surfaced: [] }),
  JSON.stringify({ at: NOW, digest: 'bbbbbbbbbbbbbbbb', surfaced: [{ id: 'x', score: 'high', rank: 1 }] }),
].join('\n')

describe('the digest', () => {
  it('is the helper’s: sha256 of the trimmed prompt, 16 hex characters, in plain TypeScript', () => {
    for (const prompt of ['hello', '  padded  ', 'unicode ✓ ünï', PROMPT]) {
      expect(digestOf(prompt)).toBe(createHash('sha256').update(prompt.trim()).digest('hex').slice(0, 16))
    }
  })

  it('matches a record the real helper wrote for the same prompt', () => {
    const root = mkdtempSync(join(tmpdir(), 'ruflo-console-472-'))

    try {
      mkdirSync(join(root, '.claude-flow', 'data'), { recursive: true })
      writeFileSync(join(root, '.claude-flow', 'data', 'ranked-context.json'), JSON.stringify({ entries: [{ id: 'mem_a', summary: 'authentication token refresh', category: 'auto-memory', confidence: 0.5, pageRank: 0.04, words: ['authentication', 'token', 'refresh'] }] }))
      const helper = resolve(__dirname, '../../../.claude/helpers/intelligence.cjs')

      execFileSync(process.execPath, ['-e', `const i=require(${JSON.stringify(helper)});i.appendRecall(i.getContextDetailed(${JSON.stringify(PROMPT)}),{sessionId:'s9'})`], { cwd: root, env: { ...process.env, CLAUDE_PROJECT_DIR: root, RUFLO_RECALL_LOG: '' } })

      const [record] = parseRecallLog(readFileSync(join(root, '.claude-flow', 'data', 'recall-log.jsonl'), 'utf8'))

      expect(record?.digest).toBe(digestOf(PROMPT))
      expect(record?.surfaced[0]).toMatchObject({ id: 'mem_a', rank: 1 })
      expect(record?.sessionId).toBe('s9')
    } finally {
      rmSync(root, { recursive: true, force: true })
    }
  })
})

describe('the reader', () => {
  it('keeps valid records newest first and skips the rest', () => {
    const log = parseRecallLog(LOG)

    expect(log.map(record => record.digest)).toEqual([digestOf(PROMPT), 'aaaaaaaaaaaaaaaa'])
    expect(log[0]).toMatchObject({ sessionId: 's1', router: { agent: 'coder', confidence: 0.9 } })
    expect(log[0]?.surfaced.map(item => [item.id, item.score, item.rank])).toEqual([['mem_a', 0.4321, 1], ['mem_gone', 0.1234, 2]])
    expect(parseRecallLog(null)).toEqual([])
    expect(parseRecallLog('')).toEqual([])
  })

  it('counts what was surfaced and how far back the log reaches', () => {
    const log = parseRecallLog(`${LOG}\n${line(NOW - HOUR, 'cccccccccccccccc', [{ id: 'mem_a', score: 0.3, rank: 1 }])}`)
    const counts = surfacedCounts(log)

    expect(counts.get('mem_a')).toMatchObject({ count: 2, lastAtMs: NOW - HOUR })
    expect(counts.get('mem_b')?.count).toBe(1)
    expect(logWindowMs(log, NOW)).toBe(5 * HOUR)
    expect(logWindowMs([], NOW)).toBe(0)
  })

  it('reads the log as a regular file through the bounded reader, and a missing or too-large log is a status, not an error', async () => {
    const files = new Map([['/p/.claude-flow/data/ranked-context.json', RANKED], ['/p/.claude-flow/data/recall-log.jsonl', LOG]])
    const fs = {
      read: async (path: string) => files.get(path) ?? Promise.reject(new Error('ENOENT')),
      stat: async (path: string) => (files.has(path) ? { mtimeMs: 1, size: files.get(path)?.length ?? 0, kind: 'file' } : Promise.reject(new Error('ENOENT'))),
      list: async () => Promise.reject(new Error('ENOENT')),
    }
    const got = await readRecall(fs as never, new Map(), '/p')

    expect(got.log).toHaveLength(2)
    expect(got.reads.log).toBe('ok')

    const none = await readRecall({ ...fs, read: async () => Promise.reject(new Error('x')), stat: async () => Promise.reject(new Error('x')) } as never, new Map(), '/none')

    expect(none.log).toEqual([])
    expect(none.reads.log).toBe('missing')

    const big = await readRecall({ ...fs, stat: async (path: string) => ({ mtimeMs: 1, size: path.endsWith('recall-log.jsonl') ? 3_000_000 : 10, kind: 'file' }) } as never, new Map(), '/p')

    expect(big.reads.log).toBe('too-large')
    expect(big.log).toEqual([])
  })

  it('gives each router task the digest the hook would give that prompt', () => {
    const [task] = parsePrompts(JSON.stringify({ outcomes: [{ task: PROMPT, agent: 'coder', success: true, timestamp: new Date(NOW).toISOString() }] }))

    expect(task?.digest).toBe(digestOf(PROMPT))
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
const factsOf = (log: string | null): RecallFacts => ({ ranked: parseRanked(RANKED), sessions: [], prompts: [{ task: PROMPT, agent: 'coder', ok: true, atMs: NOW - 2 * HOUR, digest: digestOf(PROMPT) }], neural: parseNeuralStore(MODELS), log: parseRecallLog(log), reads: { ranked: 'ok', sessions: 'ok', prompts: 'ok', neural: 'ok', bank: 'ok', log: log === null ? 'missing' : 'ok' } })
const ctxOf = (facts: RecallFacts): Ctx => {
  const state = newState({ boot: false })

  state.snapshot = { recall: facts } as never

  return { kit, state, nowMs: NOW, columns: 140, pictures: new Map(), act: new Proxy({}, { get: () => () => undefined }) as unknown as Ctx['act'] } as unknown as Ctx
}

describe('the recorded recalls in the Learning Lab', () => {
  it('lists the records and shows the newest one’s surfaced ids with the hook’s own scores, no recomputation label', () => {
    pickPrompt(null)
    pickLogged(null)

    const shown = words(recallRows(ctxOf(factsOf(LOG))))

    expect(shown).toContain('recorded recalls: 2 in recall-log.jsonl')
    expect(shown).toContain('The prompt text is not kept')
    expect(shown).toContain('0.432')
    expect(shown).toContain('authentication token refresh for the login service')
    expect(shown).toContain('mem_gone (no longer in the ranked file)')
    expect(shown).toContain('router coder')
    expect(shown).toContain('"please explain the authentication')
    expect(shown).not.toContain('recomputed, not what surfaced then')
    expect(shown).toContain('most surfaced')
  })

  it('picking another record shows that one', () => {
    pickPrompt(null)
    pickLogged(parseRecallLog(LOG)[1] ?? null)

    const shown = words(recallRows(ctxOf(factsOf(LOG))))

    expect(shown).toContain('0.210')
    expect(shown).not.toContain('0.432')
    pickLogged(null)
  })

  it('shows a prompt whose digest was recorded as recorded, and any other as recomputed with its label', () => {
    pickPrompt(PROMPT)
    const recorded = words(recallRows(ctxOf(factsOf(LOG))))

    expect(recorded).toContain('what the hook surfaced then, with its scores; not recomputed')
    expect(recorded).toContain('0.432')

    pickPrompt('deploy the cloud run gateway now')

    const recomputed = words(recallRows(ctxOf(factsOf(LOG))))

    expect(recomputed).toContain('no recorded recall has this prompt’s digest: recomputed against today’s ranked file, not what surfaced then')
    pickPrompt(null)
  })

  it('without a log keeps the old honest note and the labelled recomputation', () => {
    pickPrompt('authentication token refresh')

    const shown = words(recallRows(ctxOf(factsOf(null))))

    expect(shown).toContain('No recall log')
    expect(shown).toContain('RUFLO_RECALL_LOG=0')
    expect(shown).toContain('recomputed, not what surfaced then')
    expect(shown).not.toContain('recorded recalls:')
    pickPrompt(null)
  })

  it('the lifecycle shows real surfaced counts and says how few rows join the log', () => {
    const shown = words(lifecycleRows(ctxOf(factsOf(LOG))))

    expect(shown).toContain('seen')
    expect(shown).toContain('1 of 2 rows appear in the recall log')
    expect(shown).toContain('ranked-context.json, not models.json')
    expect(words(lifecycleRows(ctxOf(factsOf(null))))).not.toContain('rows appear in the recall log')
  })
})
