/**
 * Mission Control: a goal becomes a SPARC plan (goap.ts), the plan becomes a governed mission (`mission_create`,
 * `mission_plan`) and one ruflo task per plan node (`task_create`, tagged `mission:<id>` and `task:<tN>`), and the
 * primary Claude Code session does the work. The ruflo task store is the one authority for execution state: the console
 * reads it, never infers it. Claude is handed one ready task at a time as a visible prompt (the person confirms it, or
 * opts into auto-run), records the outcome with `task_complete` (evidence in its result) or `task_update` failed, and the
 * console moves on. Pause, resume and cancel are the console's own ledger (a session-bound mission has no durable
 * executor to pause). Every ledger change is an ordered event {seq, type, taskId, status, evidenceRef}.
 */
import type { ActionSpec } from './actions'
import { PHASE_NAME, plan as planOf, stageOf, type Plan, type Profile, profileOf, type Rigor, toMissionPlan } from './goap'
import { capGate, capOf, refreshCost } from './mission-guard'
import type { Host } from './host'
import { plain, type TaskRecord } from './data/parse'
import { taskStatusOf } from './data/automate'
import { keepText } from './field-keep'
import { checkLimit, keepLines, LONG_TEXT_MAX, withBreaks } from './full-text'
import { isAvailable, MISSION_SKILLS, slashOf, GOALS_PLUGIN } from './mission-skills'
import { offerGuidance } from './mission-guidance'
import { blocksCreate, blocksGuidance, capUsd, isCapability, RESEARCH_DEFAULT_CAP, researchArgs, researchConfirm, researchWhy, screenText, type ResearchDepth } from './mission-options'
import type { Runner } from './runner'
import { CLI_PREFIXES, type State } from './state'
import type { Derived, LedgerEvent, LedgerTask, McState, McTab, MissionActions, MissionRecord } from './mission-types'

import { checkpointPlan } from './mission-advisor-live'
import { cancelSpec, createSpec, createWhy, dispatchSpec, isInflight, MAX_HANDOUTS, resultOf, setPaused } from './mission-specs'

export { cancelSpec, createSpec, createWhy, dispatchSpec, resultOf, setPaused }
export type { Derived, LedgerEvent, LedgerTask, McState, McTab, MissionActions, MissionRecord } from './mission-types'

const states = new WeakMap<State, McState>()
export const LEDGER_KEY = 'mission-ledger'

export function mcOf(state: State): McState {
  let found = states.get(state)

  if (found === undefined) {
    found = { goal: '', profile: 'feature', rigor: 'standard', isProfilePicked: false, planned: null, missions: new Map(), active: null, tab: 'plan', lastGuide: '', guidance: null, screen: null, isScreenOn: true, last: null }
    states.set(state, found)
  }

  return found
}

export const activeMission = (state: State): MissionRecord | null => {
  const mc = mcOf(state)

  return mc.active === null ? null : (mc.missions.get(mc.active) ?? null)
}

/** The goal typed in: plans it (a pure computation, nothing is written) with the profile the words or the person chose. */
export function setGoal(state: State, goal: string): void {
  const mc = mcOf(state)

  // Line breaks the person made (a pasted block, or a typed \n) stay in the goal; a destination that is one line (a slash command's arguments) joins them with spaces.
  mc.goal = keepLines(withBreaks(goal))
  mc.screen = null
  if (!mc.isProfilePicked) mc.profile = profileOf(mc.goal)
  mc.planned = mc.goal === '' ? null : planOf(mc.profile, mc.rigor)
}

export function setProfile(state: State, profile: Profile, rigor: Rigor): void {
  const mc = mcOf(state)

  mc.profile = profile
  mc.rigor = rigor
  mc.isProfilePicked = true
  mc.planned = mc.goal === '' ? null : planOf(profile, rigor)
}

/** The ruflo task a ledger task is, read from the task store by its id (the store is the authority). */
export const rufloTaskOf = (tasks: readonly TaskRecord[], task: LedgerTask): TaskRecord | undefined => tasks.find(candidate => candidate.id === task.rufloTaskId)

/** Where a ledger task stands: from the ruflo task store, plus whether its dependencies are done (ready) or not (waiting). */
export function derive(mission: MissionRecord, tasks: readonly TaskRecord[]): Map<string, Derived> {
  const out = new Map<string, Derived>()

  for (const task of mission.tasks) {
    // Read through taskStatusOf: a task stored as "complete" by an older CLI is done, never handed to Claude again.
    const status = taskStatusOf(rufloTaskOf(tasks, task)?.status)
    const done = (id: string) => out.get(id) === 'done'

    out.set(task.id, status === 'completed' ? 'done' : status === 'failed' ? 'failed' : status === 'cancelled' ? 'cancelled' : status === 'in_progress' || status === 'running' ? 'running' : task.dependsOn.every(done) ? 'ready' : 'waiting')
  }

  return out
}

/** The next task to hand to Claude: the first ready one in plan order, unless something is running, paused or cancelled. */
export function nextTask(mission: MissionRecord, tasks: readonly TaskRecord[]): LedgerTask | null {
  if (mission.paused || mission.cancelled) return null

  const status = derive(mission, tasks)

  if ([...status.values()].some(value => value === 'running' || value === 'failed')) return null

  return mission.tasks.find(task => status.get(task.id) === 'ready' && task.rufloTaskId !== undefined) ?? null
}

/**
 * Autopilot's narrow door (ADR-470 §2.2): the mission's own rule for handing a task over, with the one-at-a-time limit widened to `cap`.
 * Everything else is `nextTask`'s: not paused or cancelled, nothing failed, the task ready (its dependencies done) and in the task store.
 * `running` counts tasks the store shows in progress plus tasks handed over in the last seconds (the store has not refreshed yet).
 * `startable(m, tasks, t, 1)` is exactly `nextTask(m, tasks)?.id === t.id` as far as the running rule goes.
 */
export function startable(mission: MissionRecord, tasks: readonly TaskRecord[], task: LedgerTask, cap: number): boolean {
  if (mission.paused || mission.cancelled || task.rufloTaskId === undefined || isInflight(task)) return false

  const status = derive(mission, tasks)
  const values = [...status.values()]
  const running = mission.tasks.filter(candidate => status.get(candidate.id) === 'running' || (candidate !== task && isInflight(candidate))).length

  return !values.includes('failed') && status.get(task.id) === 'ready' && running < Math.max(1, cap)
}

export const progressOf = (mission: MissionRecord, tasks: readonly TaskRecord[]) => {
  const status = derive(mission, tasks)

  return { done: [...status.values()].filter(value => value === 'done').length, total: mission.tasks.length }
}

/** How many of the mission's tasks the ruflo task store shows as failed. */
export const failedOf = (mission: MissionRecord, tasks: readonly TaskRecord[]): number => [...derive(mission, tasks).values()].filter(value => value === 'failed').length

/** The instruction handed to the primary session for one task: what, as whom, what it must show, and how to record it. */
export function instructionOf(mission: MissionRecord, task: LedgerTask, adrBlock = ''): string {
  const criteria = mission.acceptance.slice(0, 8).map(criterion => `- ${criterion.check}`).join('\n')
  const deps = task.dependsOn.length === 0 ? 'none' : task.dependsOn.map(id => `${id} (${mission.tasks.find(candidate => candidate.id === id)?.title ?? ''})`).join(', ')

  return [
    `Mission ${mission.id}: ${mission.objective}`,
    `Task ${task.id} (${PHASE_NAME[task.phase as keyof typeof PHASE_NAME] ?? task.phase}): ${task.title}`,
    `Act as: ${task.agent}. It is done when: ${task.requirement}`,
    `Already done: ${deps}.`,
    `The mission's acceptance criteria, for context:\n${criteria}`,
    ...(adrBlock === '' ? [] : [adrBlock]),
    `When this task is finished, record it: call the ruflo MCP tool task_complete with taskId "${task.rufloTaskId ?? ''}" and a result object {summary, evidence} (evidence = files changed, commands run, test output). If you cannot finish it, call task_update with the same taskId, status "failed" and a result {reason}. Do not complete it unless "it is done when" is true. Keep this transcript to decisions and verified results.`,
  ].join('\n')
}

export function record(mission: MissionRecord, event: Omit<LedgerEvent, 'seq' | 'atMs'>): void {
  const seq = Math.max(0, ...mission.events.map(candidate => candidate.seq)) + 1

  mission.events.push({ seq, atMs: Date.now(), ...event })
  if (mission.events.length > 500) mission.events.splice(0, mission.events.length - 500)
}

export function saveLedger(state: State, host: Host): void {
  const mc = mcOf(state)

  void host.storeSet(LEDGER_KEY, { active: mc.active, missions: [...mc.missions.values()].slice(-20) }).catch(() => undefined)
}

export async function loadLedger(state: State, host: Host): Promise<void> {
  const saved = await host.storeGet(LEDGER_KEY).catch(() => undefined)
  const missions = (saved as { missions?: unknown } | undefined)?.missions
  const mc = mcOf(state)

  if (!Array.isArray(missions)) return

  for (const raw of missions.slice(0, 20)) {
    const m = raw as MissionRecord

    const isShaped = Array.isArray(m?.tasks) && m.tasks.every(task => typeof task?.id === 'string' && Array.isArray(task.dependsOn)) && Array.isArray(m.events)

    // Auto-run never survives a restart: a new session starts by asking.
    if (typeof m?.id === 'string' && /^msn_[a-f0-9]{24}$/.test(m.id) && isShaped) mc.missions.set(m.id, { ...m, auto: false, ...(Array.isArray(m.adrs) && { adrs: m.adrs.filter(file => typeof file === 'string' && /^[A-Za-z0-9][A-Za-z0-9._ -]{0,119}\.md$/.test(file)).slice(0, 8) }) })
  }

  const active = (saved as { active?: unknown }).active

  if (typeof active === 'string' && mc.missions.has(active)) mc.active = active
}

/**
 * The longest text a person's goal, question, aside or instruction may be (ADR-481). These reach Claude as a prompt or a slash command's
 * arguments through the session (no argv, no stdin of ours), and the AIDefence screen and guidance turn take the same text, so one bound serves.
 * Over it the action is refused with the exact count before anything is sent, and the field keeps the text.
 */
const MAX_TEXT = LONG_TEXT_MAX

/** The refusal for text over MAX_TEXT (the exact count), or null when it fits. Line breaks count as the spaces they become. */
export const longRefusal = (raw: string, what: string): string | null => {
  const fit = checkLimit(raw.replace(/\s+/g, ' ').trim(), MAX_TEXT, what, 'sent to Claude as one prompt')

  return fit.ok ? null : fit.message
}

/** The Enter that was refused: says why in the result line and puts the text back in its field. Returns true when it refused. */
function refusedLong(state: State, say: (label: string, ok: boolean, detail: string) => void, label: string, what: string, raw: string): boolean {
  const refusal = longRefusal(raw, what)

  if (refusal === null) return false

  keepText(state, raw)
  say(label, false, refusal)

  return true
}


/** The research start's inputs as typed (ADR-439): the question, the depth and the cap in dollars (text, validated when started). */
export type ResearchDraft = { question: string; depth: ResearchDepth; cap: string }
const drafts = new WeakMap<State, ResearchDraft>()

export function researchOf(state: State): ResearchDraft {
  let found = drafts.get(state)

  if (found === undefined) {
    found = { question: '', depth: 'standard', cap: RESEARCH_DEFAULT_CAP }
    drafts.set(state, found)
  }

  return found
}

export const setResearch = (state: State, patch: Partial<ResearchDraft>): void => void Object.assign(researchOf(state), patch)

const wired = new WeakMap<State, { host: Host; actions: MissionActions; research: () => void | Promise<void> }>()

/** The host, actions and research start Mission Control was wired with, for the palette and the headless commands. */
export const missionWired = (state: State) => wired.get(state)

export function missionActions(state: State, host: Host, runner: Runner): MissionActions {
  const mc = mcOf(state)
  const say = (label: string, ok: boolean, detail: string) => {
    mc.last = { label, ok, detail }
    host.invalidate()
  }
  const tasksNow = (): readonly TaskRecord[] => state.snapshot?.tasks ?? []

  /** Runs a slash command on the goal (or the active mission's objective) in the main UI: now when idle, prepared in the prompt box mid-turn. */
  const launch = (slash: string, label: string, custom?: { args: string; note: string; byModel?: boolean; byCall?: number }) => {
    const objective = activeMission(state)?.objective ?? mc.goal

    // A research start brings its own, already screened arguments; every other launch works on the goal.
    if (custom === undefined && objective.trim() === '') return say(label, false, 'type a goal first: it works on the goal')
    if (custom === undefined && blocksGuidance(mc.screen)) return say(`${label} blocked`, false, `AIDefence: ${mc.screen?.detail ?? ''}. Change the goal.`)

    // The whole goal: the arguments of a slash command are one line of the same prompt, so line breaks become spaces (the goal is one line).
    const args = custom?.args ?? plain(objective, MAX_TEXT)

    // It starts a model turn: asked first, with the exact command.
    runner.ask(
      {
        label: `run /${slash} on the goal in the main Claude UI`,
        ...(custom?.byModel === true && { byModel: true, byCall: custom.byCall }),
        scope: 'controls',
        args: [],
        shows: `/${slash} ${args}`,
        expect: 'the command in the main conversation',
        note: custom?.note ?? 'Starts a Claude Code turn (billed as any turn is); mid-turn it is only prepared in the prompt box.',
        run: async () => {
          if (state.turnActive) {
            void host.fillPrompt(`/${slash} ${args}`).then(
              isFilled => say(isFilled ? 'prepared in the prompt box' : 'no prompt box here', isFilled, `press Enter to run /${slash} in the main conversation`),
              () => say(label, false, 'the prompt box refused it'),
            )

            return
          }

          void host.runSlash(slash, args).then(
            () => say(`${label}: /${slash} is running`, true, 'in the main conversation: the pane follows the task store'),
            () => say(label, false, `/${slash} did not run`),
          )
        },
      },
      'type a goal first',
    )
  }

  /** Research start: validate, screen the question (always: it reaches the web), refuse when unsafe, then ask with the confirm in words. */
  const research = () => {
    const byModel = state.control.viaModel
    const byCall = state.control.callTag ?? undefined
    const draft = { ...researchOf(state) }
    const question = plain(draft.question, MAX_TEXT).trim()

    if (refusedLong(state, say, 'research', 'the question', draft.question)) return
    const cap = capUsd(draft.cap)
    const refused = researchWhy(question, cap)
    const skill = MISSION_SKILLS.find(candidate => candidate.id === 'deep-research')

    if (refused !== null || cap === null || skill === undefined) return say('research', false, refused ?? 'deep-research is not a ruflo-goals skill')
    if (!isAvailable(state, skill)) return say(`${slashOf(skill)} is not available`, false, `install the ${GOALS_PLUGIN} plugin (Plugin Catalog) and /reload-plugins`)

    return screenText(state, host, question).then(screen => {
      const now = researchOf(state)

      // The inputs moved while AIDefence looked: that verdict is about another question.
      if (now.question !== draft.question || now.depth !== draft.depth || now.cap !== draft.cap) return
      if (blocksGuidance(screen)) return say('AIDefence blocked the question', false, `${screen.detail}. Change the question.`)

      launch(slashOf(skill), 'deep research', { args: researchArgs(question, draft.depth, cap), note: researchConfirm(draft.depth, cap, screen), byModel, byCall })
    })
  }

  const actions: MissionActions = {
    goal: text => {
      if (refusedLong(state, say, 'goal not planned', 'the goal', text)) return

      setGoal(state, text)
      mc.tab = 'plan'
      mc.screen = null

      const goal = mc.goal

      // AIDefence looks at the goal first: an unsafe or PII-bearing goal is not sent to a model for guidance.
      if (!mc.isScreenOn || mc.planned === null) offerGuidance(state, host, runner, mc)
      else {
        mc.guidance = null
        void screenText(state, host, goal).then(screen => {
          if (mc.goal !== goal) return

          mc.screen = screen
          if (!blocksGuidance(screen)) offerGuidance(state, host, runner, mc)
          host.invalidate()
        })
      }

      host.invalidate()
    },
    askGuidance: () => (blocksGuidance(mc.screen) ? say('guidance blocked', false, `AIDefence: ${mc.screen?.detail ?? ''}. Change the goal.`) : offerGuidance(state, host, runner, mc)),
    capability: slash => (isCapability(state, slash) ? launch(slash, slash) : say(`${slash} is not available`, false, 'install that plugin (Plugin Catalog) and /reload-plugins')),
    screen: on => {
      mc.isScreenOn = on
      if (!on) mc.screen = null
      host.invalidate()
    },
    profile: profile => {
      setProfile(state, profile, mc.rigor)
      host.invalidate()
    },
    rigor: rigor => {
      setProfile(state, mc.profile, rigor)
      host.invalidate()
    },
    tab: tab => {
      mc.tab = tab
      host.invalidate()
    },
    create: () => runner.ask(blocksCreate(mc.screen) ? null : createSpec(state, host, () => { const made = activeMission(state); if (made !== null) checkpointPlan(state, host, made) }), blocksCreate(mc.screen) ? 'AIDefence flagged the goal: change it first' : (createWhy(state) ?? 'type a goal first: the plan is made from it')),
    select: id => {
      if (mc.missions.has(id)) mc.active = id
      saveLedger(state, host)
      host.invalidate()
    },
    next: () => {
      const mission = activeMission(state)

      if (mission === null) return say('no active mission', false, 'create one from a goal first')

      const task = nextTask(mission, tasksNow())

      if (task === null) return say('nothing to hand out', false, mission.paused ? 'the mission is paused' : mission.cancelled ? 'the mission is cancelled' : 'a task is running or failed, or none is ready: see Tasks')

      runner.ask(dispatchSpec(state, host, mission, task, text => host.submitPrompt(text)), 'nothing to hand out')
    },
    pause: () => setPaused(state, host, true),
    resume: by => setPaused(state, host, false, by),
    cancel: () => {
      const mission = activeMission(state)

      runner.ask(mission === null ? null : cancelSpec(state, host, mission, tasksNow()), 'no active mission to cancel')
    },
    auto: on => {
      const mission = activeMission(state)

      if (mission === null) return

      mission.auto = on
      record(mission, { type: on ? 'auto.on' : 'auto.off' })
      saveLedger(state, host)
      host.invalidate()
    },
    aside: question => {
      if (refusedLong(state, say, 'ask aside', 'the question', question)) return

      const q = plain(question, MAX_TEXT).trim()

      if (q === '') return say('ask aside', false, 'type a question first')

      if (state.turnActive) {
        void host.fillPrompt(`/btw ${q}`).then(
          isFilled => say(isFilled ? 'prepared in the prompt box' : 'no prompt box here', isFilled, isFilled ? 'press Enter there: /btw answers beside the running task and stays out of the main conversation' : 'run /btw yourself'),
          () => say('ask aside', false, 'the prompt box refused it'),
        )

        return
      }

      void host.runSlash('btw', q).then(
        () => say('asked /btw', true, 'the answer opens beside the transcript; it is not part of the main conversation'),
        () => say('ask aside', false, '/btw is not available in this session'),
      )
    },
    skill: id => {
      const skill = MISSION_SKILLS.find(candidate => candidate.id === id)

      if (skill === undefined) return say('skill', false, 'not a ruflo-goals skill')
      if (!isAvailable(state, skill)) return say(`${slashOf(skill)} is not available`, false, `install the ${GOALS_PLUGIN} plugin (Plugin Catalog) and /reload-plugins`)

      launch(slashOf(skill), skill.title)
    },
    guide: text => {
      // A prompt to the session keeps the person's own line breaks.
      if (refusedLong(state, say, 'send Claude', 'the instruction', text)) return

      const t = keepLines(withBreaks(text))

      if (t !== '') mc.lastGuide = t

      const byModel = state.control.viaModel
      const byCall = state.control.callTag ?? undefined

      const ask = () =>
        runner.ask(
          t === ''
            ? null
            : { label: `send Claude: ${plain(t, 70)}`, byModel, byCall, scope: 'guide', args: [], shows: `to the Claude Code session, as a visible prompt: “${t}”`, expect: 'the instruction in the transcript', note: 'Starts a Claude Code turn (billed as any turn is).', run: async () => host.submitPrompt(t) },
          'type the instruction first',
        )

      if (t === '' || !mc.isScreenOn) return ask()

      return screenText(state, host, t).then(screen => (blocksGuidance(screen) ? say('AIDefence blocked the instruction', false, screen.detail) : ask()))
    },

  }

  wired.set(state, { host, actions, research })

  return actions
}

/** Auto-run: called after the task store is read. Hands over the next ready task when the mission opted in and Claude is idle. */
export function advance(state: State, host: Host): void {
  const mission = activeMission(state)

  if (mission === null || !mission.auto || state.turnActive) return

  // The spend cap (ADR-443): a fresh reading at or past the person's cap pauses the mission instead of handing out the next task; with a cap set
  // and no fresh reading nothing is handed out (the cost probe keeps running while auto-run is on) (#3818).
  const gate = capGate(state, mission)

  // The Missions page reads the spend only while it is in front; with a cap set, auto-run reads it itself, so it never decides on an old number.
  if (capOf(state) !== null) void refreshCost(state, host, mission)

  if (gate === 'reached') {
    mission.paused = true
    record(mission, { type: 'cap.reached', note: 'spend cap reached: auto-run paused' })
    saveLedger(state, host)
    host.invalidate()

    return
  }

  if (gate === 'hold') {
    const wait = { label: 'auto-run is waiting', ok: false, detail: 'a spend cap is set and there is no fresh cost reading for this mission yet: nothing is handed out until there is one' }

    if (mcOf(state).last?.label !== wait.label) mcOf(state).last = wait
    host.invalidate()

    return
  }

  const task = nextTask(mission, state.snapshot?.tasks ?? [])

  if (task === null || isInflight(task)) return

  // A task that keeps coming back unfinished is not handed out for ever: after MAX_HANDOUTS the mission pauses, with an event, and waits for the person.
  if ((task.handouts ?? 0) >= MAX_HANDOUTS) {
    mission.paused = true
    record(mission, { type: 'handout.limit', taskId: task.id, note: `task ${task.id} was handed out ${MAX_HANDOUTS} times and is still not done: auto-run paused` })
    saveLedger(state, host)
    host.invalidate()

    return
  }

  void dispatchSpec(state, host, mission, task, text => host.submitPrompt(text)).run?.()
}
