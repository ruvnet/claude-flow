/**
 * The main menu's colours and badges, pure: every group has an accent, every colour is one the 256-colour palette has (so it renders the
 * same without truecolor and in tmux), the ink on an accent can be read, and an entry has a badge only when there is something to say.
 * Run with
 *   npx vitest run plugins/ruflo-console/tests/menu-style.spec.ts
 */
import { describe, expect, it } from 'vitest'

import type { ReadCache } from '../hooks/data/files'
import { readSnapshot } from '../hooks/data/snapshot'
import { ACCENT, badgesOf, LOUD, MUTED, PALETTE } from '../hooks/menu-style'
import { NAV_ACCENT, TONE } from '../hooks/menu-colors'
import { accentOfView, NAV_GROUPS } from '../hooks/nav-state'
import { secMemo } from '../hooks/secure'
import { newState, VIEWS } from '../hooks/state'
import { GROUPS } from '../hooks/views/menu'
import { RUFLO_FILES } from './fixtures/ruflo-run'

const CUBE = [0, 95, 135, 175, 215, 255]
const channels = (hex: string): [number, number, number] => [1, 3, 5].map(i => Number.parseInt(hex.slice(i, i + 2), 16)) as [number, number, number]
/** Is this colour one the xterm 256 palette has: a step of the 6x6x6 cube on each channel, or a grey of the ramp (8 to 238 in tens)? */
const isXterm256 = (hex: string): boolean => {
  const [r, g, b] = channels(hex)

  return (CUBE.includes(r) && CUBE.includes(g) && CUBE.includes(b)) || (r === g && g === b && r >= 8 && r <= 238 && (r - 8) % 10 === 0)
}
const luminance = (hex: string): number => {
  const [r, g, b] = channels(hex).map(value => {
    const unit = value / 255

    return unit <= 0.03928 ? unit / 12.92 : ((unit + 0.055) / 1.055) ** 2.4
  }) as [number, number, number]

  return 0.2126 * r + 0.7152 * g + 0.0722 * b
}
/** WCAG contrast ratio: 4.5 is the floor for text a person has to read. */
const contrast = (a: string, b: string): number => {
  const [light, dark] = [luminance(a), luminance(b)].sort((x, y) => y - x) as [number, number]

  return (light + 0.05) / (dark + 0.05)
}

describe('the menu accents', () => {
  it('gives every group an accent, and no accent to a group that is not there', () => {
    expect(GROUPS.map(group => group.title).sort()).toEqual(Object.keys(ACCENT).sort())
  })

  it('draws the palette strip in the accents, in the menu order', () => {
    expect(PALETTE).toEqual(GROUPS.map(group => ACCENT[group.title]))
  })

  it('uses only colours the 256-colour palette has, so they render the same without truecolor and in tmux', () => {
    for (const color of [...Object.values(ACCENT), ...PALETTE, MUTED, LOUD, ...Object.values(TONE), ...Object.values(NAV_ACCENT)]) expect(isXterm256(color), color).toBe(true)
  })

  it('has accents that read as text on a dark terminal (contrast 4.5 or more), so a chip that falls back to coloured text stays legible, and no two groups share a colour', () => {
    for (const [group, color] of Object.entries(ACCENT)) expect(contrast('#1c1c1c', color), group).toBeGreaterThanOrEqual(4.5)
    expect(new Set(Object.values(ACCENT)).size).toBe(Object.keys(ACCENT).length)
  })

  it('knows its own checks: a colour off the palette fails, and so does ink that cannot be read', () => {
    expect(isXterm256('#8b1a1a')).toBe(false)
    expect(isXterm256('#ffaf01')).toBe(false)
    expect(contrast('#d0d0d0', '#ffffff')).toBeLessThan(4.5)
  })
})

const memoryFs = (files: Record<string, string>) => ({
  read: async (path: string) => files[path] ?? Promise.reject(new Error('ENOENT')),
  stat: async (path: string) => (files[path] !== undefined ? { mtimeMs: 1, size: (files[path] as string).length } : Promise.reject(new Error('ENOENT'))),
  list: async () => Promise.reject(new Error('ENOENT')),
})

async function projectState() {
  const files = {
    ...Object.fromEntries(Object.entries(RUFLO_FILES).map(([path, text]) => [`/work/${path}`, text])),
    '/home/dev/.claude/plugins/known_marketplaces.json': JSON.stringify({ ruflo: { installLocation: '/home/dev/m/ruflo' } }),
    '/home/dev/m/ruflo/.claude-plugin/marketplace.json': JSON.stringify({ plugins: [{ name: 'ruflo-core' }, { name: 'ruflo-swarm' }] }),
  }
  const state = newState({})

  state.snapshot = await readSnapshot(memoryFs(files), new Map() as ReadCache, '/work', '/home/dev', {}, 0)

  return state
}

describe('the menu badges', () => {
  it('has none when there is nothing to say: no zero, no empty word', () => {
    expect(badgesOf(newState({}), 0)).toEqual({})
  })

  it('names approvals waiting and alerts as attention, and claims as information, on the pages they open', async () => {
    const state = await projectState()
    const badges = badgesOf(state, 0)

    expect(badges.approvals).toEqual({ text: '2', tone: 'attention' })
    expect(badges.overview).toEqual({ text: '⚠ 1', tone: 'attention' })
    expect(badges.claims).toMatchObject({ tone: 'plain' })
    expect(Number(badges.claims?.text)).toBeGreaterThan(0)
  })

  it('shows spend only from a cent, findings only when high or critical (loud only for critical), a running terminal, and an update not yet taken', () => {
    const state = newState({})

    state.usage = { costUsd: 0.004 }
    expect(badgesOf(state, 0).cost).toBeUndefined()
    state.usage = { costUsd: 19.81 }
    expect(badgesOf(state, 0).cost).toEqual({ text: '$19.81', tone: 'plain' })

    secMemo(state).findings = { source: 'scan', counts: { critical: 0, high: 235, medium: 60, low: 0 }, atMs: 0 }
    expect(badgesOf(state, 0).secure).toEqual({ text: '🔒 235', tone: 'plain' })
    secMemo(state).findings = { source: 'scan', counts: { critical: 1, high: 2, medium: 0, low: 0 }, atMs: 0 }
    expect(badgesOf(state, 0).secure).toEqual({ text: '🔒 3', tone: 'attention' })
    secMemo(state).findings = { source: 'scan', counts: { critical: 0, high: 0, medium: 9, low: 0 }, atMs: 0 }
    expect(badgesOf(state, 0).secure).toBeUndefined()

    state.terminal.runs.set('codex', { label: 'codex', startedAtMs: 0, stop: () => undefined })
    expect(badgesOf(state, 0).terminal).toEqual({ text: '●', tone: 'plain' })

    state.updateAvailable = '0.27.0'
    expect(badgesOf(state, 0).settings).toEqual({ text: '⬆ 0.27.0', tone: 'attention' })
  })

  it('only badges pages that exist', async () => {
    const state = await projectState()

    state.usage = { costUsd: 5 }
    state.updateAvailable = '0.27.0'
    state.terminal.runs.set('codex', { label: 'codex', startedAtMs: 0, stop: () => undefined })
    for (const view of Object.keys(badgesOf(state, 0))) expect(VIEWS.some(entry => entry.id === view), view).toBe(true)
  })
})

describe('the accent a page wears', () => {
  it('gives every nav group one of the menu\'s five accents, so a page\'s cards match the group the menu lists it under', () => {
    expect(NAV_GROUPS.map(group => group.title).sort()).toEqual(Object.keys(NAV_ACCENT).sort())
    for (const color of Object.values(NAV_ACCENT)) expect(PALETTE).toContain(color)
    expect(new Set(Object.values(NAV_ACCENT)).size).toBe(Object.keys(NAV_ACCENT).length)
  })

  it('gives every page in a group the accent of that group, and the menu none', () => {
    for (const group of NAV_GROUPS) for (const view of group.rows.flat()) expect(accentOfView(view), view).toBe(NAV_ACCENT[group.title])
    expect(accentOfView('menu')).toBeNull()
  })

  it('matches the menu: a page is coloured as the menu group that lists it', () => {
    const menuAccent = (view: string) => GROUPS.find(group => group.sections.some(section => section.items.some(item => item.go === view)))?.title

    for (const group of NAV_GROUPS) for (const view of group.rows.flat()) expect(ACCENT[menuAccent(view) ?? ''], view).toBe(NAV_ACCENT[group.title])
  })
})
