/**
 * A real console for the model-control tests: the real controller, runner, palette and model tools, with only the engine (Host) faked. The
 * fake records every argv, slash command and prompt that would have run, so a test can say "nothing reached the network / no turn started".
 * Every CLI run answers asynchronously, as the real one does, so an AIDefence screen lands after Claude's tool call has returned.
 */
import { createController } from '../../hooks/controller'
import type { Host } from '../../hooks/host'
import { mcOf, type MissionRecord } from '../../hooks/mission-control'
import type { ModelToolDeps } from '../../hooks/model-tools'
import { settingsOf } from '../../hooks/settings'
import { newState, type State } from '../../hooks/state'

export type Recorded = { runs: string[][]; slash: string[][]; prompts: string[] }

/** `openPane` replaces the pane opener, so a test can hold `console_open` open while something else (a screened ask) lands. */
export function liveConsole(level: 'read' | 'write' | 'manage' | 'full', confirm: 'ask' | 'auto' = 'ask', fakes: { openPane?: () => Promise<unknown> } = {}) {
  const log: Recorded = { runs: [], slash: [], prompts: [] }
  const host = new Proxy(
    {},
    {
      get: (_target, key) => {
        if (key === 'after' || key === 'every') return () => ({ cancel: () => undefined, fire: () => undefined })
        if (key === 'pluginRoot') return '/plugin'
        if (key === 'fs') return { read: async () => Promise.reject(new Error('ENOENT')), stat: async () => Promise.reject(new Error('ENOENT')), list: async () => Promise.reject(new Error('ENOENT')) }
        if (key === 'run') return async (argv: readonly string[]) => (log.runs.push([...argv]), { exitCode: 0, stdout: '{"success":true}', stderr: '', isStdoutTruncated: false, isStderrTruncated: false })
        if (key === 'runSlash') return async (command: string, args: string) => void log.slash.push([command, args])
        if (key === 'submitPrompt') return async (text: string) => void log.prompts.push(text)
        if (key === 'fillPrompt') return async () => true
        if (key === 'storeGet') return async () => undefined
        if (key === 'openPane') return async () => (await fakes.openPane?.(), { isPlaced: true })
        if (key === 'invalidate' || key === 'scrollTop' || key === 'blit' || key === 'toast') return () => undefined

        return () => Promise.resolve(undefined)
      },
    },
  ) as unknown as Host
  const state = newState({})
  const control = createController(state, host)

  Object.assign(settingsOf(state).ai, { modelControl: level, modelConfirm: confirm })

  return { state, control, host, log, deps: { state, control } as unknown as ModelToolDeps }
}

/** Lets the console's un-awaited promises (an AIDefence screen, a loader) settle. */
export async function flush(): Promise<void> {
  for (let i = 0; i < 30; i += 1) await new Promise(resolve => setImmediate(resolve))
}

export const MISSION_ID = `msn_${'a'.repeat(24)}`

/** An active mission with one ready task, so auto-run has something to hand out. */
export function withMission(state: State): MissionRecord {
  const mission: MissionRecord = {
    id: MISSION_ID, objective: 'add a dark mode toggle', profile: 'feature', rigor: 'standard',
    tasks: [{ id: 't1', title: 'Specify', phase: 'S', agent: 'specification', requirement: 'a spec', dependsOn: [], rufloTaskId: 'r1' }],
    acceptance: [], events: [], paused: false, cancelled: false, auto: false, createdAtMs: 1_000,
  }

  state.snapshot = { tasks: [{ id: 'r1', type: 'feature', description: '', status: 'pending', assignedTo: [], tags: [`mission:${MISSION_ID}`, 'task:t1'] }], agents: [], claims: [], swarm: null, plugins: { missingFromClone: [], installed: [] }, alerts: [] } as never
  mcOf(state).missions.set(mission.id, mission)
  mcOf(state).active = mission.id

  return mission
}

/** The argv that reach the network: x.ruv.io and federation reads, and `npx skills`. */
export const networkRuns = (runs: string[][]): string[][] => runs.filter(argv => argv.some(arg => /x_federation|federation/.test(arg)) || (argv[0] === 'npx' && argv.includes('skills')))
