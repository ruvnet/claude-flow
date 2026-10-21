import type { Hook, Register } from 'claude-code'

import { answer } from './command'
import { verdict } from './guard'
import { readOptions, type ModOptions } from './options'
import { newStats, STATUS_PATH, statusText, type Stats } from './status'

type Dollar = Parameters<Hook<'session.start'>>[0]

/** Everything one session of the mod keeps: its settings, counters and the project root. */
type Session = { readonly opts: ModOptions; readonly stats: Stats; root?: string }

async function flush($: Dollar, s: Session): Promise<void> {
  if (s.root === undefined) return
  try {
    await $.fs.write(`${s.root}/${STATUS_PATH}`, statusText(s.stats, { guard: s.opts.guard, liveGuard: s.opts.liveGuard }, await $.clock.now()))
  } catch {
    /* the status file is a courtesy */
  }
}

/**
 * ruflo-neural-trader as a mod (ADR-445 pattern): a tighten-only guard on this plugin's own tools, `/trader-mod`, and a status file the console
 * reads. No network, no process spawning, no model call: only tools already connected.
 */
export const register: Register = (on, options) => {
  const s: Session = { opts: readOptions(options), stats: newStats() }

  on('session.start', async ($, e, next) => {
    const result = await next(e)
    s.root = (await $.session.root()) as string | undefined
    try {
      await $.command.register({ name: 'trader-mod', description: 'ruflo-neural-trader mod: status, scan <text>' })
    } catch {
      /* a name taken by another plugin must not stop the mod */
    }
    await flush($, s)
    return result
  })

  if (s.opts.guard) {
    on('tool.call', async ($, e, next) => {
      const before = s.stats.checked
      const reason = verdict(e.tool, e, s.opts, s.stats)
      if (reason === undefined) {
        if (s.stats.checked !== before) await flush($, s)
        return next(e)
      }
      s.stats.blocked++
      await flush($, s)
      return { deny: reason }
    })
  }

  /** `/trader-mod` (the plugin's own command is a prompt command, which no hook can answer). */
  on('command.run', { command: 'trader-mod' }, async (_$, e) => {
    const args = typeof e.args === 'string' ? e.args : ''
    return { text: answer(args, s.opts, s.stats) }
  })
}
