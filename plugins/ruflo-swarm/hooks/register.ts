import type { EngineInterface, On, PluginOptions } from 'claude-code'

import { paneActionsOf, type Controller } from './actions/controller'
import { AUDIT_FLUSH_MS, auditRow, noteAudit, takeFlush } from './audit'
import { framedDigest, readAdrDigest } from './adr-digest'
import { claimsText, COMMANDS, consensusText, isSwarmSub, spawnNote, statusText, SWARM_SUBS, topologyText, type SwarmSub } from './commands'
import type { Host, OpenResult } from './host'
import { isAnimating, LEAD, loopLabel, newActivity, noteCall, noteDone, noteListed, noteResult, noteSpawn, stuckCall } from './model/members'
import { parseRoute, plain } from './reader/parse'
import { readSnapshot, type ReadCache } from './reader/snapshot'
import { CLI_PREFIXES, newState, PANE_ID, persistedOf, restore, storeKeyOf, type State } from './state'
import { createToastKit } from './toast-policy'
import { paneModelOf } from './views/model'
import { paneView } from './views/pane'

const REFRESH_DEBOUNCE_MS = 400
const TICK_MS = 2_000
/** While idle the disk is read this often: ruflo's own CLI may change it from another terminal. */
const IDLE_READ_MS = 10_000
const FRAME_MS = 200
const RUFLO_COMMAND = /(?:^|[\s/'"])(?:ruflo|claude-flow|@claude-flow\/cli)(?:@[\w.-]+)?\s/
const ROUTE_COMMAND = /\bhooks\s+route\b/
const ROUTE_TOOL = /(?:^|__)hooks_route$/

/**
 * Binds a Host from `$`. Declared here, each member spelled `$.noun.event(...)`, so the engine reads what the module
 * calls off its source. The calls that answer nothing are wrapped: a refused draw or toast is not a crashed hook.
 */
function hostOf($: EngineInterface, cwd: string): Host {
  const rooted = (path: string) => (path.startsWith('/') ? path : `${cwd.replace(/\/+$/, '')}/${path}`)
  const quietly = (fn: () => void) => {
    try {
      fn()
    } catch {
      // Refused: there is nothing to do about a draw nobody may make.
    }
  }

  const toaster = createToastKit({
    source: 'swarm',
    now: () => $.clock.now(),
    show: (line, options) => $.ui.toast(line, options),
    after: (ms, fn) => $.clock.after(ms, fn),
    io: { read: path => $.fs.read(rooted(path)), write: (path, text) => $.fs.write(rooted(path), text), exists: path => $.fs.exists(rooted(path)) },
  })

  return {
    fs: { read: path => $.fs.read(rooted(path)), stat: path => $.fs.stat(rooted(path)) },
    now: () => $.clock.now(),
    after: (ms, fn) => $.clock.after(ms, fn),
    every: (ms, fn) => $.clock.every(ms, fn),
    storeGet: key => $.store.get(key),
    storeSet: (key, value) => $.store.set(key, value),
    invalidate: () => quietly(() => $.ui.invalidate('ui.render')),
    toast: input => quietly(() => void toaster.toast(input)),
    log: text => quietly(() => $.ui.log(text)),
    openPane: pane => $.ui.open(pane) as Promise<OpenResult>,
    closePane: id => $.ui.close({ id }),
    registerCommand: spec => $.command.register(spec),
    fillPrompt: input => $.prompt.fill(input),
    run: (argv, timeoutMs) => $.process.run(argv, { timeoutMs }),
    usage: () => $.session.usage(),
    agents: () => $.agent.list(),
  }
}

/**
 * The swarm mod: a live pane of the ruflo swarm on disk and of Claude Code's own agent loops, swarm commands, and,
 * where the options ask, swarm context in spawned subagents and a content-free audit trail. `session.start` binds the
 * engine; every hook after it works over that binding and one state object.
 */
export function register(on: On, raw: PluginOptions) {
  const state: State = newState(raw, newActivity())
  const cache: ReadCache = new Map()
  let host: Host | null = null

  const persist = () => {
    void host?.storeSet(storeKeyOf(state.cwd), persistedOf(state)).catch(() => undefined)
  }

  async function refresh(): Promise<void> {
    const bound = host

    if (bound === null) {
      return
    }

    if (state.isRefreshing) {
      state.isRefreshQueued = true

      return
    }

    state.isRefreshing = true

    try {
      const nowMs = Date.now()
      const [snapshot, usage, listed] = await Promise.all([
        readSnapshot(bound.fs, cache, nowMs),
        bound.usage().catch(() => null),
        bound.agents().catch(() => null),
      ])
      const isFirstSight = snapshot.hasSwarm && state.snapshot?.hasSwarm !== true

      state.snapshot = snapshot
      state.readError = null

      if (usage !== null) {
        state.usage = {
          ...(usage.cost?.usd !== undefined && { costUsd: usage.cost.usd }),
          ...(usage.context?.tokens !== undefined && { contextTokens: usage.context.tokens }),
          ...(usage.context?.percent !== undefined && { contextPercent: usage.context.percent }),
          ...(usage.context?.window !== undefined && { contextWindow: usage.context.window }),
          readAtMs: nowMs,
        }
      }

      if (listed !== null) {
        noteListed(state.activity, listed, nowMs)
      }

      if (isFirstSight) {
        maybeAutoOpen()
      }
    } catch (error) {
      state.readError = plain(error instanceof Error ? error.message : String(error), 200)
    } finally {
      state.isRefreshing = false
      bound.invalidate()

      if (state.isRefreshQueued) {
        state.isRefreshQueued = false
        scheduleRefresh()
      }
    }
  }

  function scheduleRefresh(): void {
    if (host === null || state.timers.has('refresh')) {
      return
    }

    state.timers.set(
      'refresh',
      host.after(REFRESH_DEBOUNCE_MS, () => {
        state.timers.delete('refresh')
        void refresh()
      }),
    )
  }

  /** Redraws while a tile is lit, then stops: no timer runs for a pane with nothing moving. */
  function animate(): void {
    const bound = host

    if (bound === null || state.timers.has('frames') || !state.pane.isOpen) {
      return
    }

    state.timers.set(
      'frames',
      bound.every(FRAME_MS, () => {
        bound.invalidate()

        if (!state.pane.isOpen || !isAnimating(state.activity, Date.now())) {
          state.timers.get('frames')?.cancel()
          state.timers.delete('frames')
        }
      }),
    )
  }

  async function openPane(): Promise<{ isPlaced: boolean; reason: string }> {
    if (host === null) {
      return { isPlaced: false, reason: 'the session has not started' }
    }

    try {
      const result = await host.openPane({ id: PANE_ID, title: 'Swarm' })
      const isPlaced = result === undefined || result.isPlaced !== false

      state.pane.isOpen = isPlaced
      state.pane.isClosedByPerson = false
      persist()
      void refresh()

      return { isPlaced, reason: result?.reason ?? '' }
    } catch (error) {
      return { isPlaced: false, reason: plain(error instanceof Error ? error.message : String(error), 160) }
    }
  }

  function maybeAutoOpen(viewport?: { isFullscreen?: boolean }): void {
    state.viewport.isFullscreen = viewport?.isFullscreen ?? state.viewport.isFullscreen

    const bound = host
    const shouldOpen =
      bound !== null &&
      state.options.panel === 'auto' &&
      !state.pane.isOpen &&
      !state.pane.isClosedByPerson &&
      !state.timers.has('auto-open') &&
      state.snapshot?.hasSwarm === true &&
      state.viewport.isFullscreen === true

    if (shouldOpen && bound !== null) {
      // From a timer: a render hook only draws.
      state.timers.set(
        'auto-open',
        bound.after(50, () => {
          state.timers.delete('auto-open')
          void openPane()
        }),
      )
    }
  }

  const control: Controller = { refresh, persist }

  // ------------------------------------------------------------- lifecycle

  on('session.start', async ($, e, next) => {
    host = hostOf($, e.cwd)
    state.cwd = e.cwd

    for (const timer of state.timers.values()) {
      timer.cancel()
    }

    state.timers.clear()
    noteSpawn(state.activity, LEAD, 'lead', Date.now())

    const bound = host

    await Promise.all([
      ...COMMANDS.map(spec => bound.registerCommand(spec).catch(() => undefined)),
      bound
        .storeGet(storeKeyOf(e.cwd))
        .then(value => restore(state, value))
        .catch(() => undefined),
    ])

    await refresh()

    let lastReadMs = Date.now()

    state.timers.set(
      'tick',
      bound.every(TICK_MS, () => {
        const nowMs = Date.now()

        if (state.pane.isOpen && (state.activity.isWorking || nowMs - lastReadMs >= IDLE_READ_MS)) {
          lastReadMs = nowMs
          scheduleRefresh()
        }
      }),
    )

    if (state.options.audit) {
      state.timers.set(
        'audit',
        bound.every(AUDIT_FLUSH_MS, () => {
          const flush = takeFlush(state, Date.now())

          if (flush !== null) {
            void bound.run([...CLI_PREFIXES[state.options.cli], ...flush.args], 30_000).catch(() => undefined)
          }
        }),
      )
    }

    return next(e)
  })

  on('ui.render', { component: 'PromptHint' }, ($, e, next) => {
    if (e.surface === 'terminal') {
      maybeAutoOpen(e.viewport)
    }

    return next(e)
  })

  on('ui.render', { component: 'Pane' }, ($, e, next) => {
    if (host === null || e.requestId !== PANE_ID) {
      return next(e)
    }

    const table = $.ui.resolve(e)
    const columns = Math.max(20, Math.floor(Number(e.props.bodyColumns) || 0) - 1)
    const rows = Math.max(0, Math.floor(Number(e.props.scroll?.bodyRows) || 0))
    const nowMs = Date.now()

    state.pane.isOpen = true
    state.pane.columns = columns
    state.pane.rows = rows

    if (isAnimating(state.activity, nowMs)) {
      animate()
    }

    return paneView({ Box: table.Box, Text: table.Text, Button: table.Button }, paneModelOf(state, columns, rows, nowMs), paneActionsOf(state, host, control))
  })

  on('ui.close', async ($, e, next) => {
    const result = await next(e)

    if (e.id === PANE_ID && result.deny === undefined) {
      state.pane.isOpen = false
      state.pane.isClosedByPerson = e.origin.kind === 'person' || state.pane.isClosedByPerson
      persist()
    }

    return result
  })

  // -------------------------------------------------------------- commands

  /** The five swarm commands, each by its subcommand word: what `/ruflo swarm <sub>` and the old names both answer. */
  async function answer(sub: SwarmSub, args: string): Promise<{ text: string }> {
    const bound = host as Host

    switch (sub) {
      case 'pane': {
        const arg = args.trim().toLowerCase()

        if (arg === 'close' || (arg === '' && state.pane.isOpen)) {
          state.pane.isOpen = false
          state.pane.isClosedByPerson = true
          persist()
          await bound.closePane(PANE_ID).catch(() => undefined)

          return { text: 'Swarm pane hidden' }
        }

        if (state.options.panel === 'off') {
          return { text: 'The swarm pane is off (panel option); set panel to command or auto in /config to open it' }
        }

        const opened = await openPane()

        return { text: opened.isPlaced ? 'Swarm pane shown' : `The swarm pane could not be shown: ${opened.reason}` }
      }
      case 'status':
        await refresh()

        return { text: statusText(state, Date.now(), args.trim().toLowerCase() === 'json') }
      case 'topology':
        await refresh()

        return { text: topologyText(state, Date.now()) }
      case 'claims':
        await refresh()

        return { text: claimsText(state) }
      case 'consensus':
        await refresh()

        return { text: consensusText(state) }
    }
  }

  /**
   * `/ruflo swarm <pane|status|topology|claims|consensus>`: ruflo-console registers `/ruflo` for every ruflo mod, and
   * this hook answers its swarm subcommands wherever it sits in the chain, passing every other word on.
   */
  // `/ruflo-console` is the same command as `/ruflo` (kept by ADR-406), so its swarm subcommands are answered too.
  for (const command of ['ruflo', 'ruflo-console'] as const) {
    on('command.run', { command }, async ($, e, next) => {
      const [head = '', sub = '', ...rest] = e.args.trim().split(/\s+/)

      if (host === null || head.toLowerCase() !== 'swarm' || !isSwarmSub(sub.toLowerCase())) {
        return next(e)
      }

      return answer(sub.toLowerCase() as SwarmSub, rest.join(' '))
    })
  }

  // The old names stay registered as aliases of `/ruflo swarm <sub>`: ADR-406 removes, renames or reassigns no command.
  for (const sub of SWARM_SUBS) {
    on('command.run', { command: `ruflo-swarm-${sub}` }, async ($, e, next) => (host === null ? next(e) : answer(sub, e.args)))
  }

  /** The plugin's markdown `/ruflo-swarm:watch` still runs as it always has; with the mod it opens the pane as well. */
  on('command.run', { command: 'ruflo-swarm:watch' }, async ($, e, next) => {
    if (host !== null && state.options.panel !== 'off') {
      await openPane()
    }

    return next(e)
  })

  // ----------------------------------------------------------------- turns

  on('turn.start', ($, e, next) => {
    state.activity.isWorking = true
    state.activity.turnId = e.turnId
    host?.invalidate()

    return next(e)
  })

  on('turn.complete', ($, e, next) => {
    if (e.agentId !== undefined) {
      noteDone(state.activity, e.agentId, e.reason, Date.now())

      // An answer is a success and an abort is the person's own; anything else is a loop that ended badly.
      if (e.reason !== 'answer' && e.reason !== 'aborted') host?.toast({ level: 'error', text: `swarm: ${loopLabel(state.activity, e.agentId)} failed (${plain(String(e.reason), 40)})` })
    } else {
      state.activity.isWorking = false
      scheduleRefresh()
    }

    host?.invalidate()

    return next(e)
  })

  // ---------------------------------------------------------------- agents

  /** Claude Code's own subagents join the pane as members; with the option on, each is told which swarm it is in. */
  on('agent.spawn', async ($, e, next) => {
    const note = state.options.injectSpawnContext ? spawnNote(state.snapshot) : null
    // ADR-480: the accepted decisions attached to the console's active mission, as data after the task.
    const adr = state.options.injectAdrs && host !== null ? await readAdrDigest(host.fs, await host.now().catch(() => Date.now())) : null
    const prompt = `${e.prompt}${note ?? ''}${adr === null ? '' : framedDigest(adr)}`
    const result = await next(prompt === e.prompt ? e : { ...e, prompt })

    if (result.deny === undefined && result.agentId !== undefined) {
      noteSpawn(state.activity, result.agentId, e.subagentType, Date.now(), e.name, plain(e.description, 120), adr?.numbers ?? [])
      host?.invalidate()
    }

    return result
  })

  // ------------------------------------------------------------ tool calls

  /** Observes only: the call goes on unchanged, and what it read or wrote lights its agent's tile. */
  on('tool.call', async ($, e, next) => {
    const args = e as unknown as Readonly<Record<string, unknown>>
    const command = typeof args.command === 'string' ? args.command : undefined
    const path = typeof args.file_path === 'string' ? args.file_path : typeof args.path === 'string' ? args.path : typeof args.pattern === 'string' ? args.pattern : undefined
    const subject = plain(command ?? path ?? '', 80)
    const pulse = noteCall(state.activity, e.agentId, e.tool, subject, Date.now(), command)

    if (pulse !== null && state.pane.isOpen) {
      animate()
      host?.invalidate()
    }

    const result = await next(e)
    const isError = result.deny !== undefined || result.isError === true

    noteResult(state.activity, e.agentId, e.tool, subject, isError, Date.now())

    // A loop that fails the same call three times running is going round in circles (ADR-477). The policy says it once a minute at most.
    const stuck = isError ? stuckCall(state.activity, e.agentId) : null

    if (stuck !== null) host?.toast({ level: 'warn', text: `swarm: ${loopLabel(state.activity, e.agentId ?? LEAD)} keeps failing ${stuck.tool}${stuck.subject === '' ? '' : ` ${stuck.subject}`}` })

    if (!isError) {
      const text = typeof result.text === 'string' ? result.text : ''

      if ((command !== undefined && ROUTE_COMMAND.test(command)) || ROUTE_TOOL.test(e.tool)) {
        const pick = parseRoute(text, Date.now())

        if (pick !== null) {
          state.route = pick
          persist()
        }
      }

      if ((command !== undefined && RUFLO_COMMAND.test(command)) || e.tool.includes('claude-flow') || e.tool.includes('ruflo')) {
        scheduleRefresh()
      }
    }

    return result
  })

  // ----------------------------------------------------------------- audit

  if (state.options.audit) {
    on('*', ($, e, next) => {
      noteAudit(state, auditRow(next.event, e, Date.now()))

      return next(e)
    })
  }
}
