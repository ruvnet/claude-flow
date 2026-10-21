import type { EngineInterface, On } from 'claude-code'

import type { RufloSnapshot } from '../types'
import { redraw, setSegment, sortedSegments, type ModState } from './state'
import { bindToasts } from './toast'

/** The snapshot `$.ruflo.snapshot()` answers: copies, never live state. */
export function snapshotOf(s: ModState): RufloSnapshot {
  return {
    owned: [...s.owned],
    routed: s.routed,
    lastRoute: s.lastRoute ? { ...s.lastRoute } : null,
    policy: s.policy,
    tightened: s.tightened,
    observed: s.observed,
    edits: s.editCount,
    ...(s.budget.limit !== undefined
      ? { budget: { level: s.budget.level, ...(s.budget.usd !== undefined ? { usd: s.budget.usd } : {}), limit: s.budget.limit } }
      : {}),
    segments: sortedSegments(s).map(([id, text]) => ({ id, text })),
  }
}

/**
 * `engine.create`: adds `$.ruflo` (contract: ../types/index.d.ts) and takes
 * the status line drawer from the `$` built beneath, so every redraw goes
 * through one place and a refused `ui.status` never fails a hook.
 *
 * Another plugin's `$.ruflo.<method>(input)` runs as an event through the
 * chain, these methods its core; where this mod is not seated the noun is
 * absent and such a call rejects, which its callers catch.
 */
export function registerNoun(on: On, state: ModState) {
  on('engine.create', async ($, e, next) => {
    const beneath = await next(e)

    state.draw = text => {
      try {
        beneath.ui.status(text)
      } catch {
        // an admin may withhold ui.status: the line simply is not drawn
      }
    }

    bindToasts(state, {
      now: () => beneath.clock.now(),
      show: (line, options) => beneath.ui.toast(line, options),
      after: (ms, fn) => beneath.clock.after(ms, fn),
      read: path => beneath.fs.read(`${state.root}/${path}`),
      write: (path, text) => beneath.fs.write(`${state.root}/${path}`, text),
      exists: path => beneath.fs.exists(`${state.root}/${path}`),
    })

    const ruflo: EngineInterface['ruflo'] = {
      segment: async input => {
        setSegment(state, input)
        redraw(state)
      },
      lastRoute: async () => (state.lastRoute ? { ...state.lastRoute } : null),
      snapshot: async () => snapshotOf(state),
    }

    // Beneath wins: if another step already added `ruflo`, ours never replaces it.
    const added = { ruflo }
    return { ...added, ...beneath }
  })
}
