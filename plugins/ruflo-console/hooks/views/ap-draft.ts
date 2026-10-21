/**
 * The autopilot's envelope DRAFT: the one object the panel's buttons and the list editor (views/ap-editor.ts) both change. It is a
 * proposal held in memory; nothing is granted until the confirmed Start seals it. Split from ap-panel.ts (file limit, and so the editor
 * and the panel need not import each other).
 */
import type { State } from '../state'

export type DraftState = { value: Record<string, unknown>; fromFile: string | null; /** The last edit the list editor refused, with its reason. */ refused: string | null }

const DAY = 86_400_000
const drafts = new WeakMap<State, DraftState>()

/** The first envelope offered: the project only, read/edit/test/local git, no network, no secrets, modest ceilings, a week. */
export const defaultDraft = (cwd: string): Record<string, unknown> => ({ name: 'autopilot', toolClasses: ['read', 'edit', 'test', 'git-local'], paths: [cwd.replace(/\/+$/, '')], repos: [], network: [], secretEnv: [], spend: { hourUsd: 2, dayUsd: 10, totalUsd: 40 }, concurrency: 1, maxDurationMs: 7 * DAY, verify: [], acceptWithoutAnatole: false })

export const draftOf = (state: State): DraftState => drafts.get(state) ?? drafts.set(state, { value: defaultDraft(state.cwd), fromFile: null, refused: null }).get(state)!

/** A duration as the person reads it: hours under a day (the minimum is an hour, which used to read "0 d"), days above. */
export const spanText = (ms: number): string => (ms < DAY ? `${Math.max(1, Math.round(ms / 3_600_000))} h` : `${Math.round(ms / DAY)} d`)
