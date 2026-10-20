/**
 * Carries out a `/ruflo` intent (./commands) and answers the command's row. The pane's keys all have an intent here,
 * so everything works without focus. `mods` and `swarm <sub>` are passed on to the plugins that own them; when neither
 * answers, the row says which plugin to load rather than pretending.
 */
import { HELP, parseRuflo, type Intent } from './commands'
import { CATALOG_PATH, commandsText, FALLBACK, parseCatalog, type Catalog } from './data/catalog'
import type { Controller } from './controller'
import { plain } from './data/parse'
import { loadEvolve } from './evolve'
import { refreshWorkflows } from './wf-live'
import { labAnswer } from './mh-lab'
import { skillsAnswer } from './skills-lab'
import { VIEWS, type State } from './state'
import { missionAnswer } from './mission-text'
import { xruvAnswer } from './xruv'
import { barText } from './views/bar'
import { viewText } from './views/pane'
import { autopilotCommand } from './views/ap-panel'
import { hostOf } from './ap-live'
import { watchCommand } from './watch-command'
import { bandReply, noticesReply, quietReply, median, p95 } from './notices'

/** The engine's words when a registered command reaches it with no hook answering (Claude Code 2.1.287). */
const NO_HOOK_ANSWERED = /registered \/ruflo but no command\.run hook answered/

export type Delegate = () => Promise<{ text?: string } | undefined>

/** The one-line answer of `/ruflo status`, with the measured render, refresh and frame costs. */
export function statusLine(state: State): string {
  const stat = (name: string, values: readonly number[]) => (values.length === 0 ? `${name} n/a` : `${name} median ${median(values)}ms p95 ${p95(values)}ms (n=${values.length})`)

  return [barText(state), stat('render', state.stats.renders), stat('refresh', state.stats.refreshes), stat('frame', state.stats.frames)].join(' · ')
}

const OWNER_HINT = {
  'ruflo-mods': 'ruflo-mods is not loaded in this session, so nothing answered `/ruflo mods`. Install it with `npx ruflo mods install` (or enable ruflo-mods@ruflo); its old `/ruflo-mods` command is the same report.',
  'ruflo-swarm': 'ruflo-swarm is not loaded in this session, so nothing answered `/ruflo swarm …`. Enable ruflo-swarm@ruflo; the Swarm view (/ruflo swarm) is the console\'s own.',
} as const

async function open(control: Controller, state: State, label: string): Promise<{ text: string }> {
  const opened = await control.open()

  return { text: opened.isPlaced ? `ruflo console: ${label}` : `The ruflo console could not be shown: ${opened.reason}` }
}

const DUMP_WAIT_MS = 8_000

/** The catalog this plugin ships (read once per session), or the built-in mod list when it is missing or another contract. */
async function loadCatalog(control: Controller): Promise<Catalog> {
  control.catalog ??= control.host.fs
    .read(`${control.host.pluginRoot}/${CATALOG_PATH}`)
    .then(text => parseCatalog(text) ?? FALLBACK, () => FALLBACK)

  return control.catalog
}

/**
 * A view as text, with its CLI probes run first and waited for (at most DUMP_WAIT_MS: a probe still running then reads
 * "asking the ruflo CLI…", as it would on screen). The pane's own view is put back afterwards.
 */
async function dumpOf(control: Controller, state: State, view: State['view']): Promise<string> {
  const shown = state.view

  state.view = view

  try {
    await control.refresh()
    await Promise.race([control.probe(true), new Promise(resolve => setTimeout(resolve, DUMP_WAIT_MS))])
    // Self-Evolution draws from its own file read, which opening the view starts: a dump waits for it too.
    if (view === 'evolve') await loadEvolve(state, control.host)
    if (view === 'workflows') await refreshWorkflows(state, control.host, true)

    return viewText({ state, nowMs: Date.now(), columns: 100, act: control.actions }, view)
  } finally {
    state.view = shown
  }
}

export async function dispatch(control: Controller, state: State, args: string, delegate: Delegate): Promise<{ text: string }> {
  const intent: Intent = parseRuflo(args)

  switch (intent.kind) {
    case 'open':
      // Without a pane to show (claude -p, an SDK host), the view is answered as text in the command's row instead.
      if (!state.isInteractive) return { text: await dumpOf(control, state, intent.view ?? state.view) }
      // The BBS look lands on its main menu when the cockpit opens with no view named, like a board after login.
      if (intent.view !== null) control.setView(intent.view)
      else if (!state.pane.isOpen && state.options.look === 'bbs') control.setView('menu')

      return open(control, state, VIEWS.find(view => view.id === state.view)?.label ?? 'Agent')
    case 'help':
      return { text: HELP }
    case 'close':
      await control.close()

      return { text: 'ruflo console closed (/ruflo opens it again)' }
    case 'status':
      await control.refresh()

      return { text: statusLine(state) }
    case 'delegate': {
      try {
        const answer = await delegate()

        // With nothing beneath, the engine answers in its own words that no hook answered: that is no answer either.
        if (typeof answer?.text === 'string' && answer.text.trim() !== '' && !NO_HOOK_ANSWERED.test(answer.text)) return { text: answer.text }
      } catch {
        // Nothing beneath answers this command: fall through to the hint.
      }

      return { text: OWNER_HINT[intent.owner] }
    }
    case 'palette':
      state.palette = { isOpen: true, query: plain(intent.query, 200), index: 0, context: 'all' }

      return open(control, state, 'palette')
    case 'run': {
      // A headless budget ask checks the installed CLI's help before building a setter spec.
      if (intent.paletteId === 'cost-budget' || intent.paletteId.startsWith('cost-budget-')) await dumpOf(control, state, 'cost')
      const askedAtMs = Date.now()
      const isRun = control.actions.run(intent.paletteId, intent.text)

      if (!isRun) return { text: `No palette entry "${plain(intent.paletteId, 40)}" right now. /ruflo palette lists them; ids look like spawn-coder, claim-release, worker-audit, route.` }

      await control.open()
      // A lab read answers with what it printed, so `/ruflo run mh-genome` works headless.
      if (state.pending === null) await control.runner.settled()

      if (state.pending !== null) {
        const pending = state.pending

        // The answer puts this card in front of the person, so a bare /ruflo yes may answer it (and only it).
        state.shownCard = pending.id ?? null

        return { text: [`Asked: ${pending.label}. Confirm with /ruflo yes (or y in the pane), cancel with /ruflo no.`, ...(pending.shows === undefined ? [] : [`runs: ${pending.shows}`, pending.note ?? ''])].filter(Boolean).join('\n') }
      }

      return { text: (missionAnswer(state, intent.paletteId) ?? xruvAnswer(state, intent.paletteId, askedAtMs) ?? labAnswer(state, intent.paletteId, askedAtMs) ?? skillsAnswer(state, intent.paletteId, askedAtMs)) ?? (state.outcome !== null && !state.outcome.ok ? `${state.outcome.label}: ${state.outcome.detail}` : (state.outcome?.label ?? 'done')) }
    }
    case 'confirm':
      if (state.pending === null) return { text: 'Nothing is waiting for a confirm.' }

      if (!intent.isYes) {
        control.runner.cancel()

        return { text: 'Cancelled.' }
      }

      const confirmedAtMs = Date.now()

      // A typed yes names no card: the runner refuses it while the card is too new or just replaced one (press the card's own Yes then).
      await control.runner.confirmUnbound(intent.card)

      return { text: xruvAnswer(state, null, confirmedAtMs) ?? labAnswer(state, null, confirmedAtMs) ?? (state.outcome === null ? 'Ran.' : `${state.outcome.ok ? '✓' : '✗'} ${state.outcome.label}: ${state.outcome.detail}${state.outcome.verified === 'yes' ? ' (on disk)' : state.outcome.verified === 'no' ? ' (not on disk yet)' : ''}`) }
    case 'agent': {
      const who = intent.who.toLowerCase()
      const agent = state.snapshot?.agents.find(entry => entry.id.toLowerCase() === who || entry.name?.toLowerCase() === who) ?? state.snapshot?.agents.find(entry => entry.id.toLowerCase().endsWith(who))

      if (agent === undefined) return { text: `No agent "${plain(intent.who, 40)}" in .claude-flow/agents/store.json.` }

      control.drill(agent.id)

      return open(control, state, `agent ${agent.name ?? agent.type}`)
    }
    case 'back':
      control.actions.back()

      return open(control, state, VIEWS.find(view => view.id === state.view)?.label ?? 'back')
    case 'select':
      control.actions.select(intent.by)

      return { text: `selection moved (${intent.by > 0 ? 'next' : 'prev'}) on ${state.view}` }
    case 'filter':
      state.eventFilter = intent.filter
      control.setView('events')

      return open(control, state, `events · ${intent.filter}`)
    case 'dump': {
      const view = intent.view ?? state.view
      const shown = state.view

      return { text: await dumpOf(control, state, view) }
    }
    case 'band':
      control.host.invalidate()

      return { text: bandReply(state, intent.arg) }
    case 'notices':
      return { text: noticesReply(state, Date.now(), intent.isClear) }
    case 'quiet':
      control.host.invalidate()

      return { text: quietReply(state, Date.now(), intent.arg) }
    case 'autopilot': {
      const apHost = hostOf(state)

      return { text: apHost === undefined ? 'autopilot is not wired into this console yet' : await autopilotCommand(state, apHost, intent.arg) }
    }
    case 'commands':
      return { text: commandsText(await loadCatalog(control), intent.query) }
    case 'events':
    case 'timeline':
      return watchCommand(control, state, intent)
    case 'unknown':
      return { text: `Unknown: "${plain(intent.word, 30)}". /ruflo help lists the views (${VIEWS.map(view => view.id).join(', ')}) and commands.` }
  }
}
