import type { Hook, Register } from 'claude-code'

import { answer } from './command'
import { verdict, watched } from './guard'
import { readOptions, type ModOptions } from './options'
import { newStats, STATUS_PATH, statusText, type Stats } from './status'

type Dollar = Parameters<Hook<'session.start'>>[0]

/** Everything one session of the mod keeps: its settings, its counters and the project root. */
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
 * Security audit as a mod (ADR-445 pattern): a guard that keeps secrets out of memory written to security, audit and CVE namespaces (findings quote what they found), `/secaudit-mod`, and a status file the console reads. No network, no process: only tools already connected.
 */
export const register: Register = (on, options) => {
  const s: Session = { opts: readOptions(options), stats: newStats() }

  on('session.start', async ($, e, next) => {
    const result = await next(e)
    s.root = (await $.session.root()) as string | undefined
    try {
      await $.command.register({ name: 'secaudit-mod', description: 'Security-audit mod: status, scan <text>, namespaces' })
    } catch {
      /* a name taken by another plugin must not stop the mod */
    }
    await flush($, s)
    return result
  })

  // Tighten-only: a deny, or the event unchanged. Only this plugin's own tools are looked at.
  on('tool.call', async ($, e, next) => {
    const label = watched(e.tool, e)
    if (label === undefined) return next(e)
    s.stats.checked++
    s.stats.seen[label] = (s.stats.seen[label] ?? 0) + 1
    const reason = s.opts.guard ? verdict(e.tool, e) : undefined
    if (reason !== undefined) {
      s.stats.blocked++
      s.stats.lastReason = reason.slice(0, 160)
    }
    await flush($, s)
    return reason === undefined ? next(e) : { deny: reason }
  })

  /** `/secaudit-mod` (the plugin's own commands are prompt commands, which no hook can answer). */
  on('command.run', { command: 'secaudit-mod' }, async ($, e) => {
    const args = typeof e.args === 'string' ? e.args : ''
    return { text: await answer(args, { opts: s.opts, stats: s.stats, tools: async () => (await $.tool.list()).map(t => t.name) }) }
  })
}
