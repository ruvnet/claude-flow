/**
 * Everything the console does over time, as plain functions over a Host: the disk refresh and the event diff, the CLI
 * probes, the pane's lifecycle (auto-open without taking the keys), and the animation loop. Actions go through
 * ./runner. Nothing here reaches `$` but through the Host.
 */
import { actionsOf } from './bindings'
import type { Catalog } from './data/catalog'
import { PROBES, probeArgv, probeError, probeReady, type ProbeResult } from './data/cli'
import { ALL_COST_PROBES as COST_PROBES } from './data/cost-probes'
import { memmapProbe } from './data/memmap'
import { memoryHealthProbe } from './data/memory-health'
import { X_PROBES } from './data/xruv'
import { diffEvents, record } from './data/events'
import { agentName, announceChanges, factsOf, segmentOf, TOASTED_KEYS } from './notices'
import { plain } from './data/parse'
import { readSnapshot } from './data/snapshot'
import { sayGroundingHint } from './grounding'
import { markPicture } from './gfx/pictures'
import type { Host } from './host'
import { agentLogs } from './ops'
import { landingRefusal } from './model-tools'
import { createRunner, EXPIRY_TIMER, type Runner } from './runner'
import { advance, loadLedger, mcOf } from './mission-control'
import { hasLiveWork } from './mission-list'
import { loadAllowed } from './remember'
import { loadAiPrefs } from './settings'
import { openLoaders } from './view-open'
import { listSkills } from './skills'
import { readDrillLogs } from './drill-logs'
import { entryAge } from './menu-entry'
import { BOOT_MIN_MS, CLI_PREFIXES, isBooting, NAV_KEY, NAV_STYLES, PANE_ID, push, rowsOf, storeKeyOf, type State } from './state'
import type { Actions } from './views/common'
import { picturesOf } from './views/frames'
import { pulseDue } from './pulse'
import { refreshWorkflows } from './wf-live'
import { syncWhatsNew } from './whatsnew'
import { syncAdrDigest } from './adr-mission'

const ACTIVITY_BUCKET_MS = 5_000
const PANE_WATCH_MS = 1_000
const MAX_PARALLEL_PROBES = 2
const ALL_PROBES = [...PROBES, ...X_PROBES, ...COST_PROBES, memmapProbe, memoryHealthProbe] // CLI probes, the x.ruv.io board's network reads, cost, the memory map's list: one cadence and option gate
const BAR_FRESH_MS = 10_000
const IDLE_REFRESH_MS = 30_000
const TOOLS_RECOUNT_MS = 30_000

export type Controller = {
  refresh: () => Promise<void>
  probe: (force?: boolean) => Promise<void>
  start: () => void
  /** Restarts the pane's watch after a reload left the pane up and the timers gone. */
  resume: () => void
  stop: () => void
  open: (focus?: boolean) => Promise<{ isPlaced: boolean; reason: string }>
  /** At session start, with `panel: auto`: opens where it docks, never taking the keys; else leaves a hint. */
  autoOpen: () => void
  /** The person closed the pane (Esc, its mark): auto-open stands down until /ruflo opens it again. */
  closedByPerson: () => void
  close: () => Promise<void>
  setView: (view: State['view']) => void
  drill: (agentId: string) => void
  animate: () => void
  noteToolCall: (agentId: string | undefined, tool: string) => void
  actions: Actions
  runner: Runner
  host: Host
  /** The command catalog, once `/ruflo commands` has read it. */
  catalog?: Promise<Catalog>
  /** Blits the band's mark while Claude works; the band calls it with its requestId. */
  markFrame: (requestId: string, isWorking: boolean) => void
}

export function createController(state: State, host: Host): Controller {
  let activityCount = 0
  let markRequest: string | null = null
  let lastSegment: string | null | undefined
  let lastSpend: number | undefined
  let hasDrawn = false
  let toolsCountedAt = 0
  let inflight: Promise<void> | null = null
  const lastAttempt = new Map<string, number>()

  const persist = () => void host.storeSet(storeKeyOf(state.cwd), { view: state.view === 'agent' ? state.back : state.view, isClosedByPerson: state.pane.isClosedByPerson }).catch(() => undefined)
  const isVisible = () => state.pane.isOpen && state.pane.isShown

  function refresh(): Promise<void> {
    inflight ??= readAll().finally(() => {
      inflight = null
    })

    return inflight
  }

  /** A read that starts after this call: what an action checks, since a read already running may predate its write. */
  async function freshRead(): Promise<void> {
    await inflight?.catch(() => undefined)

    // A file the action just created must not wait out the missing-file backoff.
    for (const [path, held] of state.cache) {
      if ('missingUntilMs' in held) state.cache.delete(path)
    }

    await refresh()
  }

  async function readAll(): Promise<void> {
    state.isRefreshing = true

    const started = Date.now()

    try {
      // Claude Code connects MCP servers after the session starts: count the ruflo tools again now and then.
      if (Date.now() - toolsCountedAt >= TOOLS_RECOUNT_MS) {
        toolsCountedAt = Date.now()
        void host.rufloTools().then(counted => void (state.rufloTools = counted), () => undefined)
      }

      const [settings, usage, ruflo, route] = await Promise.all([
        host.settings().catch(() => null),
        host.usage().catch(() => null),
        host.rufloSnapshot().catch((error: unknown) => {
          state.ruflo.error = plain(String(error), 120)

          return null
        }),
        host.rufloRoute().catch(() => null),
      ])
      const previous = state.snapshot
      const now = Date.now()
      const snapshot = await readSnapshot(host.fs, state.cache, state.cwd, state.home, settings, now, state.configDir, state.options.federationNetwork)
      if (snapshot.hasNostrKey === false) state.nostrKeyVerifiedAtMs = null
      // What changed since the last read is announced on the band (the first read announces nothing).
      const before = previous === null ? null : factsOf(state, now)

      state.snapshot = snapshot
      syncWhatsNew(state, host)
      void syncAdrDigest(state, host).catch(() => undefined)
      sayGroundingHint(state, host)
      record(state.events, diffEvents(previous, snapshot, now))

      // A mission that finished or lost a task is said in a toast too: the band's notice row reaches only a person looking at the console.
      if (before !== null) for (const draft of announceChanges(state, before, now)) if (TOASTED_KEYS.has(draft.key)) host.toast(draft.text.slice(0, 120), 8000, draft.level === 'bad' ? 'error' : draft.level)

      if (route !== null && route.agent !== state.ruflo.route?.agent) record(state.events, [{ atMs: now, kind: 'learning', text: `router picked ${route.agent} (${Math.round(route.confidence * 100)}%)` }])

      state.usage = usage
      state.ruflo.snapshot = ruflo
      state.ruflo.route = route ?? ruflo?.lastRoute ?? null
      push(state.writes, snapshot.changed)
      for (const agent of snapshot.agents.slice(0, 200)) {
        const log = state.statusLog.get(agent.id) ?? []

        if (log.at(-1)?.status !== agent.status) push(log, { atMs: now, status: agent.status }, 100)
        state.statusLog.set(agent.id, log)
      }

      const patterns = snapshot.neural?.patterns
      if (patterns !== undefined && state.history.patterns.at(-1)?.value !== patterns) push(state.history.patterns, { atMs: now, value: patterns })
      if (usage?.costUsd !== undefined && state.history.spend.at(-1)?.value !== usage.costUsd) push(state.history.spend, { atMs: now, value: usage.costUsd })
      if ((snapshot.outcomes?.total ?? 0) > state.history.outcomes) {
        if (state.history.outcomes > 0) state.curveGrewAtMs = now
        state.history.outcomes = snapshot.outcomes?.total ?? 0
      }

      if (state.options.bar === 'off') {
        const text = segmentOf(state)

        if (text !== lastSegment) {
          lastSegment = text
          void host.rufloSegment(text).catch(() => undefined)
        }
      }
    } catch (error) {
      state.ruflo.error = plain(String(error), 120)
    } finally {
      state.isRefreshing = false
      push(state.stats.refreshes, Date.now() - started, 200)

      // Redraw only for something new while the pane is closed: the band need not repaint an unchanged line.
      const spend = state.usage?.costUsd

      if (state.pane.isOpen || (state.snapshot?.changed ?? 0) > 0 || spend !== lastSpend || !hasDrawn) {
        hasDrawn = true
        lastSpend = spend
        host.invalidate()
      }
    }
  }

  const probesInFlight = new Map<string, Promise<void>>()

  /** One probe run at a time per probe: a second ask while it runs joins it. */
  function runProbe(probe: (typeof ALL_PROBES)[number]): Promise<void> {
    const held = probesInFlight.get(probe.id)

    if (held !== undefined) return held

    const run = runProbeOnce(probe).finally(() => probesInFlight.delete(probe.id))

    probesInFlight.set(probe.id, run)

    return run
  }

  async function runProbeOnce(probe: (typeof ALL_PROBES)[number]): Promise<void> {
    const held: ProbeResult = state.probes.get(probe.id) ?? { value: null, okAtMs: null, error: null, errorAtMs: null, isRunning: false }

    state.probes.set(probe.id, { ...held, isRunning: true })
    lastAttempt.set(probe.id, Date.now())

    try {
      const argv = probeArgv(probe, state.options.cli, state)
      const result = await host.run(argv, probe.timeoutMs)
      const value = result.exitCode === 0 ? (probe.parse(result.stdout) as unknown) : null
      state.probes.set(
        probe.id,
        value !== null
          ? { value, okAtMs: Date.now(), error: null, errorAtMs: held.errorAtMs, isRunning: false }
          : {
              ...held,
              isRunning: false,
              errorAtMs: Date.now(),
              error: probeError(argv, result),
            },
      )
    } catch (error) {
      state.probes.set(probe.id, { ...held, isRunning: false, errorAtMs: Date.now(), error: plain(error instanceof Error ? error.message : String(error), 100) || 'refused' })
    } finally {
      host.invalidate()
    }
  }

  /** Runs the probes the view in front draws, each no more often than its cadence; `force` ignores the cadence. */
  async function probe(force = false): Promise<void> {
    const now = Date.now()
    const due = ALL_PROBES.filter(
      entry =>
        (isVisible() || force) &&
        entry.views.includes(state.view) &&
        (!entry.isNetwork || state.options.federationNetwork) && probeReady(entry, state) &&
        (force || (state.probes.get(entry.id)?.isRunning !== true && now - (lastAttempt.get(entry.id) ?? 0) >= entry.everyMs)),
    )

    for (let i = 0; i < due.length; i += MAX_PARALLEL_PROBES) {
      await Promise.all(due.slice(i, i + MAX_PARALLEL_PROBES).map(entry => runProbe(entry)))
    }
  }

  function every(name: string, ms: number, fn: () => void): void {
    if (!state.timers.has(name)) state.timers.set(name, host.every(ms, fn))
  }

  function cancel(name: string): void {
    state.timers.get(name)?.cancel()
    state.timers.delete(name)
  }

  // Whether the last frame drew the boot screen: when it ends the whole pane redraws once, and an unfocused pane's loop stops again.
  let wasBooting = false

  /** One frame of every picture of the view in front, each blitted only at the size it was mounted. */
  function frame(): void {
    const started = Date.now()
    const booting = isBooting(state, started)

    if (wasBooting && !booting) {
      wasBooting = false
      state.pane.menuAtMs = Date.now()
      host.invalidate()
      animate()

      return
    }

    wasBooting = booting

    if (pulseDue(state.view, started) || (state.view === 'menu' && entryAge({ look: state.options.look, boot: state.options.boot, ...state.pane }, started, BOOT_MIN_MS) !== null)) host.invalidate()

    for (const [key, grid] of picturesOf(state, state.pane.columns, Date.now(), Date.now())) {
      const mounted = state.mounted.get(key)

      if (mounted !== undefined && mounted.columns === grid.columns && mounted.rows === grid.rows) {
        host.blit({ requestId: PANE_ID, key, cells: grid.encode(), columns: grid.columns, rows: grid.rows })
      }
    }

    push(state.stats.frames, Date.now() - started, 200)
  }

  /** Runs the frame loop while the pane is shown and holds the keys (or plays the boot screen), at `fps`; stops it otherwise. */
  function animate(): void {
    // Something in progress moves its spinner, pictured or not: a lab action in flight, or a live mission, task or guidance run on the Missions page.
    const moving = state.lab.running !== null || (state.view === 'missions' && hasLiveWork(state.snapshot?.missions?.missions ?? [], mcOf(state).guidance?.status === 'running'))

    if (!(state.options.fps > 0 && isVisible() && (state.pane.isFocused || isBooting(state, Date.now())) && (state.mounted.size > 0 || moving))) return cancel('frames')

    every('frames', Math.round(1000 / state.options.fps), frame)
  }

  /** Watches whether the pane is shown and focused, so the loop stops behind another tab and resumes in front. */
  async function watchPane(): Promise<void> {
    const panes = await host.panes().catch(() => null)
    const mine = panes?.find(pane => pane.id === PANE_ID)

    if (panes !== null) {
      state.pane.isOpen = mine !== undefined
      state.pane.isShown = mine?.isShown === true
      state.pane.isFocused = mine?.isFocused === true
    }

    if (!state.pane.isOpen) cancel('watch')

    animate()
  }

  function start(): void {
    let lastIdleMs = 0

    // The AI terminal's saved model and budget apply from the first turn, not only once Settings was opened.
    void loadAiPrefs(state, host)
    void loadAllowed(state, host)
    void loadLedger(state, host)
    void host.storeGet(NAV_KEY).then(saved => {
      const style = NAV_STYLES.find(candidate => candidate === saved)

      if (style !== undefined) state.nav = style
    }, () => undefined)

    every('refresh', state.options.refreshSeconds * 1000, () => {
      const now = Date.now()
      const isSeen = state.pane.isOpen || now - state.barDrawnAtMs < BAR_FRESH_MS

      // Nothing on screen reads the disk: re-read only on the idle cadence, so a closed console costs nearly nothing.
      if (isSeen || now - lastIdleMs >= IDLE_REFRESH_MS) {
        lastIdleMs = now
        void refresh().then(() => {
          void probe()
          void refreshWorkflows(state, host)
          advance(state, host)
        })
      }
    })
    every('activity', ACTIVITY_BUCKET_MS, () => {
      push(state.activity, activityCount)
      activityCount = 0
    })
  }

  const resume = () => every('watch', PANE_WATCH_MS, () => void watchPane())

  function stop(): void {
    for (const timer of state.timers.values()) timer.cancel()
    state.timers.clear()
  }

  /** `closeOnEscape` false: take the keys but leave Esc handing them back, as an auto-opened pane does. */
  async function open(focus = true, closeOnEscape = focus): Promise<{ isPlaced: boolean; reason: string }> {
    try {
      const result = await host.openPane({ id: PANE_ID, title: 'ruflo', rows: rowsOf(state.view), ...(state.dockColumns > 0 && { columns: state.dockColumns }), ...(focus && { focus: true, holdToasts: true }), ...(closeOnEscape && { closeOnEscape: true }) })
      const isPlaced = result === undefined || result.isPlaced !== false

      if (isPlaced && !state.pane.isOpen) state.pane.bootAtMs = Date.now()
      state.pane.isOpen = isPlaced
      state.pane.isShown = isPlaced
      if (focus) state.pane.isClosedByPerson = false
      if (isPlaced) persist()
      resume()
      void refresh().then(() => probe(true))

      return { isPlaced, reason: result?.reason ?? '' }
    } catch (error) {
      return { isPlaced: false, reason: plain(error instanceof Error ? error.message : String(error), 160) }
    }
  }

  function autoOpen(): void {
    if (state.options.panel !== 'auto' || state.snapshot?.isRufloProject !== true || state.pane.isOpen || state.pane.isClosedByPerson || state.pane.autoTried) return

    state.pane.autoTried = true
    // From a timer, never a render hook; without `focus`, so the prompt keeps the keys. The engine seats an unasked pane
    // only where it docks (144 columns and up) and answers why not otherwise: the band then says "/ruflo to open".
    state.timers.set(
      'auto-open',
      host.after(50, () => {
        state.timers.delete('auto-open')
        // /ruflo <view> may have opened it in the meantime: that choice stands.
        if (state.pane.isOpen) return
        // The BBS look opens on its main menu, as a board does after login.
        if (state.options.look === 'bbs') state.view = 'menu'
        void open(false).then(result => {
          state.pane.autoReason = result.isPlaced ? '' : result.reason || 'not placed'
          host.invalidate()
        })
      }),
    )
  }

  async function close(): Promise<void> {
    state.pane.isOpen = false
    state.pane.isShown = false
    state.pane.isClosedByPerson = true
    persist()
    // A waiting card's expiry timer does not outlive the pane either: past its window it is cleared at the next ask or tool call instead.
    for (const name of ['frames', 'watch', EXPIRY_TIMER]) cancel(name)
    await host.closePane(PANE_ID).catch(() => undefined)
  }

  function setView(view: State['view']): void {
    state.isHelp = false
    state.palette.isOpen = false

    if (view !== state.view) {
      if (view === 'agent' || state.view !== 'agent') state.back = state.view === 'agent' ? state.back : state.view
      state.view = view
      // A group picked on one page (the menu's pages row) does not follow you to the next, or back to this one.
      state.navPick = null
      state.pane.viewAtMs = Date.now()
      state.select.item = 0
      state.mounted.clear()
      persist()
      // A new view asks for its own height inline; the dock ignores it.
      if (state.pane.isOpen) void host.openPane({ id: PANE_ID, title: 'ruflo', rows: rowsOf(view), ...(state.dockColumns > 0 && { columns: state.dockColumns }) }).catch(() => undefined)
      void probe(true)
      host.scrollTop()
    }

    host.invalidate()
    // The terminal is for typing: its field takes the keys as it opens, so letters reach it, not the pane's hotkeys.
    if (view === 'terminal') focusField('term-input')
    // Opening the skills view is the person asking for its lists (npx skills reaches the network, so never unasked).
    if (view === 'skills') {
      void listSkills(state, host)
      focusField('skills-search')
    }
    openLoaders(state, host, view)
  }

  /**
   * Puts the keys in one of the pane's fields. A pane that opened by itself (panel=auto) does not hold the keys, and a
   * mouse click on a tab does not give them, so a person who clicked their way to the terminal would type into
   * Claude's prompt instead. Here the pane takes the keys first (an open with focus), then the ring moves to the field.
   */
  function focusField(key: string): void {
    if (!state.pane.isOpen) return

    const toField = () => void host.focus(PANE_ID, key).catch(() => undefined)

    if (state.pane.isFocused) toField()
    else void open(true, false).then(result => result.isPlaced && toField())
  }

  function drill(agentId: string): void {
    const agent = state.snapshot?.agents.find(entry => entry.id === agentId)

    state.drill = { agentId, logs: null, logsAtMs: 0 }
    setView('agent')

    const spec = agent === undefined ? null : agentLogs(agent)

    if (spec !== null) readDrillLogs(state, host, agentId, spec.args)
  }

  const runner = createRunner(state, host, {
    freshRead, setView, drill,
    command: name => (name === 'refresh' ? actions.refresh() : name === 'help' ? actions.help() : actions.close()),
    landingRefusal: pending => landingRefusal(state, pending),
  })
  const actions: Actions = actionsOf(state, host, runner, { freshRead, probe, setView, drill, close, animate })

  function markFrame(requestId: string, isWorking: boolean): void {
    markRequest = requestId

    if (isWorking && state.options.fps > 0) {
      every('mark', Math.round(1000 / state.options.fps), () => {
        if (markRequest !== null) host.blit({ requestId: markRequest, key: 'mark', cells: markPicture(true, Date.now()).encode(), columns: 2, rows: 1 })
      })
    } else {
      cancel('mark')
    }
  }

  function noteToolCall(agentId: string | undefined, tool: string): void {
    activityCount += 1

    const who = agentId ?? 'main'
    const list = state.toolsByAgent.get(who) ?? []

    push(list, { atMs: Date.now(), tool: plain(tool, 40) }, 200)
    state.toolsByAgent.set(who, list)
    if (state.toolsByAgent.size > 50) state.toolsByAgent.delete(state.toolsByAgent.keys().next().value as string)
    record(state.events, [{ atMs: Date.now(), kind: 'tools', text: `${agentName(state, agentId)}: ${plain(tool, 40)}` }])
  }

  const closedByPerson = () => {
    state.pane.isClosedByPerson = true
    persist()
  }

  return { refresh, probe, start, resume, stop, open, autoOpen, closedByPerson, close, setView, drill, animate, noteToolCall, actions, runner, markFrame, host }
}
