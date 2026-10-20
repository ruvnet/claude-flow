/**
 * Where the drill-down is (ADR-459), and how its keys move it. Pure, so the movement is tested without a screen.
 *
 *   Runs > Phases > Agents > Agent (Activity | Log | Files | Result) > one tool call or message
 *
 * The first three levels are the page's own cursor (data/workflows-nav): going deeper there sends the page the `h` / `l` it already
 * understands (`ui` below), so the board and the drill never disagree about where the person is. From the agent down the position is
 * the drill's own: the sub-tab, the selected call or log line, whether the log follows the newest line, its level filter and scope.
 */
import type { LevelFilter, LogScope } from './wf-log'

export type DrillLevel = 'runs' | 'phases' | 'agents' | 'agent' | 'item'
export const LEVELS: readonly DrillLevel[] = ['runs', 'phases', 'agents', 'agent', 'item']
export const LEVEL_NAME: Record<DrillLevel, string> = { runs: 'Runs', phases: 'Phases', agents: 'Agents', agent: 'Agent', item: 'Call' }

export type Sub = 'activity' | 'log' | 'files' | 'result'
export const SUBS: readonly Sub[] = ['activity', 'log', 'files', 'result']
export const SUB_NAME: Record<Sub, string> = { activity: 'Activity', log: 'Log', files: 'Files', result: 'Result' }

export type Drill = {
  open: boolean
  level: DrillLevel
  sub: Sub
  /** `<run id>/<agent id>` the selections below belong to: another agent resets them. */
  at: string
  /** Selected tool call (Activity) and selected line of the log. */
  callSel: number
  logSel: number
  /** The log pins to its newest line, and is re-drawn on the page's refresh. */
  follow: boolean
  filter: LevelFilter
  scope: LogScope
  /** First line shown of an opened call or message. */
  scroll: number
  query: string
  isSearching: boolean
}

export const newDrill = (): Drill => ({ open: false, level: 'runs', sub: 'activity', at: '', callSel: 0, logSel: 0, follow: true, filter: 'all', scope: 'agent', scroll: 0, query: '', isSearching: false })

/** What the cursor is on, as far as moving needs to know. */
export type Here = { column: 'phases' | 'agents'; phaseAgents: number; hasAgent: boolean; isRuflo: boolean; calls: number; lines: number }

/** A key the page's own reducer should also see (`h` / `l` pick its column; `j` `k` `[` `]` move it). */
export type PageKey = 'h' | 'l' | 'j' | 'k' | '[' | ']'

export type Step = { drill: Drill; ui?: PageKey; /** Why nothing deeper happened, said on the page instead of a dead key. */ said?: string }

export const clamp = (value: number, size: number): number => (size <= 0 ? 0 : Math.max(0, Math.min(size - 1, value)))

/** Another agent (or run) is under the cursor: the call, line and scroll selections start over; the person's filter and scope stay. */
export const sync = (drill: Drill, at: string): Drill => (drill.at === at ? drill : { ...drill, at, callSel: 0, logSel: 0, scroll: 0, follow: true })

/** Opens the drill where the cursor already is: the phases column opens at Phases, the agents column at Agents. */
export const openAt = (drill: Drill, here: Pick<Here, 'column'>): Drill => ({ ...drill, open: true, level: here.column === 'agents' ? 'agents' : 'phases', scroll: 0 })

export function deeper(drill: Drill, here: Here): Step {
  if (!drill.open) return { drill: openAt(drill, here) }

  switch (drill.level) {
    case 'runs':
      return { drill: { ...drill, level: 'phases' }, ui: 'h' }
    case 'phases':
      return here.phaseAgents > 0 ? { drill: { ...drill, level: 'agents' }, ui: 'l' } : { drill, said: 'No agent has started in this phase yet, so there is nothing deeper.' }
    case 'agents':
      if (!here.hasAgent) return { drill, said: 'This phase has no agent to open.' }

      return here.isRuflo ? { drill, said: 'A ruflo agent keeps no transcript, worktree or return: there is nothing deeper than its row.' } : { drill: { ...drill, level: 'agent', sub: 'activity', scroll: 0 } }
    case 'agent': {
      const count = drill.sub === 'activity' ? here.calls : drill.sub === 'log' ? here.lines : 0

      return count > 0 ? { drill: { ...drill, level: 'item', scroll: 0, ...(drill.sub === 'log' && { follow: false, logSel: drill.follow ? clamp(here.lines - 1, here.lines) : drill.logSel }) } } : { drill, said: drill.sub === 'files' || drill.sub === 'result' ? 'Files and Result have no deeper level: pick Activity or Log for a call or message.' : 'No call or message has been read for this agent.' }
    }
    case 'item':
      return { drill, said: 'This is the deepest level: one call or message in full.' }
  }
}

export function shallower(drill: Drill): Step {
  if (!drill.open) return { drill }

  switch (drill.level) {
    case 'item':
      return { drill: { ...drill, level: 'agent', scroll: 0 } }
    case 'agent':
      return { drill: { ...drill, level: 'agents' }, ui: 'l' }
    case 'agents':
      return { drill: { ...drill, level: 'phases' }, ui: 'h' }
    case 'phases':
      return { drill: { ...drill, level: 'runs' } }
    case 'runs':
      return { drill: { ...drill, open: false } }
  }
}

/** Goes straight to a level the breadcrumb names: only a shallower one (a deeper one needs the keys that check there is something there). */
export function toLevel(drill: Drill, level: DrillLevel): Step {
  let step: Step = { drill }
  let ui: PageKey | undefined

  for (let guard = 0; guard < LEVELS.length && step.drill.level !== level && LEVELS.indexOf(step.drill.level) > LEVELS.indexOf(level); guard += 1) {
    step = shallower(step.drill)
    ui = step.ui ?? ui
  }

  return { drill: step.drill, ...(ui !== undefined && { ui }) }
}

/** Next or previous: a run, phase or agent at the first three levels (the page's cursor), a call or line below. Selecting a line stops following. */
export function move(drill: Drill, by: 1 | -1, here: Here): Step {
  if (!drill.open) return { drill }

  switch (drill.level) {
    case 'runs':
      return { drill, ui: by === 1 ? ']' : '[' }
    case 'phases':
      return { drill, ui: by === 1 ? 'j' : 'k' }
    case 'agents':
      return { drill, ui: by === 1 ? 'j' : 'k' }
    case 'agent':
    case 'item':
      if (drill.sub === 'log') return { drill: { ...drill, follow: false, logSel: clamp((drill.follow ? here.lines - 1 : drill.logSel) + by, here.lines), scroll: 0 } }
      if (drill.sub === 'activity') return { drill: { ...drill, callSel: clamp(drill.callSel + by, here.calls), scroll: 0 } }

      return { drill }
  }
}

export const nextSub = (drill: Drill): Drill => ({ ...drill, sub: SUBS[(SUBS.indexOf(drill.sub) + 1) % SUBS.length] as Sub, scroll: 0, level: drill.level === 'item' ? 'agent' : drill.level })

/** The breadcrumb, from Runs down to where the person is, each with whether the person can go back to it. */
export function crumbs(drill: Drill): { level: DrillLevel; label: string; isHere: boolean }[] {
  const to = LEVELS.indexOf(drill.level)

  return LEVELS.slice(0, to + 1).map(level => ({ level, label: level === 'agent' ? `${LEVEL_NAME.agent} · ${SUB_NAME[drill.sub]}` : LEVEL_NAME[level], isHere: level === drill.level }))
}

/** Where a search hit takes the person: the cursor's run, phase and agent, then a sub-tab and the call or line in it. */
export type Target = { run: number; phase: number; agent: number; sub?: Sub; call?: number; line?: number; /** True to open the item (one call or message in full). */ item?: boolean }

export type Jump = { drill: Drill; ui: { run: number; phase: number; agent: number; column: 'phases' | 'agents'; isInspecting: false } }

export function jump(drill: Drill, target: Target, at: string): Jump {
  const isAgent = target.sub !== undefined || target.call !== undefined || target.line !== undefined
  const sub: Sub = target.sub ?? (target.line !== undefined ? 'log' : 'activity')
  const level: DrillLevel = target.item === true ? 'item' : isAgent ? 'agent' : target.agent >= 0 ? 'agents' : 'phases'
  const next: Drill = { ...drill, open: true, level, sub, at, isSearching: false, scroll: 0, callSel: target.call ?? 0, logSel: target.line ?? 0, follow: false, filter: 'all', scope: 'agent' }

  return { drill: next, ui: { run: target.run, phase: target.phase, agent: Math.max(0, target.agent), column: isAgent || target.agent >= 0 ? 'agents' : 'phases', isInspecting: false } }
}
