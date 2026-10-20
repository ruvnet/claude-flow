/**
 * The MetaHarness lab: every `ruflo metaharness` verb the console can run, as fixed argv checked against the CLI's
 * own dispatcher (commands/metaharness.ts) and the plugin scripts it spawns. A read ($0, changes nothing) runs at once;
 * anything that writes, computes for minutes or may call a paid model asks first, and its confirm row says what it
 * costs. Two verbs need a path a fixed argv cannot carry (`learn --run`, `gepa --op analyze`): their button types the
 * command into the terminal instead. `flywheel promote` is not here at all: promotion is a policy act (ADR-322), so the
 * view shows its command and the person runs it. Pure: entries and parsers only, no `$`.
 */
import { exec, type ActionSpec } from './actions'
import { jsonAfter, type AuditTrend } from './data/cli'
import { rowsWith, type Findings } from './data/failure'
import { idOf, plain, recordOf } from './data/parse'
import { countOf, measureOf } from './data/safe'
import type { State } from './state'

/** `read`: $0, changes nothing. `writes`: $0, writes a file or memory. `local`: minutes of local compute that writes. `spends`: may call paid models. */
export type LabCost = 'read' | 'writes' | 'local' | 'spends'
export type LabGroup = 'inspect' | 'record' | 'evolve'

export type LabEntry = {
  id: string
  group: LabGroup
  /** The menu row's name, and what the row says it does. */
  name: string
  about: string
  /** The palette's line, and the confirm row's question. */
  label: string
  cost: LabCost
  /** The argv after the CLI prefix; a function when it needs the stored audits, null when it cannot run now. */
  args?: readonly string[] | ((state: State) => readonly string[] | null)
  /** Why `args` came back null, in the footer's words. */
  why?: string
  /** The command the button types into the terminal (ruflo harness), when the verb needs a path first. */
  types?: string
  note?: string
  timeoutMs?: number
  /** Its "found something" exits and answer shape (ActionSpec.findings). */
  findings?: Findings
}

export const LAB_GROUPS: readonly { id: LabGroup; title: string; right: string }[] = [
  { id: 'inspect', title: 'Lab · inspect', right: 'local · $0 · read-only · runs at once' },
  { id: 'record', title: 'Lab · record', right: '$0 · writes a file or memory · asks first' },
  { id: 'evolve', title: 'Lab · evolve & test', right: 'compute or models · asks first' },
]

const MH = 'metaharness'
const JSON_OUT = ['--format', 'json'] as const
// plugins/ruflo-metaharness/scripts/*.mjs (passed through by commands/metaharness.ts' dispatchPluginScript) print their
// JSON and then exit 1 when its `alert` triggered, and exit 2 on a real failure. Only three alert with the argv used here:
// mcp-scan and threat-model (--fail-on high by default) and drift-from-history (--threshold 0.95 by default). score,
// genome, audit-trend, similarity and oia-audit alert only with a flag this lab never passes, so they declare nothing.
// redblue also passes an upstream non-zero exit through after its JSON, so it declares nothing either.
const alertOf = (json: Record<string, unknown>) => recordOf(json.alert)
const alerted = (json: Record<string, unknown>) => alertOf(json)?.triggered === true
const MCP_SCAN_FOUND: Findings = { exits: [1], isAnswer: json => rowsWith(json.findings, ['severity']) && typeof alertOf(json)?.triggered === 'boolean', found: alerted }
const THREAT_FOUND: Findings = { exits: [1], isAnswer: json => typeof json.worst === 'string' && rowsWith(json.findings, []) && typeof alertOf(json)?.triggered === 'boolean' && typeof alertOf(json)?.worst === 'string', found: alerted }
const DRIFT_FOUND: Findings = { exits: [1], isAnswer: json => json.command === 'drift-from-history' && recordOf(json.baseline) !== null && recordOf(json.current) !== null && typeof alertOf(json)?.triggered === 'boolean', found: alerted }

/** The two newest stored audits' keys, oldest first, from the `audits` probe; null until there are two. */
export function auditKeys(state: State): [string, string] | null {
  const result = state.probes.get('audits')
  const trend = result === undefined || (result.error !== null && (result.errorAtMs ?? 0) >= (result.okAtMs ?? 0)) ? null : (result.value as AuditTrend | null)
  const keys = (trend?.points ?? []).flatMap(point => (point.key === undefined || idOf(point.key) === null ? [] : [point.key]))
  const older = keys[keys.length - 2]
  const newer = keys[keys.length - 1]

  return older === undefined || newer === undefined ? null : [older, newer]
}

const TWO_AUDITS = 'needs two stored audits (metaharness audit-list): run "MetaHarness audit (oia-audit)" twice'

export const LAB: readonly LabEntry[] = [
  { id: 'mh-score', group: 'inspect', name: 'SCORE', about: 'five readiness axes and the est. cost per run', label: 'score the harness now (metaharness score)', cost: 'read', args: [MH, 'score', ...JSON_OUT] },
  { id: 'mh-genome', group: 'inspect', name: 'GENOME', about: 'repo type, topology, risk, MCP surface, verdict', label: 'genome: the seven-section readiness report', cost: 'read', args: [MH, 'genome', ...JSON_OUT] },
  { id: 'mh-mcp-scan', group: 'inspect', name: 'MCP-SCAN', about: 'static findings on the MCP surface, by severity', label: 'mcp-scan: static MCP findings by severity', cost: 'read', args: [MH, 'mcp-scan', ...JSON_OUT], findings: MCP_SCAN_FOUND },
  { id: 'mh-threat', group: 'inspect', name: 'THREAT-MODEL', about: 'the worst severity, access flags and findings', label: 'threat-model: worst severity and its findings', cost: 'read', args: [MH, 'threat-model', ...JSON_OUT], findings: THREAT_FOUND },
  { id: 'mh-doctor', group: 'inspect', name: 'DOCTOR', about: 'is MetaHarness installed, its packages and scripts intact', label: 'doctor --component metaharness: installed and intact?', cost: 'read', args: ['doctor', '--component', MH] },
  { id: 'mh-trend', group: 'inspect', name: 'AUDIT-TREND', about: 'the newest stored audit against the one before', label: 'audit-trend: the newest audit against the one before', cost: 'read', args: state => { const keys = auditKeys(state); return keys === null ? null : [MH, 'audit-trend', '--baseline-key', keys[0], '--current-key', keys[1], ...JSON_OUT] }, why: TWO_AUDITS },
  { id: 'mh-similarity', group: 'inspect', name: 'SIMILARITY', about: 'how alike the newest two audits are, per dimension', label: 'similarity: the newest two audits, per dimension', cost: 'read', args: state => { const keys = auditKeys(state); return keys === null ? null : [MH, 'similarity', '--a-key', keys[0], '--b-key', keys[1], '--per-dimension', ...JSON_OUT] }, why: TWO_AUDITS },
  { id: 'mh-drift', group: 'inspect', name: 'DRIFT', about: 'a fresh audit against the newest stored one, not stored', label: 'drift-from-history: a fresh audit against the last (dry run)', cost: 'read', args: [MH, 'drift-from-history', '--dry-run', ...JSON_OUT], timeoutMs: 240_000, findings: DRIFT_FOUND },
  { id: 'mh-receipts', group: 'inspect', name: 'RECEIPTS', about: 'every flywheel evaluation receipt and its state', label: 'flywheel receipts: each evaluation receipt and its state', cost: 'read', args: [MH, 'flywheel', 'receipts'] },
  { id: 'mh-gepa-genome', group: 'inspect', name: 'GEPA GENOME', about: 'load and validate the shipped cand-6 genome', label: 'gepa genome: load and validate the shipped genome', cost: 'read', args: [MH, 'gepa', '--op', 'genome', ...JSON_OUT] },
  { id: 'mh-gepa-render', group: 'inspect', name: 'GEPA RENDER', about: 'the system prompt that genome compiles to', label: 'gepa render: the system prompt the genome compiles to', cost: 'read', args: [MH, 'gepa', '--op', 'render', ...JSON_OUT] },
  { id: 'mh-gepa-analyze', group: 'inspect', name: 'GEPA ANALYZE', about: 'failure classes in a transcript: type its path', label: 'gepa analyze: failure classes in a transcript file', cost: 'read', types: `${MH} gepa --op analyze --format json --transcript ` },
  { id: 'mh-bench-verify', group: 'inspect', name: 'BENCH VERIFY', about: 'check .metaharness/bench/suite.json is well-formed', label: 'bench verify: check .metaharness/bench/suite.json', cost: 'read', args: [MH, 'bench', '--op', 'verify', '--suite', '.metaharness/bench/suite.json', ...JSON_OUT] },
  { id: 'mh-evolve-plan', group: 'inspect', name: 'EVOLVE PLAN', about: 'what an evolution would run, without --confirm', label: 'evolve plan: what an evolution would run ($0 dry run)', cost: 'read', args: [MH, 'evolve', '--repo', '.', ...JSON_OUT] },
  { id: 'mh-learn-plan', group: 'inspect', name: 'LEARN PLAN', about: 'price a GEPA learning run, no model calls', label: 'learn dry run: price a GEPA learning run ($0)', cost: 'read', args: [MH, 'learn', ...JSON_OUT] },
  { id: 'mh-redblue-attack', group: 'inspect', name: 'REDBLUE ATTACKS', about: 'three prompt attacks it would send, no target called', label: 'redblue attack preview: three prompt attacks, nothing sent', cost: 'read', args: [MH, 'redblue', 'attack', 'prompt', '--count', '3', ...JSON_OUT] },
  { id: 'mh-redblue-mock', group: 'inspect', name: 'REDBLUE MOCK', about: 'ten attacks judged by the marker fixture, $0', label: 'redblue run, mock judge: ten tests at $0', cost: 'read', args: [MH, 'redblue', 'run', '--mock-judge', '--tests', '10', ...JSON_OUT], note: '$0: the mock judge is a marker fixture, no model is called' },
  { id: 'mh-audit', group: 'record', name: 'OIA AUDIT', about: 'oia + threat-model + mcp-scan, stored as one record', label: 'run a MetaHarness audit (oia-audit)', cost: 'writes', args: [MH, 'oia-audit', ...JSON_OUT], note: '$0, local: writes one record to memory namespace metaharness-audit', timeoutMs: 240_000 },
  { id: 'mh-bench-create', group: 'record', name: 'BENCH CREATE', about: 'scaffold a bench suite from this repo’s tests', label: 'bench create: scaffold .metaharness/bench/suite.json', cost: 'writes', args: [MH, 'bench', '--op', 'create', '--repo', '.', ...JSON_OUT], note: '$0, local: writes .metaharness/bench/suite.json' },
  { id: 'mh-redblue-init', group: 'record', name: 'REDBLUE INIT', about: 'a sample redblue.yaml, loopback targets only', label: 'redblue init: write a sample redblue.yaml here', cost: 'writes', args: [MH, 'redblue', 'init'], note: '$0: writes ./redblue.yaml' },
  { id: 'mh-redblue-real', group: 'evolve', name: 'REDBLUE JUDGED', about: 'ten attacks judged by a real model, capped at $3', label: 'redblue run with a real model judge (spends, capped at $3)', cost: 'spends', args: [MH, 'redblue', 'run', '--tests', '10', '--max-cost-usd', '3', ...JSON_OUT], note: 'COSTS MONEY: a real model judges each attack (OPENROUTER_API_KEY, redblue.yaml), capped at $3 by --max-cost-usd', timeoutMs: 600_000 },
  { id: 'mh-learn-run', group: 'evolve', name: 'LEARN RUN', about: 'a GEPA learning run on a slice: type its path', label: 'learn run: a GEPA learning run on a slice (spends)', cost: 'spends', types: `${MH} learn --run --format json --host claude-code --model haiku --slice `, note: 'COSTS MONEY: model calls and Docker sandboxes; needs a metaharness checkout' },
  { id: 'mh-evolve', group: 'evolve', name: 'EVOLVE', about: '3 generations × 3 children, each sandbox-scored', label: 'evolve: 3 generations × 3 children, sandbox-scored', cost: 'local', args: [MH, 'evolve', '--repo', '.', '--confirm', ...JSON_OUT], note: 'local, minutes: runs your test command for each of ~9 variants and writes .metaharness/; the deterministic mutator calls no model', timeoutMs: 600_000 },
  { id: 'mh-security-bench', group: 'evolve', name: 'SECURITY BENCH', about: 'Darwin Shield on a 10-vuln / 9-decoy corpus', label: 'security bench: Darwin Shield against four baselines', cost: 'spends', args: exec('metaharness_security_bench', {}), note: 'may call models: its B1 baseline is an LLM single pass; about 2-3 minutes', timeoutMs: 300_000 },
  { id: 'mh-flywheel-run', group: 'evolve', name: 'FLYWHEEL RUN', about: 'evaluate candidates into receipts, never promotes', label: 'flywheel run: evaluate candidates into receipts (local proposer)', cost: 'local', args: [MH, 'flywheel', 'run', '--proposer', 'local'], note: 'local: evaluates up to 40 harvested samples and writes receipts to .claude-flow/flywheel-v1; it never changes the champion', timeoutMs: 180_000 },
]

/** The confirm-free spec for a read, the asked one for the rest; null when the entry cannot run now (or only types). */
export function labSpec(entry: LabEntry, state: State): ActionSpec | null {
  const args = typeof entry.args === 'function' ? entry.args(state) : entry.args

  if (args === undefined || args === null) return null

  return {
    label: entry.label,
    args,
    expect: entry.cost === 'read' ? 'its output in the lab' : `its result in the lab${entry.note !== undefined ? `; ${entry.note}` : ''}`,
    lab: entry.id,
    ...(entry.cost === 'read' && { isReadOnly: true }),
    ...(entry.note !== undefined && { note: entry.note }),
    ...(entry.timeoutMs !== undefined && { timeoutMs: entry.timeoutMs }),
    ...(entry.findings !== undefined && { findings: entry.findings }),
  }
}

/** Why the palette has nothing to run for an entry. */
export const labWhy = (entry: LabEntry): string => (entry.types !== undefined ? `type it in the terminal (i): ruflo ${entry.types}<path>` : (entry.why ?? ''))

/** The exact promotion command, for the view and the docs: the console shows it and never runs it. */
export const PROMOTE_COMMAND = 'ruflo metaharness flywheel promote <receipt-id> --public-key <approved-ed25519.pem> --confirm'

export const LAB_MAX_LINES = 40

const SEVERITIES = ['critical', 'high', 'medium', 'low', 'info'] as const
const SKIP = new Set(['rawStdout', 'stdout', 'durationMs', 'generatedAt', 'schema', 'system'])

/** A number is shown only when it is a measurement (#3822): `1e999` parses as Infinity and `1e300` prints as "1e+300"; both read n/a. */
const scalar = (value: unknown): string | null => (value === null ? 'null' : typeof value === 'number' ? (measureOf(value) === undefined ? 'n/a' : String(value)) : typeof value === 'string' || typeof value === 'boolean' ? plain(String(value), 120) : null)
const tally = (value: unknown, fallback = 'n/a'): string => (value === undefined ? fallback : String(countOf(value) ?? 'n/a'))
/** A character count the CLI printed, when it is one (whole, 0..1e12): past that it is not a length, and the text's own length is used. */
const charsOf = (value: unknown): number | undefined => {
  const n = measureOf(value)

  return n !== undefined && n >= 0 ? Math.floor(n) : undefined
}
/** Any answer field as one cleaned cell: a number only when it is a measurement, anything else through plain() (#3822). */
const cell = (value: unknown, max: number): string => (typeof value === 'number' ? (measureOf(value) === undefined ? 'n/a' : String(value)) : plain(String(value ?? ''), max))

/** Any JSON as readable lines: scalars as `key: value`, short lists inline, objects indented, two levels deep. */
function flatten(value: unknown, out: string[], depth = 0): void {
  const pad = '  '.repeat(depth)
  const record = recordOf(value)

  if (Array.isArray(value)) {
    for (const item of value.slice(0, 8)) {
      const one = scalar(item)
      const fields = recordOf(item)

      out.push(`${pad}- ${one ?? (fields === null ? '…' : Object.entries(fields).flatMap(([key, field]) => (scalar(field) === null ? [] : [`${key} ${scalar(field)}`])).slice(0, 5).join(' · '))}`)
    }
    if (value.length > 8) out.push(`${pad}… ${value.length - 8} more`)

    return
  }

  if (record === null) return

  for (const [key, field] of Object.entries(record)) {
    if (SKIP.has(key) || out.length >= LAB_MAX_LINES) continue

    const one = scalar(field)

    if (one !== null) out.push(`${pad}${key}: ${one}`)
    else if (Array.isArray(field) && field.every(item => scalar(item) !== null)) out.push(`${pad}${key}: ${field.length === 0 ? '(none)' : field.map(scalar).join(', ')}`)
    else if (depth < 2) {
      out.push(`${pad}${key}:`)
      flatten(field, out, depth + 1)
    }
  }
}

/** Findings as the scan reports them: the worst, a count per severity, then each one. */
function findingLines(record: Record<string, unknown>, findings: unknown[]): string[] {
  const rows = findings.map(recordOf).filter((row): row is Record<string, unknown> => row !== null)
  const severityOf = (row: Record<string, unknown>) => String(row.severity ?? 'info').toLowerCase()
  const counts = SEVERITIES.map(level => `${level} ${rows.filter(row => severityOf(row) === level).length}`).join(' · ')
  const out = [`worst ${cell(record.worst ?? 'n/a', 20)}${record.verdict !== undefined ? ` · verdict ${cell(record.verdict, 20)}` : ''} · ${rows.length} finding${rows.length === 1 ? '' : 's'}`, `by severity: ${counts}`]

  for (const row of rows.slice(0, 12)) out.push(`[${severityOf(row)}] ${cell(row.title ?? row.message ?? row.id, 140)}`)

  const flags = ['secretsReachable', 'networkAccess', 'shellAccess', 'fileWrite', 'policyDefaultDeny', 'auditLog'].filter(flag => typeof record[flag] === 'boolean')

  if (flags.length > 0) out.push(flags.map(flag => `${flag} ${record[flag] === true ? 'yes' : 'no'}`).join(' · '))
  if (typeof record.allowedTools === 'number') out.push(`tools allowed ${tally(record.allowedTools)} · denied ${tally(record.deniedTools)}`)

  return out
}

/** A redblue run: tests, failures by severity, cost, the gates, then each compromised case. */
function redblueLines(record: Record<string, unknown>, summary: Record<string, unknown>): string[] {
  const out = [
    `tests ${tally(summary.tests_run)} · failures ${tally(summary.failures_found)} · critical ${tally(summary.critical, '0')} · high ${tally(summary.high, '0')} · med ${tally(summary.med, '0')} · low ${tally(summary.low, '0')}`,
    `cost $${measureOf(summary.cost_usd)?.toFixed(3) ?? 'n/a'} · gates ${record.gates_passed === true ? 'passed' : 'FAILED'} · block production ${record.should_block_production === true ? 'yes' : 'no'}`,
  ]

  for (const finding of (Array.isArray(record.findings) ? record.findings : []).map(recordOf)) {
    if (finding?.compromised === true) out.push(`✗ ${cell(finding.family ?? finding.testId, 60)} (${cell(finding.severity, 12)})`)
  }

  for (const tip of (Array.isArray(record.recommendations) ? record.recommendations : []).slice(0, 3)) out.push(`→ ${cell(tip, 140)}`)

  return out
}

/** One verb's JSON as lines worth reading; empty when nothing specific applies (the caller flattens it instead). */
function summary(value: unknown): string[] {
  const record = recordOf(value)

  if (Array.isArray(value)) {
    if (value.length === 0) return ['(none yet)']

    return value.slice(0, 20).map(item => {
      const row = recordOf(item)

      return row === null ? cell(item, 140) : `${cell(row.receiptId ?? row.id, 24)} · ${cell(row.decision, 20)} · ${cell(row.state, 20)}${row.signed === true ? ' · signed' : ''}`
    })
  }

  if (record === null) return []
  if (Array.isArray(record.findings) && record.worst !== undefined) return findingLines(record, record.findings)

  const red = recordOf(record.summary)

  if (red !== null && record.rates !== undefined) return redblueLines(record, red)

  // redblue attack: the cases come back as a JSON string inside `stdout`.
  if (record.subcommand === 'attack' && typeof record.stdout === 'string') {
    const cases = recordOf(jsonAfter(record.stdout))?.cases

    return (Array.isArray(cases) ? cases : []).map(recordOf).flatMap(row => (row === null ? [] : [`${cell(row.family, 32)} · ${cell(row.input ?? row.objective, 120)}`]))
  }

  if (typeof record.system === 'string') {
    return [`${charsOf(record.chars) ?? record.system.length} chars from ${cell(record.source ?? 'the genome', 200).split('/').pop() ?? ''}`, ...record.system.split('\n').map(line => plain(line, 160))]
  }

  const genome = recordOf(record.genome)

  if (genome !== null) {
    const meta = recordOf(genome.meta) ?? {}

    return [`valid ${record.valid === true ? 'yes' : 'NO'} · ${Array.isArray(record.errors) ? record.errors.length : 0} errors`, `genome ${cell(meta.id ?? 'n/a', 40)} (parent ${cell(meta.parent ?? 'n/a', 40)}, mutated ${cell(meta.mutated ?? 'n/a', 40)})`, `components: ${Object.keys(recordOf(genome.components) ?? {}).join(', ')}`]
  }

  return []
}

/** What a lab run printed, as at most LAB_MAX_LINES clean lines: its JSON read for what matters, else the text itself. */
export function labLines(id: string, stdout: string, stderr = ''): string[] {
  const json = jsonAfter(stdout)
  const out = json === null ? [] : summary(json)

  if (json !== null && out.length === 0) flatten(json, out)

  // Not JSON (doctor, a usage error): the text, without the CLI's banners and warnings.
  const raw = (text: string) =>
    text
      .split('\n')
      .map(line => plain(line, 160))
      .filter(line => line !== '' && !/^(\[WARN\]|Transformers\.js loaded|\[INFO\] Executing tool|\[OK\] Tool executed|─+$)/.test(line))
  const lines = out.length > 0 ? out : raw(stdout)

  return (lines.length > 0 ? lines : raw(stderr).length > 0 ? raw(stderr) : [`${id}: printed nothing`]).slice(0, LAB_MAX_LINES).map(line => plain(line, 160))
}

/** The headless answer for a lab run (`/ruflo run mh-genome`): its outcome line, its note, then what it printed. */
export function labAnswer(state: State, id: string | null, sinceMs: number): string | null {
  const result = state.lab.result

  if (result === null || result.atMs < sinceMs || (id !== null && result.id !== id)) return null

  return [`${result.ok ? '✓' : '✗'} ${result.label} · exit ${result.exitCode ?? 'n/a'}${result.note !== undefined ? ` · ${result.note}` : ''}`, ...result.lines.map(line => `  ${line}`)].join('\n')
}
