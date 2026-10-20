/** Notices: what the band announces, how long, how to silence it; the commands that drive it; the band's tone, notice row and compact mode. */
import { describe, expect, it } from 'vitest'

import { parseRuflo } from '../hooks/commands'
import { addNotice, agentName, bandReply, DEDUPE_MS, dismissNotices, MAX_NOTICES, noticesBetween, noticesReply, quietReply, SHOW_MS, visibleNotice, type Facts } from '../hooks/notices'
import { newState } from '../hooks/state'
import { bandTone, barView, PANEL, type BarPart } from '../hooks/views/bar'

const NOW = 1_000_000
const facts = (over: Partial<Facts> = {}): Facts => ({ approvals: 0, alerts: 0, mission: null, anatole: null, ...over })
const anatole = (over: Partial<NonNullable<Facts['anatole']>> = {}) => ({ blocked: 0, critical: 0, degraded: null, ...over })

describe('what is announced', () => {
  it('says nothing when nothing changed, or when counts went down', () => {
    expect(noticesBetween(facts(), facts())).toEqual([])
    expect(noticesBetween(facts({ approvals: 3, alerts: 2 }), facts({ approvals: 1, alerts: 0 }))).toEqual([])
  })

  it('announces new approvals and alerts with how many, linked to where they are', () => {
    expect(noticesBetween(facts(), facts({ approvals: 2, alerts: 1 }))).toEqual([
      { level: 'warn', text: '2 new approvals waiting (q)', key: 'approvals', go: 'approvals' },
      { level: 'warn', text: '1 new alert', key: 'alerts', go: 'overview' },
    ])
  })

  it('announces a mission finishing once, only for the same mission and only when it was not already done', () => {
    const running = facts({ mission: { id: 'm1', done: 14, total: 15 } })

    expect(noticesBetween(running, facts({ mission: { id: 'm1', done: 15, total: 15 } }))).toEqual([{ level: 'ok', text: '🎯 mission finished: 15/15 tasks', key: 'mission-done', go: 'missions' }])
    expect(noticesBetween(running, facts({ mission: { id: 'm2', done: 15, total: 15 } }))).toEqual([])
    expect(noticesBetween(facts({ mission: { id: 'm1', done: 15, total: 15 } }), facts({ mission: { id: 'm1', done: 15, total: 15 } }))).toEqual([])
  })

  it('announces Anatole blocking calls as bad, with the rule, a new critical alert, and a mod that went degraded', () => {
    const blocked = noticesBetween(facts({ anatole: anatole({ blocked: 1 }) }), facts({ anatole: anatole({ blocked: 3 }) }), 'PR-002')

    expect(blocked).toEqual([{ level: 'bad', text: '🛡 Anatole blocked 2 calls · PR-002', key: 'anatole-blocked', go: 'secure' }])
    expect(noticesBetween(facts({ anatole: anatole() }), facts({ anatole: anatole({ critical: 1 }) }))[0]).toMatchObject({ level: 'bad', key: 'anatole-critical' })
    expect(noticesBetween(facts({ anatole: anatole() }), facts({ anatole: anatole({ degraded: 'timeout' }) }))[0]).toMatchObject({ level: 'warn', text: '🛡 Anatole is degraded: timeout' })
  })

  it('announces nothing about Anatole when it was not reporting before (the first read, or the plugin just appeared)', () => {
    expect(noticesBetween(facts(), facts({ anatole: anatole({ blocked: 9, critical: 2 }) }))).toEqual([])
  })
})

describe('the notice ring', () => {
  it('records a notice, does not repeat the same kind inside a minute, and keeps the newest 30', () => {
    const state = newState({})

    expect(addNotice(state, { level: 'warn', text: 'a', key: 'k' }, NOW)).toBe(true)
    expect(addNotice(state, { level: 'warn', text: 'b', key: 'k' }, NOW + DEDUPE_MS - 1)).toBe(false)
    expect(addNotice(state, { level: 'warn', text: 'c', key: 'k' }, NOW + DEDUPE_MS)).toBe(true)

    for (let i = 0; i < 40; i++) addNotice(state, { level: 'info', text: `n${i}`, key: `key${i}` }, NOW + i)

    expect(state.notices).toHaveLength(MAX_NOTICES)
    expect(state.notices.at(-1)?.text).toBe('n39')
  })

  it('shows the newest unseen notice while young, then not; dismiss clears it; quiet hides it', () => {
    const state = newState({})

    addNotice(state, { level: 'bad', text: 'older', key: 'a' }, NOW)
    addNotice(state, { level: 'warn', text: 'newer', key: 'b' }, NOW + 1_000)
    expect(visibleNotice(state, NOW + 2_000)?.text).toBe('newer')
    expect(visibleNotice(state, NOW + 1_000 + SHOW_MS)).toBeNull()

    dismissNotices(state)
    expect(visibleNotice(state, NOW + 2_000)).toBeNull()

    addNotice(state, { level: 'ok', text: 'later', key: 'c' }, NOW + 3_000)
    state.noticesQuietUntilMs = NOW + 60_000
    expect(visibleNotice(state, NOW + 4_000)).toBeNull()
    expect(state.notices.at(-1)?.text).toBe('later')
  })
})

describe('the commands', () => {
  it('parses band, notices and quiet', () => {
    expect(parseRuflo('band compact')).toEqual({ kind: 'band', arg: 'compact' })
    expect(parseRuflo('band')).toEqual({ kind: 'band', arg: '' })
    expect(parseRuflo('notices')).toEqual({ kind: 'notices', isClear: false })
    expect(parseRuflo('notices clear')).toEqual({ kind: 'notices', isClear: true })
    expect(parseRuflo('quiet 30')).toEqual({ kind: 'quiet', arg: '30' })
  })

  it('/ruflo band changes the mode and size for the session, says what it is now, and refuses a word it does not know', () => {
    const state = newState({})

    expect(bandReply(state, '')).toBe('band: auto (the plugin option) · full (two rows)')
    expect(bandReply(state, 'off')).toBe('band: off · full (two rows)')
    expect(bandReply(state, 'compact')).toBe('band: off · compact (one row)')
    expect(bandReply(state, 'reset')).toBe('band: auto (the plugin option) · full (two rows)')
    expect(bandReply(state, 'sideways')).toContain('band takes auto, on, off, compact, full or reset')
    expect(state.bandMode).toBeNull()
  })

  it('/ruflo notices lists the last ten newest first and marks them seen; clear empties it', () => {
    const state = newState({})

    expect(noticesReply(state, NOW, false)).toContain('no notices yet')
    addNotice(state, { level: 'bad', text: '🛡 Anatole blocked 1 call', key: 'a', go: 'secure' }, NOW)
    addNotice(state, { level: 'ok', text: 'done', key: 'b' }, NOW + 5_000)

    const text = noticesReply(state, NOW + 65_000, false)

    expect(text.split('\n').slice(1)).toEqual(['  ✓ done · 1m ago', '  ✖ 🛡 Anatole blocked 1 call · 1m ago · /ruflo secure'])
    expect(state.notices.every(notice => notice.seen)).toBe(true)
    expect(noticesReply(state, NOW, true)).toBe('cleared 2 notices')
    expect(state.notices).toHaveLength(0)
  })

  it('/ruflo quiet silences the notice row for N minutes, reports what is left, and turns back on', () => {
    const state = newState({})

    expect(quietReply(state, NOW, '')).toContain('notices are on')
    expect(quietReply(state, NOW, '30')).toContain('quiet for 30m')
    expect(state.noticesQuietUntilMs).toBe(NOW + 30 * 60_000)
    expect(quietReply(state, NOW + 10 * 60_000, '')).toContain('quiet for 20m more')
    expect(quietReply(state, NOW, 'off')).toBe('notices are on again')
    expect(state.noticesQuietUntilMs).toBe(0)
    expect(quietReply(state, NOW, 'soon')).toContain('from 1 to 1440')
    expect(quietReply(state, NOW, '5000')).toContain('from 1 to 1440')
  })
})

describe('the subagent label', () => {
  it('names a subagent by a short id, not the raw one, and the main agent as claude', () => {
    const state = newState({})

    expect(agentName(state, undefined)).toBe('claude')
    expect(agentName(state, 'ae593c2526850fe5a')).toBe('subagent ae593c')
  })
})

describe('the band', () => {
  type El = { kind: string; props: Record<string, unknown> }
  const make = (kind: string) => (props: Record<string, unknown>): El => ({ kind, props })
  const kit = { Box: make('Box'), Text: make('Text'), Button: make('Button'), Input: make('Input') }
  const flat = (node: unknown): El[] => (Array.isArray(node) ? node.flatMap(flat) : node !== null && typeof node === 'object' ? [node as El, ...flat((node as El).props.children)] : [])
  const draw = (state: ReturnType<typeof newState>, onGo?: (view: string) => void, onDismiss?: () => void) => barView(kit as never, state, 150, null, () => undefined, onGo as never, onDismiss) as unknown as El
  const rowsOf = (band: El) => (band.props.children as El[]).filter(child => child.props.flexDirection === 'row')

  it('colours its border by state: red for a bad notice, amber for something needing a person, green while working, purple when quiet', () => {
    const attention: BarPart = { text: 'x', tone: 'attention' }
    const live: BarPart = { text: 'x', tone: 'live' }

    expect(bandTone([], null)).toBe('idle')
    expect(bandTone([live], null)).toBe('live')
    expect(bandTone([live, attention], null)).toBe('attention')
    expect(bandTone([live, attention], { id: 1, atMs: 0, level: 'bad', text: '', key: '', seen: false })).toBe('bad')

    const state = newState({})

    expect(draw(state).props.borderColor).toBe(PANEL.border)
    addNotice(state, { level: 'bad', text: '🛡 Anatole blocked 1 call', key: 'a', go: 'secure' }, Date.now())
    expect(draw(state).props.borderColor).toBe(PANEL.bad)
  })

  it('shows the newest notice on its own row with a link and a dismiss, wired to the callbacks; nothing when quiet or dismissed', () => {
    const state = newState({})
    const went: string[] = []
    let dismissed = 0

    addNotice(state, { level: 'warn', text: '2 new approvals waiting (q)', key: 'approvals', go: 'approvals' }, Date.now())

    const band = draw(state, view => went.push(view), () => (dismissed += 1))
    const rows = rowsOf(band)
    const buttons = flat(rows.at(-1)).filter(el => el.kind === 'Button')

    expect(rows).toHaveLength(3)
    expect(flat(rows.at(-1)).filter(el => el.kind === 'Text').map(el => String(el.props.children)).join('')).toContain('⚠ 2 new approvals waiting (q)')
    expect(buttons.map(button => button.props.key)).toEqual(['band-notice-go', 'band-notice-dismiss'])
    ;(buttons[0]?.props.onPress as () => void)()
    ;(buttons[1]?.props.onPress as () => void)()
    expect(went).toEqual(['approvals'])
    expect(dismissed).toBe(1)

    state.noticesQuietUntilMs = Date.now() + 60_000
    expect(rowsOf(draw(state))).toHaveLength(2)
  })

  it('shrinks to one row in compact mode and keeps the notice row', () => {
    const state = newState({})

    state.bandCompact = true
    expect(rowsOf(draw(state))).toHaveLength(1)
    addNotice(state, { level: 'ok', text: 'done', key: 'a' }, Date.now())
    expect(rowsOf(draw(state))).toHaveLength(2)
  })
})
