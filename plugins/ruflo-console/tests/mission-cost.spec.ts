import { spawnSync } from 'node:child_process'
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'

import { describe, expect, it } from 'vitest'

import { capState, capUsd, missionCostArgv, parseMissionCost, shouldPause } from '../hooks/data/mission-cost'
import { newState } from '../hooks/state'
import { missionCostRows } from '../hooks/views/mission-cost'
import type { Ctx } from '../hooks/views/common'

const ROOT = '/p/ruflo-cost-tracker/0.28.0'
const FROM = Date.parse('2026-10-02T00:00:00Z')
const TO = Date.parse('2026-10-03T00:00:00Z')

const LEDGER = (extra: Record<string, unknown> = {}): string => JSON.stringify({ since: 'window', priceDate: '2026-10-03', rows: 4, totals: { usd: 12.5, credits: 300 }, byProvider: {}, unpriced: {}, window: { from: null, to: null, project: '/p' }, ...extra })

describe('missionCostArgv', () => {
  it('builds the fixed ledger command with an ISO window and the project', () => {
    expect(missionCostArgv(ROOT, FROM, TO, '/home/u/proj')).toEqual(['node', `${ROOT}/scripts/ledger.mjs`, '--format', 'json', '--from', '2026-10-02T00:00:00.000Z', '--to', '2026-10-03T00:00:00.000Z', '--project', '/home/u/proj'])
  })

  it('leaves the window open on the right while the mission runs', () => {
    const argv = missionCostArgv(ROOT, FROM, null, '/home/u/proj')

    expect(argv).not.toContain('--to')
    expect(argv).toContain('--from')
  })

  it('is null for a hostile plugin root, a relative or traversing project, control characters, or a bad window', () => {
    for (const root of ['relative', '/a/../b', '/x; rm -rf', '']) expect(missionCostArgv(root, FROM, TO, '/p')).toBeNull()
    for (const project of ['proj', '', '/a/../etc', '/a\nb', '/a\u0000b', '/a\u001b[31m', `/${'a'.repeat(600)}`]) expect(missionCostArgv(ROOT, FROM, TO, project)).toBeNull()
    expect(missionCostArgv(ROOT, Number.NaN, TO, '/p')).toBeNull()
    expect(missionCostArgv(ROOT, FROM, Number.POSITIVE_INFINITY, '/p')).toBeNull()
    expect(missionCostArgv(ROOT, TO, FROM, '/p')).toBeNull()
  })
})

describe('parseMissionCost window',()=>{
  it('reads which window the ledger answered for, so a reading is never shown for another mission', () => {
    const out = JSON.stringify({ totals: { usd: 1 }, rows: 1, window: { from: '2026-10-04T00:00:00.000Z', to: null, project: '/p' } })

    expect(parseMissionCost(out)?.fromMs).toBe(Date.parse('2026-10-04T00:00:00.000Z'))
    expect(parseMissionCost(JSON.stringify({ totals: { usd: 1 }, window: { from: 'not a date' } }))?.fromMs).toBeNull()
  })
})

describe('parseMissionCost', () => {
  it('keeps USD and credits apart and lists unpriced models', () => {
    expect(parseMissionCost(LEDGER({ unpriced: { 'gpt-5.6-sol': { messages: 3 } } }))).toEqual({ usd: 12.5, credits: 300, unpriced: ['gpt-5.6-sol'], rows: 4, fromMs: null })
  })

  it('treats a window with no rows as a real zero, but all-unpriced rows as unknown', () => {
    expect(parseMissionCost(LEDGER({ rows: 0, totals: {} }))).toMatchObject({ usd: 0, credits: null, rows: 0 })
    expect(parseMissionCost(LEDGER({ rows: 2, totals: {}, unpriced: { 'mystery-9': {} } }))).toMatchObject({ usd: null, unpriced: ['mystery-9'] })
  })

  it('is null for anything that is not the ledger, and strips control text from model names', () => {
    for (const bad of ['', 'nope', '{"a":1}', '[]', '{"totals":1}']) expect(parseMissionCost(bad)).toBeNull()
    expect(parseMissionCost(LEDGER({ unpriced: { 'm\u001b[31mx\nmodel': {} } }))?.unpriced[0]).toBe('mx model')
  })

  it('ignores negative or non-numeric totals', () => {
    expect(parseMissionCost(LEDGER({ totals: { usd: -4, credits: 'x' } }))).toMatchObject({ usd: null, credits: null })
  })
})

describe('capState and shouldPause', () => {
  it('follows the 50/75/90/100 ladder', () => {
    const at = (spend: number) => capState(spend, 10).level

    expect([at(0), at(4.99), at(5), at(7.49), at(7.5), at(8.99), at(9), at(9.99), at(10), at(25)]).toEqual(['OK', 'OK', 'INFO', 'INFO', 'WARNING', 'WARNING', 'CRITICAL', 'CRITICAL', 'HARD_STOP', 'HARD_STOP'])
    expect(capState(2.5, 10).percent).toBe(25)
    expect(capState(25, 10).percent).toBe(250)
  })

  it('is none without a spend or a usable cap', () => {
    for (const [spend, cap] of [[null, 10], [3, null], [null, null], [3, 0], [3, -1], [Number.NaN, 10], [-1, 10], [3, Number.POSITIVE_INFINITY]] as const) expect(capState(spend, cap)).toEqual({ level: 'none', percent: null })
  })

  it('pauses only at the hard stop with auto-run on', () => {
    expect(shouldPause(capState(10, 10), true)).toBe(true)
    expect(shouldPause(capState(10, 10), false)).toBe(false)
    expect(shouldPause(capState(9.5, 10), true)).toBe(false)
    expect(shouldPause(capState(null, 10), true)).toBe(false)
    expect(shouldPause(capState(10, null), true)).toBe(false)
  })
})

describe('capUsd', () => {
  it('accepts 0.01 to 10000 as plain decimals and nothing else', () => {
    expect([capUsd('0.01'), capUsd(' 25 '), capUsd('.5'), capUsd('10000')]).toEqual([0.01, 25, 0.5, 10_000])
    for (const bad of ['', '0', '0.009', '10000.01', '-5', '1e3', '$5', '5usd', '0x10', 'NaN', 'Infinity', '1,5']) expect(capUsd(bad)).toBeNull()
  })
})

type Node = { type: string; props: { children?: unknown } }
const kit = (): Ctx['kit'] => {
  const element = (type: string) => (props: Record<string, unknown>) => ({ type, props }) as never

  return { Box: element('Box'), Text: element('Text'), Button: element('Button') }
}
const flat = (node: unknown): string => {
  if (typeof node === 'string' || typeof node === 'number') return String(node)
  if (node === null || node === undefined || typeof node === 'boolean') return ''
  if (Array.isArray(node)) return node.map(flat).join('')

  return flat((node as Node).props.children)
}
const shown = (cost: ReturnType<typeof parseMissionCost>, cap: number | null, note = 'ledger: cost-tracker plugin'): string[] => missionCostRows({ kit: kit(), state: newState({}), nowMs: 5, columns: 110, pictures: new Map(), act: {} } as unknown as Ctx, cost, cap, note).map(flat)

describe('missionCostRows', () => {
  it('shows spend, cap and the ladder, and says it is an estimate', () => {
    const lines = shown({ usd: 8, credits: null, unpriced: [], rows: 3, fromMs: null }, 10)
    const all = lines.join('\n')

    expect(all).toContain('Mission spend')
    expect(all).toContain('$8.00')
    expect(all).toContain('$10.00')
    expect(all).toContain('WARNING')
    expect(all).toContain('80%')
    expect(all).toContain('list-price')
    expect(all).toMatch(/not a bill/)
  })

  it('is n/a when the ledger did not answer, and never draws a bar', () => {
    const all = shown(null, 10).join('\n')

    expect(all).toMatch(/spend\s*n\/a/)
    expect(all).not.toContain('WARNING')
    expect(all).not.toContain('█')
  })

  it('shows no bar without a cap, lists unpriced models and keeps credits separate', () => {
    const all = shown({ usd: 1, credits: 40, unpriced: ['mystery-9'], rows: 2, fromMs: null }, null).join('\n')

    expect(all).toMatch(/cap\s*none set/)
    expect(all).toContain('mystery-9')
    expect(all).toContain('40 credits')
    expect(all).not.toContain('█')
  })

  it('keeps every note and disclaimer under 50 characters, even for a long source note or model list', () => {
    const lines = shown({ usd: 1, credits: null, unpriced: ['m'.repeat(50), 'n'.repeat(50)], rows: 1, fromMs: null }, null, 'x'.repeat(200))
    const notes = lines.filter(line => /^ (?!Marks)/.test(line) && !line.includes('Mission spend'))

    expect(notes.length).toBeGreaterThan(2)
    for (const line of notes) expect(line.length, line).toBeLessThan(50)
  })
})

describe('the ledger filters, through the real script', () => {
  const win = mkdtempSync(join(tmpdir(), 'mission-cost-'))
  const logs = join(win, 'claude', 'projects', 'q')

  mkdirSync(logs, { recursive: true })
  mkdirSync(join(win, 'codex'), { recursive: true })

  const at = (iso: string, id: string, cwd: string) => ({ type: 'assistant', sessionId: `s-${id}`, cwd, requestId: `r-${id}`, timestamp: iso, message: { id, role: 'assistant', model: 'claude-opus-5-5', usage: { input_tokens: 1_000_000, output_tokens: 0 } } })

  writeFileSync(join(logs, 'w.jsonl'), [
    at('2026-10-01T00:00:00.000Z', 'before', '/proj/a'),
    at('2026-10-02T06:00:00.000Z', 'in-a', '/proj/a'),
    at('2026-10-02T07:00:00.000Z', 'in-sub', '/proj/a/sub'),
    at('2026-10-02T08:00:00.000Z', 'sibling', '/proj/ab'),
    at('2026-10-02T09:00:00.000Z', 'in-b', '/proj/b'),
    at('2026-10-04T00:00:00.000Z', 'after', '/proj/a'),
  ].map(item => JSON.stringify(item)).join('\n') + '\n')

  const ledgerRoot = resolve(__dirname, '../../ruflo-cost-tracker')
  const run = (project: string, toMs: number | null) => {
    const argv = missionCostArgv(ledgerRoot, FROM, toMs, project)

    if (argv === null) return null

    const out = spawnSync(process.execPath, argv.slice(1), { encoding: 'utf-8', env: { PATH: process.env.PATH ?? '', CLAUDE_CONFIG_DIR: join(win, 'claude'), CODEX_HOME: join(win, 'codex') } })

    return { status: out.status, cost: parseMissionCost(out.stdout) }
  }

  it('counts only the project and its subdirectories inside the window', () => {
    const result = run('/proj/a', TO)

    expect(result?.status).toBe(0)
    expect(result?.cost?.rows).toBe(2) // in-a and in-sub; not before, not /proj/ab, not /proj/b
    expect(result?.cost?.usd).toBeGreaterThan(0)
  })

  it('leaves the window open when the mission has not ended, and a different project gets its own spend', () => {
    expect(run('/proj/a', null)?.cost?.rows).toBe(3) // adds the row after the old end
    expect(run('/proj/b', TO)?.cost?.rows).toBe(1)
    expect(run('/proj/none', TO)?.cost).toMatchObject({ rows: 0, usd: 0 })
  })
})
