/**
 * The fake `ruflo mcp exec` for the mission-create specs. Its output is REAL: tests/fixtures/mcp-exec holds transcripts captured from ruflo
 * 3.56.1 in a scratch project (the lock timeout induced by holding .claude-flow/policy/state.lock), and every answer here is one of them
 * with its Parameters line and its Result swapped for the call's: `Parameters:` on stdout before any `Result:`, `[INFO]`/`[ERROR]` on stderr.
 */
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

import type { ActionSpec } from '../../hooks/actions'
import { PROJECT } from '../../hooks/data/files'
import type { Host } from '../../hooks/host'
import { READ_MS } from '../../hooks/mission-create'
import { createSpec, mcOf, setGoal } from '../../hooks/mission-control'
import { newState, type State } from '../../hooks/state'

export type Run = { exitCode: number; stdout: string; stderr: string }

const FIXTURES = join(__dirname, 'mcp-exec')
/** A transcript exactly as the CLI printed it. */
export const real = (name: string): Run => ({ stdout: readFileSync(join(FIXTURES, `${name}.out`), 'utf8'), stderr: readFileSync(join(FIXTURES, `${name}.err`), 'utf8'), exitCode: Number(readFileSync(join(FIXTURES, `${name}.code`), 'utf8').trim()) })

/** The real success transcript of `tool`, its Parameters line and its Result swapped for this call's (the layout byte for byte). */
export function answer(params: unknown, result: unknown, tool: string, base = real('t-ok')): Run {
  return {
    exitCode: 0,
    stdout: base.stdout.replace(/^( {2}Parameters: ).*$/m, `$1${JSON.stringify(params)}`).replace(/(\nResult:\n)[\s\S]*$/, `$1${JSON.stringify(result, null, 2)}\n`),
    stderr: base.stderr.replace(/task_create/g, tool),
  }
}

/** The real lock-timeout transcript for this call. */
export function locked(params: unknown, tool: string): Run {
  const base = real('t-lock')

  return { exitCode: base.exitCode, stdout: base.stdout.replace(/^( {2}Parameters: ).*$/m, `$1${JSON.stringify(params)}`), stderr: base.stderr.replace(/task_create/g, tool) }
}

export const ID = 'msn_0123456789abcdef01234567'
/** A try whose answer was lost: the process exited non-zero and printed nothing (transient). */
export const LOST: Run = { exitCode: 1, stdout: '', stderr: '' }
export const isOk = (result: Record<string, unknown>) => typeof result.taskId === 'string'

export type Store = Record<string, { taskId: string; type: string; description: string; status: string; tags: string[]; assignedTo: string[]; createdAt: string }>
export type World = { runs: { tool: string; params: Record<string, unknown> }[]; waits: number[]; store: Store; mission: string; onWait?: () => void; unreadable?: boolean }
export type Special = (tool: string, params: Record<string, unknown>, nth: number, world: World) => Run | Error | Promise<Run | undefined> | undefined

/** A CLI that answers in the real transcripts' layout; task_create writes the store the console reads back, the mission cancel the observation. */
export function hostOf(world: World, special: Special = () => undefined): Host {
  let made = 0
  const seen = new Map<string, number>()
  const make = (params: Record<string, unknown>, taskId = `task-${++made}`) => {
    world.store[taskId] = { taskId, type: String(params.type), description: String(params.description), status: 'pending', tags: params.tags as string[], assignedTo: [], createdAt: new Date().toISOString() }

    return taskId
  }

  return {
    run: async (argv: readonly string[]) => {
      const tool = argv[argv.indexOf('-t') + 1] as string
      const params = JSON.parse(argv[argv.indexOf('-p') + 1] as string) as Record<string, unknown>
      const key = tool === 'task_create' ? `${tool}:${String((params.tags as string[])[1])}` : tool === 'task_cancel' ? `${tool}:${String(params.taskId)}` : tool
      const nth = (seen.get(key) ?? 0) + 1

      seen.set(key, nth)
      world.runs.push({ tool, params })

      const out = await special(tool, params, nth, world)

      if (out instanceof Error) throw out
      if (out !== undefined) return out
      if (tool === 'mission_create') return answer(params, { ok: true, data: { missionId: ID, revision: 1, state: 'draft', deduplicated: false } }, tool, real('m-create'))
      if (tool === 'mission_plan') return answer(params, { ok: true, data: { missionId: ID, revision: 2, state: 'planned', deduplicated: false, sequence: 2, planDigest: 'sha256:abc' } }, tool, real('m-plan-ok'))
      if (tool === 'task_create') {
        const taskId = make(params)

        return answer(params, { ...world.store[taskId], priority: 'normal' }, tool)
      }
      if (tool === 'task_cancel') {
        const task = world.store[String(params.taskId)]

        if (task === undefined) return answer(params, { success: false, taskId: params.taskId, error: 'Task not found' }, tool, real('t-cancel-missing'))
        task.status = 'cancelled'

        return answer(params, { success: true, taskId: params.taskId, status: 'cancelled', cancelledAt: new Date().toISOString() }, tool, real('t-cancel'))
      }
      if (tool === 'mission_request_action') {
        world.mission = 'cancelled'

        return answer(params, { ok: true, data: { missionId: ID, revision: 4, state: 'cancelled', deduplicated: false, sequence: 4 } }, tool, real('m-cancel-ok'))
      }

      return answer(params, { ok: true }, tool)
    },
    fs: {
      read: async (path: string) => {
        if (world.unreadable === true) throw new Error('EACCES')
        if (path.endsWith(PROJECT.tasks)) return JSON.stringify({ tasks: world.store, version: '3.0.0' })
        if (path.endsWith(PROJECT.missions)) return JSON.stringify({ schemaVersion: 1, contract: 'ruflo.mission-observation/1', source: 'ruflo-cli/missions', observedAt: new Date().toISOString(), truncated: false, missions: [{ missionId: ID, objective: 'x', state: world.mission, revision: 4, executionMode: 'session-bound' }] })

        throw new Error('ENOENT')
      },
      stat: async () => undefined,
      list: async () => [],
    },
    // The backoff waits go through the host's clock: recorded, and they return at once (after the test's hook). Read time limits never fire.
    after: (ms: number, fn: () => void) => {
      if (ms === READ_MS) return { cancel: () => undefined }
      world.waits.push(ms)
      world.onWait?.()
      fn()

      return { cancel: () => undefined }
    },
    storeGet: async () => undefined,
    storeSet: async () => undefined,
    invalidate: () => undefined,
  } as unknown as Host
}

export const fresh = (): World => ({ runs: [], waits: [], store: {}, mission: 'planned' })

export function planned(): { state: State; steps: string[] } {
  const state = newState({})

  state.snapshot = { tasks: [], agents: [], claims: [], swarm: null, plugins: { missingFromClone: [] }, alerts: [] } as never
  setGoal(state, 'add a dark mode toggle to settings')

  return { state, steps: (mcOf(state).planned?.steps ?? []).map(step => step.id) }
}

export const creates = (world: World, step?: string) => world.runs.filter(run => run.tool === 'task_create' && (step === undefined || (run.params.tags as string[]).includes(`task:${step}`)))
export const isStep = (params: Record<string, unknown>, step: string | undefined) => (params.tags as string[] | undefined)?.includes(`task:${step}`) === true
export const run = async (state: State, host: Host) => (createSpec(state, host, () => undefined) as ActionSpec).run?.()
