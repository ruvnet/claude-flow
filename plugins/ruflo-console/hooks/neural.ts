/**
 * The Learning Lab: ruflo's neural commands and the router's "which agent?" as fixed argv, checked against
 * @claude-flow/cli 3.51.1 (commands/neural.ts, commands/hooks.ts route/explain, mcp-tools/neural-tools.ts). Reads run at
 * once into the result panel; training, quantizing and compressing are local compute that writes the neural store, so
 * each asks first. `neural train` prints no per-epoch lines when it is not on a TTY, so the loss sparkline is one point
 * per training run, read from the table it prints at the end (Final Loss, else Avg Loss). Pure: specs only.
 */
import { ARGV_TEXT_MAX } from './full-text'
import type { ActionSpec } from './actions'
import { autoSpec, tool, type AutoEntry } from './automate'
import { recallEntries } from './recall'
import { EPOCHS, freeText, objectIn, parseTrain, PATTERNS, tableRows, type Pattern } from './data/automate'
import { plain, recordOf } from './data/parse'
import { ratioOf } from './data/safe'
import { labLines } from './mh-lab'
import type { State } from './state'

const PRETRAIN_NOTE = 'local compute that reads the repository and writes the intelligence store (patterns, no model calls)'
const TRAIN_NOTE = 'local compute, seconds to minutes; writes .claude-flow/neural (patterns.json and a checkpoint); no model calls'

/** `coordination 50`: a pattern type, then epochs from 1 to 500 (default 20). */
export function trainArgs(text: string): { pattern: Pattern; epochs: number } | null {
  const [word = '', count] = text.trim().toLowerCase().split(/\s+/)
  const pattern = PATTERNS.find(candidate => candidate === word)
  const epochs = count === undefined ? 20 : /^\d{1,3}$/.test(count) ? Number(count) : NaN

  return pattern === undefined || !Number.isInteger(epochs) || epochs < 1 || epochs > 500 ? null : { pattern, epochs }
}

export function trainSpec(state: State, text: string, id = 'nn-train'): ActionSpec | null {
  const picked = trainArgs(text)

  if (picked === null) return null

  return autoSpec(id, `train ${picked.pattern} patterns for ${picked.epochs} epochs`, 'local', ['neural', 'train', '--pattern', picked.pattern, '--epochs', String(picked.epochs)], {
    note: TRAIN_NOTE,
    timeoutMs: 600_000,
    read: (stdout, stderr, ok) => {
      const run = ok ? parseTrain(stdout, Date.now()) : null

      if (run === null) return labLines('nn-train', stdout, stderr)

      state.auto.trains.push(run)
      if (state.auto.trains.length > 40) state.auto.trains.splice(0, state.auto.trains.length - 40)

      return tableRows(stdout).map(([name, value]) => `${name}: ${value}`)
    },
  })
}

/** `hooks route --format json`: the pick, its confidence, the method, then the runners-up. */
function routeRead(stdout: string, stderr: string): string[] {
  const value = objectIn(stdout)
  const primary = recordOf(value?.primaryAgent)

  if (value === null || primary === null) return labLines('nn-route', stdout, stderr)

  // A confidence is a 0..1 ratio: clamped where it is read, so `1e300` is not drawn as "1e+302%" (#3822).
  const confidence = ratioOf(primary.confidence)
  const out = [`→ ${plain(String(primary.type ?? 'n/a'), 30)}${confidence !== undefined ? ` · ${Math.round(confidence * 100)}%` : ''} · ${plain(String(recordOf(value.routing)?.method ?? 'n/a'), 30)}${value.matchedPattern !== undefined ? ` · pattern ${plain(String(value.matchedPattern), 30)}` : ''}`]

  for (const alt of (Array.isArray(value.alternativeAgents) ? value.alternativeAgents : []).slice(0, 4).map(recordOf)) {
    const score = ratioOf(alt?.confidence ?? alt?.score)

    if (alt !== null) out.push(`  or ${plain(String(alt.type ?? alt.agent ?? ''), 30)}${score !== undefined ? ` · ${Math.round(score * 100)}%` : ''}`)
  }

  if (typeof primary.reason === 'string') out.push(plain(primary.reason, 150))

  return out
}

export function routeSpec(text: string): ActionSpec | null {
  const task = freeText(text, ARGV_TEXT_MAX)

  return task === null ? null : autoSpec('nn-route', `which agent for "${task.slice(0, 40)}"`, 'read', ['hooks', 'route', '--task', task, '--format', 'json'], { read: routeRead })
}

export function patternSearchSpec(text: string): ActionSpec | null {
  const query = freeText(text, ARGV_TEXT_MAX)

  return query === null ? null : autoSpec('nn-pattern-search', `search patterns for "${query.slice(0, 40)}"`, 'read', tool('hooks_intelligence_pattern-search', { query, topK: 5 }))
}

export function patternStoreSpec(text: string): ActionSpec | null {
  const pattern = freeText(text, ARGV_TEXT_MAX)

  return pattern === null ? null : autoSpec('nn-pattern-store', `store the pattern "${pattern.slice(0, 40)}"`, 'local', tool('hooks_intelligence_pattern-store', { pattern, type: 'general' }), { note: 'local; adds one pattern to the ReasoningBank (HNSW-indexed) the router and recall read' })
}

export function explainSpec(text: string): ActionSpec | null {
  const task = freeText(text, ARGV_TEXT_MAX)

  return task === null ? null : autoSpec('nn-explain', `explain the routing of "${task.slice(0, 40)}"`, 'read', ['hooks', 'explain', '--task', task])
}

export function predictSpec(text: string): ActionSpec | null {
  const input = freeText(text, ARGV_TEXT_MAX)

  return input === null ? null : autoSpec('nn-predict', `predict for "${input.slice(0, 40)}"`, 'read', ['neural', 'predict', '--input', input, '--format', 'json'])
}

/** The inspect entries, then the asked ones (quantize, compress), then the typed ones; ids are what `/ruflo run` takes. */
export function neuralEntries(state: State): AutoEntry[] {
  const fixed: [string, string, ActionSpec][] = [
    ['nn-status', 'neural status: every learning component and whether it is loaded', autoSpec('nn-status', 'neural status', 'read', ['neural', 'status'])],
    ['nn-patterns', 'neural patterns: the stored patterns, their confidence and use', autoSpec('nn-patterns', 'neural patterns', 'read', ['neural', 'patterns', '--action', 'list'])],
    ['nn-analyze', 'neural optimize --method analyze: pattern memory by component', autoSpec('nn-analyze', 'pattern memory analysis', 'read', ['neural', 'optimize', '--method', 'analyze'])],
    ['nn-intel', 'hooks intelligence stats: SONA, MoE, EWC++, LoRA and the router', autoSpec('nn-intel', 'intelligence stats', 'read', tool('hooks_intelligence_stats', {}))],
    ['nn-pretrain-shallow', 'hooks pretrain (shallow): bootstrap intelligence from this repository, quickly', autoSpec('nn-pretrain-shallow', 'pretrain from the repository (shallow)', 'local', tool('hooks_pretrain', { depth: 'shallow' }), { note: PRETRAIN_NOTE, timeoutMs: 300_000 })],
    ['nn-pretrain-medium', 'hooks pretrain (medium): the default depth', autoSpec('nn-pretrain-medium', 'pretrain from the repository (medium)', 'local', tool('hooks_pretrain', { depth: 'medium' }), { note: PRETRAIN_NOTE, timeoutMs: 600_000 })],
    ['nn-pretrain-deep', 'hooks pretrain (deep): the whole repository, slower', autoSpec('nn-pretrain-deep', 'pretrain from the repository (deep)', 'local', tool('hooks_pretrain', { depth: 'deep' }), { note: PRETRAIN_NOTE, timeoutMs: 900_000 })],
    ['nn-consolidate', 'agentdb consolidate: ask AgentDB to consolidate retained memories', autoSpec('nn-consolidate', 'consolidate retained memories', 'local', tool('agentdb_consolidate', {}), { note: 'local; rewrites AgentDB’s retained memories (it refuses when the bridge is unavailable)' })],
    ['nn-quantize', 'neural optimize --method quantize: patterns to Int8', autoSpec('nn-quantize', 'quantize the stored patterns to Int8', 'local', ['neural', 'optimize', '--method', 'quantize'], { note: 'local compute; rewrites the stored pattern embeddings as Int8 (about 4x smaller, slightly less exact)' })],
    ['nn-compress', 'neural_compress quantize: compress the neural store', autoSpec('nn-compress', 'compress the neural store (quantize)', 'local', tool('neural_compress', { method: 'quantize' }), { note: 'local compute; rewrites the neural store in .claude-flow/neural (needs memory init first)' })],
  ]
  const out: AutoEntry[] = fixed.map(([id, label, spec]) => ({ id, group: 'neural', label, spec }))

  for (const pattern of PATTERNS) {
    for (const epochs of EPOCHS) out.push({ id: `nn-train-${pattern}-${epochs}`, group: 'neural', label: `train ${pattern} patterns, ${epochs} epochs`, spec: trainSpec(state, `${pattern} ${epochs}`, `nn-train-${pattern}-${epochs}`) })
  }

  out.push({ id: 'nn-train', group: 'neural', label: 'nn-train <pattern> [epochs]: train neural patterns', make: text => trainSpec(state, text) })
  out.push({ id: 'nn-pattern-search', group: 'neural', label: 'nn-pattern-search <query>: search the stored patterns by meaning', make: patternSearchSpec })
  out.push({ id: 'nn-pattern-store', group: 'neural', label: 'nn-pattern-store <text>: store a pattern in the ReasoningBank', make: patternStoreSpec })
  out.push({ id: 'nn-route', group: 'neural', label: 'nn-route <task>: which agent for this task?', make: routeSpec })
  out.push({ id: 'nn-explain', group: 'neural', label: 'nn-explain <task>: why the router picks that agent', make: explainSpec })
  out.push({ id: 'nn-predict', group: 'neural', label: 'nn-predict <text>: the trained models’ top predictions', make: predictSpec })
  out.push(...recallEntries(state))

  return out
}
