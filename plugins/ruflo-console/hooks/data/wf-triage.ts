/**
 * Failure triage for a workflow run (ADR-462). Pure: an agent and, where the journal has it, the text of its result in; a class, the first
 * error line and a re-run text out.
 *
 * The classes are read from what Claude Code records and nothing else: the run record's state (`failed`), the journal's result event, the
 * agent's tool-call count and the reader's staleness. There is no timeout event in the files, so `timeout` is a textual match on the
 * result (the page says so). A result that merely MENTIONS an error is not an error: for an agent that finished, only a result that begins
 * with one is.
 */
import { ESCAPES, HIDDEN, INVISIBLE } from './parse'
import { maskSecrets, jsonLines, type WfAgent, type WfRun } from './workflows'

export type TriageKind = 'ok' | 'empty' | 'error' | 'timeout' | 'stale' | 'pending'

export type Triage = { kind: TriageKind; /** One short reason, for the row. */ why: string; /** The first error line of the result, masked and without control characters. */ firstError?: string }

const tidy = (value: string, max: number): string => maskSecrets(value.replace(ESCAPES, '').replace(INVISIBLE, '').replace(HIDDEN, ' ').replace(/\s+/g, ' ').trim()).slice(0, max)

const ERROR_START = /^\W{0,3}(?:[A-Z][A-Za-z]*Error\s*[:(]|error\s*[:(]|fatal\s*[:(]|panic(?:ked)?\b|exception\s*[:(]|traceback \(most recent|npm ERR!|✖|✗)/i
const ERROR_ANYWHERE = /\b(?:[A-Z][A-Za-z]*Error|ENOENT|EACCES|EPERM|ECONN[A-Z]+|ETIMEDOUT|ENOSPC)\b|\b(?:error|fatal|panic|failed|exception)\s*[:(]|\bTraceback\b|\bcould not\b|\bunable to\b|\bcannot\b/i
const TIMEOUT = /time(?:d)?[\s-]?out|deadline exceeded|ETIMEDOUT|took too long/i
const EMPTY = /^\W*(?:no (?:changes?|work|files?|findings?|issues?|results?|output|items?)(?: (?:made|needed|found|to (?:make|do|report)))?|nothing (?:to do|changed|found|to report|to change)|n\/a|none|null|undefined|\{\s*\}|\[\s*\])\W*$/i

/** The first line of `text` that reads as an error (any line), else null. Lines are split on newlines; a one-line preview is one line. */
export function firstErrorLine(text: string, isAnywhere = true): string | null {
  for (const line of text.split('\n').slice(0, 200)) {
    if (ERROR_START.test(line.trim()) || (isAnywhere && ERROR_ANYWHERE.test(line))) {
      const clean = tidy(line, 140)

      if (clean !== '') return clean
    }
  }

  return null
}

/** What the journal's result events say, by agent id: the text of each (a structured result is its `error` or `message` field, else its JSON), capped at 4000 characters. */
export function resultsOfJournal(journal: string | null): Map<string, string> {
  const out = new Map<string, string>()

  for (const event of jsonLines(journal)) {
    if (event.type !== 'result' || typeof event.agentId !== 'string') continue

    const value = event.result
    const record = typeof value === 'object' && value !== null && !Array.isArray(value) ? (value as Record<string, unknown>) : null
    const text = typeof value === 'string' ? value : record !== null && typeof (record.error ?? record.message) === 'string' ? String(record.error ?? record.message) : JSON.stringify(value ?? '')

    out.set(event.agentId.slice(0, 80), (text ?? '').slice(0, 4000))
  }

  return out
}

/** One agent's class. `result` is the journal's text for it, where there is one; without it the reader's 160-character preview is used. */
export function classifyAgent(agent: WfAgent, result?: string): Triage {
  const text = result ?? agent.resultPreview ?? ''
  const head = text.trim()

  if (agent.state === 'stale') return { kind: 'stale', why: 'no sign of life for 15 minutes or more' }
  if (agent.state === 'running' || agent.state === 'queued' || agent.state === 'idle') return { kind: 'pending', why: agent.state }

  if (agent.state === 'failed') {
    const line = firstErrorLine(head) ?? (head === '' ? null : tidy(head.split('\n')[0] ?? '', 140))
    const kind: TriageKind = TIMEOUT.test(head.slice(0, 600)) ? 'timeout' : 'error'

    return { kind, why: head === '' ? 'the run record marks it failed; no result text was recorded' : kind === 'timeout' ? 'its result reads as a timeout' : 'the run record marks it failed', ...(line !== null && line !== '' && { firstError: line }) }
  }

  // Finished. A result that opens with an error is one; a result that only mentions one is not.
  const opening = firstErrorLine(head.split('\n').slice(0, 1).join('\n'), false)

  if (opening !== null) return { kind: TIMEOUT.test(head.slice(0, 600)) ? 'timeout' : 'error', why: 'it finished, but its result opens with an error', firstError: opening }
  if (head !== '' && head.length <= 80 && EMPTY.test(head)) return { kind: 'empty', why: `its whole result is "${tidy(head, 40)}"` }
  if (head === '' && agent.toolCalls === 0) return { kind: 'empty', why: 'it finished with no result and no tool call' }

  return { kind: 'ok', why: head === '' ? 'finished; no result text was recorded' : 'finished with a result' }
}

export type TriageItem = { agent: WfAgent; triage: Triage; /** True where the journal holds a result event for the agent: a resume returns it cached instead of running it again. */ isCached: boolean }

export type TriageRun = { items: TriageItem[]; counts: Record<TriageKind, number> }

/** Every agent of the run, in phase order, with its class. `results` is null where the journal was not read. */
export function triageRun(run: WfRun, results: ReadonlyMap<string, string> | null): TriageRun {
  const counts: Record<TriageKind, number> = { ok: 0, empty: 0, error: 0, timeout: 0, stale: 0, pending: 0 }
  const items: TriageItem[] = []

  for (const phase of run.phases) {
    for (const agent of phase.agents) {
      const result = results?.get(agent.id)
      const triage = classifyAgent(agent, result)

      counts[triage.kind] += 1
      items.push({ agent, triage, isCached: result !== undefined })
    }
  }

  return { items, counts }
}

export const failedOf = (triage: TriageRun): TriageItem[] => triage.items.filter(item => item.triage.kind === 'error' || item.triage.kind === 'timeout' || item.triage.kind === 'stale')

/** `2 failed · 1 empty · 1 stale · 9 ok · 3 running`; classes with none are left out, and a run with nothing to count says so. */
export function triageStrip(counts: Record<TriageKind, number>): string {
  const failed = counts.error + counts.timeout
  const parts = [failed > 0 ? `${failed} failed` : '', counts.empty > 0 ? `${counts.empty} empty` : '', counts.stale > 0 ? `${counts.stale} stale` : '', counts.ok > 0 ? `${counts.ok} ok` : '', counts.pending > 0 ? `${counts.pending} running or waiting` : ''].filter(Boolean)

  return parts.length === 0 ? 'no agents to triage' : parts.join(' · ')
}

const RUN_ID = /^wf_[A-Za-z0-9-]{1,40}$/

/**
 * The text for resuming a run so only its unfinished calls run again, for the person to run: the console never runs it. The verb is the
 * Workflow tool's documented `resumeFromRunId` (ruflo-workflows: workflow-run): a call whose result is already in the journal returns
 * cached, so an agent that FAILED but left a result is not run again by it, and the text says which those are. Null for a ruflo swarm
 * (it has no such verb: its agents are stopped and spawned from the inspector) and for an id that is not a run id.
 */
export function rerunText(run: WfRun, failed: readonly TriageItem[], hasJournal: boolean): string[] | null {
  if (run.kind !== 'workflow' || !RUN_ID.test(run.id) || failed.length === 0) return null

  const name = (item: TriageItem): string => `${tidy(item.agent.label, 40)} (${tidy(item.agent.phase, 30)})`
  const again = failed.filter(item => !hasJournal || !item.isCached)
  const cached = failed.filter(item => hasJournal && item.isCached)
  const list = (items: readonly TriageItem[]): string => `${items.slice(0, 10).map(name).join('; ')}${items.length > 10 ? `; +${items.length - 10} more` : ''}`

  return [
    ...(run.running > 0 ? ['Stop the run first (the Control tab\'s Stop asks first and calls TaskStop with the run\'s task id: verified to stop the whole run on Claude Code 2.1.289; it cannot stop a single agent; Claude Code\'s Workflows panel also works), then:'] : []),
    `Workflow({ scriptPath: "<the script that started this run>", resumeFromRunId: "${run.id}" })`,
    ...(again.length > 0 ? [`runs again, no result recorded: ${list(again)}`] : []),
    ...(cached.length > 0 ? [`stays cached, its error is its recorded result: ${list(cached)}. Change that agent() call or its input to run it again`] : []),
    ...(hasJournal ? [] : ['the journal was not read, so which of these are cached is unknown']),
  ]
}
