/**
 * The closures the pane's buttons and `/ruflo` subcommands call: view switches, selection, the claims buttons, the
 * palette. Each does its work through the runner or the controller functions it is handed; nothing here touches `$`.
 */
import { MISSION_OBJECTIVE_MAX } from './full-text'
import { textRefusal } from './ops'
import { claimTask, handoffClaim, releaseClaim, stealClaim, whyNot } from './actions'
import { EVENT_KINDS } from './data/events'
import { evolveActions } from './evolve'
import { askActions } from './ask-claude'
import { loopActions } from './loops'
import { optimizerActions } from './optimizer'
import { navActions } from './nav-state'
import { roomActions } from './room'
import { roomPages } from './views/room'
import { watchActions } from './watch'
import { wireActivity } from './activity-live'
import { eventsActions } from './events-ui'
import { timelineActions } from './timeline-ui'
import { workflowsActions } from './wf-actions'
import { missionActions } from './mission-control'
import { catalogActions } from './plugin-catalog'
import { saveAllowed } from './remember'
import { pluginNames, settingsActions } from './settings'
import { catalogOf } from './plugin-catalog'
import { wireAnatole } from './anatole'
import { wireWorkflows } from './wf-wire'
import { devtoolsActions } from './devtools'
import { HARNESSES, harnessSpec, isAutoAccept, isLive, newSession, send, whyNotRun } from './harness'
import { helpActions } from './help-actions'
import { VIEW_TOPIC } from './help-docs'
import { pluginSpec } from './plugin-ops'
import { startSpec } from './starts'
import { plain } from './data/parse'
import type { Host } from './host'
import { memoryActions } from './memory-lab'
import { filterPalette, paletteEntries } from './palette'
import type { Runner } from './runner'
import { skillActions } from './skills'
import { moreSkillActions } from './skills-lab'
import { CLI_PREFIXES, NAV_KEY, PANE_ID, viewOf, type State } from './state'
import { runUpdateCheck } from './update-flow'
import { claudeActions } from './mission-claude'
import { UPDATES_KEY } from './updates'
import { setToastMode, toggleToastMute } from './toasts'
import { whatsnewActions } from './whatsnew'
import { adrActions } from './adr-actions'
import { sessionActions } from './sessions'
import { vectorActions } from './vector'
import type { Actions } from './views/common'
import { openTasks, selection } from './views/select'

export type Steps = {
  freshRead: () => Promise<void>
  animate: () => void
  probe: (force?: boolean) => Promise<void>
  setView: (view: State['view']) => void
  drill: (agentId: string) => void
  close: () => Promise<void>
}

export function actionsOf(state: State, host: Host, runner: Runner, steps: Steps): Actions {
  const { freshRead, probe, setView, drill, close, animate } = steps

  /**
   * After a command typed in the terminal field (/ruflo, /new, /up…) the rows above the field change, and the engine
   * does not keep the focus ring on it: the next keys would fire hotkeys or leave the pane. Put the ring back.
   */
  const keepField = () => {
    // After the redraw: from inside the submit's own dispatch the ring is moved before the new rows land.
    host.after(80, () => void host.focus(PANE_ID, 'term-input').catch(() => undefined))
  }

  /** j/k: what moves depends on the view in front. */
  function select(by: number): void {
    const view = state.view

    // The Workflows page keeps its own cursor (run, phase, agent): /ruflo next and prev move it as j and k do.
    if (view === 'workflows') return actions.workflows.key(by > 0 ? 'j' : 'k')
    if (view === 'events') return actions.events.move(by)
    if (view === 'timeline') return actions.timeline.move(by)

    const key = view === 'claims' ? 'claim' : view === 'swarm' || view === 'agent' ? 'agent' : 'item'

    state.select[key] += by

    const next = view === 'agent' ? selection(state).agent : null

    // In the drill-down, j/k walks to the next agent and asks for its logs.
    if (next !== null) drill(next.id)
    host.invalidate()
  }

  wireAnatole(state, host)
  wireWorkflows(state, host)
  wireActivity(state, host)
  const actions: Actions = {
    view: setView,
    remember: seen => {
      // "Always allow" is the person's answer to the card they read: on a card that was replaced it remembers nothing (as a stale Yes runs nothing).
      if (seen !== undefined && state.pending?.id !== seen) {
        void runner.confirm(seen)

        return
      }

      const key = state.pending?.rememberKey

      if (key !== undefined && state.pending !== null) {
        state.allowed.set(key, state.pending.label)
        saveAllowed(state, host)
      }

      void runner.confirm(seen)
    },
    forget: key => {
      if (key === '') state.allowed.clear()
      else state.allowed.delete(key)
      saveAllowed(state, host)
      host.invalidate()
    },
    nav: style => {
      state.nav = style
      void host.storeSet(NAV_KEY, style).catch(() => undefined)
      host.invalidate()
    },
    updates: mode => {
      state.updates = mode
      void host.storeSet(UPDATES_KEY, mode).catch(() => undefined)
      host.invalidate()
    },
    toasts: {
      mode: mode => setToastMode(state, host, mode),
      mute: source => toggleToastMute(state, host, source),
    },
    whatsnew: whatsnewActions(state, host),
    adrs: adrActions(state, host, runner),
    checkUpdates: () => {
      state.updateNote = 'checking…'
      host.invalidate()
      void runUpdateCheck(state, host, { force: true })
    },
    editField: (key, text) => {
      state.fieldText.set(key, text)
      host.invalidate()
      host.after(60, () => void host.focus(PANE_ID, key).catch(() => undefined))
    },
    clearField: key => {
      state.fieldText.set(key, '')
      host.invalidate()
    },
    toggle: key => {
      if (state.sections.has(key)) state.sections.delete(key)
      else state.sections.add(key)
      host.invalidate()
    },
    refresh: () => {
      void freshRead().then(() => probe(true))
      // The skills lists come from `npx skills`, not the disk read: r asks for them again on that view.
      if (state.view === 'skills') actions.skills.list()
      if (state.view === 'evolve') actions.evolve.reread()
    },
    restart: () => {
      // The intro plays again from now (BBS look and the boot option on); the pane redraws at once, and the read starts over beneath it.
      state.pane.bootAtMs = Date.now()
      state.pane.menuAtMs = 0
      host.invalidate()
      animate()
      actions.refresh()
    },
    help: () => {
      state.isHelp = !state.isHelp
      // Help opens on the guide for the page you were on (the index from the menu), with a clean question.
      if (state.isHelp) {
        host.scrollTop()
        state.help.query = ''
        state.help.topic = VIEW_TOPIC[state.view === 'agent' ? state.back : state.view] ?? null
      }
      host.invalidate()
    },
    close: () => void close(),
    back: () => setView(state.view === 'agent' ? state.back : state.options.look === 'bbs' ? 'menu' : 'overview'),
    confirm: seen => void runner.confirm(seen),
    cancel: runner.cancel,
    select,
    agentNext: () => {
      state.select.agent += 1
      host.invalidate()
    },
    taskNext: () => {
      state.select.task += 1
      host.invalidate()
    },
    drill: () => {
      const agent = selection(state).agent

      if (agent !== null) drill(agent.id)
    },
    claim: () => {
      const { agent, task, claim } = selection(state)

      runner.ask(task !== null && agent !== null ? claimTask(task, agent) : null, whyNot('claim', claim, agent, openTasks(state)[0] ?? task))
    },
    release: () => {
      const { claim, agent, task } = selection(state)

      runner.ask(claim !== null ? releaseClaim(claim) : null, whyNot('release', claim, agent, task))
    },
    handoff: () => {
      const { claim, agent, task } = selection(state)

      runner.ask(claim !== null && agent !== null ? handoffClaim(claim, agent) : null, whyNot('handoff', claim, agent, task))
    },
    steal: () => {
      const { claim, agent, task } = selection(state)

      runner.ask(claim !== null && agent !== null ? stealClaim(claim, agent) : null, whyNot('steal', claim, agent, task))
    },
    palette: context => {
      state.palette = { isOpen: !state.palette.isOpen || state.palette.context !== context, query: '', index: 0, context }
      state.isHelp = false
      if (state.palette.isOpen) host.scrollTop()
      host.invalidate()
    },
    paletteQuery: text => {
      // Never cut as it is typed (ADR-481): a run over a limit is refused with the exact count by the runner.
      state.palette.query = plain(text, Number.MAX_SAFE_INTEGER)
      state.palette.index = 0
      host.invalidate()
    },
    paletteRun: id => {
      const entry = paletteEntries(state, Date.now()).find(candidate => candidate.id === id)

      if (entry !== undefined) runner.runEntry(entry, entry.run.kind === 'text' ? state.palette.query.trim().slice(entry.run.keyword.length).trim() : '')
    },
    paletteSubmit: () => {
      const best = filterPalette(paletteEntries(state, Date.now()), state.palette.query, state.palette.context)[0]

      if (best !== undefined) runner.runEntry(best, best.run.kind === 'text' ? state.palette.query.trim().slice(best.run.keyword.length).trim() : '')
    },
    run: (id, text = '') => {
      const before = state.pending?.id
      const isRun = runner.runById(id, text)

      // The card this field text raised, by id: Enter again on the same text confirms that card and no other.
      state.askedAgain = state.pending !== null && state.pending.id !== before && state.pending.id !== undefined ? { entry: id, text: text.trim(), card: state.pending.id } : null

      return isRun
    },
    costBudgetDraft: text => {
      state.costBudgetDraft = text
    },
    filter: () => {
      const order = ['all', ...EVENT_KINDS] as const
      const at = order.indexOf(state.eventFilter)

      state.eventFilter = order[(at + 1) % order.length] ?? 'all'
      host.invalidate()
    },
    focus: key => void host.focus(PANE_ID, key).catch(() => undefined),
    plugin: op => runner.ask(pluginSpec(op), 'that cannot run here'),
    start: (id, text = '') => runner.ask(startSpec(id, Date.now(), text, present => { state.nostrKeyVerifiedAtMs = present ? Date.now() : null }), id === 'mission' || id === 'task' ? ((id === 'mission' ? textRefusal(text, 'the objective', MISSION_OBJECTIVE_MAX) : textRefusal(text, 'the description')) ?? 'type it first (it may not start with -)') : 'that start cannot run here'),
    // The main menu's prompt, as a board's: a key (2, w, i), a name (swarm, x.ruv.io), ? for help, O to log off.
    menu: text => {
      const word = text.trim().toLowerCase()
      const view = viewOf(word)

      if (word === '') return
      if (word === '?' || word === 'h' || word === 'help') actions.help()
      else if (word === 'p') actions.palette('all')
      else if (word === 'r') actions.restart()
      else if (word === 'o' || word === 'bye' || word === 'logoff') actions.close()
      else if (view !== null) setView(view)
      else runner.ask(null, `no area "${plain(word, 24)}": type a key from the menu, or ? for help`)
    },
    term: {
      harness: id => {
        state.terminal.harness = id
        host.invalidate()
        // Pressing the pick moved the focus ring onto its button: give the field the keys back.
        if (state.pane.isFocused) void host.focus(PANE_ID, 'term-input').catch(() => undefined)
      },
      draft: text => {
        state.terminal.draft = text
      },
      // In a live session Enter sends, as in a chat. Otherwise Enter asks: the confirm row shows the exact command,
      // and Enter again on the same text runs it (the field keeps the keys throughout; y and n work too).
      // `/new` in the field starts a fresh session.
      submit: text => {
        const key = `${state.terminal.harness}\u0000${text.trim()}`
        const asked = state.terminal.asked

        if (text.trim() === '/new') {
          state.terminal.draft = ''
          newSession(state, host)
          keepField()

          return
        }

        // /up /down /end scroll the conversation from the field (it holds the keys, so PgUp would only type).
        const move = { '/up': 12, '/down': -12, '/end': -state.terminal.scroll }[text.trim()]

        if (move !== undefined) {
          state.terminal.draft = ''
          actions.term.scroll(move)
          keepField()

          return
        }

        // /codex /claude /swarm /ruflo switch harness from the field, which holds the keys (its hotkeys would type).
        const pick = HARNESSES.find(entry => text.trim() === `/${entry.id}`)

        if (pick !== undefined) {
          state.terminal.draft = ''
          state.terminal.harness = pick.id
          // An ask the previous harness left on screen goes with it.
          if (state.terminal.asked !== null && state.terminal.asked.card !== null && state.pending?.id === state.terminal.asked.card) runner.cancel()
          state.terminal.asked = null
          host.invalidate()
          keepField()

          return
        }

        if (isLive(state) || isAutoAccept(state)) {
          const why = whyNotRun(state, text)

          if (why !== null) {
            runner.ask(null, why)

            return
          }

          state.terminal.draft = ''
          send(state, host, text)

          return
        }

        // The engine may empty the field on submit, so an empty Enter on a pending ask confirms it too.
        // Enter again answers the card this field raised, by its id: a card with the same words that took its place is not it.
        if (asked !== null && asked.card !== null && (asked.key === key || text.trim() === '') && state.pending?.id === asked.card) {
          state.terminal.asked = null
          state.terminal.draft = ''
          void runner.confirm(asked.card)

          return
        }

        const spec = harnessSpec(state, host, text)

        // The text is in the pending ask (an empty Enter or Yes runs it): the field clears, unless it cannot be sent and stays to be fixed.
        state.terminal.draft = spec !== null ? '' : text
        const before = state.pending?.id

        runner.ask(spec, whyNotRun(state, text) ?? 'nothing to run')
        state.terminal.asked = spec !== null ? { key, label: spec.label, card: state.pending !== null && state.pending.id !== before ? (state.pending.id ?? null) : null } : null
      },
      stop: () => {
        for (const run of state.terminal.runs.values()) run.stop()
      },
      fresh: () => newSession(state, host),
      clear: () => {
        state.terminal.lines = []
        state.terminal.scroll = 0
        state.terminal.unseen = 0
        host.invalidate()
      },
      scroll: by => {
        state.terminal.scroll = Math.max(0, state.terminal.scroll + by)
        if (state.terminal.scroll === 0) state.terminal.unseen = 0
        host.invalidate()
      },
      // A click on an earlier question puts it back in the field, ready to edit or send again.
      reuse: text => {
        state.terminal.draft = text
        host.invalidate()
        if (state.pane.isFocused) void host.focus(PANE_ID, 'term-input').catch(() => undefined)
      },
      // A menu entry elsewhere (x.ruv.io) opens the terminal with its command typed, not run: Enter twice runs it.
      load: (id, text) => {
        state.terminal.harness = id
        state.terminal.draft = text
        setView('terminal')
      },
      // An ask link is the person's ask: it goes to the agent now, no Enter to confirm it. Busy or empty, it waits in the field instead.
      ask: (id, text) => {
        state.terminal.harness = id
        setView('terminal')

        if (whyNotRun(state, text) !== null) {
          state.terminal.draft = text
          host.invalidate()

          return
        }

        state.terminal.draft = ''
        send(state, host, text)
        host.invalidate()
      },
    },
    // ▸ edit hands the skill to the AI terminal, as x.ruv.io's ▸ open does: typed, not run.
    skills: { ...skillActions(state, host, runner, text => actions.term.load('claude', text)), ...moreSkillActions(state, host, runner, text => actions.term.load('claude', text)) },
    memory: memoryActions(state, runner, host.invalidate),
    // An rvlite query is MCP-only: it goes to the AI terminal typed, as ▸ edit does, and runs only when sent.
    vector: vectorActions(state, runner, text => actions.term.load('claude', text)),
    evolve: evolveActions(state, host, text => actions.term.ask('claude', text)),
    settings: settingsActions(state, host, runner, (agent, text) => actions.term.ask(agent, text), () => CLI_PREFIXES[state.options.cli], () => pluginNames(state, (catalogOf(state).plugins ?? []).filter(plugin => plugin.options.length > 0).map(plugin => plugin.name))),
    mission: { ...missionActions(state, host, runner), ...claudeActions(state, host, runner) },
    ask: askActions(state, host, runner, () => actions),
    ruhelp: helpActions(state, host, runner, () => actions),
    loops: loopActions(state, host, runner),
    optimizer: optimizerActions(state, () => host.invalidate(), id => void runner.runById(id, ''), question => actions.ask.ask(question, 'overview')),
    watch: watchActions(state, () => host.invalidate(), (question, view) => actions.ask.ask(question, view)),
    events: eventsActions(state, host, () => host.invalidate(), (spec, why = 'that cannot run here') => runner.ask(spec, why), question => actions.ask.ask(question, 'events')),
    timeline: timelineActions(state, host, () => host.invalidate(), id => setView(id), (spec, why = 'that cannot run here') => runner.ask(spec, why), question => actions.ask.ask(question, 'timeline')),
    sessions: sessionActions(state, host),
    room: roomActions(state, () => host.invalidate(), (id, text) => runner.runById(id, text), () => roomPages(state)),
    navigator: navActions(state, () => host.invalidate(), view => actions.view(view)),
    catalog: catalogActions(state, host, runner, text => actions.term.load('claude', text)),
    control: {
      pause: on => {
        state.control.paused = on
        host.invalidate()
      },
    },
    workflows: workflowsActions(state, host, runner),
    devtools: devtoolsActions(state, host, runner.runById, why => runner.ask(null, why)),
  }

  return actions
}
