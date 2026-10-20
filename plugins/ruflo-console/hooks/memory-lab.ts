/**
 * The Memory Lab: ruflo's memory, AgentDB and embeddings surface as fixed argv, each checked against the CLI's own
 * source (commands/memory.ts, mcp-tools/{memory,agentdb,embeddings}-tools.ts) and its `--help`. A read ($0, local)
 * runs at once and shows what it printed in the lab's result panel; a write, a delete, or a call that may download the
 * embedding model asks first, and its confirm row says so. Free text (a query, a key, a value) is validated here and
 * always travels as one argv element or one JSON string, never through a shell. Pure: entries, validators and specs,
 * no `$`; the actions at the bottom hand specs to the runner.
 */
import { ARGV_TEXT_MAX } from './full-text'
import type { ActionSpec } from './actions'
import type { MemoryEntry } from './data/cli'
import { plain } from './data/parse'
import { memLines } from './memory-lines'
import { textArg } from './ops'
import type { Runner } from './runner'
import type { State } from './state'

/** `read`: $0, local, changes nothing. `writes`: $0, writes the store or a file. `deletes`: removes for good. `net`: may download the embedding model. */
export type MemCost = 'read' | 'writes' | 'deletes' | 'net'
export type MemGroup = 'inspect' | 'agentdb' | 'embeddings' | 'maintain'
/**
 * What an entry takes, as the headless text after its id (`/ruflo run mem-store notes alpha the value`):
 * `text` free text · `node` one id · `pair` two texts split by | · `edge` source relation target ·
 * `entry` namespace key · `kv` namespace key value.
 */
export type MemTakes = 'text' | 'node' | 'pair' | 'edge' | 'entry' | 'kv'

/** What the parsed input carries: the fields an entry's argv is built from. */
export type MemInput = { text?: string; other?: string; key?: string; namespace?: string; value?: string; relation?: string }

export type MemEntry = {
  id: string
  group: MemGroup
  name: string
  about: string
  label: string
  cost: MemCost
  takes?: MemTakes
  /** The argv after the CLI prefix, from the parsed input (and the picked namespace filter); null when it cannot run. */
  args: (input: MemInput, state: State) => readonly string[] | null
  note?: string
  timeoutMs?: number
}

export const MEM_GROUPS: readonly { id: MemGroup; title: string; right: string }[] = [
  { id: 'inspect', title: 'Lab · memory', right: 'stats, health, search, browse · $0 reads run at once' },
  { id: 'agentdb', title: 'Lab · AgentDB', right: 'patterns, tiers, causal graph · reads at once, writes ask' },
  { id: 'embeddings', title: 'Lab · embeddings', right: 'vectors and RaBitQ · may fetch the model once: asks' },
  { id: 'maintain', title: 'Lab · maintain', right: 'import, export, migrate, cleanup · each asks first' },
]

const NAMESPACE = /^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/
const KEY = /^[A-Za-z0-9_][A-Za-z0-9._:/@-]{0,127}$/
const RELATION = /^[A-Za-z][A-Za-z0-9_-]{0,31}$/

/** A namespace as one argv element: letters, digits, . _ -, at most 64, not starting with - or .; else null. */
export const namespaceOf = (value: string | undefined): string | null => (value !== undefined && NAMESPACE.test(value.trim()) ? value.trim() : null)
/** A memory key: letters, digits and . _ : / @ -, at most 128, no spaces, not starting with - (keys like api/auth pass). */
export const keyOf = (value: string | undefined): string | null => (value !== undefined && KEY.test(value.trim()) ? value.trim() : null)

/** Free text as one argv element, refused (not clipped) when longer than `max`: a stored value is never cut short. */
const bounded = (value: string, max: number): string | null => (value.trim().length > max ? null : textArg(value, max))

/** One argv element (ADR-481): the largest text of a memory field. */
const FIELD_MAX = ARGV_TEXT_MAX

/** The text after an entry's id, read into the fields it takes; null when any part would not survive the CLI. */
export function parseInput(takes: MemTakes, raw: string): MemInput | null {
  const words = raw.trim().split(/\s+/).filter(Boolean)

  switch (takes) {
    case 'text': {
      const text = bounded(raw, FIELD_MAX)

      return text === null ? null : { text }
    }
    case 'node': {
      const key = words.length === 1 ? keyOf(words[0]) : null

      return key === null ? null : { key }
    }
    case 'pair': {
      const [a = '', b = '', ...extra] = raw.split('|')
      const text = bounded(a, FIELD_MAX)
      const other = bounded(b, FIELD_MAX)

      return text === null || other === null || extra.length > 0 ? null : { text, other }
    }
    case 'edge': {
      const [source, relation = '', target, ...extra] = words
      const key = keyOf(source)
      const other = keyOf(target)

      return key === null || other === null || !RELATION.test(relation) || extra.length > 0 ? null : { key, relation, other }
    }
    case 'entry':
    case 'kv': {
      const [space, name] = words
      const namespace = namespaceOf(space)
      const key = keyOf(name)
      const value = takes === 'kv' ? bounded(raw.trim().slice((space?.length ?? 0) + 1).trim().slice(name?.length ?? 0), FIELD_MAX) : undefined

      if (namespace === null || key === null || (takes === 'entry' && words.length !== 2) || value === null) return null

      return { namespace, key, ...(value !== undefined && { value }) }
    }
  }
}

/** What each takes looks like, for the footer when the text does not parse. */
export const TAKES_RULE: Record<MemTakes, string> = {
  text: 'text: 1-300 printable characters, not starting with -',
  node: 'one node id: letters, digits, . _ : / @ -, no spaces',
  pair: 'two texts split by |, e.g. jwt refresh | token rotation',
  edge: '<source> <relation> <target>, e.g. auth-bug causes login-fail',
  entry: '<namespace> <key>, e.g. auth jwt/refresh',
  kv: '<namespace> <key> <value…> (value up to 2000 characters), e.g. notes alpha the quick brown fox',
}

const JSON_OUT = ['--format', 'json'] as const

/** An MCP tool call as one fixed argv; the params are typed as the tool's schema declares them, one JSON element. */
export const tool = (name: string, params: Record<string, string | number | boolean> = {}) => ['mcp', 'exec', '-t', name, '-p', JSON.stringify(params)] as const

/** The namespace the browse list is narrowed to, as a `--namespace` pair for CLI reads. */
const inFilter = (state: State): string[] => {
  const space = namespaceOf(state.memoryLab.filter ?? undefined)

  return space === null ? [] : ['--namespace', space]
}

const MODEL_NOTE = '$0, but may download the all-MiniLM-L6-v2 model from Hugging Face the first time (network), then cached'
const EXPORT_PATH = '.claude-flow/memory-export.json'

export const MEM_LAB: readonly MemEntry[] = [
  // Memory: what is stored, how healthy it is, and search over it.
  { id: 'mem-stats', group: 'inspect', name: 'STATS', about: 'entries, storage, oldest and newest, the unread store', label: 'memory stats: entries, storage, oldest and newest', cost: 'read', args: () => ['memory', 'stats', ...JSON_OUT] },
  { id: 'mem-detailed', group: 'inspect', name: 'DETAILED', about: 'entries per namespace, backend, index', label: 'memory detailed stats: per namespace and index', cost: 'read', args: () => tool('memory_detailed-stats') },
  { id: 'mem-bridge', group: 'inspect', name: 'BRIDGE', about: 'Claude Code memory files beside AgentDB entries', label: 'memory bridge status: Claude memories beside AgentDB', cost: 'read', args: () => tool('memory_bridge_status') },
  { id: 'mem-health', group: 'inspect', name: 'HEALTH', about: 'AgentDB available, each controller on or off', label: 'AgentDB health: each controller on or off', cost: 'read', args: () => tool('agentdb_health') },
  { id: 'mem-controllers', group: 'inspect', name: 'CONTROLLERS', about: 'the controller registry and their levels', label: 'AgentDB controllers: the registry and levels', cost: 'read', args: () => tool('agentdb_controllers') },
  { id: 'mem-list', group: 'inspect', name: 'LIST', about: 'the newest 50 entries (in the picked namespace)', label: 'memory list: the newest 50 entries', cost: 'read', args: (_, state) => ['memory', 'list', ...inFilter(state), '--limit', '50', ...JSON_OUT] },
  { id: 'mem-search', group: 'inspect', name: 'SEARCH', about: 'semantic search of the memory store', label: 'memory search <query>: semantic search', cost: 'read', takes: 'text', args: (input, state) => (input.text === undefined ? null : ['memory', 'search', '--query', input.text, ...inFilter(state), '--limit', '10', ...JSON_OUT]) },
  { id: 'mem-unified', group: 'inspect', name: 'UNIFIED', about: 'one search over Claude memories, AgentDB and patterns', label: 'unified search <query>: Claude + AgentDB + patterns', cost: 'read', takes: 'text', args: input => (input.text === undefined ? null : tool('memory_search_unified', { query: input.text, limit: 10 })) },
  { id: 'mem-retrieve', group: 'inspect', name: 'RETRIEVE', about: 'one entry’s whole value: <namespace> <key>', label: 'retrieve <namespace> <key>: one entry’s value', cost: 'read', takes: 'entry', args: input => (input.key === undefined || input.namespace === undefined ? null : ['memory', 'retrieve', '--key', input.key, '--namespace', input.namespace, ...JSON_OUT]) },
  { id: 'mem-compress', group: 'inspect', name: 'COMPRESS', about: 'sizes before and after; this build rewrites nothing', label: 'memory compress: the size report (rewrites nothing)', cost: 'read', args: () => tool('memory_compress') },
  { id: 'mem-cleanup-plan', group: 'inspect', name: 'CLEANUP PLAN', about: 'how many TTL-expired entries a cleanup would delete', label: 'cleanup dry run: expired entries a cleanup would delete', cost: 'read', args: () => tool('memory_cleanup', { dryRun: true }) },

  // AgentDB: the pattern bank, the tiered memory and the causal graph.
  { id: 'mem-pattern-search', group: 'agentdb', name: 'PATTERN SEARCH', about: 'the ReasoningBank patterns nearest the text', label: 'pattern search <text>: nearest ReasoningBank patterns', cost: 'read', takes: 'text', args: input => (input.text === undefined ? null : tool('agentdb_pattern-search', { query: input.text, topK: 5 })) },
  { id: 'mem-recall', group: 'agentdb', name: 'RECALL', about: 'hierarchical recall across working/episodic/semantic', label: 'hierarchical recall <text>: across the three tiers', cost: 'read', takes: 'text', args: input => (input.text === undefined ? null : tool('agentdb_hierarchical-recall', { query: input.text, topK: 5 })) },
  { id: 'mem-graph', group: 'agentdb', name: 'GRAPH', about: 'the causal graph two hops out from a node id', label: 'graph query <node>: k-hop, depth 2', cost: 'read', takes: 'node', args: input => (input.key === undefined ? null : tool('agentdb_graph-query', { nodeId: input.key, mode: 'k-hop', depth: 2, topK: 10 })) },
  { id: 'mem-synth', group: 'agentdb', name: 'SYNTHESIZE', about: 'a context brief assembled from the stored memories nearest the text', label: 'synthesize context <text>: a brief from the nearest memories', cost: 'read', takes: 'text', args: input => (input.text === undefined ? null : tool('agentdb_context-synthesize', { query: input.text, maxEntries: 10 })) },
  { id: 'mem-sroute', group: 'agentdb', name: 'INTENT ROUTE', about: 'which intent route the text falls under (AgentDB SemanticRouter)', label: 'intent route <text>: classify with the SemanticRouter', cost: 'read', takes: 'text', args: input => (input.text === undefined ? null : tool('agentdb_semantic-route', { input: input.text })) },
  { id: 'mem-path', group: 'agentdb', name: 'PATHFINDER', about: 'ranked graph paths from a node toward a question (personalized PageRank)', label: 'pathfinder <node> | <question>: ranked paths, depth 3', cost: 'read', takes: 'pair', args: input => (input.text === undefined || input.other === undefined ? null : tool('agentdb_graph-pathfinder', { seedNodeId: input.text.trim(), query: input.other, depth: 3, topK: 10, algorithm: 'personalized-pagerank' })) },
  { id: 'mem-pattern-store', group: 'agentdb', name: 'PATTERN STORE', about: 'save the text as a ReasoningBank pattern', label: 'pattern store <text>: save a ReasoningBank pattern', cost: 'writes', takes: 'text', args: input => (input.text === undefined ? null : tool('agentdb_pattern-store', { pattern: input.text, type: 'console' })), note: '$0, local: writes one pattern to AgentDB' },
  { id: 'mem-hstore', group: 'agentdb', name: 'TIER STORE', about: 'the store fields into the working tier', label: 'hierarchical store <namespace> <key> <value>: working tier', cost: 'writes', takes: 'kv', args: input => (input.key === undefined || input.value === undefined ? null : tool('agentdb_hierarchical-store', { key: input.key, value: input.value, tier: 'working' })), note: '$0, local: writes one entry to the working tier (the namespace is not used by this tool)' },
  { id: 'mem-edge', group: 'agentdb', name: 'CAUSAL EDGE', about: 'link two nodes: <source> <relation> <target>', label: 'causal edge <source> <relation> <target>: link two nodes', cost: 'writes', takes: 'edge', args: input => (input.key === undefined || input.other === undefined || input.relation === undefined ? null : tool('agentdb_causal-edge', { sourceId: input.key, targetId: input.other, relation: input.relation })), note: '$0, local: writes one edge to the AgentDB causal graph' },
  { id: 'mem-consolidate', group: 'agentdb', name: 'CONSOLIDATE', about: 'merge and promote memories across tiers', label: 'AgentDB consolidate: merge and promote across tiers', cost: 'writes', args: () => tool('agentdb_consolidate'), note: '$0, local: may merge, promote or prune stored memories (answers unsupported when the controller is a stub)' },

  // Embeddings: generate, compare, search and the 1-bit RaBitQ index.
  { id: 'mem-embed-status', group: 'embeddings', name: 'STATUS', about: 'model, dimensions, cache; embeds a probe text', label: 'embeddings status: model, dimensions, cache', cost: 'net', args: () => tool('embeddings_status'), note: MODEL_NOTE },
  { id: 'mem-embed', group: 'embeddings', name: 'GENERATE', about: 'the vector for the text: dimensions and head', label: 'embed <text>: generate its vector', cost: 'net', takes: 'text', args: input => (input.text === undefined ? null : tool('embeddings_generate', { text: input.text })), note: MODEL_NOTE },
  { id: 'mem-compare', group: 'embeddings', name: 'COMPARE', about: 'cosine similarity of two texts: a | b', label: 'compare <a> | <b>: cosine similarity', cost: 'net', takes: 'pair', args: input => (input.text === undefined || input.other === undefined ? null : tool('embeddings_compare', { text1: input.text, text2: input.other, metric: 'cosine' })), note: MODEL_NOTE },
  { id: 'mem-esearch', group: 'embeddings', name: 'VECTOR SEARCH', about: 'nearest stored vectors to the text', label: 'vector search <text>: nearest stored vectors', cost: 'net', takes: 'text', args: input => (input.text === undefined ? null : tool('embeddings_search', { query: input.text, topK: 5 })), note: MODEL_NOTE },
  { id: 'mem-rabitq-status', group: 'embeddings', name: 'RABITQ STATUS', about: 'is the 1-bit index built, its size and ratio', label: 'RaBitQ status: built, vectors, compression', cost: 'read', args: () => tool('embeddings_rabitq_status') },
  { id: 'mem-rabitq-search', group: 'embeddings', name: 'RABITQ SEARCH', about: 'the 1-bit index’s nearest entries to the text', label: 'RaBitQ search <text>: nearest in the 1-bit index', cost: 'net', takes: 'text', args: input => (input.text === undefined ? null : tool('embeddings_rabitq_search', { query: input.text, k: 10 })), note: MODEL_NOTE },
  { id: 'mem-rabitq-build', group: 'embeddings', name: 'RABITQ BUILD', about: 'quantize the stored vectors into the 1-bit index', label: 'RaBitQ build: quantize the stored vectors', cost: 'writes', args: () => tool('embeddings_rabitq_build'), note: '$0, local: writes .swarm/rabitq.meta.json; the index itself stays in memory' },
  { id: 'mem-embed-init', group: 'embeddings', name: 'INIT', about: 'write the embeddings config (MiniLM, hyperbolic)', label: 'embeddings init: write .claude-flow/embeddings.json', cost: 'writes', args: () => tool('embeddings_init'), note: '$0, local: writes .claude-flow/embeddings.json and .claude-flow/models/; refuses if a config exists' },

  // Maintain: what moves memories in, out, or away.
  { id: 'mem-store', group: 'maintain', name: 'STORE', about: 'the store fields: <namespace> <key> <value>', label: 'store <namespace> <key> <value>: save one entry', cost: 'writes', takes: 'kv', args: input => (input.key === undefined || input.namespace === undefined || input.value === undefined ? null : ['memory', 'store', '--key', input.key, '--value', input.value, '--namespace', input.namespace]), note: '$0, local: writes (or replaces) one entry and its embedding; r re-lists the browse list' },
  { id: 'mem-import-claude', group: 'maintain', name: 'IMPORT CLAUDE', about: 'this project’s Claude Code memories into AgentDB', label: 'import Claude memories: this project into AgentDB', cost: 'writes', args: () => tool('memory_import_claude'), note: '$0, local: reads this project’s ~/.claude/projects/<hash>/memory/*.md, writes one entry per section to namespace claude-memories', timeoutMs: 180_000 },
  { id: 'mem-import-all', group: 'maintain', name: 'IMPORT ALL', about: 'every project’s Claude Code memories into AgentDB', label: 'import Claude memories from every project', cost: 'writes', args: () => tool('memory_import_claude', { allProjects: true }), note: '$0, local: reads every ~/.claude/projects/*/memory/*.md, writes one entry per section to namespace claude-memories', timeoutMs: 300_000 },
  { id: 'mem-export', group: 'maintain', name: 'EXPORT', about: `every entry as JSON to ${EXPORT_PATH}`, label: `memory export: every entry to ${EXPORT_PATH}`, cost: 'writes', args: (_, state) => ['memory', 'export', '--output', EXPORT_PATH, ...inFilter(state)], note: `$0, local: writes (overwrites) ${EXPORT_PATH}` },
  { id: 'mem-migrate', group: 'maintain', name: 'MIGRATE', about: 'the legacy JSON store into the sql.js store, once', label: 'memory migrate: the legacy JSON store into sql.js', cost: 'writes', args: () => tool('memory_migrate'), note: '$0, local: imports the legacy JSON store once; a marker file stops a second run' },
  { id: 'mem-delete', group: 'maintain', name: 'DELETE', about: 'one entry for good: <namespace> <key>', label: 'delete <namespace> <key>: remove one entry for good', cost: 'deletes', takes: 'entry', args: input => (input.key === undefined || input.namespace === undefined ? null : ['memory', 'delete', '--key', input.key, '--namespace', input.namespace, '--force']), note: 'DELETES FOR GOOD: the entry and its AgentDB mirror; there is no undo' },
  { id: 'mem-cleanup', group: 'maintain', name: 'CLEANUP', about: 'delete every entry whose TTL has expired', label: 'memory cleanup: delete every TTL-expired entry', cost: 'deletes', args: () => tool('memory_cleanup', { dryRun: false }), note: 'DELETES FOR GOOD: every entry whose TTL has expired; run CLEANUP PLAN first to see how many' },
]

/** The ids that take text, for the palette's keyword list: `/ruflo run mem-search jwt refresh`. */
export const MEM_KEYWORDS: readonly string[] = MEM_LAB.flatMap(entry => (entry.takes === undefined ? [] : [entry.id]))

export const memEntry = (id: string): MemEntry | undefined => MEM_LAB.find(entry => entry.id === id)

/** The spec for an entry and its input: reads run at once; the rest ask, their note on the confirm row. */
export function memSpec(entry: MemEntry, input: MemInput, state: State): ActionSpec | null {
  const args = entry.args(input, state)

  if (args === null) return null

  const what = input.namespace !== undefined && input.key !== undefined ? ` (${input.namespace}/${input.key})` : input.text !== undefined ? ` "${plain(input.text, 40)}"` : ''

  return {
    label: `${entry.label.split(':')[0] ?? entry.label}${what}`,
    args,
    expect: entry.cost === 'read' ? 'its output in the lab' : `its result in the lab${entry.note !== undefined ? `; ${entry.note}` : ''}`,
    lab: entry.id,
    scope: `mem:${state.memoryLab.origin}`,
    lines: (stdout, stderr) => memLines(entry.id, stdout, stderr),
    ...(entry.cost === 'read' && { isReadOnly: true }),
    ...(entry.note !== undefined && { note: entry.note }),
    ...(entry.timeoutMs !== undefined && { timeoutMs: entry.timeoutMs }),
  }
}

/** The spec from headless text (the palette, `/ruflo run`): null when the text does not parse. */
export function memSpecOf(entry: MemEntry, text: string, state: State): ActionSpec | null {
  const input = entry.takes === undefined ? {} : parseInput(entry.takes, text)

  return input === null ? null : memSpec(entry, input, state)
}

export const memWhy = (entry: MemEntry): string => (entry.takes === undefined ? 'cannot run now' : `type ${entry.id} ${TAKES_RULE[entry.takes]}`)

/** The lab's fields and picks: the search box, the store fields, the lab's text field, and the browse filter. */
export type MemoryLabState = {
  query: string
  scope: 'memory' | 'unified'
  key: string
  value: string
  namespace: string
  text: string
  filter: string | null
  page: number
  /** The area the last action was raised in (search, entry, browse, or a lab group): its confirm and its result are drawn there. */
  origin: string
}

export const emptyMemoryLab = (): MemoryLabState => ({ query: '', scope: 'memory', key: '', value: '', namespace: 'default', text: '', filter: null, page: 0, origin: 'entry' })

export type MemField = 'query' | 'key' | 'value' | 'namespace' | 'text'

/** The headless text a button builds from the fields, so the view and `/ruflo run` take one path. */
export function textOfFields(entry: MemEntry, lab: MemoryLabState): string {
  switch (entry.takes) {
    case 'entry':
      return `${lab.namespace} ${lab.key}`
    case 'kv':
      return `${lab.namespace} ${lab.key} ${lab.value}`
    case undefined:
      return ''
    default:
      return entry.id === 'mem-search' || entry.id === 'mem-unified' ? lab.query : lab.text
  }
}

export type MemoryActions = {
  draft: (field: MemField, text: string) => void
  /** Enter in the search box: memory search or the unified search, as the scope toggle says. */
  search: (text: string) => void
  scope: () => void
  /** A lab button: the entry with the fields as its input. */
  run: (id: string) => void
  open: (entry: MemoryEntry) => void
  remove: (entry: MemoryEntry) => void
  filter: (namespace: string | null) => void
  page: (by: number) => void
}

export function memoryActions(state: State, runner: Runner, invalidate: () => void): MemoryActions {
  const lab = state.memoryLab
  const go = (id: string, text: string, origin: string) => {
    const entry = memEntry(id)

    if (entry === undefined) return

    lab.origin = origin

    // A fresh result reads from its top.
    state.select.item = 0
    runner.ask(memSpecOf(entry, text, state), memWhy(entry))
  }

  return {
    draft: (field, text) => {
      lab[field] = text
    },
    search: text => {
      lab.query = text
      go(lab.scope === 'unified' ? 'mem-unified' : 'mem-search', text, 'search')
    },
    scope: () => {
      lab.scope = lab.scope === 'memory' ? 'unified' : 'memory'
      invalidate()
    },
    run: id => {
      const entry = memEntry(id)

      // The entry fields' own buttons answer under the entry fields; a lab row answers under its group.
      if (entry !== undefined) go(id, textOfFields(entry, lab), id === 'mem-store' || id === 'mem-retrieve' || id === 'mem-delete' ? 'entry' : entry.group)
    },
    open: entry => go('mem-retrieve', `${entry.namespace} ${entry.key}`, 'browse'),
    remove: entry => go('mem-delete', `${entry.namespace} ${entry.key}`, 'browse'),
    filter: namespace => {
      lab.filter = lab.filter === namespace ? null : namespace
      lab.page = 0
      invalidate()
    },
    page: by => {
      lab.page = Math.max(0, lab.page + by)
      invalidate()
    },
  }
}
