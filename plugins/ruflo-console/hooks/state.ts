import type { PluginOptions, Timer } from 'claude-code'
import { guardOptionsOf, type GuardOptions } from './data/wf-alerts'
import { sessionOptionsOf, type SessionOptions } from './data/sessions-options'
import { convoOptionsOf, type ConvoOptions } from './data/wf-targets'

import { emptyAuto, type AutoState } from './data/automate'
import type { ProbeResult } from './data/cli'
import { emptyFields, type DevFields } from './data/devtools'
import type { ConsoleEvent } from './data/events'
import type { ReadCache } from './data/files'
import { emptyEvolve, type EvolveState } from './data/evolve'
import { emptySkills, type SkillsState } from './data/skills'
import type { UpdatesMode } from './updates'
import type { Digest, ToastPrefs } from './toast-policy'
import { newWhatsNew, type WhatsNewState } from './whatsnew'
import { emptyMemoryLab, type MemoryLabState } from './memory-lab'
import { emptyVector, type VectorState } from './data/vector'
import type { Snapshot } from './data/snapshot'
import type { RufloRoute, RufloSnapshot } from '../types'
import type { Notice } from './notices'
import { emptyWf, type WfState } from './wf-state'

export const PLUGIN_NAME = 'ruflo-console'
export const PANE_ID = 'ruflo-console'

/** How the main nav spells its tabs: auto (names when the pane is wide), icons only, icon and a brief title, icon and the full title. */
export type NavStyle = 'auto' | 'icons' | 'brief' | 'full'
export const NAV_STYLES: readonly NavStyle[] = ['auto', 'icons', 'brief', 'full']
export const NAV_KEY = 'nav-style'

export type ViewId = 'menu' | 'overview' | 'swarm' | 'workflows' | 'hive' | 'claims' | 'federation' | 'plugins' | 'learning' | 'metaharness' | 'memory' | 'cost' | 'timeline' | 'approvals' | 'events' | 'room' | 'missions' | 'xruv' | 'terminal' | 'skills' | 'agent' | 'secure' | 'perf' | 'automate' | 'neural' | 'vector' | 'evolve' | 'devtools' | 'sandbox' | 'market' | 'settings' | 'whatsnew' | 'adrs'

/**
 * The views in tab order, each with its hotkey and the inline height it asks for. Digits are the first nine; the three
 * management views take letters no other control uses. `agent` is the drill-down, reached from a selection, not a tab.
 */
/**
 * `icon` is an emoji with default emoji presentation (no variation selector, so it renders as one 2-cell glyph
 * everywhere), shown in the tab bar; the
 * current tab adds its label, and `blurb` is the one line under the bar that says what the view is for.
 */
export const VIEWS: readonly { id: ViewId; key: string; label: string; short: string; icon: string; blurb: string; rows: number }[] = [
  // Every view has a hotkey (one digit or lowercase letter is all a Button takes): digits 0-9 are the first ten, letters follow. A view's own
  // keys (claims c l o s, the terminal l c v u, the footer p x r h) win while that view is open; the tab and the menu still reach it.
  { id: 'menu', key: '0', label: 'Main Menu', short: 'Mnu', icon: '📟', blurb: 'the board: every area by its key, the line status, and a prompt that takes a key or a name', rows: 32 },
  { id: 'missions', key: '1', label: 'Missions', short: 'Msn', icon: '🎯', blurb: 'Mission Control: a goal becomes a SPARC plan, a mission and tasks that Claude carries out, with guidance, controls and evidence', rows: 26 },
  { id: 'overview', key: '2', label: 'Overview', short: 'Ovr', icon: '🏠', blurb: 'what ruflo is doing here: subsystems, mods, health alerts and live activity', rows: 26 },
  { id: 'swarm', key: '3', label: 'Swarm', short: 'Swm', icon: '🐝', blurb: 'the swarm as ruflo wrote it: topology, agents at work, and the hive-mind votes', rows: 30 },
  { id: 'hive', key: 'b', label: 'Hive-Mind', short: 'Hiv', icon: '👑', blurb: 'the queen, her workers and their votes: quorum, fault tolerance, proposals and broadcasts', rows: 40 },
  { id: 'claims', key: '4', label: 'Claims', short: 'Clm', icon: '📌', blurb: 'who holds which task: claim, release, hand off or steal, each after a y/n confirm', rows: 30 },
  { id: 'workflows', key: '', label: 'Workflows', short: 'Wfl', icon: '🔀', blurb: 'Claude Code workflow runs and the ruflo swarm side by side: phases, agents, tokens, and what each is doing', rows: 34 },
  { id: 'federation', key: '5', label: 'Federation', short: 'Fed', icon: '🌐', blurb: 'this node, its peers, keys and channels, placed by how far each is trusted', rows: 26 },
  { id: 'plugins', key: '6', label: 'Plugins', short: 'Plg', icon: '🧩', blurb: 'ruflo plugins: installed, enabled, in the marketplace clone, and loaded as mods', rows: 30 },
  { id: 'learning', key: '7', label: 'Learning', short: 'Lrn', icon: '🧠', blurb: 'router picks and outcomes, and the RETRIEVE → JUDGE → DISTILL → CONSOLIDATE pipeline', rows: 30 },
  { id: 'metaharness', key: '8', label: 'MetaHarness', short: 'MH', icon: '🔬', blurb: 'harness readiness, the flywheel, the audit trend, and a lab that runs every MetaHarness verb', rows: 40 },
  { id: 'memory', key: '9', label: 'Memory', short: 'Mem', icon: '💾', blurb: 'the Memory Lab: browse, search, store and delete entries; AgentDB, embeddings and upkeep, each a button', rows: 60 },
  { id: 'cost', key: 'c', label: 'Cost', short: 'Cst', icon: '💰', blurb: 'set a budget, see spend across Claude Code and Codex, and how to cut it', rows: 40 },
  { id: 'timeline', key: 'g', label: 'Timeline', short: 'Gnt', icon: '🕒', blurb: 'each agent busy or idle over the last minutes, beside Claude Code tool calls', rows: 24 },
  { id: 'approvals', key: 'q', label: 'Approvals', short: 'Apv', icon: '✅', blurb: 'decisions waiting for a person: votes, stealable claims, refused mods, budget', rows: 24 },
  { id: 'events', key: 'e', label: 'Events', short: 'Evt', icon: '📡', blurb: 'every swarm, claim, memory and mod event as it happens (f filters them)', rows: 26 },
  { id: 'room', key: '', label: 'Room', short: 'Room', icon: '💬', blurb: 'what the people and the agents here are saying and doing, live, and the one thing waiting for a yes', rows: 30 },
  { id: 'xruv', key: 'w', label: 'x.ruv.io', short: 'XRV', icon: '🛸', blurb: 'the open agent federation: what it offers, how to join, its channels and who is on', rows: 50 },
  { id: 'terminal', key: 'i', label: 'Terminal', short: 'Trm', icon: '💻', blurb: 'an AI terminal: claude -p, codex or both, each a session that remembers the conversation, streamed live', rows: 120 },
  { id: 'skills', key: 'z', label: 'Skills', short: 'Skl', icon: '🧰', blurb: 'agent skills (npx skills, skills.sh): installed, search, use without installing, preview, add to chosen agents, update, create', rows: 60 },
  { id: 'secure', key: 'u', label: 'Security & Doctor', short: 'Sec', icon: '🔒',blurb: 'security scans, a paste field where AIDefence checks text for injection and PII, policy, sentries that scan on a schedule or on change, and every doctor check', rows: 40 },
  { id: 'perf', key: 'f', label: 'Performance', short: 'Prf', icon: '📈', blurb: 'metrics, profile, benchmarks, bottlenecks and a latency sparkline from each run', rows: 30 },
  { id: 'automate', key: 'a', label: 'Automation', short: 'Aut', icon: '🤖', blurb: 'workflows, the twelve background workers and their daemon, loops, autopilot, sessions, config and a task kanban', rows: 44 },
  { id: 'neural', key: 'l', label: 'Learning Lab', short: 'Lab', icon: '🧪', blurb: 'train neural patterns and watch the loss, ask the router which agent fits a task, and why', rows: 36 },
  { id: 'vector', key: 'v', label: 'Vector Lab', short: 'Vec', icon: '🧲', blurb: 'ruvector: the shared brain, RVF stores, rvlite queries, decompile, workers, edge, hooks intel and your pi identity', rows: 44 },
  { id: 'evolve', key: 't', label: 'Self-Evolution', short: 'Evo', icon: '🧬', blurb: 'the governed loop: flywheel receipts, ledger, lineage, the policy gate, the witness; Autogenous and rGi', rows: 44 },
  { id: 'devtools', key: 'd', label: 'Dev Tools', short: 'Dev', icon: '🔧', blurb: 'the integration surface: GitHub, diff analysis, agenticow, WASM, browser, terminal, providers, maintenance', rows: 40 },
  { id: 'sandbox', key: '', label: 'Sandbox', short: 'Sbx', icon: '🧫', blurb: 'isolated places to try things: tmux sessions, RVF copy-on-write branches, RVM', rows: 40 },
  { id: 'market', key: 'm', label: 'Plugin Catalog', short: 'Cat', icon: '📦', blurb: 'every ruflo plugin, mod and skill: what it ships, install, enable, disable, update, view and use', rows: 50 },
  { id: 'adrs', key: '', label: 'ADRs', short: 'ADR', icon: '📐', blurb: 'your project’s Architecture Decision Records: find, propose, accept and supersede them, attach them to a mission so Claude and the swarm follow what was decided', rows: 44 },
  { id: 'whatsnew', key: '', label: 'What’s new', short: 'New', icon: '🆕', blurb: 'what changed in your ruflo plugins, newest first: from each plugin’s own CHANGELOG, breaking changes pinned until you dismiss them', rows: 40 },
  { id: 'settings', key: 's', label: 'Settings', short: 'Set', icon: '⚙️', blurb: 'simple to advanced settings: plugin options, ruflo config, updates, and the AI terminal’s model and budget, each edited in place', rows: 50 },
]

export const AGENT_VIEW = { id: 'agent' as const, rows: 28 }

export const rowsOf = (view: ViewId): number => (view === 'agent' ? AGENT_VIEW.rows : (VIEWS.find(entry => entry.id === view)?.rows ?? 24))

/** A view by id, digit, label, or a prefix of three letters or more. */
export const viewOf = (word: string): ViewId | null => {
  const lower = word.trim().toLowerCase()

  return VIEWS.find(view => view.id === lower || (view.key !== '' && view.key === lower) || view.label.toLowerCase() === lower || (lower.length >= 3 && view.id.startsWith(lower)))?.id ?? null
}

/**
 * `$.store` is the plugin's, not the folder's: the key carries the working directory, so a view chosen in one project
 * never follows the person into another (the ruflo-swarm leak).
 */
export const storeKeyOf = (cwd: string): string => `ruflo-console/ui:${cwd}`

/** How actions reach the ruflo CLI: each a fixed argv prefix. Only `npx` may download. */
export const CLI_PREFIXES = {
  'npx-offline': ['npx', '--offline', '-y', '@claude-flow/cli@latest'],
  npx: ['npx', '-y', '@claude-flow/cli@latest'],
  ruflo: ['ruflo'],
  'claude-flow': ['claude-flow'],
} as const satisfies Record<string, readonly string[]>

export type CliChoice = keyof typeof CLI_PREFIXES

export type Options = GuardOptions & ConvoOptions & SessionOptions & {
  cli: CliChoice
  /** How often the disk is re-read while the pane or band shows (seconds, 2-60). */
  refreshSeconds: number
  /** The animation's frame cap while the pane is shown and focused (0 turns motion off; at most 12). */
  fps: number
  /** `auto`: the band shows in a ruflo project; `on`: always; `off`: never. */
  bar: 'auto' | 'on' | 'off'
  /** `auto` opens the cockpit at session start where it can dock (never taking the keys); `command` only on /ruflo; `off` never. */
  panel: 'auto' | 'command' | 'off'
  /** Lets the federation view ask the public relay for the roster. Off by default: no network without consent. */
  federationNetwork: boolean
  /** `bbs`: the neon ASCII-art look (default); `plain`: the terminal theme's own colours and plain rules. */
  look: 'bbs' | 'plain'
  /** With the bbs look, a short dial-up boot screen when the cockpit opens. */
  boot: boolean
  /** ADR-474: keep the Events and Timeline history in `.claude-flow/console/` (events.jsonl, lanes.jsonl). On by default; masked text only. */
  eventsPersist: boolean
}

const num = (value: unknown, fallback: number, lo: number, hi: number): number => {
  const n = typeof value === 'number' ? value : Number(value)

  return Number.isFinite(n) ? Math.min(Math.max(Math.round(n), lo), hi) : fallback
}

/** The options as the settings hold them, each one checked: a value the plugin does not know is its default. */
export function optionsOf(raw: PluginOptions | undefined): Options {
  const value = (raw ?? {}) as Record<string, unknown>

  return {
    cli: typeof value.cli === 'string' && Object.hasOwn(CLI_PREFIXES, value.cli) ? (value.cli as CliChoice) : 'npx-offline',
    refreshSeconds: num(value.refreshSeconds, 3, 2, 60),
    fps: num(value.fps, 8, 0, 12),
    bar: value.bar === 'on' || value.bar === 'off' ? value.bar : 'auto',
    panel: value.panel === 'command' || value.panel === 'off' ? value.panel : 'auto',
    federationNetwork: value.federationNetwork === true,
    look: value.look === 'plain' ? 'plain' : 'bbs',
    boot: value.boot !== false,
    eventsPersist: value.eventsPersist !== false && value.eventsPersist !== 'false',
    ...guardOptionsOf(raw),
    ...convoOptionsOf(raw),
    ...sessionOptionsOf(raw),
  }
}

/** A mutating action waiting for the person's second press; `shows` is the command line when it is not a ruflo one. */
export type Pending = { /** Which ask this is (runner.ts hands out ids in order): a Yes names the card it answers, so another card that took its place is never the one run. */ id?: number; label: string; args: readonly string[]; expect: string; askedAtMs: number; shows?: string; note?: string; /** The kind of action, when it may be remembered (see remember.ts). */ rememberKey?: string; /** Where in its view the ask came from. */ scope?: string; /** The page that raised it: the ask shows in full there, and as a pointer on every other page. */ view?: string; /** Who raised it: Claude's tool call or the person's own action (ADR-450 T14). */ source?: 'claude' | 'you'; /** The class the entry declares for itself; the gate takes the stricter of this and the class read from its words. */ declared?: 'write' | 'network' | 'install' | 'spend' | 'delete'; /** Set only on a card Claude raised by its own direct console_run in this session: the one kind of card it may withdraw (runner.ts also matches the id). */ origin?: 'console_run'; /** The class of action, set only on Claude's asks. */ kind?: 'write' | 'network' | 'install' | 'spend' | 'delete'; /** The number of the Claude call that started this ask (ActionSpec.byCall): only that call settles it. */ byCall?: number }

/** The MetaHarness lab's last run: what it was, how it exited, its cost note, and its output as lines to scroll. */
export type LabResult = { id: string; label: string; ok: boolean; exitCode: number | null; note?: string; lines: string[]; atMs: number }

/** The harnesses the terminal view can ask; `swarm` asks codex and claude at once. */
export type HarnessId = 'codex' | 'claude' | 'ruflo' | 'swarm'
/** What actually runs: a swarm is a codex run and a claude run side by side. */
export type AgentId = Exclude<HarnessId, 'swarm'>

/**
 * One line of the terminal's scrollback: what was asked (`in`), an agent starting its answer (`head`), what came back,
 * a tool it used (`tool`), how its turn ended (`end`), or
 * the console's own note (`sys`); `from` names the agent when more than one is talking.
 */
export type TermLine = { kind: 'in' | 'head' | 'out' | 'err' | 'sys' | 'tool' | 'end'; text: string; from?: AgentId }

/** A conversation kept per project: codex's thread id, claude's session id, so a follow-up resumes it. */
export type TermSessions = { codex?: string; claude?: string }

export const termStoreKeyOf = (cwd: string): string => `ruflo-console/term:${cwd}`

/** What an action did: what ran, how it exited, whether the disk shows the change, and anything it printed to show. */
export type Outcome = { label: string; ok: boolean; verified: 'yes' | 'no' | 'n/a'; detail: string; atMs: number; lines?: string[]; /** A confirm card that nobody answered within PENDING_TTL_MS and was cleared unrun (the Room shows it briefly). */ expired?: boolean }

/** One module seen registering since the console loaded, as the engine's scan named it. */
export type ModSeen = { name: string; provenance: string; isLoaded: boolean; reason?: string; atMs: number }

/** A tool call refused by a permission verdict this session, as `tool.check` answered it. */
export type Denied = { tool: string; reason: string; atMs: number }

/** One sample of a measured series, with when it was taken. */
export type Sample = { atMs: number; value: number }

/** One thing Claude did with the console's tools (ADR-444): what, and how it came out. */
export type ControlEntry = { atMs: number; tool: string; summary: string; outcome: 'ok' | 'waiting' | 'denied' | 'error'; detail: string }

export type State = {
  options: Options
  cwd: string
  home: string | null
  /** Session evidence from a confirmed JOIN, kept without background key access. */
  nostrKeyVerifiedAtMs: number | null
  /** Claude Code's config directory: `$CLAUDE_CONFIG_DIR`, else `~/.claude`. Its plugin records are read from here. */
  configDir: string | null
  /** False in a session with no pane to show (claude -p, an SDK host): views are then answered as text. */
  isInteractive: boolean
  /** When this module loaded: "since the console loaded" series and stall times count from here. */
  loadedAtMs: number
  view: ViewId
  /** The view to go back to from the drill-down. */
  back: ViewId
  isHelp: boolean
  /** ruHelp: the question typed, and the guide open (null: the index). */
  help: { query: string; topic: string | null }
  snapshot: Snapshot | null
  cache: ReadCache
  probes: Map<string, ProbeResult>
  ruflo: { snapshot: RufloSnapshot | null; route: RufloRoute | null; error: string | null }
  usage: { costUsd?: number; contextPercent?: number } | null
  /** The custom budget field, kept across redraws. */
  costBudgetDraft: string
  rufloTools: { tools: number; servers: string[] } | null
  mods: ModSeen[]
  denied: Denied[]
  /** Tool calls the console saw, per 5 s bucket, newest last; and per agent (Claude Code's ids) for the timeline. */
  activity: number[]
  toolsByAgent: Map<string, { atMs: number; tool: string }[]>
  /** ruflo state files changed per refresh, newest last. */
  writes: number[]
  /** Measured series since the console loaded: patterns learned, session spend. */
  history: { patterns: Sample[]; spend: Sample[]; outcomes: number }
  events: ConsoleEvent[]
  /** Each ruflo agent's status as the console saw it change, oldest first: the timeline's spans. */
  statusLog: Map<string, { atMs: number; status: string }[]>
  eventFilter: 'all' | ConsoleEvent['kind']
  /** When the newest learning point arrived: the curve draws it in from there. */
  curveGrewAtMs: number
  /** Kinds of action the person said never to ask about again, with a sample label (saved; Settings forgets them). */
  allowed: Map<string, string>
  /** The main nav's style, saved across sessions. */
  nav: NavStyle
  /** Whether to check for a newer published ruflo-console: ask first (the default), update without asking, or never check. Kept in the plugin's store. */
  updates: UpdatesMode
  /** The Toasts setting (ADR-477): which levels draw and which sources are muted. Kept in the plugin's store and mirrored to a file the other plugins read. */
  toastPrefs: ToastPrefs
  /** The console's own toasts, drawn or not, until the Events pass takes them in (bounded). */
  toastLog: Digest[]
  /** What's new (ADR-478): the record of what was looked at, the changelogs read when the page opens. */
  whatsnew: WhatsNewState
  /** What the last update check found, in a line, for Settings; empty until one has run. */
  updateNote: string
  /** A published version the person has not taken ("Not now"), shown on the band as a link to Settings; empty when there is none. */
  updateAvailable: string
  /** The nav group whose pages are showing, picked on this page (it follows the open page again once the page changes). */
  navPick: { group: string; view: ViewId } | null
  /** The nav search words (empty: no search). */
  navQuery: string
  /** The slash command names the session offered when last asked (for the mission skills). */
  commandNames: string[]
  /** True while the primary Claude session is running a turn (the band reports it each draw). */
  turnActive: boolean
  /** Notices the band announced (notices.ts): the newest 30, a running id, and a time before which the notice row stays quiet. */
  notices: Notice[]
  noticeSeq: number
  noticesQuietUntilMs: number
  /** `/ruflo band`: the band's mode for this session over the plugin option (null = the option), and whether it shows one row. */
  bandMode: 'auto' | 'on' | 'off' | null
  bandCompact: boolean
  /** When the person-facing turn began (the band shows how long Claude has been working), null between turns. */
  turnStartedMs: number | null
  /** Collapsible sections the person flipped from their default (`<view>/<id>`): open ones closed, closed ones open. */
  sections: Set<string>
  /** What one-shot entry fields hold while typed (cleared on Enter), by field key. */
  fieldText: Map<string, string>
  /** The dock width asked for (RUFLO_CONSOLE_COLUMNS, 40 to 400); 0 leaves the engine's share. A request: a dragged width wins. */
  dockColumns: number
  pane: { isOpen: boolean; isShown: boolean; isFocused: boolean; columns: number; rows: number; placement: 'dock' | 'inline'; isClosedByPerson: boolean; autoTried: boolean; autoReason: string; /** When the pane last opened: the BBS boot screen plays from here. */ bootAtMs: number; /** When the boot ended: the menu's entry plays from here (0: not yet). */ menuAtMs: number; /** When the page was last switched: its title strikes in from here (0: not since the pane opened). */ viewAtMs: number }
  /** The size of each Raster as last mounted, by key: a blit of any other size is refused, so none is sent. */
  mounted: Map<string, { columns: number; rows: number }>
  select: { claim: number; agent: number; task: number; item: number }
  /** The drill-down's agent and what `agent logs` printed for it. */
  drill: { agentId: string | null; logs: string[] | null; logsAtMs: number }
  palette: { isOpen: boolean; query: string; index: number; context: 'all' | 'selection' }
  pending: Pending | null
  /** The id of the confirm card last put in front of the person (drawn in the shown pane, or named in a typed answer): the one card a bare `/ruflo yes` may answer. */
  shownCard: number | null
  /** The last field Enter that raised a card: which entry and text, and the card's id, so Enter again confirms that card and no other that merely reads the same. */
  askedAgain: { entry: string; text: string; card: number } | null
  /** The key of the element last pressed, and the one the last ask or answer came from: the page draws them right there (views/attention.ts). */
  lastPressed: string | null
  origin: string | null
  outcome: Outcome | null
  isActing: boolean
  /** The MetaHarness lab: its last result, and the run in flight (j/k scroll the result through `select.item`). */
  lab: { result: LabResult | null; running: { id: string; label: string; startedAtMs: number } | null }
  /**
   * The x.ruv.io board: its own result panel (j/k scroll it too), this node's Nostr pubkey once a result named it
   * (the key file is never read), and whether RUFLO_X_ADMIN_TOKEN is set (only that boolean is kept; null: not asked).
   */
  xruv: { result: LabResult | null; running: { id: string; label: string; startedAtMs: number } | null; pubkey: string | null; hasAdminToken: boolean | null }
  isRefreshing: boolean
  /** When the band above the prompt last drew: the disk is re-read on the fast cadence only while it is seen. */
  barDrawnAtMs: number
  /** The terminal view: the harness picked, the field's text, the scrollback, and the runs in flight. */
  terminal: {
    harness: HarnessId
    draft: string
    lines: TermLine[]
    /** One run per agent at most; codex and claude may run at the same time. */
    runs: Map<AgentId, { label: string; startedAtMs: number; stop: () => void }>
    /** The conversations to resume, and which of them the person has said yes to in this Claude Code session. */
    sessions: TermSessions
    isLive: { codex: boolean; claude: boolean }
    /** Turns and spend this session, as the agents reported them. */
    turns: { codex: number; claude: number }
    costUsd: number
    /** How many terminal results actually reported dollars, including measured zero. */
    costReports: number
    /** Screen rows scrolled up from the newest (0 follows the tail), and how many lines arrived while scrolled up. */
    scroll: number
    unseen: number
    /** The text the last Enter asked about: Enter on the same text again confirms it. */
    asked: { key: string; label: string; card: number | null } | null
  }
  /** The skills view: installed skills, the last search, and the change running now. */
  skills: SkillsState
  /** The Memory Lab's fields and picks (its last run is `lab.result`, under a mem- id). */
  memoryLab: MemoryLabState
  /** The Automation and Learning Lab views: the lists a click asked for, and this session's training runs. */
  auto: AutoState
  /** The Vector Lab's fields; its runs land in `lab` under vec- ids. */
  vector: VectorState
  /** The Self-Evolution view: the flywheel files as last read, and what its checks answered. */
  evolve: EvolveState
  /** The Dev Tools view: what is typed in its fields (its runs share the lab result panel, ids dt-*). */
  devtools: { fields: DevFields; /** Whether tmux is on this machine, from a probe when the Sandbox page opens. */ tmux: 'unknown' | 'present' | 'missing' }
  timers: Map<string, Timer>
  stats: { renders: number[]; refreshes: number[]; frames: number[] }
  /** The Workflows page: the last read of Claude Code's run folders, the cursor, the inspector tab (wf-state.ts). */
  wf: WfState
  /** Claude's control of the console (ADR-444): paused by the person, the call counts, and the log the dashboard shows. */
  control: { paused: boolean; calls: number; turnCalls: number; /** Model-driven actions this session, by class (ADR-450 T8 budget). */ used: Record<string, number>; log: ControlEntry[]; /** Until when Claude counts as driving (a tool call extends it): the console does not spend a second Claude turn on guidance meanwhile. */ drivingUntilMs: number; /** Claude's console_run / console_set calls running now: an ask that lands while one runs is settled (gated) by that call; one that lands with none running (console_open and console_state settle nothing) is checked by the runner. */ activeCalls: number; /** True while one of Claude's tool calls is running: a person's "always allow" answer must not let Claude's call skip the level and confirm checks (ADR-444). */ viaModel: boolean; /** The last number handed to a console_run / console_set call, and the number of the call whose synchronous start is running now (null when none is). */ callSeq: number; callTag: number | null }
}

export function newState(raw: PluginOptions | undefined): State {
  return {
    options: optionsOf(raw),
    cwd: '',
    home: null,
    nostrKeyVerifiedAtMs: null,
    configDir: null,
    isInteractive: true,
    loadedAtMs: Date.now(),
    view: 'overview',
    back: 'overview',
    isHelp: false,
    help: { query: '', topic: null },
    snapshot: null,
    cache: new Map(),
    probes: new Map(),
    ruflo: { snapshot: null, route: null, error: null },
    usage: null,
    costBudgetDraft: '',
    rufloTools: null,
    mods: [],
    denied: [],
    activity: [],
    toolsByAgent: new Map(),
    writes: [],
    history: { patterns: [], spend: [], outcomes: 0 },
    events: [],
    statusLog: new Map(),
    eventFilter: 'all',
    curveGrewAtMs: 0,
    dockColumns: 0,
    nav: 'auto',
    updates: 'ask',
    toastPrefs: { mode: 'all', muted: [] },
    toastLog: [],
    whatsnew: newWhatsNew(),
    updateNote: '',
    updateAvailable: '',
    navPick: null,
    navQuery: '',
    turnActive: false,
    notices: [],
    noticeSeq: 0,
    noticesQuietUntilMs: 0,
    bandMode: null,
    bandCompact: false,
    turnStartedMs: null,
    commandNames: [],
    allowed: new Map(),
    sections: new Set(),
    fieldText: new Map(),
    pane: { isOpen: false, isShown: false, isFocused: false, columns: 0, rows: 0, placement: 'inline', isClosedByPerson: false, autoTried: false, autoReason: '', bootAtMs: 0, menuAtMs: 0, viewAtMs: 0 },
    mounted: new Map(),
    select: { claim: 0, agent: 0, task: 0, item: 0 },
    drill: { agentId: null, logs: null, logsAtMs: 0 },
    palette: { isOpen: false, query: '', index: 0, context: 'all' },
    pending: null,
    shownCard: null,
    askedAgain: null,
    lastPressed: null,
    origin: null,
    outcome: null,
    isActing: false,
    lab: { result: null, running: null },
    xruv: { result: null, running: null, pubkey: null, hasAdminToken: null },
    isRefreshing: false,
    barDrawnAtMs: 0,
    terminal: { harness: 'claude', draft: '', lines: [], runs: new Map(), sessions: {}, isLive: { codex: false, claude: false }, turns: { codex: 0, claude: 0 }, costUsd: 0, costReports: 0, scroll: 0, unseen: 0, asked: null },
    skills: emptySkills(),
    memoryLab: emptyMemoryLab(),
    auto: emptyAuto(),
    vector: emptyVector(),
    evolve: emptyEvolve(),
    devtools: { fields: emptyFields(), tmux: 'unknown' },
    timers: new Map(),
    stats: { renders: [], refreshes: [], frames: [] },
    wf: emptyWf(),
    control: { paused: false, calls: 0, turnCalls: 0, used: {}, log: [], drivingUntilMs: 0, activeCalls: 0, viaModel: false, callSeq: 0, callTag: null },
  }
}

/** Keeps the newest `max` samples of a series. */
export function push<T>(series: T[], value: T, max = 120): void {
  series.push(value)

  if (series.length > max) {
    series.splice(0, series.length - max)
  }
}

/** What is written to `$.store`: the person's choices only. */
export type Persisted = { view: ViewId; isClosedByPerson: boolean }

export function restore(state: State, value: unknown): void {
  const held = value !== null && typeof value === 'object' ? (value as Partial<Persisted>) : {}

  if (typeof held.view === 'string' && VIEWS.some(view => view.id === held.view)) {
    state.view = held.view
  }

  state.pane.isClosedByPerson = held.isClosedByPerson === true
}

const SESSION_ID = /^[A-Za-z0-9][A-Za-z0-9-]{7,63}$/

/** The terminal's saved conversations: only id-shaped strings come back, since each one becomes an argv element. */
export function restoreSessions(state: State, value: unknown): void {
  const held = value !== null && typeof value === 'object' ? (value as Record<string, unknown>) : {}

  for (const agent of ['codex', 'claude'] as const) {
    const id = held[agent]

    if (typeof id === 'string' && SESSION_ID.test(id)) state.terminal.sessions[agent] = id
  }
}

export const isSessionId = (id: string): boolean => SESSION_ID.test(id)

/** The BBS boot screen's span: at least BOOT_MIN_MS, longer while the first read is still out, never past BOOT_MAX_MS. */
export const BOOT_MIN_MS = 5_400
export const BOOT_MAX_MS = 8_000

export function isBooting(state: State, nowMs: number): boolean {
  if (state.options.look !== 'bbs' || !state.options.boot || state.pane.bootAtMs === 0) return false

  const age = nowMs - state.pane.bootAtMs

  return age >= 0 && age < BOOT_MAX_MS && (age < BOOT_MIN_MS || state.snapshot === null)
}

/**
 * Compact: an inline pane the layout could not make as tall as the view asks. It drops the banner and moves the
 * controls up so they stay on screen. A docked pane scrolls, so it always gets the full frame, banner and title.
 */
export const isCompactPane = (state: State): boolean => state.pane.placement === 'inline' && state.pane.rows > 0 && state.pane.rows < rowsOf(state.view)
