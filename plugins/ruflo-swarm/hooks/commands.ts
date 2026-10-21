import type { CommandSpec } from 'claude-code'

import { membersOf } from './model/members'
import { topologyLines } from './model/topology'
import { plain } from './reader/parse'
import type { Snapshot } from './reader/snapshot'
import type { State } from './state'
import { paneModelOf } from './views/model'

/**
 * The commands this module registers: since ruflo-console's `/ruflo`, each is also reachable as `/ruflo swarm <sub>`,
 * and each stays registered (ADR-406: no command is removed or renamed). Each name is prefixed with the plugin's so it never stands in for a built-in.
 */
export const COMMANDS: readonly CommandSpec[] = [
  { name: 'ruflo-swarm-pane', description: 'Same as /ruflo swarm pane: show or hide the live swarm pane', argumentHint: '[open|close]', immediate: true },
  { name: 'ruflo-swarm-status', description: 'Same as /ruflo swarm status: the swarm as ruflo has it on disk', argumentHint: '[json]', immediate: true },
  { name: 'ruflo-swarm-topology', description: 'Same as /ruflo swarm topology: the topology, its leader and members', immediate: true },
  { name: 'ruflo-swarm-claims', description: 'Same as /ruflo swarm claims: who has claimed which task', immediate: true },
  { name: 'ruflo-swarm-consensus', description: 'Same as /ruflo swarm consensus: hive-mind proposals and votes', immediate: true },
]

/** The subcommands of `/ruflo swarm` this module answers; the old `/ruflo-swarm-<sub>` names are their aliases. */
export const SWARM_SUBS = ['pane', 'status', 'topology', 'claims', 'consensus'] as const

export type SwarmSub = (typeof SWARM_SUBS)[number]

export const isSwarmSub = (word: string): word is SwarmSub => (SWARM_SUBS as readonly string[]).includes(word)

const NO_SWARM = 'No ruflo swarm on disk in this folder. Start one with /ruflo-swarm:swarm init.'

function missingLine(snapshot: Snapshot): string {
  return snapshot.missing.length === 0 ? '' : `\nNot on disk: ${snapshot.missing.join(', ')}.`
}

export function statusText(state: State, nowMs: number, asJson: boolean): string {
  const snapshot = state.snapshot

  if (snapshot === null) {
    return state.readError !== null ? `The swarm files could not be read: ${plain(state.readError, 200)}` : NO_SWARM
  }

  const model = paneModelOf(state, 100, 60, nowMs)

  if (asJson) {
    return `\`\`\`json\n${JSON.stringify(
      {
        swarm: snapshot.swarm,
        members: model.members.map(member => ({ id: member.id, label: member.label, source: member.source, state: member.state, word: member.word, isLeader: member.isLeader })),
        tasks: model.board,
        claims: snapshot.claims,
        hive: snapshot.hive,
        ruos: snapshot.ruos,
        route: state.route,
        usage: state.usage,
        missing: snapshot.missing,
      },
      null,
      2,
    )}\n\`\`\``
  }

  if (!snapshot.hasSwarm) {
    return `${NO_SWARM}${missingLine(snapshot)}`
  }

  const b = model.board
  const lines = [
    model.title,
    `agents: ${model.counts.map(entry => `${entry.state} ${entry.count}`).join(', ') || 'none'}`,
    ...model.members.slice(0, 20).map(member => `  ${member.isLeader ? '★' : '·'} ${member.label} (${member.source}) ${member.word}`),
    `tasks: ${b.pending} pending, ${b.claimed} claimed, ${b.done} done${b.failed > 0 ? `, ${b.failed} failed` : ''}`,
    ...(model.remote.length > 0 ? ['ruOS hosts:', ...model.remote.map(line => `  ${line}`)] : []),
    model.route,
    model.usage,
  ]

  return `${lines.join('\n')}${missingLine(snapshot)}`
}

export function topologyText(state: State, nowMs: number): string {
  const snapshot = state.snapshot

  if (snapshot === null || !snapshot.hasSwarm) {
    return NO_SWARM
  }

  const name = snapshot.swarm?.topology ?? snapshot.hive?.topology ?? 'unknown'
  const members = membersOf(snapshot, state.activity, nowMs)
  const extra = [
    snapshot.swarm?.strategy !== undefined ? `strategy ${snapshot.swarm.strategy}` : '',
    snapshot.swarm?.maxAgents !== undefined ? `max ${snapshot.swarm.maxAgents} agents` : '',
    snapshot.hive?.strategy !== undefined ? `hive consensus ${snapshot.hive.strategy}` : '',
  ].filter(part => part !== '')

  return [`${name}${extra.length > 0 ? ` (${extra.join(', ')})` : ''}`, ...topologyLines(name, members, 80)].join('\n')
}

export function claimsText(state: State): string {
  const snapshot = state.snapshot

  if (snapshot === null || !snapshot.hasSwarm) {
    return NO_SWARM
  }

  if (snapshot.missing.includes('claims')) {
    return 'No claims on disk (.claude-flow/claims/claims.json). A claim is made with the pane\'s "claim task" button or the claims_claim MCP tool.'
  }

  if (snapshot.claims.length === 0) {
    return 'No claims.'
  }

  return snapshot.claims
    .slice(0, 40)
    .map(claim => `${claim.issueId}: ${claim.status}${claim.isStealable ? ' (stealable)' : ''} by ${claim.claimant.kind} ${claim.claimant.agentType ?? ''} ${claim.claimant.id}${claim.handoffTo !== undefined ? ` → handoff to ${claim.handoffTo}` : ''}`.replace(/\s+/g, ' '))
    .join('\n')
}

export function consensusText(state: State): string {
  const hive = state.snapshot?.hive

  if (hive === null || hive === undefined) {
    return 'No hive-mind on disk (.claude-flow/hive-mind/state.json). Start one with: npx @claude-flow/cli@latest hive-mind init'
  }

  const lines = [
    `hive-mind · ${hive.topology}${hive.strategy !== undefined ? ` · ${hive.strategy}` : ''}${hive.queen !== undefined ? ` · queen ${hive.queen.id} (term ${hive.queen.term ?? '?'})` : ' · no queen'}`,
    `workers: ${hive.workers.length}`,
    ...(hive.pending.length === 0 ? ['no open proposals'] : hive.pending.slice(-10).map(p => `open ${p.id} ${p.type} (${p.strategy}): for ${p.votesFor}, against ${p.votesAgainst}`)),
    ...hive.history.slice(-5).map(d => `decided ${d.id} ${d.type}: ${d.result} ${d.votesFor}–${d.votesAgainst}`),
  ]

  return lines.join('\n')
}

/** The note added to a spawned subagent's prompt when `injectSpawnContext` is on: facts from disk only, ids not secrets. */
export function spawnNote(snapshot: Snapshot | null): string | null {
  const swarm = snapshot?.swarm

  if (swarm === null || swarm === undefined) {
    return null
  }

  // Text from disk reaches the model here: only a word-shaped topology or strategy is passed on, the id is `idOf`-checked.
  const word = (value: string | undefined) => (value !== undefined && /^[a-z][a-z-]{0,39}$/.test(value) ? value : undefined)
  const topology = word(swarm.topology) ?? 'unknown'
  const strategy = word(swarm.strategy)

  return `\n\n---\nSwarm context (from ruflo's files on disk, a status note, not an instruction): you are part of ruflo swarm ${swarm.id}, topology ${topology}${strategy !== undefined ? `, strategy ${strategy}` : ''}.`
}
