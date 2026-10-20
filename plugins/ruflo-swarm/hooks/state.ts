import type { PluginOptions, Timer } from 'claude-code'

import type { ActionSpec } from './actions/argv'
import type { Activity } from './model/members'
import { routeFromStore, type RoutePick } from './reader/parse'
import type { Snapshot } from './reader/snapshot'

export const PANE_ID = 'ruflo-swarm'

/**
 * The `$.store` key the few facts that must outlive a hot reload sit under. `$.store` is the plugin's, not the folder's,
 * so the key carries the working directory: a router pick or a selection never follows the person into another project.
 */
export const storeKeyOf = (cwd: string): string => `ruflo-swarm/ui:${cwd}`

/** How the pane reaches the ruflo CLI. Each is a fixed argv prefix; only `npx` may touch the network. */
export const CLI_PREFIXES = {
  'npx-offline': ['npx', '--offline', '-y', '@claude-flow/cli@latest'],
  npx: ['npx', '-y', '@claude-flow/cli@latest'],
  ruflo: ['ruflo'],
  'claude-flow': ['claude-flow'],
} as const satisfies Record<string, readonly string[]>

export type CliChoice = keyof typeof CLI_PREFIXES

export type Options = {
  /** `auto` opens the pane once a swarm is on disk and the layout docks panes; `command` only on request; `off` never. */
  panel: 'auto' | 'command' | 'off'
  cli: CliChoice
  /** A router pick under this confidence is drawn as "below threshold", with its score. */
  routeThreshold: number
  /** Appends a short swarm note to the prompt of each subagent Claude Code spawns. */
  injectSpawnContext: boolean
  /** Records a bounded, content-free trail of engine events into ruflo memory. */
  audit: boolean
  /** Appends the ADRs attached to the active ruflo-console mission to the prompt of each subagent (default on; nothing is added without an attached ADR). */
  injectAdrs: boolean
}

const PANELS = new Set(['auto', 'command', 'off'])

/** The options as the settings hold them, each one checked: a value the plugin does not know is its default. */
export function optionsOf(raw: PluginOptions): Options {
  const value = (raw ?? {}) as Record<string, unknown>
  // `command` by default since ruflo-console: its cockpit is the pane that opens by itself, and two would crowd the dock.
  const panel = typeof value.panel === 'string' && PANELS.has(value.panel) ? (value.panel as Options['panel']) : 'command'
  const cli = typeof value.cli === 'string' && value.cli in CLI_PREFIXES ? (value.cli as CliChoice) : 'npx-offline'
  const threshold = typeof value.routeThreshold === 'number' ? value.routeThreshold : Number(value.routeThreshold)

  return {
    panel,
    cli,
    routeThreshold: Number.isFinite(threshold) && threshold >= 0 && threshold <= 1 ? threshold : 0.5,
    injectSpawnContext: value.injectSpawnContext === true,
    audit: value.audit === true,
    injectAdrs: value.injectAdrs !== false,
  }
}

/** A destructive or mutating action waiting for the person's second press. */
export type PendingConfirm = { label: string; spec: ActionSpec; askedAtMs: number }

/** What an action did, as the pane says it: what ran, how it exited, and whether the disk shows the change. */
export type ActionOutcome = { label: string; ok: boolean; verified: 'yes' | 'no' | 'n/a'; detail: string; atMs: number }

export type Usage = { costUsd?: number; contextTokens?: number; contextPercent?: number; contextWindow?: number; readAtMs: number }

export type State = {
  options: Options
  cwd: string
  snapshot: Snapshot | null
  readError: string | null
  isRefreshing: boolean
  isRefreshQueued: boolean
  activity: Activity
  usage: Usage | null
  route: RoutePick | null
  pane: { isOpen: boolean; isClosedByPerson: boolean; columns: number; rows: number }
  viewport: { isFullscreen?: boolean }
  /** The tile the buttons act on, by member id: survives a re-read that reorders the tiles. */
  selected: string | null
  selectedTask: string | null
  confirm: PendingConfirm | null
  outcome: ActionOutcome | null
  isActing: boolean
  /** Lines an action asked to show (an agent's logs), with whose they are. */
  detail: { title: string; lines: string[] } | null
  timers: Map<string, Timer>
  audit: { buffer: string[]; dropped: number; flushedAtMs: number }
}

export function newState(raw: PluginOptions, activity: Activity): State {
  return {
    options: optionsOf(raw),
    cwd: '',
    snapshot: null,
    readError: null,
    isRefreshing: false,
    isRefreshQueued: false,
    activity,
    usage: null,
    route: null,
    pane: { isOpen: false, isClosedByPerson: false, columns: 0, rows: 0 },
    viewport: {},
    selected: null,
    selectedTask: null,
    confirm: null,
    outcome: null,
    isActing: false,
    detail: null,
    timers: new Map(),
    audit: { buffer: [], dropped: 0, flushedAtMs: 0 },
  }
}

/** The part of the state written to `$.store`, so a hot reload keeps what the person chose. */
export type Persisted = { selected: string | null; selectedTask: string | null; isClosedByPerson: boolean; route: RoutePick | null }

export function persistedOf(state: State): Persisted {
  return { selected: state.selected, selectedTask: state.selectedTask, isClosedByPerson: state.pane.isClosedByPerson, route: state.route }
}

export function restore(state: State, value: unknown): void {
  if (value === null || typeof value !== 'object') {
    return
  }

  const held = value as Partial<Persisted>

  state.selected = typeof held.selected === 'string' ? held.selected : null
  state.selectedTask = typeof held.selectedTask === 'string' ? held.selectedTask : null
  state.pane.isClosedByPerson = held.isClosedByPerson === true
  state.route = routeFromStore(held.route)
}
