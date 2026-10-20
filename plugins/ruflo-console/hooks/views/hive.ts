/**
 * The Hive-Mind view: what `.claude-flow/hive-mind/state.json` records, drawn as a living comb. The hero honeycomb (the
 * queen crowned in the centre, her workers ringed around her by role, lit by liveness, Byzantine voters in red, scars
 * of past decisions), a voting chamber per open proposal (pick one with j/k), the strip with the fault-tolerance
 * shield, the term timeline and the pheromone ticker; then the same facts in words. Every action asks y/n first and
 * runs one fixed argv: vote (as the next worker that has not voted), propose, broadcast, spawn. With no hive yet, an
 * empty comb with a glowing egg holds the start buttons.
 */
import type { RenderElement } from 'claude-code'

import { Arrivals, faultTolerance, membersOf, nextVoter, nodesOf, pickedProposal, proposalStrategyOf, proposeBlock, requiredVotes, tallyOf, waveOf, type Liveness, type Member, type Tally } from '../data/hive'
import { shortId, type HiveInfo, type Proposal } from '../data/parse'
import { own } from '../data/safe'
import { hivePicture, type HiveCell, type HivePictureModel, type Role } from '../gfx/hive'
import { chambersPicture, MAX_CHAMBERS, type Chamber } from '../gfx/hive-chamber'
import { eggBottomPicture, eggTopPicture } from '../gfx/hive-egg'
import { stripPicture, type Mark, type StripModel } from '../gfx/hive-strip'
import type { Grid } from '../gfx/raster'
import type { State } from '../state'
import { ago, button, clip, col, confirmHere, kv, picture, row, rule, starts, text, THEME, type Ctx } from './common'

const ROLE_GLYPH: Record<string, string> = { worker: '●', specialist: '◆', scout: '▲' }
const LIVE_THEME = (liveness: Liveness): { color?: string; dimColor?: boolean } =>
  liveness === 'busy' ? { color: THEME.warn } : liveness === 'idle' ? { color: THEME.info } : liveness === 'error' ? { color: THEME.bad } : { dimColor: true }

const glyphOf = (member: Member): string => (member.isKnown ? (own(ROLE_GLYPH, member.role) ?? '●') : '○')
const roleOf = (member: Member): Role => (member.isKnown && (member.role === 'worker' || member.role === 'specialist' || member.role === 'scout') ? member.role : 'unknown')

/** The starts an empty hive offers: the palette ids `starts.ts` registers, each asking first with its exact argv. */
/** When the console first saw each broadcast: the ticker slides a new one in, once. */
const arrivals = new Arrivals()

/** The bar a proposal must clear, as the CLI's rule reads in words. */
function ruleOf(strategy: string, preset?: string): string {
  if (strategy === 'bft') return '2/3 + 1'
  if (strategy === 'quorum') return preset ?? 'majority'

  return 'majority'
}

/** The honeycomb's model for this frame: the queen, each worker's cell with its ballot on the picked proposal, the scars. */
export function hivePictureModelOf(state: State, nowMs: number): HivePictureModel | null {
  const snap = state.snapshot
  const hive = snap?.hive ?? null

  if (snap === null || hive === null) return null

  const picked = pickedProposal(hive, state.select.item)
  // Red walls for a voter any open proposal excluded as Byzantine, the same count the heading gives.
  const flagged = new Set(hive.pending.flatMap(proposal => proposal.byzantine))
  const members = membersOf(hive, snap.hiveAgents, snap.agents).map((member): HiveCell => {
    const ballot = picked?.ballots.find(entry => entry.voter === member.id)
    const wave = waveOf(state.events, member.id, nowMs)

    return {
      id: member.id,
      role: roleOf(member),
      glow: member.liveness,
      tag: shortId(member.id).slice(-4),
      ...(picked !== null && { vote: ballot === undefined ? ('pending' as const) : ballot.isFor ? ('for' as const) : ('against' as const) }),
      ...(flagged.has(member.id) && { isByzantine: true }),
      ...(wave !== null && { wave }),
    }
  })

  return {
    queen: { tag: hive.queenTerm === undefined ? '' : `T${hive.queenTerm}`, isKnown: hive.queen !== undefined },
    members,
    scars: hive.history
      .slice(-8)
      .reverse()
      .map(decision => ({ label: decision.type, isPassed: decision.result === 'approved' })),
  }
}

/** The open proposals the chambers show: at most MAX_CHAMBERS, the window sliding so the picked one is always in it. */
export function shownProposals(hive: HiveInfo, picked: Proposal | null): Proposal[] {
  const at = picked === null ? 0 : hive.pending.findIndex(entry => entry.id === picked.id)
  const from = Math.max(0, Math.min(hive.pending.length - MAX_CHAMBERS, at - MAX_CHAMBERS + 1))

  return hive.pending.slice(from, from + MAX_CHAMBERS)
}

export function chambersOf(state: State, hive: HiveInfo, nowMs: number): Chamber[] {
  const picked = pickedProposal(hive, state.select.item)

  return shownProposals(hive, picked).map(proposal => {
    const tally = tallyOf(hive, proposal, nowMs)

    return {
      label: proposal.type,
      note: noteOf(tally),
      votesFor: proposal.votesFor,
      votesAgainst: proposal.votesAgainst,
      required: tally.required,
      nodes: tally.nodes,
      ballots: proposal.ballots.map(ballot => {
        const wave = waveOf(state.events, ballot.voter, nowMs)

        return { tag: shortId(ballot.voter), isFor: ballot.isFor, ...(wave !== null && (wave.kind === 'for' || wave.kind === 'against') && { atMs: wave.atMs }) }
      }),
      byzantine: proposal.byzantine,
      isPicked: proposal.id === picked?.id,
    }
  })
}

/** The strip's model: the shield, the dated marks on the term timeline, and the broadcasts newest first. */
export function stripOf(hive: HiveInfo, nowMs: number): StripModel {
  const marks: Mark[] = [
    ...hive.history.flatMap(decision => (decision.decidedAtMs === undefined ? [] : [{ atMs: decision.decidedAtMs, kind: decision.result === 'approved' ? ('passed' as const) : ('failed' as const), label: decision.type, ...(decision.term !== undefined && { term: decision.term }) }])),
    ...hive.pending.flatMap(proposal => (proposal.proposedAtMs === undefined ? [] : [{ atMs: proposal.proposedAtMs, kind: 'opened' as const, label: proposal.type, ...(proposal.term !== undefined && { term: proposal.term }) }])),
  ].sort((a, b) => a.atMs - b.atMs)
  const seen = arrivals.arrivedAt(`${hive.createdAtMs ?? 0}:${hive.queen ?? ''}`, hive.broadcasts.map(entry => entry.id), nowMs)
  const times = [hive.createdAtMs, hive.queenElectedAtMs, hive.updatedAtMs, ...marks.map(mark => mark.atMs)].filter((ms): ms is number => ms !== undefined)
  // The axis runs from the hive's first date to its last write: read from the file, so it holds still between writes.
  const startMs = times.length === 0 ? 0 : Math.min(...times)

  return {
    shield: faultTolerance(hive.strategy, hive.workers.length),
    strategy: hive.strategy ?? 'n/a',
    startMs,
    endMs: times.length === 0 ? 1 : Math.max(startMs + 1, ...times),
    ...(hive.queenTerm !== undefined && { term: hive.queenTerm }),
    ...(hive.queenElectedAtMs !== undefined && { electedAtMs: hive.queenElectedAtMs }),
    marks,
    pheromones: hive.broadcasts
      .slice()
      .reverse()
      .map(entry => ({ id: entry.id, text: `${entry.priority === 'normal' ? '' : `[${entry.priority}] `}${entry.from}: ${entry.message}`, isLoud: entry.priority === 'high' || entry.priority === 'critical', arrivedAtMs: seen.get(entry.id) ?? Number.NEGATIVE_INFINITY })),
    keys: hive.memoryKeys.filter(key => key !== 'broadcasts'),
  }
}

/** Every Hive-Mind picture for one instant, by Raster key: the comb, chambers and strip, or the empty comb's egg. */
export function hivePictures(state: State, columns: number, nowMs: number, t: number): Map<string, Grid> {
  const pictures = new Map<string, Grid>()
  const hive = state.snapshot?.hive ?? null

  if (state.snapshot === null) return pictures

  if (hive === null) {
    pictures.set('hive-egg', eggTopPicture(Math.min(columns, 96)))
    pictures.set('hive-egg-base', eggBottomPicture(Math.min(columns, 96)))

    return pictures
  }

  const model = hivePictureModelOf(state, nowMs)

  if (model !== null) pictures.set('hive', hivePicture(model, columns, t))
  if (hive.pending.length > 0) pictures.set('hive-chambers', chambersPicture(chambersOf(state, hive, nowMs), columns, t))
  pictures.set('hive-strip', stripPicture(stripOf(hive, nowMs), columns, t))

  return pictures
}

/** A proposal's strategy, term and state of play in a few words. */
function noteOf(tally: Tally): string {
  const { proposal } = tally

  return [`${proposal.strategy}${proposal.term !== undefined ? ` T${proposal.term}` : ''}${proposal.quorumPreset !== undefined ? ` ${proposal.quorumPreset}` : ''}`, tally.isTimedOut ? 'timed out' : '', tally.isDeadlocked ? 'deadlocked' : '']
    .filter(Boolean)
    .join(' · ')
}

/** A ten-cell text bar of a proposal's votes over the hive's nodes, for the text form of the view. */
function bar(tally: Tally): string {
  const of = (votes: number) => Math.round((Math.min(votes, tally.nodes) / tally.nodes) * 10)
  const yes = of(tally.proposal.votesFor)
  const no = Math.min(10 - yes, of(tally.proposal.votesAgainst))

  return `${'█'.repeat(yes)}${'▓'.repeat(no)}${'░'.repeat(10 - yes - no)}`
}

function summary(ctx: Ctx, hive: HiveInfo, members: Member[]): RenderElement[] {
  const workers = hive.workers.length
  const strategy = proposalStrategyOf(hive.strategy)
  const tolerance = faultTolerance(hive.strategy, workers)
  const required = requiredVotes(strategy ?? 'raft', nodesOf(hive))
  const isRaft = strategy === 'raft'
  const counts = (liveness: Liveness) => members.filter(member => member.liveness === liveness).length
  const keys = hive.memoryKeys.filter(key => key !== 'broadcasts').length

  return [
    kv(
      ctx,
      isRaft ? 'queen (leader)' : 'queen',
      hive.queen === undefined ? 'n/a — no queen recorded' : `${hive.queen}${hive.queenTerm !== undefined ? ` · term ${hive.queenTerm}` : ''} · elected ${ago(hive.queenElectedAtMs, ctx.nowMs)}`,
      THEME.head,
    ),
    kv(ctx, 'consensus', `${hive.strategy ?? 'n/a'} · proposals vote ${strategy ?? `raft (the tool's default: ${hive.strategy ?? 'this strategy'} has no vote rule of its own)`}`),
    kv(ctx, 'fault tolerance', tolerance === null ? `n/a — ${workers === 0 ? 'no workers' : `no bound stated for ${hive.strategy ?? 'this strategy'}`}` : `tolerates ${tolerance.faulty} faulty of ${tolerance.of} (${tolerance.rule})`),
    kv(ctx, 'quorum', `${required} of ${nodesOf(hive)} votes to pass (${ruleOf(strategy ?? 'raft')})${workers === 0 ? ' · the CLI counts an empty hive as one node' : ''}`),
    kv(ctx, 'workers', workers === 0 ? 'none yet — spawn one below' : `${workers} · ${counts('busy')} busy · ${counts('idle')} idle · ${counts('down') + counts('error')} down · ${members.filter(member => !member.isKnown).length} in no agent store`),
    kv(ctx, 'shared memory', `${keys} key${keys === 1 ? '' : 's'} · ${hive.broadcasts.length} broadcast${hive.broadcasts.length === 1 ? '' : 's'} · updated ${ago(hive.updatedAtMs, ctx.nowMs)}`),
  ]
}

function workersSection(ctx: Ctx, hive: HiveInfo, members: Member[]): RenderElement[] {
  const picked = pickedProposal(hive, ctx.state.select.item)
  const rows: RenderElement[] = [rule(ctx, 'Workers', `${members.length} · role · liveness · ballot on the picked proposal`)]

  if (members.length === 0) rows.push(starts(ctx, 'No workers have joined. A vote needs a registered worker.', ['hive-workers']))

  for (const member of members.slice(0, 12)) {
    const ballot = picked?.ballots.find(entry => entry.voter === member.id)
    const vote = picked === null ? '' : picked.byzantine.includes(member.id) ? 'byzantine' : ballot === undefined ? 'not voted' : ballot.isFor ? 'for' : 'against'

    rows.push(
      row(ctx, [
        ctx.kit.Text({ ...LIVE_THEME(member.liveness), children: ` ${glyphOf(member)} ` }),
        ctx.kit.Text({ wrap: 'truncate-end', children: clip(`${shortId(member.id).padEnd(7)} ${member.role.padEnd(11)} ${member.status.padEnd(15)} ${vote.padEnd(10)} ${member.id}`, ctx.columns - 4) }),
      ]),
    )
  }

  if (members.length > 12) rows.push(text(ctx, `+${members.length - 12} more workers`, { dimColor: true }))

  return rows
}

function proposalsSection(ctx: Ctx, hive: HiveInfo): RenderElement[] {
  const picked = pickedProposal(hive, ctx.state.select.item)
  const rows: RenderElement[] = [rule(ctx, 'Proposals', hive.pending.length === 0 ? 'none open' : `${hive.pending.length} open · j/k pick`)]

  if (hive.pending.length === 0) rows.push(text(ctx, 'No open proposals. Propose one below.', { dimColor: true }))

  for (const proposal of hive.pending.slice(0, 8)) {
    const tally = tallyOf(hive, proposal, ctx.nowMs)
    const isPicked = proposal.id === picked?.id
    const deadline = proposal.timeoutAtMs === undefined ? '' : tally.isTimedOut ? ' · timed out: re-propose in the next term' : ` · times out in ${Math.ceil((proposal.timeoutAtMs - ctx.nowMs) / 1000)}s`

    rows.push(
      text(ctx, `${isPicked ? '▸' : ' '}◇ ${proposal.type} (${noteOf(tally)}) ${proposal.status} · for ${proposal.votesFor} · against ${proposal.votesAgainst} · [${bar(tally)}] need ${tally.required} of ${tally.nodes}`, isPicked ? { bold: true, color: THEME.warn } : { color: THEME.warn }),
    )

    if (!isPicked) continue

    const voters = (isFor: boolean) => proposal.ballots.filter(ballot => ballot.isFor === isFor).map(ballot => shortId(ballot.voter)).join(', ') || '—'

    rows.push(text(ctx, `    "${proposal.value ?? 'n/a'}" · by ${proposal.proposedBy ?? 'n/a'} · ${ago(proposal.proposedAtMs, ctx.nowMs)}${deadline}`, { dimColor: true }))
    rows.push(text(ctx, `    for: ${voters(true)} · against: ${voters(false)}${proposal.byzantine.length > 0 ? ` · byzantine (excluded): ${proposal.byzantine.map(shortId).join(', ')}` : ''} · ${proposal.id}`, { dimColor: true }))
  }

  if (picked !== null && ctx.columns >= 44) {
    const voter = nextVoter(hive, picked)

    rows.push(
      row(ctx, [
        ...(hive.pending.length > 1 ? [button(ctx, 'item-prev', 'prev', () => ctx.act.select(-1), { hotkey: 'k' }), button(ctx, 'item-next', 'next', () => ctx.act.select(1), { hotkey: 'j' })] : []),
        ...(voter === null ? [] : [button(ctx, 'hive-vote-yes', 'Vote for', () => void ctx.act.run('hive-vote-yes'), { hotkey: 'f' }), button(ctx, 'hive-vote-no', 'Vote against', () => void ctx.act.run('hive-vote-no'), { hotkey: 'a' })]),
      ]),
    )
    if (voter === null && hive.workers.length === 0) rows.push(starts(ctx, 'No registered worker to vote as (the CLI counts only workers).', ['hive-workers'], 'vote-'))
    else rows.push(text(ctx, voter === null ? `vote: n/a — ${hive.workers.length === 0 ? 'no registered worker to vote as (the CLI counts only workers): spawn one' : 'every worker has voted on it'}` : `a vote is cast as the next worker that has not voted: ${voter}`, { dimColor: true }))
  }

  return rows
}

function historySection(ctx: Ctx, hive: HiveInfo): RenderElement[] {
  const rows: RenderElement[] = [rule(ctx, 'Decided', `${hive.history.length} on record`)]

  if (hive.history.length === 0) rows.push(text(ctx, 'Nothing decided yet.', { dimColor: true }))

  for (const decision of hive.history.slice(-6).reverse()) {
    const isApproved = decision.result === 'approved'

    rows.push(
      text(
        ctx,
        `${isApproved ? '◆' : '◇'} ${decision.type} → ${decision.result} · for ${decision.votesFor} · against ${decision.votesAgainst}${decision.strategy !== undefined ? ` · ${decision.strategy}${decision.term !== undefined ? ` T${decision.term}` : ''}` : ''}${decision.byzantine > 0 ? ` · ${decision.byzantine} byzantine` : ''} · ${ago(decision.decidedAtMs, ctx.nowMs)}`,
        { color: isApproved ? THEME.ok : THEME.bad },
      ),
    )
  }

  return rows
}

function broadcastSection(ctx: Ctx, hive: HiveInfo): RenderElement[] {
  const rows: RenderElement[] = [rule(ctx, 'Broadcasts', `${hive.broadcasts.length} kept · shared memory`)]

  if (hive.broadcasts.length === 0) rows.push(text(ctx, 'No broadcasts yet.', { dimColor: true }))

  for (const message of hive.broadcasts.slice(-5).reverse()) {
    rows.push(text(ctx, `${ago(message.atMs, ctx.nowMs).padStart(8)} [${message.priority}] ${message.from}: ${message.message}`, message.priority === 'high' || message.priority === 'critical' ? { color: THEME.warn } : {}))
  }

  const keys = hive.memoryKeys.filter(key => key !== 'broadcasts')

  if (keys.length > 0) rows.push(text(ctx, `memory keys: ${keys.slice(0, 12).join(', ')}${keys.length > 12 ? ` +${keys.length - 12}` : ''}`, { dimColor: true }))

  return rows
}

/**
 * The Hive-Mind's action menu, at the top of the page in its own frame: spawn a worker, a specialist or a scout, and the
 * propose and broadcast fields. Every one asks y/n first and then runs one ruflo command; voting sits with the proposals it
 * applies to. Boxed and labelled so it reads as the page's menu.
 */
function actSection(ctx: Ctx, hive: HiveInfo): RenderElement[] {
  const block = proposeBlock(hive)
  const Input = ctx.kit.Input
  const run = (id: string) => () => void ctx.act.run(id)
  const inner: RenderElement[] = [
    row(ctx, [ctx.kit.Text({ bold: true, color: THEME.ok, children: ' ACT ' }), ctx.kit.Text({ dimColor: true, children: ' each asks y/n, then runs one ruflo command' })], 'hive-act-title'),
    row(
      ctx,
      [
        ctx.kit.Button({ key: 'hive-spawn-worker', label: ' ✚ Spawn worker (s) ', hotkey: 's', onPress: run('hive-spawn-worker'), variant: 'primary' }),
        ctx.kit.Button({ key: 'hive-spawn-specialist', label: ' ◆ Specialist ', onPress: run('hive-spawn-specialist') }),
        ctx.kit.Button({ key: 'hive-spawn-scout', label: ' ▲ Scout ', onPress: run('hive-spawn-scout') }),
        ctx.kit.Text({ dimColor: true, children: hive.pending.length > 0 ? '  vote on the proposals below ↓' : '  no proposal to vote on yet' }),
      ],
      'hive-act-menu',
    ),
  ]

  if (Input === undefined) {
    inner.push(text(ctx, ' propose and broadcast from the palette: p → "propose design: use raft", "broadcast hello"', { dimColor: true }))
  } else {
    inner.push(Input({ key: 'hive-propose', label: ' ✎ propose', placeholder: block ?? 'the decision to put to the vote (design: use raft for the console)', submitLabel: 'ask', onSubmit: value => void ctx.act.run('propose', value) }))
    inner.push(Input({ key: 'hive-broadcast', label: ' ✎ broadcast', placeholder: 'a message for every worker', submitLabel: 'ask', onSubmit: value => void ctx.act.run('broadcast', value) }))
  }

  if (block !== null) inner.push(text(ctx, ` propose: n/a — ${block}`, { color: THEME.warn }))

  // The ask the ACT menu raised is drawn inside it, right under the buttons and fields that raised it.
  return [ctx.kit.Box({ key: 'hive-act', flexDirection: 'column', borderStyle: 'round', borderColor: THEME.ok, paddingX: 1, children: [...inner, ...confirmHere(ctx, 'hive', true)] })]
}

/**
 * No hive yet: the empty comb with its egg, the start buttons inside it (between the comb's two halves), and the way
 * in said plainly. The buttons run the starts' palette ids, so each asks first with its exact argv.
 */
function emptyComb(ctx: Ctx): RenderElement[] {
  return [
    picture(ctx, 'hive-egg', 'an empty comb: no queen yet'),
    text(ctx, '   the comb is empty · the egg is where the queen will sit · start a hive, then spawn workers to fill the comb', { color: THEME.warn }),
    starts(ctx, 'Start a hive with a queen, then spawn workers to fill the comb.', ['hive', 'hive-workers']),
    picture(ctx, 'hive-egg-base', ''),
  ]
}

export function hiveView(ctx: Ctx): RenderElement {
  const snap = ctx.state.snapshot
  const hive = snap?.hive ?? null

  if (snap === null) return text(ctx, 'reading ruflo state…', { dimColor: true })

  if (hive === null) return col(ctx, [rule(ctx, 'Hive-Mind', 'not initialised'), ...emptyComb(ctx), ...confirmHere(ctx, 'hive', true)], 'hive')

  const members = membersOf(hive, snap.hiveAgents, snap.agents)
  const byzantine = new Set(hive.pending.flatMap(proposal => proposal.byzantine)).size

  return col(
    ctx,
    [
      rule(ctx, 'Hive-Mind', `${hive.topology} · ${hive.strategy ?? 'consensus n/a'} · ${members.length} in the comb${byzantine > 0 ? ` · ${byzantine} byzantine` : ''}`),
      ...actSection(ctx, hive),
      picture(ctx, 'hive', `honeycomb needs a terminal: the queen and ${members.length} workers`),
      text(ctx, '♛ queen · ● worker ◆ specialist ▲ scout ○ in no store · brighter = busier · ballot dot: green for, pink against, · not yet · red walls ✖ byzantine · ✔ ✘ scars: decided · a wave runs to the queen for 2 s when a vote lands', { dimColor: true }),
      ...(hive.pending.length > 0 ? [rule(ctx, 'Voting chambers', `${hive.pending.length} open · for fills from the left, against from the right, ┃ the quorum lines`), picture(ctx, 'hive-chambers', `${hive.pending.length} open proposal${hive.pending.length === 1 ? '' : 's'}`)] : []),
      ...proposalsSection(ctx, hive),
      rule(ctx, 'Terms · pheromones', 'the shield: faulty workers survived, f of n'),
      picture(ctx, 'hive-strip', 'the term timeline and the broadcast ticker need a terminal'),
      ...summary(ctx, hive, members),
      ...workersSection(ctx, hive, members),
      ...historySection(ctx, hive),
      ...broadcastSection(ctx, hive),
    ],
    'hive',
  )
}
