import type { Host } from '../host'
import { LEAD, membersOf, type Member } from '../model/members'
import { parseRoute, plain } from '../reader/parse'
import { CLI_PREFIXES, type State } from '../state'
import type { PaneActions } from '../views/pane'
import { paneModelOf } from '../views/model'
import {
  agentLogs,
  argvOf,
  claimTask,
  handoffTask,
  markStealable,
  reroute,
  setClaimStatus,
  stealTask,
  stopAgent,
  vote,
  type ActionSpec,
} from './argv'

/** A CLI call from a button gets this long; the engine's own cap is ten minutes, and the pane does not hold a person that long. */
const RUN_MS = 60_000
/** A confirm prompt left unanswered this long is dropped, so a stale press never runs an old action. */
export const CONFIRM_MS = 30_000

export type Controller = {
  /** Re-reads the disk now and resolves once the snapshot is fresh. */
  refresh: () => Promise<void>
  persist: () => void
}

const lastLines = (text: string, count: number): string[] =>
  text
    .split('\n')
    .map(line => plain(line, 400))
    .filter(line => line !== '')
    .slice(-count)

/** Runs one action through the configured CLI and says what happened, checked against the disk where the disk can show it. */
export async function runAction(state: State, host: Host, control: Controller, spec: ActionSpec): Promise<void> {
  const nowMs = () => Date.now()

  state.isActing = true
  state.confirm = null
  host.invalidate()

  try {
    const result = await host.run(argvOf(CLI_PREFIXES[state.options.cli], spec), RUN_MS)
    const ok = result.exitCode === 0
    let verified: 'yes' | 'no' | 'n/a' = 'n/a'

    if (spec.args[0] === 'hooks' && spec.args[1] === 'route') {
      const pick = parseRoute(result.stdout, nowMs())

      if (pick !== null) {
        state.route = pick
        control.persist()
      }

      verified = pick !== null ? 'yes' : 'no'
    } else if (spec.args[0] === 'agent' && spec.args[1] === 'logs') {
      state.detail = { title: spec.label, lines: lastLines(ok ? result.stdout : result.stderr || result.stdout, 40) }
    }

    if (ok && spec.verify !== undefined) {
      await control.refresh()
      verified = state.snapshot !== null && spec.verify(state.snapshot) ? 'yes' : 'no'
    }

    const said = lastLines(ok ? result.stdout : result.stderr || result.stdout, 1)[0] ?? ''

    state.outcome = { label: spec.label, ok, verified, detail: ok ? (verified === 'no' ? `expected ${spec.expect}` : '') : `exit ${result.exitCode}${said !== '' ? `: ${said}` : ''}`, atMs: nowMs() }
  } catch (error) {
    // A refused `$.process.run` (removed by an administrator, or denied above this mod) is a sentence, not a crash.
    state.outcome = { label: spec.label, ok: false, verified: 'n/a', detail: plain(error instanceof Error ? error.message : String(error), 160), atMs: nowMs() }
  } finally {
    state.isActing = false
    host.invalidate()
  }
}

/** Asks first for a destructive action (a second press confirms), runs a safe one at once, and says so when there is nothing to act on. */
export function request(state: State, host: Host, control: Controller, spec: ActionSpec | null, why: string): void {
  if (state.isActing) {
    return
  }

  if (spec === null) {
    state.outcome = { label: why, ok: false, verified: 'n/a', detail: 'nothing to act on', atMs: Date.now() }
    host.invalidate()

    return
  }

  if (spec.isDestructive) {
    state.confirm = { label: spec.label, spec, askedAtMs: Date.now() }
    state.timers.get('confirm')?.cancel()
    state.timers.set(
      'confirm',
      host.after(CONFIRM_MS, () => {
        state.timers.delete('confirm')
        state.confirm = null
        host.invalidate()
      }),
    )
    host.invalidate()

    return
  }

  void runAction(state, host, control, spec)
}

/** The activity a Claude Code loop showed this session, as lines: there is no transcript API, so this is what the hooks saw. */
function activityLines(state: State, member: Member): string[] {
  const recent = state.activity.recent.get(member.id) ?? []
  const loop = state.activity.loops.get(member.id)

  return [
    ...(loop?.description !== undefined ? [`task: ${plain(loop.description, 200)}`] : []),
    ...(recent.length === 0 ? ['no tool calls seen yet'] : recent.map(call => `${call.isError ? '✗' : '·'} ${call.tool} ${call.subject}`)),
  ]
}

export function paneActionsOf(state: State, host: Host, control: Controller): PaneActions {
  const model = () => paneModelOf(state, state.pane.columns, state.pane.rows, Date.now())
  const members = () => membersOf(state.snapshot, state.activity, Date.now())

  const step = (by: number) => {
    const all = members()

    if (all.length === 0) {
      return
    }

    const at = Math.max(0, all.findIndex(member => member.id === state.selected))

    state.selected = all[(at + by + all.length) % all.length]?.id ?? null
    state.detail = null
    control.persist()
    host.invalidate()
  }

  const stepTask = (by: number) => {
    const rows = model().board.rows

    if (rows.length === 0) {
      return
    }

    const at = Math.max(0, rows.findIndex(row => row.id === state.selectedTask))

    state.selectedTask = rows[(at + by + rows.length) % rows.length]?.id ?? null
    control.persist()
    host.invalidate()
  }

  const selected = () => model().selected
  const task = () => model().board.selected
  const ruflo = (member: Member | null) => (member !== null && member.source === 'ruflo' ? member : null)
  const claimOf = (member: Member | null) => (member === null ? undefined : state.snapshot?.claims.find(claim => claim.claimant.id === member.id && claim.status !== 'completed'))
  const go = (spec: ActionSpec | null, why: string) => request(state, host, control, spec, why)

  return {
    hide: () => {
      state.pane.isOpen = false
      state.pane.isClosedByPerson = true
      control.persist()
      void host.closePane('ruflo-swarm').catch(() => undefined)
    },
    prev: () => step(-1),
    next: () => step(1),
    taskPrev: () => stepTask(-1),
    taskNext: () => stepTask(1),
    stop: () => {
      const member = ruflo(selected())

      go(member === null ? null : stopAgent(member.id), 'stop')
    },
    logs: () => {
      const member = selected()

      if (member === null) {
        return
      }

      if (member.source === 'ruflo') {
        go(agentLogs(member.id), 'logs')

        return
      }

      state.detail = { title: `activity of ${member.label}${member.id === LEAD ? '' : ` (${member.id})`}`, lines: activityLines(state, member) }
      host.invalidate()
    },
    pause: () => {
      const claim = claimOf(ruflo(selected()))

      go(claim === undefined ? null : setClaimStatus(claim.issueId, 'paused'), 'pause claim')
    },
    resume: () => {
      const claim = claimOf(ruflo(selected()))

      go(claim === undefined ? null : setClaimStatus(claim.issueId, 'active'), 'resume claim')
    },
    claim: () => {
      const member = ruflo(selected())
      const row = task()

      go(member === null || row === null ? null : claimTask(row.id, member.id, member.role), 'claim task')
    },
    offer: () => {
      const row = task()

      go(row === null ? null : markStealable(row.id), 'offer task')
    },
    steal: () => {
      const member = ruflo(selected())
      const row = task()

      go(member === null || row === null ? null : stealTask(row.id, member.id, member.role), 'steal task')
    },
    handoff: () => {
      const member = ruflo(selected())
      const row = task()
      const claim = row === null ? undefined : state.snapshot?.claims.find(entry => entry.issueId === row.id)
      const from = claim?.claimant.kind === 'agent' ? { id: claim.claimant.id, type: claim.claimant.agentType ?? 'agent' } : null

      go(member === null || row === null || from === null ? null : handoffTask(row.id, from, { id: member.id, type: member.role }), 'hand off')
    },
    reroute: () => {
      const row = task()

      go(row === null ? null : reroute(row.description || row.type), 're-route')
    },
    voteYes: () => {
      const proposal = model().proposals[0]
      const member = selected()

      go(proposal === undefined || member === null ? null : vote(proposal.id, member.id, true), 'vote')
    },
    voteNo: () => {
      const proposal = model().proposals[0]
      const member = selected()

      go(proposal === undefined || member === null ? null : vote(proposal.id, member.id, false), 'vote')
    },
    confirm: () => {
      const asked = state.confirm

      state.timers.get('confirm')?.cancel()
      state.timers.delete('confirm')

      if (asked === null || Date.now() - asked.askedAtMs > CONFIRM_MS) {
        state.confirm = null
        host.invalidate()

        return
      }

      void runAction(state, host, control, asked.spec)
    },
    cancel: () => {
      state.timers.get('confirm')?.cancel()
      state.timers.delete('confirm')
      state.confirm = null
      host.invalidate()
    },
    fill: () => {
      const next = model().next

      if (next === null) {
        return
      }

      void host
        .fillPrompt({ text: next.text })
        .then(result => {
          if (!result.isFilled) {
            host.toast({ level: 'info', text: `Next: ${next.text}`, timeoutMs: 8000, awayOnly: true })
          }
        })
        .catch(() => host.toast({ level: 'info', text: `Next: ${next.text}`, timeoutMs: 8000, awayOnly: true }))
    },
    closeDetail: () => {
      state.detail = null
      host.invalidate()
    },
  }
}
