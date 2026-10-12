/**
 * Runs what the person asked for: a palette entry, a claims button, an approval. A change waits for a confirm (y, or
 * `/ruflo yes`) and then runs one fixed argv through the ruflo CLI, after which the disk is re-read to say whether it
 * took; a read runs at once and shows what it printed. Nothing reaches `$` but through the Host.
 */
import { LONG_TEXT_MAX } from './full-text'
import { textRefusal } from './ops'
import type { ActionSpec } from './actions'
import { rememberKey } from './remember'
import { record } from './data/events'
import { plain } from './data/parse'
import { answerFailed, failureReason, judgeFindings } from './data/failure'
import type { Host } from './host'
import { labLines } from './mh-lab'
import { outputLines } from './ops'
import { filterPalette, paletteEntries, textOfQuery, type PaletteEntry } from './palette'
import { COLD_TIMEOUT_MS, explainFailure, FIRST_RUN_LABEL, forgetLauncher, resolveLauncher } from './launcher'
import type { Pending, State } from './state'
import { prettyLines } from './result-lines'

export const PENDING_TTL_MS = 30_000

/** The state.timers key of the expiry timer, so the controller's stop and close cancel it with the rest. */
export const EXPIRY_TIMER = 'pending-expiry'
/** A typed Yes (`/ruflo yes`, bound to no card) is refused this soon after Claude raised the card, or after a card left unanswered. */
export const UNBOUND_FRESH_MS = 3_000
export const UNBOUND_REPLACED_MS = 10_000
/** Claude may withdraw at most this many asks per minute, and may not re-ask the same label this soon after withdrawing it. */
export const WITHDRAW_MAX_PER_MIN = 3
export const REASK_COOLDOWN_MS = 10_000

/** True when a waiting card has outlived its window: a Yes for it would be refused, so it only blocks the next ask. */
export const isStale = (pending: Pick<Pending, 'askedAtMs'>, nowMs = Date.now()): boolean => nowMs - pending.askedAtMs >= PENDING_TTL_MS

export type RunnerDeps = {
  /** A read of the disk that starts after this call. */
  freshRead: () => Promise<void>
  setView: (view: State['view']) => void
  drill: (agentId: string) => void
  command: (name: 'refresh' | 'help' | 'close') => void
  /** Why an ask of Claude's that landed after its tool call returned (it was screened first) may no longer be queued: the level was lowered, or Stop pressed, meanwhile. Null when it still may. */
  landingRefusal?: (pending: Pending) => string | null
}

export type Runner = {
  ask: (spec: ActionSpec | null, why: string) => void
  /** `seen` is the id of the card the person said Yes to: when another card took its place meanwhile, nothing runs and the new card stays (ADR-450 T17). */
  confirm: (seen?: number) => Promise<void>
  cancel: () => void
  /** Clears a card left past PENDING_TTL_MS, unrun, with one event and an "expired: ask again" outcome. True when it cleared one. */
  expireStale: (nowMs?: number) => boolean
  /** Clears the waiting card only when Claude raised it; the person's own card is never withdrawn. True when it cleared one. */
  withdraw: () => boolean
  /** Why Claude may not withdraw the waiting card now, or null when it may. */
  withdrawRefusal: () => string | null
  runEntry: (entry: PaletteEntry, text: string) => void
  /** `exact` (the model path, ADR-450 T13) resolves the id as written and never falls back to fuzzy matching. */
  runById: (id: string, text: string, options?: { exact?: boolean; direct?: boolean }) => boolean
  /** A Yes typed with no card id (`/ruflo yes`): refused while the card is too new or just replaced one, else it answers the card waiting now. */
  confirmUnbound: (card?: number) => Promise<void>
  /** Resolves when the read started last has finished: `/ruflo run` waits on it to answer with what it printed. */
  settled: () => Promise<void>
  /** Resolves when the last action that brought its own `run` (and is not awaited by `confirm`) has finished: the model tools wait on it, with a limit. */
  finished: () => Promise<void>
}

export function createRunner(state: State, host: Host, deps: RunnerDeps): Runner {
  let pendingSpec: ActionSpec | null = null
  let asks = 0
  let inflight: Promise<void> = Promise.resolve()
  let background: Promise<void> = Promise.resolve()
  // The card Claude raised by its own direct console_run (its id), the only one it may withdraw; set while runById({ direct }) runs.
  let directCardId: number | null = null
  let isDirectRun = false
  // When a card last left with no answer from the person (expired or withdrawn): a typed Yes soon after may be meant for it.
  let goneUnansweredAtMs = -Infinity
  const withdrawals: { label: string; atMs: number }[] = []

  const say = (label: string, ok: boolean, detail: string, lines?: string[]) => {
    state.outcome = { label, ok, verified: 'n/a', detail, atMs: Date.now(), ...(lines !== undefined && { lines }) }
    host.invalidate()
  }

  async function execute(spec: ActionSpec): Promise<void> {
    // A harness run reports into the terminal and may take minutes: it does not hold the other buttons.
    if (spec.run !== undefined) {
      // The outcome slot as this run starts. Every writer replaces the object (never edits it), so "still this object" means no other
      // action reported meanwhile: exact, where comparing millisecond stamps let a same-millisecond result be overwritten.
      const outcomeAtStart = state.outcome
      const running = spec.run()

      // A run that answers how it ended becomes the outcome when it ends, however long after the confirm that is: the page shows it on its
      // own panel, and this is the one place console_state and `/ruflo yes` read (a long mission create used to leave an older result there).
      // One outcome per action: when another action reported meanwhile, its outcome stays, and this one goes to the Events feed instead.
      background = running.then(report => {
        if (report === undefined || report === null) return
        if (state.outcome === outcomeAtStart) say(report.label, report.ok, report.detail, report.lines)
        else record(state.events, [{ atMs: Date.now(), kind: 'tools', text: `${report.ok ? '✓' : '✗'} ${plain(report.label, 80)}: ${plain(report.detail, 160)} (finished after a newer result)` }])
      }, () => undefined)

      // A read that runs its own command (a skills search) is waited on, so `/ruflo run` answers with what it found.
      if (spec.isReadOnly === true) await running

      return
    }

    // The x.ruv.io board keeps its own result panel, so its runs never show in the MetaHarness lab.
    const panel = spec.board === 'xruv' ? state.xruv : state.lab

    let lastArgv: readonly string[] = spec.argv ?? []

    state.isActing = true
    if (spec.lab !== undefined) panel.running = { id: spec.lab, label: spec.label, startedAtMs: Date.now() }
    host.invalidate()

    try {
      // A CLI action picks its launcher once per session; a cold npx download gets a long limit and says it is a first run.
      const launcher = spec.argv === undefined ? await resolveLauncher(host, state) : null
      const argv = spec.argv ?? [...(launcher?.prefix ?? []), ...spec.args]
      const isCold = launcher?.kind === 'cold'

      lastArgv = argv

      if (isCold) say(spec.label, true, FIRST_RUN_LABEL)
      const result = await host.run(argv, isCold ? Math.max(spec.timeoutMs ?? 0, COLD_TIMEOUT_MS) : spec.timeoutMs ?? 90_000, spec.stdin)

      // A verdict command's "found something" exit with its JSON answer is an answer (`spec.findings`): the CLI was
      // reached, so the launcher is kept, and the run is not a failure. Any other non-zero exit is one.
      // The answer counts only when it is complete, nothing outside it reports a failure (judgeFindings), and it agrees
      // with the exit: a "found something" exit whose answer found nothing is not consistent, so it stays a failure.
      const judged = judgeFindings(spec.findings, result)
      const verdict = judged.answer
      const isFinding = verdict !== null && result.exitCode !== 0 && spec.findings?.exits.includes(result.exitCode) === true && spec.findings.found(verdict)
      const inconsistent = verdict !== null && !isFinding && spec.findings?.exits.includes(result.exitCode) === true ? `exit ${result.exitCode}, but its answer does not say it found something` : undefined
      const answered = result.exitCode === 0 || isFinding

      if (!answered) forgetLauncher(state)
      const answer = /"success"\s*:\s*(true|false)/.exec(result.stdout)?.[1]
      const error = /"error"\s*:\s*"([^"]{0,160})"/.exec(result.stdout)?.[1] ?? /\[ERROR\]\s*(.{0,160})/.exec(result.stdout)?.[1]
      // A verdict answer is judged by its own top-level keys: it quotes the hostile text, so a substring search would fail it.
      // Other output keeps the substring checks; `mcp exec` wraps a tool's failure as `"isError": true` with its message escaped inside.
      const ok = answered && (verdict !== null ? !answerFailed(verdict) : answer !== 'false' && error === undefined && !/"isError"\s*:\s*true/.test(result.stdout))
      const why = () => explainFailure(argv, result) ?? ((result.exitCode !== 0 ? judged.reason ?? inconsistent : undefined) || failureReason(result) || `exit ${result.exitCode}`)
      // A reader sees the answer itself when there is one, so a banner object printed before it is not what it draws.
      const shown = verdict !== null ? JSON.stringify(verdict) : result.stdout
      let head: string | undefined

      // A lab run's output goes to the lab's result panel, scrolled from its top; the footer keeps the one-line outcome.
      if (spec.lab !== undefined) {
        const lines = prettyLines(spec.read?.(shown, result.stderr, ok) ?? (spec.lines ?? ((out, err) => labLines(spec.lab ?? '', out, err)))(shown, result.stderr))

        panel.result = { id: spec.lab, label: spec.label, ok, exitCode: result.exitCode, ...(spec.note !== undefined && { note: spec.note }), lines, atMs: Date.now() }
        state.select.item = 0
        head = lines[0] === undefined ? undefined : plain(lines[0], 120)
      }
      // The one-line outcome carries the verdict, so `console_run` and `console_state` answer with it (UNSAFE · 2 threats).
      const said = isFinding ? `answered: ${head ?? 'findings in its JSON'} (exit ${result.exitCode} means it found something)` : head !== undefined ? `answered: ${head}` : null
      // Keyed on the exit, not on `ok`: relay text in a read may carry an "error" key of its own.
      if (answered) spec.onOutput?.(result.stdout)

      if (spec.isReadOnly === true) {
        say(spec.label, ok, ok ? said ?? 'the ruflo CLI answered:' : why(), spec.lab === undefined ? outputLines(result.stdout) : undefined)

        return
      }

      await deps.freshRead()

      const verified = spec.verifyLocal !== undefined
        ? ok && await spec.verifyLocal(host) ? 'yes' : 'no'
        : spec.verify === undefined || state.snapshot === null ? 'n/a' : spec.verify(state.snapshot) ? 'yes' : 'no'

      state.outcome = {
        label: spec.label,
        ok: ok && verified !== 'no',
        verified,
        detail: ok ? `${spec.argv === undefined ? 'ruflo' : 'the command'} ${said ?? 'answered ok'}; expected ${spec.expect}` : why(),
        atMs: Date.now(),
      }
    } catch (error) {
      forgetLauncher(state)

      const why = explainFailure(lastArgv, { error }) ?? (plain(error instanceof Error ? error.message : String(error), 160) || 'refused')

      if (spec.lab !== undefined) panel.result = { id: spec.lab, label: spec.label, ok: false, exitCode: null, ...(spec.note !== undefined && { note: spec.note }), lines: [why], atMs: Date.now() }
      say(spec.label, false, why)
    } finally {
      state.isActing = false
      panel.running = null
      host.invalidate()
    }
  }

  /** Forgets the waiting card and its expiry timer (kept in state.timers, so closing the console cancels it too). */
  function clear(): void {
    state.timers.get(EXPIRY_TIMER)?.cancel()
    state.timers.delete(EXPIRY_TIMER)
    directCardId = null
    pendingSpec = null
    state.pending = null
  }

  function expireStale(nowMs = Date.now()): boolean {
    const pending = state.pending

    if (pending === null || !isStale(pending, nowMs)) return false

    clear()
    goneUnansweredAtMs = nowMs
    say(pending.label, false, `expired: ask again. Nobody answered within ${PENDING_TTL_MS / 1000} s, so it did not run`)
    if (state.outcome !== null) state.outcome.expired = true
    record(state.events, [{ atMs: nowMs, kind: 'tools', text: `ask for "${plain(pending.label, 60)}" expired after ${PENDING_TTL_MS / 1000} s, not run` }])

    return true
  }

  /**
   * Why Claude may not withdraw the waiting card, or null when it may. Only its own direct console_run ask, matched by id, and only of the write class:
   * a spend, install, network or delete card is one the person must see, and it now leaves by itself at the window. At most a few per minute.
   */
  function withdrawRefusal(nowMs = Date.now()): string | null {
    const pending = state.pending

    if (pending === null) return 'nothing is waiting'
    if (!state.control.viaModel) return 'only Claude withdraws its own ask; the person answers a card with Yes or No'
    if (pending.source !== 'claude' || pending.origin !== 'console_run' || pending.id === undefined || pending.id !== directCardId) return 'that card was not raised by your own console_run: only the person answers it'
    if (pending.kind !== 'write') return `it is a ${pending.kind ?? 'unclassed'} action the person must see; it expires by itself ${PENDING_TTL_MS / 1000} s after the ask`
    if (withdrawals.filter(entry => nowMs - entry.atMs < 60_000).length >= WITHDRAW_MAX_PER_MIN) return `${WITHDRAW_MAX_PER_MIN} asks were withdrawn in the last minute: leave this one to the person`

    return null
  }

  function withdraw(): boolean {
    const pending = state.pending
    const nowMs = Date.now()
    const refused = withdrawRefusal(nowMs)

    if (pending === null || refused !== null) {
      say('withdraw', false, `not withdrawn: ${refused ?? 'nothing is waiting'}`)

      return false
    }

    clear()
    goneUnansweredAtMs = nowMs
    withdrawals.push({ label: pending.label, atMs: nowMs })
    if (withdrawals.length > 20) withdrawals.shift()
    say('withdrawn ask', true, `withdrew "${plain(pending.label, 80)}": it did not run`)
    record(state.events, [{ atMs: nowMs, kind: 'tools', text: `Claude withdrew its ask "${plain(pending.label, 60)}", not run` }])

    return true
  }

  function ask(spec: ActionSpec | null, why: string): void {
    state.palette.isOpen = false
    // A card left past its window blocks nothing: it is cleared (and said so) before this ask is looked at.
    expireStale()
    // Where this came from: the page puts the confirm and the answer right after that element. A headless run has no press, so it falls back to the top.
    state.origin = state.lastPressed
    state.lastPressed = null

    if (spec === null) {
      clear()
      say('nothing to do', false, why)

      return
    }

    // Claude's call is held to the gate, whatever the entry says about itself: a "read-only" entry that declares it spends, writes or reaches the
    // network is queued for the level, budget and confirm checks (callTool), not run (#3815). The person's own click is unchanged.
    const byModel = spec.byModel === true || state.control.viaModel
    const isActingForModel = byModel && spec.isReadOnly === true && spec.declared !== undefined

    if (spec.isReadOnly === true && !isActingForModel) {
      inflight = execute(spec)

      return
    }

    // Withdrawing and asking again is not a loop Claude can run: the same ask waits out a cooldown after its withdrawal.
    const withdrawn = byModel ? withdrawals.find(entry => entry.label === spec.label && Date.now() - entry.atMs < REASK_COOLDOWN_MS) : undefined

    if (withdrawn !== undefined) {
      say('not queued', false, `Claude withdrew this same ask ${Math.round((Date.now() - withdrawn.atMs) / 1000)} s ago: wait ${REASK_COOLDOWN_MS / 1000} s, or leave it to the person`)

      return
    }

    // Claude's ask never replaces what the person has waiting: their Yes would run Claude's action instead of the one they read (ADR-450 T17).
    if (byModel && state.pending !== null) {
      say('not queued', false, `an action is already waiting for the person ("${plain(state.pending.label, 80)}"): Claude's request was dropped`)

      return
    }

    // A kind of action the person said never to ask about again runs now, its label saying so. That answer is the person's: an action
    // Claude asked for (ADR-444) still goes through the pending path, where the control level and the confirm mode decide.
    const kind = rememberKey(spec)

    if (kind !== null && state.allowed.has(kind) && !byModel) {
      inflight = execute({ ...spec, label: `${spec.label} (remembered: not asked)` })

      return
    }

    asks += 1

    // Only an ask raised inside Claude's own console_run call (not one that landed later after a screen, nor a mission follow-up) is Claude's to withdraw.
    const isDirect = isDirectRun && state.control.viaModel && spec.byModel !== true
    // The Claude call that started this ask: named by the spec when the ask landed later, else the call whose synchronous start is running now.
    const byCall = byModel ? (spec.byCall ?? (state.control.viaModel ? (state.control.callTag ?? undefined) : undefined)) : undefined
    const pending: Pending = { id: asks, view: state.view, ...(isDirect && { origin: 'console_run' as const }), ...(byCall !== undefined && { byCall }), ...(kind !== null && { rememberKey: kind }), ...(spec.scope !== undefined && { scope: spec.scope }), label: spec.label, args: spec.args, expect: spec.expect, askedAtMs: Date.now(), source: byModel ? 'claude' : 'you', ...(spec.shows !== undefined && { shows: spec.shows }), ...(spec.note !== undefined && { note: spec.note }), ...(spec.declared !== undefined && { declared: spec.declared }) }

    // Claude's ask that was screened first lands after every tool call of Claude's returned, so no call is left to gate it: the level and Stop are
    // checked now, not as they were when it was raised, and a refused ask is not queued (nothing waits for a Yes the settings no longer allow).
    // While a call runs, that call's settlePending gates the ask with the same rules.
    if (spec.byModel === true && state.control.activeCalls === 0) {
      const refused = state.control.paused ? 'the person took control back' : deps.landingRefusal?.(pending) ?? null

      if (refused !== null) {
        say(spec.label, false, `Claude's ask was not queued: ${refused}`)

        return
      }
    }

    // Only the person's own press replaces a card here (Claude's ask over a waiting card was dropped above): their typed Yes is for this new card.
    clear()
    pendingSpec = spec
    state.pending = pending
    if (isDirect) directCardId = asks
    // At the window's end the card is cleared on the console's clock, so it never sits past it blocking every other ask.
    if (typeof host.after === 'function') state.timers.set(EXPIRY_TIMER, host.after(PENDING_TTL_MS + 250, () => void expireStale()))
    host.invalidate()
  }

  async function confirm(seen?: number): Promise<void> {
    // The Yes answers the card the person read. Another card (the person's own, or Claude's) may have taken its place before the press landed:
    // that Yes runs nothing, and the new card stays to be read.
    if (seen !== undefined && state.pending !== null && state.pending.id !== seen) {
      say(state.pending.label, false, 'the card changed before your Yes: read the new one, then answer it')
      record(state.events, [{ atMs: Date.now(), kind: 'tools', text: `a Yes for card ${seen} was ignored: card ${state.pending.id ?? '?'} ("${plain(state.pending.label, 60)}") is waiting now` }])

      return
    }

    // A card Claude raised is run only if Claude may still ask for it: a level lowered (or Stop pressed) after the card went up wins over the
    // Yes, which would otherwise run something the settings no longer allow Claude to start. The person can run it themselves from the palette.
    const claudes = state.pending?.source === 'claude' ? deps.landingRefusal?.(state.pending) ?? (state.control.paused ? 'the person took control back' : null) : null

    if (claudes !== null && state.pending !== null) {
      const label = state.pending.label

      clear()
      say(label, false, `not run: ${claudes}. Run it from the palette yourself if you want it`)
      record(state.events, [{ atMs: Date.now(), kind: 'tools', text: `Claude's card "${plain(label, 60)}" was not run: ${claudes}` }])

      return
    }

    const spec = pendingSpec
    const isFresh = state.pending !== null && Date.now() - state.pending.askedAtMs < PENDING_TTL_MS

    const waitedMs = state.pending === null ? 0 : Date.now() - state.pending.askedAtMs

    clear()

    if (spec === null || !isFresh || state.isActing) {
      if (spec !== null && !isFresh) {
        say(spec.label, false, 'the confirm came more than 30 s after the ask; ask again')
        // `say` is one slot that the next action overwrites; the event stays in the feed (ADR-448 §3.2).
        record(state.events, [{ atMs: Date.now(), kind: 'tools', text: `confirm for "${plain(spec.label, 60)}" came ${Math.round(waitedMs / 1000)}s after the ask and was not run (${PENDING_TTL_MS / 1000}s window)` }])
      }

      host.invalidate()

      return
    }

    await execute(spec)
  }

  async function confirmUnbound(card?: number): Promise<void> {
    const pending = state.pending
    const nowMs = Date.now()

    if (pending === null) return confirm(card)

    // `/ruflo yes <id>` names its card: it answers that card or nothing (confirm refuses when another card took its place).
    if (card !== undefined) return confirm(card)

    // A bare Yes names no card, so it answers only the card the person was shown: drawn in a pane they can see, or named in the answer to their
    // own typed ask. Any other card is a stranger to them, however it got there (Claude's ask, or one that replaced the card they read).
    if (state.shownCard !== pending.id) {
      say(pending.label, false, `not run: card ${pending.id ?? '?'} ("${plain(pending.label, 60)}") was not put in front of you, so a bare yes may be meant for another. Read it in the console and press Yes on it, or type /ruflo yes ${pending.id ?? '<id>'}`)
      record(state.events, [{ atMs: nowMs, kind: 'tools', text: `a typed yes did not run "${plain(pending.label, 60)}": the card had not been shown to the person` }])

      return
    }

    // A card Claude has only just raised, or one that took the place of a card that left unanswered, is answered on the card itself (its button
    // or y), or by its id.
    const isNewClaude = pending.source === 'claude' && nowMs - pending.askedAtMs < UNBOUND_FRESH_MS
    const isReplacement = nowMs - goneUnansweredAtMs < UNBOUND_REPLACED_MS

    if (isNewClaude || isReplacement) {
      say(pending.label, false, `not run: ${isNewClaude ? 'Claude raised this card a moment ago' : 'this card replaced one that left unanswered a moment ago'}, so a typed yes may be meant for another. Read it and press Yes on the card itself, or type /ruflo yes ${pending.id ?? '<id>'}`)
      record(state.events, [{ atMs: nowMs, kind: 'tools', text: `a typed yes did not run "${plain(pending.label, 60)}": the card was new or had just replaced another` }])

      return
    }

    return confirm(pending.id)
  }

  function cancel(): void {
    clear()
    host.invalidate()
  }

  function runEntry(entry: PaletteEntry, text: string): void {
    state.palette.isOpen = false

    switch (entry.run.kind) {
      case 'spec':
        ask(entry.run.spec, entry.run.why)
        break
      case 'text': {
        // Over every limit: refused with the exact count, before anything runs; the palette keeps the text (ADR-481).
        const tooLong = textRefusal(text, 'the text', LONG_TEXT_MAX)

        if (tooLong !== null) {
          state.palette.isOpen = true
          say('text too long', false, tooLong)
          break
        }

        const spec = entry.run.make(text)
        // A command argument carries less than a prompt: when the entry refused only for that, say by how much.
        const argvWhy = spec === null ? textRefusal(text) : null

        ask(spec, argvWhy ?? entry.run.why?.(text) ?? `type "${entry.run.keyword} <text>"; text may not start with -`)
        break
      }
      case 'view':
        deps.setView(entry.run.view)
        break
      case 'drill':
        deps.drill(entry.run.agentId)
        break
      case 'command':
        if (entry.run.name === 'withdraw') withdraw()
        else deps.command(entry.run.name)
        break
    }

    host.invalidate()
  }

  /** A palette entry by its id (`/ruflo run <id> [text]`, an approval's button): false when there is none now. */
  function runById(id: string, text: string, options: { exact?: boolean; direct?: boolean } = {}): boolean {
    const entries = paletteEntries(state, Date.now())
    const entry = entries.find(candidate => candidate.id === id) ?? (text === '' || options.exact === true ? undefined : filterPalette(entries, `${id} ${text}`, 'all')[0])

    if (entry === undefined) return false

    isDirectRun = options.direct === true

    try {
      runEntry(entry, entry.run.kind === 'text' ? textOfQuery(`${id} ${text}`, entry.run.keyword) : text)
    } finally {
      isDirectRun = false
    }

    return true
  }

  return { ask, confirm, confirmUnbound, cancel, expireStale, withdraw, withdrawRefusal: () => withdrawRefusal(), runEntry, runById, settled: () => inflight, finished: () => background }
}
