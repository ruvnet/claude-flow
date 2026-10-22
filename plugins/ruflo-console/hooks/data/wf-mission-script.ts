/**
 * "Run this mission as a workflow" (ADR-460): a native `.claude/workflows/<name>.js` script drafted from a mission's SPARC plan,
 * for review, plus the dry-run estimate of what it would start. Pure text in, text out: nothing here writes a file or runs anything;
 * the launch is views/wf-guide.ts's confirm card, which hands the reviewed text to the main Claude session.
 *
 * The script obeys the workflow-create skill: `meta` is a pure literal, the plan's tasks are data (JSON, so no mission text is ever
 * code), tasks run level by level (a level is every task whose dependencies are all in earlier levels) with `parallel` inside a
 * level, and nothing calls Date.now() or Math.random(). Each agent's label starts with the tag data/wf-links.ts reads back, so the
 * run's agents link to their mission tasks. The estimate is counted from the plan only: tokens and cost are n/a, there is no data.
 */
import type { MissionRecord } from '../mission-types'
import { cleanText } from './wf-clean'
import { labelTag } from './wf-links'

export type ScriptTask = { id: string; title: string; stage?: string; agent?: string; requirement?: string; dependsOn: readonly string[] }
export type ScriptMission = { id: string; objective: string; tasks: readonly ScriptTask[] }

export type Estimate = {
  /** One agent per task. */
  agents: number
  /** Levels run one after another. */
  levels: number
  /** The most agents running at once (the widest level). */
  widest: number
  phases: string[]
  /** Roles passed as `agentType`; the others ride in the prompt only. */
  typed: number
}

export type Draft = { ok: true; name: string; path: string; source: string; estimate: Estimate; warnings: string[] } | { ok: false; why: string }

/** More than this is not a script a person reviews in one sitting. */
export const MAX_AGENTS = 30

/** Subagent types a Claude Code session is known to resolve; any other role from the plan is named in the prompt instead. */
const KNOWN_TYPES: ReadonlySet<string> = new Set(['coder', 'tester', 'reviewer', 'researcher', 'planner', 'security-auditor', 'security-architect', 'performance-engineer', 'cicd-engineer', 'api-docs'])
const LABEL_MAX = 80

export const scriptMissionOf = (mission: MissionRecord): ScriptMission => ({
  id: mission.id,
  objective: mission.objective,
  tasks: mission.tasks.map(task => ({ id: task.id, title: task.title, stage: task.stage ?? task.phase, agent: task.agent, requirement: task.requirement, dependsOn: task.dependsOn })),
})

const clip = (value: string, max: number): string => (value.length <= max ? value : `${value.slice(0, max - 1)}…`)
const clean = (value: string | undefined, max: number): string => clip(cleanText(value ?? '').replace(/\s+/g, ' ').trim(), max)
const slug = (id: string): string => `mission-${id.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 36)}`.replace(/-+$/, '')

/** Task indexes grouped by level, or null when the dependencies run in a circle. A dependency on an id the plan lacks is ignored (and reported). */
export function levelsOf(tasks: readonly ScriptTask[]): number[][] | null {
  const index = new Map(tasks.map((task, i) => [task.id, i]))
  const depth: (number | undefined)[] = tasks.map(() => undefined)
  const visiting = new Set<number>()
  const visit = (i: number): number | null => {
    const held = depth[i]

    if (held !== undefined) return held
    if (visiting.has(i)) return null

    visiting.add(i)

    let deepest = 0

    for (const dep of (tasks[i] as ScriptTask).dependsOn) {
      const at = index.get(dep)

      if (at === undefined) continue

      const d = visit(at)

      if (d === null) return null

      deepest = Math.max(deepest, d + 1)
    }

    visiting.delete(i)
    depth[i] = deepest

    return deepest
  }

  for (let i = 0; i < tasks.length; i++) if (visit(i) === null) return null

  const levels: number[][] = []

  tasks.forEach((_, i) => (levels[depth[i] as number] ??= []).push(i))

  return levels
}

export function draftScript(mission: ScriptMission): Draft {
  const tasks = mission.tasks

  if (tasks.length === 0) return { ok: false, why: 'the mission has no tasks to run' }
  if (tasks.length > MAX_AGENTS) return { ok: false, why: `${tasks.length} tasks is more than the ${MAX_AGENTS} one reviewed script holds` }
  if (new Set(tasks.map(task => task.id)).size !== tasks.length) return { ok: false, why: 'two tasks share an id' }

  const levels = levelsOf(tasks)

  if (levels === null) return { ok: false, why: 'the tasks depend on each other in a circle' }

  const warnings: string[] = []
  const known = new Set(tasks.map(task => task.id))

  for (const task of tasks) for (const dep of task.dependsOn) if (!known.has(dep)) warnings.push(`task ${clean(task.id, 40)} depends on ${clean(dep, 40)}, which the plan does not have: ignored`)

  const objective = clean(mission.objective, 400)
  const data = tasks.map(task => {
    const tag = labelTag(mission.id, task.id)
    const title = clean(task.title, 80)
    const role = clean(task.agent, 40)
    const isTyped = KNOWN_TYPES.has(role)

    if (tag === null) warnings.push(`task ${clean(task.id, 40)} has an id that cannot be tagged: its agent will show as unlinked`)

    return {
      id: clean(task.id, 60),
      label: clip(`${tag === null ? '' : `${tag} `}${title}`, LABEL_MAX),
      ...(isTyped && { agentType: role }),
      prompt: [`Mission: ${objective}`, `Your task ${clean(task.id, 60)}: ${title}`, role === '' ? '' : `Act as: ${role}.`, task.requirement === undefined ? '' : `It is done when: ${clean(task.requirement, 300)}`, 'Report done=true only if that is true, with a short summary and the evidence (files, commands, test output).'].filter(line => line !== '').join('\n'),
      needs: task.dependsOn.flatMap(dep => (known.has(dep) ? [tasks.findIndex(other => other.id === dep)] : [])),
    }
  })
  const phaseOf = (level: number[]): string => [...new Set(level.map(i => clean((tasks[i] as ScriptTask).stage, 30) || 'Run'))].join(' + ')
  const plan = levels.map(ids => ({ phase: phaseOf(ids), ids }))
  const phases = [...new Set(plan.map(level => level.phase))]
  const name = slug(mission.id)
  const lit = (value: unknown): string => JSON.stringify(value, null, 2)
  const source = [
    `// Drafted by ruflo-console from mission ${JSON.stringify(clean(mission.id, 60))}. Review it, then run it with Workflow({ scriptPath }).`,
    'export const meta = {',
    `  name: ${JSON.stringify(name)},`,
    `  description: ${JSON.stringify(clip(`Run mission: ${objective}`, 160))},`,
    `  phases: ${JSON.stringify(phases.map(title => ({ title })))},`,
    '}',
    '',
    `const MISSION = ${JSON.stringify(clean(mission.id, 60))}`,
    `const TASKS = ${lit(data)}`,
    `const LEVELS = ${lit(plan)}`,
    "const SCHEMA = { type: 'object', additionalProperties: false, required: ['done', 'summary', 'evidence'], properties: { done: { type: 'boolean' }, summary: { type: 'string' }, evidence: { type: 'string' } } }",
    '',
    'const results = []',
    'for (const level of LEVELS) {',
    '  phase(level.phase)',
    '  const batch = await parallel(level.ids.map((i) => () => {',
    '    const t = TASKS[i]',
    "    const before = t.needs.map((n) => `${TASKS[n].id}: ${(results[n] && results[n].summary) || 'no report'}`).join('\\n')",
    "    const prompt = before ? `${t.prompt}\\n\\nAlready done before you:\\n${before}` : t.prompt",
    '    return agent(prompt, { label: t.label, phase: level.phase, schema: SCHEMA, ...(t.agentType ? { agentType: t.agentType } : {}) })',
    '  }))',
    '  level.ids.forEach((i, k) => { results[i] = batch[k] })',
    '}',
    '',
    'const notDone = TASKS.filter((_, i) => !results[i] || !results[i].done).map((t) => t.id)',
    'log(`mission ${MISSION}: ${TASKS.length - notDone.length}/${TASKS.length} tasks reported done`)',
    'return { mission: MISSION, notDone, results: TASKS.map((t, i) => ({ id: t.id, report: results[i] || null })) }',
    '',
  ].join('\n')

  return { ok: true, name, path: `.claude/workflows/${name}.js`, source, warnings, estimate: { agents: tasks.length, levels: levels.length, widest: Math.max(...levels.map(level => level.length)), phases, typed: data.filter(task => 'agentType' in task).length } }
}

/** The dry-run lines the review shows: counts from the plan, and what is not known. */
export function estimateLines(draft: Extract<Draft, { ok: true }>): string[] {
  const { agents, levels, widest, phases, typed } = draft.estimate

  return [
    `${agents} agents in ${levels} level${levels === 1 ? '' : 's'}, at most ${widest} at once · phases: ${phases.join(', ')}`,
    `${typed} of ${agents} carry a subagent type; the rest take their role from the prompt`,
    'tokens, time and cost: n/a (the console has no measurement of a script that has not run)',
    ...draft.warnings,
  ]
}
