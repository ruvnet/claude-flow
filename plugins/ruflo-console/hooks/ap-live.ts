/**
 * The autopilot's live half (ADR-466): reads the sealed envelope and the journal, gathers the facts for one tick, appends what the
 * step machine decided, and hands a started step to the session through the console's existing mission dispatch (the same `dispatchSpec`
 * path and `submitPrompt`, no executor of its own). Wired once with `wireAutopilot(state, host, { toolCheck })` where the other actions
 * are wired; it then ticks on `host.every`. The loop's liveness over days comes from the session itself staying up (the mission's
 * `/loop` re-arm); this module adds the per-tick checks, never a scheduler.
 *
 * Every write is the host's `run` of a fixed argv (the host's fs is read-only), after `checkNoLinks`, one at a time, and a write that
 * fails is a tick that does not act. Stopping and pausing need no confirm (they only narrow authority); starting and any change of the
 * envelope go through the confirm card (views/ap-panel.ts).
 */
import { activeMission, dispatchSpec, startable, type LedgerTask, type MissionRecord } from './mission-control'
import type { Host } from './host'
import type { State } from './state'
import { readBounded, under } from './data/files'
import { checkNoLinks, dirOf, removeFileArgv } from './data/wf-file'
import { writeFlavorReady } from './data/write-flavor'
import { writeVia } from './data/write-via'
import { cleanText } from './data/wf-clean'
import { tierOf, tunablesFrom } from './data/ap-adapt'
import { adaptPass, rotate } from './ap-maint'
import { checkPin, type Pin } from './data/ap-pin'
import { loadPin, setPin } from './ap-pin-live'
import { AUTOPILOT_DIR, ENVELOPE_FILE, KILL_CLEARED, KILL_FILE, open, type Envelope, type Sealed, type Spend } from './data/ap-envelope'
import { anatoleFact, killSeen, preflightAll, type ToolCheck } from './data/ap-guard'
import { effectsOf, pickTask, readSpend } from './ap-pick'
import { encodeLine, JOURNAL_FILE, JOURNAL_MAX_BYTES, REFUSED_WHY, startedCount, type JournalEvent } from './data/ap-journal'
import { digestText, emptyLoop, foldJournal, replayJournal, skipSet, tick, type EffectFact, type Facts, type LoopState, type TaskFact } from './data/ap-loop'
import type { Preflight } from './data/ap-loop'
import type { NoticeDraft } from './notices'

export const TICK_MS = 60_000
const SPEND_EVERY_MS = 120_000
const ADAPT_EVERY_MS = 600_000
const PREFLIGHT_EVERY_MS = 60_000
const STEP_TIMEOUT_MS = 30 * 60_000
/** Rounds after the cap that may only park tasks (a park hands nothing over). */
const MAX_PARKS_PER_PASS = 8
/** A gap between ticks this long is a sleeping machine, not a slow tick. */
const SLEEP_GAP_MS = 3 * TICK_MS

export type Store = {
  sealed: Sealed | null
  envWhy: string | null
  loop: LoopState
  badLines: number
  journalBytes: number
  spend: Spend | null
  spendAtMs: number
  /** Why the spend is not known (no tracker, an older one, an unpriced model), or null. */
  spendWhy: string | null
  killed: boolean
  status: string
  preflight: Record<string, Preflight>
  preflightAtMs: number
  hasCheck: boolean
  adaptAtMs: number
  bootMs: number
  isTicking: boolean
  error: string | null
  readAtMs: number
  notices: NoticeDraft[]
  verified: Map<string, EffectFact>
  chain: Promise<unknown>
  isTimerOn: boolean
  /** What the person approved, held outside the project (data/ap-pin.ts). */
  pin: Pin | null
  isPinLoaded: boolean
  /** True while a confirmed Start is writing: the journal may hold one start more than the pin says. */
  isPinPending: boolean
  /** A stop that reached neither the journal nor the flag file (a full disk): held in memory so the next read cannot undo it. */
  heldStop: string | null
  lastTickMs: number
  /** Time each in-flight step is forgiven for the machine having slept, by step id. */
  slack: Record<string, number>
}

const stores = new WeakMap<State, Store>()
const hosts = new WeakMap<State, Host>()
let active: State | null = null

/** The console state the notice slot reads for (one per console). */
export const activeOf = (): State | null => active

const checks = new WeakMap<State, ToolCheck | undefined>()

export const storeOf = (state: State): Store => stores.get(state) ?? stores.set(state, { sealed: null, envWhy: null, loop: emptyLoop(), badLines: 0, journalBytes: 0, spend: null, spendAtMs: 0, spendWhy: null, killed: false, status: 'not wired', preflight: {}, preflightAtMs: 0, hasCheck: false, adaptAtMs: 0, bootMs: Date.now(), isTicking: false, error: null, readAtMs: 0, notices: [], verified: new Map(), chain: Promise.resolve(), isTimerOn: false, pin: null, isPinLoaded: false, isPinPending: false, heldStop: null, lastTickMs: 0, slack: {} }).get(state)!

export const hostOf = (state: State): Host | undefined => hosts.get(state)

const pathOf = (state: State, rel: string): string => `${state.cwd.replace(/\/+$/, '')}/${rel}`

/** What a start says where the write flavor is host-fs (Windows): see the gate in views/ap-panel.ts. */
export const AUTOPILOT_WINDOWS_REFUSAL = 'Autopilot is not yet available on Windows: its journal and path fence need atomic appends and Windows-aware path checks (follow-up).'

/** Wires the host and, when the engine offers one, its permission check (`$.tool.check`); starts the tick timer once. */
export function wireAutopilot(state: State, host: Host, deps: { toolCheck?: ToolCheck } = {}): void {
  hosts.set(state, host)
  active = state
  checks.set(state, deps.toolCheck)

  const store = storeOf(state)

  store.hasCheck = deps.toolCheck !== undefined
  store.status = 'wired'

  if (!store.isTimerOn) {
    store.isTimerOn = true

    try {
      host.every(TICK_MS, () => void apTick(state, host))
    } catch {
      store.error = 'the host refused a timer: autopilot ticks only when asked'
    }
  }

  void refreshAutopilot(state, host)
}

/** Reads the envelope and the journal; never rejects. A file that is too big or not regular is a said problem, not a guess. */
export async function refreshAutopilot(state: State, host: Host, nowMs: number = Date.now()): Promise<void> {
  const store = storeOf(state)

  try {
    const env = await readBounded(host.fs, state.cache, under(state.cwd, ENVELOPE_FILE), 65_536, true)
    const opened = open(env.text)

    store.sealed = opened.ok ? opened.sealed : null
    store.envWhy = opened.ok ? null : env.text === null && env.reason === 'missing' ? null : opened.why

    const journal = await readBounded(host.fs, state.cache, under(state.cwd, JOURNAL_FILE), JOURNAL_MAX_BYTES, true)

    if (journal.text === null) {
      store.loop = journal.reason === 'missing' ? emptyLoop() : store.loop
      store.error = journal.reason === 'missing' ? null : `the journal was not read: ${journal.reason}`
      store.journalBytes = journal.reason === 'too-large' ? (journal.size ?? JOURNAL_MAX_BYTES) : 0
    } else {
      const replayed = replayJournal(journal.text)

      store.loop = replayed.loop
      store.badLines = replayed.bad
      store.journalBytes = journal.text.length
      store.error = null
    }

    store.killed = (await killSeen(host.fs, state.cwd)) || store.heldStop !== null

    if (store.heldStop !== null && store.loop.phase !== 'idle' && store.loop.phase !== 'stopped') store.loop = foldJournal([{ t: 'stop', at: nowMs, reason: store.heldStop }], store.loop)
    store.readAtMs = nowMs
  } catch {
    store.error = 'the autopilot files were not read'
  } finally {
    host.invalidate()
  }
}

/** One append at a time. Resolves false (and says why in `store.error`) when the write did not happen. */
export function appendEvents(state: State, host: Host, events: readonly JournalEvent[]): Promise<boolean> {
  const store = storeOf(state)

  if (events.length === 0) return Promise.resolve(true)

  const job = store.chain.then(async (): Promise<boolean> => {
    try {
      const path = pathOf(state, JOURNAL_FILE)
      const clear = await checkNoLinks(host.fs, path, { cwd: state.cwd }, { allowExisting: true })

      if (!clear.ok) {
        store.error = cleanText(clear.why).slice(0, 100)

        return false
      }

      if ((await host.fs.stat(path).catch(() => undefined)) === undefined) await writeVia(await writeFlavorReady(), host, { kind: 'touch', path })

      const result = await writeVia(await writeFlavorReady(), host, { kind: 'append', path, text: events.map(encodeLine).join('') })

      if (result.exitCode !== 0) {
        store.error = `the journal write exited ${result.exitCode}`

        return false
      }

      state.cache.delete(path) // a file just written is no longer "missing" for the next read
      store.loop = foldJournal(events, store.loop)
      store.error = null
      if (store.pin !== null && store.pin.stopped !== true && events.some(e => e.t === 'stop')) await setPin(store, host, state.cwd, { ...store.pin, stopped: true })

      return true
    } catch {
      store.error = 'the journal write was refused'

      return false
    } finally {
      host.invalidate()
    }
  })

  store.chain = job.catch(() => undefined)

  return job
}

/** Queues a notice (drained by the slot in views/ap-panel.ts) and says it in a toast, which is what reaches a person away from the page. */
function say(state: State, host: Host, draft: NoticeDraft): void {
  const store = storeOf(state)

  store.notices.push({ ...draft, text: cleanText(draft.text).slice(0, 140) })
  store.notices.splice(0, Math.max(0, store.notices.length - 10))

  try {
    host.toast(cleanText(draft.text).slice(0, 120), 8000, draft.level === 'bad' ? 'error' : draft.level)
  } catch {
    // A toast is a courtesy.
  }
}

export const drainNotices = (state: State): NoticeDraft[] => storeOf(state).notices.splice(0)

/** The kill switch and the plain stop: journal a stop AND leave the flag file, so a loop in another session halts too. No confirm: it only narrows authority. */
export async function stopNow(state: State, host: Host, reason = 'stopped by you'): Promise<void> {
  const store = storeOf(state)
  const flag = pathOf(state, KILL_FILE)

  store.loop = foldJournal([{ t: 'stop', at: Date.now(), reason }], store.loop)
  store.killed = true
  host.invalidate()

  const clear = await checkNoLinks(host.fs, flag, { cwd: state.cwd }, { allowExisting: true }).catch(() => ({ ok: false as const, why: 'unchecked' }))
  const flavor = await writeFlavorReady()
  // host-fs: a touch would keep a cleared flag's marker, so the flag is rewritten empty (anything but the marker is a stop).
  const flagged = clear.ok ? await writeVia(flavor, host, flavor === 'host-fs' ? { kind: 'replace', path: flag, text: '', hasDir: true } : { kind: 'touch', path: flag }).then(result => result.exitCode === 0, () => false) : false
  const journaled = await appendEvents(state, host, [{ t: 'stop', at: Date.now(), reason }])

  // Neither write landed (a full disk, a read-only folder): the stop is held in memory so a re-read of the files cannot undo it, and it is said.
  if (!flagged && !journaled) store.heldStop = reason
  say(state, host, { level: 'warn', text: flagged || journaled ? `autopilot stopped: ${reason}` : `autopilot stopped in this session only: the stop could not be written (${reason})`, key: 'ap-stop', go: 'missions' })
}

export async function pauseNow(state: State, host: Host, reason = 'paused by you'): Promise<void> {
  await appendEvents(state, host, [{ t: 'pause', at: Date.now(), reason }])
}

export async function resumeNow(state: State, host: Host): Promise<void> {
  await appendEvents(state, host, [{ t: 'resume', at: Date.now() }])
  void apTick(state, host)
}

export async function answerParked(state: State, host: Host, id: string, answer: 'once' | 'deny'): Promise<void> {
  await appendEvents(state, host, [{ t: 'answered', at: Date.now(), id, answer }])
}

/** Clears the kill flag; part of the confirmed start, never a button of its own. */
export async function clearKill(state: State, host: Host): Promise<unknown> {
  storeOf(state).heldStop = null

  // host-fs has no delete: the flag is rewritten as cleared (killSeen reads it so); everywhere else it is removed.
  if ((await writeFlavorReady()) === 'host-fs') return writeVia('host-fs', host, { kind: 'replace', path: pathOf(state, KILL_FILE), text: KILL_CLEARED, hasDir: true }).catch(() => undefined)

  return host.run(removeFileArgv(pathOf(state, KILL_FILE)), 10_000).catch(() => undefined)
}

/** Writes the sealed envelope (replacing the file). Only the confirmed start/change calls this. */
export async function writeEnvelope(state: State, host: Host, sealed: Sealed): Promise<boolean> {
  const path = pathOf(state, ENVELOPE_FILE)
  const clear = await checkNoLinks(host.fs, path, { cwd: state.cwd }, { allowExisting: true })

  if (!clear.ok) {
    storeOf(state).error = cleanText(clear.why).slice(0, 100)

    return false
  }

  const hasDir = (await host.fs.stat(dirOf(path)).catch(() => undefined)) !== undefined
  const result = await writeVia(await writeFlavorReady(), host, { kind: 'replace', path, text: `${JSON.stringify(sealed, null, 2)}\n`, hasDir })

  if (result.exitCode === 0) {
    state.cache.delete(path)
    storeOf(state).sealed = sealed
  }

  return result.exitCode === 0
}

/**
 * Hands one journaled step to the session. Looked at again HERE (a verify run can take minutes): no kill flag, the phase still running, and
 * the journal, read within its cap, holds exactly one start for this step. The mission's own dispatch does the hand-over; only its
 * one-at-a-time check is replaced by `startable(..., cap)`. Returns true when the prompt went.
 */
async function handOver(state: State, host: Host, mission: MissionRecord, task: LedgerTask, stepId: string, nowMs: number, cap: number): Promise<boolean> {
  const store = storeOf(state)
  const at = pathOf(state, JOURNAL_FILE)
  const size = await host.fs.stat(at).catch(() => undefined)
  const journalNow = size === undefined || size.isLink === true || (size.size ?? JOURNAL_MAX_BYTES + 1) > JOURNAL_MAX_BYTES ? null : await host.fs.read(at).catch(() => null)

  if ((await killSeen(host.fs, state.cwd)) || store.loop.phase === 'stopped' || store.loop.phase === 'paused') {
    await appendEvents(state, host, [{ t: 'step.failed', at: Date.now(), id: stepId, why: 'stopped before the hand-over' }])

    return false
  }

  if (journalNow === null || startedCount(journalNow, stepId) !== 1) {
    await appendEvents(state, host, [{ t: 'step.failed', at: Date.now(), id: stepId, why: 'not handed over: the journal is unreadable, over its cap or holds a second start of this step' }])

    return false
  }

  await dispatchSpec(state, host, mission, task, body => host.submitPrompt(body), (m, tasks, t) => startable(m, tasks, t, cap)).run?.()

  // The dispatch refuses (and says so in the mission view) when the mission moved; that is a step that never started, not a failure to learn from.
  if ((task.dispatchedAtMs ?? 0) < nowMs - 1000) {
    await appendEvents(state, host, [{ t: 'step.failed', at: Date.now(), id: stepId, why: REFUSED_WHY }])

    return false
  }

  return true
}

/** One pass of the loop. Never rejects; a pass that is already running is skipped. */
export async function apTick(state: State, host: Host, nowMs: number = Date.now()): Promise<void> {
  const store = storeOf(state)

  if (store.isTicking) return

  store.isTicking = true

  try {
    await refreshAutopilot(state, host, nowMs)

    await loadPin(store, host, state.cwd)

    // A long gap since the last pass is a machine that slept: steps in flight are forgiven that time before they can count as timed out.
    const gap = store.lastTickMs > 0 ? nowMs - store.lastTickMs : 0

    store.lastTickMs = nowMs

    if (gap > SLEEP_GAP_MS) for (const step of store.loop.steps.filter(entry => entry.status === 'started')) store.slack[step.id] = (store.slack[step.id] ?? 0) + gap

    if (store.heldStop !== null && store.loop.phase === 'stopped' && (await appendEvents(state, host, [{ t: 'stop', at: nowMs, reason: store.heldStop }]))) store.heldStop = null

    const loop = store.loop
    const pinned = checkPin(store.pin, loop, store.isPinPending)

    if (!pinned.ok && loop.phase !== 'stopped') {
      await stopNow(state, host, pinned.why)
      store.status = `stopped: ${pinned.why}`

      return
    }

    if (loop.phase === 'idle') {
      store.status = 'not started'

      return
    }

    if (store.killed && loop.phase !== 'stopped') {
      await appendEvents(state, host, [{ t: 'stop', at: nowMs, reason: 'kill switch' }])
      say(state, host, { level: 'warn', text: 'autopilot halted by the kill switch', key: 'ap-kill', go: 'missions' })
      store.status = 'stopped: kill switch'

      return
    }

    const sealed = store.sealed
    const env = sealed !== null && sealed.hash === loop.envHash ? sealed.envelope : null
    const mission = activeMission(state)

    if (nowMs - store.spendAtMs >= SPEND_EVERY_MS && loop.phase === 'running' && loop.startedAtMs !== null) {
      const reading = await readSpend(state, host, loop.startedAtMs, nowMs)

      store.spend = reading.spend
      store.spendWhy = reading.why
      store.spendAtMs = nowMs
    }

    if (nowMs - store.preflightAtMs >= PREFLIGHT_EVERY_MS) {
      store.preflight = await preflightAll(checks.get(state), env)
      store.preflightAtMs = nowMs
    }

    const tunables = env === null ? null : tunablesFrom(loop.receipts, env)
    // How many steps may be in flight: the envelope's cap, narrowed by adaptation. The mission's own rules (dependencies, nothing past a failed task, no paused or cancelled mission) are kept by `startable`.
    const cap = env === null || tunables === null ? 1 : Math.max(1, Math.min(env.concurrency, tunables.parallelism))
    const effects = env === null ? {} : await effectsOf(state, host, store, checks.get(state), loop, mission, env)
    const orphans = new Set(loop.steps.filter(step => step.status === 'started' && step.startedAt < store.bootMs).map(step => step.id))
    let handed = 0

    // One step is decided, journaled and handed over per round; the loop goes round again while there is room (up to the cap) and after a park (so a parked task does not hold the others back).
    for (let round = 0; round < cap + MAX_PARKS_PER_PASS && handed < cap; round++) {
      const picked = mission === null || mission.cancelled ? null : pickTask(mission, state, skipSet(store.loop), cap)

      const facts: Facts = {
        nowMs,
        killSeen: store.killed,
        envelope: env,
        anatole: anatoleFact(state.snapshot?.anatole, nowMs),
        spend: store.spend,
        task: picked?.fact ?? null,
        effects,
        orphans,
        tunables: { parallelism: tunables?.parallelism ?? 1, retries: tunables?.retries ?? 0, stepTimeoutMs: STEP_TIMEOUT_MS, tierOf: cls => (tunables === null ? 'mid' : tierOf(tunables, cls)) },
        preflight: store.preflight,
        slack: store.slack,
      }

      let decision = tick(store.loop, facts)

      // Stop or pause may have been pressed while the facts were gathered (a verify command can run for minutes): the person's later word wins, and nothing starts.
      if (decision.act !== null && (store.killed || (await killSeen(host.fs, state.cwd)) || store.loop.phase !== 'running')) decision = { events: decision.events.filter(event => event.t !== 'step.started'), act: null, status: 'stopped or paused while this pass ran: nothing started' }

      store.status = decision.status.startsWith('waiting: spend not read') && store.spendWhy !== null ? `waiting: spend not read: ${store.spendWhy}` : decision.status

      // The decision is journaled BEFORE the step is handed over: a crash between the two leaves a started step that the next pass settles by its effect, never a step that ran unrecorded.
      const wrote = await appendEvents(state, host, decision.events)

      for (const event of wrote ? decision.events : []) {
        if (event.t === 'stop' || event.t === 'pause') say(state, host, { level: event.t === 'stop' ? 'bad' : 'warn', text: `autopilot ${event.t === 'stop' ? 'stopped' : 'paused'}: ${event.reason}`, key: `ap-${event.t}`, go: 'missions' })
        if (event.t === 'parked') say(state, host, { level: 'info', text: `autopilot parked ${event.task}: a question is waiting`, key: `ap-park-${event.task}`, go: 'missions' })
      }

      if (!wrote) break

      if (decision.act === null || mission === null || picked === null) {
        if (decision.events.some(event => event.t === 'parked')) continue

        break
      }

      if (await handOver(state, host, mission, picked.ledger, decision.act.id, nowMs, cap)) handed += 1
      else break
    }

    if (env !== null && tunables !== null && store.loop.phase === 'running' && nowMs - store.adaptAtMs >= ADAPT_EVERY_MS) {
      store.adaptAtMs = nowMs
      await adaptPass(store, host, env, nowMs, events => appendEvents(state, host, events))
    }

    const day = new Date(nowMs).toISOString().slice(0, 10)

    if (store.loop.phase === 'running' && store.loop.lastDigestDay !== day && store.loop.lastDigestDay !== null) {
      await appendEvents(state, host, [{ t: 'digest', at: nowMs, day }])
      say(state, host, { level: 'info', text: digestText(store.loop, nowMs, store.spend?.dayUsd ?? null), key: `ap-digest-${day}`, go: 'missions' })
    } else if (store.loop.lastDigestDay === null && store.loop.phase === 'running') await appendEvents(state, host, [{ t: 'digest', at: nowMs, day }])

    if (store.journalBytes > JOURNAL_MAX_BYTES * 0.8) await rotate(store, host, state.cwd, nowMs)
  } catch {
    store.error = 'a tick failed; nothing was started'
  } finally {
    store.isTicking = false
    host.invalidate()
  }
}

export { AUTOPILOT_DIR, setPin }
