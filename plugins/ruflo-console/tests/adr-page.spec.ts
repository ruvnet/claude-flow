/**
 * The ADRs page, the palette entries and the settings (ADR-480): the page in both looks and at three widths, every action a button with
 * a key, the control level each palette entry needs, and the folder, style and pattern settings. Run with
 *   npx vitest run plugins/ruflo-console/tests/adr-page.spec.ts
 */
import { writeFileSync } from 'node:fs'

import { afterAll, describe, expect, it } from 'vitest'

import { adrOf, loadAdrs, proposeSpec } from '../hooks/adr'
import { adrActions } from '../hooks/adr-actions'
import { setAttached } from '../hooks/adr-mission'
import { adrPalette } from '../hooks/adr-palette'
import { allows, classOf } from '../hooks/model-tools'
import { NAV_GROUPS } from '../hooks/nav-state'
import { paletteEntries } from '../hooks/palette'
import { loadAiPrefs, saveAiPrefs, settingsOf } from '../hooks/settings'
import { newState, VIEWS, type State } from '../hooks/state'
import { adrsView } from '../hooks/views/adr'
import { setLook, type Actions } from '../hooks/views/common'
import { viewText } from '../hooks/views/pane'
import { join } from 'node:path'
import { cleanAfter } from './adr-helpers'
import { world } from './adr-world'

cleanAfter()
afterAll(() => setLook('plain'))

describe('the page', () => {
  const noAct = new Proxy(() => undefined, { get: (_t, key) => (key === 'then' ? undefined : noAct), apply: () => undefined }) as unknown as Actions
  const draw = (state: State, columns = 110) => viewText({ state, nowMs: Date.now(), columns, act: noAct }, 'adrs')

  it('is in the TOOLS group, has no hotkey, and says it is reading before the folder is read', () => {
    const state = newState({})

    expect(NAV_GROUPS.find(group => group.title === 'TOOLS')?.rows.flat()).toContain('adrs')
    expect(VIEWS.find(view => view.id === 'adrs')).toMatchObject({ key: '', label: 'ADRs' })
    expect(draw(state)).toContain('not read yet')
  })

  it('a project with no ADR folder offers to initialise it, and points at Settings', async () => {
    const w = await world('empty', null)
    const text = draw(w.state)

    expect(text).toContain('no ADR folder found')
    expect(text).toContain('initialise ADRs here')
    expect(text).toContain('Nothing is overwritten')
    expect(text).toContain('Settings')
  })

  it('lists records with status and date, the health strip, the filters and the honest limits', async () => {
    const w = await world('madr')
    const text = draw(w.state)

    expect(text).toContain('docs/decisions')
    expect(text).toContain('madr')
    expect(text).toContain('3 records · 2 accepted · 0 proposed · 1 superseded')
    expect(text).toContain('0003')
    expect(text).toContain('Use Cockroach for storage')
    expect(text).toContain('health: 0 errors')
    expect(text).toContain('compares file PATHS')
    expect(text).toContain('nothing here proves a change follows or breaks a decision')
  })

  it('a selected record shows its links both ways, its decision and the mission it is attached to', async () => {
    const w = await world('nygard')

    await setAttached(w.state, w.host as never, '0003-use-graphql.md', true)
    adrOf(w.state).selected = '0002-use-rest.md'

    const rest = draw(w.state)

    expect(rest).toContain('ADR 2: Use REST for the public API')
    expect(rest).toContain('superseded by')
    expect(rest).toContain('cited by ADRs')

    adrOf(w.state).selected = '0003-use-graphql.md'

    const graph = draw(w.state)

    expect(graph).toContain('supersedes')
    expect(graph).toContain('cited by missions msn_aaaaaaa')
    expect(graph).toContain('Decision: GraphQL')
    expect(graph).toContain('− detach from mission')
  })

  it('draws in both looks and at narrow and wide widths, with hostile titles, without an escape reaching the screen', async () => {
    const w = await world('plain')

    writeFileSync(join(w.root, 'adr/0001-evil.md'), '# 1. Evil\u001b[31m title ‮ <b>x</b>\n\nStatus: Accepted\u001b[2J\n')
    await loadAdrs(w.state, w.host as never)

    for (const look of ['plain', 'bbs'] as const) {
      setLook(look)

      for (const columns of [44, 80, 140]) {
        const text = draw(w.state, columns)

        expect(text, `${look} ${columns}`).toContain('ADR')
        expect(text, `${look} ${columns}`).not.toMatch(/[\u001b‮]/)
      }
    }

    setLook('plain')
  })

  it('every action is a button with a key, pressing reaches the action, and the list pages by j and k', async () => {
    const w = await world('madr')
    const calls: string[] = []
    const recorder = (path: string): unknown => new Proxy(() => undefined, { get: (_t, key) => (key === 'then' ? undefined : recorder(`${path}.${String(key)}`)), apply: (_t, _this, args) => void calls.push(`${path.slice(1)}(${args.join(',')})`) })
    type El = { props: Record<string, unknown> }
    const kit = { Box: (props: Record<string, unknown>): El => ({ props }), Text: (props: Record<string, unknown>): El => ({ props }), Button: (props: Record<string, unknown>): El => ({ props }), Input: (props: Record<string, unknown>): El => ({ props }) }
    const flat = (el: unknown): El[] => {
      const node = el as El

      if (typeof node !== 'object' || node === null) return []

      const kids = node.props?.children

      return [node, ...(Array.isArray(kids) ? kids.flatMap(flat) : typeof kids === 'object' ? flat(kids) : [])]
    }

    adrOf(w.state).selected = '0002-use-postgres.md'

    const tree = adrsView({ kit, state: w.state, nowMs: Date.now(), columns: 120, pictures: new Map(), act: recorder('') as never, cards: true } as never)
    const nodes = flat(tree)
    const by = (key: string) => nodes.find(node => node.props.key === key)

    ;(by('adr-row-0003-use-cockroach.md')?.props.onPress as () => void)()
    ;(by('adr-to-accepted') ?? by('adr-f-accepted'))?.props.onPress
    ;(by('adr-f-accepted')?.props.onPress as () => void)()
    ;(by('adr-reload')?.props.onPress as () => void)()
    ;(by('adr-filter')?.props.onSubmit as (v: string) => void)('cockroach')
    ;(by('adr-propose')?.props.onSubmit as (v: string) => void)('Cache reads')
    ;(by('adr-prev')?.props.onPress as () => void)()

    expect(by('adr-prev')?.props.hotkey).toBe('k')
    expect(by('adr-next')?.props.hotkey).toBe('j')
    expect(calls).toEqual(['adrs.select(0003-use-cockroach.md)', 'adrs.filter([object Object])', 'adrs.reload()', 'adrs.filter([object Object])', 'adrs.propose(Cache reads)', 'adrs.page(0)'])
    // Mouse and keyboard parity: every pressable here is a Button (focusable, Enter and click alike), and the fields are Inputs.
    expect(nodes.filter(node => typeof node.props.onPress === 'function').length).toBeGreaterThan(8)
  })
})

describe('the palette and the control level', () => {
  async function wired() {
    const w = await world('nygard')
    const asked: unknown[] = []
    const actions = adrActions(w.state, w.host as never, { ask: (spec: unknown) => void asked.push(spec) } as never)

    return { ...w, actions, asked }
  }

  it('has an entry for each action, in the palette headless runs use', async () => {
    const w = await wired()
    const ids = adrPalette(w.state).map(entry => entry.id)

    expect(ids).toEqual(['adr-open', 'adr-show', 'adr-init', 'adr-propose', 'adr-accept', 'adr-reject', 'adr-deprecate', 'adr-supersede', 'adr-attach', 'adr-detach', 'adr-scope'])
    expect(paletteEntries(w.state, Date.now()).filter(entry => entry.id.startsWith('adr-')).map(entry => entry.id)).toEqual(ids)
  })

  it('reading is read level; proposing, initialising, changing a status and attaching are write level, never network, spend or delete', async () => {
    const w = await wired()
    const entry = (id: string) => adrPalette(w.state).find(candidate => candidate.id === id)
    const specOf = (id: string, text = '') => {
      const run = entry(id)?.run

      return run?.kind === 'spec' ? run.spec : run?.kind === 'text' ? run.make(text) : null
    }
    const pending = (spec: NonNullable<ReturnType<typeof specOf>>) => ({ label: spec.label, args: spec.args, ...(spec.note !== undefined && { note: spec.note }), ...(spec.shows !== undefined && { shows: spec.shows }), expect: spec.expect, ...(spec.declared !== undefined && { declared: spec.declared }) })
    const classes: Record<string, string> = {}

    for (const [id, text] of [['adr-show', '3'], ['adr-propose', 'Cache reads'], ['adr-accept', '3'], ['adr-reject', '3'], ['adr-deprecate', '3'], ['adr-supersede', '1 3'], ['adr-attach', '3'], ['adr-detach', '3'], ['adr-scope', '']] as const) {
      const spec = specOf(id, text)

      expect(spec, id).not.toBeNull()
      classes[id] = classOf(pending(spec as never))
    }

    expect(Object.fromEntries(Object.entries(classes).filter(([id]) => id !== 'adr-show' && id !== 'adr-scope'))).toEqual({ 'adr-propose': 'write', 'adr-accept': 'write', 'adr-reject': 'write', 'adr-deprecate': 'write', 'adr-supersede': 'write', 'adr-attach': 'write', 'adr-detach': 'write' })
    // Reading goes through the same gate as any entry that declares nothing: it is a read-only spec, which runs at the read level without a pending card.
    expect(specOf('adr-show', '3')?.isReadOnly).toBe(true)
    expect(specOf('adr-show', '3')?.declared).toBeUndefined()
    expect(specOf('adr-scope')?.declared).toBeUndefined()
    expect(entry('adr-open')?.run).toEqual({ kind: 'view', view: 'adrs' })

    for (const id of ['adr-propose', 'adr-accept', 'adr-reject', 'adr-deprecate', 'adr-supersede', 'adr-attach', 'adr-detach']) {
      const spec = specOf(id, id === 'adr-propose' ? 'Cache reads' : id === 'adr-supersede' ? '1 3' : '3')

      expect(spec?.declared, id).toBe('write')
      expect(allows('read', classOf(pending(spec as never))), `${id} at read`).toBe(false)
      expect(allows('write', classOf(pending(spec as never))), `${id} at write`).toBe(true)
    }
  })

  it('a title over the limit is refused with its count on every path, never cut: /ruflo run and console_run as well as the page (ADR-481)', async () => {
    const w = await wired()
    const propose = adrPalette(w.state).find(entry => entry.id === 'adr-propose')?.run
    const long = 'Use event sourcing for the billing ledger so that every refund and chargeback can be replayed and audited by finance and by the regulator'
    const exact = 'x'.repeat(120)

    expect(long.length).toBe(137)
    expect(propose?.kind).toBe('text')
    if (propose?.kind !== 'text') return

    // The runner shows `why(text)` when `make` returns no spec; console_run goes through the same runner.
    expect(propose.make(long)).toBeNull()
    expect(propose.why?.(long)).toBe('the title is 137 characters; the limit is 120 (it is the record’s heading and file name; put the rest in the record itself): 17 over. Nothing was sent or changed; shorten it and ask again.')
    // Counted as it would be written: leading heading marks and link syntax do not count, so they cannot push a fitting title over.
    expect(propose.make(`## ${exact}`)?.label).toBe(`propose ADR 4: ${exact}`)
    expect(propose.make(`${exact}y`)).toBeNull()
    expect(propose.make('Cache reads')?.label).toBe('propose ADR 4: Cache reads')

    // The proposal itself refuses, so a caller that skips the check gets no proposal rather than a cut one.
    expect(proposeSpec(w.state, w.host as never, long, '2026-10-09')).toBeNull()
    expect(proposeSpec(w.state, w.host as never, exact, '2026-10-09')?.label).toBe(`propose ADR 4: ${exact}`)

    // The page's field says the same and asks nothing.
    w.actions.propose(long)
    expect(w.asked).toEqual([])
    expect(JSON.stringify(adrOf(w.state))).toContain('137 characters; the limit is 120')
  })

  it('a status entry only prepares the change: the diff is a second confirm, and a bad number is no spec', async () => {
    const w = await wired()
    const accept = adrPalette(w.state).find(entry => entry.id === 'adr-deprecate')?.run

    expect(accept?.kind === 'text' && accept.make('999')).toBeNull()
    expect(accept?.kind === 'text' && accept.make('ADR-0003')).not.toBeNull()
    ;(accept?.kind === 'text' ? accept.make('3') : null)?.run?.()
    await new Promise(resolve => setTimeout(resolve, 100))

    const second = w.asked[0] as { shows: string; label: string } | undefined

    expect(second?.label).toBe('mark ADR 3 deprecated')
    expect(second?.shows).toContain('-Accepted')
    expect(second?.shows).toContain('+Deprecated')
  })
})

describe('the settings', () => {
  it('keep a safe folder, a style and a pattern, and refuse an unsafe folder or pattern with a reason', async () => {
    const w = await world('nygard', null)
    const host = w.host as never

    saveAiPrefs(w.state, host, { adrDir: 'notes/decisions', adrStyle: 'madr', adrPattern: 'ADR-{n}-{slug}.md' })
    expect(settingsOf(w.state).ai).toMatchObject({ adrDir: 'notes/decisions', adrStyle: 'madr', adrPattern: 'ADR-{n}-{slug}.md' })
    saveAiPrefs(w.state, host, { adrDir: '../outside' })
    expect(settingsOf(w.state).ai.adrDir).toBe('notes/decisions')
    expect(w.state.outcome?.ok).toBe(false)
    expect(w.state.outcome?.detail).toContain('inside this project')
    saveAiPrefs(w.state, host, { adrPattern: '{n}.md' })
    expect(settingsOf(w.state).ai.adrPattern).toBe('ADR-{n}-{slug}.md')
    expect(w.state.outcome?.detail).toContain('{n} and {slug}')

    const reload = newState({})

    await w.host.storeSet('ai-prefs', { adrDir: '../evil', adrStyle: 'bogus', adrPattern: '../x{n}{slug}.md' })
    await loadAiPrefs(reload, host)
    expect(settingsOf(reload).ai).toMatchObject({ adrDir: '', adrStyle: 'auto', adrPattern: '' })
  })

  it('a named style and pattern shape what a new record is called and looks like', async () => {
    const w = await world('nygard', null)

    settingsOf(w.state).ai.adrStyle = 'ruflo'
    settingsOf(w.state).ai.adrPattern = 'ADR-{n}-{slug}.md'
    await loadAdrs(w.state, w.host as never)
    expect(adrOf(w.state).style).toMatchObject({ name: 'ruflo', pattern: 'ADR-{n}-{slug}.md', source: 'setting' })
  })
})

