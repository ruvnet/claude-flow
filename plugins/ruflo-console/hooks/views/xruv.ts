import type { RenderElement } from 'claude-code'

import type { Channels, Registry, Roster } from '../data/cli'
import type { SwarmMessages, WorkClaims } from '../data/xruv'
import { BBS_SERVE_COMMAND, INVITE_COMMAND, UNREGISTER_WHY, XRUV, type XEntry, type XGroup } from '../xruv'
import { ago, button, clip, col, type Ctx, kv, live, row, rule, sourceLine, tagChip, text, THEME } from './common'
import { frameResult } from './status-card'

/** Result lines in view at once; j/k scroll the rest. */
export const XRUV_ROWS = 8

/** Each kind as a four-cell tag: reads, writes that ask first, and the gateway-identity rows that need the token. */
const TAG = { read: { text: ' rd ', color: () => THEME.ok }, write: { text: ' wr ', color: () => THEME.info }, admin: { text: ' ad ', color: () => THEME.warn } } as const

const entriesOf = (group: XGroup): XEntry[] => XRUV.filter(entry => entry.group === group)

/** The button a row ends with: fetch for a read, ask for a write, nothing where it cannot run or needs typed text. */
function rowButton(ctx: Ctx, entry: XEntry): RenderElement | null {
  const isAdminOff = entry.kind === 'admin' && ctx.state.xruv.hasAdminToken !== true

  if (entry.id === 'x-unregister' || isAdminOff) return null
  // The invite code is a bearer secret: it is minted in the terminal, where only the person reads it.
  if (entry.id === 'x-bbs-serve') return ctx.kit.Button({ key: 'xr-x-bbs-serve', label: ' ▸ type', plain: true, dimColor: true, onPress: () => ctx.act.term.load('ruflo', BBS_SERVE_COMMAND) })
  if (entry.id === 'x-invite') return ctx.kit.Button({ key: 'xr-x-invite', label: ' ▸ type', plain: true, dimColor: true, onPress: () => ctx.act.term.load('ruflo', INVITE_COMMAND) })
  if (entry.takes !== undefined && entry.id !== 'x-join') return null

  return ctx.kit.Button({ key: `xr-${entry.id}`, label: entry.kind === 'read' ? ' ▸ fetch' : ' ▸ ask', plain: true, dimColor: true, onPress: () => void ctx.act.run(entry.id) })
}

/**
 * What pressing a row's name does: a text-taking row focuses its field (the next keys type into it), the invite row
 * types its command into the terminal, and every other row runs its action (a read fetches, a write asks, and
 * unregister or an admin row without the token says why in the Result panel).
 */
function pressOf(ctx: Ctx, entry: XEntry): () => void {
  if (entry.id === 'x-invite') return () => ctx.act.term.load('ruflo', INVITE_COMMAND)
  if (entry.id === 'x-bbs-serve') return () => ctx.act.term.load('ruflo', BBS_SERVE_COMMAND)
  if (entry.takes !== undefined && entry.id !== 'x-join') return () => ctx.act.focus(`xr-in-${entry.id}`)

  return () => void ctx.act.run(entry.id)
}

/** One menu row, dotted to its purpose: the tag, the name and what it does (both buttons: the whole row is clickable), and its own button. */
function entryRow(ctx: Ctx, entry: XEntry, lead: number): RenderElement {
  const tag = TAG[entry.kind]
  const isOff = entry.id === 'x-unregister' || (entry.kind === 'admin' && ctx.state.xruv.hasAdminToken !== true)
  const action = rowButton(ctx, entry)
  const press = pressOf(ctx, entry)

  return row(
    ctx,
    [
      tagChip(ctx, tag.text, tag.color()),
      ctx.kit.Button({ key: `xr-name-${entry.id}`, label: ` ${entry.name} `.padEnd(lead, '.'), plain: true, onPress: press }),
      ctx.kit.Button({ key: `xr-about-${entry.id}`, label: clip(` ${entry.about}`, Math.max(4, ctx.columns - lead - 18)), plain: true, dimColor: true, onPress: press }),
      ...(action === null ? [] : [action]),
    ],
    `xr-row-${entry.id}`,
  )
}

/** The field a text-taking row submits from; without Inputs (a surface with none), the palette words instead. */
function field(ctx: Ctx, entry: XEntry, placeholder: string): RenderElement {
  const Input = ctx.kit.Input

  if (Input === undefined) return text(ctx, `   from the palette (p): ${entry.id} <${entry.takes ?? ''}>`, { dimColor: true })

  return Input({ key: `xr-in-${entry.id}`, label: `  ▸ ${entry.name.toLowerCase()}`, placeholder, submitLabel: entry.kind === 'read' ? 'fetch' : 'ask', onSubmit: value => void ctx.act.run(entry.id, value) })
}

/** This node: its Nostr key (only whether the file exists), the pubkey a result named, and the join and leave rows. */
function identityRows(ctx: Ctx, lead: number): RenderElement[] {
  const { state } = ctx
  const hasKey = state.snapshot?.hasNostrKey ?? null
  const reg = live<Registry>(state.probes.get('registry'))?.registration
  const rows: RenderElement[] = [rule(ctx, 'Identity', 'your own key · the file is never read')]
  const confirmed = hasKey === null && state.nostrKeyVerifiedAtMs !== null
  const present = confirmed
    ? `confirmed by JOIN ${ago(state.nostrKeyVerifiedAtMs, ctx.nowMs)} (never read here)`
    : 'present: ~/.ruflo/nostr.key (never read here)'

  rows.push(kv(ctx, 'nostr key', hasKey || confirmed ? present : hasKey === null ? 'n/a' : 'none yet: JOIN makes ~/.ruflo/nostr.key', hasKey || confirmed ? THEME.ok : undefined))
  rows.push(kv(ctx, 'pubkey', state.xruv.pubkey !== null ? `${state.xruv.pubkey.slice(0, 16)}…${state.xruv.pubkey.slice(-6)}` : 'n/a — named by the next JOIN, ACCEPT or PUBLISH result'))
  rows.push(kv(ctx, 'registration', reg === undefined ? 'n/a — open or closed is in the registry (▸ fetch below)' : `${reg.isOpen ? 'open' : 'closed'}${reg.auth !== undefined ? ` · ${reg.auth}` : ''} · JOIN checks membership first and registers only if needed`, reg?.isOpen === true ? THEME.ok : undefined))

  for (const entry of entriesOf('identity')) {
    rows.push(entryRow(ctx, entry, lead))
    if (entry.id === 'x-join') rows.push(field(ctx, entry, 'invite code v2.… (optional, private): Enter asks to join with it'))
  }

  rows.push(text(ctx, ` ${UNREGISTER_WHY}`, { dimColor: true }))

  return rows
}

/** A read's section: its row, then up to `max` lines of what it last fetched, or why there is nothing yet. */
function liveRows(ctx: Ctx, entry: XEntry, lead: number, lines: string[] | null, probe: string, max: number): RenderElement[] {
  const rows = [entryRow(ctx, entry, lead)]

  if (lines === null) {
    const source = sourceLine(ctx.state.probes.get(probe), ctx.nowMs, entry.name.toLowerCase())

    if (ctx.state.options.federationNetwork || ctx.state.probes.get(probe) !== undefined) rows.push(text(ctx, `   ${source.text}`, { dimColor: source.color === undefined, ...(source.color !== undefined && { color: source.color }) }))

    return rows
  }

  for (const line of lines.slice(0, max)) rows.push(text(ctx, `   ${line}`))
  if (lines.length > max) rows.push(text(ctx, `   … ${lines.length - max} more: ▸ fetch shows them all below`, { dimColor: true }))

  return rows
}

/** Registry, roster, the claims board and the swarm's messages: live with the option on, else one fetch per click. */
function networkRows(ctx: Ctx, lead: number): RenderElement[] {
  const { state, nowMs } = ctx
  const isNet = state.options.federationNetwork
  const rows: RenderElement[] = [rule(ctx, 'Live', isNet ? 'federationNetwork on · refreshed every few minutes' : 'network off · ▸ fetch asks the relay once')]

  if (!isNet) {
    rows.push(text(ctx, ' The registry and the swarm are on x.ruv.io. Turn on federationNetwork in /config (ruflo-console) to keep them live,', { dimColor: true }))
    rows.push(text(ctx, ' or press ▸ fetch: that one click asks once. Nothing on the network is asked unless you do one of these.', { dimColor: true }))
  }

  const registry = live<Registry>(state.probes.get('registry'))
  const roster = live<Roster>(state.probes.get('roster'))
  const claims = live<WorkClaims>(state.probes.get('x-claims'))
  const sync = live<SwarmMessages>(state.probes.get('x-sync'))
  const [regEntry, rosterEntry, claimsEntry, syncEntry] = entriesOf('live')

  if (regEntry !== undefined) {
    const lines = registry === null ? null : [`relay ${registry.relay ?? 'n/a'}${registry.swarmTag !== undefined ? ` · tag #${registry.swarmTag}` : ''} · gateway ${registry.gatewayPubkey?.slice(0, 16) ?? 'n/a'}…`, ...registry.join.map(step => clip(step, 160))]

    rows.push(...liveRows(ctx, regEntry, lead, lines, 'registry', 3))
  }
  if (rosterEntry !== undefined) {
    const lines = roster === null ? null : roster.members.length === 0 ? [`nobody announcing on ${roster.relay ?? 'the relay'} (${ago(roster.atMs, nowMs)})`] : [...roster.members.map(member => `◉ ${member.name}${member.detail !== undefined ? ` — ${member.detail}` : ''}`), `${roster.members.length} on · third-party text, not vetted · ${ago(roster.atMs, nowMs)}`]

    rows.push(...liveRows(ctx, rosterEntry, lead, lines, 'roster', 4))
  }
  if (claimsEntry !== undefined) {
    const lines = claims === null ? null : claims.claims.length === 0 ? ['no open claims on the board'] : claims.claims.map(claim => `${claim.resource} · ${claim.owner}${claim.from !== undefined ? ` (${claim.from})` : ''}`)

    rows.push(...liveRows(ctx, claimsEntry, lead, lines, 'x-claims', 3))
  }
  if (syncEntry !== undefined) {
    const lines = sync === null ? null : sync.messages.length === 0 ? ['no swarm messages in the last hour'] : sync.messages.map(message => `[${message.type}] ${message.from}${message.text !== undefined ? ` — ${message.text}` : ''} · ${ago(message.atMs, nowMs)}`)

    rows.push(...liveRows(ctx, syncEntry, lead, lines, 'x-sync', 4))
  }

  return rows
}

/** The channels whose keys are here, each readable with one press; the registry's rooms when none are held yet. */
function channelRows(ctx: Ctx, lead: number): RenderElement[] {
  const { state, nowMs } = ctx
  const held = live<Channels>(state.probes.get('channels'))
  const rooms = live<Registry>(state.probes.get('registry'))?.channels ?? []
  const rows: RenderElement[] = [rule(ctx, 'Channels', 'list is local · read, publish, grant reach the relay')]
  const readBtn = (id: string) => ctx.kit.Button({ key: `xr-read-${id}`, label: ' ▸ read', plain: true, dimColor: true, onPress: () => void ctx.act.run('x-read', id) })

  if (held !== null && held.channels.length > 0) {
    for (const channel of held.channels.slice(0, 6)) {
      rows.push(row(ctx, [ctx.kit.Button({ key: `xr-chname-${channel.id}`, label: ` # ${clip(channel.name ?? channel.id, 18).padEnd(18)} ${channel.id.padEnd(22)} ${channel.id.startsWith('prv:') ? 'private' : 'public '} · ${ago(channel.atMs, nowMs)} `, plain: true, onPress: () => void ctx.act.run('x-read', channel.id) }), readBtn(channel.id)], `xr-ch-${channel.id}`))
    }
  } else {
    rows.push(text(ctx, ` ${held === null ? sourceLine(state.probes.get('channels'), nowMs, 'channels').text : 'no channel keys held here yet'}`, { dimColor: true }))
  }

  for (const room of rooms.slice(0, 4)) {
    rows.push(row(ctx, [ctx.kit.Button({ key: `xr-roomname-${room.name}`, label: ` #${room.name.padEnd(14)} ${clip(room.purpose ?? '', Math.max(4, ctx.columns - 32))}`, plain: true, onPress: () => void ctx.act.run('x-read', `pub:${room.name}`) }), readBtn(`pub:${room.name}`)], `xr-room-${room.name}`))
  }

  const first = held?.channels[0]?.id ?? (rooms[0] !== undefined ? `pub:${rooms[0].name}` : 'pub:general')
  const placeholders: Record<string, string> = {
    'x-read': `${first} (or a name): Enter reads it`,
    'x-publish': `${first} Status: online — signed with your key, Enter asks`,
    'x-create': 'my-room public | my-room private — Enter asks',
    'x-grant': 'prv:<16 hex> <64-hex pubkey> — Enter asks',
  }

  for (const entry of entriesOf('channels')) {
    rows.push(entryRow(ctx, entry, lead))
    if (entry.takes !== undefined) rows.push(field(ctx, entry, placeholders[entry.id] ?? entry.takes))
  }

  return rows
}

/** The gateway-identity rows: shown always, usable only with the token in the environment, each asking first. */
function adminRows(ctx: Ctx, lead: number): RenderElement[] {
  const has = ctx.state.xruv.hasAdminToken === true
  const rows: RenderElement[] = [rule(ctx, 'Admin', has ? 'RUFLO_X_ADMIN_TOKEN is set · acts as the gateway · asks first' : 'admin token: set it in the environment to enable')]

  for (const entry of entriesOf('admin')) {
    rows.push(entryRow(ctx, entry, lead))
    if (has && entry.takes !== undefined) rows.push(field(ctx, entry, entry.id === 'x-hub' ? 'Status: maintenance at 18:00 — signed as the gateway, Enter asks' : '<64-hex pubkey> [member|admin] — no revoke tool, Enter asks'))
  }

  if (!has) rows.push(text(ctx, ' These sign as the x.ruv.io gateway: start Claude Code with RUFLO_X_ADMIN_TOKEN set to use them (it is never shown or passed as an argument).', { dimColor: true }))

  return rows
}

/** AgentBBS: rooms, envelopes and pinned peers on this machine; only SYNC reaches the network, and it asks first. */
function agentbbsRows(ctx: Ctx, lead: number): RenderElement[] {
  const rows: RenderElement[] = [rule(ctx, 'AgentBBS', 'rooms · envelopes · pinned peers · federation_bbs_* tools')]
  const placeholders: Record<string, string> = {
    'x-bbs-register': '#sales — Enter asks',
    'x-bbs-publish': '<roomId> Status: build green — Enter asks',
    'x-bbs-watch': '<roomId> 20 — Enter reads it',
    'x-bbs-peer-add': '<16-hex node id> http://100.x.y.z:7777 <64-hex key> — Enter asks',
    'x-bbs-sync': '<roomId> [nodeId] — Enter asks (network)',
  }

  for (const entry of entriesOf('agentbbs')) {
    rows.push(entryRow(ctx, entry, lead))
    if (entry.takes !== undefined) rows.push(field(ctx, entry, placeholders[entry.id] ?? entry.takes))
  }

  rows.push(text(ctx, ' No join-as-human row: it mints a bearer token, which the console never shows. Use the terminal for it.', { dimColor: true }))

  return rows
}

/** The last board run: what it was, how it exited, what it sends, and a window of its lines. */
function resultRows(ctx: Ctx): RenderElement[] {
  const { state, nowMs } = ctx
  const { result, running } = state.xruv
  const right = running !== null ? `running ${Math.round((nowMs - running.startedAtMs) / 1000)}s` : result === null ? 'nothing run yet' : `${result.ok ? '✓' : '✗'} exit ${result.exitCode ?? 'n/a'} · ${ago(result.atMs, nowMs)}`
  const rows: RenderElement[] = [rule(ctx, 'Result', right)]

  if (running !== null) rows.push(text(ctx, ` ▸ ${running.label} … ${Math.floor(nowMs / 500) % 2 === 0 ? '█' : ' '}`, { color: THEME.warn }))

  // A row that cannot run (unregister, an admin row without its token) answers here with why, never silently.
  const { outcome } = state

  if (outcome !== null && !outcome.ok && (result === null || outcome.atMs > result.atMs)) {
    rows.push(text(ctx, ` ✗ ${outcome.label}`, { bold: true, color: THEME.warn }))
    rows.push(text(ctx, `   ${outcome.detail}`))
  }

  if (result === null) {
    if (running === null) rows.push(text(ctx, ' ▸ fetch shows its answer here at once; a write shows here after you confirm (y)', { dimColor: true }))

    return [frameResult(ctx, rows, running !== null ? 'run' : 'idle')]
  }

  rows.push(text(ctx, ` ${result.label}`, { bold: true, color: result.ok ? THEME.ok : THEME.bad }))
  if (result.note !== undefined) rows.push(text(ctx, ` ${result.note}`, { color: THEME.warn }))

  const top = Math.max(0, Math.min(state.select.item, result.lines.length - XRUV_ROWS))

  for (const line of result.lines.slice(top, top + XRUV_ROWS)) rows.push(text(ctx, `   ${line}`))

  if (result.lines.length > XRUV_ROWS) {
    rows.push(
      row(ctx, [
        text(ctx, ` lines ${top + 1}-${Math.min(result.lines.length, top + XRUV_ROWS)} of ${result.lines.length} `, { dimColor: true }),
        button(ctx, 'xr-up', 'up', () => ctx.act.select(-1), { hotkey: 'k' }),
        button(ctx, 'xr-down', 'down', () => ctx.act.select(1), { hotkey: 'j' }),
      ]),
    )
  }

  return [frameResult(ctx, rows, result.ok ? 'ok' : 'bad')]
}

/**
 * The x.ruv.io board: every federation capability as a row with its own button. Identity (whether the key file exists,
 * never its content) and joining; the registry, the roster, the work claims and the swarm's messages, live with
 * `federationNetwork` or fetched once per click; the channels held here, with read, publish, create, grant and accept;
 * the gateway-identity rows, which need RUFLO_X_ADMIN_TOKEN; and the last run's output. Reads run at once, everything
 * that registers, signs or writes asks first and its confirm row says what it sends. Unregistering is not offered: the
 * gateway has no endpoint for it.
 */
export function xruvView(ctx: Ctx): RenderElement {
  const lead = Math.max(14, Math.min(18, ctx.columns - 40))
  const rows: RenderElement[] = [
    rule(ctx, 'Main menu', 'ruflo federation · x_federation_* tools'),
    text(ctx, ' rd reads at once · wr asks first (y) and says what it sends · ad signs as the gateway (admin token)', { dimColor: true }),
    // The result sits at the top: a click far down the board answers where it can be seen, not below the fold.
    ...resultRows(ctx),
    ...identityRows(ctx, lead),
    ...networkRows(ctx, lead),
    ...channelRows(ctx, lead),
    ...agentbbsRows(ctx, lead),
    ...adminRows(ctx, lead),
  ]

  return col(ctx, rows, 'xruv')
}
