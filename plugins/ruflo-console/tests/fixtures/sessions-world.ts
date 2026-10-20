/** The shared rig for the session workspace specs (ADR-486): a console state over the synthetic 20-session machine. */
import type { Host } from '../../hooks/host'
import { workspaceOf, sessionActions } from '../../hooks/sessions'
import { newState, type State } from '../../hooks/state'
import type { Actions, Ctx } from '../../hooks/views/common'
import { linesOf, plainKit } from '../../hooks/views/pane'
import { sessionRows } from '../../hooks/views/sessions'
import { CLAUDE, fsOn, HOME, NOW, twentySessions, type Disk } from './sessions-fs'

export const mission = (id: string, state: string, objective: string) => ({ id, objective, state, revision: 1, executionMode: 'x', plan: { revision: 1, taskCount: 0, tasks: [] }, budget: null, evidence: { count: 0, verified: 0 }, executor: null, unresolvedOperations: 0, updatedAtMs: NOW - 1000 })

export function world(opts: { disk?: Disk; tokens?: Record<string, string>; tail?: boolean } = {}) {
  const made = opts.disk === undefined ? twentySessions() : { disk: opts.disk, tokens: opts.tokens ?? {} }
  const state: State = newState({})
  const stored = new Map<string, unknown>()
  const spawned: string[] = []

  state.cwd = '/work/repo-a'
  state.home = HOME
  state.configDir = CLAUDE
  state.view = 'room'
  // The Sessions section starts folded; the specs look inside it.
  state.sections.add('room/sessions')
  state.pane.isOpen = true
  state.pane.isShown = true
  state.snapshot = { missions: { observedAtMs: NOW, isTruncated: false, missions: [mission('m1', 'awaitingAuthorization', 'ship TOKM1X'), mission('m2', 'completed', 'done TOKM2X')] }, agents: [{ id: 'a1', type: 'coder', name: 'worker-one', status: 'failed' }], claims: [] } as unknown as State['snapshot']

  const host = {
    fs: fsOn(made.disk, opts.tail !== false),
    invalidate: () => undefined,
    storeSet: async (key: string, value: unknown) => void stored.set(key, value),
    storeGet: async (key: string) => stored.get(key),
    run: async (argv: readonly string[]) => (spawned.push(argv.join(' ')), Promise.reject(new Error('no process'))),
    spawn: (argv: readonly string[]) => (spawned.push(argv.join(' ')), Promise.reject(new Error('no process'))),
  } as unknown as Host

  workspaceOf(state).viewed = { baselineMs: NOW - 3_600_000, seen: {} }

  return { ...made, state, host, stored, spawned }
}

export const ctxOf = (state: State, host: Host, extra: Partial<Ctx> = {}): Ctx => ({ kit: plainKit(), state, nowMs: NOW, columns: 140, pictures: new Map(), act: { sessions: sessionActions(state, host), view: () => undefined, room: new Proxy({}, { get: () => () => undefined }) } as unknown as Actions, ...extra })
export const drawn = (state: State, host: Host, extra: Partial<Ctx> = {}): string => {
  const out: string[] = []

  for (const element of sessionRows(ctxOf(state, host, extra))) linesOf(element, out)

  return out.join('\n')
}

