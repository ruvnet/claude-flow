/**
 * The main menu's entry (ADR-433): the cards light up in turn, entries lock in one by one, nothing below moves, and it ends. Run with
 *   npx vitest run plugins/ruflo-console/tests/menu-entry.spec.ts
 */
import { afterEach, describe, expect, it } from 'vitest'

import { ENTRY, entryAge, groupStart, itemStart } from '../hooks/menu-entry'
import { BOOT_MIN_MS, newState } from '../hooks/state'
import { GROUPS, menuView } from '../hooks/views/menu'
import { setLook, type Ctx } from '../hooks/views/common'
import { viewText } from '../hooks/views/pane'

const act = (() => {
  const proxy: unknown = new Proxy(() => undefined, { get: (_t, key) => (key === 'then' ? undefined : proxy), apply: () => undefined })

  return proxy
})() as never
const draw = (sinceBoot: number, columns = 100): string => {
  const state = newState({})

  state.options.look = 'bbs'
  state.options.boot = true
  state.pane.bootAtMs = 1_000
  state.pane.menuAtMs = 1_000 + BOOT_MIN_MS
  state.view = 'menu'
  setLook('bbs')

  return viewText({ state, nowMs: 1_000 + BOOT_MIN_MS + sinceBoot, columns, act }, 'menu')
}

afterEach(() => setLook('plain'))

describe('entryAge', () => {
  const clock = { look: 'bbs', boot: true, bootAtMs: 1_000, menuAtMs: 7_000 }

  it('counts from the end of the boot, and is null outside the BBS look, with boot off, never opened, or once over', () => {
    expect(entryAge(clock, 7_500, BOOT_MIN_MS)).toBe(500)
    expect(entryAge({ ...clock, look: 'plain' }, 7_500, BOOT_MIN_MS)).toBeNull()
    expect(entryAge({ ...clock, boot: false }, 7_500, BOOT_MIN_MS)).toBeNull()
    expect(entryAge({ ...clock, bootAtMs: 0 }, 7_500, BOOT_MIN_MS)).toBeNull()
    expect(entryAge(clock, 7_000 + ENTRY.totalMs, BOOT_MIN_MS)).toBeNull()
  })

  it('falls back to the boot minimum when the clock has no menu start (a reopened pane)', () => {
    expect(entryAge({ ...clock, menuAtMs: 0 }, 1_000 + BOOT_MIN_MS + 200, BOOT_MIN_MS)).toBe(200)
    expect(entryAge({ ...clock, menuAtMs: 500 }, 1_000 + BOOT_MIN_MS + 200, BOOT_MIN_MS)).toBe(200)
  })

  it('plays for five to ten seconds, the groups in turn', () => {
    expect(ENTRY.totalMs).toBeGreaterThanOrEqual(5_000)
    expect(ENTRY.totalMs).toBeLessThanOrEqual(10_000)
    expect(groupStart(1)).toBeGreaterThan(groupStart(0))
    expect(itemStart(0, 3)).toBeGreaterThan(itemStart(0, 2))
  })
})

describe('the menu while it enters', () => {
  it('shows nothing of the cards at first, then the first card before the last, then all of them', () => {
    const at0 = draw(0)
    const mid = draw(groupStart(0) + 1_500)
    const done = draw(ENTRY.totalMs + 100)

    expect(at0).not.toContain('Swarm')
    expect(mid).toMatch(/▓▒░/)
    expect(mid.match(/▓▒░/g)?.length ?? 0).toBeLessThan(done.match(/▓▒░/g)?.length ?? 0)
    expect(done).toContain('▓▒░ ')
  })

  it('keeps every card the same height: each card has the same rows during the entry as after it', () => {
    type El = { props: Record<string, unknown> }
    const kit = { Box: (props: Record<string, unknown>): El => ({ props }), Text: (props: Record<string, unknown>): El => ({ props }), Button: (props: Record<string, unknown>): El => ({ props }), Input: (props: Record<string, unknown>): El => ({ props }) }
    const rowsOf = (sinceBoot: number): number[] => {
      const state = newState({})

      state.options.look = 'bbs'
      state.options.boot = true
      state.pane.bootAtMs = 1_000
      state.pane.menuAtMs = 1_000 + BOOT_MIN_MS
      setLook('bbs')

      const tree = menuView({ kit, state, nowMs: 1_000 + BOOT_MIN_MS + sinceBoot, columns: 100, pictures: new Map(), act, cards: true } as unknown as Ctx) as unknown as El
      const found: number[] = []
      const walk = (el: unknown): void => {
        const node = el as El

        if (typeof node !== 'object' || node === null) return

        const kids = node.props.children

        if (typeof node.props.key === 'string' && GROUPS.some(group => node.props.key === `menu-${group.title}`)) found.push(Array.isArray(kids) ? kids.length : 0)
        if (Array.isArray(kids)) kids.forEach(walk)
      }

      walk(tree)

      return found
    }
    const after = rowsOf(ENTRY.totalMs + 100)

    expect(after.length).toBe(GROUPS.length)

    for (const t of [0, 1_000, 3_000, 5_000, 6_500]) expect(rowsOf(t), `${t} ms`).toEqual(after)
  })

  it('ends: the finished menu is the plain menu, with its entries as they always were', () => {
    const done = draw(ENTRY.totalMs + 100)

    expect(done).toContain('Missions')
    const clockless = (text: string): string => text.replace(/Online \d\d:\d\d/, '')

    expect(clockless(draw(ENTRY.totalMs + 5_000))).toBe(clockless(done))
  })
})

describe('a page title when the page is switched to', () => {
  it('strikes in: noise ahead of a bright edge, the finished title once over, and still with no age', async () => {
    const { titlePicture, TITLE_ENTRY_MS } = await import('../hooks/gfx/pictures')
    const cells = (age?: number): string => [...titlePicture('ruflo | Swarm', 80, 0, age).cells].filter((_v, i) => i % 3 === 0).join(',')
    const done = cells()

    expect(cells(TITLE_ENTRY_MS)).toBe(done)
    expect(cells(Infinity)).toBe(done)
    expect(cells(300)).not.toBe(done)
    expect(cells(300)).not.toBe(cells(700))
    expect(cells(300)).toBe(cells(300))
  })
})

describe('the title glitch', () => {
  it('puts ASCII glitch characters in the strike-in, in pink or cyan, and none once it is over', async () => {
    const { titlePicture, TITLE_ENTRY_MS } = await import('../hooks/gfx/pictures')
    const ascii = (age: number): number => {
      const grid = titlePicture('ruflo | Swarm', 80, 0, age)
      let n = 0

      for (let i = 0; i < grid.cells.length; i += 3) if ('#%&@/\\|<>=+*'.includes(String.fromCodePoint(grid.cells[i] as number))) n++

      return n
    }
    let early = 0

    for (let age = 50; age < 700; age += 50) early += ascii(age)

    expect(early).toBeGreaterThan(0)
    expect(ascii(TITLE_ENTRY_MS)).toBe(ascii(Infinity))
    expect(ascii(Infinity)).toBe(0)
  })
})

describe('the menu banner', () => {
  it('strikes in like the titles, and is the still banner once over or with no age', async () => {
    const { bannerPicture, TITLE_ENTRY_MS } = await import('../hooks/gfx/pictures')
    const cells = (age?: number): string => [...bannerPicture('p', 72, 0, age).cells].join(',')
    const done = cells()

    expect(cells(TITLE_ENTRY_MS)).toBe(done)
    expect(cells(Infinity)).toBe(done)
    expect(cells(300)).not.toBe(done)
    expect(cells(300)).toBe(cells(300))
  })
})

describe('the occasional glitch after the entry', () => {
  it('fires a short burst now and then, never in a still frame, and is reproducible', async () => {
    const { titlePicture, bannerPicture } = await import('../hooks/gfx/pictures')
    const still = [...titlePicture('ruflo | Swarm', 80, 0).cells].join(',')
    const changed: number[] = []

    for (let t = 1; t < 40_000; t += 40) if ([...titlePicture('ruflo | Swarm', 80, t).cells].join(',') !== [...titlePicture('ruflo | Swarm', 80, t).cells].join(',')) changed.push(t)

    // The animation itself moves (shimmer), so compare the glyphs only: a burst adds ASCII characters the plain title never has.
    const hasGlitch = (t: number): boolean => [...titlePicture('ruflo | Swarm', 80, t).cells].some((v, i) => i % 3 === 0 && '#%&@/\\|<>=+*'.includes(String.fromCodePoint(v)))
    const hits: number[] = []

    for (let t = 1; t < 40_000; t += 40) if (hasGlitch(t)) hits.push(t)

    expect(changed).toEqual([])
    expect([...titlePicture('ruflo | Swarm', 80, 0).cells].join(',')).toBe(still)
    expect(hasGlitch(0)).toBe(false)
    // About one burst of 260 ms per 8 s: some frames glitch, most do not.
    expect(hits.length).toBeGreaterThan(0)
    expect(hits.length).toBeLessThan(40_000 / 40 / 8)
    const bannerHit = Array.from({ length: 1000 }, (_v, i) => 1 + i * 40).some(t => [...bannerPicture('p', 72, t).cells].some((v, i) => i % 3 === 0 && '#%&@/\\|<>=+*'.includes(String.fromCodePoint(v))))

    expect(bannerHit).toBe(true)
  })
})
