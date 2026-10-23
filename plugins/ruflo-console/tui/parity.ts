/**
 * Every console view and what `ruflo tui` does with it (ADR-489 phase 5). A view is a decision, not an accident: `parity.spec.ts` fails when a view
 * is added to the console's `VIEWS` without an entry here, and when ADR-489's table does not name each view.
 *
 *  - `same`        the console's own page body, read-only, as in Claude Code.
 *  - `partial`     the console's own page body, but part of it needs Claude Code (or the confirm gate of phase 6): `why` says which.
 *  - `equivalent`  the job is done by another standalone page (`opens`).
 *  - `claude-only` the page is about a Claude Code session this terminal does not have: it opens a one-screen note, never an empty fake.
 */
import { VIEWS, type ViewId } from '../hooks/state'

export type Parity = { status: 'same' | 'partial' | 'equivalent' | 'claude-only'; why: string; opens?: 'ai' }

const READ_ONLY = 'its buttons are not drawn; its actions are asked for by name at the go prompt (:), each after the console card'

export const PARITY: Record<ViewId | 'agent', Parity> = {
  menu: { status: 'same', why: 'entries open by their key, as on the console board' },
  missions: { status: 'partial', why: 'the mission record only: entering a goal, planning and research start a Claude turn' },
  overview: { status: 'same', why: 'the Claude-only controls are not drawn' },
  swarm: { status: 'same', why: 'topology, agents and votes as ruflo wrote them' },
  hive: { status: 'partial', why: READ_ONLY },
  claims: { status: 'partial', why: READ_ONLY },
  workflows: { status: 'partial', why: 'the ruflo swarm side; Claude Code workflow runs are not visible outside a session' },
  federation: { status: 'partial', why: READ_ONLY },
  plugins: { status: 'partial', why: 'what is installed and loaded; "loaded as a mod" is a Claude Code fact and reads n/a' },
  learning: { status: 'same', why: 'router picks, outcomes and the pipeline as on disk' },
  metaharness: { status: 'partial', why: READ_ONLY },
  memory: { status: 'partial', why: READ_ONLY },
  cost: { status: 'partial', why: 'provider ledger and router counts; Claude Code spend, context and the budget ladder read n/a' },
  timeline: { status: 'partial', why: 'agent lanes from status reports; Claude Code tool-call lanes need a session' },
  approvals: { status: 'partial', why: 'shows what waits; answering a vote or a claim is asked for by name at the go prompt, after the card' },
  events: { status: 'same', why: 'the event stream as it is on disk; Ask Claude is not drawn' },
  room: { status: 'claude-only', why: 'it is what people said to Claude in a session, plus a message box; this terminal has neither' },
  xruv: { status: 'partial', why: READ_ONLY },
  terminal: { status: 'equivalent', why: 'the standalone AI page (Codex or OpenRouter, each question after a card)', opens: 'ai' },
  skills: { status: 'partial', why: READ_ONLY },
  secure: { status: 'partial', why: READ_ONLY },
  perf: { status: 'partial', why: READ_ONLY },
  automate: { status: 'partial', why: READ_ONLY },
  neural: { status: 'partial', why: READ_ONLY },
  vector: { status: 'partial', why: READ_ONLY },
  evolve: { status: 'partial', why: READ_ONLY },
  devtools: { status: 'partial', why: READ_ONLY },
  sandbox: { status: 'partial', why: READ_ONLY },
  market: { status: 'partial', why: READ_ONLY },
  adrs: { status: 'partial', why: READ_ONLY },
  rure: { status: 'partial', why: READ_ONLY },
  whatsnew: { status: 'same', why: 'changelogs of the installed plugins' },
  themes: { status: 'partial', why: 'the look is chosen with t or --look; the colour picker and generated themes are not here yet' },
  settings: { status: 'partial', why: 'shown as the standalone defaults; plugin options live in the Claude Code settings and the standalone has no store for them yet (the look is --look/t, the speed --fps)' },
  agent: { status: 'partial', why: 'the drill-down from a Swarm selection; selecting needs the host keys, so it says so' },
}

/** The views the standalone shell can open by name: every console view and the AI page. */
export const PAGE_IDS: readonly (ViewId | 'ai')[] = [...VIEWS.map(view => view.id), 'ai']
