/**
 * The autopilot's segment of the band (ADR-470 §2.4): `autopilot day 3 · $12/$40 · 2 parked`, drawn on the band's first row through
 * `registerBarSource` (views/bar.ts), the same composer every other part goes through. Every figure is from the journal, the sealed
 * envelope and the ledger reading; an unread spend is `$n/a`, never `$0`. Nothing is drawn while autopilot has never started.
 */
import { storeOf } from '../ap-live'
import { bandText, summarize } from '../data/ap-loop'
import type { State } from '../state'
import { registerBarSource, type BarPart } from './bar'

export function autopilotPart(state: State, nowMs: number): BarPart | null {
  const store = storeOf(state)
  const loop = store.loop
  const text = bandText(loop, nowMs, store.spend?.totalUsd ?? null, store.sealed !== null && store.sealed.hash === loop.envHash ? store.sealed.envelope : null)

  if (text === '') return null

  const sum = summarize(loop, nowMs)

  return { text, tone: sum.phase === 'paused' || (sum.phase === 'running' && sum.parked > 0) ? 'attention' : sum.phase === 'running' ? 'live' : 'plain', go: 'workflows' }
}

registerBarSource((state, nowMs) => {
  const part = autopilotPart(state, nowMs)

  return part === null ? [] : [part]
})
