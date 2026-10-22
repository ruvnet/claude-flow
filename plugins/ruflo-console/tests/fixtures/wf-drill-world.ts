/**
 * The shared world of the drill-down specs (ADR-459): an in-memory disk of a live workflow run, a recording kit, the real page, refresh and
 * actions, and the helpers that press a registered key or click a button by its key. No engine.
 */
import { afterEach, beforeEach, expect } from 'vitest'

import { resetDrillIo } from '../../hooks/data/wf-drill-io'
import { pick } from '../../hooks/data/workflows-nav'
import type { WorkflowFs } from '../../hooks/data/workflows-read'
import type { Host } from '../../hooks/host'
import { newState, type State } from '../../hooks/state'
import { workflowsActions } from '../../hooks/wf-actions'
import { refreshWorkflows, workflowsModelOf } from '../../hooks/wf-live'
import type { Actions, Ctx, Kit } from '../../hooks/views/common'
import { registerDrill } from '../../hooks/views/wf-detail'
import { registerSearch } from '../../hooks/views/wf-search'
import { resetSlots, slotsFor, type SlotEnv } from '../../hooks/views/wf-slots'
import { workflowsPage } from '../../hooks/views/wf-page'
import { line, sample, use } from './wf-drill'
import { journal, meta, started, T0 } from './workflows'

export const NOW = T0 + 10_000
export const CONFIG = '/home/u/.claude'
export const ROOT = `${CONFIG}/projects/-work-proj`
export const SESSION = '11111111-2222-3333-4444-555555555555'
export const RUN = `${ROOT}/${SESSION}/subagents/workflows/wf_live`
export const WT = '/work/proj/.claude/worktrees/agent-a1'

export type El = { kind: string; props: Record<string, unknown> }

export const kit = { Box: (props: Record<string, unknown>): El => ({ kind: 'Box', props }), Text: (props: Record<string, unknown>): El => ({ kind: 'Text', props }), Button: (props: Record<string, unknown>): El => ({ kind: 'Button', props }), Input: (props: Record<string, unknown>): El => ({ kind: 'Input', props }) } as unknown as Kit

export const flat = (node: unknown, out: El[] = []): El[] => {
  if (Array.isArray(node)) node.forEach(child => flat(child, out))
  else if (typeof node === 'object' && node !== null) {
    out.push(node as El)
    flat((node as El).props?.children, out)
  }

  return out
}

export const words = (tree: unknown): string => flat(tree).filter(el => el.kind === 'Text' && typeof el.props.children === 'string').map(el => el.props.children as string).join('\n') + '\n' + flat(tree).filter(el => el.kind === 'Button').map(el => String(el.props.label)).join('\n')
export const buttonOf = (tree: unknown, key: string): El | undefined => flat(tree).find(el => el.kind === 'Button' && el.props.key === key)
export const inputOf = (tree: unknown): El | undefined => flat(tree).find(el => el.kind === 'Input' && el.props.key === 'wf-search')
export const click = (tree: unknown, key: string): void => {
  const button = buttonOf(tree, key)

  if (button === undefined) throw new Error(`no button ${key}`)

  ;(button.props.onPress as () => void)()
}
export const flush = (): Promise<void> => new Promise(done => setTimeout(done, 0))

export function memoryFs(files: Record<string, string>, over: { size?: Record<string, number>; tail?: string } = {}): WorkflowFs & { reads: string[] } {
  const reads: string[] = []
  const under = (dir: string) => [...new Set(Object.keys(files).filter(path => path.startsWith(`${dir}/`)).map(path => path.slice(dir.length + 1).split('/')[0] as string))]

  return {
    reads,
    read: async path => (reads.push(path), files[path] ?? Promise.reject(new Error('ENOENT'))),
    stat: async path => (files[path] !== undefined ? { mtimeMs: T0, size: over.size?.[path] ?? files[path].length, kind: 'file' } : under(path).length > 0 ? { mtimeMs: T0, kind: 'directory' } : Promise.reject(new Error('ENOENT'))),
    list: async dir => {
      const names = under(dir)

      return names.length === 0 ? Promise.reject(new Error('ENOENT')) : names.map(name => ({ name, mtimeMs: T0, size: files[`${dir}/${name}`]?.length }))
    },
    ...(over.tail !== undefined && { readTail: async () => over.tail as string }),
  }
}

export const liveFiles = (over: Record<string, string> = {}): Record<string, string> => ({
  [`${RUN}/journal.jsonl`]: journal(started('a1', 'build:x', 'Build'), started('a2', 'review:x', 'Review')),
  [`${RUN}/agent-a1.meta.json`]: meta('build:x', 'Build', { spawnedWithWorktree: true, worktreePath: WT }),
  [`${RUN}/agent-a1.jsonl`]: sample(WT),
  [`${RUN}/agent-a2.meta.json`]: meta('review:x', 'Review'),
  [`${WT}/.git`]: 'gitdir: x',
  [`${RUN}/agent-a2.jsonl`]: `${line('user', 0, 'review the parser')}\n${line('assistant', 1, [use('r1', 'Grep', { pattern: 'parser' })])}\n`,
  ...over,
})

export type World = { state: State; host: Host; spied: { runs: string[][]; views: string[]; focused: string[] } }

export async function worldOf(files: Record<string, string>, fsOver: Parameters<typeof memoryFs>[1] = {}, run?: (argv: readonly string[]) => Promise<{ exitCode: number; stdout: string; stderr?: string }>): Promise<World> {
  const state = newState({})
  const spied = { runs: [] as string[][], views: [] as string[], focused: [] as string[] }
  const fs = memoryFs(files, fsOver)
  const host = { fs, invalidate: () => undefined, run: async (argv: readonly string[]) => (spied.runs.push([...argv]), run === undefined ? { exitCode: 0, stdout: '' } : run(argv)) } as unknown as Host

  state.view = 'workflows'
  state.configDir = CONFIG
  state.cwd = '/work/proj'
  state.isInteractive = false
  await refreshWorkflows(state, host, true, NOW)

  return { state, host, spied }
}

export function frame(world: World, columns = 110): { tree: unknown; ctx: Ctx; env: SlotEnv } {
  const act = { workflows: workflowsActions(world.state, world.host, { ask: () => undefined } as never), focus: (key: string) => void world.spied.focused.push(key), view: (id: string) => void world.spied.views.push(id) } as unknown as Actions
  const ctx: Ctx = { kit, state: world.state, nowMs: NOW, columns, pictures: new Map(), act }
  const model = workflowsModelOf(world.state, NOW)
  const here = pick(world.state.wf.ui, model?.runs ?? [])

  return { tree: workflowsPage(ctx), ctx, env: { ctx, runs: model?.runs ?? [], run: here.run, phase: here.phase, agent: here.agent, ui: here.ui, nowMs: NOW } }
}

/** Presses a registered key by what it does. */
export const press = (world: World, verb: string): void => void slotsFor('key').find(slot => slot.id === `drill-${verb}`)?.run(frame(world).env)
export const screen = (world: World): string => words(frame(world).tree)

/** Opens the drill and walks it down to the agent's Activity. */
export function toAgent(world: World): void {
  click(frame(world).tree, 'wf-drill-open')
  press(world, 'in')
  press(world, 'in')
}

/** Registers the drill and the search before each test, and forgets everything after. */
export function useDrill(): void {
  beforeEach(() => {
    resetSlots()
    resetDrillIo()
    expect(registerDrill()).toEqual([])
    expect(registerSearch()).toBeNull()
  })
  afterEach(() => {
    resetSlots()
    resetDrillIo()
  })
}
