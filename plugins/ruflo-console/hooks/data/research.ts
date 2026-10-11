/**
 * The Missions page's Research section (ADR-438). The mod cannot read memory itself, so it asks the ruflo-goals plugin's
 * `research-list.mjs` (installed under Claude Code's plugin cache) for the newest research records as one local JSON
 * document. Local only: nothing here reaches the network, and the script path comes from `installed_plugins.json`,
 * validated, never from typed text. Read-only: the section stores and starts nothing.
 */
import type { Probe } from './cli'
import { jsonObject, msOf, recordOf, stringOf } from './parse'
import { measureOf } from './safe'

import type { State } from '../state'

export const GOALS_PLUGIN = 'ruflo-goals@ruflo'
/** The first release with `research-list.mjs`: an older install has no script to run. */
export const RESEARCH_FROM = [0, 3, 0] as const

export type Grade = 'High' | 'Medium' | 'Low'
export type ResearchRecord = {
  question: string
  status: 'done' | 'truncated' | 'failed' | 'unknown'
  depth: string
  findings: number
  grades: Record<Grade, number>
  /** USD, or null when the run did not know: never invented. */
  spentUsd: number | null
  capUsd: number | null
  atMs: number | null
  isScreened: boolean
}

const STATUSES: readonly string[] = ['done', 'truncated', 'failed']
const MAX_RECORDS = 8
const MAX_FINDINGS = 500

/** An absolute POSIX path of a plugin's install directory: no `..`, no control characters, no shell-looking text. */
export const safeInstallPath = (value: unknown): string | undefined => {
  const path = typeof value === 'string' ? value : ''

  return /^\/[A-Za-z0-9._@+/ -]{1,300}$/.test(path) && !path.split('/').includes('..') ? path : undefined
}

const countGrades = (findings: readonly unknown[]): Record<Grade, number> => {
  const grades: Record<Grade, number> = { High: 0, Medium: 0, Low: 0 }

  for (const item of findings) {
    const grade = recordOf(item)?.grade

    if (grade === 'High' || grade === 'Medium' || grade === 'Low') grades[grade] += 1
  }

  return grades
}

/** What `research-list.mjs --limit N` prints: `{ version: 1, records: [...] }`, newest first. Null for anything else. */
export function parseResearch(stdout: string): ResearchRecord[] | null {
  const value = jsonObject(stdout)

  if (value === null || value.version !== 1 || !Array.isArray(value.records)) return null

  const records = value.records.slice(0, MAX_RECORDS).flatMap((item): ResearchRecord[] => {
    const record = recordOf(item)
    const question = stringOf(record?.question, 120)

    if (record === null || question === undefined) return []

    const findings = (Array.isArray(record.findings) ? record.findings : []).slice(0, MAX_FINDINGS)
    // Dollars are bounded where they are read: `1e300` would draw "$1e+300" (#3822).
    const spent = measureOf(record.spentUsd)
    const cap = measureOf(record.capUsd)
    const status = typeof record.status === 'string' && STATUSES.includes(record.status) ? (record.status as ResearchRecord['status']) : 'unknown'

    return [{
      question, status, depth: stringOf(record.depth, 12) ?? 'n/a', findings: findings.length, grades: countGrades(findings),
      spentUsd: spent !== undefined && spent >= 0 ? spent : null, capUsd: cap !== undefined && cap >= 0 ? cap : null,
      atMs: msOf(record.at) ?? null, isScreened: record.screened === true,
    }]
  })

  return records.sort((a, b) => (b.atMs ?? 0) - (a.atMs ?? 0))
}

const atLeast = (version: string, from: readonly number[]): boolean => {
  const parts = /^(\d+)\.(\d+)\.(\d+)/.exec(version)?.slice(1).map(Number) ?? []

  for (let i = 0; i < 3; i++) if ((parts[i] ?? 0) !== from[i]) return (parts[i] ?? 0) > (from[i] ?? 0)

  return parts.length === 3
}

/** Whether ruflo-goals is absent, too old to list research, or ready (with the script's directory). */
export function goalsOf(state: Pick<State, 'snapshot'>): { kind: 'absent' } | { kind: 'old'; version: string } | { kind: 'ready'; root: string } {
  const entry = state.snapshot?.plugins.installed?.find(plugin => plugin.id === GOALS_PLUGIN)
  const root = safeInstallPath(entry?.installPath)

  if (entry === undefined || root === undefined) return { kind: 'absent' }

  return atLeast(entry.version, RESEARCH_FROM) ? { kind: 'ready', root } : { kind: 'old', version: entry.version }
}

/** Where the plugin's list script is, or null when it is absent or too old (the probe then does not run). */
export function researchArgv(state: Pick<State, 'snapshot'>): readonly string[] | null {
  const goals = goalsOf(state)

  return goals.kind === 'ready' ? ['node', `${goals.root}/scripts/research-list.mjs`, '--limit', '8'] : null
}

export const researchProbe: Probe<ResearchRecord[]> = {
  id: 'research', args: [], argvOf: researchArgv, views: ['missions'], everyMs: 300_000, timeoutMs: 30_000, parse: parseResearch,
}
