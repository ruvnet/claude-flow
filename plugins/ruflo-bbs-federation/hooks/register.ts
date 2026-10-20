import type { Hook, Register } from 'claude-code'

import { answer } from './command'
import { verdict } from './guard'
import { modeOf, readOptions, type ModOptions } from './options'
import { newStats, noteBlocked, STATUS_PATH, statusText, type Stats } from './status'

type Dollar = Parameters<Hook<'session.start'>>[0]

/** Everything one session of the mod keeps: its settings, counters and the project root. */
type Session = { readonly opts: ModOptions; readonly stats: Stats; root?: string }

async function flush($: Dollar, s: Session): Promise<void> {
  if (s.root === undefined) return
  try {
    await $.fs.write(`${s.root}/${STATUS_PATH}`, statusText(s.stats, modeOf(s.opts), await $.clock.now()))
  } catch {
    /* the status file is a courtesy */
  }
}

/**
 * ruflo-bbs-federation as a mod (ADR-445 pattern): a guard that keeps secrets and unsafe endpoints out of federation_bbs_* calls, `/bbs-mod`, and a status file the console reads. No network, no process: only tools already connected.
 */
export const register: Register = (on, options) => {
  const s: Session = { opts: readOptions(options), stats: newStats() }

  on('session.start', async ($, e, next) => {
    const result = await next(e)
    s.root = (await $.session.root()) as string | undefined
    try {
      await $.command.register({ name: 'bbs-mod', description: 'bbs mod: status, scan <text>, peer <url>' })
    } catch {
      /* a name taken by another plugin must not stop the mod */
    }
    await flush($, s)
    return result
  })

  if (s.opts.guard) {
    on('tool.call', async ($, e, next) => {
      const v = verdict(e.tool, e, s.opts)
      if (v === undefined) return next(e)
      if (v === 'pass') {
        s.stats.checked++
        return next(e)
      }
      noteBlocked(s.stats, v.rule)
      await flush($, s)
      return { deny: v.reason }
    })
  }

  /** `/bbs-mod`: answered locally, no model turn. */
  on('command.run', { command: 'bbs-mod' }, async (_$, e) => {
    return { text: answer(typeof e.args === 'string' ? e.args : '', { opts: s.opts, stats: s.stats }) }
  })
}
