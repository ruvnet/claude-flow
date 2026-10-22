/** A fake console controller for the model-tool specs (ADR-444): read-only entries finish at once, the rest wait in `state.pending`. */
import { settingsOf } from '../../hooks/settings'
import { newState } from '../../hooks/state'
import type { ModelToolDeps } from '../../hooks/model-tools'
import type { Actions } from '../../hooks/views/common'

export type Level = 'off' | 'read' | 'write' | 'manage' | 'full'

/** A controller whose runner behaves like the real one: read-only entries finish at once, the rest wait in `state.pending`. */
export function setup(level: Level, confirm: 'ask' | 'auto' = 'ask', entries: Record<string, { label: string; readOnly?: boolean; note?: string }> = {}, followUp?: { label: string; note?: string }) {
  const state = newState({})
  const calls = { timers: [] as (() => void)[], finishAfter: undefined as Promise<void> | undefined, setView: [] as string[], open: 0, goal: [] as string[], profile: [] as string[], draft: [] as string[][], confirm: 0, cancel: 0, runs: [] as string[], chips: [] as string[] }

  Object.assign(settingsOf(state).ai, { modelControl: level, modelConfirm: confirm })

  const catalog = { 'mission-open': { label: 'open Mission Control', readOnly: true }, 'mission-create': { label: 'create the mission and its tasks' }, 'mission-cancel': { label: 'cancel the mission and its open tasks' }, 'plugin-install': { label: 'install a plugin', note: 'network: clones it from GitHub' }, 'x-publish': { label: 'publish a note to x.ruv.io', note: 'network: sends it to the relay' }, 'hand-task': { label: 'hand task t1 to Claude', note: 'Starts a Claude Code turn (billed as any turn is)' }, ...entries }
  const control = {
    host: { invalidate: () => undefined, after: (_ms: number, fn: () => void) => ({ cancel: () => calls.timers.splice(calls.timers.indexOf(fn), 1), fire: fn, ...(calls.timers.push(fn) && {}) }) },
    setView: (view: string) => void calls.setView.push(view),
    open: async () => void (calls.open += 1),
    actions: { mission: { goal: (text: string) => {
          calls.goal.push(text)
          if (followUp !== undefined) state.pending = { label: followUp.label, args: [], expect: 'guidance', askedAtMs: Date.now(), ...(followUp.note !== undefined && { note: followUp.note }) }
        }, profile: (id: string) => void calls.profile.push(id), rigor: () => undefined }, devtools: { draft: (field: string, text: string) => void calls.draft.push([field, text]) }, costBudgetDraft: () => undefined, settings: { plugin: (name: string) => void calls.chips.push(name) } } as unknown as Actions,
    runner: {
      runById: (id: string) => {
        const entry = catalog[id as keyof typeof catalog] as { label: string; readOnly?: boolean; note?: string } | undefined

        if (entry === undefined) return false

        calls.runs.push(id)
        if (entry.readOnly === true) state.outcome = { label: entry.label, ok: true, verified: 'n/a', detail: 'done', atMs: Date.now() + 1 }
        else state.pending = { label: entry.label, args: [], expect: 'the change on disk', askedAtMs: Date.now(), ...(entry.note !== undefined && { note: entry.note }) }

        return true
      },
      settled: async () => undefined,
      finished: async () => (calls.finishAfter === undefined ? undefined : calls.finishAfter),
      confirm: async () => {
        calls.confirm += 1
        state.outcome = { label: state.pending?.label ?? '', ok: true, verified: 'n/a', detail: 'ran', atMs: Date.now() + 1 }
        state.pending = null
      },
      cancel: () => {
        calls.cancel += 1
        state.pending = null
      },
    },
  }

  return { state, calls, deps: { state, control } as unknown as ModelToolDeps }
}

