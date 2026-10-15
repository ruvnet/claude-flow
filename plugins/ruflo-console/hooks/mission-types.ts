/** The shapes Mission Control keeps: the ledger (missions, tasks, events), the view state, and the actions the views call. */
import type { ConsultKind } from './mission-advisor'
import type { Guidance } from './mission-guidance'
import type { Screen } from './mission-options'
import type { Plan, Profile, Rigor } from './goap'
import type { LoopActions } from './views/mission-loop'

export type LedgerTask = { id: string; title: string; phase: string; stage?: string; agent: string; requirement: string; dependsOn: string[]; rufloTaskId?: string; dispatchedAtMs?: number; /** How many times it was handed to Claude (counted per attempt, failed hand-outs included): auto-run stops at MAX_HANDOUTS. */ handouts?: number }
export type LedgerEvent = { seq: number; atMs: number; type: string; taskId?: string; status?: string; evidenceRef?: string; note?: string; /** ADR-483: the model an advisor consult ran on, and the cost claude reported for it. */ model?: string; costUsd?: number }
export type MissionRecord = {
  id: string
  objective: string
  profile: Profile
  rigor: Rigor
  planDigest?: string
  tasks: LedgerTask[]
  acceptance: { id: string; check: string }[]
  events: LedgerEvent[]
  paused: boolean
  cancelled: boolean
  auto: boolean
  createdAtMs: number
  /** The mission's loop manager state (ADR-443), validated by parseLoop where it is read. */
  loop?: unknown
  /** ADR-480: the file names of the project's ADRs attached to this mission (validated where read). */
  adrs?: string[]
}
export type McTab = 'plan' | 'tasks' | 'agents' | 'evidence' | 'record' | 'loop'
export type Derived = 'done' | 'running' | 'ready' | 'waiting' | 'failed' | 'cancelled'

export type McState = {
  goal: string
  profile: Profile
  rigor: Rigor
  /** True once the person picked the profile (otherwise it follows the goal's words). */
  isProfilePicked: boolean
  planned: Plan | null
  missions: Map<string, MissionRecord>
  active: string | null
  tab: McTab
  /** The last instruction sent to Claude, kept so it can be edited and sent again. */
  lastGuide: string
  /** Claude's guidance on the goal, as it arrives (mission-guidance.ts). */
  guidance: Guidance | null
  /** AIDefence's verdict on the goal (null: not screened yet or the screen is off), and whether the screen is on. */
  screen: Screen | null
  isScreenOn: boolean
  /** `lines` add what one line cannot hold (which tasks are still pending after a failed create). */
  last: { label: string; ok: boolean; detail: string; atMs?: number; next?: string; lines?: string[] } | null
}

/** Who resumed a mission: only the person re-arms hand-outs that ran out (#3823). */
export type ResumeBy = 'person' | 'model'

export type MissionActions = {
  goal: (text: string) => void
  profile: (profile: Profile) => void
  rigor: (rigor: Rigor) => void
  tab: (tab: McTab) => void
  create: () => void
  select: (id: string) => void
  /** Hands the next ready task to the primary session (asks first: it starts a model turn). */
  next: () => void
  pause: () => void
  /** Resume dispatching. The person's resume gives each task its hand-outs back; Claude's (`'model'`) keeps the counts (#3823). */
  resume: (by?: ResumeBy) => void
  cancel: () => void
  /** Auto-run: when a task finishes and the session is idle, hand over the next ready one without asking. */
  auto: (on: boolean) => void
  /** Ask aside: `/btw <question>` beside the running task (run now when idle, otherwise prepared in the prompt box). */
  aside: (question: string) => void
  /** Runs a ruflo-goals skill in the main Claude UI on the goal (or the active mission's objective). */
  skill: (id: string) => void
  /** Guide Claude: a visible instruction to the primary session (asks first: it starts a model turn). */
  guide: (text: string) => void | Promise<void>
  /** Asks claude -p for guidance on the current goal again (asks first unless always accept). */
  askGuidance: () => void
  /** Runs another ruflo plugin's slash command (ruOS, AIDefence, SPARC, ...) on the goal in the main Claude UI. */
  capability: (slash: string) => void
  /** Turns the AIDefence screen of mission text on or off. */
  screen: (on: boolean) => void
  /** Runs the person's own gate commands on the active mission (asks first) and records each exit code as evidence. */
  verify: () => void
  /** The loop manager (ADR-443): prepares the /loop text, a stop request or a re-arm in the prompt box. */
  loop: LoopActions
  /** ADR-483: asks for one advisor consult of a kind now (asks first; refused with a reason when the setting is off or the spend cap forbids it). */
  advisor: (kind: ConsultKind) => void
}
