/** The result frame and the outcome card: a border in the outcome's colour, a header that says how it went, the body as it was. */
import { describe, expect, it } from 'vitest'

import { newState } from '../hooks/state'
import { THEME, type Ctx } from '../hooks/views/common'
import { secureResult } from '../hooks/views/secure'
import { frameResult, outcomeCard, statusCard } from '../hooks/views/status-card'

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
const ctxOf = (state = newState({ boot: false })): Ctx => ({ kit, state, act, columns: 100, nowMs: 10_000, pictures: new Map() }) as unknown as Ctx
const textsOf = (node: unknown): string[] => flat(node).filter(el => el.kind === 'Text').map(el => String(el.props.children))

describe('frameResult', () => {
  it('is a round border coloured by the outcome: ok, failed, running, nothing run', () => {
    const ctx = ctxOf()
    const color = (tone: 'ok' | 'bad' | 'run' | 'idle') => (frameResult(ctx, [], tone) as unknown as El).props.borderColor

    expect(color('ok')).toBe(THEME.ok)
    expect(color('bad')).toBe(THEME.bad)
    expect(color('run')).toBe(THEME.warn)
    expect(color('idle')).toBe('inactive')
    expect((frameResult(ctx, [], 'ok') as unknown as El).props).toMatchObject({ key: 'result-frame', borderStyle: 'round' })
  })
})

describe('the Security result panel', () => {
  it('is drawn inside the frame, green when the run passed and red when it failed, with its lines unchanged', () => {
    const state = newState({ boot: false })

    state.lab.result = { id: 'sec-scan-quick', label: 'security scan, quick', ok: true, exitCode: 0, lines: ['CLEAN · 0 findings', '┌─┐'], atMs: 9_000 }
    const ok = secureResult(ctxOf(state))[0] as unknown as El

    expect(ok.props).toMatchObject({ key: 'result-frame', borderColor: THEME.ok })
    expect(textsOf(ok).join('\n')).toContain('CLEAN · 0 findings')

    state.lab.result = { ...state.lab.result, ok: false, exitCode: 1 }
    expect((secureResult(ctxOf(state))[0] as unknown as El).props.borderColor).toBe(THEME.bad)
  })

  it('shows an idle frame with a hint before anything has run', () => {
    const card = secureResult(ctxOf())[0] as unknown as El

    expect(card.props).toMatchObject({ key: 'result-frame', borderColor: 'inactive' })
    expect(textsOf(card).join(' ')).toContain('nothing run yet')
  })
})

describe('statusCard and outcomeCard', () => {
  it('put the mark, title and age in the header, then the body wrapped, then the next step', () => {
    const ctx = ctxOf()
    const card = outcomeCard(ctx, 'k', { ok: false, label: 'Claude did not take it', detail: 'unknown command', atMs: 4_000, next: 'try again' })

    expect(card).toMatchObject({ props: { key: 'k', borderStyle: 'round', borderColor: THEME.bad } })
    expect(textsOf(card)).toEqual(['✗ Claude did not take it', '  6s ago', 'unknown command', '→ try again'])
    expect(flat(card).filter(el => el.kind === 'Text' && el.props.wrap === 'wrap')).toHaveLength(2)
    expect(textsOf(statusCard(ctx, 'k', 'ok', 'done', '', []))).toEqual(['✓ done'])
  })
})
