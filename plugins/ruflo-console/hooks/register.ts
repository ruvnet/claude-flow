import type { EngineInterface, PluginOptions, Register } from 'claude-code'
import { tolerantPress } from './press-guard'
import { ANSWER_KEYS } from './views/attention'

import { createController, type Controller } from './controller'
import { startSessions } from './sessions'
import { record } from './data/events'
import { plain } from './data/parse'
import { dispatch } from './dispatch'
import { markPicture } from './gfx/pictures'
import type { Host } from './host'
import { ownerLine, ownerOf } from './tool-owner'
import { newState, PANE_ID, restore, restoreSessions, storeKeyOf, termStoreKeyOf } from './state'
import { BAR_KEY, barView } from './views/bar'
import { addNotice, dismissNotices } from './notices'
import { setBootChecks } from './boot-checks'
import { startWriteFlavorDetection } from './data/write-flavor'
import { buildOf, isOurCheckout, setBuild } from './build'
import { runUpdateCheck } from './update-flow'
import { announceModelTools, parseControlEnv, serveModelTools } from './model-tools'
import { loadAiPrefs, setControlCap } from './settings'
import { hydrateWhatsNew } from './whatsnew'
import { prefsFromStore, recordToast, saveToastPrefs, TOASTS_KEY } from './toasts'
import { contextSection, onPromptSubmit, onTurnComplete } from './mission-claude'
import { parseMode, RECHECK_EVERY_MS, UPDATES_KEY } from './updates'
import { selfCheckResults } from './self-check'
import type { Kit } from './views/common'
import { createToaster, type Digest, type ToastLevel, type ToastPrefs } from './toast-policy'
import { picturesOf } from './views/frames'
import { withClearing } from './views/clearing'
import { NARROW, paneView } from './views/pane'

const RUFLO_TOOL = /^mcp__(claude-flow|ruflo|plugin_ruflo[\w-]*)__/

/**
 * Binds a Host from `$`, every member spelled `$.noun.method(...)` here and nowhere else, so the engine reads what
 * the module calls off this one place. Calls that answer nothing are wrapped: a refused draw is not a crashed hook.
 */
/** True while the console itself scrolls the pane to its top, so the terminal's own wheel handling does not take that for the person's wheel. */
let isResettingScroll = false

function hostOf($: EngineInterface, cwd: string, toasts: { prefs: () => ToastPrefs; record: (digest: Digest) => void }): Host {
  const rooted = (path: string) => (path.startsWith('/') ? path : `${cwd.replace(/\/+$/, '')}/${path}`)
  const quietly = (fn: () => unknown) => {
    try {
      const result = fn()

      if (result instanceof Promise) result.catch(() => undefined)
    } catch {
      // Refused: there is nothing to do about a draw nobody may make.
    }
  }

  // ADR-477: every toast of the console goes through the shared policy (levels, one clean line, de-duplication, a rate limit, the person's
  // Toasts setting); drawn or not, each is recorded for the Events page. A refused draw is a refused toast, never a crash.
  const toaster = createToaster({
    source: 'console',
    now: () => Date.now(),
    show: (line, options) => $.ui.toast(line, options),
    after: (ms, fn) => $.clock.after(ms, fn),
    prefs: toasts.prefs,
    persist: toasts.record,
  })

  return {
    fs: { read: async path => $.fs.read(rooted(path)), stat: async path => $.fs.stat(rooted(path)), list: async path => $.fs.list(rooted(path)) },
        every: (ms, fn) => $.clock.every(ms, fn),
    after: (ms, fn) => $.clock.after(ms, fn),
    storeGet: async key => $.store.get(key),
    storeSet: async (key, value) => $.store.set(key, value as never),
    fetchText: async url => {
      const response = await $.http.fetch(url)

      return { ok: response.ok, status: response.status, text: response.text }
    },
    askChoice: async (question, options) => $.ui.ask(question, options),
    toast: (text, timeoutMs, level: ToastLevel = 'info') => quietly(() => void toaster.toast({ level, text, ...(timeoutMs !== undefined && { timeoutMs }) })),
    invalidate: () => quietly(() => $.ui.invalidate('ui.render')),
    // Once now and once after the new page has drawn: a page taller than the one before keeps the old offset until it is moved.
    scrollTop: () => {
      const go = () =>
        quietly(() => {
          isResettingScroll = true

          return Promise.resolve($.ui.scroll({ to: 'start', in: PANE_ID })).finally(() => {
            isResettingScroll = false
          })
        })

      go()
      $.clock.after(80, go)
    },
    focus: async (paneId, key) => $.ui.focus({ requestId: paneId, key }),
    blit: args => quietly(() => $.ui.blit(args)),
    openPane: async pane => $.ui.open(pane),
    closePane: async id => $.ui.close({ id }),
    panes: async () => $.ui.panes(),
    registerCommand: async spec => $.command.register(spec),
    run: async (argv, timeoutMs, stdin) => $.process.run(argv, { cwd, timeoutMs, ...(stdin !== undefined && { stdin }) }),
    spawn: (argv, input) => $.process.spawn({ argv, cwd, ...(input !== undefined && { input }) }),
    usage: async () => {
      const usage = await $.session.usage()

      return { ...(usage.cost?.usd !== undefined && { costUsd: usage.cost.usd }), ...(usage.context?.percent !== undefined && { contextPercent: usage.context.percent }) }
    },
    rufloTools: async () => {
      const names = (await $.tool.list()).flatMap(tool => RUFLO_TOOL.exec(tool.name)?.slice(1, 2) ?? [])

      return { tools: names.length, servers: [...new Set(names)].sort() }
    },
    settings: async () => $.settings.read(),
    home: async () => $.env.get('HOME'),
    configDir: async () => $.env.get('CLAUDE_CONFIG_DIR'),
    pluginRoot: $.plugin.root,
    // `$.ruflo` exists only where ruflo-mods is seated; validate refuses feature-detecting a noun, so these are
    // async: a missing noun throws inside the promise and every caller's catch sees a rejection.
    rufloSnapshot: async () => $.ruflo.snapshot(),
    rufloRoute: async () => $.ruflo.lastRoute(),
    rufloSegment: async text => $.ruflo.segment({ id: 'console', text }),
    // Both wait on the turn, so neither may be called from inside a command.run hook (`/ruflo yes` is one): they run from a clock
    // tick, a later event of their own.
    submitPrompt: text =>
      new Promise<void>((resolve, reject) => {
        $.clock.after(1, () => void $.prompt.submit({ text }).then(() => resolve(), reject))
      }),
    fillPrompt: async text => (await $.prompt.fill({ text, mode: 'replace' })).isFilled,
    runSlash: (command, args) =>
      new Promise((resolve, reject) => {
        $.clock.after(1, () => void $.command.run({ command, args }).then(resolve, reject))
      }),
    listCommands: async () => (await $.command.list()).map(command => command.name),
    // ADR-465. A tool call waits on the turn like submitPrompt, so it starts from a clock tick, never inside the hook that asked.
    toolCall: input =>
      new Promise((resolve, reject) => {
        $.clock.after(1, () => void $.tool.call(input as never).then(reply => resolve(reply as never), reject))
      }),
    toolCheck: async (tool, input) => $.tool.check({ tool, input }),
    httpSend: async (url, init) => {
      const response = await $.http.fetch(url, init)

      return { ok: response.ok, status: response.status, text: response.text }
    },
  }
}

/**
 * ruflo-console: ruflo's cockpit inside Claude Code, and the home of `/ruflo`. A pane of views over ruflo's state on
 * disk and the ruflo CLI's local answers, a band above the prompt, a command palette, and management views (agent
 * drill-down, timeline, approvals, events). Every change goes through the ruflo CLI with fixed argv after a confirm.
 */
export const register: Register = (on, raw: PluginOptions) => {
  // The boot log reports this check, so an [ OK ] on screen means the area's commands resolved. It spawns nothing and takes a
  // moment; a failure of the check itself leaves the log drawing as it did, never stops the console.
  try {
    setBootChecks(selfCheckResults())
  } catch {
    setBootChecks(undefined)
  }

  const state = newState(raw)
  let host: Host | null = null
  let control: Controller | null = null

  // Claude's console tools (ADR-444): answered only for their own names, and only when the person's setting lets them exist.
  serveModelTools(on, () => (control === null ? null : { state, control }))

  on('session.start', async ($, e, next) => {
    control?.stop()
    host = hostOf($, e.cwd, { prefs: () => state.toastPrefs, record: digest => recordToast(state, digest) })
    // Which write argv the host takes (GNU dd/install on Linux, the constant sh scripts on macOS/BSD). Started before the controller (whose
    // timers write) exists; every write awaits it (writeFlavorReady), so none is built with a guessed flavor.
    const detecting = host
    void startWriteFlavorDetection((argv, timeoutMs) => detecting.run(argv, timeoutMs))
    state.cwd = e.cwd
    state.nostrKeyVerifiedAtMs = null
    state.isInteractive = e.isInteractive !== false
    control = createController(state, host)

    // Which build is this? Only a checkout of this plugin in its repository is read (an installed copy inside some other repo is not
    // that repo's commit); read-only, $0, and any failure leaves the header at its version alone.
    const here = host
    const root = here.pluginRoot

    const built = here
      .run(['git', '-C', root, 'rev-parse', '--show-prefix'], 3_000)
      .then(prefix => (prefix.exitCode === 0 && isOurCheckout(prefix.stdout) ? here.run(['git', '-C', root, 'describe', '--always', '--dirty', '--abbrev=7'], 3_000) : null))
      .then(described => {
        setBuild(described !== null && described.exitCode === 0 ? buildOf(described.stdout) : '')
        here.invalidate()
      })
      .catch(() => undefined)

    // The update mode is the person's, kept in the plugin's store; then, once the build is known (a development checkout is never offered
    // an update) and the screen has settled, one check for a newer published version. It never throws and never blocks the console.
    const moded = here.storeGet(UPDATES_KEY).then(
      value => {
        state.updates = parseMode(value)
        here.invalidate()
      },
      () => undefined,
    )

    // The Toasts setting is the person's, kept in the plugin's store and mirrored to a file the other plugins read (ADR-477).
    const toasted = here.storeGet(TOASTS_KEY).then(
      value => {
        state.toastPrefs = prefsFromStore(value)
        if (state.toastPrefs.mode !== 'all' || state.toastPrefs.muted.length > 0) void saveToastPrefs(state, here)
      },
      () => undefined,
    )

    // What's new (ADR-478): the record of what was looked at, read once; the controller's first disk read then takes the baseline.
    const looked = hydrateWhatsNew(state, here).catch(() => undefined)

    void toasted
    void looked
    void Promise.all([built, moded]).then(() => {
      if (!state.isInteractive) return

      here.after(2_500, () => void runUpdateCheck(state, here))
      // A session left open for days re-asks too, quietly (no dialog mid-work); the daily gate keeps the network to once a day.
      state.timers.set('update-recheck', here.every(RECHECK_EVERY_MS, () => void runUpdateCheck(state, here, { quiet: true })))
    })

    const bound = host

    state.home = (await bound.home().catch(() => undefined)) ?? null
    state.configDir = (await bound.configDir().catch(() => undefined)) ?? (state.home === null ? null : `${state.home}/.claude`)
    // A recording or a wide screen can ask for a wider dock: RUFLO_CONSOLE_COLUMNS, whole columns, 40 to 400.
    const asked = Number(await (async () => $.env.get('RUFLO_CONSOLE_COLUMNS'))().catch(() => ''))

    // RUFLO_CONSOLE_PANEL=command|off overrides the panel option for this session (a recording that shows /ruflo opening it).
    const panel = await (async () => $.env.get('RUFLO_CONSOLE_PANEL'))().catch(() => undefined)

    if (panel === 'command' || panel === 'off') state.options.panel = panel
    state.dockColumns = Number.isInteger(asked) && asked >= 40 && asked <= 400 ? asked : 0
    // The x.ruv.io board's admin rows: only whether the token is set is kept, never its value.
    state.xruv.hasAdminToken = await (async () => $.env.get('RUFLO_X_ADMIN_TOKEN'))().then(
      value => typeof value === 'string' && value !== '',
      () => null,
    )
    await Promise.all([
      bound
        .registerCommand({ name: 'ruflo', description: 'ruflo: the cockpit (views, palette, agents, approvals) and every ruflo mod command — /ruflo help', argumentHint: '[view|palette|agent <id>|mods|swarm <sub>|help]' })
        .catch(() => undefined),
      // Kept for good (ADR-406: no command is removed or renamed): `/ruflo-console` is the same command as `/ruflo`.
      bound.registerCommand({ name: 'ruflo-console', description: 'Same as /ruflo: the ruflo console', argumentHint: '[view|palette|help]' }).catch(() => undefined),
      bound.storeGet(storeKeyOf(e.cwd)).then(value => restore(state, value), () => undefined),
      bound.storeGet(termStoreKeyOf(e.cwd)).then(value => restoreSessions(state, value), () => undefined),
      bound.rufloTools().then(counted => void (state.rufloTools = counted), () => undefined),
    ])
    control.start()
    startSessions(state, bound)
    await control.refresh()
    control.autoOpen()

    // Declare the console tools to the model when control is on: the saved setting, or this session's RUFLO_CONSOLE_CONTROL=<level>:<ask|auto>, which can only lower it.
    await loadAiPrefs(state, bound).catch(() => undefined)

    const forced = parseControlEnv(await (async () => $.env.get('RUFLO_CONSOLE_CONTROL'))().catch(() => undefined))

    // The override may only lower what the person saved (ADR-450 T12): a project's settings env must not raise Claude's control.
    // It is kept as session state and applied on every load and save of the preferences, so opening Settings cannot lift it (#3814).
    setControlCap(state, forced === null ? null : { level: forced.level, confirm: forced.confirm })
    await announceModelTools(tool => $.tool.register(tool), state).catch(() => 0)

    return next(e)
  })

  on('session.end', async ($, e, next) => {
    control?.stop()

    return next(e)
  })

  /**
   * `/ruflo`: the console's own subcommands are answered here; `mods` and `swarm <sub>` go to the plugins beneath that
   * hook the same command (ruflo-mods, ruflo-swarm), and are answered with a hint when neither does.
   */
  on('command.run', { command: 'ruflo' }, async ($, e, next) => {
    if (control === null) return next(e)

    return dispatch(control, state, e.args, async () => (await next(e)) as { text?: string } | undefined)
  })

  /** `/ruflo-console` is the same command: ruflo-mods and ruflo-swarm hook it as they hook `/ruflo`. */
  on('command.run', { command: 'ruflo-console' }, async ($, e, next) => {
    if (control === null) return next(e)

    return dispatch(control, state, e.args, async () => (await next(e)) as { text?: string } | undefined)
  })

  // Which element was pressed or submitted, before its own closure runs: the runner reads it as the origin of the ask that follows, so
  // the page puts the confirm and the answer right under it (views/attention.ts). Answering a confirm never moves the origin.
  on('ui.press', { component: 'Pane' }, ($, e, next) => {
    if (!ANSWER_KEYS.has(e.element)) state.lastPressed = e.element

    // A click that reaches the engine after its drawing was replaced (a resize) finds no handler: answered quietly (press-guard.ts).
    return tolerantPress(() => next(e), { element: e.element })
  })

  on('ui.input', { component: 'Pane' }, ($, e, next) => {
    if (e.kind === 'submit') state.lastPressed = e.element

    return next(e)
  })

  on('ui.render', { component: 'Pane', requestId: PANE_ID }, ($, e, next) => {
    if (control === null) {
      return next(e)
    }

    const started = Date.now()
    const table = $.ui.resolve(e) as unknown as Kit
    const columns = Math.max(20, Math.floor(Number(e.props.bodyColumns) || 0) - 1)
    const isNarrow = columns < NARROW
    const kit: Kit = isNarrow ? { Box: table.Box, Text: table.Text, Button: table.Button, ...(table.Input !== undefined && { Input: table.Input }) } : table

    if (!state.pane.isOpen) state.pane.bootAtMs = Date.now()
    state.pane.isOpen = true
    state.pane.isFocused = e.props.isFocused === true
    state.pane.columns = columns
    state.pane.placement = e.props.placement
    // A reload while the pane stayed up: timers are gone, so resume them from here.
    if (!state.timers.has('watch')) control.resume()

    const pictures = isNarrow ? new Map() : picturesOf(state, columns, Date.now(), Date.now())

    state.mounted = new Map([...pictures].map(([key, grid]) => [key, { columns: grid.columns, rows: grid.rows }]))
    control.animate()

    state.pane.rows = Math.max(0, Math.floor(Number(e.props.scroll?.bodyRows) || 0))

    const tree = paneView({ kit: withClearing(kit, state, control.actions.clearField, { columns, repaint: () => host?.invalidate() }), state, nowMs: Date.now(), columns, pictures, act: control.actions })

    state.stats.renders.push(Date.now() - started)
    if (state.stats.renders.length > 200) state.stats.renders.shift()

    return tree
  })

  // The AI terminal's conversation is its own window: the wheel and the page keys over the pane move it, so the header,
  // tabs and the field below stay where they are (the engine would scroll the whole pane).
  on('ui.scroll', { component: 'Pane', requestId: PANE_ID }, ($, e, next) => {
    if (control === null || state.view !== 'terminal' || e.by === 0 || isResettingScroll) return next(e)

    const lines = Math.abs(e.by) >= e.bodyRows ? Math.max(1, Math.round(e.bodyRows / 2)) : Math.abs(e.by) * 3

    control.actions.term.scroll(e.by < 0 ? lines : -lines)

    // The pane itself stays put: ask the engine for the offset it already has.
    return next({ ...e, offset: e.offset - e.by })
  })

  on('ui.render', { component: 'AbovePrompt' }, ($, e, next) => {
    const mode = state.bandMode ?? state.options.bar
    const show = mode === 'on' || (mode === 'auto' && state.snapshot?.isRufloProject === true)

    if (control === null || e.props.hasSurvey || !show) {
      return next(e)
    }

    const table = $.ui.resolve(e) as unknown as Kit
    const bound = control

    state.barDrawnAtMs = Date.now()

    const mark = table.Raster !== undefined ? table.Raster(markPicture(e.props.isWorking, Date.now()).toRaster(BAR_KEY)) : null

    state.turnActive = e.props.isWorking === true
    bound.markFrame(e.requestId, e.props.isWorking && mark !== null)

    // A click on a part opens the console on its view, with the keys, so the person can act there at once.
    return barView(table, state, Math.floor(Number(e.props.bodyColumns) || 80), mark, () => void bound.open(false), view => {
      bound.setView(view)
      void bound.open(true)
    }, () => {
      dismissNotices(state)
      try {
        $.ui.invalidate('ui.render')
      } catch {
        // A refused redraw leaves the notice showing until the next one.
      }
    })
  })

  // A tool row that ran while one mission task was running says which: one dim line under the engine's own row.
  on('ui.render', { component: 'ToolUse' }, async ($, e, next) => {
    const owner = ownerOf(state, e.props.tool_use_id, e.props.isRunning === true)

    if (owner === null) return next(e)

    const table = $.ui.resolve(e) as unknown as Kit
    const own = await next(e)

    return table.Box({ key: `owner-${e.props.tool_use_id}`, flexDirection: 'column', children: [own, table.Text({ dimColor: true, children: `  ${ownerLine(owner)}` })] })
  })

  /** The band's mark pulses during a turn: a redraw at its start, and the loop stopped at its end, whatever redraws. */
  on('turn.start', ($, e, next) => {
    // A new turn: the per-turn cap on Claude's console actions starts over.
    state.control.turnCalls = 0
    if (e.agentId === undefined) state.turnStartedMs = Date.now()

    try {
      $.ui.invalidate('ui.render')
    } catch {
      // A refused redraw leaves the mark at rest.
    }

    return next(e)
  })

  on('turn.complete', ($, e, next) => {
    if (e.agentId === undefined && state.turnStartedMs !== null) {
      // A long turn that ends while nobody watches is worth saying: the band announces it (a short one is not news).
      const took = Date.now() - state.turnStartedMs

      if (took >= 30_000) addNotice(state, { level: 'ok', text: `✓ Claude finished a turn · ${took < 60_000 ? `${Math.round(took / 1000)}s` : `${Math.floor(took / 60_000)}m ${Math.round((took % 60_000) / 1000)}s`}`, key: 'turn-done' })
    }
    if (e.agentId === undefined) state.turnStartedMs = null
    if (e.agentId === undefined) control?.markFrame('', false)
    if (e.agentId === undefined && host !== null) {
      try {
        onTurnComplete(state, host, e.reason)
      } catch {
        // A note that could not be recorded never changes the turn.
      }
    }

    return next(e)
  })

  // The mission Claude is working on rides in the system prompt (ADR-443); the text changes only when the task does.
  on('prompt.compose', async ($, e, next) => {
    const result = await next(e)
    const section = contextSection(state)

    return section === null ? result : { sections: [...result.sections, section] }
  })

  // A prompt carrying a mission's loop marker is that loop's tick.
  on('prompt.submit', ($, e, next) => {
    if (host !== null) {
      try {
        onPromptSubmit(state, host, e.text)
      } catch {
        // Counting a tick never blocks the prompt.
      }
    }

    return next(e)
  })

  on('ui.close', async ($, e, next) => {
    const result = await next(e)

    if (e.id === PANE_ID && result.deny === undefined) {
      state.pane.isOpen = false
      state.pane.isShown = false
      if (e.origin.kind === 'person') control?.closedByPerson()
      control?.animate()
    }

    return result
  })

  /** Observes only: every call goes on unchanged; the count feeds the activity sparkline. */
  on('tool.call', ($, e, next) => {
    control?.noteToolCall(e.agentId, e.tool)

    return next(e)
  })

  /** Observes only: a deny any verdict reached is listed in the approvals queue; the verdict passes on unchanged. */
  on('tool.check', async ($, e, next) => {
    const verdict = await next(e)

    if (verdict.decision === 'deny') {
      state.denied.push({ tool: plain(String(e.tool), 40), reason: plain(verdict.reason ?? 'no reason given', 160), atMs: Date.now() })
      if (state.denied.length > 20) state.denied.shift()
      record(state.events, [{ atMs: Date.now(), kind: 'mods', text: `${plain(String(e.tool), 40)} denied: ${plain(verdict.reason ?? '', 80)}` }])
    }

    return verdict
  })

  /** Observes only, never refuses: which mods the engine admitted or refused after the console, for the plugins view. */
  on('plugin.register', async ($, e, next) => {
    const result = await next(e)

    state.mods.push({ name: plain(e.name, 40), provenance: plain(e.provenance, 80), isLoaded: result.refuse === undefined, ...(result.refuse !== undefined && { reason: plain(result.refuse, 120) }), atMs: Date.now() })
    if (state.mods.length > 50) state.mods.shift()
    record(state.events, [{ atMs: Date.now(), kind: 'mods', text: `${plain(e.name, 40)} ${result.refuse === undefined ? 'loaded' : 'REFUSED'} (${plain(e.provenance, 60)})` }])

    return result
  })
}
