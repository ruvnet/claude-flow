/** The Learning page's Router block says why it is empty, flags a stale history, and flags a stale history. */
import { describe, expect, it } from 'vitest'

import { newState } from '../hooks/state'
import type { Ctx } from '../hooks/views/common'
import { learningView } from '../hooks/views/learning'

type El = { kind: string; props: Record<string, unknown> }
const make = (kind: string) => (props: Record<string, unknown>): El => ({ kind, props })
const kit = { Box: make('Box'), Text: make('Text'), Button: make('Button'), Input: make('Input') }
const act = new Proxy({}, { get: () => () => undefined }) as unknown as Ctx['act']
const flat = (node: unknown): El[] => {
  if (Array.isArray(node)) return node.flatMap(flat)
  if (typeof node !== 'object' || node === null) return []
  const el = node as El
  const children = el.props.children

  return [el, ...(Array.isArray(children) ? children.flatMap(flat) : flat(children))]
}
const NOW = 10 * 86_400_000
const points = (n: number, atMs: number, failAt = -1) => Array.from({ length: n }, (_, i) => ({ ok: i !== failAt, atMs: atMs + i }))

function lines(opts: { owned: readonly string[] | null; n: number; lastMs: number; failAt?: number }): string {
  const state = newState({ boot: false })

  state.snapshot = { outcomes: { total: opts.n, successes: opts.failAt === undefined || opts.failAt < 0 ? opts.n : opts.n - 1, points: points(opts.n, opts.lastMs - opts.n, opts.failAt) }, router: null, neural: null, sona: null } as never
  state.ruflo = { ...state.ruflo, snapshot: opts.owned === null ? null : ({ owned: opts.owned } as never), route: null } as never

  return flat(learningView({ kit, state, act, columns: 130, nowMs: NOW, pictures: new Map() } as unknown as Ctx))
    .filter(el => el.kind === 'Text')
    .map(el => String(el.props.children))
    .join('\n')
}

describe('the Router block', () => {
  it('says why there is no live pick when the classic hook owns routing here', () => {
    const text = lines({ owned: [], n: 9, lastMs: NOW - 8 * 86_400_000 })

    expect(text).toContain('the classic hook-handler owns routing')
    expect(text).toContain('ruflo-mods stands down and records no picks')
    expect(text).not.toContain('no prompt routed yet this session')
  })

  it('keeps the old wording where the mod does own routing, and when the mod is not seated', () => {
    expect(lines({ owned: ['route'], n: 9, lastMs: NOW })).toContain('no prompt routed yet this session')
    expect(lines({ owned: null, n: 9, lastMs: NOW })).toContain('ruflo-mods not seated')
  })

  it('flags an outcome history nothing has been added to for a day', () => {
    expect(lines({ owned: [], n: 9, lastMs: NOW - 8 * 86_400_000 })).toMatch(/last 8d ago · nothing recorded since/)
    expect(lines({ owned: [], n: 9, lastMs: NOW - 3_600_000 })).not.toContain('nothing recorded since')
  })
})
