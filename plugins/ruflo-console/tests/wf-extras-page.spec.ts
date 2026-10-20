/**
 * The three Workflows extras (worktrees, templates, Anatole) on the real page (ADR-463): all register through the seams with no
 * refusal, the page draws their boards, buttons and tab, and the page's own refresh drives their reads. Run with
 *   npx vitest run plugins/ruflo-console/tests/wf-extras-page.spec.ts --testTimeout=30000
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest'

import type { ActionSpec } from '../hooks/actions'
import type { WorkflowFs } from '../hooks/data/workflows-read'
import type { Host } from '../hooks/host'
import { newState } from '../hooks/state'
import { workflowsActions } from '../hooks/wf-actions'
import { refreshWorkflows } from '../hooks/wf-live'
import type { Actions, Ctx, Kit } from '../hooks/views/common'
import { workflowsPage } from '../hooks/views/wf-page'
import { registerSlot, resetSlots, slotsFor } from '../hooks/views/wf-slots'
import { registerAnatoleSlots, resetAnatole, wireWfAnatole } from '../hooks/views/wf-anatole'
import { clock, registerWorktreeSlots, resetWorktrees, storeFor, wireWfWorktrees } from '../hooks/views/wf-worktrees'
import { registerTemplateSlots, resetTemplates, wireWfTemplates } from '../hooks/views/wf-templates'
import { journal, meta, started, T0, transcript } from './fixtures/workflows'

const NOW = T0 + 10_000
const CONFIG = '/home/u/.claude'
const SESSION = '11111111-2222-3333-4444-555555555555'
const RUN = `${CONFIG}/projects/-work-proj/${SESSION}/subagents/workflows/wf_live`

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

const words = (tree: unknown): string => flat(tree).filter(el => el.kind === 'Text' && typeof el.props.children === 'string').map(el => el.props.children as string).join('\n')
const hotkeys = (tree: unknown): string[] => flat(tree).filter(el => el.kind === 'Button' && typeof el.props.hotkey === 'string').map(el => el.props.hotkey as string)

const files: Record<string, string> = {
  [`${RUN}/journal.jsonl`]: journal(started('a1', 'build:x', 'Build')),
  [`${RUN}/agent-a1.meta.json`]: meta('build:x', 'Build'),
  [`${RUN}/agent-a1.jsonl`]: transcript([{ at: 5, id: 'm1', input: 1, write: 1, read: 1, output: 1 }]),
}

const fs: WorkflowFs = {
  read: async path => files[path] ?? Promise.reject(new Error('ENOENT')),
  stat: async path => (files[path] !== undefined ? { mtimeMs: T0, size: files[path].length, kind: 'file' } : Promise.reject(new Error('ENOENT'))),
  list: async dir => {
    const names = [...new Set(Object.keys(files).filter(path => path.startsWith(`${dir}/`)).map(path => path.slice(dir.length + 1).split('/')[0] as string))]

    return names.length === 0 ? Promise.reject(new Error('ENOENT')) : names.map(name => ({ name, mtimeMs: T0, size: 1 }))
  },
}

describe('the extras on the page', () => {
  const state = newState({})
  const gitCalls: string[] = []
  const host = { fs, invalidate: () => undefined, run: async (argv: readonly string[]) => (gitCalls.push(argv.join(' ')), { stdout: '', stderr: 'fatal', exitCode: 128 }), submitPrompt: async () => undefined } as unknown as Host
  const asked: (ActionSpec | null)[] = []

  const page = (columns = 120) => {
    const runner = { ask: (spec: ActionSpec | null) => void asked.push(spec) }
    const act = { workflows: workflowsActions(state, host, runner as never) } as unknown as Actions

    return workflowsPage({ kit, state, nowMs: NOW, columns, pictures: new Map(), act } as Ctx)
  }

  beforeEach(async () => {
    resetSlots()
    registerWorktreeSlots()
    registerTemplateSlots()
    registerAnatoleSlots()
    state.view = 'workflows'
    state.configDir = CONFIG
    state.cwd = '/work/proj'
    state.isInteractive = false
    clock.now = () => NOW
    wireWfWorktrees(state, host)
    wireWfTemplates(state, host)
    wireWfAnatole(state, host)
    await refreshWorkflows(state, host, true, NOW)
    await new Promise(done => setTimeout(done, 20))
  })

  afterEach(() => {
    resetSlots()
    resetWorktrees(state)
    resetTemplates(state)
    resetAnatole(state)
    clock.now = () => Date.now()
    gitCalls.length = 0
  })

  it('registers every slot without a refusal, on keys the page does not own', () => {
    expect(slotsFor('board').map(s => s.id)).toEqual(['worktrees', 'templates', 'anatole'])
    expect(slotsFor('key').map(s => s.id).sort()).toEqual(['wf-template-next', 'wt-read'])
    expect(slotsFor('action').map(s => s.id).sort()).toEqual(['wf-template-launch', 'wt-clean'])
    expect(registerSlot({ kind: 'key', id: 'again', key: 'w', label: 'x', run: () => undefined })).toMatchObject({ ok: false })
  })

  it('draws the three boards under the run board, with the extras row and the page\'s own stop-and-message note', () => {
    const tree = page()
    const text = words(tree)

    expect(text).toContain('Worktrees (read-only list; one confirm-gated removal)')
    expect(text).toContain('Workflow templates (dry run, then a confirmed launch)')
    expect(text).toContain('Project Anatole, per agent (reported by the mod)')
    expect(hotkeys(tree)).toEqual(expect.arrayContaining(['w', 't', 'c', 'g']))
    expect(text).toContain('control tab')
  })

  it('the page\'s read drives the worktree read once, never the process check, and a failing git is a line, not a crash', () => {
    expect(gitCalls.length).toBeGreaterThan(0)
    expect(gitCalls.every(call => call.startsWith('git -C /work/proj worktree list'))).toBe(true)
    expect(storeFor(state).error).toMatch(/git did not list/)
    expect(words(page())).toMatch(/the last read failed \(git did not list the worktrees/)
  })

  it('the clean button says why when there is nothing to remove; the launch button asks with the prompt', () => {
    const tree = page()
    const buttons = flat(tree).filter(el => el.kind === 'Button')
    const press = (key: string) => (buttons.find(b => b.props.key === key)?.props.onPress as () => void)()

    press('wf-act-wt-clean')
    press('wf-act-wf-template-launch')
    expect(asked[0]).toBeNull()
    expect(asked[1]?.label).toMatch(/^launch workflow template Review \(7 agents, 4 phases\)/)
  })

  it('narrow screens still draw without throwing', () => expect(() => page(60)).not.toThrow())
})
