/**
 * The Vector Lab: the ruvector toolchain (its CLI, and the MCP server's tools that have a CLI verb) as fixed argv,
 * each checked against ruvector 0.3.3's `--help` and source. ruflo's own MCP has none of these tools, so every entry
 * runs `npx --offline -y ruvector@0.3.3 …` with no shell. A local read runs at once; a local write asks; anything that
 * reaches the network (pi.ruv.io, the edge genesis node, the npm registry), publishes, spends or deletes asks first and
 * says so on the confirm row. Tools with no CLI verb (rvlite_*, rvf_delete, decompile_witness/search) are n/a here; the
 * rvlite queries are handed to the AI terminal, which asks before it runs anything. Pure: entries and specs only.
 */
import { countOf, LONG_TEXT_MAX } from './full-text'
import type { ActionSpec } from './actions'
import { dimensionOf, domainOf, generatedLines, isKeyless, redact, relPathOf, RV, shareOf, targetOf, textOf, twoOf, vecIdOf, vectorOf, type VectorField } from './data/vector'
import { labLines } from './mh-lab'
import type { Runner } from './runner'
import type { State } from './state'

/** `read`: local, $0. `writes`: a local file. `net`: asks a remote host. `publish`: changes shared state on one. `spends`: may call models. `deletes`: cannot be undone. */
export type VecCost = 'read' | 'writes' | 'net' | 'publish' | 'spends' | 'deletes'
export type VecSection = 'brain' | 'rvf' | 'sql' | 'decompile' | 'workers' | 'edge' | 'hooks' | 'identity'

export type VecEntry = {
  id: string
  section: VecSection
  name: string
  about: string
  label: string
  cost: VecCost
  /** The argv after the ruvector prefix: fixed, or built from the entry's typed text (null when the text will not do). */
  args?: readonly string[] | ((text: string) => readonly string[] | null)
  /** The Input the text comes from in the view, and what it must look like when it will not do. */
  field?: VectorField
  rule?: string
  /** Why it cannot run here at all: no CLI verb, a browser, or a missing package. */
  na?: string
  /** Why it cannot run now, from the state; null when it can. */
  gate?: (state: State) => string | null
  note?: string
  timeoutMs?: number
  lines?: (stdout: string, stderr: string) => string[]
}

export const VEC_SECTIONS: readonly { id: VecSection; title: string; right: string }[] = [
  { id: 'brain', title: 'Brain', right: 'pi.ruv.io · shared · every call asks first' },
  { id: 'rvf', title: 'RVF containers', right: 'local .rvf stores · reads run at once' },
  { id: 'sql', title: 'SQL / Graph', right: 'rvlite · MCP-only · handed to the AI terminal' },
  { id: 'decompile', title: 'Decompile', right: 'a file runs at once · a package asks (npm)' },
  { id: 'workers', title: 'Workers', right: 'npx agentic-flow@alpha · asks first' },
  { id: 'edge', title: 'Edge', right: 'edge-net genesis node · asks first' },
  { id: 'hooks', title: 'Hooks intel', right: 'local · $0 · runs at once' },
  { id: 'identity', title: 'Identity', right: 'pi key · never shown' },
]

const PI = 'reaches pi.ruv.io (the shared brain); needs @ruvector/pi-brain beside ruvector'
const PUBLISH = `PUBLISHES to pi.ruv.io under your pi identity: other agents see it; ${PI.slice(PI.indexOf(';') + 2)}`
const EDGE = 'reaches the edge-net genesis node (Cloud Run, us-central1)'
const AGENTIC = 'reaches the npm registry: every workers verb runs npx agentic-flow@alpha'
const TEXT_RULE = '1-200 characters of plain text, not starting with -'
const ID_RULE = 'a memory id: letters, digits, . _ : -'
const RVF_RULE = 'a project-relative .rvf path (no .., no leading / or -)'

/** Each text kind, as argv or null. */
const text = (fn: (value: string) => readonly string[] | null) => fn
const free = (value: string) => textOf(value)
const rvfWith = (verb: string, second?: (arg: string) => readonly string[] | null) =>
  text(value => {
    const [first, arg] = twoOf(value)
    const path = relPathOf(first, '.rvf')
    const rest = second === undefined ? [] : second(arg)

    return path === null || rest === null ? null : ['rvf', verb, path, ...rest]
  })

export const VEC: readonly VecEntry[] = [
  // BRAIN: every call reaches pi.ruv.io, so even the reads ask.
  { id: 'vec-brain-status', section: 'brain', name: 'STATUS', about: 'memories, contributors, quality, drift', label: 'brain status: the shared brain’s health', cost: 'net', args: ['brain', 'status'], note: PI },
  { id: 'vec-brain-list', section: 'brain', name: 'RECENT', about: 'the newest 20 shared memories', label: 'brain list: the newest 20 memories', cost: 'net', args: ['brain', 'list', '--limit', '20'], note: PI },
  { id: 'vec-brain-search', section: 'brain', name: 'SEARCH', about: 'semantic search of the field’s words', label: 'brain search: the field’s words', cost: 'net', field: 'brain', rule: TEXT_RULE, args: value => { const q = free(value); return q === null ? null : ['brain', 'search', q, '--limit', '10'] }, note: PI },
  { id: 'vec-brain-get', section: 'brain', name: 'GET', about: 'one memory by the id in the field, with provenance', label: 'brain get: the memory with that id', cost: 'net', field: 'brain', rule: ID_RULE, args: value => { const id = vecIdOf(value); return id === null ? null : ['brain', 'get', id] }, note: PI },
  { id: 'vec-brain-drift', section: 'brain', name: 'DRIFT', about: 'knowledge drift, for the domain in the field or all', label: 'brain drift: for the field’s domain, or all', cost: 'net', field: 'brain', rule: 'a domain word, or nothing', args: value => (value.trim() === '' ? ['brain', 'drift'] : domainOf(value) === null ? null : ['brain', 'drift', value.trim()]), note: PI },
  { id: 'vec-brain-partition', section: 'brain', name: 'PARTITION', about: 'knowledge topology, for the domain or all', label: 'brain partition: the topology of a domain, or all', cost: 'net', field: 'brain', rule: 'a domain word, or nothing', args: value => (value.trim() === '' ? ['brain', 'partition'] : domainOf(value) === null ? null : ['brain', 'partition', value.trim()]), note: PI },
  { id: 'vec-brain-vote-up', section: 'brain', name: 'VOTE UP', about: 'up-vote the memory whose id is in the field', label: 'brain vote up on that memory', cost: 'publish', field: 'brain', rule: ID_RULE, args: value => { const id = vecIdOf(value); return id === null ? null : ['brain', 'vote', id, 'up'] }, note: PUBLISH },
  { id: 'vec-brain-vote-down', section: 'brain', name: 'VOTE DOWN', about: 'down-vote the memory whose id is in the field', label: 'brain vote down on that memory', cost: 'publish', field: 'brain', rule: ID_RULE, args: value => { const id = vecIdOf(value); return id === null ? null : ['brain', 'vote', id, 'down'] }, note: PUBLISH },
  { id: 'vec-brain-share', section: 'brain', name: 'SHARE', about: '`title :: content` as a pattern memory', label: 'brain share: publish the field as a pattern', cost: 'publish', field: 'brain', rule: 'title :: content, each plain text', args: value => { const share = shareOf(value); return share === null ? null : ['brain', 'share', share.title, '--category', 'pattern', '--content', share.content] }, note: PUBLISH },
  { id: 'vec-brain-transfer', section: 'brain', name: 'TRANSFER', about: '`source target`: move knowledge between domains', label: 'brain transfer between the two domains', cost: 'publish', field: 'brain', rule: 'two domain words: source target', args: value => { const [from, to] = twoOf(value); return domainOf(from) === null || domainOf(to) === null ? null : ['brain', 'transfer', from, to] }, note: PUBLISH },
  { id: 'vec-brain-sync-pull', section: 'brain', name: 'SYNC PULL', about: 'pull the shared LoRA weights here', label: 'brain sync pull: fetch the shared LoRA weights', cost: 'net', args: ['brain', 'sync', 'pull'], note: `${PI}; writes the pulled weights locally` },
  { id: 'vec-brain-sync-push', section: 'brain', name: 'SYNC PUSH', about: 'push this machine’s LoRA weights up', label: 'brain sync push: upload the local LoRA weights', cost: 'publish', args: ['brain', 'sync', 'push'], note: PUBLISH },
  { id: 'vec-brain-delete', section: 'brain', name: 'DELETE', about: 'delete a memory you contributed, by id', label: 'brain delete: the memory with that id', cost: 'deletes', field: 'brain', rule: ID_RULE, args: value => { const id = vecIdOf(value); return id === null ? null : ['brain', 'delete', id] }, note: `DELETES it from pi.ruv.io for everyone; it cannot be undone; ${PI}` },

  // RVF: the store path is the first field; the second carries a vector, a file, a child store or a dimension.
  { id: 'vec-rvf-examples', section: 'rvf', name: 'EXAMPLES', about: 'the 45 example stores and their sizes', label: 'rvf examples: the example store catalog', cost: 'read', args: ['rvf', 'examples'] },
  { id: 'vec-rvf-status', section: 'rvf', name: 'STATUS', about: 'vectors, segments, epoch, dead space', label: 'rvf status of the store', cost: 'read', field: 'rvfPath', rule: RVF_RULE, args: rvfWith('status') },
  { id: 'vec-rvf-segments', section: 'rvf', name: 'SEGMENTS', about: 'every segment in the file', label: 'rvf segments of the store', cost: 'read', field: 'rvfPath', rule: RVF_RULE, args: rvfWith('segments') },
  { id: 'vec-rvf-query', section: 'rvf', name: 'QUERY', about: 'the 10 nearest to the vector in the second field', label: 'rvf query: the 10 nearest neighbours', cost: 'read', field: 'rvfPath', rule: `${RVF_RULE}, then a vector: numbers separated by commas`, args: rvfWith('query', arg => { const vector = vectorOf(arg); return vector === null ? null : [`--vector=${vector}`, '--k', '10'] }), note: 'reads; ruvector quarantines (renames) a corrupt id sidecar it meets' },
  { id: 'vec-rvf-create', section: 'rvf', name: 'CREATE', about: 'a new cosine store, dimension from the second field (384)', label: 'rvf create: a new cosine store', cost: 'writes', field: 'rvfPath', rule: `${RVF_RULE}, then a dimension 1-4096 (or nothing: 384)`, args: rvfWith('create', arg => { const dim = dimensionOf(arg); return dim === null ? null : ['--dimension', dim, '--metric', 'cosine'] }), note: 'writes the .rvf file and its id sidecar in this project' },
  { id: 'vec-rvf-ingest', section: 'rvf', name: 'INGEST', about: 'vectors from the JSON file in the second field', label: 'rvf ingest: vectors from a JSON file', cost: 'writes', field: 'rvfPath', rule: `${RVF_RULE}, then a project-relative .json of [{id, vector}]`, args: rvfWith('ingest', arg => { const file = relPathOf(arg, '.json'); return file === null ? null : ['--input', file] }), note: 'writes: appends the vectors to the store' },
  { id: 'vec-rvf-derive', section: 'rvf', name: 'DERIVE', about: 'a child store at the second field’s path, with lineage', label: 'rvf derive: a child store with lineage', cost: 'writes', field: 'rvfPath', rule: `${RVF_RULE}, then the child .rvf path`, args: rvfWith('derive', arg => { const child = relPathOf(arg, '.rvf'); return child === null ? null : [child] }), note: 'writes a new .rvf file in this project' },
  { id: 'vec-rvf-compact', section: 'rvf', name: 'COMPACT', about: 'reclaim the space of deleted vectors', label: 'rvf compact: reclaim deleted space', cost: 'writes', field: 'rvfPath', rule: RVF_RULE, args: rvfWith('compact'), note: 'rewrites the store in place' },
  { id: 'vec-rvf-delete', section: 'rvf', name: 'DELETE', about: 'delete vectors by id', label: 'rvf delete vectors by id', cost: 'deletes', na: 'n/a: rvf_delete is an MCP tool of the ruvector server with no CLI verb, and ruflo’s MCP has no rvf tool' },

  // SQL / GRAPH: rvlite has no CLI verb for these; the button hands the query to the AI terminal.
  { id: 'vec-sql', section: 'sql', name: 'SQL', about: 'rvlite_sql over the rvlite database', label: 'rvlite SQL query', cost: 'read', field: 'sql', na: 'n/a as argv: rvlite_sql is MCP-only (ruvector’s CLI and rvlite 0.2.6’s have no sql verb); ▸ ask hands it to the AI terminal' },
  { id: 'vec-cypher', section: 'sql', name: 'CYPHER', about: 'rvlite_cypher over the property graph', label: 'rvlite Cypher query', cost: 'read', field: 'sql', na: 'n/a as argv: rvlite_cypher is MCP-only; ▸ ask hands it to the AI terminal' },
  { id: 'vec-sparql', section: 'sql', name: 'SPARQL', about: 'rvlite_sparql over the RDF triples', label: 'rvlite SPARQL query', cost: 'read', field: 'sql', na: 'n/a as argv: rvlite_sparql is MCP-only; ▸ ask hands it to the AI terminal' },

  // DECOMPILE: ruvector's parseTarget reads ./… as a file and anything else as an npm package.
  { id: 'vec-decompile-file', section: 'decompile', name: 'FILE', about: 'a local ./file.js into modules, with its witness root', label: 'decompile the local file', cost: 'read', field: 'target', rule: 'a project-relative ./file.js, .mjs or .cjs', args: value => { const target = targetOf(value); return target?.kind !== 'file' ? null : ['decompile', target.arg, '--json'] }, timeoutMs: 120_000 },
  { id: 'vec-decompile-pkg', section: 'decompile', name: 'PACKAGE', about: 'an npm package (name or name@version), with witness', label: 'decompile the npm package', cost: 'net', field: 'target', rule: 'an npm package name, optionally @version', args: value => { const target = targetOf(value); return target?.kind !== 'npm' ? null : ['decompile', target.arg, '--json'] }, note: 'reaches the npm registry: downloads the package tarball; writes nothing here (--json)', timeoutMs: 180_000 },
  { id: 'vec-decompile-witness', section: 'decompile', name: 'WITNESS', about: 'verify a witness chain, search decompiled code', label: 'decompile witness / search', cost: 'read', na: 'n/a: decompile_witness and decompile_search are MCP-only; the decompile result above carries the witness root and chain length' },

  // WORKERS: ruvector hands each verb to npx agentic-flow@alpha, so all of them reach the registry.
  { id: 'vec-workers-presets', section: 'workers', name: 'PRESETS', about: 'quick-scan, deep-analysis, security-scan…', label: 'workers presets', cost: 'net', args: ['workers', 'presets'], note: AGENTIC, timeoutMs: 180_000 },
  { id: 'vec-workers-triggers', section: 'workers', name: 'TRIGGERS', about: 'the keywords that start a worker', label: 'workers triggers', cost: 'net', args: ['workers', 'triggers'], note: AGENTIC, timeoutMs: 180_000 },
  { id: 'vec-workers-status', section: 'workers', name: 'STATUS', about: 'the worker dashboard', label: 'workers status', cost: 'net', args: ['workers', 'status'], note: AGENTIC, timeoutMs: 180_000 },
  { id: 'vec-workers-results', section: 'workers', name: 'RESULTS', about: 'what the workers found', label: 'workers results', cost: 'net', args: ['workers', 'results', '--json'], note: AGENTIC, timeoutMs: 180_000 },
  { id: 'vec-workers-stats', section: 'workers', name: 'STATS', about: 'the last 24 hours of work', label: 'workers stats (24h)', cost: 'net', args: ['workers', 'stats'], note: AGENTIC, timeoutMs: 180_000 },
  { id: 'vec-workers-dispatch', section: 'workers', name: 'DISPATCH', about: 'start a background analysis of the field’s words', label: 'workers dispatch: analyse the field’s words', cost: 'spends', field: 'worker', rule: TEXT_RULE, args: value => { const prompt = free(value); return prompt === null ? null : ['workers', 'dispatch', '--', prompt] }, note: `MAY COST MONEY: the worker may call models; ${AGENTIC}`, timeoutMs: 180_000 },

  // EDGE: the genesis node answers status, balance and tasks; join only prints the dashboard address.
  { id: 'vec-edge-status', section: 'edge', name: 'STATUS', about: 'nodes, active nodes, rUv supply, phase', label: 'edge status', cost: 'net', args: ['edge', 'status'], note: EDGE },
  { id: 'vec-edge-balance', section: 'edge', name: 'BALANCE', about: 'the rUv balance of your pi identity', label: 'edge balance of your identity', cost: 'net', args: ['edge', 'balance'], note: `${EDGE}; sends your pi key as the node id when PI is set` },
  { id: 'vec-edge-tasks', section: 'edge', name: 'TASKS', about: 'distributed compute tasks on offer', label: 'edge tasks', cost: 'net', args: ['edge', 'tasks'], note: EDGE },
  { id: 'vec-edge-join', section: 'edge', name: 'JOIN', about: 'how to join: the CLI prints the dashboard address', label: 'edge join: how to join as a node', cost: 'read', args: ['edge', 'join'] },
  { id: 'vec-edge-dashboard', section: 'edge', name: 'DASHBOARD', about: 'open the edge-net dashboard', label: 'edge dashboard', cost: 'net', na: 'n/a: it opens a browser (xdg-open); edge join prints the same address' },

  // HOOKS INTEL: ruvector's local intelligence store; only remember writes.
  { id: 'vec-hooks-stats', section: 'hooks', name: 'STATS', about: 'patterns, memories, trajectories, errors', label: 'hooks stats: ruvector’s intelligence', cost: 'read', args: ['hooks', 'stats'] },
  { id: 'vec-hooks-learning', section: 'hooks', name: 'LEARNING', about: 'the best algorithm, updates and reward', label: 'hooks learning-stats', cost: 'read', args: ['hooks', 'learning-stats', '--json'] },
  { id: 'vec-hooks-route', section: 'hooks', name: 'ROUTE', about: 'which agent the field’s task should go to', label: 'hooks route: an agent for the task', cost: 'read', field: 'task', rule: TEXT_RULE, args: value => { const task = free(value); return task === null ? null : ['hooks', 'route', '--', task] } },
  { id: 'vec-hooks-recall', section: 'hooks', name: 'RECALL', about: 'the five memories nearest the field’s words', label: 'hooks recall: the nearest memories', cost: 'read', field: 'task', rule: TEXT_RULE, args: value => { const query = free(value); return query === null ? null : ['hooks', 'recall', '--top-k', '5', '--', query] } },
  { id: 'vec-hooks-rag', section: 'hooks', name: 'RAG CONTEXT', about: 'context for the field’s words, reranked', label: 'hooks rag-context for the words', cost: 'read', field: 'task', rule: TEXT_RULE, args: value => { const query = free(value); return query === null ? null : ['hooks', 'rag-context', '--top-k', '5', '--rerank', '--', query] } },
  { id: 'vec-hooks-remember', section: 'hooks', name: 'REMEMBER', about: 'store the field’s words as a memory', label: 'hooks remember: store the words', cost: 'writes', field: 'task', rule: TEXT_RULE, args: value => { const note = free(value); return note === null ? null : ['hooks', 'remember', '--type', 'console', '--', note] }, note: 'writes one memory to .ruvector/intelligence.json' },

  // IDENTITY: show runs at once with the key taken out; generate waits until show has found no key.
  { id: 'vec-identity-show', section: 'identity', name: 'SHOW', about: 'your pseudonym and where the key lives (never the key)', label: 'identity show: your pseudonym', cost: 'read', args: ['identity', 'show'] },
  {
    id: 'vec-identity-generate',
    section: 'identity',
    name: 'GENERATE',
    about: 'a new pi key saved to ~/.ruvector/pi-key, once there is none',
    label: 'identity generate: a new pi key, saved',
    cost: 'writes',
    args: ['identity', 'generate', '--save', '--json'],
    gate: state => (state.lab.result?.id === 'vec-identity-show' && isKeyless(state.lab.result.lines) ? null : 'run ▸ SHOW first: generate --save overwrites ~/.ruvector/pi-key, so it waits until show finds no key'),
    note: 'writes a new secret to ~/.ruvector/pi-key (mode 600); only its pseudonym is shown',
    lines: generatedLines,
  },
]

export const vecEntry = (id: string): VecEntry | undefined => VEC.find(entry => entry.id === id)

/** What a run printed, as lines for the result panel, with every trace of key material taken out. */
export const vecLines = (id: string, stdout: string, stderr: string): string[] => redact(labLines(id, stdout, stderr))

/** The argv after the prefix for `text`, or null; the fixed ones ignore the text. */
export function vecArgs(entry: VecEntry, text = ''): readonly string[] | null {
  if (entry.na !== undefined || entry.args === undefined) return null

  return typeof entry.args === 'function' ? entry.args(text) : entry.args
}

/** The spec to run: a local read runs at once, the rest ask with their note; null when it cannot run (see `vecWhy`). */
export function vecSpec(entry: VecEntry, state: State, text = ''): ActionSpec | null {
  const args = entry.gate?.(state) == null ? vecArgs(entry, text) : null

  if (args === null) return null

  const argv = [...RV, ...args]
  const isRead = entry.cost === 'read'

  return {
    label: entry.label,
    args,
    argv,
    shows: argv.join(' '),
    expect: isRead ? 'its output in the Vector Lab' : `its result in the Vector Lab${entry.note !== undefined ? `; ${entry.note}` : ''}`,
    lab: entry.id,
    lines: entry.lines ?? ((stdout, stderr) => vecLines(entry.id, stdout, stderr)),
    ...(isRead && { isReadOnly: true }),
    ...(entry.note !== undefined && { note: entry.note }),
    timeoutMs: entry.timeoutMs ?? 90_000,
  }
}

/** Why an entry has nothing to run, in the footer's words. */
export function vecWhy(entry: VecEntry, state: State): string {
  return entry.na ?? entry.gate?.(state) ?? (entry.rule !== undefined ? `${entry.label}: type ${entry.rule}` : 'nothing to run')
}

/** The rvlite query handed to the AI terminal: claude calls the MCP tool, and the terminal asks before it runs. */
export function rvlitePrompt(kind: 'sql' | 'cypher' | 'sparql', query: string): string | null {
  const text = query.trim()

  if (text === '' || countOf(text) > LONG_TEXT_MAX || /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/.test(text)) return null

  const isWrite = kind === 'sparql' ? /\b(INSERT|DELETE|LOAD|CLEAR|DROP|CREATE)\b/i.test(text) : /\b(INSERT|UPDATE|DELETE|CREATE|DROP|ALTER|MERGE|SET|REMOVE|DETACH)\b/i.test(text)

  return `Use the ruvector MCP tool rvlite_${kind} to run this ${kind === 'sql' ? 'SQL' : kind === 'cypher' ? 'Cypher' : 'SPARQL'} query and show the rows as a table${isWrite ? '. It CHANGES the database: tell me what it will change and wait for my yes before running it' : ' (read-only)'}: ${text}`
}

export type VectorActions = {
  draft: (field: VectorField, text: string) => void
  /** Runs an entry with the text it takes (the view passes the field's text). */
  run: (id: string, text?: string) => void
  /** An rvlite query, typed into the AI terminal for claude. */
  ask: (kind: 'sql' | 'cypher' | 'sparql', query: string) => void
}

export function vectorActions(state: State, runner: Runner, load: (text: string) => void): VectorActions {
  return {
    draft: (field, text) => {
      state.vector[field] = text
    },
    run: (id, text = '') => {
      const entry = vecEntry(id)

      runner.ask(entry === undefined ? null : vecSpec(entry, state, text), entry === undefined ? `no vector entry ${id}` : vecWhy(entry, state))
    },
    ask: (kind, query) => {
      const prompt = rvlitePrompt(kind, query)

      if (prompt === null) runner.ask(null, `rvlite ${kind}: type a query of 1-20,000 characters`)
      else load(prompt)
    },
  }
}
