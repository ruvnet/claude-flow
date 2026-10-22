/**
 * A goal-oriented action planner (GOAP) over the SPARC method. The world is a set of facts (specified, architected,
 * tested, ...); an action has preconditions, effects and a cost; the planner finds the cheapest action sequence that
 * reaches the goal's facts with A*, then reads the task graph off the preconditions (an action depends on the actions
 * that produced the facts it needs), so independent branches (pseudocode beside architecture) are parallel. The goal
 * changes with the kind of work (profile) and how thorough it must be (rigor), so a lean bug fix and a thorough security
 * change plan differently from the same action library. Pure: no I/O, deterministic for the same input.
 *
 * Every mission follows one lifecycle, whatever the work: Research, Create (specification, design, ADRs and the SOP), Build,
 * Test, Validate, Secure, Benchmark, Learn (the outcome is stored and the router and neural patterns trained, so the next
 * mission starts better). Lean drops the middle stages; standard and thorough run them all. Underneath, SPARC phases order the work:
 *
 * SPARC phases: S specification, P pseudocode, A architecture, R refinement (tests first, then the change), C completion
 * (integrate, document, verify); X is a cross-cutting gate (review, security review, benchmark).
 */

export type Profile = 'feature' | 'bugfix' | 'refactor' | 'security' | 'research'
export type Rigor = 'lean' | 'standard' | 'thorough'
export type Phase = 'S' | 'P' | 'A' | 'R' | 'C' | 'X'

export const PROFILES: readonly { id: Profile; label: string; about: string }[] = [
  { id: 'feature', label: 'feature', about: 'research, specify, design + ADRs, tests first, build, validate, secure, benchmark, learn' },
  { id: 'bugfix', label: 'bug fix', about: 'research, reproduce, diagnose, a regression test first, fix, validate, secure, learn' },
  { id: 'refactor', label: 'refactor', about: 'research, pin behaviour, redesign + ADRs, change, validate, secure, benchmark, learn' },
  { id: 'security', label: 'security', about: 'research, threat model, design + ADRs, tests first, build, secure, benchmark, learn' },
  { id: 'research', label: 'research', about: 'research the prior art, specify the question, investigate, write it up, learn' },
]
export const RIGORS: readonly Rigor[] = ['lean', 'standard', 'thorough']

export const PHASE_NAME: Record<Phase, string> = { S: 'Specification', P: 'Pseudocode', A: 'Architecture', R: 'Refinement', C: 'Completion', X: 'Gate' }

export type Action = { id: string; phase: Phase; title: string; needs: readonly string[]; gives: readonly string[]; cost: number; agent: string; requirement: string }

const act = (id: string, phase: Phase, title: string, needs: readonly string[], gives: readonly string[], cost: number, agent: string, requirement: string): Action => ({ id, phase, title, needs, gives, cost, agent, requirement })

/** Every action the planner may use; a profile's goal decides which of them a plan needs. */
const LIBRARY: readonly Action[] = [
  act('research-context', 'S', 'Research prior art, existing ADRs and memory', [], ['context-researched'], 2, 'researcher', 'what already exists (code, ADRs, memory patterns) and what is reusable, with sources'),
  act('specify', 'S', 'Specify the requirements and acceptance criteria', [], ['specified'], 2, 'specification', 'a written specification with testable acceptance criteria'),
  act('reproduce', 'S', 'Reproduce the problem with a failing case', [], ['reproduced'], 2, 'tester', 'a deterministic failing reproduction'),
  act('diagnose', 'S', 'Diagnose the root cause', ['reproduced'], ['diagnosed'], 3, 'researcher', 'the root cause named, with evidence from the code'),
  act('baseline', 'S', 'Pin current behaviour with characterization tests', [], ['baselined'], 3, 'tester', 'tests that pass on the unchanged code and fail if behaviour moves'),
  act('threat-model', 'S', 'Threat-model the change', [], ['threat-modeled'], 3, 'security-architect', 'a threat list with the mitigation each one needs'),
  act('investigate', 'S', 'Investigate the question', ['specified'], ['researched'], 4, 'researcher', 'findings with sources, and what is still unknown'),
  act('pseudocode', 'P', 'Write the pseudocode for the core logic', ['specified'], ['pseudocoded'], 2, 'pseudocode', 'step-by-step logic covering every acceptance criterion'),
  act('fix-design', 'P', 'Design the smallest fix', ['diagnosed'], ['pseudocoded', 'architected'], 2, 'architecture', 'the minimal change that removes the cause'),
  act('architect', 'A', 'Design the architecture and interfaces', ['specified'], ['architected'], 3, 'architecture', 'modules, interfaces and data flow, with the decisions recorded'),
  act('architect-refactor', 'A', 'Design the target structure', ['baselined'], ['architected', 'pseudocoded'], 3, 'architecture', 'the target structure and the steps to reach it'),
  act('architect-secure', 'A', 'Design the secure structure', ['threat-modeled'], ['architected', 'pseudocoded'], 3, 'security-architect', 'a design that closes each modeled threat'),
  act('record-decisions', 'A', 'Record the decisions as ADRs and write the SOP', ['architected', 'context-researched'], ['adr-recorded'], 2, 'adr-architect', 'an ADR per decision and a short SOP for running and changing it, linked from the code'),
  act('tests-first', 'R', 'Write the failing tests first', ['architected', 'pseudocoded'], ['tests-written'], 4, 'tester', 'tests that fail for the right reason before the change'),
  act('implement', 'R', 'Implement until the tests pass', ['tests-written'], ['implemented'], 6, 'coder', 'the change, with the new tests passing and no others broken'),
  act('verify-tests', 'R', 'Run the full test suite', ['implemented'], ['tested'], 3, 'tester', 'the whole suite green, the output kept as evidence'),
  act('review', 'X', 'Review the change', ['implemented'], ['reviewed'], 3, 'reviewer', 'a review with every finding resolved or accepted'),
  act('security-review', 'X', 'Security review', ['implemented'], ['secured'], 4, 'security-auditor', 'no open high-severity finding'),
  act('benchmark', 'X', 'Benchmark against the baseline', ['implemented'], ['benchmarked'], 4, 'performance-engineer', 'measurements no worse than the baseline'),
  act('document', 'C', 'Document the change', ['implemented'], ['documented'], 2, 'api-docs', 'the docs match the shipped behaviour'),
  act('integrate', 'C', 'Integrate: build and CI', ['tested'], ['integrated'], 3, 'cicd-engineer', 'the build and CI checks pass'),
  act('verify', 'C', 'Validate the result against the goal', ['tested', 'integrated'], ['verified'], 2, 'production-validator', 'every acceptance criterion checked by something other than the author'),
  act('learn', 'C', 'Learn: store the outcome and self-optimize', ['verified'], ['learned'], 2, 'reasoningbank-learner', 'the outcome stored as patterns (memory and trajectory) and routing trained on it, so the next mission starts better'),
  act('learn-findings', 'C', 'Learn: store the findings and self-optimize', ['researched'], ['learned'], 2, 'reasoningbank-learner', 'the findings stored as patterns with their sources, so the next investigation starts better'),
  act('write-up', 'C', 'Write up the findings', ['researched'], ['documented'], 2, 'researcher', 'a readable write-up a reader can act on'),
]

/** The lifecycle every mission follows, in order. */
export const STAGES = ['Research', 'Create', 'Build', 'Test', 'Validate', 'Secure', 'Benchmark', 'Learn'] as const
export type Stage = (typeof STAGES)[number]

const STAGE_OF: Record<string, Stage> = {
  'research-context': 'Research', investigate: 'Research', reproduce: 'Research', diagnose: 'Research', baseline: 'Research', 'threat-model': 'Research',
  specify: 'Create', pseudocode: 'Create', 'fix-design': 'Create', architect: 'Create', 'architect-refactor': 'Create', 'architect-secure': 'Create', 'record-decisions': 'Create', 'write-up': 'Create',
  'tests-first': 'Build', implement: 'Build', document: 'Build',
  'verify-tests': 'Test', integrate: 'Test',
  review: 'Validate', verify: 'Validate',
  'security-review': 'Secure',
  benchmark: 'Benchmark',
  learn: 'Learn', 'learn-findings': 'Learn',
}

export const stageOf = (action: Action): Stage => STAGE_OF[action.id] ?? 'Build'

/** Facts the goal needs, by profile, then by what thoroughness adds or drops. Lean is the core; standard runs the whole lifecycle. */
function goalOf(profile: Profile, rigor: Rigor): string[] {
  const base: Record<Profile, string[]> = {
    feature: ['specified', 'architected', 'tested', 'integrated', 'verified'],
    bugfix: ['reproduced', 'diagnosed', 'tested', 'integrated', 'verified'],
    refactor: ['baselined', 'tested', 'integrated', 'verified'],
    security: ['threat-modeled', 'tested', 'secured', 'integrated', 'verified'],
    research: ['specified', 'researched', 'documented'],
  }
  const goal = [...base[profile]]

  if (rigor === 'lean') return profile === 'research' ? ['specified', 'researched'] : goal

  goal.push('context-researched', 'learned')
  if (profile === 'research') return [...new Set(goal)]

  goal.push('reviewed', 'secured')
  if (profile !== 'bugfix') goal.push('adr-recorded', 'benchmarked')
  if (profile === 'feature') goal.push('documented')
  if (rigor === 'thorough') goal.push('documented', 'adr-recorded', 'benchmarked', ...(profile === 'security' ? [] : ['threat-modeled']))

  return [...new Set(goal)]
}

const key = (facts: ReadonlySet<string>) => [...facts].sort().join('|')

export type Step = { id: string; action: Action; dependsOn: string[]; wave: number; gives: readonly string[] }

export type Plan = {
  profile: Profile
  rigor: Rigor
  goal: string[]
  steps: Step[]
  /** Task ids by wave: everything in a wave can run at once. */
  waves: string[][]
  totalCost: number
  /** The most expensive chain of dependent steps: the plan cannot finish faster than this. */
  criticalCost: number
}

/** The facts that can matter: the goal's, and (backward) the preconditions of any action that gives a fact that matters. */
function relevantFacts(goal: readonly string[]): Set<string> {
  const relevant = new Set(goal)
  let grew = true

  while (grew) {
    grew = false

    for (const action of LIBRARY) {
      if (!action.gives.some(fact => relevant.has(fact))) continue

      for (const fact of action.needs) {
        if (!relevant.has(fact)) {
          relevant.add(fact)
          grew = true
        }
      }
    }
  }

  return relevant
}

type Node = { facts: ReadonlySet<string>; g: number; f: number; path: readonly Action[] }

/** A binary min-heap on f, then on path length, then on the path's action ids (so ties are deterministic). */
class Heap {
  private items: Node[] = []
  private before = (x: Node, y: Node) => (x.f - y.f || x.path.length - y.path.length || x.path.map(step => step.id).join().localeCompare(y.path.map(step => step.id).join())) < 0

  get size() {
    return this.items.length
  }

  push(node: Node): void {
    const items = this.items
    let i = items.push(node) - 1

    while (i > 0) {
      const parent = (i - 1) >> 1

      if (!this.before(items[i] as Node, items[parent] as Node)) break
      ;[items[i], items[parent]] = [items[parent] as Node, items[i] as Node]
      i = parent
    }
  }

  pop(): Node {
    const items = this.items
    const top = items[0] as Node
    const last = items.pop() as Node

    if (items.length > 0) {
      items[0] = last

      let i = 0

      for (;;) {
        const left = 2 * i + 1
        const right = left + 1
        let small = i

        if (left < items.length && this.before(items[left] as Node, items[small] as Node)) small = left
        if (right < items.length && this.before(items[right] as Node, items[small] as Node)) small = right
        if (small === i) break
        ;[items[i], items[small]] = [items[small] as Node, items[i] as Node]
        i = small
      }
    }

    return top
  }
}

/** The cheapest plan to the goal by A* over fact sets, or null when the goal cannot be reached. */
export function plan(profile: Profile, rigor: Rigor): Plan | null {
  const goal = goalOf(profile, rigor)
  const relevant = relevantFacts(goal)
  // Only actions that give a fact that matters can be on a cheapest path.
  const actions = LIBRARY.filter(action => action.gives.some(fact => relevant.has(fact)))
  const cheapestFor = (fact: string) => Math.min(...actions.filter(action => action.gives.includes(fact)).map(action => action.cost), Number.POSITIVE_INFINITY)
  // Admissible: the dearest single unmet goal fact must still be paid for by some action.
  const heuristic = (facts: ReadonlySet<string>) => Math.max(0, ...goal.filter(fact => !facts.has(fact)).map(cheapestFor).filter(Number.isFinite))
  const open = new Heap()
  const best = new Map<string, number>([['', 0]])

  open.push({ facts: new Set(), g: 0, f: heuristic(new Set()), path: [] })

  while (open.size > 0) {
    const node = open.pop()

    if (goal.every(fact => node.facts.has(fact))) return build(profile, rigor, goal, node.path)

    for (const action of actions) {
      if (!action.needs.every(fact => node.facts.has(fact)) || action.gives.every(fact => node.facts.has(fact))) continue

      const facts = new Set([...node.facts, ...action.gives].filter(fact => relevant.has(fact)))
      const g = node.g + action.cost
      const k = key(facts)

      if (best.has(k) && (best.get(k) as number) <= g) continue

      best.set(k, g)
      open.push({ facts, g, f: g + heuristic(facts), path: [...node.path, action] })
    }
  }

  return null
}

/** Reads the task graph off the preconditions: a step depends on the steps that produced the facts it needs. */
function build(profile: Profile, rigor: Rigor, goal: string[], path: readonly Action[]): Plan {
  const producer = new Map<string, string>()
  const steps: Step[] = []

  for (const [i, action] of path.entries()) {
    const id = `t${i + 1}`
    const dependsOn = [...new Set(action.needs.map(fact => producer.get(fact)).filter((dep): dep is string => dep !== undefined))]

    for (const fact of action.gives) producer.set(fact, id)
    steps.push({ id, action, dependsOn, wave: 0, gives: action.gives })
  }

  // Waves: a step runs one wave after the latest of its dependencies.
  for (const step of steps) step.wave = step.dependsOn.length === 0 ? 0 : Math.max(...step.dependsOn.map(dep => (steps.find(candidate => candidate.id === dep) as Step).wave)) + 1

  const waves: string[][] = []

  for (const step of steps) (waves[step.wave] ??= []).push(step.id)

  const cost = new Map<string, number>()

  for (const step of steps) cost.set(step.id, step.action.cost + Math.max(0, ...step.dependsOn.map(dep => cost.get(dep) ?? 0)))

  return { profile, rigor, goal, steps, waves, totalCost: path.reduce((sum, action) => sum + action.cost, 0), criticalCost: Math.max(0, ...cost.values()) }
}

/** Profile read from the goal's words: a bug, a refactor, a vulnerability, a question; otherwise a feature. */
export function profileOf(objective: string): Profile {
  const text = objective.toLowerCase()

  if (/\b(bug|fix|broken|crash|regression|fails?|error|defect)\b/.test(text)) return 'bugfix'
  if (/\b(security|vulnerab\w*|cve|exploit|injection|xss|csrf|auth(?:entication|orization)?|harden)\b/.test(text)) return 'security'
  if (/\b(refactor|clean ?up|restructure|simplify|rename|reorgani[sz]e|tidy)\b/.test(text)) return 'refactor'
  if (/\b(research|investigate|explain|explore|compare|evaluate|study|why does)\b/.test(text)) return 'research'

  return 'feature'
}

const FACT_CHECK: Record<string, string> = {
  specified: 'a specification exists and every requirement has a testable acceptance criterion',
  reproduced: 'the problem is reproduced by a deterministic failing case',
  diagnosed: 'the root cause is identified with evidence',
  baselined: 'characterization tests pass on the unchanged code',
  'threat-modeled': 'a threat model lists each threat and its mitigation',
  architected: 'the design is written down: modules, interfaces and decisions',
  researched: 'findings are recorded with their sources',
  tested: 'the whole test suite passes, including the new tests',
  reviewed: 'review findings are resolved or explicitly accepted',
  secured: 'no open high-severity security finding',
  benchmarked: 'measurements are no worse than the baseline',
  documented: 'documentation matches the shipped behaviour',
  integrated: 'build and CI checks pass',
  verified: 'every acceptance criterion is checked by something other than the author',
  'context-researched': 'prior art, existing ADRs and memory are searched and what is reusable is recorded',
  'adr-recorded': 'each decision is an ADR and a short SOP says how to run and change it',
  learned: 'the outcome is stored as patterns and routing is trained on it',
}

const ID = /[^A-Za-z0-9._-]/g

/** The plan as `mission_plan`'s plan body: tasks run by the Claude Code session itself (session-bound), a criterion per goal fact, and a ceiling. */
export function toMissionPlan(p: Plan, budgetMinorPerUnit = 100) {
  const criterionFor = (fact: string) => `ac-${fact.replace(ID, '-')}`
  const tasks = p.steps.map(step => ({
    id: step.id,
    title: `${PHASE_NAME[step.action.phase]}: ${step.action.title}`.slice(0, 200),
    dependsOn: step.dependsOn,
    executor: { mode: 'session-bound' as const, requirement: `${step.action.agent}: ${step.action.requirement}`.slice(0, 200) },
    capabilityCeiling: [] as string[],
    estimatedCostMinor: step.action.cost * budgetMinorPerUnit,
    checkpoint: `${step.action.phase}-${step.action.id}`,
    acceptanceEvidence: step.gives.filter(fact => p.goal.includes(fact)).map(criterionFor),
  }))
  const acceptance = p.goal.map(fact => ({
    id: criterionFor(fact),
    check: FACT_CHECK[fact] ?? fact,
    inputs: [] as string[],
    producer: p.steps.find(step => step.gives.includes(fact))?.id ?? 'plan',
    independent: fact === 'verified' || fact === 'reviewed' || fact === 'secured' || fact === 'benchmarked',
    mandatory: true,
  }))

  return {
    tasks,
    acceptance,
    budget: { currency: 'USD', ceilingMinor: Math.max(1, Math.round(p.totalCost * budgetMinorPerUnit * 1.25)), concurrency: Math.max(1, ...p.waves.map(wave => wave.length)) },
    scope: { capabilities: [] as string[] },
  }
}

/**
 * How a mission is driven (ADR-441): a bounded `/loop` whose every tick checks progress, fixes failures and runs the named gates until
 * the finish condition holds. Writers get isolated worktrees and disjoint files. These are the user's settings; the defaults are stated
 * up front so the loop never stops to ask. Nothing leaves the mission branch (push, publish) unless its setting is on.
 */
export const LOOP_INTERVALS = ['2m', '5m', '10m', '15m', '30m'] as const
export const WRITER_CAPS = [1, 2, 4, 6, 8] as const
export type LoopPrefs = {
  loopInterval: (typeof LOOP_INTERVALS)[number]
  /** Every writing agent works in its own git worktree. */
  loopWorktrees: boolean
  /** The loop may commit to the mission branch. */
  loopCommit: boolean
  loopPush: boolean
  loopPublish: boolean
  loopWriters: (typeof WRITER_CAPS)[number]
}
export const DEFAULT_LOOP: LoopPrefs = { loopInterval: '5m', loopWorktrees: true, loopCommit: true, loopPush: false, loopPublish: false, loopWriters: 6 }

/** Agents that change files; the rest (research, review, audit, validate) only read. */
const WRITERS = new Set(['coder', 'tester', 'api-docs', 'adr-architect', 'specification', 'pseudocode', 'architecture', 'security-architect', 'cicd-engineer', 'reasoningbank-learner'])
export const isWriter = (action: Action): boolean => WRITERS.has(action.agent)

/** The named gates a tick runs, from what the plan must prove: always the tests, then each check the plan's goal asks for. */
export function gatesOf(p: Plan): string[] {
  const gates = ['the full test suite']
  const add = (fact: string, gate: string) => p.goal.includes(fact) && gates.push(gate)

  add('integrated', 'the build and smoke checks')
  add('reviewed', 'the review')
  add('secured', 'the security review')
  add('benchmarked', 'the benchmark against the baseline')

  return gates
}

/** The one line that starts the loop: `/loop <interval> <objective>`, the whole objective on one line (line breaks become spaces; ADR-481). */
export const loopCommand = (goal: string, prefs: LoopPrefs): string => `/loop ${prefs.loopInterval} ${goal.replace(/\s+/g, ' ').trim()}`

/** The stages a plan runs, in lifecycle order, each with how many steps it holds. */
export const lifecycleOf = (p: Plan): { stage: Stage; steps: number }[] =>
  STAGES.map(stage => ({ stage, steps: p.steps.filter(step => stageOf(step.action) === stage).length })).filter(entry => entry.steps > 0)
