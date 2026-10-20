/**
 * The lifecycle commands of ADR-456, as fixed argv checked against @claude-flow/cli (mcp-tools/neural-tools.ts
 * `neural_patterns` delete and `neural_compress` prune, both on .claude-flow/neural/models.json; mcp-tools/agentdb-tools.ts
 * `agentdb_feedback`, whose bridge turns a success with quality >= 0.9 and a pattern into a reusable skill, memory-bridge.ts).
 * Every one writes, so every one asks first. There is no in-place "raise this pattern's rank" verb in ruflo: promote is
 * the documented promote-to-skill path and it ADDS a pattern and a skill; the original row is not edited. Pure: specs
 * and entries only, built from the state; the runner runs them.
 */
import type { ActionSpec } from './actions'
import { autoSpec, tool, type AutoEntry } from './automate'
import { recallOf, wouldPrune } from './data/recall'
import type { State } from './state'

/** A pattern id as ruflo mints them (`pattern-<ms>-<n>-<rand>`): letters, digits, dash and underscore only. */
export const patternIdOf = (text: string): string | null => {
  const id = text.trim()

  return /^[A-Za-z0-9_-]{1,80}$/.test(id) ? id : null
}

export const PRUNE_NOTE = 'DELETES FOR GOOD: one pattern from .claude-flow/neural/models.json; there is no undo'
export const PROMOTE_NOTE = 'writes: records a success (quality 0.95) with this pattern, which adds a pattern to the ReasoningBank and a reusable skill; the row itself is not changed'

export function pruneSpec(text: string): ActionSpec | null {
  const id = patternIdOf(text)

  return id === null ? null : autoSpec('nn-recall-prune', `prune the pattern ${id}`, 'writes', tool('neural_patterns', { action: 'delete', patternId: id }), { note: PRUNE_NOTE })
}

export function promoteSpec(state: State, text: string): ActionSpec | null {
  const id = patternIdOf(text)
  const pattern = id === null ? undefined : recallOf(state.snapshot)?.neural?.find(row => row.id === id)

  if (id === null || pattern === undefined || pattern.content === '') return null

  return autoSpec('nn-recall-promote', `promote the pattern ${id} to a skill`, 'writes', tool('agentdb_feedback', { taskId: `promote-${id}`.slice(0, 80), success: true, quality: 0.95, patterns: [pattern.content] }), { note: PROMOTE_NOTE })
}

/** `neural_compress` prune: every pattern used fewer than `uses` times. The count shown is what the file says now. */
export function pruneUnusedSpec(state: State, uses = 1): ActionSpec | null {
  const rows = recallOf(state.snapshot)?.neural

  if (rows === null || rows === undefined) return null

  const doomed = wouldPrune(rows, uses).length

  if (doomed === 0) return null

  return autoSpec('nn-recall-prune-unused', `prune ${doomed} of ${rows.length} patterns used fewer than ${uses} time${uses === 1 ? '' : 's'}`, 'writes', tool('neural_compress', { method: 'prune', targetSize: uses }), { note: `DELETES FOR GOOD: every pattern in .claude-flow/neural/models.json with usageCount below ${uses} (${doomed} now); there is no undo` })
}

/** The typed entries (`/ruflo run nn-recall-prune <pattern id>`) and the bulk one; ids are what `/ruflo run` takes. */
export function recallEntries(state: State): AutoEntry[] {
  return [
    { id: 'nn-recall-prune', group: 'neural', label: 'nn-recall-prune <pattern id>: delete one pattern from the neural store', make: pruneSpec },
    { id: 'nn-recall-promote', group: 'neural', label: 'nn-recall-promote <pattern id>: promote one neural-store pattern to a skill', make: text => promoteSpec(state, text) },
    { id: 'nn-recall-prune-unused', group: 'neural', label: 'neural_compress prune: delete every neural-store pattern that was never used', spec: pruneUnusedSpec(state), why: 'n/a: no .claude-flow/neural/models.json was read, or no pattern in it is unused' },
  ]
}
