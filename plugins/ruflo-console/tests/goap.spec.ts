import { describe, expect, it } from 'vitest'

import { DEFAULT_LOOP, gatesOf, isWriter, lifecycleOf, loopCommand, plan, profileOf, PROFILES, RIGORS, STAGES, toMissionPlan, type Plan } from '../hooks/goap'

const must = (profile: Parameters<typeof plan>[0], rigor: Parameters<typeof plan>[1]): Plan => plan(profile, rigor) as Plan
const ids = (p: Plan) => p.steps.map(step => step.action.id)

describe('goal-oriented action planner over SPARC', () => {
  it('a feature plans S before A before R before C, with tests written before the change', () => {
    const p = must('feature', 'standard')
    const order = ids(p)

    expect(order.indexOf('specify')).toBeLessThan(order.indexOf('architect'))
    expect(order.indexOf('architect')).toBeLessThan(order.indexOf('tests-first'))
    expect(order.indexOf('tests-first')).toBeLessThan(order.indexOf('implement'))
    expect(order.indexOf('implement')).toBeLessThan(order.indexOf('verify-tests'))
    expect(order.indexOf('verify-tests')).toBeLessThan(order.indexOf('integrate'))
    expect(order.indexOf('verify')).toBeLessThan(order.indexOf('learn'))
    expect(order.at(-1)).toBe('learn')
    expect(order).toContain('pseudocode')
    expect(order).toContain('review')
    expect(order).toContain('document')
  })

  it('reaches the goal: every goal fact is given by some step, and every precondition is met before its step', () => {
    for (const { id } of PROFILES) {
      for (const rigor of RIGORS) {
        const p = must(id, rigor)
        const have = new Set<string>()

        for (const step of p.steps) {
          expect(step.action.needs.every(fact => have.has(fact)), `${id}/${rigor}: ${step.action.id}`).toBe(true)
          for (const fact of step.gives) have.add(fact)
        }

        expect(p.goal.every(fact => have.has(fact)), `${id}/${rigor} goal`).toBe(true)
      }
    }
  })

  it('rigor changes the plan: lean drops review and documentation, thorough adds gates, and cost grows with it', () => {
    const lean = must('feature', 'lean')
    const standard = must('feature', 'standard')
    const thorough = must('feature', 'thorough')

    expect(ids(lean)).not.toContain('review')
    expect(ids(lean)).not.toContain('document')
    expect(ids(thorough)).toContain('security-review')
    expect(lean.totalCost).toBeLessThan(standard.totalCost)
    expect(standard.totalCost).toBeLessThan(thorough.totalCost)
  })

  it('the profile changes the plan: a bug fix reproduces and diagnoses first and skips specification; a refactor pins behaviour first', () => {
    const bug = must('bugfix', 'standard')
    const refactor = must('refactor', 'standard')
    const security = must('security', 'standard')

    expect(ids(bug).indexOf('reproduce')).toBeLessThan(ids(bug).indexOf('diagnose'))
    expect(ids(bug).indexOf('diagnose')).toBeLessThan(ids(bug).indexOf('tests-first'))
    expect(ids(bug)).not.toContain('specify')
    expect(ids(refactor).indexOf('baseline')).toBeLessThan(ids(refactor).indexOf('architect-refactor'))
    expect(ids(security)).toContain('threat-model')
    expect(ids(security)).toContain('security-review')
    expect(ids(must('research', 'standard'))).toEqual(expect.arrayContaining(['research-context', 'specify', 'investigate', 'write-up', 'learn-findings']))
    expect(ids(must('research', 'lean'))).toEqual(['specify', 'investigate'])
  })

  it('is optimal: no plan found by brute force over the same actions costs less', () => {
    // The feature goal needs exactly these gates; each has one cheapest producer, so the sum is the minimum.
    const p = must('feature', 'lean')

    expect(p.totalCost).toBe(2 + 3 + 2 + 4 + 6 + 3 + 3 + 2)
  })

  it('reads parallel branches off the preconditions: pseudocode and architecture share a wave; the critical path is below the total', () => {
    const p = must('feature', 'standard')
    const by = (id: string) => p.steps.find(step => step.action.id === id)

    expect(by('pseudocode')?.wave).toBe(by('architect')?.wave)
    expect(by('review')?.wave).toBe(by('verify-tests')?.wave)
    expect(p.criticalCost).toBeLessThan(p.totalCost)
    expect(p.waves.flat().sort()).toEqual(p.steps.map(step => step.id).sort())
  })

  it('is deterministic', () => {
    expect(JSON.stringify(must('feature', 'standard'))).toBe(JSON.stringify(must('feature', 'standard')))
  })

  it('reads the profile from the goal’s words', () => {
    expect(profileOf('fix the login crash on empty password')).toBe('bugfix')
    expect(profileOf('refactor the memory module to remove duplication')).toBe('refactor')
    expect(profileOf('harden the upload endpoint against injection')).toBe('security')
    expect(profileOf('investigate why recall drops after consolidation')).toBe('research')
    expect(profileOf('add a dark mode toggle to settings')).toBe('feature')
  })

  it('turns the plan into a body mission_plan accepts: session-bound tasks, valid ids, an acyclic graph, a criterion per goal fact, a positive ceiling', () => {
    const p = must('feature', 'standard')
    const body = toMissionPlan(p)
    const known = new Set(body.tasks.map(task => task.id))
    const SHORT_ID = /^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/

    expect(body.tasks.every(task => SHORT_ID.test(task.id) && task.executor.mode === 'session-bound' && task.title.length <= 200)).toBe(true)
    expect(body.tasks.every(task => task.dependsOn.every(dep => known.has(dep)))).toBe(true)
    expect(body.tasks.every((task, i) => task.dependsOn.every(dep => body.tasks.findIndex(other => other.id === dep) < i))).toBe(true)
    expect(body.acceptance.map(criterion => criterion.id).sort()).toEqual(p.goal.map(fact => `ac-${fact}`).sort())
    expect(body.acceptance.find(criterion => criterion.id === 'ac-verified')?.independent).toBe(true)
    expect(body.budget.currency).toBe('USD')
    expect(body.budget.ceilingMinor).toBeGreaterThan(p.totalCost * 100)
    expect(body.budget.concurrency).toBeGreaterThanOrEqual(2)
    expect(body.tasks.length).toBeLessThanOrEqual(100)
  })

  it('standard and thorough run the whole lifecycle in order: research, create (ADRs, SOP), build, test, validate, secure, benchmark, learn; lean is the core', () => {
    for (const profile of ['feature', 'refactor', 'security'] as const) {
      for (const rigor of ['standard', 'thorough'] as const) {
        const stages = lifecycleOf(must(profile, rigor)).map(entry => entry.stage)

        expect(stages, `${profile}/${rigor}`).toEqual([...STAGES].filter(stage => stages.includes(stage)))
        expect(stages, `${profile}/${rigor}`).toEqual(expect.arrayContaining(['Research', 'Create', 'Build', 'Test', 'Validate', 'Secure', 'Benchmark', 'Learn']))
      }
    }

    const feature = ids(must('feature', 'standard'))

    expect(feature).toContain('record-decisions')
    expect(feature.indexOf('architect')).toBeLessThan(feature.indexOf('record-decisions'))
    expect(feature.indexOf('research-context')).toBeLessThan(feature.indexOf('record-decisions'))
    expect(feature.indexOf('implement')).toBeLessThan(feature.indexOf('security-review'))
    expect(feature.indexOf('implement')).toBeLessThan(feature.indexOf('benchmark'))
    expect(lifecycleOf(must('feature', 'lean')).map(entry => entry.stage)).not.toEqual(expect.arrayContaining(['Secure', 'Benchmark', 'Learn']))
    expect(lifecycleOf(must('bugfix', 'standard')).map(entry => entry.stage)).toEqual(expect.arrayContaining(['Research', 'Secure', 'Learn']))
    expect(lifecycleOf(must('research', 'standard')).map(entry => entry.stage)).toContain('Learn')
  })
})

describe('loop-centric helpers (ADR-441)', () => {
  it('the defaults are the stated ones: 5m, worktrees on, commit on, push and publish off, six writers', () => {
    expect(DEFAULT_LOOP).toEqual({ loopInterval: '5m', loopWorktrees: true, loopCommit: true, loopPush: false, loopPublish: false, loopWriters: 6 })
  })

  it('the loop command is one bounded line carrying the interval', () => {
    expect(loopCommand('add  a\ndark mode', DEFAULT_LOOP)).toBe('/loop 5m add a dark mode')
    expect(loopCommand('x', { ...DEFAULT_LOOP, loopInterval: '15m' })).toBe('/loop 15m x')
    expect(loopCommand('y'.repeat(500), DEFAULT_LOOP).length).toBe('/loop 5m '.length + 500)
  })

  it('the gates always include the tests and follow what the plan must prove', () => {
    expect(gatesOf(must('bugfix', 'lean'))).toEqual(['the full test suite', 'the build and smoke checks'])
    expect(gatesOf(must('feature', 'thorough'))).toEqual(['the full test suite', 'the build and smoke checks', 'the review', 'the security review', 'the benchmark against the baseline'])
  })

  it('writers are the agents that change files; researchers and reviewers only read', () => {
    const p = must('feature', 'standard')

    expect(p.steps.filter(step => step.action.id === 'implement').every(step => isWriter(step.action))).toBe(true)
    expect(p.steps.filter(step => ['research-context', 'review', 'security-review'].includes(step.action.id)).some(step => isWriter(step.action))).toBe(false)
  })
})
