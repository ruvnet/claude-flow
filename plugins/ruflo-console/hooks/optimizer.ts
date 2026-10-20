/**
 * The ruflo Optimizer: what is wrong or thin in this project (from what the console already measured, never from a guess), and a fix
 * for each that is one confirm-gated button. Learning, memory and vectors, performance, the swarm and the install are checked. A fix is
 * always an existing palette entry (a fixed argv through the ruflo CLI that asks first), so the Optimizer adds no new way to write: it
 * finds the problem, offers the right button, and shows the metric before and after. The scope setting limits which fixes are offered
 * (safe: reads and light upkeep; balanced: local compute that writes ruflo's own stores; deep: heavier rebuilds and model downloads).
 */
import { alertsOf } from './data/alerts'
import type { MemoryStats, Namespaces } from './data/cli'
import { EPOCHS, PATTERNS } from './data/automate'
import type { State } from './state'

export type Scope = 'safe' | 'balanced' | 'deep'
export const SCOPES: readonly { id: Scope; title: string; about: string }[] = [
  { id: 'safe', title: 'Safe', about: 'reads and light upkeep' },
  { id: 'balanced', title: 'Balanced', about: 'local compute that writes ruflo’s own stores' },
  { id: 'deep', title: 'Deep', about: 'heavier rebuilds, may fetch a model' },
]
const RANK: Record<Scope, number> = { safe: 0, balanced: 1, deep: 2 }

export type Fix = { id: string; label: string; tier: Scope; /** Why it is that tier and what it does. */ note: string }
export type Finding = { id: string; area: 'learning' | 'memory' | 'performance' | 'swarm' | 'install' | 'health'; level: 'bad' | 'warn' | 'info'; title: string; why: string; metric: string; fixes: Fix[] }

/** A probe's value when it last read ok (the same rule the views use: an error newer than the last ok hides it). */
const probe = <T>(state: State, key: string): T | null => {
  const result = state.probes.get(key)

  if (result === undefined || result.value === null) return null
  if (result.error !== null && (result.errorAtMs ?? 0) >= (result.okAtMs ?? 0)) return null

  return result.value as T
}

const fix = (id: string, label: string, tier: Scope, note: string): Fix => ({ id, label, tier, note })

/** The findings for this project right now, worst first. Only what was read is judged: an unread store is a finding to check, not a verdict. */
export function diagnose(state: State, nowMs: number, loadedAtMs: number): Finding[] {
  const snap = state.snapshot
  const out: Finding[] = []

  if (snap === null) return out

  // ---- learning
  const neural = snap.neural
  const outcomes = snap.outcomes

  if (neural === null || (neural.patterns ?? 0) === 0) {
    out.push({
      id: 'learning-empty',
      area: 'learning',
      level: 'warn',
      title: 'ruflo has learned nothing here yet',
      why: 'no patterns in the neural store: routing and recall start from nothing. Pretraining reads this repository and writes the first ones.',
      metric: neural === null ? 'patterns n/a' : `patterns ${neural.patterns ?? 0}`,
      fixes: [fix('nn-pretrain-shallow', 'pretrain (shallow)', 'safe', 'local; reads the repository, writes the intelligence store'), fix('nn-pretrain-medium', 'pretrain (medium)', 'balanced', 'local; a fuller read of the repository'), fix(`nn-train-${PATTERNS[0]}-${EPOCHS[0]}`, `train ${PATTERNS[0]} (${EPOCHS[0]} epochs)`, 'balanced', 'local compute; writes .claude-flow/neural')],
    })
  }

  if (outcomes !== null && outcomes.total >= 10 && outcomes.successes / outcomes.total < 0.6) {
    out.push({
      id: 'router-accuracy',
      area: 'learning',
      level: 'warn',
      title: 'the router is missing too often',
      why: `only ${Math.round((outcomes.successes / outcomes.total) * 100)}% of ${outcomes.total} routed tasks succeeded: train on what worked, and look at why it routes the way it does.`,
      metric: `success ${outcomes.successes}/${outcomes.total}`,
      fixes: [fix('nn-patterns', 'review the patterns', 'safe', 'a read'), fix('nn-pretrain-medium', 'pretrain (medium)', 'balanced', 'local; writes the intelligence store'), fix('nn-quantize', 'quantize patterns', 'deep', 'local; rewrites the stored patterns to Int8')],
    })
  }

  if (snap.router === null && snap.isRufloProject) {
    out.push({ id: 'router-state', area: 'learning', level: 'info', title: 'no model-router state yet', why: 'the model router has made no decision here, so there is nothing to tune: it fills as agents route tasks.', metric: 'decisions n/a', fixes: [fix('nn-status', 'neural status', 'safe', 'a read: every learning component and whether it is loaded')] })
  }

  // ---- memory and vectors (judged only when the Memory probes have run)
  const memory = probe<MemoryStats>(state, 'memory')
  const spaces = probe<Namespaces>(state, 'namespaces')

  if (memory === null) {
    out.push({ id: 'memory-unchecked', area: 'memory', level: 'info', title: 'memory has not been checked this session', why: 'open Memory, or read its health here: the vector coverage and the second store are judged from it.', metric: 'memory n/a', fixes: [fix('mem-health', 'check AgentDB health', 'safe', 'a read')] })
  } else {
    const listed = spaces?.entries ?? []
    const embedded = listed.filter(entry => entry.hasVector).length

    if (listed.length > 0 && embedded / listed.length < 0.6) {
      out.push({
        id: 'memory-vectors',
        area: 'memory',
        level: 'warn',
        title: 'many memories have no vector',
        why: `${listed.length - embedded} of the newest ${listed.length} entries cannot be found by meaning. Initialise the embedding model, then rebuild the index.`,
        metric: `vectors ${embedded}/${listed.length}`,
        fixes: [fix('mem-embed-status', 'embedding status', 'safe', 'a read'), fix('mem-embed-init', 'initialise embeddings', 'deep', 'may fetch the model (network) the first time'), fix('mem-rabitq-build', 'rebuild the RaBitQ index', 'deep', 'local compute; writes the vector index')],
      })
    }

    if ((memory.unread ?? 0) > 0) {
      out.push({ id: 'memory-second-store', area: 'memory', level: 'info', title: 'a second memory store is not in the counts', why: `${memory.unread} rows in .swarm/agentdb-memory.db (the MCP path’s store) are outside the CLI’s counts and list. Unified search reads them; consolidation tidies both.`, metric: `unread ${memory.unread}`, fixes: [fix('mem-bridge', 'memory bridge status', 'safe', 'a read'), fix('mem-consolidate', 'consolidate memories', 'balanced', 'local; rewrites retained memories')] })
    }

    if ((memory.total ?? 0) > 500) {
      out.push({ id: 'memory-size', area: 'memory', level: 'info', title: 'the store is large enough to compact', why: `${memory.total} entries: compressing the store and planning a cleanup keeps search fast.`, metric: `entries ${memory.total}`, fixes: [fix('mem-cleanup-plan', 'plan a cleanup', 'safe', 'a read: what would go, nothing deleted'), fix('mem-compress', 'compress the store', 'balanced', 'local; rewrites the store')] })
    }
  }

  // ---- performance
  out.push({ id: 'performance-unprofiled', area: 'performance', level: 'info', title: 'where the time goes has not been measured', why: 'find the bottleneck before optimising: a local measurement shows it, and optimise applies ruflo’s own suggestions.', metric: 'bottlenecks n/a', fixes: [fix('perf-bottleneck', 'find bottlenecks', 'safe', 'local measurement; writes and removes a temporary probe file, so Claude needs full control'), fix('perf-optimize', 'optimise', 'balanced', 'local; applies ruflo’s suggested settings')] })

  // ---- health and the install (what the console already raises as alerts)
  for (const alert of alertsOf(state, nowMs, loadedAtMs)) {
    out.push({
      id: `alert-${alert.id}`,
      area: alert.id === 'marketplace' || alert.id === 'mods' || alert.id.startsWith('refused') ? 'install' : alert.id.startsWith('stalled') || alert.id.startsWith('expired') || alert.id.startsWith('old') ? 'swarm' : 'health',
      level: alert.level,
      title: alert.text,
      why: `how to fix it: ${alert.fix}`,
      metric: alert.level,
      fixes: alert.paletteId === undefined ? [] : [fix(alert.paletteId, alert.paletteId.replace(/-/g, ' '), 'safe', 'the palette entry for this alert; it asks first')],
    })
  }

  out.push({ id: 'health-doctor', area: 'health', level: 'info', title: 'run the full health check', why: 'doctor checks Node, git, config, the daemon, memory, MCP, AIDefence, disk, helpers and mods; with --fix it also applies the fix for each warning.', metric: 'doctor n/a', fixes: [fix('doc-all', 'doctor: every check', 'safe', 'a read'), fix('doc-fix', 'doctor --fix', 'balanced', 'writes: applies each warning’s fix')] })

  const order = { bad: 0, warn: 1, info: 2 } as const

  return out.sort((a, b) => order[a.level] - order[b.level])
}

/** The fixes of a finding that this scope offers. */
export const offered = (finding: Finding, scope: Scope): Fix[] => finding.fixes.filter(candidate => RANK[candidate.tier] <= RANK[scope])

/** The finding's metric as it reads now, so a fix can show before → now. */
export function metricNow(state: State, id: string, nowMs: number, loadedAtMs: number): string | null {
  return diagnose(state, nowMs, loadedAtMs).find(finding => finding.id === id)?.metric ?? null
}

export type OptimizerState = { scope: Scope; /** finding id → its metric when a fix was last pressed. */ before: Map<string, string>; /** finding id → the fix last run. */ ran: Map<string, string> }

const states = new WeakMap<State, OptimizerState>()

export function optimizerOf(state: State): OptimizerState {
  let found = states.get(state)

  if (found === undefined) {
    found = { scope: 'safe', before: new Map(), ran: new Map() }
    states.set(state, found)
  }

  return found
}

export type OptimizerActions = {
  scope: (scope: Scope) => void
  /** Presses a fix: remembers the metric as it is now, then runs the palette entry (which asks first unless it is a read). */
  fix: (findingId: string, fixId: string) => void
  /** Asks the main Claude about one finding. */
  ask: (findingId: string) => void
}

export function optimizerActions(state: State, invalidate: () => void, run: (id: string) => void, ask: (question: string) => void): OptimizerActions {
  const cfg = optimizerOf(state)

  return {
    scope: scope => {
      cfg.scope = scope
      invalidate()
    },
    fix: (findingId, fixId) => {
      const now = Date.now()
      const finding = diagnose(state, now, state.loadedAtMs).find(candidate => candidate.id === findingId)

      if (finding === undefined || !finding.fixes.some(candidate => candidate.id === fixId)) return

      cfg.before.set(findingId, finding.metric)
      cfg.ran.set(findingId, fixId)
      run(fixId)
    },
    ask: findingId => {
      const finding = diagnose(state, Date.now(), state.loadedAtMs).find(candidate => candidate.id === findingId)

      if (finding !== undefined) ask(`About this finding in my ruflo project: "${finding.title}" (${finding.metric}). ${finding.why} What is the best way to fix it here, and what should I watch for?`)
    },
  }
}

