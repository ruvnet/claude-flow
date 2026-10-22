/**
 * The band's words under vitest: most important first, never a zero that says nothing.
 *   npx vitest run plugins/ruflo-console/tests/band.spec.ts
 */
import { describe, expect, it } from 'vitest'

import type { ReadCache } from '../hooks/data/files'
import { readSnapshot } from '../hooks/data/snapshot'
import { newState } from '../hooks/state'
import { secMemo } from '../hooks/secure'
import { BAND_LINKS, barParts, barText, barView, money, PANEL } from '../hooks/views/bar'
import type { Kit } from '../hooks/views/common'
import { RUFLO_FILES } from './fixtures/ruflo-run'

const memoryFs = (files: Record<string, string>) => ({
  read: async (path: string) => files[path] ?? Promise.reject(new Error('ENOENT')),
  stat: async (path: string) => (files[path] !== undefined ? { mtimeMs: 1, size: (files[path] as string).length } : Promise.reject(new Error('ENOENT'))),
  list: async () => Promise.reject(new Error('ENOENT')),
})

async function capturedState(marketplace: string[]) {
  const files = {
    ...Object.fromEntries(Object.entries(RUFLO_FILES).map(([path, text]) => [`/work/${path}`, text])),
    '/home/dev/.claude/plugins/known_marketplaces.json': JSON.stringify({ ruflo: { installLocation: '/home/dev/m/ruflo' } }),
    '/home/dev/m/ruflo/.claude-plugin/marketplace.json': JSON.stringify({ plugins: marketplace.map(name => ({ name })) }),
  }
  const state = newState({})

  state.snapshot = await readSnapshot(memoryFs(files), new Map() as ReadCache, '/work', '/home/dev', {}, 0)

  return state
}

describe('band', () => {
  it('leads with what needs a person, then the swarm in words, then the rest', async () => {
    const state = await capturedState(['ruflo-core', 'ruflo-swarm', 'ruflo-mods', 'ruflo-console'])

    state.usage = { costUsd: 1010.66 }
    state.ruflo.route = { agent: 'coder', confidence: 0.8, matched: true, reason: 'keyword' }
    state.history.patterns = [{ atMs: 0, value: 7466 }, { atMs: 1, value: 7478 }]

    const parts = barParts(state, 0)

    expect(parts.filter(part => part.tone === 'attention').map(part => part.text)).toEqual(['2 to approve (q)'])
    // Nothing moving: it says so; the totals (routes, patterns learned) live in their views, not on the band.
    expect(barText(state, 0)).toBe('ruflo · 2 to approve (q) · idle · 2 agents ready · 2 claims (1 stealable) · $1,011 this session')
  })

  it('leads with what is happening now: who works on what and for how long, terminal runs, a fresh event', async () => {
    const state = await capturedState(['ruflo-core', 'ruflo-swarm', 'ruflo-mods', 'ruflo-console'])
    const snap = state.snapshot as NonNullable<typeof state.snapshot>
    const agent = snap.agents[0] as (typeof snap.agents)[number]

    agent.status = 'busy'
    snap.tasks.push({ id: 'task-9', type: 'feature', description: 'add OAuth login to the API gateway', status: 'in_progress', assignedTo: [agent.id] })
    state.statusLog.set(agent.id, [{ atMs: 0, status: 'busy' }])
    state.terminal.runs.set('codex', { label: 'codex', startedAtMs: 100_000, stop: () => undefined })
    state.events.push({ atMs: 150_000, kind: 'claims', text: 'claim task-9 by coder' })

    const parts = barParts(state, 160_000)

    expect(parts.filter(part => part.tone === 'live').map(part => part.text)).toEqual([`▶ ${agent.name ?? agent.type} on add OAuth login to the API gateway 2m`, '💻 codex answering 1m'])
    expect(barText(state, 160_000)).toContain('claim task-9 by coder · 10s ago')
    expect(barText(state, 160_000)).not.toContain('idle')
  })

  it('a stale marketplace clone shows as an alert, not as a separate word', async () => {
    const state = await capturedState(['ruflo-core', 'ruflo-swarm'])

    expect(barParts(state, 0).find(part => part.text.startsWith('⚠'))).toEqual({ text: '⚠ 1 alert', tone: 'attention', go: 'overview' })
    expect(barText(state, 0)).not.toContain('STALE')
  })

  it('never says 0/0: an empty swarm is named as such, and no growth means no learned part', () => {
    const state = newState({})

    state.snapshot = { swarm: { topology: 'hierarchical', agentIds: [] }, agents: [], claims: [], plugins: { missingFromClone: [] }, daemon: null, isRufloProject: true } as never
    state.history.patterns = [{ atMs: 0, value: 7466 }, { atMs: 1, value: 7466 }]
    expect(barText(state, 0)).toBe('ruflo · swarm, no agents')
  })

  it('money: cents under $100, whole dollars with separators above', () => {
    expect(money(0.4213)).toBe('$0.42')
    expect(money(99.994)).toBe('$99.99')
    expect(money(1010.66)).toBe('$1,011')
  })

  it('no spend part until there is a cent to show', () => {
    const state = newState({})

    state.usage = { costUsd: 0.004 }
    expect(barText(state, 0)).toBe('ruflo')
  })
})

type El = { kind: string; props: Record<string, unknown> }

/** A kit that records what is drawn, so the band's layout is checked without the host. */
const kit = { Box: (props: Record<string, unknown>): El => ({ kind: 'Box', props }), Text: (props: Record<string, unknown>): El => ({ kind: 'Text', props }), Button: (props: Record<string, unknown>): El => ({ kind: 'Button', props }) } as unknown as Kit
const flat = (el: unknown): El[] => {
  const node = el as El

  if (typeof node !== 'object' || node === null) return []

  const kids = node.props.children

  return [node, ...(Array.isArray(kids) ? kids.flatMap(flat) : typeof kids === 'object' ? flat(kids) : [])]
}
const readable = (el: unknown): string => flat(el).map(node => (node.kind === 'Button' ? String(node.props.label) : typeof node.props.children === 'string' ? node.props.children : '')).join('')
const buttons = (el: unknown) => flat(el).filter(node => node.kind === 'Button')

describe('band: a panel of two rows, standing facts that stay, and links', () => {
  it('keeps the last tool call with how long ago after the minute is up, and the idle text no longer repeats it', async () => {
    const state = await capturedState(['ruflo-core', 'ruflo-swarm', 'ruflo-mods', 'ruflo-console'])

    state.events.push({ atMs: 0, kind: 'claims', text: 'claude: Bash' })

    const stale = barParts(state, 300_000).find(part => part.text.startsWith('claude: Bash'))

    expect(stale).toMatchObject({ text: 'claude: Bash · 5m ago', row: 'standing', go: 'events' })
    expect(barText(state, 300_000)).not.toContain('last activity')
    expect(barText(state, 300_000).split('claude: Bash').length - 1).toBe(1)
    // While it is fresh it stays on the status row, as before.
    expect(barParts(state, 12_000).find(part => part.text.startsWith('claude: Bash'))?.row).not.toBe('standing')
  })

  it('a long working task cannot push the claims, the spend or the last tool call out, and the row shortens its own words to fit', async () => {
    const state = await capturedState(['ruflo-core', 'ruflo-swarm', 'ruflo-mods', 'ruflo-console'])
    const snap = state.snapshot as NonNullable<typeof state.snapshot>
    const agent = snap.agents[0] as (typeof snap.agents)[number]

    agent.status = 'busy'
    snap.tasks.push({ id: 'task-9', type: 'feature', description: 'research prior art, existing ADRs and the whole of the history of this repository', status: 'in_progress', assignedTo: [agent.id] })
    state.usage = { costUsd: 19.81 }
    state.events.push({ atMs: Date.now() - 300_000, kind: 'claims', text: 'claude: Bash' })

    // Narrow: the standing row uses its compact forms; nothing is cut in the middle of a word.
    const panel = barView(kit, state, 70, null, () => undefined, () => undefined) as unknown as El
    const [top, bottom] = panel.props.children as El[]
    const narrow = readable(bottom)

    // The long task is clipped on the status row: that is what keeps the second row whole.
    expect(readable(top)).toContain('…')
    expect(narrow).toContain('claude: Bash')
    expect(narrow).toContain('5m ago')
    expect(narrow).toMatch(/\d+ claims?/)
    expect(narrow).toContain('$19.81')
    expect(narrow).not.toContain('…')

    // Wide: the full words.
    const wide = readable(barView(kit, state, 140, null, () => undefined, () => undefined))

    expect(wide).toContain('claude: Bash · 5m ago')
    expect(wide).toContain('$19.81 this session')
    expect(wide).toContain('(1 stealable)')
  })

  it('is a bordered panel with a ground, in two rows', () => {
    const panel = barView(kit, newState({}), 100, null, () => undefined, () => undefined) as unknown as El

    expect(panel.props).toMatchObject({ borderStyle: 'round', borderColor: PANEL.border, backgroundColor: PANEL.ground, flexDirection: 'column' })
    expect((panel.props.children as unknown[]).length).toBe(2)
  })

  it('draws every piece of text in a colour of its own, never one the theme decides, so it reads on the ground', () => {
    const state = newState({})

    state.updateAvailable = '0.27.0'

    const texts = flat(barView(kit, state, 120, null, () => undefined, undefined)).filter(node => node.kind === 'Text' && typeof node.props.children === 'string' && node.props.children.trim() !== '')

    expect(texts.length).toBeGreaterThan(3)
    for (const node of texts) expect(typeof node.props.color, String(node.props.children)).toBe('string')
  })

  it('offers links to the main views, and each opens the console on its view', () => {
    const opened: string[] = []
    const panel = barView(kit, newState({}), 120, null, () => undefined, view => void opened.push(view))
    const links = buttons(panel).filter(node => String(node.props.key).startsWith('band-link-'))

    expect(links.map(node => node.props.label)).toEqual(BAND_LINKS.map(link => link.label))
    for (const node of links) (node.props.onPress as () => void)()
    expect(opened).toEqual(BAND_LINKS.map(link => link.go))
  })

  it('drops a link that does not fit rather than cutting it', () => {
    const labels = buttons(barView(kit, newState({}), 40, null, () => undefined, () => undefined))
      .filter(node => String(node.props.key).startsWith('band-link-'))
      .map(node => node.props.label)

    expect(labels.length).toBeLessThan(BAND_LINKS.length)
    for (const label of labels) expect(BAND_LINKS.map(link => link.label)).toContain(label)
  })

  it('shows the open-console button only while the pane is closed', () => {
    const closed = newState({})
    const open = newState({})

    open.pane.isOpen = true
    expect(buttons(barView(kit, closed, 100, null, () => undefined, () => undefined)).some(node => node.props.key === 'open-console')).toBe(true)
    expect(buttons(barView(kit, open, 100, null, () => undefined, () => undefined)).some(node => node.props.key === 'open-console')).toBe(false)
  })
})

describe('band: findings and an available update', () => {
  it('names high and critical findings from the last scan, loud only when one is critical, and says nothing for none', () => {
    const state = newState({})

    expect(barParts(state, 0).some(part => part.text.startsWith('🔒'))).toBe(false)

    secMemo(state).findings = { source: 'scan', counts: { critical: 0, high: 235, medium: 60, low: 0 }, atMs: 0 }
    expect(barParts(state, 0).find(part => part.text.startsWith('🔒'))).toEqual({ text: '🔒 235 high or critical', tone: 'plain', go: 'secure', row: 'standing', compact: '🔒 235' })

    secMemo(state).findings = { source: 'scan', counts: { critical: 2, high: 5, medium: 0, low: 0 }, atMs: 0 }
    expect(barParts(state, 0).find(part => part.text.startsWith('🔒'))).toMatchObject({ text: '🔒 7 high or critical', tone: 'attention' })

    secMemo(state).findings = { source: 'scan', counts: { critical: 0, high: 0, medium: 9, low: 4 }, atMs: 0 }
    expect(barParts(state, 0).some(part => part.text.startsWith('🔒'))).toBe(false)
  })

  it('shows an update that was offered and not taken, as a link to Settings, and nothing otherwise', () => {
    const state = newState({})

    expect(barParts(state, 0).some(part => part.text.startsWith('⬆'))).toBe(false)
    state.updateAvailable = '0.27.0'
    expect(barParts(state, 0).find(part => part.text.startsWith('⬆'))).toEqual({ text: '⬆ 0.27.0 available', tone: 'attention', go: 'settings', row: 'standing' })
  })
})
