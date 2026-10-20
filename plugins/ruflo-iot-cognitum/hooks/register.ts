import type { Hook, Register } from 'claude-code'

import { answer } from './command'
import { verdict } from './guard'
import { modeOf, readOptions, type ModOptions } from './options'
import { newStats, STATUS_PATH, statusText, type Stats } from './status'
import { findTool } from './tools'

const TEXT_CAP = 20_000

type Dollar = Parameters<Hook<'session.start'>>[0]

/** Everything one session of the mod keeps: its settings, its counters and the project root. */
type Session = { readonly opts: ModOptions; readonly stats: Stats; root?: string }

async function flush($: Dollar, s: Session): Promise<void> {
  if (s.root === undefined) return
  try {
    await $.fs.write(`${s.root}/${STATUS_PATH}`, statusText(s.stats, modeOf(s.opts), await $.clock.now()))
  } catch {
    /* the status file is a courtesy */
  }
}

/** A read-only call through an already-connected tool: its first text block, or undefined when absent or errored. */
async function peek($: Dollar, suffix: string, args: Record<string, unknown>): Promise<string | undefined> {
  const hit = findTool(await $.tool.list(), suffix)
  if (!hit) return undefined
  const res = await $.mcp.call(hit.server, hit.tool, args)
  return res.isError ? undefined : (res.content.find(b => b.type === 'text')?.text ?? '').slice(0, TEXT_CAP)
}

/**
 * IoT Cognitum as a mod (ADR-445 pattern): a tighten-only guard on this plugin's own tools, `/iot-mod`, and a status file the console
 * reads. No network, no process spawning: only tools already connected.
 */
export const register: Register = (on, options) => {
  const s: Session = { opts: readOptions(options), stats: newStats() }

  on('session.start', async ($, e, next) => {
    const result = await next(e)
    s.root = (await $.session.root()) as string | undefined
    try {
      await $.command.register({ name: 'iot-mod', description: 'IoT Cognitum mod: status, scan <text>, devices' })
    } catch {
      /* a name taken by another plugin must not stop the mod */
    }
    await flush($, s)
    return result
  })

  if (s.opts.guard) {
    on('tool.call', async ($, e, next) => {
      const reason = verdict(e.tool, e, s.opts)
      if (reason === undefined) return next(e)
      s.stats.blocked++
      s.stats.lastDenied = e.tool
      await flush($, s)
      return { deny: reason }
    })
  }

  /** `/iot-mod` is answered locally and takes no model turn. */
  on('command.run', { command: 'iot-mod' }, async ($, e) => {
    s.stats.commands++
    const text = await answer(typeof e.args === 'string' ? e.args : '', {
      opts: s.opts,
      stats: s.stats,
      peek: (suffix, args) => peek($, suffix, args),
      toolNames: async () => (await $.tool.list()).map(t => t.name),
    })
    await flush($, s)
    return { text }
  })
}
