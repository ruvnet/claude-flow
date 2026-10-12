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
    await $.fs.write(`${s.root}/${STATUS_PATH}`, statusText(s.stats, s.opts.guard, await $.clock.now()))
  } catch {
    /* the status file is a courtesy */
  }
}

/**
 * ruflo-federation as a mod (ADR-445 pattern): a tighten-only guard on this plugin's own tools, `/federation-mod` and a status file. No network, no process
 * spawning: only tools already connected.
 */
export const register: Register = (on, options) => {
  const s: Session = { opts: readOptions(options), stats: newStats() }

  on('session.start', async ($, e, next) => {
    const result = await next(e)
    s.root = (await $.session.root()) as string | undefined
    try {
      await $.command.register({ name: 'federation-mod', description: 'ruflo-federation mod: status, scan <text>, plus a read-only listing' })
    } catch {
      /* a name taken by another plugin must not stop the mod */
    }
    await flush($, s)
    return result
  })

  if (s.opts.guard) {
    on('tool.call', async ($, e, next) => {
      const reason = verdict(e.tool, e)
      if (reason === undefined) return next(e)
      s.stats.blocked++
      await flush($, s)
      return { deny: reason }
    })
  }

  /** `/federation-mod` is answered locally and takes no model turn. */
  on('command.run', { command: 'federation-mod' }, async ($, e) => {
    const args = typeof e.args === 'string' ? e.args : ''
    const text = await answer(args, {
      guard: s.opts.guard,
      stats: s.stats,
      tools: async () => (await $.tool.list()).map(t => t.name),
      list: path => $.fs.list(path),
    })
    return { text }
  })
}
