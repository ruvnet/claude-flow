/**
 * Mission options from the ruflo-goals plugin's own skills, run in the primary Claude session (the main UI): goal-plan
 * (a GOAP plan with precondition analysis, cost optimisation and adaptive replanning, by Claude), horizon-track (a
 * long-horizon objective across sessions, with checkpoints and drift detection), deep-research, research-synthesize and
 * dossier-collect. Each is a slash command `/ruflo-goals:<skill>`. Offered only when the plugin's commands are present
 * in the session; run now when the session is idle, otherwise prepared in the prompt box (the person's Enter takes the
 * native path while a turn runs).
 */
import type { Profile } from './goap'
import type { Host } from './host'
import type { State } from './state'

export const GOALS_PLUGIN = 'ruflo-goals'

export type MissionSkill = { id: string; title: string; about: string; hint: string; /** Profiles it suits best, highlighted in the list. */ suits: readonly Profile[] }

export const MISSION_SKILLS: readonly MissionSkill[] = [
  { id: 'goal-plan', title: 'Plan with Claude', about: 'a GOAP plan with precondition analysis, cost optimisation and adaptive replanning, made and executed by Claude', hint: '<goal>', suits: ['feature', 'bugfix', 'refactor', 'security'] },
  { id: 'horizon-track', title: 'Track across sessions', about: 'a long-horizon objective with milestone checkpoints, progress that persists, and drift detection', hint: '<objective>', suits: ['feature', 'refactor', 'security'] },
  { id: 'deep-research', title: 'Research first', about: 'multi-phase research over the web, memory and patterns, synthesised into findings', hint: '<topic>', suits: ['research', 'security', 'feature'] },
  { id: 'research-synthesize', title: 'Synthesise findings', about: 'a report from what memory already holds, with evidence grading and contradictions resolved', hint: '<topic>', suits: ['research'] },
  { id: 'dossier-collect', title: 'Build a dossier', about: 'a graph of facts on a seed entity, fanned out across web, memory, code, ADRs and git', hint: '<seed>', suits: ['research'] },
]

/** The slash commands present now (loaded when Mission Control opens); a skill is offered when its command is among them. */
export async function loadCommandNames(state: State, host: Host): Promise<void> {
  state.commandNames = await host.listCommands().catch(() => [])
  // The Launch rows and the ask buttons depend on it: redraw now that it is known.
  host.invalidate()
}

export const slashOf = (skill: MissionSkill): string => `${GOALS_PLUGIN}:${skill.id}`

export const isAvailable = (state: State, skill: MissionSkill): boolean => state.commandNames.includes(slashOf(skill))
