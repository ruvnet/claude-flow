import type { EngineInterface, On } from 'claude-code'
import type { GuidanceHooks } from './guidance'

import { detectBrain } from './grounding'
import { versionText } from './probe'
import { HANDSHAKE_MARKER, ownedEvents } from './ownership'
import type { ModOptions } from './options'
import { ATTENTION_MAX_BYTES, ATTENTION_STATUS, attentionLine } from './attention'
import { MAX_BYTES, PROTECTOR_STATUS, protectorLine } from './protector'
import { redraw, report, under, type ModState } from './state'
import { runSelfCheck } from './selfcheck'
import { bindToasts } from './toast'

/** `/ruflo-mods` plus the protector row when `.claude-flow/protector-mod/status.json` is present and readable (bounded, regular file only). */
/** The `attention:` row when the sessionAttention option is on and the console's summary file is a small regular file; never anything else. */
async function attentionRow($: EngineInterface, s: ModState, on: boolean): Promise<string | undefined> {
  if (!on) return undefined
  try {
    const path = under(s, ATTENTION_STATUS)
    const st = await $.fs.stat(path)
    if (st.kind !== 'file' || st.size > ATTENTION_MAX_BYTES) return undefined
    return attentionLine(await $.fs.read(path), await $.clock.now().catch(() => Date.now()))
  } catch {
    return undefined
  }
}

async function reportWithProtector($: EngineInterface, s: ModState, withAttention = false): Promise<string> {
  const extra = await attentionRow($, s, withAttention)
  const base = extra === undefined ? report(s) : `${report(s)}\n${extra}`
  try {
    const path = under(s, PROTECTOR_STATUS)
    const st = await $.fs.stat(path)
    if (st.kind !== 'file' || st.size > MAX_BYTES) return base
    const row = protectorLine(await $.fs.read(path))
    return row ? `${base}\n${row}` : base
  } catch {
    return base
  }
}

const HELPER = '.claude/helpers/hook-handler.cjs'

/**
 * Where the mod notes that it started and what it owns, for `ruflo mods
 * doctor` to read. Display only: nothing decides by it.
 */
export const HEARTBEAT_PATH = '.claude-flow/mods/session.json'

/**
 * Whether every hook-handler.cjs a classic hook could run honours the
 * handshake. Settings name the project's copy, `$HOME`'s, or probe one then
 * the other (settings-generator `hookCmd`), so both are checked: one copy too
 * old for the handshake is enough to stand down. Unreadable counts as too
 * old. With neither present no classic route/post-edit can run at all.
 */
async function helperHonours($: EngineInterface): Promise<boolean> {
  const root = await $.session.root().catch(() => undefined)
  const home = await $.env.get('HOME').catch(() => undefined)
  // The generated Windows command falls back to %USERPROFILE%\.claude\helpers when the project has no copy.
  const profile = await $.env.get('USERPROFILE').catch(() => undefined)
  for (const base of new Set([root, home, profile])) {
    if (!base) continue
    const path = `${base}/${HELPER}`
    if (!(await $.fs.exists(path).catch(() => true))) continue
    const text = await $.fs.read(path).catch(() => '')
    if (!text.includes(HANDSHAKE_MARKER)) return false
  }
  return true
}

/** ADR-485: the brain's status from installed_plugins.json and the merged settings; any failure is `unknown`. */
async function detectGrounding($: EngineInterface, settings: unknown) {
  try {
    const dir = (await $.env.get('CLAUDE_CONFIG_DIR').catch(() => undefined)) || `${(await $.env.get('HOME').catch(() => undefined)) ?? ''}/.claude`
    const path = `${dir}/plugins/installed_plugins.json`
    const stat = await $.fs.stat(path)

    if (stat.kind !== 'file' || stat.size > 2_000_000) return detectBrain(null, settings)

    return detectBrain(await $.fs.read(path), settings)
  } catch {
    return detectBrain(null, settings)
  }
}

/** Whether a ruflo statusLine is configured: then the mod draws none. */
function hasClassicStatusLine(settings: unknown): boolean {
  const command = (settings as { statusLine?: { command?: unknown } } | null)?.statusLine?.command
  return typeof command === 'string' && /statusline\.c?js/.test(command)
}

/**
 * At session start: decide which events the mod owns and tell the classic
 * hooks through the process environment; register `/ruflo-mods`. Any failure
 * leaves the mod owning nothing, so every classic hook keeps running.
 */
export function registerSession(on: On, state: ModState, options: ModOptions, guidance?: GuidanceHooks) {
  on('session.start', async ($, e, next) => {
    state.root = await $.session.root()
    bindToasts(state, {
      now: () => $.clock.now(),
      show: (line, options) => $.ui.toast(line, options),
      after: (ms, fn) => $.clock.after(ms, fn),
      read: path => $.fs.read(`${state.root}/${path}`),
      write: (path, text) => $.fs.write(`${state.root}/${path}`, text),
      exists: path => $.fs.exists(`${state.root}/${path}`),
    })
    // A user-scoped install loads in every project. Existing Ruflo state is
    // the opt-in boundary: a missing, unreadable or non-directory path must
    // neither own project events nor be created by the display heartbeat.
    const project = await $.fs.stat(under(state, '.claude-flow')).then(stat => stat.kind === 'dir').catch(() => false)
    const settings = await $.settings.read()
    if (options.selfCheck) await runSelfCheck({ read: path => $.fs.read(path), exists: path => $.fs.exists(path), home: () => $.env.get('HOME'), configDirEnv: () => $.env.get('CLAUDE_CONFIG_DIR') }, state, (settings as { enabledPlugins?: unknown } | null)?.enabledPlugins)
    state.owned = new Set(project ? ownedEvents(settings, await helperHonours($)) : [])
    await $.env.set('RUFLO_MODS_OWNS', state.owned.size ? [...state.owned].join(',') : undefined)
    state.statusLine = options.statusLine && !hasClassicStatusLine(settings)
    if (state.probe.enabled) state.probe.version = versionText(await $.session.version().catch(() => undefined))
    if (state.grounding.enabled) state.grounding.status = await detectGrounding($, settings)
    guidance?.start()
    redraw(state)
    await $.command
      .register({ name: 'ruflo-mods', description: 'Same as /ruflo mods: what this session routed, recorded and tightened' })
      .catch(() => undefined)
    if (project) {
      const heartbeat = { startedAt: new Date().toISOString(), owned: [...state.owned], statusLine: state.statusLine, ...(state.probe.enabled ? { engine: state.probe.version ?? null, events: [...state.probe.registered].sort() } : {}) }
      await $.fs.write(under(state, HEARTBEAT_PATH), `${JSON.stringify(heartbeat, null, 2)}\n`).catch(() => undefined)
    }
    return next(e)
  }).catch(async ($, e, next) => {
    state.owned = new Set()
    await $.env.set('RUFLO_MODS_OWNS', undefined).catch(() => undefined)
    try {
      $.ui.log(`ruflo mods: session start failed (${next.error.message ?? next.error.kind}); classic hooks keep every event`, {
        to: 'debug',
      })
    } catch {
      // a withheld ui.log changes nothing: the classic hooks already have every event
    }
    // Replay-safe: resolves to what the hook's own call settled to, or runs
    // the hooks beneath once when it never called.
    return next(e)
  })

  on('command.run', { command: 'ruflo-mods' }, async $ => ({ text: await reportWithProtector($, state, options.sessionAttention) }))

  // `/ruflo` is ruflo-console's one command for every ruflo mod; its `mods` subcommand is this report. The console
  // registers `/ruflo`; this hook answers `mods` wherever it sits in the chain and passes every other word on.
  // `/ruflo-mods` above stays registered as its alias: ADR-406 removes, renames or reassigns no command.
  // `/ruflo-console` is the same command as `/ruflo` (kept by ADR-406), so its `mods` is answered too.
  for (const command of ['ruflo', 'ruflo-console'] as const) {
    on('command.run', { command }, async ($, e, next) => (e.args.trim().split(/\s+/)[0]?.toLowerCase() === 'mods' ? { text: await reportWithProtector($, state, options.sessionAttention) } : next(e)))
  }
}
