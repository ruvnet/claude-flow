/**
 * Builds the console's Host: the one object every hook and view reaches through to touch the engine. It wraps the `$` interface
 * so a view never sees the engine directly, which keeps paths rooted, draws quiet when refused, routes every toast through the
 * ADR-477 toast policy, and lets us bind the Windows write flavor (write-via.ts). Lives in its own module so register.ts stays
 * under the plugin's 500-line smoke step (step 11).
 */
import type { EngineInterface } from 'claude-code'
import { homeOf, isAbsolutePath, joinPath } from './data/paths'
import type { Host } from './host'
import { PANE_ID } from './state'
import { createToaster, type Digest, type ToastLevel, type ToastPrefs } from './toast-policy'

const RUFLO_TOOL = /^mcp__(claude-flow|ruflo|plugin_ruflo[\w-]*)__/

let isResettingScroll = false

/** Read by register.ts's `ui.scroll` handler: a scroll fired by `host.scrollTop()` is ours and must not be forwarded. */
export const isResettingScrollNow = (): boolean => isResettingScroll

export function hostOf($: EngineInterface, cwd: string, toasts: { prefs: () => ToastPrefs; record: (digest: Digest) => void }): Host {
  const rooted = (path: string) => (isAbsolutePath(path) ? path : joinPath(cwd, path))
  const quietly = (fn: () => unknown) => {
    try {
      const result = fn()

      if (result instanceof Promise) result.catch(() => undefined)
    } catch {
      // Refused: there is nothing to do about a draw nobody may make.
    }
  }

  // ADR-477: every toast of the console goes through the shared policy (levels, one clean line, de-duplication, a rate limit, the person's
  // Toasts setting); drawn or not, each is recorded for the Events page. A refused draw is a refused toast, never a crash.
  const toaster = createToaster({
    source: 'console',
    now: () => Date.now(),
    show: (line, options) => $.ui.toast(line, options),
    after: (ms, fn) => $.clock.after(ms, fn),
    prefs: toasts.prefs,
    persist: toasts.record,
  })

  return {
    fs: {
      read: async path => $.fs.read(rooted(path)),
      stat: async path => $.fs.stat(rooted(path)),
      list: async path => $.fs.list(rooted(path)),
      // The Windows write flavor (write-via.ts): the host's own file API, since no dd, sh, install, mkdir or cp is on the engine's PATH there.
      write: async (path, text) => $.fs.write(rooted(path), text),
      exists: async path => $.fs.exists(rooted(path)),
    },
        every: (ms, fn) => $.clock.every(ms, fn),
    after: (ms, fn) => $.clock.after(ms, fn),
    storeGet: async key => $.store.get(key),
    storeSet: async (key, value) => $.store.set(key, value as never),
    fetchText: async url => {
      const response = await $.http.fetch(url)

      return { ok: response.ok, status: response.status, text: response.text }
    },
    askChoice: async (question, options) => $.ui.ask(question, options),
    toast: (text, timeoutMs, level: ToastLevel = 'info') => quietly(() => void toaster.toast({ level, text, ...(timeoutMs !== undefined && { timeoutMs }) })),
    invalidate: () => quietly(() => $.ui.invalidate('ui.render')),
    // Once now and once after the new page has drawn: a page taller than the one before keeps the old offset until it is moved.
    scrollTop: () => {
      const go = () =>
        quietly(() => {
          isResettingScroll = true

          return Promise.resolve($.ui.scroll({ to: 'start', in: PANE_ID })).finally(() => {
            isResettingScroll = false
          })
        })

      go()
      $.clock.after(80, go)
    },
    focus: async (paneId, key) => $.ui.focus({ requestId: paneId, key }),
    blit: args => quietly(() => $.ui.blit(args)),
    openPane: async pane => $.ui.open(pane),
    closePane: async id => $.ui.close({ id }),
    panes: async () => $.ui.panes(),
    registerCommand: async spec => $.command.register(spec),
    run: async (argv, timeoutMs, stdin) => $.process.run(argv, { cwd, timeoutMs, ...(stdin !== undefined && { stdin }) }),
    spawn: (argv, input) => $.process.spawn({ argv, cwd, ...(input !== undefined && { input }) }),
    usage: async () => {
      const usage = await $.session.usage()

      return { ...(usage.cost?.usd !== undefined && { costUsd: usage.cost.usd }), ...(usage.context?.percent !== undefined && { contextPercent: usage.context.percent }) }
    },
    rufloTools: async () => {
      const names = (await $.tool.list()).flatMap(tool => RUFLO_TOOL.exec(tool.name)?.slice(1, 2) ?? [])

      return { tools: names.length, servers: [...new Set(names)].sort() }
    },
    settings: async () => $.settings.read(),
    home: async () => {
      const [home, userProfile, homeDrive, homePath] = await Promise.all([
        $.env.get('HOME'),
        $.env.get('USERPROFILE'),
        $.env.get('HOMEDRIVE'),
        $.env.get('HOMEPATH'),
      ])
      const envVars: { [key: string]: string | undefined } = { HOME: home, USERPROFILE: userProfile, HOMEDRIVE: homeDrive, HOMEPATH: homePath }

      return homeOf(k => envVars[k])
    },
    configDir: async () => $.env.get('CLAUDE_CONFIG_DIR'),
    pluginRoot: $.plugin.root,
    // `$.ruflo` exists only where ruflo-mods is seated; validate refuses feature-detecting a noun, so these are
    // async: a missing noun throws inside the promise and every caller's catch sees a rejection.
    rufloSnapshot: async () => $.ruflo.snapshot(),
    rufloRoute: async () => $.ruflo.lastRoute(),
    rufloSegment: async text => $.ruflo.segment({ id: 'console', text }),
    // Both wait on the turn, so neither may be called from inside a command.run hook (`/ruflo yes` is one): they run from a clock
    // tick, a later event of their own.
    submitPrompt: text =>
      new Promise<void>((resolve, reject) => {
        $.clock.after(1, () => void $.prompt.submit({ text }).then(() => resolve(), reject))
      }),
    fillPrompt: async text => (await $.prompt.fill({ text, mode: 'replace' })).isFilled,
    runSlash: (command, args) =>
      new Promise((resolve, reject) => {
        $.clock.after(1, () => void $.command.run({ command, args }).then(resolve, reject))
      }),
    listCommands: async () => (await $.command.list()).map(command => command.name),
    // ADR-465. A tool call waits on the turn like submitPrompt, so it starts from a clock tick, never inside the hook that asked.
    toolCall: input =>
      new Promise((resolve, reject) => {
        $.clock.after(1, () => void $.tool.call(input as never).then(reply => resolve(reply as never), reject))
      }),
    toolCheck: async (tool, input) => $.tool.check({ tool, input }),
    httpSend: async (url, init) => {
      const response = await $.http.fetch(url, init)

      return { ok: response.ok, status: response.status, text: response.text }
    },
  }
}
