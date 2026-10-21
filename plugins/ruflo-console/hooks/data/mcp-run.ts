/**
 * One run of `ruflo mcp exec -t <tool> -p <json>`, read as Mission Control's create chain needs it. Pure: no `$`.
 *
 * What the CLI prints (captured from ruflo 3.56.1, commands/mcp.ts and mcp-client.ts):
 *   stderr  `[INFO] Executing tool: <tool>`, and on a failure `[ERROR] Tool execution failed: Failed to execute MCP tool '<tool>': <cause>`
 *   stdout  `  Parameters: {…the input…}`, then on success `[OK] Tool executed in …`, a line `Result:` and the answer as JSON
 * A failure prints no `Result:` line, so the Parameters object is the only JSON on stdout: it is never read as the answer.
 */
import { closeOf } from './json-span'
import { errorLine, failureReason } from './failure'
import { plain, recordOf } from './parse'

/** The cause the policy runtime throws when it could not take `.claude-flow/policy/state.lock` in time (#3164, #3892). */
export const LOCK_TIMEOUT = 'policy-state-lock-timeout'

const ANSI = /\x1b\[[0-9;]*m/g
const RESULT_LINE = /^Result:[ \t]*$/m

/** The text after the CLI's own `Result:` line (a line of its own, so a parameter that holds "Result:" is not it), or null when there is none. */
export function afterResult(stdout: string): string | null {
  const text = stdout.replace(ANSI, '')
  const marker = RESULT_LINE.exec(text)

  return marker === null ? null : text.slice(marker.index + marker[0].length)
}

/** The JSON object the tool answered (after `Result:`), strings and their brackets skipped, or null when it answered none. */
export function resultOf(stdout: string): Record<string, unknown> | null {
  const tail = afterResult(stdout)
  const start = tail === null ? -1 : tail.search(/[{[]/)

  if (tail === null || start < 0) return null

  const end = closeOf(tail, start)

  if (end < 0) return null

  try {
    return recordOf(JSON.parse(tail.slice(start, end + 1)))
  } catch {
    return null
  }
}

/** One run read: the tool's answer (null when none), whether it is the success the step needs, whether trying again may help, and why not. */
export type Attempt = { result: Record<string, unknown> | null; ok: boolean; transient: boolean; reason: string }

/** The CLI's cause, its two wrappers dropped ("Tool execution failed: Failed to execute MCP tool 'x': <cause>"). */
const causeOf = (line: string): string => line.replace(/^Tool execution failed:\s*/i, '').replace(/^Failed to execute MCP tool '[^']*':\s*/i, '').trim()

/** What one try came to: the process's output, a rejection from the host (it could not start, or was refused), or the caller's own time limit. */
export type RunRead = { exitCode: number; stdout: string; stderr: string } | { error: unknown } | { timedOutMs: number }

/**
 * Reads one run of `mcp exec`. `isDone` judges the tool's parsed answer by its own keys (never a substring of the output, which quotes the
 * person's text). Transient, and only then, when:
 *   - the CLI's cause is exactly `policy-state-lock-timeout` (thrown before the tool runs, so nothing was written),
 *   - the caller's own time limit ended the wait (`timedOutMs`, a structured signal, never a message), or
 *   - the process exited non-zero with stdout and stderr both empty.
 * Any answer, any other error line (a refusal that mentions a timeout, `command not found`), and any rejection of the host (a command that
 * could not start, an approval that was refused or timed out) are definite.
 */
export function readAttempt(run: RunRead, isDone: (result: Record<string, unknown>) => boolean): Attempt {
  if ('timedOutMs' in run) return { result: null, ok: false, transient: true, reason: `no answer in ${Math.round(run.timedOutMs / 1000)} s; the CLI process may still finish (check \`ruflo task list\`)` }
  if ('error' in run) return { result: null, ok: false, transient: false, reason: `the CLI could not be run: ${plain(run.error instanceof Error ? run.error.message : String(run.error), 140) || 'no reason given'}` }

  const result = resultOf(run.stdout)

  if (result !== null) {
    const ok = run.exitCode === 0 && isDone(result)
    const tail = afterResult(run.stdout) ?? ''

    return { result, ok, transient: false, reason: ok ? '' : plain(failureReason({ stdout: tail }) || String(result.message ?? '') || 'the tool answered without the expected result', 160) }
  }

  const cause = plain(causeOf(errorLine(run.stderr) ?? errorLine(run.stdout) ?? ''), 160)
  const silent = run.exitCode !== 0 && run.stdout.trim() === '' && run.stderr.trim() === ''
  const said = cause || plain(run.stderr.split('\n').map(line => line.trim()).filter(line => line !== '').pop() ?? '', 160)

  return { result: null, ok: false, transient: cause === LOCK_TIMEOUT || silent, reason: said === '' ? `no answer (exit ${run.exitCode})` : said }
}
