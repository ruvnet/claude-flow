/**
 * The autopilot's step machine (ADR-466 §2, §4, §5). Pure: `foldJournal(events)` is the whole state, `tick(state, facts)` answers what
 * to journal and whether to start one step. No I/O, no clock (the time is in `facts`), so every rule is testable and a crash can only
 * lose what was not journaled yet.
 * The one thing held between calls is `replayJournal`'s last answer, keyed by the journal's text: a result is a pure function of that text, and
 * `foldJournal` copies its base, so handing the same state out twice cannot be seen.
 *
 * The order of the checks in `tick` IS the safety property: the kill switch is looked at before anything else and a stopped loop never
 * acts again without an explicit `start` event; an in-flight step is settled (finished, timed out, or found lost) before any new one
 * is considered; budget, Anatole and the failure ladder all sit between "settled" and "act". A step is started at most once per id,
 * and a task with a started or done step is never started again.
 */
import { classAllowed, hostAllowed, pathAllowed, sha256, type Envelope, type Spend } from './ap-envelope'
import { parseJournal, type Anatole, type JournalEvent, type Receipt } from './ap-journal'

export type Phase = 'idle' | 'running' | 'paused' | 'stopped'
export type StepRec = { id: string; task: string; cls: string; attempt: number; startedAt: number; deadline: number; status: 'started' | 'done' | 'failed'; verified?: boolean; why?: string; tier: string; par?: number; endedAt?: number }
export type ParkedRec = { id: string; task: string; question: string; at: number; answer?: 'once' | 'deny'; /** True once a step ran under an `once` answer. */ isUsed?: boolean }

export type LoopState = {
  phase: Phase
  startedAtMs: number | null
  envHash: string | null
  revision: number | null
  anatole: Anatole | null
  reason: string | null
  steps: StepRec[]
  parked: ParkedRec[]
  failures: number
  lastFailureAt: number | null
  lastBeatAt: number | null
  lastDigestDay: string | null
  receipts: Receipt[]
  /** How many `start` lines the journal holds: the approved count is pinned outside the project, so an extra (forged or replayed) start is seen. */
  starts: number
}

export const emptyLoop = (): LoopState => ({ phase: 'idle', startedAtMs: null, envHash: null, revision: null, anatole: null, reason: null, steps: [], parked: [], failures: 0, lastFailureAt: null, lastBeatAt: null, lastDigestDay: null, receipts: [], starts: 0 })

export const KEEP_STEPS = 400
/** Consecutive failures that pause the loop instead of letting it thrash. */
export const FAILURE_BUDGET = 5
export const BACKOFF_BASE_MS = 60_000
export const BACKOFF_MAX_MS = 3_600_000
export const BEAT_MS = 300_000
/** The share of the total spend ceiling at which the loop pauses (it stops at 100%). */
export const PAUSE_AT = 0.8

/** The loop's state as the journal says it. `base` is a checkpoint to continue from. */
export function foldJournal(events: readonly JournalEvent[], base: LoopState = emptyLoop()): LoopState {
  const s: LoopState = { ...base, steps: base.steps.map(step => ({ ...step })), parked: base.parked.map(p => ({ ...p })), receipts: [...base.receipts] }
  // Indexes over what the loop below looks up on every event. A scan per event made a fold quadratic (100k events took 10.8 s; bench-autopilot.mjs):
  // steps by id (ids are unique: a repeat is refused), the one unanswered park of an id, and parks by task in file order.
  const stepById = new Map<string, StepRec>()
  const openPark = new Map<string, ParkedRec>()
  const parksByTask = new Map<string, ParkedRec[]>()
  const indexPark = (p: ParkedRec): void => {
    const list = parksByTask.get(p.task)

    if (list === undefined) parksByTask.set(p.task, [p])
    else list.push(p)

    if (p.answer === undefined && !openPark.has(p.id)) openPark.set(p.id, p)
  }

  for (const step of s.steps) if (!stepById.has(step.id)) stepById.set(step.id, step)
  for (const p of s.parked) indexPark(p)

  for (const e of events) {
    switch (e.t) {
      case 'start':
        s.starts += 1
        Object.assign(s, { phase: 'running', startedAtMs: e.at, envHash: e.envHash, revision: e.revision, anatole: e.anatole, reason: null, failures: 0, lastFailureAt: null })
        break
      case 'step.started':
        // A repeated id (a replayed line) changes nothing: one step per id.
        if (!stepById.has(e.id)) {
          const made: StepRec = { id: e.id, task: e.task, cls: e.cls, attempt: e.attempt, startedAt: e.at, deadline: e.deadline, status: 'started', tier: e.tier, ...(e.par !== undefined && { par: e.par }) }

          s.steps.push(made)
          stepById.set(made.id, made)

          const once = parksByTask.get(e.task)?.find(p => p.answer === 'once' && p.isUsed !== true)

          if (once !== undefined) once.isUsed = true
        }
        break
      case 'step.done': {
        const step = stepById.get(e.id)

        if (step !== undefined && step.status === 'started') {
          Object.assign(step, { status: 'done', verified: e.verified, endedAt: e.at })
          s.failures = 0
        }
        break
      }

      case 'step.failed': {
        const step = stepById.get(e.id)

        if (step !== undefined && step.status === 'started') {
          Object.assign(step, { status: 'failed', why: e.why, endedAt: e.at })
          s.failures += 1
          s.lastFailureAt = e.at
        }
        break
      }

      case 'parked':
        if (!openPark.has(e.id)) {
          const made: ParkedRec = { id: e.id, task: e.task, question: e.question, at: e.at }

          s.parked.push(made)
          indexPark(made)
        }
        break
      case 'answered': {
        const held = openPark.get(e.id)

        if (held !== undefined) {
          held.answer = e.answer
          openPark.delete(e.id)
        }
        break
      }

      case 'pause':
        if (s.phase === 'running') Object.assign(s, { phase: 'paused', reason: e.reason })
        break
      case 'resume':
        if (s.phase === 'paused') Object.assign(s, { phase: 'running', reason: null, failures: 0 })
        break
      case 'stop':
        Object.assign(s, { phase: 'stopped', reason: e.reason })
        break
      case 'beat':
        s.lastBeatAt = e.at
        break
      case 'adapt':
        s.receipts.push(e.receipt)
        break
      case 'digest':
        s.lastDigestDay = e.day
        break
    }
  }

  return compactState(s)
}

let lastReplay: { text: string; loop: LoopState; bad: number } | null = null

/**
 * A journal's text as the loop it says, and how many of its lines were not events. The console re-reads the journal on every tick (every minute, for weeks) and
 * the read cache hands back the SAME text while the file is unchanged, so the last answer is kept and a tick that finds nothing new replays nothing. The
 * state is never mutated by a caller (foldJournal copies its base), so handing the same object out twice is safe.
 */
export function replayJournal(text: string): { loop: LoopState; bad: number } {
  if (lastReplay !== null && lastReplay.text === text) return lastReplay

  const parsed = parseJournal(text)

  lastReplay = { text, loop: foldJournal(parsed.events), bad: parsed.bad }

  return lastReplay
}

/** Old finished steps are forgotten so weeks of running stay small; started steps and unanswered parks are never dropped. */
export function compactState(s: LoopState): LoopState {
  const live = s.steps.filter(step => step.status === 'started')
  const rest = s.steps.filter(step => step.status !== 'started').slice(-KEEP_STEPS)
  const keep = new Set([...live, ...rest])

  return { ...s, steps: s.steps.filter(step => keep.has(step)), parked: s.parked.slice(-200), receipts: s.receipts.slice(-200) }
}

export type TaskFact = { id: string; title: string; /** The envelope class the task needs, or null when it cannot be classified (it is parked, never guessed). */ cls: string | null; /** A hard deny the task text names, or null. */ hardDeny: string | null; /** A path the task names, when one can be read from it. */ path: string | null; /** Every path the text names (absolute, or home/parent/variable forms that can never be inside a folder). */ paths?: readonly string[]; /** Hosts of the URLs the text names, lowercase. */ hosts?: string[]; /** `owner/name` of the GitHub repositories the text names by URL. */ repos?: string[] }
export type EffectFact = 'done' | 'done-unverified' | 'failed' | 'absent' | 'unknown'
export type Preflight = 'allow' | 'deny' | 'ask' | 'unwired'
export type Tunables = { parallelism: number; retries: number; stepTimeoutMs: number; tierOf: (cls: string) => string }

export type Facts = {
  nowMs: number
  killSeen: boolean
  /** Null when the sealed envelope is missing, invalid or does not match its hash. */
  envelope: Envelope | null
  anatole: 'on' | 'off' | 'absent'
  /** Null when the cost ledger has not been read: unknown is never drawn or treated as $0. */
  spend: Spend | null
  /** The next ready task the picker chose, already excluding parked and denied tasks (`skipSet`). */
  task: TaskFact | null
  effects: Readonly<Record<string, EffectFact>>
  /** Started steps that no executor in this process is working on (they began before a restart). */
  orphans: ReadonlySet<string>
  tunables: Tunables
  preflight: Readonly<Record<string, Preflight>>
  /** Milliseconds each in-flight step is forgiven for time the machine was asleep (a gap between ticks), by step id. Absent means none. */
  slack?: Readonly<Record<string, number>>
}

export type Decision = { events: JournalEvent[]; act: { id: string; task: TaskFact; cls: string; attempt: number; tier: string; deadline: number } | null; status: string }

const idle = (status: string, events: JournalEvent[] = []): Decision => ({ events, act: null, status })

/** The tasks the picker must skip: parked and waiting, denied, or already carrying a started or done step. */
export function skipSet(s: LoopState): Set<string> {
  return new Set([...s.parked.filter(p => p.answer === undefined || p.answer === 'deny' || p.isUsed === true).map(p => p.task), ...s.steps.filter(step => step.status !== 'failed').map(step => step.task)])
}

const parkId = (task: string, why: string): string => `p-${sha256(`${task}:${why}`).slice(0, 12)}`
export const stepId = (task: string, attempt: number): string => `s-${sha256(`${task}:${attempt}`).slice(0, 16)}`

export const backoffMs = (failures: number): number => Math.min(BACKOFF_MAX_MS, BACKOFF_BASE_MS * 2 ** Math.max(0, failures - 1))

/** Why a task cannot run inside the envelope, or null when it can. Ambiguous or out of scope means park with a question. */
export function whyParked(task: TaskFact, env: Envelope, preflight: Readonly<Record<string, Preflight>>): string | null {
  if (task.hardDeny !== null) return `needs "${task.hardDeny}", which autopilot can never do. Do it yourself, or deny it.`
  if (task.cls === null) return 'cannot tell which kind of action this needs, and autopilot does not guess. Which class is it?'
  if (!classAllowed(env, task.cls)) return `needs "${task.cls}", which the envelope does not allow. Approve once, or deny.`

  for (const path of [...new Set([...(task.path === null ? [] : [task.path]), ...(task.paths ?? [])])]) if (!pathAllowed(env, path)) return `touches ${path.slice(0, 80)}, outside the envelope's folders (or in one that is never granted). Approve once, or deny.`

  const host = (task.hosts ?? []).find(name => !hostAllowed(env, name))

  if (host !== undefined) return `names the host ${host.slice(0, 60)}, which is not on the envelope's network list. Approve once, or deny.`

  const repo = (task.repos ?? []).find(name => !env.repos.includes(name))

  if (repo !== undefined) return `names the repository ${repo.slice(0, 60)}, which is not on the envelope's repo list. Approve once, or deny.`
  // A deny from the person's own settings is not the console's to lift: no approve button, and an old approval is ignored for it.
  if (preflight[task.cls] === 'deny') return `your permission settings deny "${task.cls}", which autopilot can never do on your behalf. Change your settings, or deny it.`
  if (preflight[task.cls] === 'ask') return `your permission settings would ask before "${task.cls}". Approve once here (the engine still decides), or deny.`

  return null
}

/** One pass. See the file header for why the order matters. */
export function tick(s: LoopState, f: Facts): Decision {
  const now = f.nowMs

  if (s.phase === 'stopped') return idle(`stopped: ${s.reason ?? 'stopped'}`)
  if (f.killSeen) return idle('stopped: kill switch', [{ t: 'stop', at: now, reason: 'kill switch' }])
  if (s.phase === 'idle') return idle('not started')

  const events: JournalEvent[] = []

  // 1. Settle what is in flight: finished, timed out, or lost to a restart. Never rerun it here.
  const open = s.steps.filter(step => step.status === 'started')
  let failures = s.failures
  let lastFailure = s.lastFailureAt
  let stillOpen = 0

  for (const step of open) {
    const effect = f.effects[step.id] ?? 'unknown'

    if (effect === 'done' || effect === 'done-unverified') {
      events.push({ t: 'step.done', at: now, id: step.id, verified: effect === 'done' })
      failures = 0
    } else if (effect === 'failed') {
      events.push({ t: 'step.failed', at: now, id: step.id, why: 'the task reported failure' })
      failures += 1
      lastFailure = now
    } else if (now > step.deadline + (f.slack?.[step.id] ?? 0)) {
      events.push({ t: 'step.failed', at: now, id: step.id, why: 'timed out' })
      failures += 1
      lastFailure = now
    } else if (f.orphans.has(step.id) && (effect === 'absent' || effect === 'unknown')) {
      // A step from before a restart whose task the store still shows in progress (or not at all): nobody is working it, and waiting out its 30 minute deadline would then RETRY it without a question (found in the live run). Settle it now; a lost step parks its task (see `wasLost`).
      events.push({ t: 'step.failed', at: now, id: step.id, why: 'lost on restart: no effect found' })
      // The store still shows it in progress, so the picker will never offer this task again: park it here, with a question that says what to do.
      if (effect === 'unknown') events.push({ t: 'parked', at: now, id: parkId(step.task, 'lost'), task: step.task, question: 'a step for this task was in flight when the console restarted, and the task store still shows it in progress with nobody working it. It may have run: check the work, set the task back to pending to retry it (then approve once), or deny.' })
      failures += 1
      lastFailure = now
    } else stillOpen += 1
  }

  if (s.phase === 'paused') return idle(`paused: ${s.reason ?? 'paused'}`, events)

  const stopWith = (reason: string): Decision => ({ events: [...events, { t: 'stop', at: now, reason }], act: null, status: `stopped: ${reason}` })
  const pauseWith = (reason: string): Decision => ({ events: [...events, { t: 'pause', at: now, reason }], act: null, status: `paused: ${reason}` })

  // 2. The envelope, the clock, Anatole.
  if (f.envelope === null) return stopWith('the envelope is missing, invalid or was changed outside the console')
  if (s.startedAtMs !== null && now - s.startedAtMs > f.envelope.maxDurationMs) return stopWith('the envelope\'s maximum duration passed')
  if (f.anatole !== 'on' && !f.envelope.acceptWithoutAnatole) return pauseWith(f.anatole === 'off' ? 'Project Anatole is off' : 'Project Anatole is not installed')

  // 3. Spend. Total first: 100% stops, 80% pauses (nothing in flight is cut); an hour or day ceiling only holds the next step back.
  if (f.spend === null) return { events, act: null, status: 'waiting: spend not read yet' }
  if (f.spend.totalUsd >= f.envelope.spend.totalUsd) return stopWith('total spend ceiling reached')
  if (f.spend.totalUsd >= f.envelope.spend.totalUsd * PAUSE_AT) return pauseWith('80% of the total spend ceiling')
  if (f.spend.dayUsd >= f.envelope.spend.dayUsd) return { events, act: null, status: 'waiting: day spend ceiling' }
  if (f.spend.hourUsd >= f.envelope.spend.hourUsd) return { events, act: null, status: 'waiting: hour spend ceiling' }

  // 4. Failure ladder: a budget that pauses, a backoff that waits.
  if (failures >= FAILURE_BUDGET) return pauseWith(`${failures} failures in a row`)
  // A clock set back after a failure must not hold the loop for the size of the jump: a negative age counts as the full wait.
  if (failures > 0 && lastFailure !== null && now >= lastFailure && now - lastFailure < backoffMs(failures)) return { events, act: null, status: `backing off after ${failures} failure${failures === 1 ? '' : 's'}` }

  // 5. Room to start one.
  if (stillOpen >= Math.min(f.envelope.concurrency, Math.max(1, f.tunables.parallelism))) return { events, act: null, status: `${stillOpen} step${stillOpen === 1 ? '' : 's'} running` }

  const task = f.task

  if (task === null) {
    if (s.lastBeatAt === null || now - s.lastBeatAt >= BEAT_MS) events.push({ t: 'beat', at: now })

    return { events, act: null, status: 'nothing ready' }
  }

  // 6. Never twice: a task with a started or done step, or that was denied, is not started.
  if (s.steps.some(step => step.task === task.id && step.status !== 'failed')) return { events, act: null, status: `task ${task.id} already has a step` }

  const attempt = 1 + s.steps.filter(step => step.task === task.id && step.status === 'failed').length
  // A hard deny can never be approved once: the answer is ignored for it.
  const answeredOnce = task.hardDeny === null && f.preflight[task.cls ?? ''] !== 'deny' && s.parked.some(p => p.task === task.id && p.answer === 'once' && p.isUsed !== true)

  if (!answeredOnce && attempt > 1 + f.tunables.retries) {
    const why = whyParked({ ...task, cls: task.cls }, f.envelope, f.preflight) ?? `failed ${attempt - 1} times, past the retry policy. Retry once, or deny.`

    return park(s, events, task, 'retries', why, now)
  }

  // A step lost to a restart may have run: the prompt may already have been handed to the session. Retrying it is a question, never automatic.
  const wasLost = s.steps.some(step => step.task === task.id && step.status === 'failed' && (step.why ?? '').startsWith('lost on restart'))

  if (wasLost && !answeredOnce) return park(s, events, task, 'lost', 'a step for this task was in flight when the console restarted and may have run: check the work, then retry once, or deny.', now)

  const why = answeredOnce ? null : whyParked(task, f.envelope, f.preflight)

  if (why !== null) return park(s, events, task, why, why, now)

  const cls = task.cls ?? 'read'
  const tier = f.tunables.tierOf(cls)

  return { events: [...events, { t: 'step.started', at: now, id: stepId(task.id, attempt), task: task.id, cls, attempt, deadline: now + f.tunables.stepTimeoutMs, tier, par: f.tunables.parallelism }], act: { id: stepId(task.id, attempt), task, cls, attempt, tier, deadline: now + f.tunables.stepTimeoutMs }, status: `started ${task.id}` }
}

function park(s: LoopState, events: JournalEvent[], task: TaskFact, key: string, question: string, now: number): Decision {
  const id = parkId(task.id, key)

  if (!s.parked.some(p => p.id === id && p.answer === undefined)) events.push({ t: 'parked', at: now, id, task: task.id, question })

  return { events, act: null, status: `parked ${task.id}` }
}

/** The facts the band and the panel draw from a state: nothing here is a placeholder. */
export type Summary = { phase: Phase; day: number | null; running: number; parked: number; done: number; failed: number; unverified: number; reason: string | null }

export function summarize(s: LoopState, nowMs: number): Summary {
  return {
    phase: s.phase,
    day: s.startedAtMs === null ? null : Math.floor(Math.max(0, nowMs - s.startedAtMs) / 86_400_000) + 1,
    running: s.steps.filter(step => step.status === 'started').length,
    parked: s.parked.filter(p => p.answer === undefined).length,
    done: s.steps.filter(step => step.status === 'done').length,
    failed: s.steps.filter(step => step.status === 'failed').length,
    unverified: s.steps.filter(step => step.status === 'done' && step.verified === false).length,
    reason: s.reason,
  }
}

/** The band text: `autopilot day 3 · $12/$40 · 2 parked`. A spend that was not read is `$n/a`, never `$0`. */
export function bandText(s: LoopState, nowMs: number, spendUsd: number | null, env: Envelope | null): string {
  const sum = summarize(s, nowMs)

  if (sum.phase === 'idle') return ''

  const money = (n: number): string => `$${Math.round(n * 100) / 100}`
  const cost = `${spendUsd === null ? '$n/a' : money(spendUsd)}/${env === null ? '$n/a' : money(env.spend.totalUsd)}`
  const state = sum.phase === 'running' ? '' : ` ${sum.phase}`

  return `autopilot${state} day ${sum.day ?? 'n/a'} · ${cost} · ${sum.parked} parked`
}

/** Events that fold back to this state's live parts, for compaction: a rotated journal starts from these and the old one is archived. */
export function snapshotEvents(s: LoopState): JournalEvent[] {
  if (s.startedAtMs === null || s.envHash === null || s.revision === null || s.anatole === null) return []

  const out: JournalEvent[] = [{ t: 'start', at: s.startedAtMs, envHash: s.envHash, revision: s.revision, anatole: s.anatole }]

  for (const p of s.parked) {
    out.push({ t: 'parked', at: p.at, id: p.id, task: p.task, question: p.question })
    if (p.answer !== undefined) out.push({ t: 'answered', at: p.at, id: p.id, answer: p.answer })
  }

  for (const step of s.steps.slice(-50)) {
    out.push({ t: 'step.started', at: step.startedAt, id: step.id, task: step.task, cls: step.cls, attempt: step.attempt, deadline: step.deadline, tier: step.tier, ...(step.par !== undefined && { par: step.par }) })
    if (step.status === 'done') out.push({ t: 'step.done', at: step.endedAt ?? step.startedAt, id: step.id, verified: step.verified === true })
    if (step.status === 'failed') out.push({ t: 'step.failed', at: step.endedAt ?? step.startedAt, id: step.id, why: step.why ?? 'failed' })
  }

  for (const receipt of s.receipts) out.push({ t: 'adapt', at: receipt.at, receipt })
  if (s.lastDigestDay !== null) out.push({ t: 'digest', at: s.startedAtMs, day: s.lastDigestDay })
  if (s.phase === 'paused') out.push({ t: 'pause', at: s.startedAtMs, reason: s.reason ?? 'paused' })
  if (s.phase === 'stopped') out.push({ t: 'stop', at: s.startedAtMs, reason: s.reason ?? 'stopped' })

  return out
}

/** The daily digest line: what the last 24 hours did, from the steps the journal still holds. Spend is drawn only when it was read. */
export function digestText(s: LoopState, nowMs: number, spendUsd: number | null): string {
  const since = nowMs - 86_400_000
  const day = s.steps.filter(step => (step.endedAt ?? step.startedAt) >= since)
  const done = day.filter(step => step.status === 'done')
  const adapted = s.receipts.filter(r => r.at >= since).length

  return `autopilot digest: ${done.filter(step => step.verified === true).length} verified, ${done.filter(step => step.verified !== true).length} unverified, ${day.filter(step => step.status === 'failed').length} failed · ${s.parked.filter(p => p.answer === undefined).length} parked · ${adapted} adaptation${adapted === 1 ? '' : 's'} · spend ${spendUsd === null ? 'n/a' : `$${Math.round(spendUsd * 100) / 100}`}`
}
