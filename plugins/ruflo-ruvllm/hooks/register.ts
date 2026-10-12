import type { Hook, Register } from 'claude-code'

import { answer } from './command'
import { verdict } from './guard'
import { readOptions, type ModOptions } from './options'
import { newStats, STATUS_PATH, statusText, type Stats } from './status'
import { isOwned, isWriter, shortName } from './tools'

const FLUSH_EVERY_MS = 5000

type Dollar = Parameters<Hook<'session.start'>>[0]

/** Everything one session of the mod keeps: its settings, counters, the project root and when the status file was last written. */
type Session = { readonly opts: ModOptions; readonly stats: Stats; root?: string; flushedMs: number }

async function flush($: Dollar, s: Session): Promise<void> {
  if (s.root === undefined) return
  try {
    const now = await $.clock.now()
    s.flushedMs = now
    await $.fs.write(`${s.root}/${STATUS_PATH}`, statusText(s.stats, s.opts, now))
  } catch {
    /* the status file is a courtesy */
  }
}

/** Counts a call to one of this plugin's tools; the file is rewritten at most every few seconds. */
async function note($: Dollar, s: Session): Promise<void> {
  s.stats.seen++
  try {
    if ((await $.clock.now()) - s.flushedMs >= FLUSH_EVERY_MS) await flush($, s)
  } catch {
    /* counting never fails a tool call */
  }
}

/**
 * ruflo-ruvllm as a mod (ADR-445): a tighten-only guard that keeps secrets out of this plugin's write tools, `/ruvllm-mod`, and a status
 * file the console reads. No network, no process: only tools already connected.
 */
export const register: Register = (on, options) => {
  const s: Session = { opts: readOptions(options), stats: newStats(), flushedMs: 0 }

  on('session.start', async ($, e, next) => {
    const result = await next(e)
    try {
      s.root = (await $.session.root()) as string | undefined
    } catch {
      /* no project root: the mod still answers, it just writes no status file */
    }
    try {
      await $.command.register({ name: 'ruvllm-mod', description: 'ruflo-ruvllm mod: status, scan <text>, tools' })
    } catch {
      /* a name taken by another plugin must not stop the mod */
    }
    await flush($, s)
    return result
  })

  on('tool.call', async ($, e, next) => {
    if (!isOwned(e.tool) && !isWriter(e.tool)) return next(e)
    const reason = s.opts.guard ? verdict(e.tool, e) : undefined
    if (reason === undefined) {
      await note($, s)
      return next(e)
    }
    s.stats.blocked++
    s.stats.lastBlocked = shortName(e.tool)
    await flush($, s)
    return { deny: reason }
  })

  /** `/ruvllm-mod` (a name the plugin's own commands and skills do not use). */
  on('command.run', { command: 'ruvllm-mod' }, async ($, e) => {
    const text = await answer(typeof e.args === 'string' ? e.args : '', { opts: s.opts, stats: s.stats, tools: () => $.tool.list() })
    return { text }
  })
}
