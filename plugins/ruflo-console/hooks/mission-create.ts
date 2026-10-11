/**
 * Mission Control's create chain: `mission_create`, `mission_plan`, then one `task_create` per plan node, behind one confirm.
 *
 * On a busy project every `mcp exec` waits on the policy state lock and some fail with `policy-state-lock-timeout` (#3164, #3892). A step that
 * failed that way (or got no answer in time, or printed nothing at all) is tried again after RETRY_WAITS_MS; any other failure is final.
 * `task_create` has no request id, so after each wait, just before trying again, the task store is read: one task that is exactly this step's
 * (its description and both tags, open) is a late success and is used; more than one stops the chain (it never guesses); a store that cannot
 * be read stops a retry whose first try may have written; and after the last failed try the store is read once more (the last try's write
 * may have landed with its answer lost). Provenance is the mission id: the step's description and tag carry the id this create was just
 * given, so no older task can match; the time window (SKEW_MS) only keeps out a stale store and is wide for clock skew.
 *
 * Time is strict: no call, wait or read starts after its deadline, each is cut to the time left, and a call the host never answers is let go
 * at that time (the CLI process may still finish: the report says so). When the create cannot finish, every open task tagged with this
 * mission in the store (not only those whose create was acknowledged) is cancelled with the same retries, the mission record is asked to
 * cancel, and the store and the mission observation are READ BACK: the result says what they show, not what was asked.
 */
import type { ActionSpec, RunReport } from './actions'
import { taskStatusOf } from './data/automate'
import { PROJECT, under } from './data/files'
import { readAttempt, type Attempt, type RunRead } from './data/mcp-run'
import { parseMissions } from './data/missions'
import { parseTasks, plain, recordOf, type TaskRecord } from './data/parse'
import { stageOf, toMissionPlan, type Profile } from './goap'
import { checkLimit, MISSION_OBJECTIVE_MAX } from './full-text'
import type { Host } from './host'
import { mcOf, record, saveLedger } from './mission-control'
import type { LedgerTask, MissionRecord } from './mission-types'
import { CLI_PREFIXES, type State } from './state'

export const argvOf = (state: State, tool: string, params: unknown): string[] => [...CLI_PREFIXES[state.options.cli], 'mcp', 'exec', '-t', tool, '-p', JSON.stringify(params)]

export const taskType = (profile: Profile) => (profile === 'bugfix' ? 'bugfix' : profile === 'refactor' ? 'refactor' : profile === 'research' ? 'research' : 'feature')

/**
 * Why the mission cannot be created from this goal, or null: the ruflo mission record takes an objective of at most MISSION_OBJECTIVE_MAX
 * characters (mission_create's input schema), and the goal is never cut to fit (ADR-481). Checked before the ask, with the exact count.
 */
export function createWhy(state: State): string | null {
  const goal = mcOf(state).goal
  const fit = checkLimit(goal, MISSION_OBJECTIVE_MAX, 'the goal', 'the ruflo mission record takes at most that many; planning, guidance and the skills use the whole goal', 'No mission was created; ✎ edit the goal to fit.')

  return fit.ok ? null : fit.message
}

/** The waits before a step that failed for a transient reason is tried again: up to three more tries, 1, 2 and 4 s apart. */
export const RETRY_WAITS_MS: readonly number[] = [1_000, 2_000, 4_000]
/** No create step starts after this long; what was made is then undone. */
export const CREATE_DEADLINE_MS = 180_000
/** Undoing (cancels, the mission cancel, the read-back) gets this long on top; past it, no step is retried. */
export const CLEANUP_BUDGET_MS = 120_000
/** One read of the task store or the mission observation may take this long. */
export const READ_MS = 5_000
/** One CLI call may take this long (less when the deadline is nearer). */
export const CALL_MS = 60_000
/** A store task this much older than the create can still be its late success: the mission id binds it; this only allows for clock skew. */
export const SKEW_MS = 5 * 60_000
/** The host's own process limit is set this much past the caller's, so the caller's (structured) time limit is the one that ends a wait. */
const HOST_GRACE_MS = 2_000

/** The creates running now, per console, with when each started: a second create is refused while one runs. */
const creating = new WeakMap<State, number>()

export const isCreating = (state: State): boolean => creating.has(state)

const nonce = (): string => `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`

const pause = (host: Host, ms: number): Promise<void> =>
  new Promise(resolve => {
    try {
      host.after(ms, () => resolve())
    } catch {
      resolve()
    }
  })

/** `work`, or `late` once `ms` have passed without it settling (a timer of this module, so a host that never answers is let go). */
function within<T>(work: Promise<T>, ms: number, late: T): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined

  return Promise.race([work, new Promise<T>(resolve => (timer = setTimeout(() => resolve(late), Math.max(0, ms))))]).finally(() => clearTimeout(timer))
}

/** A file of the project, or null when it cannot be read within `ms` (at most READ_MS; nothing is read when no time is left). */
async function readWithin(state: State, host: Host, path: string, ms: number = READ_MS): Promise<string | null> {
  if (ms <= 0) return null

  try {
    return await within(Promise.resolve().then(() => host.fs.read(under(state.cwd, path))), Math.min(READ_MS, ms), null)
  } catch {
    return null
  }
}

const readStore = async (state: State, host: Host, ms?: number): Promise<TaskRecord[] | null> => {
  const text = await readWithin(state, host, PROJECT.tasks, ms)

  return text === null ? null : parseTasks(text)
}

type Step = { id: string; description: string; tags: string[] }

/** The tasks in the store that are exactly this step's: its description and both tags (the mission id binds them), still open, made since `sinceMs`. */
export function stepTasks(tasks: readonly TaskRecord[], missionId: string, step: Step, sinceMs: number): TaskRecord[] {
  const description = plain(step.description, 200)

  return tasks.filter(task => {
    const status = taskStatusOf(task.status)

    return (status === 'pending' || status === 'in_progress') && task.description === description && (task.tags ?? []).includes(`mission:${missionId}`) && (task.tags ?? []).includes(`task:${step.id}`) && (task.createdAtMs ?? 0) >= sinceMs
  })
}

type Outcome = Attempt & { tries: number }

/** Create the mission: `mission_create`, `mission_plan`, then a ruflo task per plan node. One confirm for the chain. */
export function createSpec(state: State, host: Host, onDone: () => void): ActionSpec | null {
  const mc = mcOf(state)

  if (mc.planned === null || mc.goal === '' || createWhy(state) !== null) return null

  const planned = mc.planned
  const goal = mc.goal
  const body = toMissionPlan(planned)
  const stamp = nonce()

  return {
    label: `create the mission and its ${body.tasks.length} tasks: ${plain(goal, 60)}`,
    scope: 'goal',
    args: [],
    argv: argvOf(state, 'mission_create', { requestId: `console-create-${stamp}`, objective: goal }),
    shows: `mission_create → mission_plan → task_create × ${body.tasks.length}, each \`ruflo mcp exec -t <tool>\` (${planned.profile}, ${planned.rigor}; ceiling ${body.budget.ceilingMinor / 100} ${body.budget.currency}, a record, not a charge)`,
    expect: 'a planned mission and its tasks in the ruflo task store',
    note: 'Writes the mission record and one task per plan node to this project’s ruflo stores. It runs no agent and spends nothing.',
    run: async () => {
      const since = creating.get(state)

      // One create at a time: a second would race the first for the same store and the same lock.
      if (since !== undefined) mc.last = { label: 'not created', ok: false, detail: `a mission is already being created (started ${Math.round((Date.now() - since) / 1000)} s ago); wait for its result` }
      // The goal changed while this ask was open: the plan on screen is not the plan that was asked for.
      else if (mc.goal !== goal) mc.last = { label: 'not created', ok: false, detail: 'the goal changed since you asked; ask again' }
      else {
        creating.set(state, Date.now())
        try {
          await createChain()
        } catch (error) {
          mc.last = { label: 'creating the mission failed', ok: false, detail: plain(error instanceof Error ? error.message : String(error), 160) }
        } finally {
          creating.delete(state)
          host.invalidate()
        }
      }

      host.invalidate()

      // How it ended is the console's outcome too, so Claude reads it from console_state however long the chain took.
      return mc.last === null ? undefined : ({ label: mc.last.label, ok: mc.last.ok, detail: mc.last.detail, ...(mc.last.lines !== undefined && { lines: mc.last.lines }) } satisfies RunReport)
    },
  }

  async function createChain(): Promise<void> {
    const startedMs = Date.now()
    // The mission id in the description and the tag is what binds a store task to this create; the window only allows for clock skew.
    const sinceMs = startedMs - SKEW_MS
    const deadline = startedMs + CREATE_DEADLINE_MS
    const cleanupEnd = deadline + CLEANUP_BUDGET_MS
    const fail = (label: string, detail: string, lines?: string[]) => void (mc.last = { label, ok: false, detail: plain(detail, 200), ...(lines !== undefined && { lines }) })

    const left = (until: number) => until - Date.now()
    const outOfTime: Attempt = { result: null, ok: false, transient: false, reason: 'out of time: not started' }

    /** One try of a tool: never started at or after `until`, and let go at the time left (the host's own limit is a little later). */
    const once = async (tool: string, params: unknown, isDone: (result: Record<string, unknown>) => boolean, until: number): Promise<Attempt> => {
      const ms = Math.min(CALL_MS, left(until))

      if (ms <= 0) return outOfTime

      const run = await within<RunRead>(host.run(argvOf(state, tool, params), ms + HOST_GRACE_MS).catch((error: unknown) => ({ error })), ms, { timedOutMs: ms })

      return readAttempt(run, isDone)
    }

    /**
     * Tries a step, and again after each wait while it fails for a transient reason and there is time before `until`. `beforeRetry` runs
     * after the wait, just before the next try: it may answer the step itself (a late success found), stop it (an answer of `ok: false`),
     * or let it be tried again (null).
     */
    const attempt = async (tool: string, params: unknown, isDone: (result: Record<string, unknown>) => boolean, until: number, beforeRetry?: () => Promise<Attempt | null>): Promise<Outcome> => {
      let last = await once(tool, params, isDone, until)
      let tries = 1

      for (const wait of RETRY_WAITS_MS) {
        // A wait that would end at or past the deadline is not started: there would be no time left for the try after it.
        if (last.ok || !last.transient || wait >= left(until)) break

        await pause(host, wait)

        const instead = await beforeRetry?.()

        if (instead != null) return { ...instead, reason: instead.ok ? '' : `${instead.reason} (after: ${last.reason})`, tries }
        if (left(until) <= 0) break

        last = await once(tool, params, isDone, until)
        tries += 1
      }

      // The last try failed for a transient reason: its write may have landed with the answer lost. One more look, if there is time for it.
      if (!last.ok && last.transient && left(until) > 0) {
        const found = await beforeRetry?.()

        // Only a late success counts here; anything else keeps the last try's own reason (cleanup cancels every task of the mission anyway).
        if (found?.ok === true) return { ...found, reason: '', tries }
      }

      return { ...last, tries }
    }

    const answered = (result: Record<string, unknown>) => result.ok === true
    const created = await attempt('mission_create', { requestId: `console-create-${stamp}`, objective: goal }, result => answered(result) && typeof recordOf(result.data)?.missionId === 'string', deadline)
    const data = recordOf(created.result?.data) ?? {}

    if (!created.ok || typeof data.missionId !== 'string') return fail('mission_create failed', `${created.reason || 'no answer'} (${tries(created)})`)

    const id = data.missionId
    const createdRevision = typeof data.revision === 'number' ? data.revision : 1
    // mission_create and mission_plan carry a request id, so a retry after a late success is answered from the record, never applied twice.
    const placed = await attempt('mission_plan', { requestId: `console-plan-${stamp}`, missionId: id, expectedRevision: createdRevision, plan: body }, answered, deadline)

    if (!placed.ok) return undo(id, createdRevision, [], `the plan was not recorded: ${placed.reason || 'no answer'} (${tries(placed)})`, 'mission not created: mission_plan failed')

    const planData = recordOf(placed.result?.data) ?? {}
    const planRevision = typeof planData.revision === 'number' ? planData.revision : createdRevision + 1
    const tasks: LedgerTask[] = []

    for (const node of planned.steps) {
      if (Date.now() >= deadline) return undo(id, planRevision, tasks, `the create ran past its ${CREATE_DEADLINE_MS / 60_000} min limit before task ${node.id}`, `mission not created: out of time at task ${node.id}`)

      const title = body.tasks.find(candidate => candidate.id === node.id)?.title ?? node.action.title
      const step: Step = { id: node.id, description: `[${id}/${node.id}] ${title}`.slice(0, 200), tags: [`mission:${id}`, `task:${node.id}`, `phase:${node.action.phase}`] }
      const made = await attempt('task_create', { type: taskType(planned.profile), description: step.description, priority: 'normal', tags: step.tags }, result => typeof result.taskId === 'string' && result.success !== false && result.error === undefined, deadline, async () => {
        const store = await readStore(state, host, left(deadline))

        if (store === null) return { result: null, ok: false, transient: false, reason: 'the task store could not be read to check for a late success, so the step was not tried again' }

        const found = stepTasks(store, id, step, sinceMs)

        if (found.length > 1) return { result: null, ok: false, transient: false, reason: `${found.length} tasks in the store match task ${node.id} (${found.map(task => task.id).join(', ')}); not guessing which one is ours` }

        return found.length === 1 ? { result: { taskId: found[0]?.id }, ok: true, transient: false, reason: '' } : null
      })
      const rufloTaskId = made.ok && typeof made.result?.taskId === 'string' ? made.result.taskId : undefined

      if (rufloTaskId === undefined) return undo(id, planRevision, tasks, `task ${node.id}: ${made.reason || 'no answer'} (${tries(made)})`, `mission not created: task ${node.id} could not be made`)

      tasks.push({ id: node.id, title: node.action.title, phase: node.action.phase, stage: stageOf(node.action), agent: node.action.agent, requirement: node.action.requirement, dependsOn: node.dependsOn, rufloTaskId })
    }

    const record0: MissionRecord = {
      id,
      objective: goal,
      profile: planned.profile,
      rigor: planned.rigor,
      planDigest: typeof planData.planDigest === 'string' ? planData.planDigest : undefined,
      tasks,
      acceptance: body.acceptance.map(criterion => ({ id: criterion.id, check: criterion.check })),
      events: [],
      paused: false,
      cancelled: false,
      auto: false,
      createdAtMs: Date.now(),
    }

    record(record0, { type: 'mission.created', status: 'draft' })
    record(record0, { type: 'plan.validated', status: 'planned', evidenceRef: record0.planDigest })
    record(record0, { type: 'tasks.created', note: `${tasks.length} of ${tasks.length}` })
    mc.missions.set(id, record0)
    mc.active = id
    mc.tab = 'tasks'
    mc.last = { label: `mission ${id} planned`, ok: true, detail: `${tasks.length} tasks in the ruflo task store; ▶ Run next hands the first to Claude` }
    saveLedger(state, host)
    onDone()

    /**
     * The create cannot finish. Every open task of this mission is cancelled: those whose create was acknowledged, and any other the store
     * holds with this mission's tag (a create whose answer was lost). Then the mission record is asked to cancel (once more at the revision a
     * conflict names), and the task store and the mission observation are read back: the result says what they show. Nothing starts after
     * the cleanup deadline; what was left for lack of time is named.
     */
    async function undo(missionId: string, revision: number, made: LedgerTask[], why: string, label: string): Promise<void> {
      const tag = `mission:${missionId}`
      const before = await readStore(state, host, left(cleanupEnd))
      const acknowledged = made.map(task => task.rufloTaskId as string)
      const tagged = (before ?? []).filter(task => (task.tags ?? []).includes(tag)).map(task => task.id)
      const ids = [...new Set([...acknowledged, ...tagged])]
      const closed = new Set((before ?? []).filter(task => ['cancelled', 'completed'].includes(taskStatusOf(task.status))).map(task => task.id))
      const skipped: string[] = []

      for (const taskId of ids) {
        if (closed.has(taskId)) continue
        if (left(cleanupEnd) <= 0) skipped.push(taskId)
        else await attempt('task_cancel', { taskId, reason: 'mission creation failed in the console' }, result => result.success === true, cleanupEnd)
      }

      const cancel = (expectedRevision: number, suffix: string) => attempt('mission_request_action', { requestId: `console-abort-${stamp}${suffix}`, missionId, expectedRevision, action: 'cancel', reason: plain(`creation failed in the console: ${why}`, 400) }, answered, cleanupEnd)
      let asked = await cancel(revision, '')
      const current = asked.result?.code === 'revision-conflict' && typeof asked.result.currentRevision === 'number' ? asked.result.currentRevision : null

      if (!asked.ok && current !== null && current !== revision && left(cleanupEnd) > 0) asked = await cancel(current, '-r')

      const after = await readStore(state, host, left(cleanupEnd))
      const seen = after === null ? null : [...new Set([...ids, ...after.filter(task => (task.tags ?? []).includes(tag)).map(task => task.id)])].map(taskId => ({ taskId, status: taskStatusOf(after.find(task => task.id === taskId)?.status) || 'missing' }))
      const open = seen?.filter(entry => entry.status !== 'cancelled' && entry.status !== 'completed') ?? []
      const observed = parseMissions(await readWithin(state, host, PROJECT.missions, left(cleanupEnd)))?.missions.find(mission => mission.id === missionId)?.state
      const total = seen?.length ?? 0
      const storeLine =
        seen === null
          ? `the task store could not be read back: ${ids.length === 0 ? 'no task of this mission is known' : `the cancels of ${ids.join(', ')} are unconfirmed`}`
          : total === 0
            ? 'the store holds no task of this mission'
            : `the store shows ${total - open.length} of the ${total} tasks of this mission cancelled${open.length > 0 ? `; ${open.length} not cancelled: ${open.map(entry => `${entry.taskId} (${entry.status})`).join(', ')}` : ''}`
      const recordLine = `mission ${missionId}: ${asked.ok ? 'cancel accepted' : `cancel not accepted: ${asked.reason || 'no answer'}`}; the observation shows ${observed ?? 'nothing readable'}`
      const timeLine = skipped.length > 0 ? [`out of cleanup time: not asked to cancel ${skipped.join(', ')}`] : []
      const summary = seen === null ? 'Store not readable' : total === 0 ? 'No task in the store' : `Store: ${total - open.length} of ${total} cancelled${open.length > 0 ? `, ${open.length} not` : ''}`

      fail(label, `${why}. ${summary}; mission ${observed ?? 'state unknown'}. Ask again.`, [why, storeLine, recordLine, ...timeLine])
    }
  }
}

const tries = (outcome: Outcome): string => `${outcome.tries} ${outcome.tries === 1 ? 'try' : 'tries'}`
