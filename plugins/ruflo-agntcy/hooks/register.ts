import type { Hook, Register } from 'claude-code'

import { answer } from './command'
import { readOptions } from './options'
import { newStats, STATUS_PATH, statusText, type Stats } from './status'
import type { ModOptions } from './options'

type Dollar = Parameters<Hook<'session.start'>>[0]

/** Everything one session of the mod keeps: its settings, counters and the project root. */
type Session = { readonly opts: ModOptions; readonly stats: Stats; root?: string }

async function flush($: Dollar, s: Session): Promise<void> {
  if (s.root === undefined) return
  try {
    await $.fs.write(`${s.root}/${STATUS_PATH}`, statusText(s.stats, s.opts, await $.clock.now()))
  } catch {
    /* the status file is a courtesy */
  }
}

/**
 * AGNTCY as a mod (ADR-445 pattern): `/agntcy-mod`, and a status file the console reads.
 * No network, no process: only the hooks API.
 */
export const register: Register = (on, options) => {
  const s: Session = { opts: readOptions(options), stats: newStats() }

  on('session.start', async ($, e, next) => {
    const result = await next(e)
    s.root = (await $.session.root()) as string | undefined
    s.stats.startedMs = await $.clock.now()
    try {
      await $.command.register({ name: 'agntcy-mod', description: 'AGNTCY mod: status, config' })
    } catch {
      /* a name taken by another plugin must not stop the mod */
    }
    await flush($, s)
    return result
  })

  /** `/agntcy-mod` (a markdown command of the plugin cannot be answered by a hook, so the mod owns this name). */
  on('command.run', { command: 'agntcy-mod' }, async (_$, e) => ({ text: answer(typeof e.args === 'string' ? e.args : '', { opts: s.opts, stats: s.stats }) }))
}
