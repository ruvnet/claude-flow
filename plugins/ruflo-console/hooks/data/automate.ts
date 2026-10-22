/**
 * What the Automation and Neural views read and keep: the lists a click asked for (workflows, templates, sessions,
 * config, autopilot), the training runs of this session, and the checks every typed value passes before it becomes an
 * argv element. Read against @claude-flow/cli 3.51.1 (mcp-tools/{workflow,session,config,task}-tools.ts,
 * commands/{autopilot,neural}.ts) and what it printed in a scratch project. Pure: no `$`, nothing here runs anything.
 *
 * Config values are masked as they are parsed, so a secret never reaches the state, the result panel or a log line.
 */
import { ARGV_TEXT_MAX } from '../full-text'
import { closeOf } from './json-span'
import { idOf, msOf, numberOf, plain, recordOf, stringOf } from './parse'
import { countOf, ratioOf } from './safe'

export type WorkflowRow = { id: string; name: string; status: string; steps: number; createdAtMs?: number }
export type TemplateRow = { id: string; name: string; steps: number }
export type SessionRow = { id: string; name: string; savedAtMs?: number }
/** `shown` is the value as the view may draw it: a secret-looking key or value is already replaced by a mask. */
export type ConfigRow = { key: string; shown: string; source: string; isSecret: boolean }
export type AutopilotStatus = { isEnabled: boolean; iterations: number; maxIterations: number; timeoutMinutes: number; done: number; total: number; percent: number; sources: string[] }
/** One `neural train` run: the pattern, the epochs asked, and the loss its table printed (Final Loss, else Avg Loss). */
export type TrainRun = { pattern: string; epochs: number; loss?: number; seconds?: number; backend?: string; atMs: number }

export type AutoState = {
  workflows: WorkflowRow[] | null
  templates: TemplateRow[] | null
  sessions: SessionRow[] | null
  config: ConfigRow[] | null
  autopilot: AutopilotStatus | null
  trains: TrainRun[]
  /** The pattern and epochs the train buttons use, picked in the view. */
  pattern: Pattern
  epochs: number
}

export const emptyAuto = (): AutoState => ({ workflows: null, templates: null, sessions: null, config: null, autopilot: null, trains: [], pattern: 'coordination', epochs: 20 })

/** The pattern types `neural train -p` takes (commands/neural.ts). */
export const PATTERNS = ['coordination', 'optimization', 'prediction', 'security', 'testing'] as const
export type Pattern = (typeof PATTERNS)[number]
export const EPOCHS = [10, 20, 50, 100] as const

/** The twelve background workers `hooks_worker-dispatch` accepts (its trigger enum), in its own order. */
export const WORKER_NAMES = ['ultralearn', 'optimize', 'consolidate', 'predict', 'audit', 'map', 'preload', 'deepdive', 'document', 'refactor', 'benchmark', 'testgaps'] as const
export type WorkerName = (typeof WORKER_NAMES)[number]

/** What each worker does, in `hooks worker list`'s words. */
export const WORKER_ABOUT: Record<WorkerName, string> = {
  ultralearn: 'deep knowledge acquisition',
  optimize: 'performance optimization',
  consolidate: 'memory consolidation',
  predict: 'predictive preloading',
  audit: 'security analysis',
  map: 'codebase mapping',
  preload: 'resource preloading',
  deepdive: 'deep code analysis',
  document: 'auto-documentation',
  refactor: 'refactoring suggestions',
  benchmark: 'performance benchmarking',
  testgaps: 'test coverage analysis',
}

/** Typed text: letters, digits, spaces, punctuation and symbols (an em dash or curly quotes too); `plain` drops controls. */
const TYPED = /^[\p{L}\p{N}\p{M}\p{P}\p{S} ]+$/u

/** Free text from a field as one argv element or JSON string: cleaned, 1..max characters, not starting with -. */
export function freeText(value: string, max = ARGV_TEXT_MAX): string | null {
  const text = plain(value, max + 1)

  return text === '' || text.length > max || text.startsWith('-') || !TYPED.test(text) ? null : text
}

const DANGEROUS = new Set(['__proto__', 'constructor', 'prototype'])

/** A config key in dot notation (`swarm.maxAgents`): word segments only, at most ten, nothing that reaches a prototype. */
export function configKeyOf(value: string): string | null {
  const key = value.trim()

  return key.length <= 128 && /^[A-Za-z][A-Za-z0-9_-]*(\.[A-Za-z0-9_-]+){0,9}$/.test(key) && !key.split('.').some(part => DANGEROUS.has(part)) ? key : null
}

/** A key that names a credential: its value is never drawn, and the console never sets it (the confirm row prints argv). */
export const isSecretKey = (key: string): boolean => /(key|token|secret|passw|credential|auth|cookie|private|bearer|jwt|session)/i.test(key)

/** A value shaped like a credential, whatever its key says: provider prefixes, JWTs, or a long unbroken token. */
export function looksSecret(value: unknown): boolean {
  if (typeof value !== 'string') return false

  return /^(sk-|sk_|pk_|rk_|ghp_|gho_|ghs_|github_pat_|glpat-|xox[abpors]-|AKIA|ASIA|AIza|eyJ|npm_|hf_)/.test(value) || /^[A-Za-z0-9+/_=-]{32,}$/.test(value)
}

export const MASK = '•••••• (hidden)'

/** A config value as the view may show it: a mask for anything secret, else the value, short. */
export function shownValue(key: string, value: unknown): { shown: string; isSecret: boolean } {
  const isSecret = isSecretKey(key) || looksSecret(value) || (recordOf(value) !== null && Object.entries(recordOf(value) ?? {}).some(([inner, field]) => isSecretKey(inner) || looksSecret(field)))

  if (isSecret) return { shown: MASK, isSecret: true }
  if (value === undefined) return { shown: 'n/a', isSecret: false }

  return { shown: plain(typeof value === 'string' ? value : JSON.stringify(value) ?? String(value), 80), isSecret: false }
}

/** A typed config value as `config_set` stores it: true/false and plain numbers keep their type, the rest is text. */
export function configValueOf(value: string): string | number | boolean | null {
  const text = value.trim()

  if (text === 'true' || text === 'false') return text === 'true'
  if (/^-?\d{1,15}(\.\d{1,6})?$/.test(text)) return Number(text)

  return freeText(text, ARGV_TEXT_MAX)
}

/** `key value` from one field: the key, then the rest as the value. */
export function keyValueOf(value: string): { key: string; value: string | number | boolean } | null {
  const [head = '', ...rest] = value.trim().split(/\s+/)
  const key = configKeyOf(head)
  const parsed = rest.length === 0 ? null : configValueOf(rest.join(' '))

  return key === null || parsed === null ? null : { key, value: parsed }
}

/** A path inside the project for a tool to read: relative, no `..`, no leading dash or dot-dot, plain characters. */
export function relPathOf(value: string): string | null {
  const path = value.trim()

  return path.length <= 200 && /^[A-Za-z0-9_.][A-Za-z0-9_./-]*$/.test(path) && !path.split('/').includes('..') && !path.startsWith('-') ? path : null
}

/**
 * The JSON object a run printed: from the first line that opens one to the last brace. Not `jsonAfter`, which also takes
 * a line opening `[`: `hooks route` prints `[hooks] Semantic router initialized…` before its JSON.
 */
export function objectIn(stdout: string): Record<string, unknown> | null {
  const text = stdout.length > 1_000_000 ? stdout.slice(0, 1_000_000) : stdout
  const start = /^[ \t]*\{/m.exec(text)

  if (start === null) return null

  try {
    return recordOf(JSON.parse(text.slice(start.index, closeOf(text, start.index) + 1)))
  } catch {
    return null
  }
}

const rows = (value: unknown): Record<string, unknown>[] => (Array.isArray(value) ? value : []).slice(0, 50).map(recordOf).filter((row): row is Record<string, unknown> => row !== null)

/** `workflow_list`: `{ workflows: [{ workflowId, name, status, stepCount, createdAt }] }`, newest first. */
export function parseWorkflows(stdout: string): WorkflowRow[] | null {
  const value = objectIn(stdout)

  if (value === null || !Array.isArray(value.workflows)) return null

  return rows(value.workflows).flatMap(row => {
    const id = idOf(row.workflowId)
    const createdAtMs = msOf(row.createdAt)

    return id === null ? [] : [{ id, name: plain(row.name, 60) || id, status: stringOf(row.status, 20) ?? 'unknown', steps: countOf(row.stepCount) ?? 0, ...(createdAtMs !== undefined && { createdAtMs }) }]
  })
}

/** `workflow_template { action: list }`: `{ templates: [{ templateId, name, stepCount }] }`. */
export function parseTemplates(stdout: string): TemplateRow[] | null {
  const value = objectIn(stdout)

  if (value === null || !Array.isArray(value.templates)) return null

  return rows(value.templates).flatMap(row => {
    const id = idOf(row.templateId)

    return id === null ? [] : [{ id, name: plain(row.name, 60) || id, steps: countOf(row.stepCount) ?? 0 }]
  })
}

/** `session_list`: `{ sessions: [{ sessionId, name, savedAt }] }`, newest first. */
export function parseSessions(stdout: string): SessionRow[] | null {
  const value = objectIn(stdout)

  if (value === null || !Array.isArray(value.sessions)) return null

  return rows(value.sessions).flatMap(row => {
    const id = idOf(row.sessionId)
    const savedAtMs = msOf(row.savedAt)

    return id === null || id === 'unknown' ? [] : [{ id, name: plain(row.name, 60) || id, ...(savedAtMs !== undefined && { savedAtMs }) }]
  })
}

/** `config_list`: `{ configs: [{ key, value, source }] }`, every value masked here, before it is kept. */
export function parseConfig(stdout: string): ConfigRow[] | null {
  const value = objectIn(stdout)

  if (value === null || !Array.isArray(value.configs)) return null

  return rows(value.configs)
    .slice(0, 40)
    .flatMap(row => {
      const key = typeof row.key === 'string' ? configKeyOf(row.key) : null

      return key === null ? [] : [{ key, ...shownValue(key, row.value), source: stringOf(row.source, 20) ?? 'n/a' }]
    })
}

/** `autopilot status --json`: enabled, iterations of max, the timeout, and task progress. */
export function parseAutopilot(stdout: string): AutopilotStatus | null {
  const value = objectIn(stdout)
  const tasks = recordOf(value?.tasks)

  if (value === null || typeof value.enabled !== 'boolean') return null

  return {
    isEnabled: value.enabled,
    iterations: countOf(value.iterations) ?? 0,
    maxIterations: countOf(value.maxIterations) ?? 0,
    timeoutMinutes: countOf(value.timeoutMinutes) ?? 0,
    done: countOf(tasks?.completed) ?? 0,
    total: countOf(tasks?.total) ?? 0,
    percent: Math.round((ratioOf((numberOf(tasks?.percent) ?? 0) / 100) ?? 0) * 100),
    sources: (Array.isArray(value.taskSources) ? value.taskSources : []).slice(0, 6).flatMap(source => (typeof source === 'string' ? [plain(source, 24)] : [])),
  }
}

/** The `| Metric | Value |` rows a CLI table printed, as [name, value] pairs; the header row is left out. */
export function tableRows(stdout: string): [string, string][] {
  return stdout.split('\n').flatMap(line => {
    const match = /^\|\s*([^|]+?)\s*\|\s*([^|]*?)\s*\|$/.exec(line.trim())

    return match === null || match[1] === 'Metric' ? [] : [[plain(match[1], 40), plain(match[2], 80)] as [string, string]]
  })
}

/** What `neural train` printed, as one run: its loss from Final Loss (native backend) or Avg Loss (JS fallback). */
export function parseTrain(stdout: string, atMs: number): TrainRun | null {
  const table = new Map(tableRows(stdout))
  const epochs = Number(table.get('Epochs'))
  const pattern = table.get('Pattern Type')

  if (pattern === undefined || !Number.isFinite(epochs)) return null

  const loss = Number(table.get('Final Loss') ?? table.get('Avg Loss'))
  const seconds = Number.parseFloat(table.get('Total Time') ?? '')
  const backend = table.get('Backend')

  return {
    pattern: plain(pattern, 20),
    epochs,
    atMs,
    ...(Number.isFinite(loss) && { loss }),
    ...(Number.isFinite(seconds) && { seconds }),
    ...(backend !== undefined && backend !== '' && { backend: backend.split(' ')[0] }),
  }
}

const BARS = '▁▂▃▄▅▆▇█'

/** A series as a one-line sparkline, highest value tallest; a flat or single series sits mid-height. */
export function sparkline(values: readonly number[]): string {
  const finite = values.filter(Number.isFinite)
  const lo = Math.min(...finite)
  const hi = Math.max(...finite)

  return finite.map(value => BARS[hi === lo ? 3 : Math.round(((value - lo) / (hi - lo)) * (BARS.length - 1))]).join('')
}

/**
 * A stored task status as one of ruflo's five, reading the spellings older CLIs stored as written ("complete", "done",
 * "canceled", "running"); anything else is returned trimmed and lower-cased, so callers that compare against the five
 * treat it as not finished. Every reader that decides on status goes through this (kanban, mission scheduling, cancel).
 */
export function taskStatusOf(status: string | undefined): string {
  const key = (status ?? '').trim().toLowerCase()

  if (key === 'complete' || key === 'done') return 'completed'
  if (key === 'canceled') return 'cancelled'
  if (key === 'running' || key === 'in-progress' || key === 'inprogress') return 'in_progress'

  return key
}

/**
 * A task's lane on the kanban: what ruflo's task tools write (pending, in_progress, completed, failed, cancelled), plus the
 * spellings older CLIs stored as written (task_update took any string): "complete" sat in PENDING and inflated its count.
 */
export function laneOf(status: string): 'pending' | 'running' | 'done' {
  const key = status.trim().toLowerCase()

  if (/^(in_progress|in-progress|inprogress|running|assigned|active|busy)$/.test(key)) return 'running'
  if (/^(completed|complete|done|failed|cancelled|canceled|error)$/.test(key)) return 'done'

  return 'pending'
}
