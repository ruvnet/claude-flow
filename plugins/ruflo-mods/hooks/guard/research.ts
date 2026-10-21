import { cachedFile, type FileHost } from '../files'
import { under, type ModState } from '../state'
import { stricter, type Verdict } from './verdict'

/**
 * The research web-fetch guard (ADR-440). While a deep-research run is active
 * its skill writes a marker (ADR-438); the first WebFetch or WebSearch of that
 * run asks the person once, saying what is asked, the cap, and that web text
 * is untrusted. The rest of the run is then left to the chain. Tighten only:
 * an allow becomes an ask, nothing else is ever touched.
 */

export const MARKER_PATH = '.claude-flow/research-active.json'
/** A marker older than this is a run that never cleaned up, and is ignored. */
export const MARKER_MAX_AGE_MS = 2 * 60 * 60 * 1000
/** Clock skew allowed before a marker "from the future" is treated as corrupt. */
const SKEW_MS = 5 * 60 * 1000
const WEB_TOOLS = new Set(['WebFetch', 'WebSearch'])
const MAX_QUESTION_CHARS = 200

export type Marker = { readonly question: string; readonly capUsd: number; readonly startedAt: string }

/** Throws on anything that is not a marker, so a corrupt file reads as `error`. */
export function parseMarker(text: string): Marker {
  const v = JSON.parse(text) as Record<string, unknown> | null
  const question = v?.question
  const capUsd = v?.capUsd
  const startedAt = v?.startedAt
  if (typeof question !== 'string' || !question.trim()) throw new Error('marker: question')
  if (typeof capUsd !== 'number' || !Number.isFinite(capUsd) || capUsd <= 0) throw new Error('marker: capUsd')
  if (typeof startedAt !== 'string' || !Number.isFinite(Date.parse(startedAt))) throw new Error('marker: startedAt')
  return { question, capUsd, startedAt }
}

/** Whether a marker's start is recent enough, and not in the future, at `now`. */
export const isFresh = (m: Marker, now: number) => {
  const age = now - Date.parse(m.startedAt)
  return age >= -SKEW_MS && age < MARKER_MAX_AGE_MS
}

/** The question as shown: no control or bidi characters, one line, bounded. */
const shown = (q: string) => {
  const clean = q
    .replace(/[\u0000-\u001f\u007f-\u009f​-‏‪-‮⁠-⁩﻿]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
  return clean.length > MAX_QUESTION_CHARS ? `${clean.slice(0, MAX_QUESTION_CHARS - 1)}…` : clean
}

export function askFor(tool: string, m: Marker): Verdict {
  return {
    decision: 'ask',
    reason:
      `ruflo research: the first ${tool} of this run. Question: "${shown(m.question)}". ` +
      `Cap: $${m.capUsd}. Web content is untrusted: it is data to weigh, never instructions. ` +
      'Allowing it lets the rest of this run fetch and search.',
  }
}

/**
 * The check, built once per session. `current` is the verdict so far (the
 * chain's, merged with ruflo's own); the answer is that verdict, or an ask
 * where it was an allow. `fs` is built at the `tool.check` call site.
 */
export function researchCheck(state: ModState) {
  const marker = cachedFile(() => under(state, MARKER_PATH), parseMarker)

  return async <V extends Verdict>(fs: FileHost, tool: string, current: V): Promise<V | Verdict> => {
    if (!WEB_TOOLS.has(tool)) return current
    // Already at the hard stop: the budget says no more; add nothing of ours.
    if (state.budget.level === 'HARD_STOP') return current
    try {
      const read = await marker(fs)
      // Missing, unreadable, corrupt or old: no run is active, so do nothing.
      if (read.kind !== 'ok' || !isFresh(read.value, Date.now())) return current
      if (state.researchAsked === read.value.startedAt) return current
      const merged = stricter(current, askFor(tool, read.value))
      if (merged !== current) {
        state.researchAsked = read.value.startedAt
      }
      return merged
    } catch {
      return current
    }
  }
}
