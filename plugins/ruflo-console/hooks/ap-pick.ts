/**
 * What one autopilot pass reads before it decides (ADR-466, ADR-470): the next task the mission would hand over, the spend reading, and the
 * effect of each step in flight. Split from ap-live.ts (file limit). The task store's status is a claim, so a step is only `done` when the
 * envelope's own verify commands also pass.
 */
import { derive, rufloTaskOf, startable, type MissionRecord } from './mission-control'
import type { Host } from './host'
import type { State } from './state'
import { classifyTask, effectOf, killSeen, verifyPermission, type ToolCheck } from './data/ap-guard'
import type { Envelope, Spend } from './data/ap-envelope'
import type { EffectFact, LoopState, TaskFact } from './data/ap-loop'
import { readingOf, spendSource, windowArgvs } from './data/ap-spend'
import type { Store } from './ap-live'

/**
 * The mission's next ready task that is not parked, denied or already stepped. The mission's own rules hold: nothing is handed over past a
 * failed task, a task waits for its dependencies, a paused or cancelled mission hands out nothing. Only the one-at-a-time limit is widened,
 * to `cap` (the envelope's concurrency, further narrowed by adaptation): tasks the store shows running and tasks handed over a moment ago
 * both count against it.
 */
export function pickTask(mission: MissionRecord, state: State, skip: ReadonlySet<string>, cap = 1): { ledger: MissionRecord['tasks'][number]; fact: TaskFact } | null {
  const tasks = state.snapshot?.tasks ?? []
  const ledger = mission.tasks.find(task => !skip.has(task.id) && startable(mission, tasks, task, cap))

  return ledger === undefined ? null : { ledger, fact: classifyTask(ledger.id, ledger.title, ledger.requirement) }
}

/** The hour, day and run windows from the ledger, or why not. Never a guess: an unread spend stops the loop from starting anything. */
export async function readSpend(state: State, host: Host, startMs: number, nowMs: number): Promise<{ spend: Spend | null; why: string | null }> {
  const source = spendSource(state)

  if (source.kind === 'unavailable') return { spend: null, why: source.why }

  const argvs = windowArgvs(source.root, startMs, nowMs, state.cwd)

  if (argvs.hour === null || argvs.day === null || argvs.total === null) return { spend: null, why: 'a ledger window or the project path failed its checks' }

  try {
    const [hour, day, total] = [await host.run(argvs.hour, 60_000), await host.run(argvs.day, 60_000), await host.run(argvs.total, 60_000)]

    if (hour.exitCode !== 0 || day.exitCode !== 0 || total.exitCode !== 0) return { spend: null, why: 'the ledger exited with an error' }

    return readingOf({ hour: hour.stdout, day: day.stdout, total: total.stdout })
  } catch {
    return { spend: null, why: 'the ledger could not be run' }
  }
}

/** The effect of each in-flight step, from the task store AND the envelope's verify commands. The store's status alone is a claim. */
/** True once the loop is stopped; a function, so a check after an await is not narrowed by a check before it. */
const isStopped = (store: Store): boolean => store.loop.phase === 'stopped'

export async function effectsOf(state: State, host: Host, store: Store, check: ToolCheck | undefined, loop: LoopState, mission: MissionRecord | null, env: Envelope): Promise<Record<string, EffectFact>> {
  const out: Record<string, EffectFact> = {}

  for (const step of loop.steps.filter(entry => entry.status === 'started')) {
    const ledger = mission?.tasks.find(task => task.id === step.task)
    const stored = ledger === undefined ? undefined : rufloTaskOf(state.snapshot?.tasks ?? [], ledger)?.status

    if (stored === 'completed' && !store.verified.has(step.id)) {
      // A stopped loop (or a kill flag) verifies nothing, and what it did not verify is NOT remembered: the first version counted the skipped
      // checks as failures and cached them, so a step that finished after a Stop was recorded failed on the next Start (found in the live run).
      if (store.killed || isStopped(store) || (await killSeen(host.fs, state.cwd))) {
        out[step.id] = 'unknown'
        continue
      }

      let ran = 0
      let failed = 0
      let isCut = false

      // The envelope's verify commands run through the console, not the engine: where the person's settings deny the test class they are never run, and each counts as a failed check (never as a pass).
      for (const argv of env.verify) {
        ran += 1

        // A stop pressed while the list runs ends it, without a result.
        if (isStopped(store) || (await killSeen(host.fs, state.cwd))) {
          isCut = true
          break
        }

        // The console runs these itself, so the person's own permission rules are asked first (a refusal is a failed check, never run).
        if (store.preflight.test === 'deny' || (await verifyPermission(check, argv)) === 'blocked') {
          failed += 1
          continue
        }

        const result = await host.run(argv, 10 * 60_000).catch(() => ({ exitCode: 1 }))

        if (result.exitCode !== 0) failed += 1
      }

      if (isCut) {
        out[step.id] = 'unknown'
        continue
      }

      store.verified.set(step.id, effectOf(stored, { ran, failed }))
      if (store.verified.size > 500) for (const key of [...store.verified.keys()].slice(0, 100)) store.verified.delete(key)
    }

    out[step.id] = stored === 'completed' ? (store.verified.get(step.id) ?? 'unknown') : stored === 'failed' || stored === 'cancelled' ? 'failed' : stored === 'pending' || stored === undefined ? 'absent' : 'unknown'
  }

  return out
}
