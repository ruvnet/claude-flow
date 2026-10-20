/**
 * Settings, simple to advanced. Two kinds of setting, both edited in place:
 *  - a plugin's options, driven by the schema `claude plugin configure <plugin> --json` prints (its type, choices, current
 *    value and whether it is set), so the console, ruflo-mods and every other ruflo plugin with options share one editor;
 *    a change is `claude plugin configure <plugin> --values-stdin` with the one key (values are single-line strings);
 *  - ruflo's own config (`ruflo config get|set`), a curated list of keys.
 * Every change is one fixed argv on the confirm row. An option that looks like a secret is never shown or edited here.
 * ▸ ask claude / ▸ ask codex send an explaining prompt about a setting to the AI terminal at once (claude -p in plan mode, codex
 * exec read-only, the saved per-turn budget) and the reply streams in; nothing is changed by it.
 */
import { checkLimit, countOf } from './full-text'
import { adrDirText, patternOf } from './data/adr-write'
import type { ActionSpec } from './actions'
import { budgetAmount } from './cost'
import { plain } from './data/parse'
import { own } from './data/safe'
import { RUFLO_MARKET } from './data/snapshot'
import { DEFAULT_LOOP, LOOP_INTERVALS, type LoopPrefs, WRITER_CAPS } from './goap'
import type { Host } from './host'
import type { Runner } from './runner'
import type { State } from './state'

export type Level = 'simple' | 'advanced'

export type SchemaEntry = { type: string; title: string; description: string; default?: string; options?: string[]; isSecret: boolean }
export type PluginConfig = { pluginId: string; name: string; schema: Record<string, SchemaEntry>; inputs: Record<string, string>; choices: Record<string, string[]>; configured: string[] }

/** Which options a first-time person sees. Anything not listed is advanced; a plugin not listed shows its first four. */
export const SIMPLE: Record<string, readonly string[]> = {
  'ruflo-console': ['look', 'boot', 'panel', 'fps'],
  'ruflo-mods': ['costBudgetUsd', 'costHardStop', 'statusLine', 'toolHints', 'agentTrim', 'agentTrimKeep', 'deliveryScreen'],
}

/**
 * One honest line per ruflo-mods option the plugin's own long description is too wide for. It replaces the description on screen only: the
 * value, its choices and how it is changed all still come from the plugin's schema, and a change is the same confirm-gated
 * `claude plugin configure` as any other option (so it is the same safety class: it waits for the person's Yes, and Claude's console tools
 * cannot change it below their install level).
 */
export const OPTION_NOTES: Record<string, Record<string, string>> = {
  'ruflo-mods': {
    toolHints: 'one short static usage hint on a few ruflo tools, from your CLAUDE.md; default off',
    agentTrim: 'about 4,000 fewer prompt tokens measured; a hidden type the prompt does not name is refused when spawned',
    agentTrimKeep: 'comma-separated agent types agentTrim must never hide',
    deliveryScreen: 'default off; screening tuned on a small test set, real-world rate unknown',
  },
}

/** ruflo's own configuration: key, how it is edited, and who sees it. */
export type CoreKey = { key: string; title: string; level: Level; kind: 'choice' | 'toggle' | 'number' | 'text'; choices?: readonly string[]; min?: number; max?: number; help: string }
export const CORE: readonly CoreKey[] = [
  { key: 'swarm.topology', title: 'Swarm topology', level: 'simple', kind: 'choice', choices: ['hierarchical', 'mesh', 'hierarchical-mesh', 'ring', 'star', 'adaptive'], help: 'how agents are wired: hierarchical keeps a queen in charge, mesh lets peers talk' },
  { key: 'swarm.maxAgents', title: 'Max agents', level: 'simple', kind: 'number', min: 1, max: 50, help: 'the most agents a swarm may hold at once' },
  { key: 'swarm.autoScale', title: 'Auto-scale', level: 'advanced', kind: 'toggle', help: 'let the swarm add and retire agents with load' },
  { key: 'swarm.coordinationStrategy', title: 'Coordination', level: 'advanced', kind: 'text', help: 'how a swarm agrees (consensus by default)' },
  { key: 'memory.backend', title: 'Memory backend', level: 'simple', kind: 'choice', choices: ['hybrid', 'sqlite', 'agentdb', 'memory'], help: 'where memory entries are stored' },
  { key: 'memory.enableHNSW', title: 'HNSW index', level: 'advanced', kind: 'toggle', help: 'approximate nearest-neighbour search for memory' },
  { key: 'memory.cacheSize', title: 'Memory cache', level: 'advanced', kind: 'number', min: 1, max: 100000, help: 'entries kept hot in memory' },
  { key: 'neural.enabled', title: 'Neural learning', level: 'advanced', kind: 'toggle', help: 'SONA/MoE pattern learning' },
  { key: 'hooks.enabled', title: 'Hooks', level: 'advanced', kind: 'toggle', help: 'ruflo hooks that learn from your edits and routes' },
  { key: 'mcp.port', title: 'MCP port', level: 'advanced', kind: 'number', min: 1, max: 65535, help: 'the port ruflo’s MCP server listens on' },
]

export const CLAUDE_MODELS = ['default', 'haiku', 'sonnet', 'opus'] as const
export const AI_BUDGETS = [0.25, 0.5, 1, 2] as const
/** `autoAccept`: claude, codex and swarm turns go straight out with no confirm (they stay read-only, in plan mode, under the budget); ruflo commands still ask. */
export type AiPrefs = { claudeModel: (typeof CLAUDE_MODELS)[number]; budgetUsd: (typeof AI_BUDGETS)[number]; autoAccept: boolean; /** Claude writes guidance after a mission goal is entered. */ guidance: boolean; /** ADR-443: the active mission and task ride in Claude's prompt (changes only when the task changes). */ missionContext: boolean; /** ADR-443: the person's own gate commands, one per line or `\n`-separated (parseGates validates). */ loopGates: string; /** ADR-443: a USD cap for one mission's spend ('' none). */ missionCapUsd: string; /** ADR-444: how far Claude may drive the console with its console_* tools (they exist only when not off). */ modelControl: 'off' | 'read' | 'write' | 'manage' | 'full'; /** ADR-444: a non-read action waits for the person's Yes (ask) or confirms itself (auto). */ modelConfirm: 'ask' | 'auto'; /** ADR-480: the folder of this project's ADRs, relative to the project ('' finds it). */ adrDir: string; /** ADR-480: the style new ADRs are written in ('auto' follows the project's own). */ adrStyle: 'auto' | 'madr' | 'nygard' | 'ruflo'; /** ADR-480: the file name pattern for new ADRs, with {n} and {slug} ('' follows the project's own). */ adrPattern: string; /** ADR-483: advisor checkpoints in mission loops (plan, repeated failure, before done); each consult asks first. */ advisor: boolean; /** ADR-483: the model passed to `claude -p --model` for a consult. */ advisorModel: (typeof CLAUDE_MODELS)[number]; /** ADR-483: a line in the loop prompt asking subagents to return structured summaries only. */ subagentSummaries: boolean; /** ADR-487: show the one-time hint about the optional ruvnet-brain plugin when it is not installed (default off). */ groundingHint: boolean; /** ADR-487: the person dismissed that hint for good. */ groundingDismissed: boolean; /** ADR-487: with the brain on and a mission naming the ruvnet stack, one line in Claude's mission context points at search_ruvnet (default on). */ groundingNudge: boolean } & LoopPrefs
export const DEFAULT_AI: AiPrefs = { claudeModel: 'default', budgetUsd: 1, autoAccept: false, guidance: true, missionContext: true, loopGates: '', missionCapUsd: '', modelControl: 'read', modelConfirm: 'ask', adrDir: '', adrStyle: 'auto', adrPattern: '', advisor: false, advisorModel: 'default', subagentSummaries: false, groundingHint: false, groundingDismissed: false, groundingNudge: true, ...DEFAULT_LOOP }

const ON_OFF = ['on', 'off'] as const
const onOff = (value: boolean) => (value ? 'on' : 'off')

/**
 * The loop-centric mission rows (ADR-441), stored with the AI preferences: the Settings page maps over this list and calls
 * `ctx.act.settings.ai(row.patch(value))`, so a row is one entry here, not new storage.
 */
export const LOOP_ROWS: readonly { id: string; title: string; description: string; extra: string; options: readonly string[]; current: (p: LoopPrefs) => string; isChanged: (p: LoopPrefs) => boolean; patch: (value: string) => Partial<LoopPrefs> }[] = [
  { id: 'loop-interval', title: 'Mission loop interval', description: 'how often a mission’s /loop ticks: each tick checks progress, fixes failures and runs the gates (default 5m)', extra: 'loop tick cadence minutes', options: LOOP_INTERVALS, current: p => p.loopInterval, isChanged: p => p.loopInterval !== DEFAULT_LOOP.loopInterval, patch: value => ({ loopInterval: LOOP_INTERVALS.find(item => item === value) ?? DEFAULT_LOOP.loopInterval }) },
  { id: 'loop-worktrees', title: 'Worktree per writer', description: 'each writing agent works in its own git worktree, on disjoint files, so concurrent writers never collide (default on)', extra: 'loop git worktree isolation writers', options: ON_OFF, current: p => onOff(p.loopWorktrees), isChanged: p => !p.loopWorktrees, patch: value => ({ loopWorktrees: value === 'on' }) },
  { id: 'loop-commit', title: 'Loop may commit', description: 'the loop may commit to the mission branch, and nowhere else (default on)', extra: 'loop commit branch', options: ON_OFF, current: p => onOff(p.loopCommit), isChanged: p => !p.loopCommit, patch: value => ({ loopCommit: value === 'on' }) },
  { id: 'loop-push', title: 'Loop may push', description: 'the loop may push the mission branch to its remote (default off: it stops at the branch and says so)', extra: 'loop push remote github', options: ON_OFF, current: p => onOff(p.loopPush), isChanged: p => p.loopPush, patch: value => ({ loopPush: value === 'on' }) },
  { id: 'loop-publish', title: 'Loop may publish', description: 'the loop may publish releases or packages the mission names (default off: nothing is published without your word)', extra: 'loop publish release npm deploy', options: ON_OFF, current: p => onOff(p.loopPublish), isChanged: p => p.loopPublish, patch: value => ({ loopPublish: value === 'on' }) },
  { id: 'loop-writers', title: 'Max concurrent writers', description: 'the most writing agents a mission loop runs at once (default 6)', extra: 'loop concurrent parallel agents', options: WRITER_CAPS.map(String), current: p => String(p.loopWriters), isChanged: p => p.loopWriters !== DEFAULT_LOOP.loopWriters, patch: value => ({ loopWriters: WRITER_CAPS.find(item => String(item) === value) ?? DEFAULT_LOOP.loopWriters }) },
]
export const AI_KEY = 'ai-prefs'

/** A mission spend cap as stored: '' for none, else decimal dollars from 0.01 to 10000 with at most two places; null for anything else (a `0` is not "no cap" and is refused). */
export const capText = (value: string): string | null => {
  const text = value.trim()

  return text === '' ? '' : /^\d{1,5}(\.\d{1,2})?$/.test(text) && budgetAmount(text) !== null ? text : null
}

export type SettingsState = {
  level: Level
  /** The plugin whose options are shown (bare name). */
  plugin: string
  configs: Map<string, PluginConfig | 'error'>
  loading: Set<string>
  /** ruflo config values as `ruflo config get` last answered, by key. */
  core: Map<string, string>
  coreLoading: boolean
  ai: AiPrefs
  /** What the person saved for Claude's control; `ai.modelControl/modelConfirm` is this lowered by `cap`, and only this is ever stored (#3814). */
  savedControl: Pick<AiPrefs, 'modelControl' | 'modelConfirm'>
  /** This session's RUFLO_CONSOLE_CONTROL, which can only lower the saved level (ADR-450 T12); null when unset. */
  cap: { level: AiPrefs['modelControl']; confirm: AiPrefs['modelConfirm'] } | null
  /** The active search (applied with Enter, shown as a chip, cleared with ✕). */
  query: string
  /** Only settings that differ from their default. */
  onlyChanged: boolean
  /** The last change or failure, with the lines to show. */
  last: { label: string; ok: boolean; detail: string } | null
}

const states = new WeakMap<State, SettingsState>()

export function settingsOf(state: State): SettingsState {
  let found = states.get(state)

  if (found === undefined) {
    found = { level: 'simple', plugin: 'ruflo-console', configs: new Map(), loading: new Set(), core: new Map(), coreLoading: false, ai: { ...DEFAULT_AI }, savedControl: { modelControl: DEFAULT_AI.modelControl, modelConfirm: DEFAULT_AI.modelConfirm }, cap: null, query: '', onlyChanged: false, last: null }
    states.set(state, found)
  }

  return found
}

const NAME = /^[A-Za-z0-9._-]{1,80}$/
const SECRET = /token|secret|password|passwd|credential|api[-_]?key|private/i

const recordOf = (value: unknown): Record<string, unknown> | null => (typeof value === 'object' && value !== null && !Array.isArray(value) ? (value as Record<string, unknown>) : null)
const flat = (value: unknown, max: number): string => (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean' ? plain(String(value), max) : '')

/** `claude plugin configure <plugin> --json`, parsed: unknown shapes are dropped, never trusted. */
export function parseConfig(name: string, text: string): PluginConfig | null {
  let root: Record<string, unknown> | null = null

  try {
    root = recordOf(JSON.parse(text))
  } catch {
    return null
  }

  const schemaIn = recordOf(root?.schema)

  if (root === null || schemaIn === null) return null

  const schema: Record<string, SchemaEntry> = {}

  for (const [key, raw] of Object.entries(schemaIn).slice(0, 60)) {
    const entry = recordOf(raw)

    if (entry === null || !NAME.test(key)) continue

    const options = Array.isArray(entry.options) ? entry.options.map(option => flat(option, 60)).filter(Boolean) : undefined

    schema[key] = { type: flat(entry.type, 12) || 'string', title: flat(entry.title, 80) || key, description: flat(entry.description, 400), ...(entry.default !== undefined && { default: flat(entry.default, 80) }), ...(options !== undefined && options.length > 0 && { options }), isSecret: entry.sensitive === true || SECRET.test(key) }
  }

  const strings = (value: unknown): Record<string, string> =>
    Object.fromEntries(Object.entries(recordOf(value) ?? {}).filter(([key]) => NAME.test(key)).map(([key, v]) => [key, flat(v, 200)]))
  const choicesIn = recordOf(root.choices) ?? {}

  return {
    pluginId: flat(root.pluginId, 100) || `${name}@${RUFLO_MARKET}`,
    name,
    schema,
    inputs: strings(root.inputs),
    choices: Object.fromEntries(Object.entries(choicesIn).filter(([key]) => NAME.test(key)).map(([key, v]) => [key, Array.isArray(v) ? v.map(item => flat(item, 60)).filter(Boolean) : []])),
    configured: Array.isArray(root.configured) ? root.configured.map(item => flat(item, 60)).filter(Boolean) : [],
  }
}

/** The options this level shows for a plugin, in schema order. */
export function shownKeys(config: PluginConfig, level: Level): string[] {
  const keys = Object.keys(config.schema)

  if (level === 'advanced') return keys

  const simple = own(SIMPLE, config.name)

  return simple === undefined ? keys.slice(0, 4) : keys.filter(key => simple.includes(key))
}

const configureArgv = (name: string): readonly string[] => ['claude', 'plugin', 'configure', `${name}@${RUFLO_MARKET}`, '--json']

/** Reads one plugin's options (local, read-only, nothing is written). */
export async function loadPlugin(state: State, host: Host, name: string): Promise<void> {
  const settings = settingsOf(state)

  if (!NAME.test(name) || settings.loading.has(name)) return

  settings.loading.add(name)
  host.invalidate()

  try {
    const result = await host.run(configureArgv(name), 30_000)
    const parsed = result.exitCode === 0 ? parseConfig(name, result.stdout) : null

    settings.configs.set(name, parsed ?? 'error')
  } catch {
    settings.configs.set(name, 'error')
  } finally {
    settings.loading.delete(name)
    host.invalidate()
  }
}

const coreArgv = (key: string): readonly string[] => ['npx', '--offline', '-y', '@claude-flow/cli@latest', 'config', 'get', '-k', key]

/** ruflo config values, a few CLI reads at a time (each is a small local command). */
export async function loadCore(state: State, host: Host, argvPrefix: readonly string[]): Promise<void> {
  const settings = settingsOf(state)

  if (settings.coreLoading) return

  settings.coreLoading = true
  host.invalidate()

  try {
    for (let at = 0; at < CORE.length; at += 4) {
      await Promise.all(
        CORE.slice(at, at + 4).map(async entry => {
          const result = await host.run([...argvPrefix, 'config', 'get', '-k', entry.key], 30_000).catch(() => null)
          const value = result === null || result.exitCode !== 0 ? '' : (result.stdout.split('\n').map(line => line.replace(/\x1b\[[0-9;]*m/g, '').trim()).find(line => line.startsWith(`${entry.key} =`))?.slice(entry.key.length + 3) ?? '')

          settings.core.set(entry.key, plain(value, 80))
        }),
      )
    }
  } finally {
    settings.coreLoading = false
    host.invalidate()
  }
}

/** A value fit for a plugin option: single-line, bounded, and for a choice one of the choices. */
export function valueOf(config: PluginConfig, key: string, raw: string): string | null {
  const entry = config.schema[key]
  const value = raw.trim()

  if (entry === undefined || entry.isSecret || value.includes('\n') || countOf(value) > OPTION_MAX) return null
  if (entry.type === 'number') return /^-?\d+(\.\d+)?$/.test(value) ? value : null

  const choices = config.choices[key]

  return choices !== undefined && choices.length > 0 ? (choices.includes(value) ? value : null) : value
}

/** One plugin option change: `claude plugin configure <plugin>@ruflo --values-stdin` with only that key. */
export function setOption(state: State, name: string, key: string, raw: string, reload: () => void): ActionSpec | null {
  const config = settingsOf(state).configs.get(name)

  if (config === undefined || config === 'error') return null

  const value = valueOf(config, key, raw)

  if (value === null) return null

  const argv = ['claude', 'plugin', 'configure', `${name}@${RUFLO_MARKET}`, '--values-stdin'] as const
  const stdin = JSON.stringify({ [key]: value })

  return {
    label: `set ${name} ${key} to ${value}`,
    args: [],
    argv,
    stdin,
    shows: `${argv.join(' ')} · stdin ${stdin}`,
    expect: `${name} ${key} = ${value}`,
    note: 'Changes this plugin’s user option only (options left out keep their values); reload plugins (/reload-plugins) or restart for it to apply.',
    onOutput: reload,
  }
}

/** The longest plugin option value the console writes (it travels as JSON on stdin; a real option is a path, a name or a short list). Over it: refused with the count. */
export const OPTION_MAX = 4_000

const CORE_VALUE = /^[A-Za-z0-9._:/-]{1,60}$/

/** One ruflo config change: `ruflo config set -k <key> -v <value>`, for a key in the curated list only. */
export function setCore(state: State, key: string, raw: string, reload: () => void): ActionSpec | null {
  const entry = CORE.find(candidate => candidate.key === key)
  const value = raw.trim()

  if (entry === undefined || !CORE_VALUE.test(value)) return null
  if (entry.kind === 'toggle' && value !== 'true' && value !== 'false') return null
  if (entry.kind === 'choice' && !entry.choices?.includes(value)) return null
  if (entry.kind === 'number' && !(/^\d+$/.test(value) && Number(value) >= (entry.min ?? 0) && Number(value) <= (entry.max ?? Number.MAX_SAFE_INTEGER))) return null

  return {
    label: `set ruflo config ${key} to ${value}`,
    args: ['config', 'set', '-k', key, '-v', value],
    expect: `${key} = ${value}`,
    note: 'Writes ruflo’s configuration for this project; a running daemon or swarm may need a restart to pick it up.',
    onOutput: reload,
  }
}

/** The AI prompt about one setting, for the terminal draft: what it is, what it is now, and what to weigh. */
export function askPrompt(title: string, description: string, current: string, where: string): string {
  return `Explain the ruflo setting "${title}" (${where}): ${description} It is currently ${current === '' ? 'unset' : `"${current}"`}. What does each choice change, and what would you recommend for a developer working in this repository? Do not change anything.`
}

const CONTROL_ORDER: readonly AiPrefs['modelControl'][] = ['off', 'read', 'write', 'manage', 'full']

/** The in-force control: what the person saved, lowered by the session cap (the lower level; ask if either asks). A saved "off" stays off. */
function applyControl(settings: SettingsState): void {
  const { savedControl, cap } = settings
  const lower = cap !== null && CONTROL_ORDER.indexOf(cap.level) < CONTROL_ORDER.indexOf(savedControl.modelControl)

  settings.ai.modelControl = lower && cap !== null ? cap.level : savedControl.modelControl
  settings.ai.modelConfirm = cap?.confirm === 'ask' || savedControl.modelConfirm === 'ask' ? 'ask' : 'auto'
}

/** Sets this session's cap (null clears it) and applies it now; every later load and save applies it again, so nothing lifts it (#3814). */
export function setControlCap(state: State, cap: SettingsState['cap']): void {
  const settings = settingsOf(state)

  settings.cap = cap
  applyControl(settings)
}

/** Persists and loads the AI terminal's preferences (claude model, per-turn budget); a bad stored value is the default. */
export async function loadAiPrefs(state: State, host: Host): Promise<void> {
  const stored = recordOf(await host.storeGet(AI_KEY).catch(() => undefined))
  const model = CLAUDE_MODELS.find(candidate => candidate === stored?.claudeModel)
  const budget = AI_BUDGETS.find(candidate => candidate === stored?.budgetUsd)

  const flag = (key: keyof LoopPrefs, fallback: boolean) => (typeof stored?.[key] === 'boolean' ? (stored[key] as boolean) : fallback)

  const settings = settingsOf(state)

  settings.ai = {
    claudeModel: model ?? DEFAULT_AI.claudeModel,
    budgetUsd: budget ?? DEFAULT_AI.budgetUsd,
    autoAccept: stored?.autoAccept === true,
    guidance: stored?.guidance !== false,
    // Default `read` (Claude may look, never act), and an explicit saved "off" stays off. A missing confirm mode is `ask`: only a saved "auto" is auto.
    modelControl: stored?.modelControl === 'off' ? 'off' : ((['read', 'write', 'manage', 'full'] as const).find(item => item === stored?.modelControl) ?? DEFAULT_AI.modelControl),
    modelConfirm: stored?.modelConfirm === 'auto' ? 'auto' : 'ask',
    missionContext: stored?.missionContext !== false,
    loopGates: typeof stored?.loopGates === 'string' ? stored.loopGates : '',
    missionCapUsd: typeof stored?.missionCapUsd === 'string' ? (capText(stored.missionCapUsd) ?? '') : '',
    adrDir: typeof stored?.adrDir === 'string' ? (adrDirText(stored.adrDir) ?? '') : '',
    adrStyle: (['madr', 'nygard', 'ruflo'] as const).find(item => item === stored?.adrStyle) ?? 'auto',
    adrPattern: typeof stored?.adrPattern === 'string' ? (patternOf(stored.adrPattern) ?? '') : '',
    advisor: stored?.advisor === true,
    advisorModel: CLAUDE_MODELS.find(candidate => candidate === stored?.advisorModel) ?? DEFAULT_AI.advisorModel,
    subagentSummaries: stored?.subagentSummaries === true,
    groundingHint: stored?.groundingHint === true,
    groundingDismissed: stored?.groundingDismissed === true,
    groundingNudge: stored?.groundingNudge !== false,
    loopInterval: LOOP_INTERVALS.find(item => item === stored?.loopInterval) ?? DEFAULT_LOOP.loopInterval,
    loopWorktrees: flag('loopWorktrees', DEFAULT_LOOP.loopWorktrees),
    loopCommit: flag('loopCommit', DEFAULT_LOOP.loopCommit),
    // Leaving the branch is opt-in: only an explicit stored true turns these on.
    loopPush: stored?.loopPush === true,
    loopPublish: stored?.loopPublish === true,
    loopWriters: WRITER_CAPS.find(item => item === stored?.loopWriters) ?? DEFAULT_LOOP.loopWriters,
  }
  settings.savedControl = { modelControl: settings.ai.modelControl, modelConfirm: settings.ai.modelConfirm }
  applyControl(settings)
}

export function saveAiPrefs(state: State, host: Host, patch: Partial<AiPrefs>): void {
  const settings = settingsOf(state)

  // A cap outside 0.01 to 10000 is refused (the old one stays) and says so, rather than turning into "no cap" (#3818).
  if (patch.missionCapUsd !== undefined) {
    const cap = capText(patch.missionCapUsd)

    if (cap === null) {
      state.outcome = { label: 'set mission spend cap', ok: false, verified: 'n/a', detail: 'a cap is 0.01 to 10000 dollars (digits and at most two decimals); leave it empty for no cap. The old value is kept.', atMs: Date.now() }
      patch = { ...patch }
      delete patch.missionCapUsd
    } else patch = { ...patch, missionCapUsd: cap }
  }

  // ADR-480: a folder or a pattern that is not safe is refused (the old one stays) and says so.
  for (const [key, ok] of [['adrDir', patch.adrDir === undefined || patch.adrDir === '' || adrDirText(patch.adrDir) !== null], ['adrPattern', patch.adrPattern === undefined || patch.adrPattern === '' || patternOf(patch.adrPattern) !== null]] as const) {
    if (!ok) {
      state.outcome = { label: key === 'adrDir' ? 'set the ADR folder' : 'set the ADR file name pattern', ok: false, verified: 'n/a', detail: key === 'adrDir' ? 'the ADR folder is a path inside this project: letters, digits, dots, dashes, underscores and slashes, no .. and no leading slash. The old value is kept.' : 'a file name pattern holds {n} and {slug}, ends in .md and uses letters, digits, dots, dashes and underscores. The old value is kept.', atMs: Date.now() }
      patch = { ...patch }
      delete patch[key]
    }
  }
  if (patch.adrDir !== undefined) patch = { ...patch, adrDir: adrDirText(patch.adrDir) ?? '' }

  // The person's own pick of the control level is the saved one; the session cap only shapes what is in force (#3814).
  settings.savedControl = { modelControl: patch.modelControl ?? settings.savedControl.modelControl, modelConfirm: patch.modelConfirm ?? settings.savedControl.modelConfirm }
  settings.ai = { ...settings.ai, ...patch }
  applyControl(settings)
  void host.storeSet(AI_KEY, { ...settings.ai, ...settings.savedControl }).catch(() => undefined)
  host.invalidate()
}

/** The ruflo plugins whose options Settings can edit: the console and ruflo-mods always, others as the catalog names them and they are installed. */
export function pluginNames(state: State, catalogNames: readonly string[]): string[] {
  const installed = new Set((state.snapshot?.plugins.installed ?? []).filter(plugin => plugin.marketplace === RUFLO_MARKET).map(plugin => plugin.name))

  return [...new Set(['ruflo-console', 'ruflo-mods', ...catalogNames.filter(name => installed.has(name))])]
}

/** Reads every named plugin's options (a few at a time), so a search can look through all of them. */
export async function loadAll(state: State, host: Host, names: readonly string[]): Promise<void> {
  const settings = settingsOf(state)
  const todo = names.filter(name => !settings.configs.has(name) && !settings.loading.has(name))

  for (let at = 0; at < todo.length; at += 4) await Promise.all(todo.slice(at, at + 4).map(name => loadPlugin(state, host, name)))
}

export type SettingsActions = {
  /** Applies a search across every plugin's options, ruflo config and the AI terminal's preferences; '' clears it. */
  search: (query: string) => void
  /** Show only settings that differ from their default. */
  changedOnly: (on: boolean) => void
  level: (level: Level) => void
  plugin: (name: string) => void
  reload: () => void
  /** Set a plugin option (a choice press, a toggle or Enter in its field): asks first. */
  option: (name: string, key: string, value: string) => void
  core: (key: string, value: string) => void
  ai: (patch: Partial<AiPrefs>) => void
  /** The confirm row's "always accept": saves the preference and runs the ask that is pending. */
  alwaysAccept: (seen?: number) => void
  /** Sends an explaining prompt to the AI terminal (claude or codex) now: the reply streams in, no second click. */
  ask: (agent: 'claude' | 'codex', title: string, description: string, current: string, where: string) => void
}

export function settingsActions(state: State, host: Host, runner: Runner, load: (agent: 'claude' | 'codex', text: string) => void, corePrefix: () => readonly string[], names: () => readonly string[]): SettingsActions {
  const settings = settingsOf(state)
  const reloadPlugin = () => void loadPlugin(state, host, settings.plugin)
  const reloadCore = () => void loadCore(state, host, corePrefix())

  return {
    search: query => {
      settings.query = plain(query, Number.MAX_SAFE_INTEGER).trim()
      host.invalidate()
      if (settings.query !== '') void loadAll(state, host, names())
    },
    changedOnly: on => {
      settings.onlyChanged = on
      host.invalidate()
    },
    level: level => {
      settings.level = level
      host.invalidate()
    },
    plugin: name => {
      settings.plugin = name
      if (!settings.configs.has(name)) void loadPlugin(state, host, name)
      host.invalidate()
    },
    reload: () => {
      settings.configs.clear()
      reloadPlugin()
      reloadCore()
    },
    option: (name, key, value) => runner.ask(setOption(state, name, key, value, reloadPlugin), checkLimit(value.trim(), OPTION_MAX, `the ${key} value`).ok ? `“${plain(value, 40)}” is not a value ${key} accepts` : (checkLimit(value.trim(), OPTION_MAX, `the ${key} value`) as { message: string }).message),
    core: (key, value) => runner.ask(setCore(state, key, value, reloadCore), `“${plain(value, 40)}” is not a value ${key} accepts`),
    ai: patch => saveAiPrefs(state, host, patch),
    alwaysAccept: seen => {
      // On a card that was replaced it changes nothing: no preference saved, the draft kept, and the Yes runs nothing.
      if (seen !== undefined && state.pending?.id !== seen) {
        void runner.confirm(seen)

        return
      }

      saveAiPrefs(state, host, { autoAccept: true })
      state.terminal.asked = null
      state.terminal.draft = ''
      void runner.confirm(seen)
    },
    ask: (agent, title, description, current, where) => load(agent, askPrompt(title, description, current, where)),
  }
}
