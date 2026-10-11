/**
 * The pictures of the view in front, by Raster key, for one instant. The render mounts them and the animation loop
 * blits them, both through `picturesOf`, so a frame is always the mounted size. Each picture's model is read from the
 * state here; the drawing itself is in ../gfx.
 */
import type { AuditTrend, HarnessScore, Intelligence } from '../data/cli'
import { recentByAgent } from '../data/events'
import { agentLabels } from '../data/parse'
import { presentAgents, swarmStatusOf } from '../data/swarm-status'
import { getBootChecks } from '../boot-checks'
import { bootFacts } from '../boot-facts'
import { getBuild } from '../build'
import { PALETTE, rgb } from '../menu-colors'
import { CONSOLE_VERSION } from '../version'
import type { Snapshot } from '../data/snapshot'
import type { Channels, Peers, Roster } from '../data/cli'
import { pipelinePicture, radarPicture, samplesPicture, trendPicture, gaugePicture, type Stage } from '../gfx/charts'
import { loopPicture, loopStagesOf } from '../gfx/evolve'
import { flowModelOf, flowPicture, flowRows } from '../gfx/flow'
import { federationPicture, heatmapPicture, type FedNode, type HealthRow, type Lane } from '../gfx/maps'
import { activityPicture, bannerPicture, bootPicture, titlePicture, curvePicture, headerPicture, palettePicture, PULSE_MS, topologyPicture, type TopoModel } from '../gfx/pictures'
import type { Grid } from '../gfx/raster'
import { PROBES, severityOf } from '../data/cli'
import { EXPECTED_IN_MARKET, RUFLO_MARKET } from '../data/snapshot'
import { ICON_SLACK, iconCells, usedColumns } from '../icon-layout'
import { entryAge } from '../menu-entry'
import { BOOT_MIN_MS, isBooting, isCompactPane, VIEWS, type State } from '../state'
import { CARD_COLUMNS, hasCards } from './card'
import { live } from './common'
import { hivePictures } from './hive'
import { openTasks } from './select'

export const MAX_NODES = 100
export const HEALTH_CHECKS = ['installed', 'enabled', 'clone', 'mod'] as const
import { chartOf, eventsModel } from '../events-ui'
import { linesPicture, stackedPicture } from '../gfx/ev-charts'
import { timelineModel } from '../timeline-ui'
import { linesFor } from './timeline-lines'
import { watchOf } from '../watch'
/** The radar's axis words: the score's own dimension names, shortened to fit at a spoke's end. */
const AXIS: Record<string, string> = { harnessFit: 'fit', compileConfidence: 'compile', taskCoverage: 'coverage', toolSafety: 'safety', memoryUsefulness: 'memory' }

/** The swarm as a graph: the hive's queen leads where there is one, else the swarm itself stands at the root. */
export function topoModelOf(snapshot: Snapshot | null, pulses: Map<string, number> = new Map(), nowMs: number = Date.now()): TopoModel | null {
  const swarm = snapshot?.swarm ?? null

  if (snapshot === null || (swarm === null && snapshot.hive === null && snapshot.agents.length === 0)) return null

  // A swarm's members are the ids its record lists, even none: the agent store holds every agent ever spawned and is not this swarm.
  const status = swarm === null ? null : swarmStatusOf(swarm, nowMs, snapshot.agents)
  const members = status !== null ? snapshot.agents.filter(agent => status.ids.includes(agent.id)) : snapshot.agents
  const labels = agentLabels(snapshot.agents)
  const leaderId = snapshot.hive?.queen ?? swarm?.id ?? 'swarm'
  const leaderPulse = pulses.get(leaderId)

  return {
    topology: swarm?.topology ?? snapshot.hive?.topology ?? 'hierarchical',
    nodes: [
      { id: leaderId, label: snapshot.hive?.queen !== undefined ? 'queen' : 'swarm', status: snapshot.hive?.queen !== undefined ? 'leader' : (status?.shown ?? 'unknown'), isLeader: true, ...(leaderPulse !== undefined && { pulseAtMs: leaderPulse }) },
      ...members.slice(0, MAX_NODES - 1).map(agent => {
        const pulseAtMs = pulses.get(agent.id)

        return { id: agent.id, label: labels.get(agent.id) ?? agent.type, status: agent.status, isLeader: false, ...(pulseAtMs !== undefined && { pulseAtMs }) }
      }),
    ],
  }
}

/** Rows the topology graph takes: enough for a tree, more for a wide swarm or a circle. */
export const topologyRows = (columns: number, nodes: number): number => Math.min(24, Math.max(columns >= 90 ? 12 : 10, 8 + Math.ceil(nodes / Math.max(1, Math.floor(columns / 5))) * 3))

/** Each learning stage's count and source; null where nothing measures it. */
export function stagesOf(state: State): Stage[] {
  const snap = state.snapshot
  const intel = live<Intelligence>(state.probes.get('intelligence'))

  return [
    { name: 'RETRIEVE', count: snap?.neural?.trajectories ?? null, source: 'trajectories (neural/stats.json)' },
    { name: 'JUDGE', count: snap?.outcomes?.total ?? null, source: 'routed outcomes judged (routing-outcomes.json)' },
    { name: 'DISTILL', count: snap?.neural?.patterns ?? null, source: 'patterns learned (neural/stats.json)' },
    { name: 'CONSOLIDATE', count: intel?.ewcConsolidations ?? null, source: 'EWC consolidations (hooks_intelligence_stats)' },
  ]
}

/** Peers, own keys, channels and (when asked for) roster members, each with its trust. */
export function fedNodesOf(state: State): FedNode[] {
  const peers = live<Peers>(state.probes.get('peers'))?.peers ?? []
  const channels = live<Channels>(state.probes.get('channels'))?.channels ?? []
  const roster = state.options.federationNetwork ? (live<Roster>(state.probes.get('roster'))?.members ?? []) : []

  return [
    ...peers.map(peer => ({ label: peer.id, trust: 'pinned' as const, ...(peer.lastSyncMs !== undefined && { trafficAtMs: peer.lastSyncMs }) })),
    ...(state.snapshot?.federationNodes ?? []).map(node => ({ label: node, trust: 'key' as const })),
    ...channels.map(channel => ({ label: channel.name ?? channel.id, trust: 'channel' as const, ...(channel.atMs !== undefined && { trafficAtMs: channel.atMs }) })),
    ...roster.map(member => ({ label: member.name, trust: 'roster' as const })),
  ]
}

/** One row per ruflo plugin installed or offered: installed, enabled, in the clone, and (for mods) loaded here. */
export function healthRowsOf(state: State): HealthRow[] {
  const facts = state.snapshot?.plugins
  const installed = new Map((facts?.installed ?? []).filter(plugin => plugin.marketplace === RUFLO_MARKET).map(plugin => [plugin.name, plugin]))
  const names = [...new Set([...installed.keys(), ...(facts?.rufloOffered ?? []), ...EXPECTED_IN_MARKET])].sort()
  const mods: Record<string, boolean | null> = { 'ruflo-console': true, 'ruflo-mods': state.ruflo.snapshot !== null }

  return names.map(name => ({
    name: name.replace(/^ruflo-/, ''),
    cells: [installed.has(name), facts?.enabled.has(`${name}@${RUFLO_MARKET}`) ?? null, facts?.rufloOffered === null || facts === undefined ? null : facts.rufloOffered.includes(name), name in mods ? (mods[name] ?? null) : null],
  }))
}

/**
 * The timeline's lanes over the last 15 minutes: ruflo agents' observed statuses and Claude Code's tool calls, in the order a short list must
 * keep them: the person's own main session, then busy agents, then sub-agents with calls in the window (latest first), then the other present
 * agents, then quiet sub-agents. A page that shows the first few never hides main or a busy agent behind earlier quiet rows, and the full
 * length is what its "+N more" counts. (presentAgents already leaves the agent store's old idle records out.)
 */
export function lanesOf(state: State, nowMs: number): Lane[] {
  const from = nowMs - watchOf(state).rangeMs
  const labels = agentLabels(state.snapshot?.agents ?? [])
  // Only agents with evidence of activity (data/swarm-status.ts presentAgents): the store holds every agent ever spawned.
  const agents = presentAgents(state.snapshot?.agents ?? [], state.statusLog, from, nowMs).map(agent => {
    const log = state.statusLog.get(agent.id) ?? []

    return {
      busy: /busy|active|working|running/i.test(agent.status),
      lane: {
        label: labels.get(agent.id) ?? agent.type,
        spans: log.map((entry, i) => ({ fromMs: Math.max(from, entry.atMs), toMs: log[i + 1]?.atMs ?? nowMs, busy: /busy|active|working/i.test(entry.status) })).filter(span => span.toMs >= from),
        ticks: [],
      },
    }
  })
  const claude = [...state.toolsByAgent].map(([who, calls]) => {
    const ticks = calls.map(call => call.atMs).filter(at => at >= from)

    return { main: who === 'main', lastMs: ticks.reduce((latest, at) => Math.max(latest, at), 0), lane: { label: who === 'main' ? 'claude (main)' : `cc ${who.slice(-6)}`, spans: [], ticks } }
  })
  const subs = claude.filter(entry => !entry.main).sort((a, b) => b.lastMs - a.lastMs)

  return [
    ...claude.filter(entry => entry.main).map(entry => entry.lane),
    ...agents.filter(entry => entry.busy).map(entry => entry.lane),
    ...subs.filter(entry => entry.lastMs > 0).map(entry => entry.lane),
    ...agents.filter(entry => !entry.busy).map(entry => entry.lane),
    ...subs.filter(entry => entry.lastMs === 0).map(entry => entry.lane),
  ]
}

/** When the score on screen was first drawn: the radar grows from there. Module-held, reset by a new value. */
const scoreShown = new WeakMap<object, number>()

/**
 * A header picture sized to what it uses, and never wider than the pane leaves beside the icon row: the Raster draws its whole grid, so a grid padded
 * to 120 cells would sit under the icons. Built at the widest allowed size, then again at the width it really used.
 */
function fitHeader(paneColumns: number, build: (columns: number) => Grid, max: number): Grid {
  const wide = build(Math.max(8, Math.min(max, paneColumns - iconCells(false) - ICON_SLACK)))
  const used = usedColumns(wide.cells, wide.columns, wide.rows)

  return used > 0 && used < wide.columns ? build(used) : wide
}

/** The first name whose art fits the room beside the icon row, built at the width it uses; the last, clipped to the room, when none does. */
function titleThatFits(paneColumns: number, names: readonly string[], build: (name: string, columns: number) => Grid): Grid {
  const room = Math.max(8, Math.min(120, paneColumns - iconCells(false) - ICON_SLACK))

  for (const name of names) {
    const wide = build(name, 120)
    const used = usedColumns(wide.cells, wide.columns, wide.rows)

    if (used > 0 && used <= room) return build(name, used)
  }

  return build(names.at(-1) as string, room)
}

export function picturesOf(state: State, columns: number, nowMs: number, t: number): Map<string, Grid> {
  const pictures = new Map<string, Grid>()
  // A page in cards (views/card.ts) is narrower by the border and padding: its pictures are drawn to that width, by the render and by the frame loop alike.
  const width = Math.max(20, Math.min(200, hasCards(columns, isCompactPane(state)) ? columns - CARD_COLUMNS : columns))
  const snapshot = state.snapshot

  // The BBS boot screen owns the pane for its first seconds; nothing else is drawn under it.
  if (isBooting(state, nowMs)) {
    pictures.set('boot', bootPicture(state.cwd.split('/').filter(Boolean).at(-1) ?? '', Math.min(width, 90), nowMs - state.pane.bootAtMs, state.probes.size, PROBES.length, state.pane.rows, getBootChecks(), bootFacts(state, CONSOLE_VERSION, getBuild())))

    return pictures
  }

  // The headers strike in when a page is switched to and when the menu enters (never with fps 0, which draws the still header).
  const sinceSwitch = state.pane.viewAtMs > 0 ? nowMs - state.pane.viewAtMs : Infinity
  const headerAge = state.options.fps > 0 ? Math.min(sinceSwitch, entryAge({ look: state.options.look, boot: state.options.boot, ...state.pane }, nowMs, BOOT_MIN_MS) ?? Infinity) : Infinity

  if (state.view === 'menu') {
    const project = state.cwd.split('/').filter(Boolean).at(-1) ?? ''

    pictures.set('header', state.options.look === 'bbs' ? fitHeader(columns, size => bannerPicture(project, size, t, headerAge), 72) : headerPicture(`◆ ruflo v${CONSOLE_VERSION}${getBuild() === '' ? '' : ` · ${getBuild()}`} · ${project}`, Math.min(width, 64), t))
    // The palette strip above the menu's groups moves while the frame loop runs; with fps 0 it is the still strip (the light is off it).
    if (state.options.look === 'bbs') pictures.set('palette', palettePicture(Math.max(8, width - 2), state.options.fps > 0 ? t : 0, PALETTE.map(rgb)))
  }

  // BBS: every view's name as ANSI-style block art under the tabs, compact or not (the neon sign is the boot's alone).
  if (state.options.look === 'bbs') {
    const page = state.isHelp ? 'help' : state.palette.isOpen ? 'palette' : state.view === 'agent' ? 'agent' : (VIEWS.find(view => view.id === state.view)?.label ?? state.view)
    // The menu is the RUFLO board itself; every other page reads `RUFLO | PAGE`, the logo's style left of the page's name.
    const name = state.view === 'menu' && !state.isHelp && !state.palette.isOpen ? 'ruflo bbs' : `ruflo | ${page}`

    // The first of these whose art fits beside the icons: the whole name, the page alone, its short name; clipped only as a last resort.
    const shortName = VIEWS.find(view => view.id === state.view)?.short ?? page
    const names = state.view === 'menu' && !state.isHelp && !state.palette.isOpen ? [name] : [name, page, shortName]

    pictures.set('title', titleThatFits(columns, names, (candidate, size) => titlePicture(candidate, size, t, headerAge)))
  }

  switch (state.view) {
    case 'overview':
      pictures.set('activity', activityPicture([{ label: 'tool calls/5s', values: state.activity }, { label: 'state writes', values: state.writes }], width, t))
      break
    case 'swarm': {
      const model = topoModelOf(snapshot, recentByAgent(state.events, nowMs, PULSE_MS + 600), nowMs)

      if (model !== null) pictures.set('topology', topologyPicture(model, width, topologyRows(width, model.nodes.length), t))
      break
    }
    case 'hive':
      for (const [key, grid] of hivePictures(state, width, nowMs, t)) pictures.set(key, grid)
      break
    case 'claims': {
      const cards = flowModelOf(snapshot?.claims ?? [], openTasks(state), snapshot?.agents ?? [], snapshot?.tasks ?? [])

      if (cards.length > 0) pictures.set('flow', flowPicture(cards, width, flowRows(cards), nowMs))
      break
    }
    case 'federation':
      pictures.set('fedmap', federationPicture(snapshot?.hasNostrKey === true ? 'this node' : 'this node (no key)', fedNodesOf(state), width, 11, t))
      break
    case 'plugins': {
      const rows = healthRowsOf(state)

      pictures.set('health', heatmapPicture(rows, HEALTH_CHECKS, width, Math.min(26, Math.ceil(rows.length / 2) + 1)))
      break
    }
    case 'learning': {
      const stages = stagesOf(state)

      pictures.set('curve', curvePicture((snapshot?.outcomes?.points ?? []).map(point => point.ok), width, 6, t, state.curveGrewAtMs))
      pictures.set('pipeline', pipelinePicture(stages, width, t, stages.map((_, i) => (i === 2 ? (state.history.patterns.at(-1)?.atMs ?? null) : i === 1 ? state.curveGrewAtMs || null : null))))
      pictures.set('patterns', samplesPicture('patterns since load', state.history.patterns, width))
      break
    }
    case 'metaharness': {
      const score = live<HarnessScore>(state.probes.get('metaharness'))
      const audits = live<AuditTrend>(state.probes.get('audits'))

      if (score !== null) {
        if (!scoreShown.has(score)) scoreShown.set(score, t)
        pictures.set('radar', radarPicture(score.dims.map(dim => ({ ...dim, name: AXIS[dim.name] ?? dim.name })), width, 13, t, scoreShown.get(score) ?? t))
      }

      pictures.set(
        'trend',
        trendPicture(
          (audits?.points ?? []).flatMap(point => {
            const level = severityOf(point.worst)

            return level === null ? [] : [level]
          }),
          width,
          4,
          4,
          { top: 'critical', bottom: 'clean', empty: audits === null ? 'audit trend: n/a' : `${audits.total} stored audits: a trend needs two` },
        ),
      )
      break
    }
    case 'cost': {
      const budget = state.ruflo.snapshot?.budget

      pictures.set('gauge', gaugePicture(budget?.usd ?? state.usage?.costUsd ?? null, budget?.limit ?? null, Math.min(width, 60), 9))
      pictures.set('burn', samplesPicture('spend since load', state.history.spend, width))
      break
    }
    case 'evolve':
      pictures.set('evolve-loop', loopPicture(loopStagesOf(state.evolve), width, t))
      break
    case 'timeline': {
      const model = timelineModel(state, nowMs, Math.max(8, width - 10))

      if (model.lanes.length > 0) pictures.set('tl-picture', linesPicture(linesFor(state, model, width), width))
      break
    }
    case 'events': {
      const events = eventsModel(state, nowMs)
      const { data, colors } = chartOf(state, events, nowMs, width)

      if (events.shown.length > 0) pictures.set('ev-chart', stackedPicture(data, colors, width, 5))
      break
    }
    default:
      break
  }

  return pictures
}
