import type { Hook, Register } from 'claude-code'

import { answer } from './command'
import { newStats, STATUS_PATH, statusText, type Stats } from './status'

type Dollar = Parameters<Hook<'session.start'>>[0]

/** Everything one session of the mod keeps: its counters and the project root. */
type Session = { readonly stats: Stats; root?: string }

async function flush($: Dollar, s: Session): Promise<void> {
  if (s.root === undefined) return
  try {
    await $.fs.write(`${s.root}/${STATUS_PATH}`, statusText(s.stats, await $.clock.now()))
  } catch {
    /* the status file is a courtesy */
  }
}

/**
 * The plugin creator as a mod (ADR-445): `/creator-mod` (status, reserved names, a contract check, all read-only and local) and a status file
 * the console reads. No guard: this plugin's tools only search the plugin store. No network, no process.
 */
export const register: Register = on => {
  const s: Session = { stats: newStats() }

  on('session.start', async ($, e, next) => {
    const result = await next(e)
    try {
      s.root = (await $.session.root()) as string | undefined
    } catch {
      /* no project root: the mod still answers, it just writes no status file */
    }
    try {
      await $.command.register({ name: 'creator-mod', description: 'Plugin creator mod: status, reserved <dir>, check <dir>' })
    } catch {
      /* a name taken by another plugin must not stop the mod */
    }
    await flush($, s)
    return result
  })

  /** `/creator-mod` (the plugin's `/create-plugin` is a prompt command, which no hook can answer). */
  on('command.run', { command: 'creator-mod' }, async ($, e) => {
    const text = await answer(typeof e.args === 'string' ? e.args : '', { stats: s.stats, read: p => $.fs.read(p), list: p => $.fs.list(p) })
    await flush($, s)
    return { text }
  })
}
