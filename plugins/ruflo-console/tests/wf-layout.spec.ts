/**
 * The Workflows page at every dock width the engine gives (ADR-469): 56 to 125 columns. Every section is drawn with a recording kit and
 * metered the way the engine lays a row out (tests/fixtures/wf-layout-rig.ts): no row is wider than the pane, no text is squeezed to a
 * letter per row, every button of an action row is reachable (a long row wraps to a new row instead of running off the edge), and the
 * breadcrumb folds its middle crumbs before it wraps. Run with
 *   npx vitest run plugins/ruflo-console/tests/wf-layout.spec.ts --testTimeout=30000
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest'

import { resetDrillIo } from '../hooks/data/wf-drill-io'
import { newState } from '../hooks/state'
import { workflowsActions } from '../hooks/wf-actions'
import { resetSavedLive } from '../hooks/wf-saved-live'
import type { Host } from '../hooks/host'
import { rule, setLook, type Actions, type Ctx } from '../hooks/views/common'
import { flow, runTag } from '../hooks/views/wf-layout'
import { drillOf, setQuery } from '../hooks/views/wf-detail'
import { resetCompare } from '../hooks/views/wf-compare'
import { resetExport } from '../hooks/views/wf-export'
import { resetFolds } from '../hooks/views/wf-fold'
import { resetReplays } from '../hooks/views/wf-replay'
import { workflowsPage } from '../hooks/views/wf-page'
import '../hooks/views/wf-register'
import { bindWorkflowDrill } from '../hooks/wf-drill'
import { BASE, runOf } from './fixtures/wf-runs'
import { T0 } from './fixtures/workflows'
import { buttonOf, click, flush, frame, kit, liveFiles, worldOf, type World } from './fixtures/wf-drill-world'
import { cells, flatten, measure, type El, type Finding } from './fixtures/wf-layout-rig'

const WIDTHS = [56, 60, 72, 80, 100, 125] as const

const a = runOf('wf_a', BASE, {}, 'sample-build-tune-review')
const b = runOf('wf_b', BASE.map(x => (x.id === 'ra1' ? { ...x, tokens: 250_000 } : x)), {}, 'sample-build-tune-review')

/** The full page with every registered slot, over two finished runs of one workflow. */
function fullPage(columns: number) {
  const state = newState({})

  state.view = 'workflows'
  state.cwd = '/work/proj'
  state.wf.read = { runs: [a, b], root: '/x', capBytes: 1, skipped: 0, more: 0 }

  const host = { invalidate: () => undefined } as unknown as Host
  const act = { workflows: workflowsActions(state, host, { ask: () => undefined } as never), focus: () => undefined, view: () => undefined } as unknown as Actions
  const ctx: Ctx = { kit, state, nowMs: T0 + 600_000, columns, pictures: new Map(), act }

  return { state, ctx, page: () => workflowsPage(ctx) }
}

const report = (found: Finding[]): string => found.map(f => `${f.kind} ${f.width}>${f.avail} ${f.at}`).join('\n')

beforeEach(() => {
  resetFolds()
  resetReplays()
  resetCompare()
  resetExport()
  resetSavedLive()
  resetDrillIo()
})
afterEach(() => {
  resetDrillIo()
  setLook('plain')
})

describe('the page at every width', () => {
  for (const [look, columns] of WIDTHS.flatMap(width => (['plain', 'bbs'] as const).map(name => [name, width] as const))) {
    it(`draws the board, the inspector and every folded section within ${columns} columns (${look} look)`, () => {
      setLook(look)

      const w = fullPage(columns)

      for (const key of ['wf-replay-fold', 'wf-compare-fold', 'wf-export-fold', 'wf-saved-fold']) buttonOf(w.page(), key) !== undefined && click(w.page(), key)

      expect(report(measure(w.page(), columns))).toBe('')

      click(w.page(), 'wf-inspect')
      expect(report(measure(w.page(), columns))).toBe('')
    })
  }
})

async function drillWorld(columns: number): Promise<{ world: World; at: () => ReturnType<typeof frame> }> {
  const world = await worldOf(liveFiles())

  bindWorkflowDrill(world.state, world.host as never)

  return { world, at: () => frame(world, columns) }
}

describe('the drill-down at every width', () => {
  for (const columns of WIDTHS) {
    it(`keeps each level, tab and the search within ${columns} columns, with a whole last crumb and the tab on its own row`, async () => {
      const { world, at } = await drillWorld(columns)

      click(at().tree, 'wf-inspect')
      expect(report(measure(at().tree, columns))).toBe('')
      click(at().tree, 'wf-inspect')
      click(at().tree, 'wf-drill-open')

      const crumbsOf = (): El | undefined => flatten(at().tree).find(el => el.kind === 'Box' && el.props.key === 'wf-crumbs')

      for (let level = 0; level < 4; level += 1) {
        expect(report(measure(at().tree, columns))).toBe('')

        const crumbs = crumbsOf()

        if (crumbs !== undefined) {
          const row = flatten(crumbs.props.children).filter(el => el.kind === 'Text' || el.kind === 'Button')
          const words = row.map(el => String(el.kind === 'Button' ? el.props.label : el.props.children))

          expect(words.join('')).not.toMatch(/Activity|Log|Files|Result/)
          if (drillOf(world.state).level === 'agent') expect(words.some(word => /^Agent: /.test(word))).toBe(true)
        }

        click(at().tree, 'wf-drill-in')
      }

      expect(drillOf(world.state).level).toBe('item')
      click(at().tree, 'wf-drill-out')
      expect(drillOf(world.state).level).toBe('agent')

      for (const sub of ['log', 'files', 'result', 'activity']) {
        click(at().tree, `wf-sub-${sub}`)
        expect(report(measure(at().tree, columns))).toBe('')
      }

      setQuery(at().env, 'build')
      await flush()
      expect(report(measure(at().tree, columns))).toBe('')
    })
  }

  it('collapses the middle crumbs before it wraps, and keeps the last whole', async () => {
    const { world, at } = await drillWorld(60)

    click(at().tree, 'wf-drill-open')
    for (let n = 0; n < 2; n += 1) click(at().tree, 'wf-drill-in')
    expect(drillOf(world.state).level).toBe('agent')

    const crumbs = flatten(at().tree).find(el => el.kind === 'Box' && el.props.key === 'wf-crumbs') as El
    const parts = flatten(crumbs.props.children).filter(el => el.kind === 'Text' || el.kind === 'Button')
    const shown = parts.map(el => String(el.kind === 'Button' ? el.props.label : el.props.children)).join('')

    expect(shown).toMatch(/…/)
    expect(shown).toMatch(/Agent: /)
    expect(cells(shown) + parts.filter(el => el.kind === 'Button').length * 4).toBeLessThanOrEqual(60)
    expect(parts[parts.length - 1]?.kind).toBe('Text')
  })

  it('puts a space between the diff-stat button and the worktree path on the wide Files tab', async () => {
    const { at } = await drillWorld(125)

    click(at().tree, 'wf-drill-open')
    for (let n = 0; n < 2; n += 1) click(at().tree, 'wf-drill-in')
    click(at().tree, 'wf-sub-files')

    const row = flatten(at().tree).find(el => el.kind === 'Box' && el.props.key === 'wf-diff-row') as El
    const kids = flatten(row.props.children).filter(el => el.kind === 'Text' || el.kind === 'Button')
    const path = kids.findIndex(el => el.kind === 'Text' && String(el.props.children).startsWith('worktree'))
    const button = kids.findIndex(el => el.kind === 'Button')

    expect(path).toBeGreaterThanOrEqual(0)
    expect(button).toBeGreaterThan(path)
    expect(String(kids[path]?.props.children)).toMatch(/ $/)
    expect(button).toBe(path + 1)
  })
})

describe('the helpers', () => {
  const at = (columns: number): Ctx => ({ kit, state: newState({}), nowMs: 0, columns, pictures: new Map(), act: {} as Actions })

  it('clips a rule whose title or right-hand text is longer than the pane, in both looks', () => {
    for (const look of ['plain', 'bbs'] as const) {
      setLook(look)

      for (const columns of [30, 56, 60]) {
        expect(report(measure({ kind: 'Box', props: { flexDirection: 'column', children: [rule(at(columns), 'T'.repeat(90), 'right '.repeat(30)), rule(at(columns), 'Phases', 'x'.repeat(200))] } }, columns))).toBe('')
      }
    }
  })

  it('wraps a long run of buttons onto more rows, keeps every one in order, and clips a label longer than a row', () => {
    const items = Array.from({ length: 9 }, (_, i) => ({ key: `k${i}`, label: `button ${i}`, onPress: () => undefined }))
    const rows = flow(at(40), [...items, { key: 'long', label: 'L'.repeat(120), onPress: () => undefined }], 'r', 'lead ')

    expect(rows.length).toBeGreaterThan(2)
    expect(report(measure({ kind: 'Box', props: { flexDirection: 'column', children: rows } }, 40))).toBe('')
    expect(flatten(rows).filter(el => el.kind === 'Button').map(el => el.props.key)).toEqual([...items.map(item => item.key), 'long'])
    expect(String(flatten(rows).find(el => el.props.key === 'long')?.props.label)).toMatch(/…$/)
  })

  it('names a run by whole words, never a cut through the middle of one', () => {
    expect(runTag('sample-btr')).toBe('sample-btr')
    expect(runTag('wf_live')).toBe('live')
    expect(runTag('wf_ab')).toBe('wf-ab')
    expect(runTag('wf_a1b2c3d4e5')).toBe('c3d4e5')
    expect(runTag('x')).toBe('x')
    expect(runTag('sample-btr')).not.toMatch(/^le-/)
  })
})

describe('the meter itself', () => {
  const row = (children: unknown[]): El => ({ kind: 'Box', props: { flexDirection: 'row', children } })
  const btn = (label: string): El => ({ kind: 'Button', props: { label } })

  it('flags a row whose buttons are wider than the pane, and a plain text squeezed to a letter', () => {
    expect(measure(row([btn('abcdefgh'), btn('abcdefgh')]), 20).map(f => f.kind)).toEqual(['overflow'])
    expect(measure(row([btn('abcdefghijkl'), { kind: 'Text', props: { children: 'Agent · Log' } }]), 18).map(f => f.kind)).toEqual(['overflow', 'letters'])
    expect(measure(row([btn('abcdefghijkl'), { kind: 'Text', props: { wrap: 'truncate-end', children: 'Agent · Log' } }]), 18)).toEqual([])
  })
})
