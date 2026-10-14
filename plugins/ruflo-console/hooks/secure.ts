/**
 * Security & Doctor: every `ruflo security`, AIDefence, policy and `doctor` verb the console can run, as fixed argv
 * checked against the CLI's own source (commands/security.ts, commands/doctor.ts, mcp-tools/security-tools.ts,
 * mcp-tools/policy-tools.ts). A read ($0, local, changes nothing) runs at once; a run that writes a file, or reaches the
 * network (npm audit, npm view, an npm install), asks first and says so on the confirm row. Results ride the lab's result
 * panel (`spec.lab`), each verb with its own reader; what a reader learns beyond lines (the severity counts, the doctor's
 * checks, the text in the field) is kept per State in this module. Pure: entries, validators and parsers, no `$`.
 */
import { ARGV_TEXT_MAX, countOf } from './full-text'
import { exec, type ActionSpec } from './actions'
import { jsonAfter } from './data/cli'
import { countsWith, rowsWith, type Findings } from './data/failure'
import { plain, recordOf } from './data/parse'
import { countOf as wholeCount, measureOf, ratioOf } from './data/safe'
import { labLines } from './mh-lab'
import type { State } from './state'

/** `read`: $0, local, changes nothing. `writes`: $0, local, writes a file. `network`: reaches the network (and may write). */
export type SecCost = 'read' | 'writes' | 'network'
export type SecGroup = 'scan' | 'doctor'
export type Severity = 'critical' | 'high' | 'medium' | 'low'
export const SEVERITIES: readonly Severity[] = ['critical', 'high', 'medium', 'low']

/** What a run printed, as lines for the result panel; `state` is where it keeps what the view draws beyond them. */
export type Reader = (stdout: string, stderr: string, state: State) => string[]

export type SecEntry = {
  id: string
  group: SecGroup
  name: string
  about: string
  label: string
  cost: SecCost
  args: readonly string[]
  read: Reader
  note?: string
  timeoutMs?: number
  /** Its "found something" exits and answer shape (ActionSpec.findings), from commands/security.ts. */
  findings?: Findings
}

/** A verb that takes the field's text: its id is its palette keyword, so `/ruflo run aid-check <text>` reads the text. */
export type SecText = { id: string; name: string; about: string; label: string; cost: SecCost; argv: (text: string) => readonly string[] | null; read: Reader; note?: string; rule: string; findings?: Findings }

export type Check = { status: 'pass' | 'warn' | 'fail'; name: string; message: string }

/** What the view draws beyond the result lines: the last findings by severity, the last doctor checks, the field's text. */
export type SecMemo = { findings: SecFindings | null; doctor: { label: string; checks: Check[]; atMs: number } | null; draft: string }

/**
 * Counts by severity. `unreadable` names the levels whose count the tool printed but no reader can trust, and `isTotalUnknown` says the same of
 * the total (#3822): unknown, never a measured 0. An unknown level's `counts` entry is only a lower bound (the findings listed at that level).
 */
export type SecFindings = { source: string; counts: Record<Severity, number>; unreadable?: readonly Severity[]; isTotalUnknown?: boolean; atMs: number }

/** One level's count as text: `?` when it was unreadable, `≥n ?` when n findings of that level were listed. */
export const countText = (findings: SecFindings, level: Severity): string => {
  if (!(findings.unreadable ?? []).includes(level)) return String(findings.counts[level])

  return findings.counts[level] > 0 ? `≥${findings.counts[level]} ?` : '?'
}

/** What the band says about the last findings: high or critical ones, or that the counts could not be read. Null when there is nothing to warn of. */
export function securityBand(findings: SecFindings | null): { text: string; compact: string; isAttention: boolean } | null {
  if (findings === null) return null

  const serious = findings.counts.critical + findings.counts.high
  const isUnknown = (findings.unreadable ?? []).length > 0 || findings.isTotalUnknown === true
  const more = isUnknown ? '+' : ''

  if (serious > 0) return { text: `🔒 ${serious}${more} high or critical`, compact: `🔒 ${serious}${more}`, isAttention: findings.counts.critical > 0 || isUnknown }

  return isUnknown ? { text: '🔒 security counts unreadable', compact: '🔒 ?', isAttention: true } : null
}

const memos = new WeakMap<State, SecMemo>()

export function secMemo(state: State): SecMemo {
  const held = memos.get(state)

  if (held !== undefined) return held

  const fresh: SecMemo = { findings: null, doctor: null, draft: '' }

  memos.set(state, fresh)

  return fresh
}

const zero = (): Record<Severity, number> => ({ critical: 0, high: 0, medium: 0, low: 0 })
const levelOf = (value: unknown): Severity | null => {
  const word = String(value ?? '').toLowerCase()

  return word === 'critical' || word === 'high' || word === 'medium' || word === 'low' ? word : word === 'med' ? 'medium' : null
}

/** The field's text as one argv value: 1-8000 printable characters, not starting with `-` (the CLI would read a flag). */
export function pastedOf(text: string): string | null {
  const value = text.trim()

  // Line breaks and tabs are text (argv and JSON carry them); other controls are refused. Over ARGV_TEXT_MAX: null, and the runner says by how much.
  return value.length >= 1 && countOf(value) <= ARGV_TEXT_MAX && !value.startsWith('-') && !/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/.test(value) ? value : null
}

/** A policy action type (`deploy`, `tool:Bash`, `network.fetch`): 1-64 of letters, digits, `_ . : / -`, not starting with `-`. */
export const actionTypeOf = (text: string): string | null => (/^[A-Za-z0-9_.:/][A-Za-z0-9_.:/-]{0,63}$/.test(text.trim()) ? text.trim() : null)

/** A CLI run's output without its banners, spinners, rules and table borders; table rows read `a · b · c`. */
export function textLines(stdout: string, stderr = ''): string[] {
  const lines = (text: string) =>
    text
      .split('\n')
      .map(line => plain(line, 200))
      .filter(line => line !== '' && !/^(\[WARN\]|\[INFO\] Executing tool|\[OK\] Tool executed|Parameters:|Transformers\.js loaded|[─═+-]+$|\+[-+]*\+?$|Created with)/.test(line))
      .map(line => (line.startsWith('|') ? line.split('|').map(cell => cell.trim()).filter(Boolean).join(' · ') : line))
      .map(line => plain(line, 160))
  const out = lines(stdout)

  return (out.length > 0 ? out : lines(stderr)).slice(0, 60)
}

/** `security scan --output json`: the counts by severity (kept for the meter), then each finding. */
export const scanReader: Reader = (stdout, stderr, state) => {
  const record = recordOf(jsonAfter(stdout))
  const summary = recordOf(record?.summary)

  if (record === null || summary === null) return textLines(stdout, stderr)

  const findings = (Array.isArray(record.findings) ? record.findings : []).map(recordOf).filter(row => row !== null)
  const listed = zero()
  const counts = zero()
  const unreadable: Severity[] = []

  for (const row of findings) listed[levelOf(row.severity) ?? 'low'] += 1

  // A count is whole, non-negative and capped where it is read (#3822): `1e999` parses as Infinity. Every count, and the total, is at least what
  // was listed, so a summary that under-reports cannot hide a finding or read CLEAN beside one. A count the tool printed but no reader can trust
  // stays UNKNOWN (the listed findings are only its lower bound), and the result, the page and the band all say so.
  for (const level of SEVERITIES) {
    const raw = summary[level]
    const count = wholeCount(raw)

    counts[level] = Math.max(count ?? 0, listed[level])
    if (count === undefined && raw !== undefined) unreadable.push(level)
  }

  const readTotal = wholeCount(summary.total)
  const isTotalUnknown = readTotal === undefined && summary.total !== undefined
  const total = Math.max(readTotal ?? 0, findings.length)
  const memo: SecFindings = { source: `scan ${plain(String(record.type ?? ''), 8)} ${plain(String(record.depth ?? ''), 10)}`.trim(), counts, ...(unreadable.length > 0 && { unreadable }), ...(isTotalUnknown && { isTotalUnknown }), atMs: Date.now() }

  secMemo(state).findings = memo

  const isUnknown = unreadable.length > 0 || isTotalUnknown
  const head = counts.critical + counts.high > 0 ? 'ATTENTION' : isUnknown ? 'COUNTS UNREADABLE' : total === 0 ? 'CLEAN' : 'REVIEW'
  const totalText = isTotalUnknown ? `${total > 0 ? `≥${total} ` : ''}? findings (total unreadable)` : `${total} finding${total === 1 ? '' : 's'}`

  return [
    `${head} · ${totalText} · depth ${plain(String(record.depth ?? 'n/a'), 10)} · type ${plain(String(record.type ?? 'n/a'), 8)}`,
    `by severity: ${SEVERITIES.map(level => `${level} ${countText(memo, level)}`).join(' · ')}${unreadable.length > 0 ? ` (counts unreadable: ${unreadable.join(', ')}; a listed finding is a lower bound)` : ''}`,
    ...findings.slice(0, 30).map(row => `[${levelOf(row.severity) ?? 'low'}] ${plain(String(row.type ?? ''), 40)} · ${plain(String(row.location ?? ''), 60)} · ${plain(String(row.description ?? ''), 80)}`),
    ...(findings.length > 30 ? [`… ${findings.length - 30} more`] : []),
  ]
}

/** A confidence as ` 87%`, clamped to 0..100; empty when it is not a finite number (`1e999` would draw "Infinity%") (#3822). */
const percent = (value: unknown): string => {
  const ratio = ratioOf(value)

  return ratio === undefined ? '' : ` ${Math.round(ratio * 100)}%`
}

/** One verdict object (defend, aidefence_scan, channel-scan, scan-plan): the verdict first, so an exit 1 reads right. */
function verdictLines(record: Record<string, unknown>, source: string, state: State): string[] | null {
  const threats = (Array.isArray(record.threats) ? record.threats : Array.isArray(record.findings) ? record.findings : null)?.map(recordOf).filter(row => row !== null) ?? null
  const isSafe = typeof record.safe === 'boolean' ? record.safe : null

  if (threats === null && isSafe === null) return null

  const counts = zero()

  for (const row of threats ?? []) counts[levelOf(row.severity) ?? 'low'] += 1
  if (threats !== null) secMemo(state).findings = { source, counts, atMs: Date.now() }

  const pii = record.piiFound ?? record.piiDetected ?? record.hasPII
  const worst = SEVERITIES.find(level => counts[level] > 0)
  const head = [
    isSafe === false || (threats?.length ?? 0) > 0 ? 'UNSAFE' : pii === true ? 'PII FOUND' : 'SAFE',
    threats === null ? null : `${threats.length} threat${threats.length === 1 ? '' : 's'}${worst !== undefined ? ` (worst ${worst})` : ''}`,
    typeof pii === 'boolean' ? `PII ${pii ? 'yes' : 'no'}` : null,
    record.gateFire === true ? 'gate fires' : null,
  ].filter(part => part !== null)

  return [
    head.join(' · '),
    ...(threats ?? []).slice(0, 20).map(row => `[${levelOf(row.severity) ?? 'low'}] ${plain(String(row.type ?? row.kind ?? ''), 32)}${percent(row.confidence)} · ${plain(String(row.description ?? row.reason ?? ''), 110)}`),
  ]
}

/** `security defend|channel-scan|scan-plan --format json`: their JSON is the whole stdout after a banner. */
const verdictReader =
  (source: string): Reader =>
  (stdout, stderr, state) => {
    const record = recordOf(jsonAfter(stdout))

    return (record === null ? null : verdictLines(record, source, state)) ?? textLines(stdout, stderr)
  }

/**
 * An `mcp exec` result. `mcp exec` echoes its parameters (the pasted text) above `Result:`, so this reads only the
 * Result JSON, unwraps `content[0].text`, and never falls back to the raw output.
 */
export const mcpReader =
  (source: string): Reader =>
  (stdout, _stderr, state) => {
    const result = recordOf(jsonAfter(stdout))

    if (result === null) return [`${source}: no Result JSON in the output (the CLI's own lines are not shown: they echo the text)`]

    const content = Array.isArray(result.content) ? recordOf(result.content[0]) : null
    const inner = typeof content?.text === 'string' ? recordOf(jsonAfter(content.text)) : result

    if (inner === null) return [`${source}: ${plain(String(content?.text ?? ''), 160)}`]
    if (typeof inner.error === 'string') return [`error: ${plain(inner.error, 200)}`]

    return verdictLines(inner, source, state) ?? labLines(source, JSON.stringify(inner))
  }

/** `security composition-scan --format json`: how many suspects, then the strongest. */
export const compositionReader: Reader = (stdout, stderr) => {
  const record = recordOf(jsonAfter(stdout))
  const suspects = (Array.isArray(record?.suspects) ? record.suspects : null)?.map(recordOf).filter(row => row !== null)

  if (suspects === undefined) return textLines(stdout, stderr)

  return [`${suspects.length} suspect${suspects.length === 1 ? '' : 's'} in the CLI's registered MCP tool descriptions`, ...suspects.slice(0, 25).map(row => `${plain(String(row.tool ?? ''), 32)} · ${measureOf(row.score)?.toFixed(2) ?? 'n/a'} · ${plain(String(row.reason ?? ''), 100)}`)]
}

/** Doctor's `✓|⚠|✗ Name: message` rows (colours stripped), its summary, and anything after them (suggested fixes). */
export function parseDoctor(stdout: string): { checks: Check[]; rest: string[] } {
  const checks: Check[] = []
  const rest: string[] = []

  for (const raw of stdout.split('\n')) {
    const line = plain(raw, 240)
    const match = /^([✓⚠✗])\s+([^:]{1,80}):\s*(.*)$/.exec(line)

    if (match !== null) checks.push({ status: match[1] === '✓' ? 'pass' : match[1] === '⚠' ? 'warn' : 'fail', name: match[2] ?? '', message: plain(match[3] ?? '', 160) })
    else if (line !== '' && !/^(RuFlo Doctor|System diagnostics|[─═-]+$|Summary:|All checks passed)/.test(line)) rest.push(plain(line, 160))
  }

  return { checks, rest }
}

export const doctorReader =
  (label: string): Reader =>
  (stdout, stderr, state) => {
    const { checks, rest } = parseDoctor(stdout)

    if (checks.length === 0) return textLines(stdout, stderr)

    secMemo(state).doctor = { label, checks, atMs: Date.now() }

    const count = (status: Check['status']) => checks.filter(check => check.status === status).length

    return [`${count('pass')} passed · ${count('warn')} warnings · ${count('fail')} failed`, ...checks.map(check => `${check.status === 'pass' ? '✓' : check.status === 'warn' ? '⚠' : '✗'} ${check.name}: ${check.message}`), ...rest.slice(0, 20)]
  }

/** Doctor components that check this machine without the network (`version` asks npm; `typescript` may npx tsc). */
export const DOCTOR_COMPONENTS = ['node', 'npm', 'git', 'config', 'daemon', 'memory', 'mcp', 'aidefence', 'disk', 'helpers', 'mods', 'claude'] as const

const LOCAL = '$0, local: reads only'
// What each verb exits with when it found something, and its answer's shape, checked in commands/security.ts:
// `scan` returns success false (exit 1) on a critical or high finding after printing {summary, findings}; `defend` exits 1
// when unsafe or PII is found, after {safe, threats, piiFound}; `channel-scan` exits 2 when flagged after {safe, findings,
// stats} and `scan-plan` exits 2 when its gate fires after {safe, findings, stats, gateFire} (their exit 1 is a usage
// error). `secrets` also exits 1 on a finding but prints text only, so it declares nothing: its exit 1 still reads as failed.
const SEV = ['critical', 'high', 'medium', 'low', 'total'] as const
const SCAN_FOUND: Findings = {
  exits: [1],
  isAnswer: json => rowsWith(json.findings, ['severity', 'type']) && countsWith(json.summary, SEV),
  found: json => (json.findings as unknown[]).length > 0 && Number(recordOf(json.summary)?.critical) + Number(recordOf(json.summary)?.high) > 0,
}
const DEFEND_FOUND: Findings = {
  exits: [1],
  isAnswer: json => typeof json.safe === 'boolean' && typeof json.piiFound === 'boolean' && rowsWith(json.threats, ['type', 'severity']),
  found: json => json.safe === false || json.piiFound === true,
}
const channelShape = (json: Record<string, unknown>) => typeof json.safe === 'boolean' && rowsWith(json.findings, ['kind', 'severity', 'reason']) && recordOf(json.stats) !== null
const CHANNEL_FOUND: Findings = { exits: [2], isAnswer: channelShape, found: json => json.safe === false }
const PLAN_FOUND: Findings = { exits: [2], isAnswer: json => channelShape(json) && typeof json.gateFire === 'boolean', found: json => json.gateFire === true }
const SCAN_FILE = (depth: string) => `$0, local: writes .claude/security-scans/scan-code-${depth}.json (the statusline reads it)`
const NPM_AUDIT = 'reaches the network: npm audit sends this project’s dependency tree to the npm registry'

export const SECURE: readonly SecEntry[] = [
  { id: 'sec-scan-quick', group: 'scan', name: 'SCAN QUICK', about: 'secrets in source files, local; writes its report', label: 'security scan, quick: secrets in files (writes a report)', cost: 'writes', args: ['security', 'scan', '--depth', 'quick', '--type', 'code', '--output', 'json'], read: scanReader, findings: SCAN_FOUND, note: SCAN_FILE('quick'), timeoutMs: 120_000 },
  { id: 'sec-scan-deep', group: 'scan', name: 'SCAN DEEP', about: 'secrets and code patterns, the whole tree, local', label: 'security scan, deep: secrets and code patterns (writes a report)', cost: 'writes', args: ['security', 'scan', '--depth', 'deep', '--type', 'code', '--output', 'json'], read: scanReader, findings: SCAN_FOUND, note: SCAN_FILE('deep'), timeoutMs: 240_000 },
  { id: 'sec-scan-all', group: 'scan', name: 'SCAN + DEPS', about: 'code plus npm audit of the dependencies', label: 'security scan with dependencies (npm audit, network)', cost: 'network', args: ['security', 'scan', '--depth', 'standard', '--type', 'all', '--output', 'json'], read: scanReader, findings: SCAN_FOUND, note: `${NPM_AUDIT}; writes .claude/security-scans/scan-all-standard.json`, timeoutMs: 240_000 },
  { id: 'sec-cve', group: 'scan', name: 'CVE', about: 'known CVEs in the dependency tree (npm audit)', label: 'security cve --list: CVEs in the dependency tree (network)', cost: 'network', args: ['security', 'cve', '--list'], read: (out, err) => textLines(out, err), note: NPM_AUDIT, timeoutMs: 90_000 },
  { id: 'sec-threats', group: 'scan', name: 'THREATS', about: 'STRIDE threat indicators in this tree', label: 'security threats: STRIDE indicators here', cost: 'read', args: ['security', 'threats'], read: (out, err) => textLines(out, err), note: LOCAL },
  { id: 'sec-secrets', group: 'scan', name: 'SECRETS', about: 'secret patterns by type and file, values masked', label: 'security secrets: secret patterns by file (values masked)', cost: 'read', args: ['security', 'secrets'], read: (out, err) => textLines(out, err), note: LOCAL },
  { id: 'sec-audit', group: 'scan', name: 'AUDIT LOG', about: 'the security audit trail from .swarm/', label: 'security audit: the audit trail', cost: 'read', args: ['security', 'audit'], read: (out, err) => textLines(out, err), note: LOCAL },
  { id: 'sec-composition', group: 'scan', name: 'MCP COMPOSITION', about: 'cross-tool injection in MCP tool descriptions', label: 'security composition-scan: injection across MCP tool descriptions', cost: 'read', args: ['security', 'composition-scan', '--format', 'json'], read: compositionReader, note: LOCAL },
  { id: 'aid-stats', group: 'scan', name: 'AIDEFENCE STATS', about: 'detections, learned patterns, mitigations', label: 'AIDefence statistics (security defend --stats)', cost: 'read', args: ['security', 'defend', '--stats'], read: (out, err) => textLines(out, err), note: LOCAL },
  { id: 'policy-status', group: 'scan', name: 'POLICY', about: 'policy mode, rules, budgets and ledger integrity', label: 'policy status: mode, rules, budgets, ledger', cost: 'read', args: exec('policy_status', {}), read: mcpReader('policy'), note: `${LOCAL} (mcp exec appends a policy receipt, as every exec does)` },
  { id: 'doc-all', group: 'doctor', name: 'DOCTOR', about: 'every health check', label: 'doctor: every health check (asks npm for the newest version)', cost: 'network', args: ['doctor'], read: doctorReader('doctor'), note: 'reaches the network: the version check runs npm view @claude-flow/cli (5 s); every other check is local', timeoutMs: 120_000 },
  { id: 'doc-fix', group: 'doctor', name: 'DOCTOR --FIX', about: 'every check plus the fix for each warning', label: 'doctor --fix: every check and its suggested fix', cost: 'network', args: ['doctor', '--fix'], read: doctorReader('doctor --fix'), note: 'reaches the network (npm view); prints fix commands without running them, and may write .claude-flow/memory-package.json to repair the Learning Bridge', timeoutMs: 120_000 },
  ...DOCTOR_COMPONENTS.map(component => ({ id: `doc-${component}`, group: 'doctor' as const, name: component.toUpperCase(), about: `doctor --component ${component}`, label: `doctor --component ${component}`, cost: 'read' as const, args: ['doctor', '--component', component], read: doctorReader(`doctor -c ${component}`), note: LOCAL, timeoutMs: 60_000 })),
]

const AID_MCP = 'may reach the network: if @claude-flow/aidefence is missing the tool tries npm install once (offline it fails); else local, $0'
const asInput = (tool: string) => (text: string) => {
  const input = pastedOf(text)

  return input === null ? null : exec(tool, { input })
}
const PASTE_RULE = '1-8000 printable characters, not starting with -'

export const SECURE_TEXT: readonly SecText[] = [
  { id: 'aid-check', name: 'CHECK', about: 'prompt injection, jailbreak and PII, built-in engine', label: 'aid-check <text>: injection and PII check, local', cost: 'read', argv: text => (pastedOf(text) === null ? null : ['security', 'defend', '--input', pastedOf(text) ?? '', '--output', 'json']), read: verdictReader('defend'), findings: DEFEND_FOUND, note: LOCAL, rule: PASTE_RULE },
  { id: 'aid-quick', name: 'QUICK', about: 'the fast pattern pass only', label: 'aid-quick <text>: quick injection check, local', cost: 'read', argv: text => (pastedOf(text) === null ? null : ['security', 'defend', '--input', pastedOf(text) ?? '', '--quick', '--output', 'json']), read: verdictReader('defend --quick'), findings: DEFEND_FOUND, note: LOCAL, rule: PASTE_RULE },
  { id: 'aid-channel', name: 'CHANNEL', about: 'an inter-agent message: injection and encoded payloads', label: 'aid-channel <text>: scan it as an agent message, local', cost: 'read', argv: text => (pastedOf(text) === null ? null : ['security', 'channel-scan', '--message', pastedOf(text) ?? '', '--format', 'json']), read: verdictReader('channel-scan'), findings: CHANNEL_FOUND, note: LOCAL, rule: PASTE_RULE },
  { id: 'aid-plan', name: 'PLAN', about: 'an agent plan: injected steps (PlanFlip gate)', label: 'aid-plan <text>: scan it as an agent plan, local', cost: 'read', argv: text => (pastedOf(text) === null ? null : ['security', 'scan-plan', '--plan', pastedOf(text) ?? '', '--format', 'json']), read: verdictReader('scan-plan'), findings: PLAN_FOUND, note: LOCAL, rule: PASTE_RULE },
  { id: 'aid-scan', name: 'MCP SCAN', about: 'aidefence_scan: the adaptive engine’s full scan', label: 'aid-scan <text>: aidefence_scan (MCP)', cost: 'network', argv: asInput('aidefence_scan'), read: mcpReader('aidefence_scan'), note: AID_MCP, rule: PASTE_RULE },
  { id: 'aid-safe', name: 'IS SAFE', about: 'aidefence_is_safe: one yes or no', label: 'aid-safe <text>: aidefence_is_safe (MCP)', cost: 'network', argv: asInput('aidefence_is_safe'), read: mcpReader('aidefence_is_safe'), note: AID_MCP, rule: PASTE_RULE },
  { id: 'aid-pii', name: 'HAS PII', about: 'aidefence_has_pii: emails, keys, SSNs, passwords', label: 'aid-pii <text>: aidefence_has_pii (MCP)', cost: 'network', argv: asInput('aidefence_has_pii'), read: mcpReader('aidefence_has_pii'), note: AID_MCP, rule: PASTE_RULE },
  { id: 'aid-analyze', name: 'ANALYZE', about: 'aidefence_analyze: threat types and mitigations', label: 'aid-analyze <text>: aidefence_analyze (MCP)', cost: 'network', argv: asInput('aidefence_analyze'), read: mcpReader('aidefence_analyze'), note: AID_MCP, rule: PASTE_RULE },
  {
    id: 'policy-eval',
    name: 'POLICY EVAL',
    about: 'would policy allow this action type for a user?',
    label: 'policy-eval <action type>: evaluate it against the policy (writes a receipt)',
    cost: 'writes',
    argv: text => {
      const type = actionTypeOf(text)

      return type === null ? null : ['mcp', 'exec', '-t', 'policy_evaluate', '-p', JSON.stringify({ request: { identity: { id: 'ruflo-console', type: 'user' }, action: { type } } })]
    },
    read: mcpReader('policy'),
    note: '$0, local: appends a tamper-evident decision receipt under .claude-flow/policy/',
    rule: 'an action type: 1-64 of letters, digits, _ . : / - (deploy, tool:Bash, network.fetch)',
  },
]

/** The palette keywords of the text verbs, for `filterPalette`. */
export const SECURE_KEYWORDS: readonly string[] = SECURE_TEXT.map(entry => entry.id)

/** An entry as the runner's spec: a read runs at once, the rest ask with their note on the confirm row. */
export function secSpec(entry: { id: string; label: string; cost: SecCost; read: Reader; note?: string; timeoutMs?: number; findings?: Findings }, args: readonly string[], state: State): ActionSpec {
  return {
    label: entry.label,
    args,
    expect: entry.cost === 'read' ? 'its output in the result panel' : `its result in the result panel${entry.note !== undefined ? `; ${entry.note}` : ''}`,
    lab: entry.id,
    lines: (stdout, stderr) => entry.read(stdout, stderr, state),
    ...(entry.cost === 'read' && { isReadOnly: true }),
    ...(entry.note !== undefined && { note: entry.note }),
    timeoutMs: entry.timeoutMs ?? 90_000,
    ...(entry.findings !== undefined && { findings: entry.findings }),
  }
}

/** A text verb's spec for `text`, or null when the text does not pass its rule. */
export function secTextSpec(entry: SecText, text: string, state: State): ActionSpec | null {
  const args = entry.argv(text)

  return args === null ? null : secSpec(entry, args, state)
}

/** Is a lab result one of this view's? */
export const isSecureResult = (id: string): boolean => id.startsWith('anatole-') || SECURE.some(entry => entry.id === id) || SECURE_TEXT.some(entry => entry.id === id)
