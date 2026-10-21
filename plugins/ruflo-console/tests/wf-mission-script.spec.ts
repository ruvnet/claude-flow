/**
 * The drafted mission workflow script (ADR-460): it is valid, it runs level by level with the plan's dependencies respected, no
 * mission text is ever code, secrets are masked, and the dry-run estimate counts only the plan. Run with
 *   npx vitest run plugins/ruflo-console/tests/wf-mission-script.spec.ts --testTimeout=30000
 */
import { describe, expect, it } from 'vitest'

import { readLabelTag } from '../hooks/data/wf-links'
import { draftScript, estimateLines, levelsOf, MAX_AGENTS, type Draft, type ScriptMission, type ScriptTask } from '../hooks/data/wf-mission-script'

const task = (id: string, dependsOn: string[] = [], over: Partial<ScriptTask> = {}): ScriptTask => ({ id, title: `Do ${id}`, stage: 'Build', agent: 'coder', requirement: `${id} is finished`, dependsOn, ...over })
const mission = (tasks: ScriptTask[], over: Partial<ScriptMission> = {}): ScriptMission => ({ id: 'mission-abc1', objective: 'Ship the thing', tasks, ...over })
const ok = (draft: Draft): Extract<Draft, { ok: true }> => {
  if (!draft.ok) throw new Error(`not drafted: ${draft.why}`)

  return draft
}

const AsyncFunction = Object.getPrototypeOf(async () => undefined).constructor as new (...args: string[]) => (...values: unknown[]) => Promise<unknown>

/** Runs the script the way Claude Code does: meta stripped to a const, the hooks injected, every agent answering done. */
async function run(source: string): Promise<{ calls: { prompt: string; opts: Record<string, unknown> }[]; phases: string[]; returned: unknown }> {
  const calls: { prompt: string; opts: Record<string, unknown> }[] = []
  const phases: string[] = []
  const agent = async (prompt: string, opts: Record<string, unknown>) => (calls.push({ prompt, opts }), { done: true, summary: `ran ${calls.length}`, evidence: 'e' })
  const parallel = async (thunks: (() => Promise<unknown>)[]) => Promise.all(thunks.map(thunk => thunk()))
  const body = source.replace(/^export const meta/m, 'const meta')
  const fn = new AsyncFunction('agent', 'parallel', 'phase', 'log', 'args', body)
  const returned = await fn(agent, parallel, (title: string) => phases.push(title), () => undefined, undefined)

  return { calls, phases, returned }
}

describe('draftScript', () => {
  it('writes a script that is valid, runs every task once, and meta is a pure literal', async () => {
    const draft = ok(draftScript(mission([task('a'), task('b', ['a']), task('c', ['a'])])))
    const { calls, phases, returned } = await run(draft.source)
    const metaLiteral = /^export const meta = (\{[\s\S]*?\n\})/m.exec(draft.source)?.[1] ?? ''

    expect(calls).toHaveLength(3)
    expect(phases).toEqual(['Build', 'Build'])
    expect(new Function(`return ${metaLiteral}`)()).toMatchObject({ name: 'mission-mission-abc1', phases: [{ title: 'Build' }] })
    expect(returned).toMatchObject({ mission: 'mission-abc1', notDone: [] })
    expect(draft.source).not.toMatch(/Date\.now|Math\.random/)
  })

  it('runs a task only after its dependencies, handing each the summaries of what ran before it', async () => {
    const draft = ok(draftScript(mission([task('c', ['b']), task('a'), task('b', ['a'])])))
    const { calls } = await run(draft.source)
    const order = calls.map(call => /Your task (\w+)/.exec(call.prompt)?.[1])

    expect(order).toEqual(['a', 'b', 'c'])
    expect(calls[1]?.prompt).toMatch(/Already done before you:\na: ran 1/)
    expect(calls[0]?.prompt).not.toMatch(/Already done/)
  })

  it('labels each agent with the tag the Workflows page reads back, within the 80 characters a journal keeps', () => {
    const draft = ok(draftScript(mission([task('a', [], { title: 'x'.repeat(200) })])))
    const labelOf = /"label": "([^"]*)"/.exec(draft.source)?.[1] ?? ''
    const tag = readLabelTag(labelOf)

    expect(labelOf.length).toBeLessThanOrEqual(80)
    expect(tag).toMatchObject({ missionId: 'mission-abc1', taskId: 'a' })
  })

  it('counts the estimate from the plan: agents, levels, and the widest level at once', () => {
    const draft = ok(draftScript(mission([task('a'), task('b'), task('c'), task('d', ['a', 'b', 'c'])])))

    expect(draft.estimate).toMatchObject({ agents: 4, levels: 2, widest: 3, typed: 4 })
    expect(estimateLines(draft).join('\n')).toMatch(/4 agents in 2 levels, at most 3 at once/)
    expect(estimateLines(draft).join('\n')).toMatch(/tokens, time and cost: n\/a/)
  })

  it('one level of independent tasks is as wide as the plan', () => {
    expect(ok(draftScript(mission([task('a'), task('b')]))).estimate).toMatchObject({ levels: 1, widest: 2 })
    expect(ok(draftScript(mission([task('a'), task('b', ['a'])]))).estimate).toMatchObject({ levels: 2, widest: 1 })
  })

  it('refuses what cannot be one reviewed script: no tasks, a circle, a duplicate id, too many', () => {
    expect(draftScript(mission([]))).toMatchObject({ ok: false, why: expect.stringMatching(/no tasks/) })
    expect(draftScript(mission([task('a', ['b']), task('b', ['a'])]))).toMatchObject({ ok: false, why: expect.stringMatching(/circle/) })
    expect(draftScript(mission([task('a'), task('a')]))).toMatchObject({ ok: false, why: expect.stringMatching(/share an id/) })
    expect(draftScript(mission(Array.from({ length: MAX_AGENTS + 1 }, (_, i) => task(`t${i}`))))).toMatchObject({ ok: false })
    expect(draftScript(mission(Array.from({ length: MAX_AGENTS }, (_, i) => task(`t${i}`)))).ok).toBe(true)
  })

  it('a dependency the plan lacks is ignored and reported, not fatal', () => {
    const draft = ok(draftScript(mission([task('a', ['ghost'])])))

    expect(draft.warnings.join('\n')).toMatch(/ghost/)
    expect(draft.estimate.levels).toBe(1)
  })

  it('mission text is data, never code: quotes, backticks, ${} and newlines cannot break out', async () => {
    const hostile = 'x"; process.exit(1); `${process.exit(2)}` \n */ //'
    const draft = ok(draftScript(mission([task('a', [], { title: hostile, requirement: hostile })], { objective: hostile })))
    const { calls } = await run(draft.source)

    expect(calls).toHaveLength(1)
    expect(calls[0]?.prompt).toContain('process.exit(1)')
  })

  it('masks a credential in the objective, title and requirement before it is in the script', () => {
    const secret = 'sk-ABCDEFGHIJKLMNOPQRSTUVWX12345'
    const draft = ok(draftScript(mission([task('a', [], { title: `use ${secret}`, requirement: `token=${secret}` })], { objective: `Bearer ${secret}` })))

    expect(draft.source).not.toContain(secret)
    expect(draft.source).toContain('‹masked›')
  })

  it('names the subagent type only for a role Claude Code is known to resolve; the rest ride in the prompt', async () => {
    const draft = ok(draftScript(mission([task('a', [], { agent: 'coder' }), task('b', [], { agent: 'reasoningbank-learner' })])))
    const { calls } = await run(draft.source)

    expect(draft.estimate.typed).toBe(1)
    expect(calls.find(call => call.prompt.includes('task a'))?.opts).toHaveProperty('agentType', 'coder')
    expect(calls.find(call => call.prompt.includes('task b'))?.opts).not.toHaveProperty('agentType')
    expect(calls.find(call => call.prompt.includes('task b'))?.prompt).toMatch(/Act as: reasoningbank-learner/)
  })

  it('an id that cannot be tagged still drafts, and says its agent will be unlinked', () => {
    const draft = ok(draftScript(mission([task('has space')])))

    expect(draft.warnings.join('\n')).toMatch(/unlinked/)
  })

  it('a stage per level names the phases once, in order', () => {
    const draft = ok(draftScript(mission([task('a', [], { stage: 'Research' }), task('b', ['a'], { stage: 'Build' }), task('c', ['b'], { stage: 'Build' })])))

    expect(draft.estimate.phases).toEqual(['Research', 'Build'])
  })
})

describe('levelsOf', () => {
  it('puts a task one level below its deepest dependency', () => {
    expect(levelsOf([task('a'), task('b', ['a']), task('c', ['a', 'b'])])).toEqual([[0], [1], [2]])
  })
})
