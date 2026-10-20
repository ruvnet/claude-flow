import type { Hook, Register } from 'claude-code'

import { answer } from './command'
import { Engine } from './engine'
import { readOptions } from './options'
import { parseBaseline } from './baseline'
import { CONFIG_FILES, scanConfig } from './scan'
import { isTaintSource, normalise, recvEv, spawnEv } from './shapes'
import { alertsText, allowText, FILES, overridesText, parseAllow, parseAlerts, parseOverrides, parseRing, ringText, statusText } from './store'
import { INJECTION } from './screen'
import { createToastKit, lineOf, type Toaster, type ToastLevel } from './toast-policy'

type Dollar = Parameters<Hook<'session.start'>>[0]

/** Read a project file as text; a missing or unreadable file is an empty string. */
async function readText($: Dollar, root: string, rel: string): Promise<string> {
  try {
    return await $.fs.read(`${root}/${rel}`)
  } catch {
    return ''
  }
}

async function write($: Dollar, e: Engine, rel: string, text: string): Promise<void> {
  if (e.root === '') return
  try {
    await $.fs.write(`${e.root}/${rel}`, text)
  } catch (err) {
    e.degraded = `write failed: ${String((err as Error)?.message ?? err).slice(0, 60)}`
  }
}

/** The files a person reads: status always, baseline and alerts when they changed, the rest on demand. */
async function flush($: Dollar, e: Engine, all: boolean): Promise<void> {
  const now = await $.clock.now()
  await write($, e, FILES.status, statusText(e.status(), now))
  if (!all) return
  await write($, e, FILES.baseline, `${JSON.stringify(e.baseline)}\n`)
  await write($, e, FILES.alerts, alertsText(e.alerts))
}

async function persistAll($: Dollar, e: Engine): Promise<void> {
  await flush($, e, true)
  await write($, e, FILES.rules, overridesText(e.overrides))
  await write($, e, FILES.allow, allowText(e.allow))
}


/** A toast never changes a verdict: it goes through the policy (levels, dedupe, rate limit, the person's setting, a digest for the console), and a refusal is swallowed. */
function toast($: Dollar, held: { toaster?: Toaster }, level: ToastLevel, text: string, always = false): void {
  try {
    if (held.toaster !== undefined) void held.toaster.toast({ level, text, ...(always && { always }) })
    else $.ui.toast(lineOf(level, text))
  } catch {
    /* a refused toast never changes a verdict */
  }
}

/**
 * Project Anatole (ADR-453) as a mod: normalise each event into categorical tokens, apply the deterministic rules, learn only clean events, and report.
 * Only a rule marked `block`, in `enforce`, ever denies. Any failure inside the protector passes the call through and sets `degraded`.
 */
export const register: Register = (on, options) => {
  const opts = readOptions(options)
  const e = new Engine(opts)
  /** The shared toast policy (ADR-477), bound to the engine at session.start; until then a toast is drawn plainly. */
  const held: { toaster?: Toaster } = {}

  on('session.start', async ($, ev, next) => {
    const result = await next(ev)
    try {
      e.root = ((await $.session.root()) as string | undefined) ?? ''
      const at = (path: string) => (e.root === '' ? path : `${e.root}/${path}`)

      held.toaster = createToastKit({
        source: 'protector',
        now: () => $.clock.now(),
        show: (line, options) => $.ui.toast(line, options),
        after: (ms, fn) => $.clock.after(ms, fn),
        io: { read: path => $.fs.read(at(path)), write: (path, text) => $.fs.write(at(path), text), exists: path => $.fs.exists(at(path)) },
      })
      const now = await $.clock.now()
      const sid = `${now.toString(36)}`
      if (e.root !== '') {
        e.load(parseOverrides(await readText($, e.root, FILES.rules)), parseAllow(await readText($, e.root, FILES.allow)), parseAlerts(await readText($, e.root, FILES.alerts)), parseBaseline(await readText($, e.root, FILES.baseline)), parseRing(await readText($, e.root, FILES.ring)))
      }
      e.begin(sid, e.root, now)
      try {
        await $.command.register({ name: 'protector', description: 'Project Anatole: status, list, mode, rule, run, replay, alerts, ack, allow' })
      } catch {
        /* a name taken by another plugin must not stop the mod */
      }
      await persistAll($, e)
    } catch (err) {
      e.degraded = `session start: ${String((err as Error)?.message ?? err).slice(0, 60)}`
    }
    return result
  })

  on('turn.start', async ($, ev, next) => {
    try {
      e.newTurn(typeof ev.text === 'string' ? ev.text : '')
    } catch {
      e.degraded = 'turn start'
    }
    return next(ev)
  })

  on('turn.complete', async ($, ev, next) => {
    const result = await next(ev)
    try {
      const now = await $.clock.now()
      if (e.graduate(now)) {
        toast($, held, 'info', 'Project Anatole: the baseline is mature, so mode moved from learn to notify (never enforce). /protector mode learn to undo.', true)
        await persistAll($, e)
      } else await flush($, e, true)
    } catch {
      e.degraded = 'turn complete'
    }
    return result
  })

  on('session.end', async ($, ev, next) => {
    try {
      await persistAll($, e)
      await write($, e, FILES.ring, ringText(e.ring))
    } catch {
      /* a courtesy */
    }
    return next(ev)
  })

  /** Every tool use: the chain runs first (it may already refuse), then the protector scores the call. A block is a deny; it never asks. */
  on('tool.check', async ($, ev, next) => {
    const chain = await next(ev)
    if (e.mode === 'off') return chain
    try {
      const tool = typeof ev.tool === 'string' ? ev.tool : ''
      const now = await $.clock.now()
      const out = e.evaluate(normalise(tool, ev.input, e.root, now), now, chain.decision === 'deny')
      if (isTaintSource(tool, ev.input)) e.tainted = true
      if (out.alert) {
        toast($, held, out.alert.action === 'blocked' ? 'error' : 'warn', `Project Anatole ${out.alert.action === 'blocked' ? 'blocked' : 'noticed'}: ${out.alert.rule} (${out.alert.severity}). /protector alerts`)
        await flush($, e, true)
      }
      if (out.verdict === 'block' && chain.decision !== 'deny') return { decision: 'deny', reason: out.deny }
    } catch (err) {
      e.degraded = `tool.check: ${String((err as Error)?.message ?? err).slice(0, 60)}`
    }
    return chain
  }).catch(($, ev, next) => next(ev))

  on('agent.spawn', async ($, ev, next) => {
    const result = await next(ev)
    if (e.mode !== 'off') {
      try {
        const now = await $.clock.now()
        const out = e.evaluate(spawnEv(String(ev.subagentType ?? ''), ev.permissionMode, now), now, false)
        if (out.alert) {
          toast($, held, 'warn', `Project Anatole noticed: ${out.alert.rule} (${out.alert.severity}). /protector alerts`)
          await flush($, e, true)
        }
      } catch {
        e.degraded = 'agent.spawn'
      }
    }
    return result
  })

  on('session.receive', async ($, ev, next) => {
    if (e.mode !== 'off' && ev.origin.kind !== 'bridge' && ev.origin.kind !== 'scheduled-trigger') {
      try {
        const names = ['override instructions', 'role reassignment', 'fake role tags', 'concealment']
        const hit = INJECTION.some(([n, re]) => names.includes(n) && re.test(String(ev.text).slice(0, 20_000)))
        if (hit) {
          const now = await $.clock.now()
          const out = e.evaluate(recvEv(true, now), now, false)
          if (out.alert) {
            toast($, held, 'warn', `Project Anatole noticed: ${out.alert.rule} (${out.alert.severity}). /protector alerts`)
            await flush($, e, true)
          }
        }
      } catch {
        e.degraded = 'session.receive'
      }
    }
    return next(ev)
  })

  on('command.run', { command: 'protector' }, async ($, ev) => {
    const now = await $.clock.now()
    const files: Record<string, string> = {}
    if (typeof ev.args === 'string' && ev.args.trim().startsWith('run') && e.root !== '') {
      for (const rel of CONFIG_FILES) {
        const text = await readText($, e.root, rel)
        if (text !== '') files[rel] = text
      }
    }
    const before = JSON.stringify([e.overrides, e.allow, e.baseline.events])
    let changed = false
    const text = answer(typeof ev.args === 'string' ? ev.args : '', e, { now, persist: () => { changed = true }, scan: () => scanConfig(files) })
    if (changed || before !== JSON.stringify([e.overrides, e.allow, e.baseline.events])) await persistAll($, e)
    else await flush($, e, false)
    return { text }
  })
}
