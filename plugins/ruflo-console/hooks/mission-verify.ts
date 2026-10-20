/**
 * Verify (ADR-443 §2.2): a task is done with evidence. Gates are the person's own commands, kept as a fixed argv (no shell, no quoting);
 * running one asks first, and its exit code and a short output summary are recorded as an `evidence.gate` event. The verdict is read
 * back from those events only. Pure: data in, data out.
 */
import type { ActionSpec } from './actions'
import { errorLine } from './data/failure'
import { plain } from './data/parse'
import type { MissionRecord } from './mission-types'

export type Gate = { id: string; label: string; argv: readonly string[] }
export type GateResult = { exitCode: number | null; stdout: string; stderr: string }
export type GateEvent = { type: 'evidence.gate'; taskId?: string; status: 'passed' | 'failed' | 'unknown'; note: string; evidenceRef: string }
export type Verdict = { state: 'verified' | 'failed' | 'unverified' | 'no-gates'; passed: number; failed: number; detail: string }

export const MAX_GATES = 4
export const MAX_GATE_CHARS = 200

const SHELL_SYNTAX = /[;|&<>`]|\$\(/
const CONTROL = /[\u0000-\u001f\u007f-\u009f]/
/** A setting value is one line, so a literal backslash-n also separates lines. */
const LINE_BREAK = /\r?\n|\\n/

/** A short stable id from the argv (FNV-1a, base 36): the same command is the same gate across restarts. */
function gateId(argv: readonly string[]): string {
  let hash = 0x811c9dc5

  for (const char of argv.join('\u0000')) {
    hash = Math.imul(hash ^ char.codePointAt(0)!, 0x01000193) >>> 0
  }

  return `g${hash.toString(36)}`
}

/** Why a line cannot be a gate, or null when it can. */
function refusal(line: string): string | null {
  if (line.length > MAX_GATE_CHARS) return `longer than ${MAX_GATE_CHARS} characters`
  if (CONTROL.test(line)) return 'contains a control character'
  if (SHELL_SYNTAX.test(line)) return 'contains shell syntax (; | & > < ` $( ): a gate is a command and its words, run without a shell'
  if (line.includes('  ')) return 'has two spaces in a row: words are split on single spaces'
  if (line.startsWith('-')) return 'starts with “-”: the first word must be the program'

  return null
}

/** The setting text as gates: up to 4 lines, one command each, split on single spaces. Refused lines are reported with why, never run. */
export function parseGates(text: unknown): { gates: Gate[]; rejected: { line: string; why: string }[] } {
  const gates: Gate[] = []
  const rejected: { line: string; why: string }[] = []

  if (typeof text !== 'string') return { gates, rejected }

  for (const raw of text.split(LINE_BREAK)) {
    const line = raw.replace(/^ +| +$/g, '')

    if (line === '') continue

    const shown = plain(line, 80)
    const why = refusal(line)

    if (why !== null) {
      rejected.push({ line: shown, why })
      continue
    }

    const argv = line.split(' ')
    const id = gateId(argv)

    if (gates.some(gate => gate.id === id)) rejected.push({ line: shown, why: 'the same command is already a gate' })
    else if (gates.length >= MAX_GATES) rejected.push({ line: shown, why: `only the first ${MAX_GATES} gates are kept` })
    else gates.push({ id, label: plain(line, 80), argv })
  }

  return { gates, rejected }
}

/**
 * The confirm-gated run of one gate. `baseSpec` carries the runner plumbing (`run`, `scope`, `timeoutMs`); it can never change the
 * argv, the label or the read-only flag: a gate is the person's own command and always asks first.
 */
export function gateSpec(gate: Gate, baseSpec: Partial<ActionSpec> = {}): ActionSpec {
  return {
    scope: 'controls',
    note: 'Runs your own command in this project’s directory, without a shell. What it does (files, network, time) is up to the command; its exit code and a short output summary are recorded as evidence on the mission.',
    ...baseSpec,
    label: `run gate: ${gate.label}`,
    args: [],
    argv: [...gate.argv],
    shows: gate.argv.join(' '),
    expect: 'its exit code and output summary are recorded as evidence on the task',
    isReadOnly: false,
  }
}

const linesOf = (text: string): string[] => text.split(/\r?\n/).filter(line => line.trim() !== '')
const refOf = (value: string): string => value.replace(/[^A-Za-z0-9_-]/g, '') || 'gate'

/** What a finished gate run is recorded as: pass on exit 0, fail on any other exit, unknown when there was no exit code. */
export function evidenceEvent(gate: Gate, result: GateResult, taskId?: string): GateEvent {
  const code = typeof result.exitCode === 'number' && Number.isInteger(result.exitCode) ? result.exitCode : null
  const lines = [...linesOf(String(result.stdout ?? '')), ...linesOf(String(result.stderr ?? ''))]
  // A failed gate names the line that says why (an `[ERROR]` line, one naming an error), never a `[WARN]` banner printed first.
  const failedWith = code === null || code === 0 ? null : errorLine(String(result.stderr ?? '')) ?? errorLine(String(result.stdout ?? ''))
  const first = plain(failedWith ?? linesOf(String(result.stdout ?? ''))[0] ?? linesOf(String(result.stderr ?? ''))[0] ?? '', 120)
  const size = lines.length === 0 ? 'no output' : `${lines.length} ${lines.length === 1 ? 'line' : 'lines'} of output`
  const head = code === null ? 'no exit code (it did not finish)' : `exit ${code}`

  return {
    type: 'evidence.gate',
    ...(taskId !== undefined && { taskId }),
    status: code === null ? 'unknown' : code === 0 ? 'passed' : 'failed',
    note: `${head}, ${size}${first === '' ? '' : `: ${first}`}`,
    evidenceRef: `gate:${refOf(gate.id)}:${code === null ? 'none' : code}`,
  }
}

const GATE_OF_REF = /^gate:([^:]+):/

/**
 * Read from `evidence.gate` events for the task, since its latest `task.dispatched` (a new start wipes older evidence). Order rule:
 * each gate counts by its NEWEST result (highest seq), so a pass newer than that gate's failures clears it, and a failure newer than
 * its pass fails it again. Verified = at least one gate and every gate's newest result is a pass. Any failed gate = failed. Anything
 * else (unknown exit, or a configured gate that has not run) = unverified. `gates`, when given, is the configured list: with none the
 * answer is 'no-gates', and only evidence from those gates counts. Without it, no gate evidence at all reads 'no-gates'.
 */
export function verdictOf(mission: MissionRecord, taskId: string, gates?: readonly Gate[]): Verdict {
  if (gates !== undefined && gates.length === 0) return { state: 'no-gates', passed: 0, failed: 0, detail: 'no gates are set: nothing was checked' }

  const mine = mission.events.filter(event => event.taskId === taskId)
  const start = mine.reduce((latest, event) => (event.type === 'task.dispatched' && event.seq > latest ? event.seq : latest), -1)
  const newest = new Map<string, { seq: number; status: string }>()

  for (const event of mine) {
    if (event.type !== 'evidence.gate' || event.seq <= start) continue

    const key = GATE_OF_REF.exec(event.evidenceRef ?? '')?.[1] ?? '?'
    const seen = newest.get(key)

    if (seen === undefined || event.seq >= seen.seq) newest.set(key, { seq: event.seq, status: event.status ?? 'unknown' })
  }

  const counted = gates === undefined ? [...newest.entries()] : gates.map((gate): [string, { seq: number; status: string } | undefined] => [gate.id, newest.get(gate.id)])

  if (counted.length === 0) return { state: 'no-gates', passed: 0, failed: 0, detail: 'no gate has run for this task' }

  const passed = counted.filter(([, seen]) => seen?.status === 'passed').length
  const failed = counted.filter(([, seen]) => seen?.status === 'failed').length
  const open = counted.length - passed - failed

  if (failed > 0) return { state: 'failed', passed, failed, detail: `${failed} of ${counted.length} gates failed on their latest run` }
  if (open === 0) return { state: 'verified', passed, failed, detail: `${passed} of ${counted.length} gates passed on their latest run` }

  return { state: 'unverified', passed, failed, detail: `${passed} of ${counted.length} gates passed; ${open} ${open === 1 ? 'has' : 'have'} not run or gave no exit code` }
}

/** The Settings row for the gates: free text (up to 4 lines), shaped like LOOP_ROWS; its value lives beside the loop preferences as `loopGates`. */
export const GATES_ROW = {
  id: 'loop-gates',
  kind: 'text',
  title: 'Mission gates',
  description: 'your own check commands, up to 4 lines (one per line, or separated by \\n), each a program and its words, such as “npm test”; run without a shell, so no ; | & > < ` $( and no leading “-”. Each run asks first. None set: a task cannot be verified',
  extra: 'loop gates verify test lint build check command evidence',
  options: [] as readonly string[],
  maxLength: MAX_GATES * (MAX_GATE_CHARS + 1),
  current: (p: { loopGates?: string }): string => p.loopGates ?? '',
  isChanged: (p: { loopGates?: string }): boolean => (p.loopGates ?? '') !== '',
  patch: (value: string): { loopGates: string } => ({ loopGates: value.replace(/[\u0000-\u0009\u000b-\u001f\u007f-\u009f]/g, ' ').trim() }),
} as const
