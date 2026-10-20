import type { EngineInterface, Register } from 'claude-code'

import { HOSTS_PATH, segmentText } from './segment'

/** How often the segment re-reads hosts.json (a local file read, no network). */
export const REFRESH_MS = 15_000

type State = { last: string | null | undefined }

/**
 * Re-read the plugin's hosts.json and set the `ruos` segment when it changed.
 * `$.ruflo` exists only where the ruflo mod is seated, and `claude plugin
 * validate` rejects feature-detecting a noun, so the call sits in try/catch:
 * without ruflo-mods it rejects and nothing is drawn.
 */
async function refresh($: EngineInterface, state: State): Promise<void> {
  let text: string | null = null
  try {
    const root = await $.session.root()
    text = segmentText(await $.fs.read(`${root}/${HOSTS_PATH}`))
  } catch {
    text = null // no snapshot yet: nothing to show
  }
  if (text === state.last) return
  try {
    await $.ruflo.segment({ id: 'ruos', text })
    state.last = text
  } catch {
    // ruflo mod not seated, or it refused the segment: draw nothing
  }
}

/**
 * ruflo-ruos as a mod (ADR-405): contributes the `ruos` segment to ruflo's
 * status line. Reads only the plugin's own hosts.json; never calls ruOS (no
 * network, no `$.ruos` dependency) and never issues a destructive tool.
 */
export const register: Register = on => {
  const state: State = { last: undefined }

  on('session.start', async ($, e, next) => {
    const result = await next(e)
    await refresh($, state)
    try {
      $.clock.every(REFRESH_MS, () => refresh($, state))
    } catch {
      // a withheld clock only means no periodic refresh
    }
    return result
  })

  on('prompt.submit', async ($, e, next) => {
    await refresh($, state)
    return next(e)
  })
}
