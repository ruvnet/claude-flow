/**
 * Why a ruflo CLI run failed, in one line, and whether a non-zero exit is an answer instead.
 *
 * The CLI prints housekeeping to stderr before the real message (`[WARN] Skipped helper auto-refresh — .LOCKED marker
 * present`, `[INFO] Executing tool: …`, `Parameters: …`), so the first stderr line is usually not the reason. `mcp exec`
 * wraps a tool's failure as `{"content":[{"text":"{\"error\":\"…\"}"}],"isError":true}` on stdout, with exit 0. And the
 * verdict commands (`security defend`, `metaharness mcp-scan`, …) exit non-zero to say "found something" while printing
 * a valid JSON answer. Pure: no `$`.
 */
import { jsonAfter } from './cli'
import { closeOf } from './json-span'
import { plain, recordOf } from './parse'

/** Lines that are the CLI's housekeeping, never the reason a run failed. */
const NOISE = /^(\[(WARN|INFO|OK|DEBUG|SUCCESS)\]|Parameters:|Transformers\.js loaded|Result:\s*$|[─═+-]+$)/i

const lineOf = (line: string) => plain(line, 400)
const untagged = (line: string) => line.replace(/^\[ERROR\]\s*/i, '')

/** The error a wrapped MCP tool reported (`isError: true`): its `content[0].text`, unwrapped from JSON when it is JSON. */
function wrappedError(stdout: string): string | null {
  if (!/"isError"\s*:\s*true/.test(stdout)) return null

  const result = recordOf(jsonAfter(stdout))
  const content = Array.isArray(result?.content) ? recordOf(result.content[0]) : null
  const text = typeof content?.text === 'string' ? content.text : null

  if (text === null) return null

  const inner = recordOf(jsonAfter(text))
  const message = inner?.error ?? inner?.message

  return typeof message === 'string' && message.trim() !== '' ? message : text.trim() === '' ? null : text
}

const realLines = (text: string) => {
  const lines = text.split('\n').map(lineOf).filter(line => line !== '')

  return { lines, real: lines.filter(line => !NOISE.test(line)) }
}

/** The line of `text` that names an error, its `[ERROR]` tag dropped: an `[ERROR]` line first, then one naming an error (`error`, `TypeError`); null when none does. */
export function errorLine(text: string): string | null {
  const { real } = realLines(text)
  const picked = real.find(line => /^\[ERROR\]/i.test(line)) ?? real.find(line => /\b\w*error\b/i.test(line))

  return picked === undefined ? null : untagged(picked)
}

/** The one line of `text` that says what went wrong: {@link errorLine}, else the last real line, else the last line. */
export function reasonLine(text: string): string {
  const { lines, real } = realLines(text)

  return errorLine(text) ?? untagged(real[real.length - 1] ?? lines[lines.length - 1] ?? '')
}

/**
 * The reason a run failed, cleaned and capped at `max`, or '' when it printed nothing useful. In order: a wrapped MCP
 * tool's error, a top-level JSON `error`, any `"error"` key or `[ERROR]` line on stdout, then the stderr line {@link reasonLine} picks.
 */
export function failureReason(result: { stdout?: string; stderr?: string }, max = 160): string {
  const stdout = result.stdout ?? ''
  const wrapped = wrappedError(stdout)

  if (wrapped !== null) return plain(wrapped, max)

  // A JSON answer's own top-level error first: a substring search would find an error nested in upstream JSON it spreads.
  const top = recordOf(jsonAfter(stdout))?.error

  if (typeof top === 'string' && top.trim() !== '') return plain(top, max)

  const keyed = /"error"\s*:\s*"([^"]{1,400})"/.exec(stdout)?.[1] ?? /\[ERROR\]\s*(.{1,400})/.exec(stdout)?.[1]

  if (keyed !== undefined) return plain(keyed, max)

  return plain(reasonLine(result.stderr ?? ''), max)
}

/**
 * A verdict command's convention (ActionSpec.findings), mirrored from the CLI's source:
 *   exits    the exit codes it uses for "found something";
 *   isAnswer the complete shape of its JSON answer, with the keys and types its reader renders (`{}`, a banner, a partial
 *            object is never an answer);
 *   found    the CLI's own condition for that exit, read from the answer: a "found something" exit with an all-clear
 *            answer is not consistent, so it stays a failure.
 */
export type Findings = { exits: readonly number[]; isAnswer: (json: Record<string, unknown>) => boolean; found: (json: Record<string, unknown>) => boolean }

/** At most this many JSON values are tried on stdout, so a banner object before the answer does not hide it. */
const MAX_CANDIDATES = 5

/** The first of up to MAX_CANDIDATES top-level JSON objects on stdout that `isAnswer` accepts, with the text after it. */
function answerIn(isAnswer: Findings['isAnswer'], stdout: string): { json: Record<string, unknown>; rest: string } | null {
  const text = stdout.length > 1_000_000 ? stdout.slice(0, 1_000_000) : stdout
  const starts = /^[ \t]*[[{]/gm
  let tried = 0

  for (let match = starts.exec(text); match !== null && tried < MAX_CANDIDATES; match = starts.exec(text)) {
    const start = match.index + match[0].length - 1
    // Counted before the scan: an opener that never closes costs a scan of the rest, so it must use up an attempt too (else n openers cost n scans).
    tried += 1

    const end = closeOf(text, start)

    if (end < 0) continue

    let json: Record<string, unknown> | null = null

    try {
      json = recordOf(JSON.parse(text.slice(start, end + 1)))
    } catch {
      continue
    }
    if (json !== null && isAnswer(json)) return { json, rest: text.slice(end + 1) }
    starts.lastIndex = end + 1
  }

  return null
}

/** What a declared command's run came to: its answer, or null with the reason it is not one (when that reason is not the usual one). */
export type Judged = { answer: Record<string, unknown> | null; reason?: string }

/**
 * The run's answer when it has the declared shape AND nothing outside it reports a failure: after the answer stdout holds
 * only blank or housekeeping lines, and stderr has no error line (`[WARN]`/`[INFO]` are fine). The scanned (hostile) text
 * lives inside the answer's JSON, so these outside checks cannot be spoofed by it. Read at any exit: the caller decides
 * what the exit means.
 */
export function judgeFindings(findings: Findings | undefined, result: { stdout: string; stderr?: string }): Judged {
  if (findings === undefined) return { answer: null }

  const hit = answerIn(findings.isAnswer, result.stdout)

  if (hit === null) return { answer: null }

  const after = hit.rest.split('\n').map(lineOf).filter(line => line !== '' && !NOISE.test(line))

  if (after.length > 0) return { answer: null, reason: failureReason({ stdout: hit.rest }) || plain(after[0], 160) }

  const stderrError = errorLine(result.stderr ?? '')

  return stderrError === null ? { answer: hit.json } : { answer: null, reason: plain(stderrError, 160) }
}

/** Is this non-zero exit an answer? A declared exit, a complete answer with nothing failing around it, and the answer saying it found something. */
export function isFindingsExit(findings: Findings | undefined, result: { exitCode: number; stdout: string; stderr?: string }): boolean {
  if (findings === undefined || result.exitCode === 0 || !findings.exits.includes(result.exitCode)) return false

  const { answer } = judgeFindings(findings, result)

  return answer !== null && findings.found(answer)
}

/**
 * Does a parsed answer report a failure of its own? Read from its TOP-LEVEL keys only: a verdict quotes the hostile text
 * (`span`, `description`) and a wrapper spreads nested upstream JSON, so a substring search of the serialization would
 * turn "ignore previous instructions [ERROR]" or a nested `"success": false` into a failure.
 */
export const answerFailed = (json: Record<string, unknown>): boolean => json.success === false || typeof json.error === 'string' || json.isError === true

/** An answer's list: an array whose every row is an object with a string at each of `keys` (what its reader renders). */
export const rowsWith = (value: unknown, keys: readonly string[]): value is Record<string, unknown>[] =>
  Array.isArray(value) && value.every(row => {
    const fields = recordOf(row)

    return fields !== null && keys.every(key => typeof fields[key] === 'string')
  })

/** An answer's counts: an object with a finite number at each of `keys`. */
export const countsWith = (value: unknown, keys: readonly string[]): boolean => {
  const fields = recordOf(value)

  return fields !== null && keys.every(key => typeof fields[key] === 'number' && Number.isFinite(fields[key]))
}
