import type { Hook, Register } from 'claude-code'

import { show, statusLine, type Host } from './host'
import { newCounters, STATUS_PATH, statusText, type Counters } from './status'

type Dollar = Parameters<Hook<'session.start'>>[0]

/** What one session keeps: the counters for the status file, the project root and the start time. */
type Session = { readonly counters: Counters; root?: string; startedMs: number }

/** A top-level function declaration, so `import type { Hook, Register } from 'claude-code'

import { show, statusLine, type Host } from './host'
 may be passed to it; a refused write is ignored (the status file is a courtesy). */
async function flush($: Dollar, s: Session): Promise<void> {
  if (s.root === undefined) return
  try {
    await $.fs.write(`${s.root}/${STATUS_PATH}`, statusText(s.counters, await $.clock.now(), s.startedMs))
  } catch {
    // never fail a hook over the status file
  }
}

/**
 * A mod scaffolded by ruflo-plugin-creator (ADR-404 patterns):
 * - observe: `const r = await next(e); …; return r` on tool.call;
 * - every `$` call literal, wrapped in a host adapter, refusal-tolerant;
 * - namespaced command (`my-mod-status`), never a built-in's name;
 * - the classic fallback handed over through MY_MOD_ACTIVE;
 * - a status file (status.ts) the console reads: keep `calls` a number.
 * Hot reload re-runs register and session.start: keep anything that must
 * survive a reload in `$.store` or `$.state`, not in these variables.
 */
export const register: Register = (on, options) => {
  const showLine = options.statusLine !== false
  const s: Session = { counters: newCounters(), startedMs: 0 }

  on('session.start', async ($, e, next) => {
    await $.env.set('MY_MOD_ACTIVE', '1').catch(() => undefined)
    await $.command.register({ name: 'my-mod-status', description: 'my-mod: tool calls this session' }).catch(() => undefined)
    try {
      s.root = (await $.session.root()) as string | undefined
      s.startedMs = await $.clock.now()
    } catch {
      // no project root: the mod still runs, it just writes no status file
    }
    await flush($, s)
    return next(e)
  })

  on('tool.call', async ($, e, next) => {
    const result = await next(e)
    s.counters.calls++
    const host: Host = { status: text => $.ui.status(text) }
    if (showLine) show(host, s.counters.calls)
    await flush($, s)
    return result
  })

  on('command.run', { command: 'my-mod-status' }, () => ({ text: statusLine(s.counters.calls) }))
}
