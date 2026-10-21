/**
 * The replay family on the Workflows page (ADR-461): its four board slots register without taking a hotkey, fold shut by default, and
 * work through the page's own buttons. A recording kit and an in-memory host; no engine. Run with
 *   npx vitest run plugins/ruflo-console/tests/wf-replay-views.spec.ts --testTimeout=30000
 */
import { beforeEach, describe, expect, it } from 'vitest'

import type { ActionSpec } from '../hooks/actions'
import { swarmRun } from '../hooks/data/wf-swarm'
import { newState } from '../hooks/state'
import type { Host } from '../hooks/host'
import { workflowsActions } from '../hooks/wf-actions'
import { resetSavedLive, savedFor } from '../hooks/wf-saved-live'
import type { Actions, Ctx, Kit } from '../hooks/views/common'
import { resetCompare } from '../hooks/views/wf-compare'
import { resetExport, setExportFs } from '../hooks/views/wf-export'
import { resetFolds } from '../hooks/views/wf-fold'
import { resetReplays } from '../hooks/views/wf-replay'
import { workflowsPage } from '../hooks/views/wf-page'
import { slotsFor } from '../hooks/views/wf-slots'
import { BASE, runOf } from './fixtures/wf-runs'
import { T0 } from './fixtures/workflows'

type El = { kind: string; props: Record<string, unknown> }

const kit = { Box: (props: Record<string, unknown>): El => ({ kind: 'Box', props }), Text: (props: Record<string, unknown>): El => ({ kind: 'Text', props }), Button: (props: Record<string, unknown>): El => ({ kind: 'Button', props }), Input: (props: Record<string, unknown>): El => ({ kind: 'Input', props }) } as unknown as Kit

const flat = (node: unknown, out: El[] = []): El[] => {
  if (Array.isArray(node)) node.forEach(child => flat(child, out))
  else if (typeof node === 'object' && node !== null) {
    out.push(node as El)
    flat((node as El).props?.children, out)
  }

  return out
}

const words = (tree: unknown): string => flat(tree).flatMap(el => (el.kind === 'Text' && typeof el.props.children === 'string' ? [el.props.children as string] : el.kind === 'Button' && typeof el.props.label === 'string' ? [el.props.label] : [])).join('\n')
const press = (tree: unknown, key: string): void => {
  const found = flat(tree).find(el => el.kind === 'Button' && el.props.key === key)

  if (found === undefined) throw new Error(`no button ${key}`)
  ;(found.props.onPress as () => void)()
}
const inputOf = (tree: unknown): El | undefined => flat(tree).find(el => el.kind === 'Input' && el.props.label === 'path')
const tick = (): Promise<void> => new Promise(resolve => setTimeout(resolve, 0))

const NOW = T0 + 600_000
const a = runOf('wf_a', BASE)
const b = runOf('wf_b', BASE.map(x => (x.id === 'ra1' ? { ...x, tokens: 250_000 } : x)))
const asked: (ActionSpec | null)[] = []
// the folders on the way exist; one file in them is taken
const stat = async (path: string) => (path === '/work/proj/.claude-flow/console/exports/taken.md' ? { size: 1, kind: 'file' } : path.startsWith('/work/proj/.claude-flow') && !path.endsWith('.md') ? { kind: 'dir' } : Promise.reject(new Error('ENOENT')))

function world(columns = 100) {
  const state = newState({})

  state.view = 'workflows'
  state.cwd = '/work/proj'
  state.wf.read = { runs: [a, b], root: '/x', capBytes: 1, skipped: 0, more: 0 }

  const host = { invalidate: () => undefined } as unknown as Host
  const runner = { ask: (spec: ActionSpec | null) => void asked.push(spec) }
  const act = { workflows: workflowsActions(state, host, runner as never) } as unknown as Actions
  const ctx: Ctx = { kit, state, nowMs: NOW, columns, pictures: new Map(), act }

  return { state, page: () => workflowsPage(ctx) }
}

beforeEach(() => {
  asked.length = 0
  resetFolds()
  resetReplays()
  resetCompare()
  resetExport()
  resetSavedLive()
  setExportFs({ stat })
})

describe('registration', () => {
  it('adds four board slots after the board, takes no hotkey and no other kind of slot', () => {
    world().page()

    expect(slotsFor('board').map(s => s.id).filter(id => ['replay', 'compare', 'export', 'saved'].includes(id))).toEqual(['replay', 'compare', 'export', 'saved'])

    const ours = new Set(['replay', 'compare', 'export', 'saved'])

    for (const kind of ['key', 'action', 'tab'] as const) expect(slotsFor(kind).filter(s => ours.has(s.id))).toHaveLength(0)
  })

  it('every slot is folded shut with a one-line summary until opened, and a narrow page still draws', () => {
    const w = world(46)
    const text = words(w.page())

    expect(text).toMatch(/Replay/)
    expect(text).toMatch(/moments in/)
    expect(text).toMatch(/1 other run of "demo-run"/)
    expect(text).not.toMatch(/step 0\//)
  })
})

describe('replay', () => {
  it('opens, steps forward and back, and the board follows the step', () => {
    const w = world()

    press(w.page(), 'wf-replay-fold')
    expect(words(w.page())).toMatch(/step 0\/6/)
    press(w.page(), 'wf-rp-next')
    press(w.page(), 'wf-rp-next')
    expect(words(w.page())).toMatch(/step 2\/6/)
    expect(words(w.page())).toMatch(/2 running/)
    press(w.page(), 'wf-rp-last')
    expect(words(w.page())).toMatch(/real final board/)
    press(w.page(), 'wf-rp-prev')
    expect(words(w.page())).toMatch(/step 5\/6/)
    press(w.page(), 'wf-rp-first')
    expect(words(w.page())).toMatch(/step 0\/6/)
    press(w.page(), 'wf-rp-faster')
    expect(words(w.page())).toMatch(/64x/)
  })

  it('says the replay cannot rewind a run, and that stopping or messaging is not done from it', () => {
    const w = world()

    press(w.page(), 'wf-replay-fold')
    expect(words(w.page())).toMatch(/cannot rewind a run; stop or message one from its control tab/)
  })

  it('has nothing to replay for the ruflo swarm, and says so', () => {
    const w = world()

    w.state.wf.read = { runs: [], root: '/x', capBytes: 1, skipped: 0, more: 0 }
    w.state.snapshot = { swarm: null, agents: [{ id: 'a1', type: 'coder', status: 'busy' }] } as never
    expect(swarmRun(null, [{ id: 'a1', type: 'coder', status: 'busy' } as never], NOW)).not.toBeNull()
    expect(words(w.page())).toMatch(/live roster with no history/)
  })
})

describe('compare', () => {
  it('sets the run beside its twin, with the changed agent marked and a way to hide the rest', () => {
    const w = world()

    press(w.page(), 'wf-compare-fold')

    const text = words(w.page())

    expect(text).toMatch(/ A \w+[\s\S]*vs[\s\S]*B \w+/)
    expect(text).toMatch(/~ build:a/)
    expect(text).toMatch(/= review:a/)
    expect(text).toMatch(/1 changed/)
    press(w.page(), 'wf-cmp-only')
    expect(words(w.page())).not.toMatch(/= review:a/)
    expect(words(w.page())).toMatch(/~ build:a/)
  })
})

describe('export', () => {
  it('asks for a confirm-gated write at the default path, with the text on stdin', async () => {
    const w = world()

    press(w.page(), 'wf-export-fold')
    press(w.page(), 'wf-export-default')
    await tick()

    const spec = asked[0]

    expect(spec?.argv).toEqual(['dd', 'of=/work/proj/.claude-flow/console/exports/demo-run-wf_a.md', 'conv=excl', 'status=none'])
    expect(spec?.stdin).toMatch(/^# Workflow run: demo-run/)
    expect(spec?.declared).toBe('write')
    expect(words(w.page())).toMatch(/confirm below to write/)
  })

  it('refuses a path with .., outside the project, or already taken, and asks nothing', async () => {
    const w = world()

    press(w.page(), 'wf-export-fold')

    for (const [path, why] of [['../x.md', /\.\./], ['/etc/x.md', /outside the project/], ['.claude-flow/console/exports/taken.md', /already exists/]] as const) {
      ;(inputOf(w.page())?.props.onSubmit as (v: string) => void)(path)
      await tick()
      expect(words(w.page())).toMatch(why)
    }

    expect(asked).toHaveLength(0)
  })

  it('writes nothing when the host reader is not wired, since a link could not be ruled out', async () => {
    const w = world()

    setExportFs(null)
    press(w.page(), 'wf-export-fold')
    press(w.page(), 'wf-export-default')
    await tick()
    expect(asked).toHaveLength(0)
    expect(words(w.page())).toMatch(/not wired/)
  })

  it('never lets a credential in a label reach the spec', async () => {
    const w = world()
    const secret = 'sk-abcdefghijklmnopqrstuvwx'

    w.state.wf.read = { runs: [runOf('wf_s', [{ id: 's1', label: `go ${secret}`, phase: 'Build', at: 0, ms: 1 }])], root: '/x', capBytes: 1, skipped: 0, more: 0 }
    press(w.page(), 'wf-export-fold')
    press(w.page(), 'wf-export-default')
    await tick()
    expect(asked[0]?.stdin).not.toContain(secret)
    expect(JSON.stringify(asked[0])).not.toContain(secret)
  })
})

describe('saved views', () => {
  it('pins and unpins the run, lists the pin with a jump button, and shows where the file is', () => {
    const w = world()

    press(w.page(), 'wf-saved-fold')
    expect(words(w.page())).toMatch(/\.claude-flow\/console\/wf-views\.json/)
    press(w.page(), 'wf-saved-pin')
    expect(savedFor('/work/proj').saved.pins.map(p => p.runId)).toEqual(['wf_a'])
    expect(words(w.page())).toMatch(/Unpin this run/)
    press(w.page(), 'wf-saved-go-0')
    expect(w.state.wf.ui.run).toBe(0)
    press(w.page(), 'wf-saved-pin')
    expect(savedFor('/work/proj').saved.pins).toEqual([])
  })

  it('forgets only through the confirm card', () => {
    const w = world()

    press(w.page(), 'wf-saved-fold')
    press(w.page(), 'wf-saved-forget')
    expect(asked[0]).toMatchObject({ argv: ['rm', '-f', '--', '/work/proj/.claude-flow/console/wf-views.json'], declared: 'delete' })
  })

  it('says a pinned run that is no longer read is not among the runs', () => {
    const w = world()

    savedFor('/work/proj').saved.pins.push({ runId: 'wf_gone', name: 'old run', pinnedAtMs: 1 })
    press(w.page(), 'wf-saved-fold')
    expect(words(w.page())).toMatch(/old run · not among the runs read now/)
  })
})
