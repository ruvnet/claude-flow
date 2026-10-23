/**
 * The autopilot panel in the Workflows board (ADR-466 §6): status and the band line, the gates (Project Anatole, permission preflight,
 * spend, journal), the sealed envelope and a draft editor with validation, start / pause / resume / stop, the adaptation history with
 * its receipts, and the digest. Registered through the slot seams (views/wf-slots.ts); `import './ap-panel'` in views/wf-register.ts and
 * `wireAutopilot(state, host, { toolCheck })` once beside the other wires. Every figure is read from a file or a reply; where one was
 * not read the panel says `n/a`, never `$0`. Start is the one confirm; Stop and Pause only narrow authority and ask nothing.
 */
import type { RenderElement } from 'claude-code'

import type { ActionSpec } from '../actions'
import { activeOf, apTick, appendEvents, AUTOPILOT_WINDOWS_REFUSAL, clearKill, drainNotices, hostOf, pauseNow, refreshAutopilot, resumeNow, setPin, stopNow, storeOf, writeEnvelope } from '../ap-live'
import { DEFAULTS, tierOf, tunablesFrom, verifyReceipts } from '../data/ap-adapt'
import { AUTOPILOT_DIR, hashOf, HARD_DENIES, MAX_DURATION_MS, MIN_DURATION_MS, seal, TOOL_CLASSES, validateEnvelope, widened, type Envelope, type ToolClass } from '../data/ap-envelope'
import { anatoleFact } from '../data/ap-guard'
import { SPEND_BASIS, spendSource } from '../data/ap-spend'
import { bandText, summarize } from '../data/ap-loop'
import { cleanText } from '../data/wf-clean'
import { writeFlavorReady } from '../data/write-flavor'
import { readBounded, under } from '../data/files'
import type { NoticeDraft } from '../notices'
import type { State } from '../state'
import { ago, button, clip, kv, row, text, THEME, type Ctx } from './common'
import { draftOf, defaultDraft, spanText, type DraftState } from './ap-draft'
import { editorLists } from './ap-editor'
import './ap-band'
import './ap-parked'
import { registerSlot, type SlotEnv } from './wf-slots'

export { defaultDraft, draftOf }
const START_WHY = 'the envelope draft is not valid, or nothing changed since the running one, or autopilot is not wired into this console'
export const DRAFT_FILE = `${AUTOPILOT_DIR}/envelope.draft.json`
const DAY = 86_400_000

const spendOf = (d: DraftState): Record<string, number> => ({ ...(d.value.spend as Record<string, number>) })

/** One edit of the draft by the editor's buttons. Pure on the draft object it is given. */
export function editDraft(d: DraftState, edit: { kind: 'class'; cls: ToolClass } | { kind: 'spend'; key: 'hourUsd' | 'dayUsd' | 'totalUsd'; by: 1 | -1 } | { kind: 'concurrency'; by: 1 | -1 } | { kind: 'days'; by: 1 | -1 } | { kind: 'anatole' }): void {
  const v = d.value

  if (edit.kind === 'class') {
    const have = (v.toolClasses as string[]) ?? []

    v.toolClasses = have.includes(edit.cls) ? have.filter(c => c !== edit.cls) : [...have, edit.cls]
  } else if (edit.kind === 'spend') {
    const spend = spendOf(d)
    const now = spend[edit.key] ?? 1
    const step = now >= 100 ? 25 : now >= 10 ? 5 : 1

    spend[edit.key] = Math.max(1, now + edit.by * step)
    v.spend = spend
  } else if (edit.kind === 'concurrency') v.concurrency = Math.max(1, Math.min(8, Number(v.concurrency ?? 1) + edit.by))
  else if (edit.kind === 'days') v.maxDurationMs = Math.max(MIN_DURATION_MS, Math.min(MAX_DURATION_MS, Number(v.maxDurationMs ?? DAY) + edit.by * DAY))
  else v.acceptWithoutAnatole = v.acceptWithoutAnatole !== true

  d.fromFile = null
}

/** Reads the draft file (paths, repos, network and verify are written there: they are lists, not buttons). Validated on the way in; a bad file changes nothing. */
export async function loadDraftFile(state: State): Promise<string> {
  const host = hostOf(state)

  if (host === undefined) return 'not wired into this console yet'

  const read = await readBounded(host.fs, state.cache, under(state.cwd, DRAFT_FILE), 65_536, true)

  if (read.text === null) return read.reason === 'missing' ? `no ${DRAFT_FILE} to load` : `the draft file was refused: ${read.reason}`

  let parsed: unknown

  try {
    parsed = JSON.parse(read.text)
  } catch {
    return 'the draft file is not JSON'
  }

  const checked = validateEnvelope(parsed)

  if (!checked.ok) return `the draft file does not validate: ${cleanText(checked.errors[0] ?? '')}`

  const d = draftOf(state)

  d.value = JSON.parse(JSON.stringify(checked.envelope)) as Record<string, unknown>
  d.fromFile = DRAFT_FILE
  d.refused = null
  host.invalidate()

  return 'draft loaded'
}

/** Buttons that wrap onto more lines when the page is narrow, so none is pushed off the edge where a click cannot reach it. */
const flow = (ctx: Ctx, parts: readonly RenderElement[], key: string): RenderElement => ctx.kit.Box({ flexDirection: 'row', flexWrap: 'wrap', key, children: [...parts] })

const money = (n: number | undefined | null): string => (n === undefined || n === null ? 'n/a' : `$${Math.round(n * 100) / 100}`)
const COLOR = { running: THEME.ok, paused: THEME.warn, stopped: THEME.bad, idle: undefined } as const

function gates(ctx: Ctx, env: Envelope | null): RenderElement[] {
  const store = storeOf(ctx.state)
  const anatole = anatoleFact(ctx.state.snapshot?.anatole)
  const classes = Object.entries(store.preflight)
  const denied = classes.filter(([, v]) => v === 'deny' || v === 'ask').map(([k]) => k)

  const source = spendSource(ctx.state)
  const why = store.spendWhy ?? (source.kind === 'unavailable' ? source.why : null)

  return [
    kv(ctx, 'Anatole', anatole === 'on' ? 'on' : anatole === 'off' ? 'OFF: autopilot pauses' : 'not installed', anatole === 'on' ? THEME.ok : THEME.warn),
    kv(ctx, 'permissions', !store.hasCheck ? 'preflight not wired: the engine still decides every call, never bypassed' : classes.length === 0 ? 'not checked yet (the first pass asks the engine)' : denied.length === 0 ? 'your settings allow every class' : `would ask or deny: ${denied.join(', ')} (parked)`, store.hasCheck ? undefined : THEME.warn),
    kv(ctx, 'spend', `hour ${money(store.spend?.hourUsd)}/${money(env?.spend.hourUsd)} · day ${money(store.spend?.dayUsd)}/${money(env?.spend.dayUsd)} · total ${money(store.spend?.totalUsd)}/${money(env?.spend.totalUsd)}${store.spend === null ? ` (ledger not read${why === null ? '' : `: ${cleanText(why)}`}; nothing starts until it is)` : ' (estimate, see below)'}`),
    ...(store.spend === null ? [] : [text(ctx, ` ${SPEND_BASIS}`, { dimColor: true })]),
    kv(ctx, 'journal', `${Math.round(store.journalBytes / 1000)} kB of 1500 kB cap${store.badLines > 0 ? ` · ${store.badLines} unusable lines` : ''}`),
  ]
}

function envelopeRows(ctx: Ctx, nowMs: number): RenderElement[] {
  const store = storeOf(ctx.state)

  if (store.sealed === null) return [text(ctx, store.envWhy === null ? ' no envelope approved yet: set one below and press Start' : ` envelope refused: ${cleanText(store.envWhy)}`, { color: store.envWhy === null ? undefined : THEME.bad })]

  const e = store.sealed.envelope

  return [
    text(ctx, ` "${cleanText(e.name)}" revision ${store.sealed.revision} · hash ${store.sealed.hash.slice(0, 12)} · approved ${ago(store.sealed.approvedAtMs, nowMs)}`),
    text(ctx, ` classes ${e.toolClasses.join(' ') || 'none'} · up to ${e.concurrency} at once · ${spanText(e.maxDurationMs)} · ${e.verify.length} verify command${e.verify.length === 1 ? '' : 's'}`, { dimColor: true }),
    text(ctx, ` folders ${e.paths.map(cleanText).join(', ')}`, { dimColor: true }),
    text(ctx, ` network ${e.network.join(',') || 'none'} · repos ${e.repos.join(',') || 'none'} · secret names ${e.secretEnv.join(',') || 'none'}`, { dimColor: true }),
    text(ctx, ' checked against what a task SAYS: its class, paths, URLs and repos', { dimColor: true }),
    text(ctx, ' enforced: spend, concurrency, duration, verify. Secret names are a record only.', { dimColor: true }),
    text(ctx, ` never granted: ${HARD_DENIES.join(', ')}`, { dimColor: true }),
  ]
}

function editor(ctx: Ctx): RenderElement[] {
  const d = draftOf(ctx.state)
  const host = hostOf(ctx.state)
  const have = (d.value.toolClasses as string[]) ?? []
  const spend = spendOf(d)
  const checked = validateEnvelope(d.value)
  const set = (edit: Parameters<typeof editDraft>[1]): (() => void) => () => {
    editDraft(d, edit)
    host?.invalidate()
  }

  const rows: RenderElement[] = [
    text(ctx, ' classes', { dimColor: true }),
    flow(ctx, TOOL_CLASSES.map(cls => button(ctx, `ap-c-${cls}`, `${have.includes(cls) ? '●' : '○'} ${cls}`, set({ kind: 'class', cls }))), 'ap-classes'),
  ]

  for (const key of ['hourUsd', 'dayUsd', 'totalUsd'] as const) rows.push(row(ctx, [text(ctx, ` ${key.replace('Usd', '').padEnd(8)}   `, { dimColor: true }), button(ctx, `ap-s-${key}-less`, ' − ', set({ kind: 'spend', key, by: -1 })), text(ctx, ` ${money(spend[key])} `, { bold: true }), button(ctx, `ap-s-${key}-more`, ' + ', set({ kind: 'spend', key, by: 1 }))], `ap-spend-${key}`))

  rows.push(row(ctx, [text(ctx, ' at once    ', { dimColor: true }), button(ctx, 'ap-n-less', ' − ', set({ kind: 'concurrency', by: -1 })), text(ctx, ` ${String(d.value.concurrency)} `, { bold: true }), button(ctx, 'ap-n-more', ' + ', set({ kind: 'concurrency', by: 1 })), text(ctx, '   duration ', { dimColor: true }), button(ctx, 'ap-d-less', ' − ', set({ kind: 'days', by: -1 })), text(ctx, ` ${spanText(Number(d.value.maxDurationMs))} `, { bold: true }), button(ctx, 'ap-d-more', ' + ', set({ kind: 'days', by: 1 }))], 'ap-conc'))
  rows.push(flow(ctx, [button(ctx, 'ap-anatole', `${d.value.acceptWithoutAnatole === true ? '●' : '○'} accept running without Anatole`, set({ kind: 'anatole' })), button(ctx, 'ap-load', 'load draft file', () => void loadDraftFile(ctx.state))], 'ap-draft-row'))
  rows.push(text(ctx, ` ${DRAFT_FILE} can load all the lists in one go`, { dimColor: true }))
  rows.push(text(ctx, checked.ok ? ` draft is valid · hash ${hashOf(checked.envelope).slice(0, 12)}${d.fromFile === null ? '' : ' · from file'} · ${(d.value.paths as string[]).join(', ')}` : ` draft is not valid: ${cleanText(checked.errors.slice(0, 2).join('; '))}`, { color: checked.ok ? undefined : THEME.bad }))

  rows.push(...editorLists(ctx, d, storeOf(ctx.state).sealed?.envelope ?? null))

  return rows
}

function adaptRows(ctx: Ctx, env: Envelope | null): RenderElement[] {
  const { receipts } = storeOf(ctx.state).loop
  const chain = verifyReceipts(receipts)

  if (receipts.length === 0) return [text(ctx, ' no adaptation yet: it needs 6 or more verified steps on a setting that is failing (or 12 clean ones) before it proposes anything', { dimColor: true })]

  const t = env === null ? DEFAULTS : tunablesFrom(receipts, env)

  return [
    text(ctx, ` now: parallelism ${t.parallelism} · retries ${t.retries} · default tier ${t.defaultTier}${Object.keys(t.tiers).length === 0 ? '' : ` · ${Object.keys(t.tiers).map(cls => `${cls}→${tierOf(t, cls)}`).join(' ')}`} · chain ${chain.ok ? 'intact' : `BROKEN at ${chain.badAt}`}`, { color: chain.ok ? undefined : THEME.bad }),
    ...receipts.slice(-5).map(r => text(ctx, ` ${r.hash.slice(0, 8)} ${r.path} ${r.from}→${r.to} (${r.direction}) · ${clip(cleanText(r.evidence), Math.max(30, ctx.columns - 50))}`, { dimColor: true })),
  ]
}

export function boardRows(env: SlotEnv): RenderElement[] {
  const { ctx, nowMs } = env
  const store = storeOf(ctx.state)
  const host = hostOf(ctx.state)

  if (host === undefined) return [text(ctx, ' autopilot: not wired into this console yet (wireAutopilot)', { color: THEME.warn })]

  const s = store.loop
  const sum = summarize(s, nowMs)
  const e = store.sealed !== null && store.sealed.hash === s.envHash ? store.sealed.envelope : null
  const band = bandText(s, nowMs, store.spend?.totalUsd ?? null, e)
  const rows: RenderElement[] = [text(ctx, ` ${band === '' ? 'autopilot is off' : band}${store.killed ? ' · KILL flag present' : ''}`, { color: COLOR[sum.phase], bold: true })]

  rows.push(text(ctx, ` ${sum.phase}${sum.reason === null ? '' : `: ${cleanText(sum.reason)}`} · ${store.status} · ${sum.running} running · ${sum.done} done (${sum.unverified} unverified) · ${sum.failed} failed${store.readAtMs > 0 ? ` · read ${ago(store.readAtMs, nowMs)}` : ''}`, { dimColor: true }))
  if (store.error !== null) rows.push(text(ctx, ` ${cleanText(store.error)}`, { color: THEME.warn }))

  // Stop has no hotkey: the digits and letters are views' keys (a hotkey here would open another page). The button and /ruflo autopilot stop are the ways.
  rows.push(flow(ctx, [
    // Start lives here too: the page draws its action row only when a workflow run is selected, and a project with no run (a plain scratch repo) would have no way to start.
    button(ctx, 'ap-start-btn', 'Start autopilot', () => ctx.act.workflows.ask(startSpec(env), START_WHY), { primary: true }),
    button(ctx, 'ap-stop', 'Stop', () => void stopNow(ctx.state, host)),
    ...(sum.phase === 'running' ? [button(ctx, 'ap-pause', 'Pause', () => void pauseNow(ctx.state, host))] : []),
    ...(sum.phase === 'paused' ? [button(ctx, 'ap-resume', 'Resume', () => void resumeNow(ctx.state, host), { primary: true })] : []),
    button(ctx, 'ap-tick', 'Check now', () => void apTick(ctx.state, host)),
  ], 'ap-controls'))
  rows.push(text(ctx, ' Start asks first (the card lists every command) · Stop asks nothing, and so does /ruflo autopilot stop', { dimColor: true }))

  rows.push(...gates(ctx, e), ...envelopeRows(ctx, nowMs), ...adaptRows(ctx, e))
  rows.push(text(ctx, ' next envelope (a change asks again):', { dimColor: true }), ...editor(ctx))
  rows.push(text(ctx, ' Inside the envelope autopilot does not ask this console. It never bypasses Claude Code\'s permission dialog.', { dimColor: true }))
  rows.push(text(ctx, ' It is not a sandbox (the envelope gates what a task says) and not a scheduler: it runs while the session lives.', { dimColor: true }))

  return rows
}

/** The confirm card for Start (and for any change of the envelope). Null when the draft is invalid or nothing changed, with the reason on the action row. */
export function startSpec(env: SlotEnv): ActionSpec | null {
  const { state } = env.ctx
  const host = hostOf(state)
  const d = draftOf(state)
  const checked = validateEnvelope(d.value)

  if (host === undefined || !checked.ok) return null

  const store = storeOf(state)
  const next = checked.envelope
  const prev = store.sealed?.envelope ?? null
  const hash = hashOf(next)

  if (store.loop.phase === 'running' && store.sealed?.hash === hash) return null

  const grew = prev === null ? [] : widened(prev, next)
  const anatole = anatoleFact(state.snapshot?.anatole)

  return {
    label: `start autopilot "${next.name}" (${next.toolClasses.join(' ')} · up to ${money(next.spend.totalUsd)} · ${spanText(next.maxDurationMs)})`,
    scope: 'workflows',
    args: [],
    declared: 'spend',
    shows: `envelope ${hash.slice(0, 12)}: classes ${next.toolClasses.join(' ')}; folders ${next.paths.join(', ')}; network ${next.network.join(',') || 'none'}; ${money(next.spend.hourUsd)}/h ${money(next.spend.dayUsd)}/day ${money(next.spend.totalUsd)} total; ${next.concurrency} at once; ${next.verify.length === 0 ? 'no verify commands (steps will be unverified)' : `verify commands run by this console after each step: ${next.verify.map(argv => clip(cleanText(argv.join(' ')), 80)).join(' ; ')}`}; repos ${next.repos.join(', ') || 'none'}; secret env names ${next.secretEnv.join(', ') || 'none'}; Anatole ${anatole}${next.acceptWithoutAnatole ? ' (running without it accepted)' : ''}${grew.length > 0 ? `; WIDENS: ${grew.join('; ')}` : ''}; never: ${HARD_DENIES.join(', ')}`,
    expect: 'a start line in the autopilot journal, then steps handed to the session',
    note: 'After this, steps inside the envelope run WITHOUT asking this console, for days if the session lives, and spend money. Claude Code\'s own permission dialog still applies and is never bypassed: anything it would ask about is parked. Stop, the KILL file or /ruflo autopilot stop halts it within one tick.',
    run: async () => {
      // Windows (host-fs): no atomic append for the journal's duplicate-start guard and no Windows-aware path fence yet. Nothing is written or dispatched (follow-up).
      if ((await writeFlavorReady()) === 'host-fs') {
        store.error = AUTOPILOT_WINDOWS_REFUSAL
        host.toast(AUTOPILOT_WINDOWS_REFUSAL)
        host.invalidate()

        return
      }

      const now = Date.now()
      const sealed = seal(next, (store.sealed?.revision ?? 0) + 1, now)
      const mode = anatoleFact(state.snapshot?.anatole)

      if (mode !== 'on' && !next.acceptWithoutAnatole) {
        store.error = `not started: Project Anatole is ${mode === 'off' ? 'off' : 'not installed'}; turn it on, or accept running without it in the envelope`
        host.invalidate()

        return
      }

      if (!(await writeEnvelope(state, host, sealed))) {
        store.error = 'not started: the envelope could not be written'
        host.invalidate()

        return
      }

      await clearKill(state, host)
      store.killed = false
      store.spend = null
      store.spendAtMs = 0

      // What the person approved is pinned OUTSIDE the project first (the journal and envelope can be written by the steps): the hash and the count of start lines.
      const before = store.pin

      await refreshAutopilot(state, host)
      store.isPinPending = true
      await setPin(store, host, state.cwd, { envHash: sealed.hash, starts: store.loop.starts + 1 })

      const started = await appendEvents(state, host, [{ t: 'start', at: now, envHash: sealed.hash, revision: sealed.revision, anatole: mode === 'on' ? 'on' : 'accepted-without' }])

      if (!started) await setPin(store, host, state.cwd, before)
      store.isPinPending = false
      if (started) void apTick(state, host)
    },
  }
}

/** Registers this module's slots; a repeat is refused harmlessly. */
export function registerAutopilotSlots(): void {
  registerSlot({ kind: 'board', id: 'autopilot', title: 'Mission autopilot', order: 5, render: boardRows })
  // No hotkeys (ADR-470 live finding): every digit and letter is a view's key or the page's own, and a slot hotkey that equals a view key loses to it (8 opened MetaHarness, 9 opened Memory, so the advertised Stop key never ran). Stop is a button and /ruflo autopilot stop.
  registerSlot({ kind: 'action', id: 'ap-start', label: 'start autopilot', why: START_WHY, spec: startSpec })
  registerSlot({
    kind: 'notice',
    id: 'autopilot',
    between: (): NoticeDraft[] => {
      const state = activeOf()
      const host = state === null ? undefined : hostOf(state)

      if (state === null || host === undefined) return []

      void refreshAutopilot(state, host)

      return drainNotices(state)
    },
  })
}

registerAutopilotSlots()

/** The `/ruflo autopilot stop|pause|resume|status` command's work, for the command surface to call. Never starts anything: Start is confirm-only. */
export async function autopilotCommand(state: State, host: ReturnType<typeof hostOf> & object, args: string): Promise<string> {
  const word = args.trim().toLowerCase()

  if (word === 'stop') return (await stopNow(state, host, 'stopped by command'), 'autopilot stopped; the KILL flag is set until the next confirmed start')
  if (word === 'pause') return (await pauseNow(state, host, 'paused by command'), 'autopilot paused')
  if (word === 'resume') return (await resumeNow(state, host), 'resume asked; the next tick re-checks every gate')

  const s = storeOf(state)

  return word === 'status' || word === '' ? (bandText(s.loop, Date.now(), s.spend?.totalUsd ?? null, s.sealed?.envelope ?? null) || 'autopilot is off') : 'usage: /ruflo autopilot stop | pause | resume | status (start is on the Workflows page and asks first)'
}
