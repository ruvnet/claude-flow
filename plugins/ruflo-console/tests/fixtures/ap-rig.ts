/**
 * The in-memory disk, fake host and state the autopilot's live specs share (ap-live.spec.ts, ap-review.spec.ts): no engine, no clock.
 */
import { mcOf, type MissionRecord } from '../../hooks/mission-control'
import { seal, type Envelope } from '../../hooks/data/ap-envelope'
import { encodeLine, JOURNAL_FILE, parseJournal, type JournalEvent } from '../../hooks/data/ap-journal'
import type { TaskRecord } from '../../hooks/data/parse'
import type { Host } from '../../hooks/host'
import { newState, type State } from '../../hooks/state'
import type { Ctx, Kit } from '../../hooks/views/common'
import type { SlotEnv } from '../../hooks/views/wf-slots'

export const CWD = '/w'
export const T0 = Date.parse('2026-10-06T00:00:00.000Z')
export const J = `${CWD}/${JOURNAL_FILE}`
export const E = `${CWD}/.claude-flow/console/autopilot/envelope.json`
export const KILL = `${CWD}/.claude-flow/console/autopilot/KILL`

export const ENV: Envelope = { name: 'night', toolClasses: ['edit', 'read', 'test'], paths: [CWD], repos: [], network: [], secretEnv: [], spend: { hourUsd: 2, dayUsd: 10, totalUsd: 40 }, concurrency: 1, maxDurationMs: 7 * 86_400_000, verify: [['true']], acceptWithoutAnatole: true }

export type Rig = { files: Map<string, string>; runs: string[][]; prompts: string[]; toasts: string[]; host: Host; failVerify: { on: boolean } }

export function rig(): Rig {
  const files = new Map<string, string>()
  const runs: string[][] = []
  const prompts: string[] = []
  const toasts: string[] = []
  const failVerify = { on: false }

  const host = {
    fs: {
      read: async (p: string) => files.get(p) ?? Promise.reject(new Error('ENOENT')),
      stat: async (p: string) => (files.has(p) ? { mtimeMs: 1, size: (files.get(p) as string).length, kind: 'file', isLink: false } : [...files.keys()].some(k => k.startsWith(`${p}/`)) ? { kind: 'dir', isLink: false } : Promise.reject(new Error('ENOENT'))),
      list: async () => [],
    },
    run: async (argv: readonly string[], _t: number, stdin?: string) => {
      runs.push([...argv])

      if (argv[0] === 'dd') {
        const path = (argv.find(a => a.startsWith('of=')) as string).slice(3)

        files.set(path, argv.includes('oflag=append') ? `${files.get(path) ?? ''}${stdin ?? ''}` : (stdin ?? ''))
      } else if (argv[0] === 'install') {
        const path = argv.at(-1) as string

        files.set(path, argv.includes('/dev/null') ? '' : (stdin ?? ''))
      } else if (argv[0] === 'rm') files.delete(argv.at(-1) as string)
      else if (argv[0] === 'cp') files.set(argv.at(-1) as string, files.get(argv.at(-2) as string) ?? '')
      else if (argv[0] === 'true' || argv[0] === 'false') return { exitCode: failVerify.on ? 1 : 0, stdout: '', stderr: '' }

      return { exitCode: 0, stdout: '', stderr: '' }
    },
    invalidate: () => undefined,
    toast: (t: string) => void toasts.push(t),
    every: () => ({ cancel: () => undefined }),
    after: () => ({ cancel: () => undefined }),
    storeSet: async () => undefined,
    submitPrompt: async (t: string) => void prompts.push(t),
  } as unknown as Host

  return { files, runs, prompts, toasts, host, failVerify }
}

export const task = (id: string, status: string): TaskRecord => ({ id, type: 'feature', description: '', status, assignedTo: [], tags: [] })

export const mission = (): MissionRecord => ({
  id: 'msn_0123456789abcdef01234567', objective: 'tidy the parser', profile: 'feature', rigor: 'standard',
  tasks: [
    { id: 't1', title: 'Fix the parser bug', phase: 'S', agent: 'coder', requirement: 'tests pass', dependsOn: [], rufloTaskId: 'r1' },
    { id: 't2', title: 'Publish the package to npm', phase: 'A', agent: 'coder', requirement: 'it is published', dependsOn: [], rufloTaskId: 'r2' },
    { id: 't3', title: 'Review the module', phase: 'P', agent: 'coder', requirement: 'a summary', dependsOn: [], rufloTaskId: 'r3' },
  ],
  acceptance: [], events: [], paused: false, cancelled: false, auto: false, createdAtMs: 1,
})

export function stateWith(tasks: TaskRecord[], anatole: 'on' | 'off' | 'absent' = 'on'): State {
  const state = newState({})

  state.cwd = CWD
  state.snapshot = { tasks, agents: [], claims: [], swarm: null, plugins: { missingFromClone: [], installed: [] }, alerts: [], anatole: anatole === 'absent' ? undefined : { present: true, status: { mode: anatole === 'on' ? 'notify' : 'off' }, modeOverride: null, overrides: {}, alerts: [], refused: [], badAlerts: 0 } } as never
  mcOf(state).missions.set('msn_0123456789abcdef01234567', mission())
  mcOf(state).active = 'msn_0123456789abcdef01234567'

  return state
}

/** Seeds an approved, started autopilot on the rig's disk. */
export function started(r: Rig, extra: JournalEvent[] = []): void {
  const sealed = seal(ENV, 1, T0)

  r.files.set(E, JSON.stringify(sealed))
  r.files.set(J, [{ t: 'start', at: T0, envHash: sealed.hash, revision: 1, anatole: 'on' } as JournalEvent, ...extra].map(encodeLine).join(''))
}

export const kit = { Box: (props: Record<string, unknown>) => ({ kind: 'Box', props }), Text: (props: Record<string, unknown>) => ({ kind: 'Text', props }), Button: (props: Record<string, unknown>) => ({ kind: 'Button', props }) } as unknown as Kit
export const ctxOf = (state: State, nowMs: number): Ctx => ({ kit, state, nowMs, columns: 120, pictures: new Map(), act: {} as never })

export type El = { kind: string; props: Record<string, unknown> }

export const flat = (node: unknown, out: El[] = []): El[] => {
  if (Array.isArray(node)) node.forEach(child => flat(child, out))
  else if (typeof node === 'object' && node !== null) {
    out.push(node as El)
    flat((node as El).props?.children, out)
  }

  return out
}

export const words = (tree: unknown): string => flat(tree).filter(el => el.kind === 'Text' && typeof el.props.children === 'string').map(el => el.props.children as string).join('\n')
export const buttons = (tree: unknown): string[] => flat(tree).filter(el => el.kind === 'Button').map(el => String(el.props.label))
export const envOf = (state: State, nowMs: number): SlotEnv => ({ ctx: ctxOf(state, nowMs), runs: [], run: null, phase: null, agent: null, ui: {} as never, nowMs })
export const journal = (r: Rig): JournalEvent[] => parseJournal(r.files.get(J) ?? '').events

