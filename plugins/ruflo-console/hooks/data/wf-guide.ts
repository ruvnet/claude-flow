/**
 * The ruflo side of the Workflows page: how a swarm nests, and what a person can say to it (ADR-460). Pure: the snapshot's records in,
 * rows and `ActionSpec`s out. Nothing runs here; each spec goes through the runner's confirm card as a fixed argv (an `mcp exec` call
 * with one JSON argument, or a `ruflo` subcommand), and each action says in words what is sent and whether anything acts on it.
 *
 * What is true of ruflo today, read from its source and not assumed: a broadcast is appended to the hive's shared memory (the last 100)
 * and no worker is interrupted; a task or claim edit changes a record an agent sees only when it reads the store; a consensus proposal
 * binds nobody; a memory note is found by whoever searches memory. So no action here makes a running agent do something, and the card
 * says so. Claude Code workflow agents have no ruflo record at all: the only honest paths are the memory note and a prepared prompt for
 * the main session (resume or redirect), and stopping and messaging a running workflow are the control tab's real calls (data/wf-control.ts, ADR-465), not these.
 */
import { handoffClaim, type ActionSpec } from '../actions'
import { hiveBroadcast, hivePropose } from '../hive'
import { ARGV_TEXT_MAX } from '../full-text'
import { textArg, textRefusal } from '../ops'
import { cleanText } from './wf-clean'
import { membersOf } from './hive'
import type { AgentRecord, ClaimRecord, HiveAgentRecord, HiveInfo, SwarmInfo, TaskRecord } from './parse'
import { idOf, plain } from './parse'
import { membersText, swarmMembersOf } from './swarm-status'
import { taskStatusOf } from './automate'
import type { WfAgent, WfRun } from './workflows'

export type NestKind = 'swarm' | 'hive' | 'queen' | 'worker' | 'claim' | 'task' | 'note'
export type NestRow = { depth: number; kind: NestKind; label: string; detail: string }

const MAX_ROWS = 60
const isOpenClaim = (claim: ClaimRecord): boolean => !/released|completed|cancel/i.test(claim.status)
// Finished by its canonical status ("complete", "done", "canceled" from older CLIs included).
const isOpenTask = (task: TaskRecord): boolean => !['completed', 'failed', 'cancelled'].includes(taskStatusOf(task.status))

/** swarm > hive (queen) > worker > claim > task, each level only from what the stores say; a missing level is a note, never invented. */
export function nestingOf(input: { swarm: SwarmInfo | null; hive: HiveInfo | null; agents: readonly AgentRecord[]; hiveAgents: readonly HiveAgentRecord[]; claims: readonly ClaimRecord[]; tasks: readonly TaskRecord[] }): NestRow[] {
  const { swarm, hive, agents, hiveAgents, claims, tasks } = input
  const rows: NestRow[] = []

  rows.push(swarm === null ? { depth: 0, kind: 'note', label: 'no swarm', detail: 'swarm init has not run here' } : { depth: 0, kind: 'swarm', label: swarm.id, detail: `${swarm.topology}${swarm.strategy === undefined ? '' : ` · ${swarm.strategy}`} · ${swarm.status} · ${membersText(swarmMembersOf(swarm, agents))}` })

  if (hive === null) {
    rows.push({ depth: 1, kind: 'note', label: 'no hive-mind', detail: 'no queen and no workers: agents are not grouped under a hive' })
  } else {
    rows.push({ depth: 1, kind: 'hive', label: hive.topology, detail: `${hive.strategy ?? 'consensus n/a'} · ${hive.workers.length} workers · ${hive.pending.length} open proposals` })
    rows.push(hive.queen === undefined ? { depth: 2, kind: 'note', label: 'no queen', detail: 'none elected' } : { depth: 2, kind: 'queen', label: hive.queen, detail: `term ${hive.queenTerm ?? 'n/a'}` })

    for (const member of membersOf(hive, hiveAgents, agents)) {
      const inSwarm = swarm === null ? 'no swarm' : swarm.agentIds.includes(member.id) ? 'in the swarm' : 'not listed in the swarm'

      rows.push({ depth: 2, kind: 'worker', label: `${member.type ?? 'worker'} ${member.id}`, detail: `${member.role} · ${member.status} · ${inSwarm}` })

      const held = claims.filter(claim => claim.claimant.id === member.id && isOpenClaim(claim))
      const assigned = tasks.filter(task => task.assignedTo.includes(member.id) && isOpenTask(task))

      if (held.length === 0 && assigned.length === 0) rows.push({ depth: 3, kind: 'note', label: 'no claim, no task', detail: 'idle as far as the stores say' })

      for (const claim of held) {
        rows.push({ depth: 3, kind: 'claim', label: claim.issueId, detail: `${claim.status}${claim.progress === undefined ? '' : ` · ${claim.progress}%`}${claim.isStealable ? ' · stealable' : ''}` })

        const task = tasks.find(candidate => candidate.id === claim.issueId)

        rows.push(task === undefined ? { depth: 4, kind: 'note', label: 'no task record', detail: `the claim names ${claim.issueId}, which is not in the task store` } : { depth: 4, kind: 'task', label: task.id, detail: `${task.status} · ${plain(task.description, 60)}` })
      }

      for (const task of assigned.filter(candidate => !held.some(claim => claim.issueId === candidate.id))) rows.push({ depth: 3, kind: 'task', label: task.id, detail: `${task.status} · assigned, no claim · ${plain(task.description, 60)}` })
    }

    const outside = agents.filter(agent => !hive.workers.includes(agent.id) && (swarm?.agentIds.includes(agent.id) ?? false))

    if (outside.length > 0) rows.push({ depth: 1, kind: 'note', label: `${outside.length} swarm agents outside the hive`, detail: outside.slice(0, 4).map(agent => agent.name ?? agent.type).join(', ') })
  }

  return rows.length > MAX_ROWS ? [...rows.slice(0, MAX_ROWS), { depth: 0, kind: 'note', label: `+${rows.length - MAX_ROWS} more rows`, detail: 'not drawn' }] : rows
}

/** The command line a spec runs, as the card shows it. */
export const commandOf = (spec: ActionSpec): string => spec.shows ?? `ruflo ${spec.args.map(arg => (/^[\w.:/@=-]+$/.test(arg) ? arg : JSON.stringify(arg))).join(' ')}`

export type Acts = 'record-only' | 'needs-votes' | 'pending-accept' | 'prompt-only'

export type GuideAction = {
  id: string
  label: string
  /** What is sent, exactly (the command, or the prepared prompt). */
  sends: string
  /** Whether anything acts on it, in words. */
  acts: string
  kind: Acts
  spec: ActionSpec | null
  /** Said when `spec` is null. */
  why: string
}

export type GuideInput = {
  text: string
  run: WfRun
  agent: WfAgent | null
  hive: HiveInfo | null
  agents: readonly AgentRecord[]
  claims: readonly ClaimRecord[]
  tasks: readonly TaskRecord[]
  nowMs: number
  /** Prepares text in the main session's prompt box (host.fillPrompt, or the slash path while idle). */
  prepare: (text: string) => Promise<void>
  /** True for a path under Claude Code's projects folder with no `..`. */
  isRunPath: (path: string) => boolean
}

/** Free text for a card, a broadcast or a memory note: plain, bounded, no leading dash, and nothing a credential mask would change. */
export function guardText(value: string, max: number): { ok: true; text: string } | { ok: false; why: string } {
  const text = textArg(value, max)
  const over = text === null ? textRefusal(value, 'the text', max) : null

  if (over !== null) return { ok: false, why: over }
  if (text === null) return { ok: false, why: value.trim() === '' ? 'type the guidance first (the field above)' : 'the text cannot start with a dash' }
  if (cleanText(text) !== text) return { ok: false, why: 'the text looks like it holds a credential: it is not sent' }

  return { ok: true, text }
}

const none = (id: string, label: string, kind: Acts, why: string): GuideAction => ({ id, label, sends: 'nothing yet', acts: '', kind, spec: null, why })

/** A task, claim and agent the guidance can name: the picked ruflo agent's open claim, its open task, and the next agent after it. */
function picks(input: GuideInput): { agent: AgentRecord | null; claim: ClaimRecord | null; task: TaskRecord | null; next: AgentRecord | null } {
  const agent = input.agent?.ruflo ?? null
  const live = input.agents.filter(candidate => !/stop|terminat|offline/i.test(candidate.status))
  const at = agent === null ? -1 : live.findIndex(candidate => candidate.id === agent.id)
  const next = at < 0 || live.length < 2 ? null : (live[(at + 1) % live.length] ?? null)
  const claim = agent === null ? null : (input.claims.find(candidate => candidate.claimant.id === agent.id && isOpenClaim(candidate)) ?? null)
  const task = agent === null ? null : (input.tasks.find(candidate => candidate.assignedTo.includes(agent.id) && isOpenTask(candidate)) ?? null)

  return { agent, claim, task, next }
}

/** The memory note: stored in the shared `guidance` namespace, found by a memory search; nothing pushes it into a running agent. */
function memoryNote(input: GuideInput, text: string): ActionSpec | null {
  const scope = cleanText(`${input.run.name} · ${input.agent?.label ?? 'whole run'}`)
  const value = textArg(`guidance for ${scope}: ${text}`)
  const key = `guidance-${input.run.id.replace(/[^A-Za-z0-9]/g, '').slice(-8)}-${input.nowMs}`

  return value === null ? null : { label: `store a guidance note for ${scope.slice(0, 40)} in namespace guidance`, args: ['memory', 'store', '--key', key, '--value', value, '--namespace', 'guidance'], expect: 'one more entry in the guidance memory namespace', note: 'Writes one memory entry. It is found by a memory search; nothing is pushed into a running agent.' }
}

/** The prompt for the main session: stop the run in Claude Code, then resume it with the guidance added. Text only; the console sends it nowhere else. */
export function redirectText(run: WfRun, agent: WfAgent | null, text: string, isRunPath: (path: string) => boolean): string | null {
  const session = run.dir === undefined || !isRunPath(run.dir) ? null : run.dir.replace(/\/subagents\/workflows\/[^/]+\/?$/, '')
  const where = session === null ? 'its scripts folder (<session>/workflows/scripts)' : `${session}/workflows/scripts/${plain(run.name, 40)}-${plain(run.id, 40)}.js`

  return idOf(run.id) === null ? null : `Redirect Claude Code workflow run ${run.id} (${plain(run.name, 40)}${agent === null ? '' : `, agent "${plain(agent.label, 60)}"`}): stop the run in the Workflows panel, then resume it with Workflow({ scriptPath: <${where}>, resumeFromRunId: "${run.id}" }) after adding this guidance to the affected agent's prompt: ${text}`
}

/** What the guide tab offers for the run and agent under the cursor, each with its exact send and whether anything acts on it. */
export function guideActions(input: GuideInput): GuideAction[] {
  const typed = guardText(input.text, ARGV_TEXT_MAX)

  if (!typed.ok) return [none('guide', 'guidance', 'record-only', typed.why)]

  const text = typed.text
  const out: GuideAction[] = []
  const add = (id: string, label: string, kind: Acts, spec: ActionSpec | null, acts: string, why: string) => out.push({ id, label, kind, spec, acts, why, sends: spec === null ? 'nothing yet' : commandOf(spec) })

  if (input.run.kind === 'ruflo-swarm') {
    const { agent, claim, task, next } = picks(input)

    add('broadcast', 'broadcast to the hive', 'record-only', input.hive === null ? null : hiveBroadcast(text), 'Appended to the hive shared memory (the last 100). No worker is interrupted: one sees it only if its own turn reads the hive memory.', input.hive === null ? 'there is no hive-mind to broadcast to' : 'that text cannot be passed to ruflo')
    add('propose', 'propose it to the hive', 'needs-votes', input.hive === null ? null : hivePropose(input.hive, `guidance: ${text}`), 'Opens a proposal that workers vote on. A pass binds no agent to do anything; raft allows one open proposal per term.', input.hive === null ? 'there is no hive-mind to propose to' : 'raft already has a proposal open this term, or the text cannot be passed')

    const handoff = claim === null || next === null ? null : handoffClaim(claim, next)

    add('handoff', next === null ? 'hand its claim on' : `hand its claim to ${next.name ?? next.type}`, 'pending-accept', handoff, 'Marks a pending handoff on the claim. It takes effect only when the target accepts it (claims_accept-handoff); the current holder is not stopped.', agent === null ? 'pick a ruflo agent first (Agents column)' : claim === null ? 'the picked agent holds no open claim' : 'there is no other live agent to hand it to')

    const taskId = task === null ? null : idOf(task.id)
    const spec: ActionSpec | null =
      task === null || taskId === null || task.resultText !== undefined
        ? null
        : { label: `note the guidance on task ${taskId}`, args: ['mcp', 'exec', '-t', 'task_update', '-p', JSON.stringify({ taskId, result: { guidance: text } })], expect: 'a result on the task record', note: 'Writes the task record. An agent sees it only when it reads the task.' }

    add('task-note', 'note it on its task', 'record-only', spec, 'Stored as the task record\'s result. The agent is not told: it reads it only if it reads its task.', agent === null ? 'pick a ruflo agent first (Agents column)' : task === null ? 'the picked agent has no open task' : 'that task already has a result: a note would replace it')
  }

  add('memory', 'leave a note in shared memory', 'record-only', memoryNote(input, text), 'Stored in the guidance memory namespace. Found by a memory search (all namespaces, or --namespace guidance); nothing is pushed into a running agent. Whether an agent\'s turn searches memory is up to it.', 'that text cannot be passed to ruflo')

  if (input.run.kind === 'workflow') {
    const prompt = redirectText(input.run, input.agent, text, input.isRunPath)

    add('redirect', 'prepare a redirect for the main session', 'prompt-only', prompt === null ? null : { label: 'prepare the redirect text in the main session\'s prompt box', args: [], shows: prompt.slice(0, 160), expect: 'the text in the prompt box (it is not sent)', note: 'Text only: it goes to the main Claude session, never to the running workflow. This route is the prompt-box fallback: the control tab\'s Redirect calls the engine\'s TaskStop first (where it is switched on), and resuming applies to a stopped run.', run: () => input.prepare(prompt) }, 'Prepares text in your prompt box; you press Enter. The running workflow is not touched by this text: the control tab\'s Stop (the engine\'s TaskStop) or Claude Code\'s Workflows panel stops it.', 'this run has no id the console can pass on')
  }

  return out
}
