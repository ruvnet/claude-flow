/**
 * The command palette: every action the console can take, as a flat list filtered by a fuzzy query. Pure: it builds
 * entries from the state; the controller runs the one picked. Text-taking entries (route, store, search) read their
 * argument from the query after their keyword: `route fix the login bug`.
 */
import { HIVE_ROLES, pickedProposal } from './data/hive'
import { START_IDS, START_LABEL, startSpec } from './starts'
import { BUDGET_PRESETS, budgetWhy, inspectModels, setBudget } from './cost'
import { hiveBroadcast, hivePropose, hiveSpawn, hiveVote } from './hive'
import { claimTask, handoffClaim, releaseClaim, stealClaim, type ActionSpec } from './actions'
import { MEM_KEYWORDS, MEM_LAB, memSpecOf, memWhy } from './memory-lab'
import { EVOLVE, evolveSpec, evolveWhy } from './evolve'
import { askPalette } from './ask-palette'
import { adrPalette } from './adr-palette'
import { missionPalette } from './mission-palette'
import { catalogPalette } from './plugin-catalog'
import { settingsPalette } from './settings-palette'
import { devPalette } from './devtools'
import { LAB, labSpec, labWhy } from './mh-lab'
import { PERF } from './perf'
import { anatolePalette } from './anatole'
import { SECURE, SECURE_KEYWORDS, SECURE_TEXT, secSpec, secTextSpec } from './secure'
import { skillPaletteEntries } from './skills-lab'
import { automateEntries } from './automate'
import { neuralEntries } from './neural'
import { AGENT_TYPES, agentLogs, dispatchWorker, memorySearch, memoryStore, reroute, setClaimStatus, spawnAgent, stopAgent, swarmInit, swarmStop, vote, WORKERS } from './ops'
import { VIEWS, type State, type ViewId } from './state'
import { XRUV } from './xruv'
import { VEC, vecSpec, vecWhy } from './vector'
import { selection } from './views/select'
import { plain } from './data/parse'

export type PaletteRun =
  | { kind: 'spec'; spec: ActionSpec | null; why: string }
  | { kind: 'view'; view: ViewId }
  | { kind: 'drill'; agentId: string }
  | { kind: 'text'; keyword: string; make: (text: string) => ActionSpec | null; why?: (text: string) => string }
  | { kind: 'command'; name: 'refresh' | 'help' | 'close' | 'withdraw' }

/** The entry Claude uses to take back its own waiting ask; it is listed only while a card Claude raised is waiting. */
export const WITHDRAW_ID = 'ask-withdraw'

/** A card Claude raised by its own console_run, of the write class: the only kind it may withdraw (the runner also matches the card's id). */
export const canWithdraw = (state: State): boolean => state.pending?.source === 'claude' && state.pending.origin === 'console_run' && state.pending.kind === 'write'

/** How Claude can stop waiting on its own card, for a refusal's text: withdraw it. Any other card waits for the person or its window. */
export const withdrawHint = (state: State): string => (canWithdraw(state) ? `, or withdraw your own ask with console_run ${WITHDRAW_ID}` : '')

export type PaletteEntry = { id: string; label: string; group: string; run: PaletteRun }

/** A subsequence match score: higher is better, null when the query's letters are not all there in order. */
export function fuzzy(query: string, label: string): number | null {
  const q = query.trim().toLowerCase()
  const text = label.toLowerCase()

  if (q === '') return 0

  let at = 0
  let score = 0
  let streak = 0

  for (const ch of q) {
    if (ch === ' ') continue

    const found = text.indexOf(ch, at)

    if (found < 0) return null

    streak = found === at ? streak + 1 : 0
    score += 1 + streak * 2 - Math.min(5, found - at) * 0.1 + (found === 0 || text[found - 1] === ' ' ? 2 : 0)
    at = found + 1
  }

  // A contiguous match beats a scattered one, most of all at a word's start.
  const whole = text.indexOf(q)

  return whole < 0 ? score : score + 5 + (whole === 0 || text[whole - 1] === ' ' ? 3 : 0)
}

const TEXT_KEYWORDS: readonly string[] = ['route', 'store', 'search', 'propose', 'broadcast', 'task', 'mission', 'cost-budget', 'x-join', 'x-read', 'x-publish', 'x-create', 'x-grant', 'x-hub', 'x-admit', 'catalog-install', 'catalog-uninstall', 'catalog-enable', 'catalog-disable', 'catalog-update', 'settings-set', 'settings-core', 'ask', 'ask-aside', 'mission-goal', 'mission-aside', 'mission-guide', 'mission-auto', ...MEM_KEYWORDS, ...SECURE_KEYWORDS, 'skills-find', 'auto-wf-new', 'auto-wf-validate', 'auto-ap-history', 'auto-ses-save', 'auto-cfg-get', 'auto-cfg-set', 'auto-task-new', 'nn-train', 'nn-pattern-search', 'nn-pattern-store', 'nn-route', 'nn-explain', 'nn-predict']

/** Every entry for the state as it is, before filtering. */
export function paletteEntries(state: State, nowMs: number): PaletteEntry[] {
  const { claim, agent, task } = selection(state)
  const out: PaletteEntry[] = []
  const add = (id: string, group: string, label: string, run: PaletteRun) => out.push({ id, group, label, run })

  for (const amount of BUDGET_PRESETS) add(`cost-budget-${amount}`, 'cost', `set ruflo-mods budget to $${amount}`, { kind: 'spec', spec: setBudget(state, String(amount)), why: budgetWhy(state, String(amount)) })
  add('cost-budget', 'cost', 'cost-budget <amount>: set ruflo-mods costBudgetUsd (0.01–10000)', { kind: 'text', keyword: 'cost-budget', make: text => setBudget(state, text), why: text => budgetWhy(state, text) })
  add('cost-model-stats', 'cost', 'inspect local model routing counts (spend n/a)', { kind: 'spec', spec: inspectModels(state), why: '' })

  if (agent !== null) {
    const name = agent.name ?? agent.type

    add('agent-drill', 'agent', `open ${name}: role, task, claims, logs, timeline`, { kind: 'drill', agentId: agent.id })
    add('agent-logs', 'agent', `show the logs of ${name}`, { kind: 'spec', spec: agentLogs(agent), why: 'that agent id cannot be passed to ruflo' })
    add('agent-stop', 'agent', `stop agent ${name}`, { kind: 'spec', spec: stopAgent(agent), why: 'that agent id cannot be passed to ruflo' })
  }

  if (claim !== null) {
    const paused = claim.status === 'paused'

    add('claim-pause', 'claims', `${paused ? 'resume' : 'pause'} the claim on ${claim.issueId}`, { kind: 'spec', spec: setClaimStatus(claim, paused ? 'active' : 'paused'), why: 'that claim cannot be passed to ruflo' })
    add('claim-release', 'claims', `release ${claim.issueId}`, { kind: 'spec', spec: releaseClaim(claim), why: 'that claimant cannot be named to ruflo' })

    if (agent !== null) {
      add('claim-handoff', 'claims', `hand ${claim.issueId} off to ${agent.name ?? agent.type}`, { kind: 'spec', spec: handoffClaim(claim, agent), why: 'the picked agent already holds it, or an id cannot be passed' })
      add('claim-steal', 'claims', `steal ${claim.issueId} for ${agent.name ?? agent.type}`, { kind: 'spec', spec: stealClaim(claim, agent), why: claim.isStealable ? 'the picked agent already holds it' : 'the claim is not marked stealable' })
    }
  }

  if (task !== null && agent !== null) add('task-claim', 'claims', `claim task ${task.id} for ${agent.name ?? agent.type}`, { kind: 'spec', spec: claimTask(task, agent), why: 'an id cannot be passed to ruflo' })

  for (const type of AGENT_TYPES) add(`spawn-${type}`, 'swarm', `spawn ${/^[aeiou]/.test(type) ? 'an' : 'a'} ${type} agent`, { kind: 'spec', spec: spawnAgent(type, nowMs), why: 'unknown agent type' })

  // One-click starts, also reachable as `/ruflo run <id>`: everything an empty section offers.
  for (const id of START_IDS) add(id, 'start', `${START_LABEL[id]}`, { kind: 'spec', spec: startSpec(id, nowMs, '', present => { state.nostrKeyVerifiedAtMs = present ? Date.now() : null }), why: 'that start cannot run here' })
  add('task', 'start', 'task <text>: put a task on the board', { kind: 'text', keyword: 'task', make: text => startSpec('task', nowMs, text) })
  add('mission', 'start', 'mission <objective>: create an ADR-406 mission', { kind: 'text', keyword: 'mission', make: text => startSpec('mission', nowMs, text) })

  add('swarm-init', 'swarm', 'start a swarm: init hierarchical, max 8, specialized', { kind: 'spec', spec: swarmInit(), why: '' })
  add('swarm-stop', 'swarm', 'stop the swarm', { kind: 'spec', spec: swarmStop(), why: '' })

  // A vote counts only from a registered worker (the CLI exits 0 on a refused one), so the palette votes as the next
  // worker that has not voted, as the Hive-Mind view does; with no worker left it says so instead of a silent no-op.
  const hiveNow = state.snapshot?.hive ?? null

  for (const proposal of hiveNow?.pending.slice(-3) ?? []) {
    const why = 'no registered worker is left to vote as (hive-mind spawn adds workers), or the proposal id cannot be passed'

    add(`vote-yes-${proposal.id}`, 'hive', `vote yes on ${proposal.type} (${proposal.id})`, { kind: 'spec', spec: hiveNow === null ? vote(proposal.id, true) : hiveVote(hiveNow, proposal, true), why })
    add(`vote-no-${proposal.id}`, 'hive', `vote no on ${proposal.type} (${proposal.id})`, { kind: 'spec', spec: hiveNow === null ? vote(proposal.id, false) : hiveVote(hiveNow, proposal, false), why })
  }

  const hive = state.snapshot?.hive ?? null
  const picked = pickedProposal(hive, state.select.item)

  // The Hive-Mind view's actions; a text entry's id is its keyword, as `runById` reads the text after it.
  if (hive !== null) {
    if (picked !== null) {
      const why = hive.workers.length === 0 ? 'no registered worker to vote as: spawn one' : 'every worker has voted on it'

      add('hive-vote-yes', 'hive', `vote for ${picked.type} as the next worker (${picked.id})`, { kind: 'spec', spec: hiveVote(hive, picked, true), why })
      add('hive-vote-no', 'hive', `vote against ${picked.type} as the next worker (${picked.id})`, { kind: 'spec', spec: hiveVote(hive, picked, false), why })
    }

    add('propose', 'hive', 'propose <type: text>: put a decision to the hive', { kind: 'text', keyword: 'propose', make: text => hivePropose(hive, text) })
    add('broadcast', 'hive', 'broadcast <text>: message every hive worker', { kind: 'text', keyword: 'broadcast', make: hiveBroadcast })

    for (const role of HIVE_ROLES) add(`hive-spawn-${role}`, 'hive', `spawn a hive ${role} and join it`, { kind: 'spec', spec: hiveSpawn(hive, role), why: 'unknown role' })
  }

  // The MetaHarness lab: reads run at once, the rest ask first; promotion is never an entry (see mh-lab.ts).
  for (const entry of LAB) add(entry.id, 'metaharness', entry.label, { kind: 'spec', spec: labSpec(entry, state), why: labWhy(entry) })
  // The Self-Evolution checks: reads at once, the gate check asks; promotion is never an entry (see evolve.ts).
  for (const entry of EVOLVE) add(entry.id, 'evolve', entry.label, { kind: 'spec', spec: evolveSpec(entry, state), why: evolveWhy(entry) })

  // The x.ruv.io board: reads run at once (the ask is the consent), writes ask first, admin rows need the token.
  for (const entry of XRUV) {
    // An admin row without the token is a spec with its reason, so `/ruflo run x-admit …` says why instead of "type …".
    if (entry.takes !== undefined && (entry.kind !== 'admin' || state.xruv.hasAdminToken === true)) add(entry.id, 'x.ruv.io', `${entry.id.slice(2)} <${entry.takes}>: ${entry.label}`, { kind: 'text', keyword: entry.id, make: text => entry.spec(state, text) })
    else add(entry.id, 'x.ruv.io', entry.label, { kind: 'spec', spec: entry.spec(state, ''), why: entry.why(state, '') })
  }

  // The Memory Lab: an entry that takes text reads it after its id (`mem-search jwt refresh`), the rest run as they are.
  for (const entry of MEM_LAB) {
    add(entry.id, 'memory', entry.label, entry.takes === undefined ? { kind: 'spec', spec: memSpecOf(entry, '', state), why: memWhy(entry) } : { kind: 'text', keyword: entry.id, make: text => memSpecOf(entry, text, state) })
  }

  // Security & Doctor and Performance: reads run at once, the rest ask with their cost on the confirm row (secure.ts, perf.ts).
  for (const entry of [...SECURE, ...PERF]) add(entry.id, entry.id.startsWith('perf') ? 'performance' : 'security', entry.label, { kind: 'spec', spec: secSpec(entry, entry.args, state), why: '' })
  for (const entry of SECURE_TEXT) add(entry.id, 'security', entry.label, { kind: 'text', keyword: entry.id, make: text => secTextSpec(entry, text, state) })
  // The skills view's search, update-all, restore and sync, so /ruflo run skills-update works headless.
  out.push(...skillPaletteEntries(state))


  // Automation and the Learning Lab: reads run at once, the rest ask first; per-row verbs come from the lists last read.
  for (const entry of [...automateEntries(state), ...neuralEntries(state)]) {
    add(entry.id, entry.group, entry.label, entry.make !== undefined ? { kind: 'text', keyword: entry.id, make: entry.make } : { kind: 'spec', spec: entry.spec ?? null, why: entry.why ?? '' })
  }

  // The Vector Lab: a typed entry's id is its keyword (`/ruflo run vec-brain-search hnsw`); n/a ones say why.
  for (const entry of VEC) {
    if (entry.field !== undefined && entry.na === undefined) add(entry.id, 'vector', `${entry.label} <${entry.rule ?? 'text'}>`, { kind: 'text', keyword: entry.id, make: text => vecSpec(entry, state, text) })
    else add(entry.id, 'vector', entry.label, { kind: 'spec', spec: vecSpec(entry, state), why: vecWhy(entry, state) })
  }

  // Dev Tools: local reads run at once, the rest ask first; an entry with a field takes its text (see devtools.ts).
  out.push(...devPalette(state))
  out.push(...catalogPalette(state))
  out.push(...anatolePalette(state))
  out.push(...missionPalette(state))
  out.push(...adrPalette(state))
  out.push(...askPalette(state))
  out.push(...settingsPalette(state))

  for (const worker of WORKERS) add(`worker-${worker}`, 'workers', `dispatch the ${worker} background worker`, { kind: 'spec', spec: dispatchWorker(worker), why: 'unknown worker' })

  add('route', 'learning', 'route <task words>: ask the router for a pick', { kind: 'text', keyword: 'route', make: reroute })
  add('store', 'memory', 'store <text>: save a note in memory namespace console', { kind: 'text', keyword: 'store', make: text => memoryStore(text, nowMs) })
  add('search', 'memory', 'search <query>: semantic memory search', { kind: 'text', keyword: 'search', make: memorySearch })

  for (const view of VIEWS) add(`view-${view.id}`, 'views', `go to ${view.label}${view.key === '' ? '' : ` (${view.key})`}`, { kind: 'view', view: view.id })

  // Claude can take back its own waiting ask (never the person's): a read, it runs nothing and only clears the card.
  if (canWithdraw(state) && state.pending !== null) add(WITHDRAW_ID, 'console', `withdraw Claude's waiting ask ("${plain(state.pending.label, 60)}"): nothing runs`, { kind: 'command', name: 'withdraw' })
  add('refresh', 'console', 'refresh now', { kind: 'command', name: 'refresh' })
  add('help', 'console', 'help: keys and commands', { kind: 'command', name: 'help' })
  add('close', 'console', 'close the console', { kind: 'command', name: 'close' })

  return out
}

/** The entries matching `query`, best first; a text entry matches when the query starts with its keyword. */
export function filterPalette(entries: readonly PaletteEntry[], query: string, context: 'all' | 'selection'): PaletteEntry[] {
  const words = query.trim()
  const keyword = words.split(/\s+/)[0]?.toLowerCase() ?? ''
  const scoped = context === 'selection' ? entries.filter(entry => entry.group === 'agent' || entry.group === 'claims') : entries

  if ((TEXT_KEYWORDS as readonly string[]).includes(keyword) && words.length > keyword.length) {
    return scoped.filter(entry => entry.run.kind === 'text' && entry.run.keyword === keyword)
  }

  return scoped
    .flatMap(entry => {
      const score = fuzzy(words, entry.label)

      return score === null ? [] : [{ entry, score }]
    })
    // What can run comes first, so the best match, which Enter runs, is something that runs; each half keeps its own order.
    .sort((a, b) => Number(isUnavailable(a.entry)) - Number(isUnavailable(b.entry)) || b.score - a.score)
    .map(match => match.entry)
}

/** An entry that cannot run now (its spec is null: a mod that is not seated, a missing selection). */
export const isUnavailable = (entry: PaletteEntry): boolean => entry.run.kind === 'spec' && entry.run.spec === null

/** The argument a text entry takes from the query: everything after its keyword. */
export const textOfQuery = (query: string, keyword: string): string => query.trim().slice(keyword.length).trim()
