/** Shared fixtures for the advisor specs (ADR-483): a mission, ledger helpers, and a fake host, runner and state wired through claudeActions. */
import type { ActionSpec } from '../../hooks/actions'
import type { TaskRecord } from '../../hooks/data/parse'
import type { Host } from '../../hooks/host'
import { claudeActions } from '../../hooks/mission-claude'
import { activeMission, mcOf, record, type MissionRecord } from '../../hooks/mission-control'
import { tickPlan, type LoopState } from '../../hooks/mission-loop'
import type { Runner } from '../../hooks/runner'
import { DEFAULT_AI, settingsOf } from '../../hooks/settings'
import { newState } from '../../hooks/state'

export const ID = `msn_${'c'.repeat(24)}`
export const task = (id: string, status: string): TaskRecord => ({ id, type: 'feature', description: '', status, assignedTo: [], tags: [`mission:${ID}`, `task:${id.replace('r', 't')}`] })
export const open = [task('r1', 'in_progress'), task('r2', 'pending')]
export const allDone = [task('r1', 'completed'), task('r2', 'completed')]
export const GATE = 'gabc'

export const mission = (): MissionRecord => ({
  id: ID,
  objective: 'add a dark mode toggle',
  profile: 'feature',
  rigor: 'standard',
  tasks: [
    { id: 't1', title: 'Specify', phase: 'S', agent: 'specification', requirement: 'a written specification', dependsOn: [], rufloTaskId: 'r1' },
    { id: 't2', title: 'Design', phase: 'A', agent: 'architecture', requirement: 'a design', dependsOn: ['t1'], rufloTaskId: 'r2' },
  ],
  acceptance: [{ id: 'ac-1', check: 'a specification exists' }],
  events: [],
  paused: false,
  cancelled: false,
  auto: false,
  createdAtMs: 1_000,
})

export const fail = (m: MissionRecord, gate = GATE, taskId = 't1') => record(m, { type: 'evidence.gate', taskId, status: 'failed', evidenceRef: `gate:${gate}:1`, note: 'exit 1, 3 lines of output: 2 failing' })
export const pass = (m: MissionRecord, gate = GATE, taskId = 't1') => record(m, { type: 'evidence.gate', taskId, status: 'passed', evidenceRef: `gate:${gate}:0`, note: 'exit 0' })

export const LOOP: LoopState = { missionId: ID, interval: '5m', startedAtMs: 0, expiresAtMs: 10 ** 12, ticks: 3, lastTickMs: 0, status: 'armed' }
export const NOW = 3_600_000
export const plan = (m: MissionRecord, extra: Record<string, unknown> = {}) => tickPlan({ mission: m, loop: LOOP, prefs: DEFAULT_AI, gatesConfigured: false, spendUsd: null, capUsd: null, nowMs: NOW, taskStatus: new Map([['t1', 'ready'], ['t2', 'waiting']]), ...extra } as never)

const json = (value: unknown) => `${JSON.stringify(value)}\n`
export const ANSWER = [
  { stream: 'stdout' as const, text: json({ type: 'stream_event', event: { type: 'content_block_delta', delta: { type: 'text_delta', text: '## Verdict\nSTOP: the cache key is wrong\n## Next\nFix it.' } } }) },
  { stream: 'stdout' as const, text: json({ type: 'result', subtype: 'success', is_error: false, total_cost_usd: 0.1234 }) },
]

export function rig(options: { exitFor?: (argv: readonly string[]) => number } = {}) {
  const log = { spawns: [] as { argv: readonly string[]; input?: string }[], fills: [] as string[], submits: [] as string[], toasts: [] as string[], runs: [] as (readonly string[])[], stored: new Map<string, unknown>() }
  const host = {
    run: async (argv: readonly string[]) => {
      log.runs.push([...argv])

      return { exitCode: options.exitFor?.(argv) ?? (argv.includes('fail') ? 2 : 0), stdout: argv[0] === 'git' ? '' : 'out\n', stderr: '' }
    },
    spawn: (argv: readonly string[], input?: string) => {
      log.spawns.push({ argv, ...(input !== undefined && { input }) })

      const stream = (async function* () {
        for (const chunk of ANSWER) yield chunk

        return { code: 0, signal: null }
      })()

      return Object.assign(stream, { result: Promise.resolve({ code: 0, signal: null }), return: async () => ({ done: true, value: undefined }) }) as never
    },
    storeGet: async (key: string) => log.stored.get(key),
    storeSet: async (key: string, value: unknown) => void log.stored.set(key, value),
    fillPrompt: async (text: string) => (log.fills.push(text), true),
    submitPrompt: async (text: string) => void log.submits.push(text),
    toast: (text: string) => void log.toasts.push(text),
    invalidate: () => undefined,
    after: () => ({ cancel: () => undefined }),
  } as unknown as Host
  const asked: ActionSpec[] = []
  const runner = { ask: (spec: ActionSpec | null) => void (spec !== null && asked.push(spec)) } as unknown as Runner
  const state = newState({})

  state.snapshot = { tasks: open, agents: [], claims: [], swarm: null, plugins: { missingFromClone: [], installed: [] }, alerts: [] } as never
  state.isInteractive = true
  mcOf(state).missions.set(ID, mission())
  mcOf(state).active = ID
  settingsOf(state).ai.loopGates = 'check fail'

  const actions = claudeActions(state, host, runner)

  return { state, host, log, asked, runner, actions, m: () => activeMission(state) as MissionRecord }
}

export const on = (r: ReturnType<typeof rig>, model: 'default' | 'haiku' | 'sonnet' | 'opus' = 'sonnet') => void Object.assign(settingsOf(r.state).ai, { advisor: true, advisorModel: model })
/** The Verify button, confirmed: the gates run (they exit 2: failed) and record evidence. */
export async function runGates(r: ReturnType<typeof rig>): Promise<void> {
  const before = r.asked.length

  r.actions.verify()

  const spec = r.asked.at(before)

  await spec?.run?.()
}
export const settle = () => new Promise(resolve => setTimeout(resolve, 20))

