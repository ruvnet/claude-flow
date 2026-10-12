import type { BudgetLevel } from '../cost/budget'

/**
 * One session's rollup (ADR-451 item 6): counts and short fixed-vocabulary
 * fields only. No prompt text, tool input, path or file content ever reaches
 * a record: every field is built from a counter or a whitelisted word.
 */
export type Rollup = {
  /** Session end, ms since epoch. */
  at: number
  tools: number
  routed: number
  tightened: number
  denied: number
  spawns: number
  /** Highest cost rung the session reached (the cost ladder's own words). */
  cost: BudgetLevel
  /** `fired/registered` events when the capability probe is on. */
  probe?: string
}

export const MAX_RECORDS = 50
export const MAX_RECORD_BYTES = 512
export const MAX_LEDGER_BYTES = 32 * 1024
const MAX_COUNT = 1_000_000

const RUNGS: readonly BudgetLevel[] = ['OK', 'INFO', 'WARNING', 'CRITICAL', 'HARD_STOP']
const COUNTS = ['tools', 'routed', 'tightened', 'denied', 'spawns'] as const

const count = (n: unknown): number | undefined =>
  typeof n === 'number' && Number.isInteger(n) && n >= 0 ? Math.min(n, MAX_COUNT) : undefined

/** A counter as stored: a bad value is 0, never a crash. */
export const clampCount = (n: unknown): number => count(n) ?? 0

/** One record as stored, or undefined when it is not a well-formed record. Unknown fields are dropped. */
export function readRecord(value: unknown): Rollup | undefined {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return undefined
  const v = value as Record<string, unknown>
  const at = typeof v.at === 'number' && Number.isFinite(v.at) && v.at >= 0 ? v.at : undefined
  const cost = RUNGS.find(r => r === v.cost)
  if (at === undefined || !cost) return undefined
  const record: Rollup = { at, tools: 0, routed: 0, tightened: 0, denied: 0, spawns: 0, cost }
  for (const key of COUNTS) record[key] = clampCount(v[key])
  if (typeof v.probe === 'string' && /^\d{1,3}\/\d{1,3}$/.test(v.probe)) record.probe = v.probe
  return JSON.stringify(record).length <= MAX_RECORD_BYTES ? record : undefined
}

/** The ledger as stored: only well-formed records, newest last, within the caps. A corrupt or hostile value is empty. */
export function readLedger(value: unknown): Rollup[] {
  if (!Array.isArray(value)) return []
  return prune(value.slice(-MAX_RECORDS * 2).map(readRecord).filter((r): r is Rollup => r !== undefined))
}

/** Keeps the newest records within the count and byte caps. */
export function prune(records: Rollup[]): Rollup[] {
  const kept = records.slice(-MAX_RECORDS)
  while (kept.length > 1 && JSON.stringify(kept).length > MAX_LEDGER_BYTES) kept.shift()
  return kept
}

/** The ledger with one more record, pruned. */
export const append = (ledger: Rollup[], record: Rollup): Rollup[] => prune([...ledger, record])

/** The bounded lines `/ruflo-mods` shows for the last sessions. */
export function ledgerLines(ledger: readonly Rollup[]): string[] {
  const last = ledger.slice(-5)
  if (!last.length) return ['none yet']
  const sum = (key: (typeof COUNTS)[number]) => last.reduce((n, r) => n + r[key], 0)
  const newest = last[last.length - 1]!
  return [
    `${ledger.length} kept; last ${last.length}: ${sum('tools')} tools, ${sum('routed')} routed, ${sum('tightened')} tightened, ${sum('denied')} denied, ${sum('spawns')} agents`,
    `newest: ${newest.tools} tools, ${newest.routed} routed, ${newest.spawns} agents, cost ${newest.cost}${newest.probe ? `, probe ${newest.probe}` : ''}`,
  ]
}
