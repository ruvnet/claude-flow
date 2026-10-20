/** In-memory disk, fake host and mission fixtures shared by the security audit specs. */
import { seal, type Envelope } from '../../hooks/data/ap-envelope'
import { encodeLine, JOURNAL_FILE, parseJournal, type JournalEvent } from '../../hooks/data/ap-journal'
import type { TaskRecord } from '../../hooks/data/parse'
import type { Host } from '../../hooks/host'
import { mcOf, type MissionRecord } from '../../hooks/mission-control'
import { newState, type State } from '../../hooks/state'
import { storeOf } from '../../hooks/ap-live'
import type { Ctx, Kit } from '../../hooks/views/common'
import type { SlotEnv } from '../../hooks/views/wf-slots'

export const CWD = '/w'
export const T0 = Date.parse('2026-10-06T00:00:00.000Z')
export const AP = `${CWD}/.claude-flow/console/autopilot`
export const J = `${CWD}/${JOURNAL_FILE}`
export const E = `${AP}/envelope.json`
export const KILL = `${AP}/KILL`
export const ENV: Envelope = { name: 'night', toolClasses: ['edit', 'read', 'test'], paths: [CWD], repos: [], network: [], secretEnv: [], spend: { hourUsd: 2, dayUsd: 10, totalUsd: 40 }, concurrency: 4, maxDurationMs: 7 * 86_400_000, verify: [['true']], acceptWithoutAnatole: true }

export type Rig = { files: Map<string, string>; runs: string[][]; prompts: string[]; host: Host; onRun: { fn: ((argv: readonly string[]) => void) | null }; onAppend: { fn: ((text: string) => string) | null } }

export function rig(): Rig {
  const files = new Map<string, string>()
  const runs: string[][] = []
  const prompts: string[] = []
  const onRun: Rig['onRun'] = { fn: null }
  const onAppend: Rig['onAppend'] = { fn: null }

  const host = {
    fs: {
      read: async (p: string) => files.get(p) ?? Promise.reject(new Error('ENOENT')),
      stat: async (p: string) => (files.has(p) ? { mtimeMs: 1, size: (files.get(p) as string).length, kind: 'file', isLink: false } : [...files.keys()].some(k => k.startsWith(`${p}/`)) ? { kind: 'dir', isLink: false } : Promise.reject(new Error('ENOENT'))),
      list: async () => [],
    },
    run: async (argv: readonly string[], _t: number, stdin?: string) => {
      runs.push([...argv])
      onRun.fn?.(argv)

      if (argv[0] === 'dd') {
        const path = (argv.find(a => a.startsWith('of=')) as string).slice(3)
        const add = argv.includes('oflag=append') && onAppend.fn !== null ? onAppend.fn(stdin ?? '') : (stdin ?? '')

        files.set(path, argv.includes('oflag=append') ? `${files.get(path) ?? ''}${add}` : (stdin ?? ''))
      } else if (argv[0] === 'install') files.set(argv.at(-1) as string, argv.includes('/dev/null') ? '' : (stdin ?? ''))
      else if (argv[0] === 'rm') files.delete(argv.at(-1) as string)
      else if (argv[0] === 'cp') files.set(argv.at(-1) as string, files.get(argv.at(-2) as string) ?? '')

      return { exitCode: 0, stdout: '', stderr: '' }
    },
    invalidate: () => undefined,
    toast: () => undefined,
    every: () => ({ cancel: () => undefined }),
    after: () => ({ cancel: () => undefined }),
    storeSet: async () => undefined,
    submitPrompt: async (t: string) => void prompts.push(t),
  } as unknown as Host

  return { files, runs, prompts, host, onRun, onAppend }
}

export const task = (id: string, status: string): TaskRecord => ({ id, type: 'feature', description: '', status, assignedTo: [], tags: [] })

export const mission = (): MissionRecord => ({
  id: 'msn_0123456789abcdef01234567', objective: 'tidy the parser', profile: 'feature', rigor: 'standard',
  tasks: [
    { id: 't1', title: 'Fix the parser bug', phase: 'S', agent: 'coder', requirement: 'tests pass', dependsOn: [], rufloTaskId: 'r1' },
    { id: 't2', title: 'Update the changelog', phase: 'A', agent: 'coder', requirement: 'a line', dependsOn: [], rufloTaskId: 'r2' },
    { id: 't3', title: 'Review the module', phase: 'P', agent: 'coder', requirement: 'a summary', dependsOn: [], rufloTaskId: 'r3' },
  ],
  acceptance: [], events: [], paused: false, cancelled: false, auto: false, createdAtMs: 1,
})

export function stateWith(tasks: TaskRecord[], anatole: Record<string, unknown> = { mode: 'notify', updatedMs: T0, degraded: false }): State {
  const state = newState({})

  state.cwd = CWD
  state.snapshot = { tasks, agents: [], claims: [], swarm: null, plugins: { missingFromClone: [], installed: [] }, alerts: [], anatole: { present: true, status: anatole, modeOverride: null, overrides: {}, alerts: [], refused: [], badAlerts: 0 } } as never
  mcOf(state).missions.set('msn_0123456789abcdef01234567', mission())
  mcOf(state).active = 'msn_0123456789abcdef01234567'

  return state
}

export function started(r: Rig, extra: JournalEvent[] = [], env: Envelope = ENV): void {
  const sealed = seal(env, 1, T0)

  r.files.set(E, JSON.stringify(sealed))
  r.files.set(J, [{ t: 'start', at: T0, envHash: sealed.hash, revision: 1, anatole: 'on' } as JournalEvent, ...extra].map(encodeLine).join(''))
}

export const journal = (r: Rig): JournalEvent[] => parseJournal(r.files.get(J) ?? '').events
export const kit = { Box: (props: Record<string, unknown>) => ({ kind: 'Box', props }), Text: (props: Record<string, unknown>) => ({ kind: 'Text', props }), Button: (props: Record<string, unknown>) => ({ kind: 'Button', props }) } as unknown as Kit
export const envOf = (state: State, nowMs: number): SlotEnv => ({ ctx: { kit, state, nowMs, columns: 120, pictures: new Map(), act: {} as never } as Ctx, runs: [], run: null, phase: null, agent: null, ui: {} as never, nowMs })
export const ready = (state: State, nowMs: number): void => { storeOf(state).spend = { hourUsd: 0, dayUsd: 0, totalUsd: 0 }; storeOf(state).spendAtMs = nowMs; storeOf(state).adaptAtMs = nowMs }
export const settle = async (state: State): Promise<void> => { while (storeOf(state).isTicking) await new Promise(resolve => setTimeout(resolve, 1)) }
export const dangling = (id = 's-dangling00001'): JournalEvent => ({ t: 'step.started', at: T0 + 10, id, task: 't1', cls: 'edit', attempt: 1, deadline: T0 + 1e9, tier: 'mid' })

