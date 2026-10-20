/**
 * The Workflows page's wiring (ADR-464): the view is reachable (view table, nav, menu, ask, commands), refreshed only while it is open,
 * washed of credentials and control characters, its keys never take a global key, and the slot registry other features plug into holds
 * its rules. Pure and fast: an in-memory disk, a recording kit, no engine. Run with
 *   npx vitest run plugins/ruflo-console/tests/wf-wire.spec.ts --testTimeout=30000
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest'

import type { ActionSpec } from '../hooks/actions'
import { VIEW_ASK } from '../hooks/ask-claude'
import { parseRuflo } from '../hooks/commands'
import { cleanRun, cleanText } from '../hooks/data/wf-clean'
import { buildRun } from '../hooks/data/workflows'
import type { WorkflowFs } from '../hooks/data/workflows-read'
import type { Host } from '../hooks/host'
import { NAV_GROUPS } from '../hooks/nav-state'
import { newState, rowsOf, VIEWS, viewOf, type State } from '../hooks/state'
import { isRunPath, workflowsActions } from '../hooks/wf-actions'
import { refreshWorkflows, runNotices, workflowsModelOf } from '../hooks/wf-live'
import { GROUPS } from '../hooks/views/menu'
import type { Actions, Ctx, Kit } from '../hooks/views/common'
import { workflowsPage } from '../hooks/views/wf-page'
import { DETAIL_TAB, registerSlot, resetSlots, slotsFor, type Slot } from '../hooks/views/wf-slots'
import { journal, meta, record, result, started, T0, transcript } from './fixtures/workflows'

const NOW = T0 + 10_000
const CONFIG = '/home/u/.claude'
const ROOT = `${CONFIG}/projects/-work-proj`
const SESSION = '11111111-2222-3333-4444-555555555555'
const RUN = `${ROOT}/${SESSION}/subagents/workflows/wf_live`

type El = { kind: string; props: Record<string, unknown> }

const kit = { Box: (props: Record<string, unknown>): El => ({ kind: 'Box', props }), Text: (props: Record<string, unknown>): El => ({ kind: 'Text', props }), Button: (props: Record<string, unknown>): El => ({ kind: 'Button', props }) } as unknown as Kit

const flat = (node: unknown, out: El[] = []): El[] => {
  if (Array.isArray(node)) node.forEach(child => flat(child, out))
  else if (typeof node === 'object' && node !== null) {
    out.push(node as El)
    flat((node as El).props?.children, out)
  }

  return out
}

const words = (tree: unknown): string => flat(tree).filter(el => el.kind === 'Text' && typeof el.props.children === 'string').map(el => el.props.children as string).join('\n')
const buttons = (tree: unknown): El[] => flat(tree).filter(el => el.kind === 'Button')
const buttonOf = (tree: unknown, key: string): El | undefined => buttons(tree).find(el => el.props.key === key)

function memoryFs(files: Record<string, string>): WorkflowFs {
  const under = (dir: string) => [...new Set(Object.keys(files).filter(path => path.startsWith(`${dir}/`)).map(path => path.slice(dir.length + 1).split('/')[0] as string))]

  return {
    read: async path => files[path] ?? Promise.reject(new Error('ENOENT')),
    stat: async path => (files[path] !== undefined ? { mtimeMs: T0, size: files[path].length, kind: 'file' } : Promise.reject(new Error('ENOENT'))),
    list: async dir => {
      const names = under(dir)

      return names.length === 0 ? Promise.reject(new Error('ENOENT')) : names.map(name => ({ name, mtimeMs: T0, size: files[`${dir}/${name}`]?.length }))
    },
  }
}

const live = (label = 'build:x'): Record<string, string> => ({
  [`${RUN}/journal.jsonl`]: journal(started('a1', label, 'Build')),
  [`${RUN}/agent-a1.meta.json`]: meta(label, 'Build'),
  [`${RUN}/agent-a1.jsonl`]: transcript([{ at: 5, id: 'm1', input: 1, write: 1, read: 1, output: 1 }]),
})

function worldOf(files: Record<string, string>): { state: State; host: Host; fs: { files: Record<string, string> }; invalidated: () => number } {
  const state = newState({})
  const box = { files }
  let drawn = 0
  const fs: WorkflowFs = { read: path => memoryFs(box.files).read(path), stat: path => memoryFs(box.files).stat(path), list: dir => memoryFs(box.files).list(dir) }
  const host = { fs, invalidate: () => void (drawn += 1) } as unknown as Host

  state.view = 'workflows'
  state.configDir = CONFIG
  state.cwd = '/work/proj'
  state.isInteractive = false

  return { state, host, fs: box, invalidated: () => drawn }
}

const asked: { spec: ActionSpec | null; why: string }[] = []

function pageOf(state: State, host: Host, columns = 100): { tree: unknown; ctx: Ctx } {
  const runner = { ask: (spec: ActionSpec | null, why: string) => void asked.push({ spec, why }) }
  const act = { workflows: workflowsActions(state, host, runner as never) } as unknown as Actions
  const ctx: Ctx = { kit, state, nowMs: NOW, columns, pictures: new Map(), act }

  return { tree: workflowsPage(ctx), ctx }
}

beforeEach(() => {
  resetSlots()
  asked.length = 0
})
afterEach(() => resetSlots())

describe('the page is reachable', () => {
  it('is a view with no key (every letter is a tab or reserved), found by id, label and /ruflo', () => {
    const view = VIEWS.find(entry => entry.id === 'workflows')

    expect(view).toMatchObject({ key: '', label: 'Workflows' })
    expect(viewOf('workflows')).toBe('workflows')
    expect(parseRuflo('workflows')).toEqual({ kind: 'open', view: 'workflows' })
    expect(rowsOf('workflows')).toBeGreaterThan(20)
  })

  it('sits in the SWARM nav group and the menu\'s SWARM > observe section, next to Swarm Topology', () => {
    expect(NAV_GROUPS.find(group => group.title === 'SWARM')?.rows.flat()).toContain('workflows')

    const observe = GROUPS.find(group => group.title === 'SWARM')?.sections.find(section => section.name === 'observe')

    expect(observe?.items.map(item => item.go)).toEqual(['swarm', 'workflows'])
  })

  it('has an Ask Claude entry', () => {
    expect(VIEW_ASK.workflows.default).toMatch(/workflow/i)
  })
})

describe('the refresh', () => {
  it('reads only while the page is in front: another view, or a closed pane, reads nothing', async () => {
    const world = worldOf(live())
    const opened: string[] = []
    const host = { ...world.host, fs: { ...(world.host.fs as WorkflowFs), read: async (path: string) => (opened.push(path), (world.host.fs as WorkflowFs).read(path)) } } as unknown as Host

    world.state.view = 'overview'
    await refreshWorkflows(world.state, host, true, NOW)
    expect(world.state.wf.read).toBeNull()
    expect(opened).toEqual([])

    world.state.view = 'workflows'
    world.state.isInteractive = true
    world.state.pane.isOpen = true
    world.state.pane.isShown = false
    await refreshWorkflows(world.state, host, false, NOW)
    expect(world.state.wf.read).toBeNull()

    world.state.pane.isShown = true
    await refreshWorkflows(world.state, host, false, NOW)
    expect(world.state.wf.read?.runs).toHaveLength(1)
    expect(opened.length).toBeGreaterThan(0)
  })

  it('joins a read already running instead of stacking another', async () => {
    const world = worldOf(live())
    let lists = 0
    const inner = world.host.fs as WorkflowFs
    const host = { ...world.host, fs: { ...inner, list: async (dir: string) => (lists += 1, inner.list(dir)) } } as unknown as Host

    await Promise.all([refreshWorkflows(world.state, host, true, NOW), refreshWorkflows(world.state, host, true, NOW)])

    const once = lists

    await refreshWorkflows(world.state, host, true, NOW)
    expect(lists).toBe(once * 2)
  })

  it('a reader that throws leaves the previous read and an error line, and clears when the next read works', async () => {
    const world = worldOf(live())

    await refreshWorkflows(world.state, world.host, true, NOW)

    const before = world.state.wf.read
    const throwing = { ...world.host, fs: undefined } as unknown as Host

    await refreshWorkflows(world.state, throwing, true, NOW + 1)
    expect(world.state.wf.read).toBe(before)
    expect(world.state.wf.error).not.toBeNull()
    expect(words(pageOf(world.state, world.host).tree)).toMatch(/last read failed/)

    await refreshWorkflows(world.state, world.host, true, NOW + 2)
    expect(world.state.wf.error).toBeNull()
  })

  it('washes credentials and control characters from labels before anything draws them', async () => {
    const token = 'sk-abcdefghijklmnopqrstuvwxyz012345'
    const world = worldOf(live(`deploy ${token} \u001b[31mred`))

    await refreshWorkflows(world.state, world.host, true, NOW)

    const text = words(pageOf(world.state, world.host).tree)
    const agent = world.state.wf.read?.runs[0]?.phases[0]?.agents[0]

    expect(agent?.label).not.toContain('sk-')
    expect(text).not.toContain(token)
    expect(text).not.toMatch(/\u001b/)
    expect(cleanText('Bearer abcdefgh12345678 x\u0007y')).toBe('‹masked› x y')
  })

  it('announces a run that finished or failed since the last read; the first read announces nothing', async () => {
    const world = worldOf(live())

    await refreshWorkflows(world.state, world.host, true, NOW)
    expect(world.state.notices).toEqual([])

    world.fs.files = { ...world.fs.files, [`${ROOT}/${SESSION}/workflows/wf_live.json`]: record({ status: 'completed' }) }
    // A file found missing is not looked for again for 10 s (data/files.ts): the record shows up at the next read after that.
    world.state.cache.clear()
    await refreshWorkflows(world.state, world.host, true, NOW + 1)
    expect(world.state.notices.map(notice => notice.text)).toEqual([expect.stringMatching(/workflow .* finished: \d+\/\d+ agents/)])
    expect(world.state.notices[0]?.go).toBe('workflows')
  })

  it('runNotices reads state changes only (running to failed raises one, no change raises none)', () => {
    const run = (state: string) => ({ id: 'wf_a', name: 'demo', state, done: 1, failed: 1, total: 2 }) as never

    expect(runNotices(null, [run('failed')])).toEqual([])
    expect(runNotices(new Map([['wf_a', 'failed']]), [run('failed')])).toEqual([])
    expect(runNotices(new Map([['wf_a', 'running']]), [run('failed')])).toMatchObject([{ level: 'bad', key: 'wf-wf_a-failed' }])
    expect(runNotices(new Map(), [run('failed')])).toEqual([])
  })

  it('a notice slot is asked after a read, its text is masked, its throw is contained', async () => {
    const world = worldOf(live())

    expect(registerSlot({ kind: 'notice', id: 'loud', between: () => [{ level: 'warn', text: 'token Bearer abcdefgh12345678 seen', key: 'k1' }] })).toEqual({ ok: true })
    expect(registerSlot({ kind: 'notice', id: 'broken', between: () => { throw new Error('nope') } })).toEqual({ ok: true })
    await refreshWorkflows(world.state, world.host, true, NOW)
    expect(world.state.notices).toHaveLength(1)
    expect(world.state.notices[0]?.text).toBe('token ‹masked› seen')
    expect(world.state.notices[0]?.key).toBe('loud:k1')
  })

  it('the page model folds the ruflo swarm in after the workflow runs', async () => {
    const world = worldOf(live())

    expect(workflowsModelOf(world.state, NOW)).toBeNull()
    await refreshWorkflows(world.state, world.host, true, NOW)
    expect(workflowsModelOf(world.state, NOW)?.runs.map(run => run.kind)).toEqual(['workflow'])
  })
})

describe('the keys', () => {
  it('move the cursor through the pure reducer, and /ruflo next|prev is the same j|k', async () => {
    const files = { ...live(), [`${RUN}/agent-a2.meta.json`]: meta('b', 'Build'), [`${RUN}/journal.jsonl`]: journal(started('a1', 'one', 'Build'), started('a2', 'two', 'Build')), [`${RUN}/agent-a2.jsonl`]: transcript([{ at: 6, id: 'm2', input: 1, write: 1, read: 1, output: 1 }]) }
    const world = worldOf(files)

    await refreshWorkflows(world.state, world.host, true, NOW)

    const act = workflowsActions(world.state, world.host, { ask: () => undefined } as never)

    act.key('l')
    expect(world.state.wf.ui.column).toBe('agents')
    act.key('j')
    expect(world.state.wf.ui.agent).toBe(1)
    act.key('k')
    expect(world.state.wf.ui.agent).toBe(0)
    act.key('enter')
    expect(world.state.wf.ui.isInspecting).toBe(true)
    act.key('escape')
    expect(world.state.wf.ui.isInspecting).toBe(false)
  })

  it('every button the page draws avoids the footer, confirm and menu keys, and no two share a hotkey or a key', async () => {
    const world = worldOf(live())

    await refreshWorkflows(world.state, world.host, true, NOW)

    const { tree } = pageOf(world.state, world.host)
    const hotkeys = buttons(tree).map(el => el.props.hotkey).filter((key): key is string => typeof key === 'string')

    expect(hotkeys.sort()).toEqual(['b', 'd', 'i', 'j', 'k', 'l', 'u'].sort())
    for (const key of ['p', 'x', 'r', 'h', 'y', 'n']) expect(hotkeys, `hotkey ${key}`).not.toContain(key)
    expect(new Set(buttons(tree).map(el => el.props.key)).size).toBe(buttons(tree).length)
    // Pressing a button moves the cursor.
    ;(buttonOf(tree, 'wf-col-agents')?.props.onPress as (() => void) | undefined)?.()
    expect(world.state.wf.ui.column).toBe('agents')
  })

  it('the keys the page names in its own text are keys its buttons carry (h is Help\'s, [ and ] are not hotkeys)', async () => {
    const world = worldOf(live())

    await refreshWorkflows(world.state, world.host, true, NOW)

    const { tree } = pageOf(world.state, world.host)
    const shown = words(tree)

    expect(shown).toContain('b/l column')
    expect(shown).toContain('d inspect')
    expect(shown).not.toContain('h/l column')
    expect(shown).not.toContain('[ ] switches run')
  })

  it('opens a transcript path only inside the config directory\'s projects folder', () => {
    expect(isRunPath(`${ROOT}/${SESSION}/subagents/workflows/wf_live/agent-a1.jsonl`, CONFIG)).toBe(true)
    expect(isRunPath(`${CONFIG}/projects/../secrets.json`, CONFIG)).toBe(false)
    expect(isRunPath('/etc/passwd', CONFIG)).toBe(false)
    expect(isRunPath(`${CONFIG}/projects/x`, null)).toBe(false)
    expect(isRunPath(`${CONFIG}/projects/x\0y`, CONFIG)).toBe(false)

    const world = worldOf({})

    workflowsActions(world.state, world.host, {} as never).show('/etc/passwd')
    expect(world.state.outcome).toMatchObject({ ok: false })
    expect(world.state.outcome?.detail).not.toContain('/etc/passwd')
  })
})

describe('the page', () => {
  it('says there is nothing to show before a read, and when a project has no runs', async () => {
    const world = worldOf({})

    expect(words(pageOf(world.state, world.host).tree)).toMatch(/reading workflow runs/)
    await refreshWorkflows(world.state, world.host, true, NOW)
    expect(words(pageOf(world.state, world.host).tree)).toMatch(/No workflow runs for this project/)
  })

  it('says where a workflow is stopped while the control tab is not switched on, with no button for it', async () => {
    const world = worldOf(live())

    await refreshWorkflows(world.state, world.host, true, NOW)

    const { tree } = pageOf(world.state, world.host)

    expect(words(tree)).toMatch(/control tab/)
    expect(buttons(tree).some(el => /stop|message/i.test(String(el.props.label)))).toBe(false)
  })

  it('draws at 40 and 150 columns, with nothing undefined or NaN', async () => {
    const world = worldOf(live())

    await refreshWorkflows(world.state, world.host, true, NOW)
    for (const columns of [40, 80, 150]) expect(words(pageOf(world.state, world.host, columns).tree), `${columns}`).not.toMatch(/undefined|NaN|\[object/)
  })

  it('draws a board slot, a key slot, an action slot and an inspector tab, and a slot that throws costs one line', async () => {
    const world = worldOf(live())
    const spec: ActionSpec = { label: 'do a thing', args: ['agent', 'list'], expect: 'a list' }
    const slots: Slot[] = [
      { kind: 'board', id: 'extra', title: 'Extra', render: env => [env.ctx.kit.Text({ children: `extra for ${env.run?.name}` })] },
      { kind: 'board', id: 'bad', title: 'Bad', render: () => { throw new Error('exploded') } },
      { kind: 'key', id: 'mark', key: 'm', label: 'Mark', run: env => env.ctx.act.workflows.setUi({ run: 0 }) },
      { kind: 'action', id: 'act', label: 'Do', hotkey: 'a', why: 'nothing to do', spec: () => spec },
      { kind: 'tab', id: 'cost', label: 'Cost', render: env => [env.ctx.kit.Text({ children: 'tab body' })] },
    ]

    for (const slot of slots) expect(registerSlot(slot)).toEqual({ ok: true })
    await refreshWorkflows(world.state, world.host, true, NOW)

    const first = pageOf(world.state, world.host)

    expect(words(first.tree)).toMatch(/extra for/)
    expect(words(first.tree)).toMatch(/slot bad failed: exploded/)
    expect(buttonOf(first.tree, 'wf-key-mark')?.props.hotkey).toBe('m')
    ;(buttonOf(first.tree, 'wf-act-act')?.props.onPress as (() => void) | undefined)?.()
    expect(asked).toEqual([{ spec, why: 'nothing to do' }])
    // The tab shows only while the inspector is open.
    expect(buttonOf(first.tree, 'wf-tab-cost')).toBeUndefined()

    world.state.wf.ui = { ...world.state.wf.ui, column: 'agents', isInspecting: true }

    const open = pageOf(world.state, world.host)

    expect(buttonOf(open.tree, 'wf-tab-cost')).toBeDefined()
    ;(buttonOf(open.tree, 'wf-tab-cost')?.props.onPress as (() => void) | undefined)?.()
    expect(words(pageOf(world.state, world.host).tree)).toMatch(/tab body/)
    expect(world.state.wf.tab).toBe('cost')
    workflowsActions(world.state, world.host, {} as never).tab('nope')
    expect(world.state.wf.tab).toBe(DETAIL_TAB)
  })
})

describe('the slot registry', () => {
  const board = (id: string, order?: number): Slot => ({ kind: 'board', id, title: id, ...(order !== undefined && { order }), render: () => [] })

  it('refuses a malformed id, a repeated id, a function-less slot and the inspector\'s own tab, saying why', () => {
    expect(registerSlot(board('Bad Id'))).toMatchObject({ ok: false })
    expect(registerSlot(board('one'))).toEqual({ ok: true })
    expect(registerSlot(board('one'))).toMatchObject({ ok: false, why: expect.stringContaining('already registered') })
    expect(registerSlot({ kind: 'board', id: 'nofn', title: 'x' } as never)).toMatchObject({ ok: false })
    expect(registerSlot({ kind: 'tab', id: 'detail', label: 'x', render: () => [] })).toMatchObject({ ok: false })
    expect(registerSlot(null as never)).toMatchObject({ ok: false })
    expect(registerSlot({ kind: 'board', id: 'notitle', title: ' ', render: () => [] })).toMatchObject({ ok: false })
    expect(registerSlot({ kind: 'action', id: 'nowhy', label: 'x', why: '', spec: () => null })).toMatchObject({ ok: false })
  })

  it('refuses a hotkey the page owns, a malformed one, and one another slot holds', () => {
    for (const key of ['p', 'x', 'r', 'h', 'y', 'n', 'j', 'k', 'l', 'b', 'd', 'o', 'u', 'i']) expect(registerSlot({ kind: 'key', id: `k-${key.charCodeAt(0)}`, key, label: 'x', run: () => undefined }), key).toMatchObject({ ok: false })

    expect(registerSlot({ kind: 'key', id: 'upper', key: 'M', label: 'x', run: () => undefined })).toMatchObject({ ok: false })
    expect(registerSlot({ kind: 'key', id: 'long', key: 'mm', label: 'x', run: () => undefined })).toMatchObject({ ok: false })
    expect(registerSlot({ kind: 'key', id: 'first', key: 'm', label: 'x', run: () => undefined })).toEqual({ ok: true })
    expect(registerSlot({ kind: 'action', id: 'second', label: 'x', hotkey: 'm', why: 'w', spec: () => null })).toMatchObject({ ok: false, why: expect.stringContaining('taken by slot "first"') })
  })

  it('keeps at most twenty-four slots of a kind (twelve held too few for the merged features), boards ordered by `order` then registration', () => {
    for (let i = 0; i < 24; i += 1) expect(registerSlot(board(`b-${i}`, i === 5 ? 1 : undefined))).toEqual({ ok: true })

    expect(registerSlot(board('b-last'))).toMatchObject({ ok: false })
    expect(slotsFor('board').map(slot => slot.id).slice(0, 3)).toEqual(['b-5', 'b-0', 'b-1'])
    expect(slotsFor('tab')).toEqual([])
  })

  it('cleanRun leaves ids and numbers alone and washes every free-text field', () => {
    const run = buildRun({ id: 'wf_x', dir: '/d', journal: journal(started('a1', 'label sk-abcdefghijklmnopqrstuvwxyz012345', 'Phase'), result('a1', 'ok Bearer abcdefgh12345678')), agents: new Map(), record: null, script: null, nowMs: NOW })
    const cleaned = cleanRun(run)

    expect(JSON.stringify(cleaned)).not.toMatch(/sk-abcdef|abcdefgh12345678/)
    expect(cleaned.id).toBe('wf_x')
    expect(cleaned.total).toBe(run.total)
  })
})

