/**
 * What the claims buttons ask ruflo to do, as fixed argv for `ruflo mcp exec -t claims_* -p <json>`: ids pass `idOf`,
 * the claimant strings are built here from parsed records, and the one JSON argument is `JSON.stringify`'s (an argv
 * element, never a shell string). Each spec says how the disk shows that it took, checked after the CLI exits.
 */
import { idOf, type AgentRecord, type ClaimRecord, type Claimant, type TaskRecord } from './data/parse'
import type { Snapshot } from './data/snapshot'
import type { Findings } from './data/failure'
import type { Host } from './host'

export type ActionSpec = {
  label: string
  args: readonly string[]
  /** A fixed command outside ruflo, or an offline read, with optional JSON on stdin. */
  argv?: readonly string[]
  stdin?: string
  expect: string
  verify?: (snapshot: Snapshot) => boolean
  /** A local check after a confirmed action succeeds; never part of background refreshes. */
  verifyLocal?: (host: Pick<Host, 'fs' | 'home'>) => Promise<boolean>
  /** Reads only: runs at once, without the confirm step, and shows what the CLI printed. */
  isReadOnly?: boolean
  /**
   * Not a ruflo CLI call: what runs instead once confirmed (a terminal harness), reporting for itself. A run that answers a RunReport also has
   * the runner keep it as the console's outcome, so what console_state shows Claude (and `/ruflo yes` prints) is how the run ended.
   */
  run?: () => Promise<void | RunReport>
  /** Where the ask came from in its view (`goal`, `controls`, `guide`): a view that draws its own confirm puts it under that field. */
  scope?: string
  /** The command line the confirm row shows when it is not `ruflo <args>`. */
  shows?: string
  /** Raised on Claude's behalf: set by a deferred ask (one that resolves after its screen) from the origin it had when called, so it is never attributed to the person (ADR-450 T14, #3815). */
  byModel?: boolean
  /** Which of Claude's console_run / console_set calls started this ask (model-tools.ts hands out the numbers): the call that settles it is that one and no other (#3983). */
  byCall?: number
  /** The class the entry itself declares (a Dev Tools entry's `cost`): Claude's confirm gate never reads it as less than this. */
  declared?: 'write' | 'network' | 'install' | 'spend' | 'delete'
  /** A MetaHarness lab entry's id: the runner keeps what it printed for the lab's result panel. */
  lab?: string
  /** What a run costs or writes, in words: the confirm row and the result panel show it. */
  note?: string
  /** How long the CLI may take; 90 s when unset. */
  timeoutMs?: number
  /** The x.ruv.io board's result panel instead of the MetaHarness lab's, for a spec with a `lab` id. */
  board?: 'xruv'
  /** What the result panel shows of the output, when not the lab's reading of it. */
  lines?: (stdout: string, stderr: string) => string[]
  /** Called with what the CLI printed when the run succeeded: a board read fills its section from it. */
  onOutput?: (stdout: string) => void
  /** A lab entry that reads its own output: it may keep what it parsed, and answers the result panel's lines (masked where it must be). */
  read?: (stdout: string, stderr: string, ok: boolean) => string[]
  /**
   * A verdict command's convention, checked against the CLI's source: the exits it uses for "it found something" and the
   * shape of its JSON answer. Such an exit WITH an answer of that shape is an answer, not a failure; without one (no JSON,
   * `{}`, a banner) it stays a failure. A run with such an answer is judged by the answer's top-level keys only.
   */
  findings?: Findings
}

/** How a run that reports for itself ended, in the shape of the console's outcome. */
export type RunReport = { label: string; ok: boolean; detail: string; lines?: string[] }

export const exec = (tool: string, params: Record<string, string>) => ['mcp', 'exec', '-t', tool, '-p', JSON.stringify(params)] as const
const SAFE_WORD = /^[A-Za-z0-9_.-]{1,40}$/

/** `agent:<id>:<type>` or `human:<id>:<name>`, the forms ruflo's claims tools parse; null when a part would not survive it. */
export function claimantOf(who: Claimant): string | null {
  const id = idOf(who.id)
  const tail = who.kind === 'agent' ? who.agentType : who.name

  return id === null || id.includes(':') || tail === undefined || !SAFE_WORD.test(tail) ? null : `${who.kind}:${id}:${tail}`
}

export const agentClaimant = (agent: AgentRecord): string | null => claimantOf({ kind: 'agent', id: agent.id, agentType: agent.type })

export function claimTask(task: TaskRecord, agent: AgentRecord): ActionSpec | null {
  const issueId = idOf(task.id)
  const who = agentClaimant(agent)

  return issueId === null || who === null
    ? null
    : {
        label: `claim ${issueId} for ${agent.name ?? agent.type}`,
        args: exec('claims_claim', { issueId, claimant: who }),
        expect: 'the claim in .claude-flow/claims/claims.json',
        verify: snapshot => snapshot.claims.some(claim => claim.issueId === issueId && claim.claimant.id === agent.id),
      }
}

export function releaseClaim(claim: ClaimRecord): ActionSpec | null {
  const issueId = idOf(claim.issueId)
  const who = claimantOf(claim.claimant)

  return issueId === null || who === null
    ? null
    : {
        label: `release ${issueId} held by ${claim.claimant.agentType ?? claim.claimant.name ?? claim.claimant.id}`,
        args: exec('claims_release', { issueId, claimant: who, reason: 'released from ruflo-console' }),
        expect: 'the claim gone from claims.json',
        verify: snapshot => !snapshot.claims.some(entry => entry.issueId === issueId),
      }
}

export function handoffClaim(claim: ClaimRecord, to: AgentRecord): ActionSpec | null {
  const issueId = idOf(claim.issueId)
  const from = claimantOf(claim.claimant)
  const target = agentClaimant(to)

  return issueId === null || from === null || target === null || claim.claimant.id === to.id
    ? null
    : {
        label: `hand ${issueId} to ${to.name ?? to.type}`,
        args: exec('claims_handoff', { issueId, from, to: target, reason: 'handed off from ruflo-console' }),
        expect: 'a pending handoff on the claim',
        verify: snapshot => snapshot.claims.some(entry => entry.issueId === issueId && (entry.handoffTo === to.id || entry.claimant.id === to.id)),
      }
}

export function stealClaim(claim: ClaimRecord, by: AgentRecord): ActionSpec | null {
  const issueId = idOf(claim.issueId)
  const stealer = agentClaimant(by)

  return issueId === null || stealer === null || !claim.isStealable || claim.claimant.id === by.id
    ? null
    : {
        label: `steal ${issueId} for ${by.name ?? by.type}`,
        args: exec('claims_steal', { issueId, stealer }),
        expect: 'the claim held by the picked agent',
        verify: snapshot => snapshot.claims.some(entry => entry.issueId === issueId && entry.claimant.id === by.id),
      }
}

/** Why a button has nothing to act on, in the words the footer shows. */
export function whyNot(action: 'claim' | 'release' | 'handoff' | 'steal', claim: ClaimRecord | null, agent: AgentRecord | null, task: TaskRecord | null): string {
  if (action === 'claim') return task === null ? 'no unclaimed task to claim' : agent === null ? 'no agent to claim it for' : 'that task id or agent cannot be passed to ruflo'
  if (claim === null) return 'no claim picked'
  if (action === 'release') return 'that claimant cannot be named to ruflo'
  if (agent === null) return 'no agent picked (a)'
  if (agent.id === claim.claimant.id) return 'the picked agent already holds it'

  return action === 'steal' && !claim.isStealable ? 'the claim is not marked stealable' : 'that claim cannot be passed to ruflo'
}
