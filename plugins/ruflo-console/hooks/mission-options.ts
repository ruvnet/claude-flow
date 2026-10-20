/**
 * Mission options beyond the ruflo-goals skills: (1) an AIDefence screen on what the person types into a mission (the goal and
 * the guide text): `aidefence_is_safe` and `aidefence_has_pii` through `ruflo mcp exec`, local and $0 (it may install the
 * detector once); an unsafe goal blocks guidance and creation, PII blocks guidance (it would go to a model), an unavailable
 * detector warns and does not block. (2) A capability catalog: every other ruflo plugin the session offers (ruOS, AIDefence,
 * SPARC, swarm, ADR, security audit, ...) as slash commands run on the goal in the main Claude UI, with the ones that matter
 * for a mission described. Text is data: nothing from a plugin is interpreted.
 */
import { plain } from './data/parse'
import { ARGV_TEXT_MAX, chunksOf, LONG_TEXT_MAX } from './full-text'
import type { Host } from './host'
import { CLI_PREFIXES, type State } from './state'
import { GOALS_PLUGIN } from './mission-skills'
import { jsonAfter } from './data/cli'
import { mcpReader } from './secure'

export type Screen = { status: 'safe' | 'unsafe' | 'pii' | 'unavailable'; detail: string }
export type Capability = { slash: string; plugin: string; title: string; about: string }
export type CapabilityGroup = { plugin: string; label: string; items: Capability[] }

/** What to say about the plugins a mission cares about; others are listed by their own command names. */
const PLUGINS: Record<string, { label: string; about: string }> = {
  'ruflo-aidefence': { label: 'AIDefence', about: 'screen prompts, text and code for injection and PII' },
  'ruflo-ruos': { label: 'ruOS', about: 'run agents on your own ruOS cloud desktops' },
  'ruflo-sparc': { label: 'SPARC', about: 'the five-phase method with quality gates' },
  'ruflo-swarm': { label: 'Swarm', about: 'agents in parallel with a coordinator' },
  'ruflo-adr': { label: 'ADRs', about: 'record the decisions of a mission' },
  'ruflo-security-audit': { label: 'Security audit', about: 'find and fix vulnerabilities' },
  'ruflo-testgen': { label: 'Test generation', about: 'tests first, London School' },
  'ruflo-intelligence': { label: 'Intelligence', about: 'learn from the outcome (RETRIEVE, JUDGE, DISTILL, CONSOLIDATE)' },
  'ruflo-rag-memory': { label: 'Memory', about: 'prior art from hybrid and graph search' },
}
const ORDER = Object.keys(PLUGINS)

/** What a plugin is for, as a short note beside its name. */
export const PLUGIN_NOTES: Record<string, string> = Object.fromEntries(Object.entries(PLUGINS).map(([plugin, entry]) => [plugin, entry.about]))

const title = (slash: string): string => {
  const name = slash.slice(slash.indexOf(':') + 1)

  return name.replace(/[-_]/g, ' ').replace(/^./, letter => letter.toUpperCase())
}

/** The ruflo plugins the session offers (their slash commands), minus ruflo-goals (it has its own section), mission-relevant ones first. */
export function capabilitiesOf(state: State): CapabilityGroup[] {
  const groups = new Map<string, Capability[]>()

  for (const slash of new Set(state.commandNames)) {
    const at = slash.indexOf(':')

    if (at < 0 || !/^ruflo[a-z0-9-]*:[A-Za-z0-9._-]+$/.test(slash)) continue

    const plugin = slash.slice(0, at)

    if (plugin === GOALS_PLUGIN) continue
    ;(groups.get(plugin) ?? groups.set(plugin, []).get(plugin))?.push({ slash, plugin, title: title(slash), about: PLUGINS[plugin]?.about ?? '' })
  }

  return [...groups.entries()]
    .map(([plugin, items]) => ({ plugin, label: PLUGINS[plugin]?.label ?? (plugin.replace(/^ruflo-?/, '') || plugin), items: items.sort((a, b) => a.slash.localeCompare(b.slash)) }))
    .sort((a, b) => (ORDER.indexOf(a.plugin) < 0 ? 99 : ORDER.indexOf(a.plugin)) - (ORDER.indexOf(b.plugin) < 0 ? 99 : ORDER.indexOf(b.plugin)) || a.plugin.localeCompare(b.plugin))
}

export const isCapability = (state: State, slash: string): boolean => capabilitiesOf(state).some(group => group.items.some(item => item.slash === slash))

const argv = (state: State, tool: string, input: string): string[] => [...CLI_PREFIXES[state.options.cli], 'mcp', 'exec', '-t', tool, '-p', JSON.stringify({ input })]

/** One detector call, read as the Security view reads it: the verdict is the first line. */
async function verdict(state: State, host: Host, tool: string, text: string): Promise<string | null> {
  try {
    const out = await host.run(argv(state, tool, text), 60_000)
    const lines = mcpReader(tool)(out.stdout, out.stderr, state)
    const head = lines[0] ?? ''

    return /^(UNSAFE|PII FOUND|SAFE)/.test(head) ? head : null
  } catch {
    return null
  }
}

/** `aidefence_has_pii` answers `{hasPII}` (or piiFound / piiDetected): read as PII FOUND or SAFE, whatever else it says. */
async function piiVerdict(state: State, host: Host, text: string): Promise<string | null> {
  try {
    const out = await host.run(argv(state, 'aidefence_has_pii', text), 60_000)
    const result = jsonAfter(out.stdout)
    const record = typeof result === 'object' && result !== null && !Array.isArray(result) ? (result as Record<string, unknown>) : null
    const content = Array.isArray(record?.content) ? (record.content[0] as { text?: unknown } | undefined) : undefined
    const inner = typeof content?.text === 'string' ? jsonAfter(content.text) : record
    const row = typeof inner === 'object' && inner !== null && !Array.isArray(inner) ? (inner as Record<string, unknown>) : null
    const found = row?.hasPII ?? row?.piiFound ?? row?.piiDetected

    return typeof found === 'boolean' ? (found ? 'PII FOUND' : 'SAFE') : null
  } catch {
    return null
  }
}

/**
 * Screens text the person typed for a mission with AIDefence. Empty text is safe. A tool that answers nothing readable is
 * `unavailable` (the screen warns; it never blocks on a missing detector), and the text is never shown in the result.
 */
export async function screenText(state: State, host: Host, raw: string): Promise<Screen> {
  // All of the text is screened (ADR-481): a long text goes through in overlapping pieces that each fit one argv element, never only its head.
  const text = plain(raw, LONG_TEXT_MAX).trim()

  if (text === '') return { status: 'safe', detail: 'nothing to screen' }

  const answers = await Promise.all(chunksOf(text, ARGV_TEXT_MAX, 200).map(async piece => ({ safe: await verdict(state, host, 'aidefence_is_safe', piece), pii: await piiVerdict(state, host, piece) })))

  const unsafe = answers.find(answer => answer.safe?.startsWith('UNSAFE') === true)

  if (unsafe?.safe != null) return { status: 'unsafe', detail: plain(unsafe.safe, 160) }
  if (answers.some(answer => answer.pii?.startsWith('PII FOUND') === true || answer.safe?.startsWith('PII FOUND') === true)) return { status: 'pii', detail: 'personal or secret data detected' }
  // Both detectors must answer for every piece: half an answer is not a screen.
  if (answers.some(answer => answer.safe === null || answer.pii === null)) return { status: 'unavailable', detail: 'AIDefence did not fully answer (is @claude-flow/aidefence installed?): the text was not fully screened' }

  return { status: 'safe', detail: 'no threats or PII found' }
}

export const blocksGuidance = (screen: Screen | null): boolean => screen !== null && (screen.status === 'unsafe' || screen.status === 'pii')
export const blocksCreate = (screen: Screen | null): boolean => screen?.status === 'unsafe'

/** Deep research (ADR-439): what the person chooses, and the one command the console prepares from it. The console never fetches. */
export const RESEARCH_DEPTHS = ['quick', 'standard', 'deep'] as const
export type ResearchDepth = (typeof RESEARCH_DEPTHS)[number]
export const RESEARCH_DEFAULT_CAP = '2'

/** The spend cap, decimal dollars only like the budget (no flags, exponents or currency marks), from 0.10 to 50. */
export function capUsd(text: string): number | null {
  const value = text.trim()
  const amount = Number(value)

  return /^(?:\d+(?:\.\d+)?|\.\d+)$/.test(value) && Number.isFinite(amount) && amount >= 0.1 && amount <= 50 ? amount : null
}

/** Why a research start is refused before anything is screened or asked; null when the input is usable. */
export function researchWhy(question: string, cap: number | null): string | null {
  if (question === '') return 'type the research question first'
  if (question.startsWith('-')) return 'the question may not start with -'

  return cap === null ? 'the cap must be a number of dollars from 0.10 to 50' : null
}

/** The slash-command arguments, the contract with the ruflo-goals skill: `--depth <d> --cap-usd <usd> <question>`. */
export const researchArgs = (question: string, depth: ResearchDepth, cap: number): string => `--depth ${depth} --cap-usd ${cap} ${question}`

/** The confirm text, in words: what pressing yes starts, what it allows, what is untrusted, and when anything is stored. */
export const researchConfirm = (depth: ResearchDepth, cap: number, screen: Screen): string =>
  `Starts a billed Claude Code turn. Allows web search and fetch up to $${cap} (${depth} depth). Web content is untrusted. Nothing is stored until you accept the report.${screen.status === 'unavailable' ? ' AIDefence could not screen the question.' : ''}`
