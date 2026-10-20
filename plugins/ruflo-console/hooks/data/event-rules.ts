/**
 * Alert rules for the Events page (ADR-474): a saved query that raises a band notice when a NEW event matches it. A rule is evaluated
 * over the events that arrived since the last pass, never over history, so loading a log or changing a rule announces nothing old.
 * Pure; the notice itself goes through notices.ts `addNotice` (one per rule per minute).
 */
import { levelOf, type Level } from './event-severity'
import { budgetOf, matches, parseQuery, type Query } from './event-query'
import type { SavedSearch } from './activity-store'
import type { ConsoleEvent } from './events'

export type Hit = { rule: string; count: number; newest: ConsoleEvent; level: Level }

const parsed = new Map<string, Query>()

const queryOf = (source: string): Query => {
  let found = parsed.get(source)

  if (found === undefined) {
    found = parseQuery(source)
    if (parsed.size > 64) parsed.clear()
    parsed.set(source, found)
  }

  return found
}

/** Which rules the new events hit: the count and the newest event of each. A rule whose query has errors or no terms never fires. */
export function evaluateRules(rules: readonly SavedSearch[], fresh: readonly ConsoleEvent[], nowMs: number): Hit[] {
  const out: Hit[] = []
  // A slow pattern cannot hold the 1.5 s pass for long: all the rules together may spend this much on regexes.
  const budget = budgetOf(40)

  for (const rule of rules) {
    const query = queryOf(rule.q)

    if (query.terms.length === 0 || query.errors.length > 0) continue

    const hits = fresh.filter(event => matches(event, query, nowMs, budget))
    const newest = hits[hits.length - 1]

    if (newest !== undefined) out.push({ rule: rule.name, count: hits.length, newest, level: levelOf(newest.kind, newest.text) })
  }

  return out
}
