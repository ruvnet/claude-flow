/**
 * What the Hive-Mind view asks ruflo to do, each a fixed argv. A vote goes through the `hive-mind consensus` subcommand
 * because only it carries the hive's capability token (it reads the token off disk itself; the console never does), and
 * the tool counts a vote only from a registered worker, so a vote is cast as one. Propose, broadcast and spawn need no
 * token and run as `mcp exec` with one JSON argument. Ids pass `idOf`; free text passes `textArg`.
 */
import { exec, type ActionSpec } from './actions'
import { HIVE_ROLES, nextVoter, proposalStrategyOf, proposeBlock } from './data/hive'
import { idOf, type HiveInfo, type Proposal } from './data/parse'
import { textArg } from './ops'

/** Who the console names as proposer and sender: the tool records it, and checks it only as an identifier. */
export const OPERATOR = 'console-operator'

const TYPE = /^([A-Za-z0-9_.-]{1,40}):\s*(.+)$/

/** `design: use raft` proposes a `design`; text with no such prefix is a `general` proposal. */
export function proposalText(text: string): { type: string; value: string } {
  const match = TYPE.exec(text.trim())

  return match === null ? { type: 'general', value: text.trim() } : { type: match[1] as string, value: (match[2] as string).trim() }
}

/** A vote on `proposal` as the next worker that has not voted on it; null when no worker is left to vote as. */
export function hiveVote(hive: HiveInfo, proposal: Proposal, isFor: boolean): ActionSpec | null {
  const id = idOf(proposal.id)
  const voter = nextVoter(hive, proposal)

  if (id === null || voter === null || idOf(voter) === null) return null

  return {
    label: `vote ${isFor ? 'for' : 'against'} ${proposal.type} (${id}) as worker ${voter}`,
    // JSON out: the subcommand exits 0 on a refused vote, and only its JSON carries the tool's "error" for the runner.
    args: ['hive-mind', 'consensus', '--action', 'vote', '--proposal-id', id, '--vote', isFor ? 'yes' : 'no', '--voter-id', voter, '--format', 'json'],
    expect: `${voter}'s ballot on the proposal, or the proposal decided`,
    verify: snapshot => snapshot.hive?.history.some(entry => entry.id === id) === true || snapshot.hive?.pending.some(entry => entry.id === id && entry.ballots.some(ballot => ballot.voter === voter)) === true,
  }
}

/** A new proposal under the hive's own strategy; null when the text cannot be passed or raft would refuse it. */
export function hivePropose(hive: HiveInfo, text: string): ActionSpec | null {
  const { type, value } = proposalText(text)
  const body = textArg(value)
  const strategy = proposalStrategyOf(hive.strategy)
  const known = new Set([...hive.pending, ...hive.history].map(entry => entry.id))

  if (body === null || proposeBlock(hive) !== null) return null

  return {
    label: `propose ${type}: "${body.slice(0, 40)}" (${strategy ?? 'raft, the tool default'})`,
    args: exec('hive-mind_consensus', { action: 'propose', type, value: body, voterId: OPERATOR, ...(strategy !== null && { strategy }) }),
    expect: 'a new pending proposal in .claude-flow/hive-mind/state.json',
    verify: snapshot => snapshot.hive?.pending.some(entry => !known.has(entry.id) && entry.type === type) === true,
  }
}

/** A message to every worker, kept in the hive's shared memory (the last 100). */
export function hiveBroadcast(text: string): ActionSpec | null {
  const message = textArg(text)

  return message === null
    ? null
    : {
        label: `broadcast "${message.slice(0, 40)}" to the hive`,
        args: exec('hive-mind_broadcast', { message, priority: 'normal', fromId: OPERATOR }),
        expect: 'the message in the shared memory broadcasts',
        verify: snapshot => snapshot.hive?.broadcasts.some(entry => entry.message === message) === true,
      }
}

/** One worker spawned and joined to the hive (agents.json and state.json both change). */
export function hiveSpawn(hive: HiveInfo, role: string): ActionSpec | null {
  const before = hive.workers.length

  return (HIVE_ROLES as readonly string[]).includes(role)
    ? {
        label: `spawn a hive ${role} and join it`,
        args: exec('hive-mind_spawn', { role, agentType: 'worker', prefix: 'hive-worker' }),
        expect: 'one more worker in the hive',
        verify: snapshot => (snapshot.hive?.workers.length ?? 0) > before,
      }
    : null
}
