/** The fields Claude's console_set may fill (ADR-444): each goes through the same action the page's own field does. Split out of model-tools.ts to keep it under 500 lines. */
import type { ModelToolDeps } from './model-tools'
import { DEV_FIELDS } from './data/devtools'
import { PROFILES, RIGORS } from './goap'
import { setResearch } from './mission-control'
import { RESEARCH_DEPTHS } from './mission-options'

export const SET_FIELDS = ['goal', 'profile', 'rigor', 'research.question', 'research.depth', 'research.cap', 'cost.budget'] as const

/** `line` is the console's one model-facing sanitiser (model-tools.ts modelLine): the field name is the model's own text. */
export function setField(deps: ModelToolDeps, field: string, value: string, line: (raw: unknown, max: number) => string): string | null {
  const { state, control } = deps
  const { mission } = control.actions

  if (field === 'goal') mission.goal(value)
  else if (field === 'profile') {
    const found = PROFILES.find(profile => profile.id === value)

    if (found === undefined) return `profile must be one of ${PROFILES.map(profile => profile.id).join(', ')}`
    mission.profile(found.id)
  } else if (field === 'rigor') {
    const found = RIGORS.find(rigor => rigor === value)

    if (found === undefined) return `rigor must be one of ${RIGORS.join(', ')}`
    mission.rigor(found)
  } else if (field === 'research.question') setResearch(state, { question: value })
  else if (field === 'research.depth') {
    const found = RESEARCH_DEPTHS.find(depth => depth === value)

    if (found === undefined) return `research.depth must be one of ${RESEARCH_DEPTHS.join(', ')}`
    setResearch(state, { depth: found })
  } else if (field === 'research.cap') setResearch(state, { cap: value })
  else if (field === 'cost.budget') control.actions.costBudgetDraft(value)
  else if (field.startsWith('dev.') && DEV_FIELDS.includes(field.slice(4) as never)) control.actions.devtools.draft(field.slice(4) as never, value)
  else return `unknown field "${line(field, 40)}". Fields: ${[...SET_FIELDS, 'dev.<field>'].join(', ')}`

  control.host.invalidate()

  return null
}
