import type { Hook, Register } from 'claude-code'

import { answer } from './command'
import { owns, verdict } from './guard'
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
 * AIDefence as a mod (ADR-445 pattern): a tighten-only guard on what `aidefence_learn` teaches the detector (patterns persist and are shown back later), `/aidefence-mod`, and a status file the console reads.
 * No network, no process: only the hooks API.
 */
export const register: Register = (on, options) => {
  const s: Session = { opts: readOptions(options), stats: newStats() }

  on('session.start', async ($, e, next) => {
    const result = await next(e)
    s.root = (await $.session.root()) as string | undefined
    s.stats.startedMs = await $.clock.now()
    try {
      await $.command.register({ name: 'aidefence-mod', description: 'AIDefence mod: status, scan <text>' })
    } catch {
      /* a name taken by another plugin must not stop the mod */
    }
    await flush($, s)
    return result
  })

  if (s.opts.guard) {
    on('tool.call', async ($, e, next) => {
      if (!owns(e.tool, e)) return next(e)
      s.stats.calls++
      const reason = verdict(e.tool, e)
      if (reason === undefined) return next(e)
      s.stats.blocked++
      await flush($, s)
      return { deny: reason }
    })
  }

  /** `/aidefence-mod` (a markdown command of the plugin cannot be answered by a hook, so the mod owns this name). */
  on('command.run', { command: 'aidefence-mod' }, async (_$, e) => ({ text: answer(typeof e.args === 'string' ? e.args : '', { opts: s.opts, stats: s.stats }) }))
}
