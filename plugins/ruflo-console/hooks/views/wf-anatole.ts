/**
 * Project Anatole in the Workflows board (ADR-463): for the run under the cursor, what the protector reported per agent (verdicts,
 * blocks, the rules that fired and their mode now), and an inspector tab with the alerts behind one agent's line. The match between an
 * alert and an agent is made from the files alone (data/wf-anatole.ts) and every row says how it was matched: an alert the files cannot
 * place is "not attributed", never guessed. Registered through the slot seams (views/wf-slots.ts): `import './wf-anatole'` in
 * views/wf-register.ts, and `wireWfAnatole(state, host)` once where the other actions are wired. Read-only: nothing here writes.
 */
import type { RenderElement } from 'claude-code'

import { ALERT_SEVERITIES, ANATOLE_STALE_MS, type RuleMode } from '../data/anatole'
import { cleanText } from '../data/wf-clean'
import { LEVEL_WORDS, matchAlert, protectorFor, readSessionAlerts, type RunProtector, type SessionAlert, type Verdicts } from '../data/wf-anatole'
import type { WfRun } from '../data/workflows'
import { ANATOLE_RULES, UNAUTH } from '../anatole'
import type { Host } from '../host'
import type { State } from '../state'
import { ago, clip, text, THEME, type Ctx } from './common'
import { registerSlot, type SlotEnv } from './wf-slots'

type Store = { alerts: SessionAlert[]; bad: number; refused: string | null; readAtMs: number; isReading: boolean }

const stores = new WeakMap<State, Store>()
const hosts = new WeakMap<State, Host>()
let active: State | null = null

/** Rows of agents drawn; the rest are counted. */
export const SHOWN = 12

const storeOf = (state: State): Store => stores.get(state) ?? stores.set(state, { alerts: [], bad: 0, refused: null, readAtMs: 0, isReading: false }).get(state)!

/** The host the alert log is read through; set once with the other actions. */
export function wireWfAnatole(state: State, host: Host): void {
  hosts.set(state, host)
  active = state
}

/** Re-reads the alert log with its sessions. The reader skips an unchanged file, so this is cheap on every refresh of the open page. */
export async function refreshAlerts(state: State, host: Host, nowMs: number = Date.now()): Promise<void> {
  const store = storeOf(state)

  if (store.isReading) return

  store.isReading = true

  try {
    const read = await readSessionAlerts(host.fs, state.cache, state.cwd)

    Object.assign(store, read, { readAtMs: nowMs })
  } catch {
    store.refused = 'the read was refused'
  } finally {
    store.isReading = false
    host.invalidate()
  }
}

const FALLBACK: Record<string, RuleMode> = Object.fromEntries(ANATOLE_RULES.map(rule => [rule.id, rule.fallback]))

/** A rule's mode now: the person's override in rules.json, else the shipped default. */
export const modeFor = (state: State) => (rule: string): RuleMode | null => state.snapshot?.anatole?.overrides[rule]?.mode ?? FALLBACK[rule] ?? null

const ruleText = (verdicts: Verdicts): string => verdicts.rules.map(entry => `${entry.id}×${entry.count}${entry.mode === null ? '' : ` (${entry.mode})`}`).join(' ')

/** The mod's own header: its mode, its totals and how old the status is. */
function header(ctx: Ctx, nowMs: number): RenderElement[] {
  const facts = ctx.state.snapshot?.anatole
  const status = facts?.status

  if (facts === undefined || !facts.present) return [text(ctx, ' Project Anatole is not installed or has written nothing here: claude plugin install ruflo-protector@ruflo', { dimColor: true })]
  if (status === null || status === undefined) return [text(ctx, ' no readable status.json from the protector yet', { color: THEME.warn })]

  const stale = status.updatedMs !== null && nowMs - status.updatedMs > ANATOLE_STALE_MS

  return [
    text(ctx, ` mode ${status.mode ?? 'unknown'} · ${status.calls} calls · ${status.blocked} blocked in all · open ${ALERT_SEVERITIES.map(level => `${status.open[level]} ${level}`).join(' ')}${status.degraded === false ? '' : ` · degraded: ${cleanText(status.degraded)}`}${stale ? ' · status is from an ended session' : ''}`, { color: status.degraded === false ? undefined : THEME.warn }),
    text(ctx, ` ${UNAUTH}`, { dimColor: true }),
  ]
}

function agentLines(ctx: Ctx, run: WfRun, found: RunProtector): RenderElement[] {
  const agents = run.phases.flatMap(phase => phase.agents)
  const hit = agents.filter(agent => found.byAgent.has(agent.id))
  const lines: RenderElement[] = hit.slice(0, SHOWN).map(agent => {
    const verdicts = found.byAgent.get(agent.id)

    return text(ctx, ` ${clip(agent.label, 26).padEnd(26)} ${String(verdicts?.blocked ?? 0).padStart(2)} blocked ${String(verdicts?.notified ?? 0).padStart(2)} notified · ${verdicts === undefined ? '' : ruleText(verdicts)} · ${LEVEL_WORDS[verdicts?.level ?? 'window']}`, { color: (verdicts?.blocked ?? 0) > 0 ? THEME.warn : undefined })
  })

  if (hit.length > SHOWN) lines.push(text(ctx, ` +${hit.length - SHOWN} more agents with alerts not drawn`, { dimColor: true }))

  const quiet = agents.length - hit.length

  if (quiet > 0) lines.push(text(ctx, ` ${quiet} agent${quiet === 1 ? '' : 's'} with no alert matched to ${hit.length === 0 ? 'them' : 'them either'}`, { dimColor: true }))

  return lines
}

export function boardRows(env: SlotEnv): RenderElement[] {
  const { ctx, nowMs, run } = env
  const store = storeOf(ctx.state)
  const rows = header(ctx, nowMs)
  const facts = ctx.state.snapshot?.anatole

  if (facts === undefined || !facts.present) return rows
  if (hosts.get(ctx.state) === undefined) return [...rows, text(ctx, ' per-agent view: not wired into this console yet (wireWfAnatole)', { color: THEME.warn })]
  if (store.refused !== null) rows.push(text(ctx, ` the alert log was not read: ${store.refused}`, { color: THEME.warn }))
  if (run === null) return [...rows, text(ctx, ' no run under the cursor', { dimColor: true })]
  if (run.kind !== 'workflow') return [...rows, text(ctx, ' a ruflo swarm has no Claude Code session to match alerts to: not attributed', { dimColor: true })]

  const found = protectorFor(run, store.alerts, env.runs, modeFor(ctx.state), nowMs)

  rows.push(text(ctx, ` ${run.name}: session ${found.session === null ? 'unknown' : clip(found.session, 12)} · ${store.alerts.length} alert${store.alerts.length === 1 ? '' : 's'} in the log's last 200 lines${store.bad > 0 ? ` (${store.bad} unusable)` : ''} · read ${ago(store.readAtMs, nowMs)}`, { dimColor: true }))

  if (store.alerts.length === 0) return [...rows, text(ctx, ' the protector has logged no alert, so there is nothing to show per agent', { dimColor: true })]

  rows.push(...agentLines(ctx, run, found))

  if (found.unnamed.alerts.length > 0) rows.push(text(ctx, ` during this run, no agent named: ${found.unnamed.blocked} blocked ${found.unnamed.notified} notified · ${ruleText(found.unnamed)} (the mod does not say which agent)`, { color: found.unnamed.blocked > 0 ? THEME.warn : undefined }))
  if (found.notAttributed > 0) rows.push(text(ctx, ` ${found.notAttributed} alert${found.notAttributed === 1 ? '' : 's'} not attributed to any run read here (no session, another session, or a time outside every run)`, { dimColor: true }))

  return rows
}

/** The inspector tab: the alerts behind one agent's line, newest last, each with how it was matched. */
export function tabRows(env: SlotEnv): RenderElement[] {
  const { ctx, nowMs, agent, run } = env
  const store = storeOf(ctx.state)

  if (agent === null || run === null) return [text(ctx, ' no agent under the cursor', { dimColor: true })]
  if (run.kind !== 'workflow') return [text(ctx, ' a ruflo agent has no Claude Code session to match alerts to: not attributed', { dimColor: true })]

  const mine = store.alerts.flatMap(alert => {
    const match = matchAlert(alert, env.runs, nowMs)

    return match.runId === run.id && match.agentId === agent.id ? [{ alert, level: match.level }] : []
  })

  if (mine.length === 0) return [text(ctx, ` no protector alert is matched to ${clip(agent.label, 40)}: the mod's alerts do not name an agent, so only a moment when it was the one agent running can place one`, { dimColor: true }), text(ctx, ` ${UNAUTH}`, { dimColor: true })]

  return [
    ...mine.slice(-8).map(({ alert, level }) => text(ctx, ` ${alert.action === 'blocked' ? '✖ blocked ' : '! notified'} ${alert.rule} ${alert.severity.padEnd(8)} ${alert.state.padEnd(7)} ${clip(cleanText(alert.tool), 14).padEnd(14)} ${clip(cleanText(alert.summary), Math.max(20, ctx.columns - 72))} · ${LEVEL_WORDS[level]}`, { color: alert.action === 'blocked' ? THEME.warn : undefined })),
    ...(mine.length > 8 ? [text(ctx, ` ${mine.length - 8} earlier alerts not drawn`, { dimColor: true })] : []),
    text(ctx, ` ${UNAUTH}`, { dimColor: true }),
  ]
}

/** Registers this module's slots; the import below does it once, and a test that emptied the registry calls it again (a repeat is refused harmlessly). */
export function registerAnatoleSlots(): void {
  registerSlot({ kind: 'board', id: 'anatole', title: 'Project Anatole, per agent (reported by the mod)', order: 60, render: boardRows })
  registerSlot({ kind: 'tab', id: 'anatole', label: 'protector', when: env => env.run?.kind === 'workflow' && env.agent !== null, render: tabRows })
  registerSlot({
    kind: 'notice',
    id: 'anatole-read',
    between: (_prev, _next, nowMs) => {
      const state = active
      const host = state === null ? undefined : hosts.get(state)

      if (state !== null && host !== undefined) void refreshAlerts(state, host, nowMs)

      return []
    },
  })
}

registerAnatoleSlots()

/** For tests: forgets what was read and wired. */
export const resetAnatole = (state: State): void => {
  stores.delete(state)
  hosts.delete(state)
  if (active === state) active = null
}

/** For tests: what the store holds. */
export const alertsFor = (state: State): Readonly<Store> => storeOf(state)
