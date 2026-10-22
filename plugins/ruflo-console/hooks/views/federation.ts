import type { RenderElement } from 'claude-code'

import type { Channels, Peers, Roster } from '../data/cli'
import { ago, col, kv, live, picture, rule, sourceLine, starts, text, THEME, type Ctx } from './common'
import { fedNodesOf } from './frames'

/**
 * This node's federation standing from local state and local CLI answers only. The roster lives on the public relay,
 * so it is asked for only when the person turns `federationNetwork` on, and what it returns is labelled third-party.
 */
export function federationView(ctx: Ctx): RenderElement {
  const { state, nowMs } = ctx
  const snap = state.snapshot
  const peers = live<Peers>(state.probes.get('peers'))
  const channels = live<Channels>(state.probes.get('channels'))
  const roster = live<Roster>(state.probes.get('roster'))
  const nodes = snap?.federationNodes ?? null
  const rows: RenderElement[] = [rule(ctx, 'Map', 'this node · peers · keys · channels · roster')]

  rows.push(picture(ctx, 'fedmap', 'map needs a terminal'))
  if (fedNodesOf(state).length === 0) rows.push(text(ctx, ' Nothing to draw yet: a key, a pinned peer or a channel adds a node.', { dimColor: true }))
  rows.push(text(ctx, '● pinned peer or own key: solid · channel: dashed', { dimColor: true }))
  rows.push(text(ctx, '○ roster member: sparse, unvetted · a dot runs an edge for 2 s after a sync', { dimColor: true }))
  rows.push(rule(ctx, 'This node', 'local only'))
  const confirmed = snap?.hasNostrKey === null && state.nostrKeyVerifiedAtMs !== null
  const present = confirmed
    ? `confirmed by JOIN ${ago(state.nostrKeyVerifiedAtMs, nowMs)} (never read here)`
    : '~/.ruflo/nostr.key present (never read here)'

  rows.push(
    kv(
      ctx,
      'nostr identity',
      snap?.hasNostrKey === true || confirmed ? present : snap?.hasNostrKey === false ? 'none yet (join below makes one)' : 'n/a',
      snap?.hasNostrKey === true || confirmed ? THEME.ok : undefined,
    ),
  )
  rows.push(kv(ctx, 'federation keys', nodes === null ? 'n/a — no .claude-flow/federation' : nodes.length === 0 ? 'none' : `${nodes.length} node ids: ${nodes.slice(0, 4).join(', ')}${nodes.length > 4 ? ' …' : ''} (keys never read)`))
  rows.push(
    kv(
      ctx,
      'trust',
      peers === null
        ? sourceLine(state.probes.get('peers'), nowMs, 'n/a').text
        : peers.degraded !== undefined
          ? `n/a — agentbbs ${peers.degraded}`
          : `${peers.peers.length} pinned peers accepted for envelopes (agentbbs peers.json)`,
    ),
  )

  if (snap?.hasNostrKey === false) rows.push(starts(ctx, 'This node has no federation identity yet.', ['federation-join', 'channel-read']))

  rows.push(rule(ctx, 'Peers', 'agentbbs'))

  if (peers !== null && peers.peers.length > 0) {
    for (const peer of peers.peers.slice(0, 6)) rows.push(text(ctx, `◇ ${peer.id} · last sync ${ago(peer.lastSyncMs, nowMs)}`))
  } else {
    rows.push(text(ctx, peers === null ? sourceLine(state.probes.get('peers'), nowMs, 'peers').text : 'no pinned peers', { dimColor: true }))
  }

  rows.push(rule(ctx, 'Channels', 'x.ruv.io'))

  if (channels !== null && channels.channels.length > 0) {
    for (const channel of channels.channels.slice(0, 6)) rows.push(text(ctx, `# ${channel.name ?? channel.id} · ${channel.id.startsWith('prv:') ? 'private' : 'public'} · since ${ago(channel.atMs, nowMs)}`))
  } else {
    rows.push(text(ctx, channels === null ? sourceLine(state.probes.get('channels'), nowMs, 'channels').text : 'no channels joined', { dimColor: true }))
  }

  rows.push(text(ctx, 'last messages: n/a — ruflo keeps no local message log (`npx ruflo federation channel read`)', { dimColor: true }))
  rows.push(rule(ctx, 'Roster', state.options.federationNetwork ? 'wss relay · third-party text' : 'network off'))

  if (!state.options.federationNetwork) {
    rows.push(text(ctx, 'Off: the roster is on the public relay. Turn on federationNetwork in /config (ruflo-console) to ask it.', { dimColor: true }))
  } else if (roster === null) {
    rows.push(text(ctx, sourceLine(state.probes.get('roster'), nowMs, 'roster').text, { dimColor: true }))
  } else if (roster.members.length === 0) {
    rows.push(text(ctx, `roster empty on ${roster.relay ?? 'the relay'} (${ago(roster.atMs, nowMs)})`, { dimColor: true }))
  } else {
    for (const member of roster.members.slice(0, 6)) rows.push(text(ctx, `· ${member.name}${member.detail !== undefined ? ` — ${member.detail}` : ''}`))
    rows.push(text(ctx, `untrusted: published by third-party members, not vetted · ${roster.relay ?? ''} · ${ago(roster.atMs, nowMs)}`, { dimColor: true }))
  }

  return col(ctx, rows, 'federation')
}
