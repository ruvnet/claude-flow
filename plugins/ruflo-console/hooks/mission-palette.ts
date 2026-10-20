/** Palette entries for Mission Control, so `/ruflo run mission-next` and `/ruflo plan <goal>` work headless; a write or a turn still asks. */
import type { ActionSpec } from './actions'
import { blocksCreate } from './mission-options'
import { activeMission, cancelSpec, createSpec, createWhy, dispatchSpec, longRefusal, mcOf, missionWired, nextTask, setGoal } from './mission-control'
import type { PaletteEntry } from './palette'
import type { State } from './state'

/** `mission-auto` takes on or off in any case and nothing else: a word that is not one does not quietly mean off (#3815). */
const AUTO_WORD = /^(on|off)$/i

/** `/ruflo plan <goal>`: plans the goal, or says by how much it is over the limit and keeps the text (it is never cut). */
function planGoal(state: State, value: string, wired: ReturnType<typeof missionWired>): void {
  const refusal = longRefusal(value, 'the goal')

  if (refusal === null) return setGoal(state, value)

  mcOf(state).last = { label: 'goal not planned', ok: false, detail: refusal }
  wired?.host.invalidate()
}

export function missionPalette(state: State): PaletteEntry[] {
  const wired = missionWired(state)
  // `declared` is what the entry does beyond looking: Claude's call is gated on it (#3815). An entry that only queues a confirm of its own (a screened
  // ask, a guide, the research start) declares nothing, and its run resolves once that confirm is queued so the gate sees it.
  const local = (label: string, run: () => void | Promise<void>, declared?: NonNullable<ActionSpec['declared']>): ActionSpec | null =>
    wired === undefined ? null : { label, args: [], expect: label, isReadOnly: true, ...(declared !== undefined && { declared }), run: async () => void (await run()) }
  const why = 'open Mission Control (the Missions view) first'
  const spec = (make: () => ActionSpec | null) => ({ kind: 'spec' as const, spec: wired === undefined ? null : make(), why })
  const text = (keyword: string, make: (text: string) => ActionSpec | null) => ({ kind: 'text' as const, keyword, make: (value: string) => (wired === undefined ? null : make(value)), why: () => why })
  const tasks = () => state.snapshot?.tasks ?? []

  return [
    // Declared 'write', like console_set goal: it REPLACES Mission Control's goal and plan (in memory: no file, no mission). The label says so
    // rather than "nothing is written", which contradicted the gate asking for write control.
    { id: 'mission-goal', group: 'missions', label: 'mission-goal <goal>: set the goal and plan it as a SPARC goal-oriented plan (replaces the current goal; no file, no mission yet)', run: text('mission-goal', value => local('plan the goal', () => planGoal(state, value, wired), 'write')) },
    { id: 'mission-status', group: 'missions', label: 'mission status: progress, each task’s status, what is next', run: spec(() => local('mission status', () => undefined)) },
    { id: 'mission-create', group: 'missions', label: 'create the mission and its tasks from the planned goal (asks first)', run: { kind: 'spec' as const, spec: wired === undefined || blocksCreate(mcOf(state).screen) ? null : createSpec(state, wired.host, () => undefined), why: createWhy(state) ?? why } },
    {
      id: 'mission-next',
      group: 'missions',
      label: 'hand the next ready task to Claude (asks first: it starts a turn)',
      run: spec(() => {
        const mission = activeMission(state)
        const task = mission === null ? null : nextTask(mission, tasks())

        return wired === undefined || mission === null || task === null ? null : dispatchSpec(state, wired.host, mission, task, text => wired.host.submitPrompt(text))
      }),
    },
    { id: 'mission-pause', group: 'missions', label: 'pause: no more tasks are handed out', run: spec(() => local('pause the mission', () => wired?.actions.pause(), 'write')) },
    // Who resumes is known when the entry is built: Claude's console_run builds the palette inside its call (state.control.viaModel). Claude's
    // resume keeps the hand-out counts; only the person's gives an exhausted task more billed turns (#3823).
    { id: 'mission-resume', group: 'missions', label: 'resume handing out tasks', run: spec(() => (state.control.viaModel ? local('resume the mission (Claude: hand-out counts kept)', () => wired?.actions.resume('model'), 'write') : local('resume the mission', () => wired?.actions.resume('person'), 'write'))) },
    { id: 'mission-cancel', group: 'missions', label: 'cancel the mission and its open tasks (asks first)', run: spec(() => { const mission = activeMission(state); return wired === undefined || mission === null ? null : cancelSpec(state, wired.host, mission, tasks()) }) },
    { id: 'mission-aside', group: 'missions', label: 'mission-aside <question>: /btw beside the running task', run: text('mission-aside', value => local('ask aside', () => wired?.actions.aside(value), 'spend')) },
    { id: 'mission-guide', group: 'missions', label: 'mission-guide <instruction>: a visible instruction to Claude (screened, asks first)', run: text('mission-guide', value => local('guide Claude', () => wired?.actions.guide(value))) },
    { id: 'mission-auto', group: 'missions', label: 'mission-auto on|off: hand over each next ready task without asking', run: { ...text('mission-auto', value => (AUTO_WORD.test(value.trim()) ? local('auto-run', () => wired?.actions.auto(value.trim().toLowerCase() === 'on'), value.trim().toLowerCase() === 'on' ? 'spend' : 'write') : null)), why: () => (wired === undefined ? why : 'say on or off') } },
    { id: 'mission-research', group: 'missions', label: 'research the question typed in Missions: screened, then confirm (a billed turn with web access up to the cap)', run: spec(() => local('start the research', () => wired?.research())) },
    { id: 'mission-open', group: 'missions', label: 'open Mission Control', run: { kind: 'view', view: 'missions' } },
  ].map(entry => ({ ...entry, label: mcOf(state) === undefined ? entry.label : entry.label })) as PaletteEntry[]
}
