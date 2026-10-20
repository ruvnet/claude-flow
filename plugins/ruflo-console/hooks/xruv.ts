/**
 * The x.ruv.io board's actions: every `ruflo federation` capability as fixed argv for `ruflo mcp exec -t x_federation_*`,
 * checked against the CLI's tools (x-federation-tools.ts, x-federation-join.ts, x-federation-channels.ts). Reads run at
 * once, since a click or `/ruflo run` is the person asking; anything that registers, signs, publishes, grants or writes a
 * key asks first, and its confirm row says what it sends and where. The channel tools and join make
 * `~/.ruflo/nostr.key` when it is missing, so a channel read asks first until that key exists. Text from an Input is
 * parsed and validated here, and the one JSON argument is `JSON.stringify`'s. Pure: entries and parsers only, no `$`.
 */
import { ARGV_TEXT_MAX, countOf } from './full-text'
import type { ActionSpec } from './actions'
import { jsonAfter, registryProbe, rosterProbe, channelsProbe, type Channels, type Registry, type Roster } from './data/cli'
import { plain, recordOf, stringOf } from './data/parse'
import { isoOf } from './data/safe'
import { envelopeOf, messageOf, shortKey, swarmProbe, workClaimsProbe, type WorkClaims } from './data/xruv'
import { labLines } from './mh-lab'
import type { State } from './state'

/** The CLI's own checks (x-federation-channels.ts, x-federation-join.ts), so a bad value is refused before anything runs. */
export const CHANNEL_NAME_RE = /^[a-z0-9][a-z0-9._-]{0,63}$/
export const CHANNEL_ID_RE = /^(pub:[a-z0-9][a-z0-9._-]{0,63}|prv:[0-9a-f]{16})$/
export const INVITE_RE = /^v2\.[A-Za-z0-9._-]{8,}$/
export const MSG_TYPE_RE = /^[A-Za-z0-9_-]{1,64}$/
const PUBKEY_RE = /^[0-9a-f]{64}$/i
const INVITE_ANYWHERE = /v2\.[A-Za-z0-9._-]{8,}/g

export const isPubkey = (value: string): boolean => PUBKEY_RE.test(value)

/** `pub:<name>` or `prv:<16 hex>` as given, or a bare name as its public channel; null for anything else. */
export function channelIdOf(word: string): string | null {
  const value = word.trim().toLowerCase()

  return CHANNEL_ID_RE.test(value) ? value : CHANNEL_NAME_RE.test(value) ? `pub:${value}` : null
}

// One argv element (ADR-481): the console's own bound is the most an argument carries; the relay answers for its own limit.
const MAX_PAYLOAD = ARGV_TEXT_MAX

/** A message body: a JSON object as typed, else `{ text }`; at most ARGV_TEXT_MAX (8,000) characters as JSON, null when empty or not an object. */
export function payloadOf(raw: string): Record<string, unknown> | null {
  const value = raw.trim()

  if (value === '') return null

  if (value.startsWith('{')) {
    let parsed: unknown

    try {
      parsed = JSON.parse(value)
    } catch {
      return null
    }

    const record = recordOf(parsed)

    return record === null || Array.isArray(parsed) || JSON.stringify(record).length > MAX_PAYLOAD ? null : record
  }

  const text = plain(value, Number.MAX_SAFE_INTEGER)

  return text === '' || countOf(text) > MAX_PAYLOAD ? null : { text }
}

/** `Type: text` as a message type and its body; text with no type is a Status. */
export function messageArg(raw: string): { msgType: string; payload: Record<string, unknown> } | null {
  const typed = /^([A-Za-z0-9_-]{1,64}):\s*([\s\S]+)$/.exec(raw.trim())
  const msgType = typed?.[1] ?? 'Status'
  const payload = payloadOf(typed?.[2] ?? raw)

  return payload === null || !MSG_TYPE_RE.test(msgType) ? null : { msgType, payload }
}

/** `<channel> Type: text`, as the publish Input takes it. */
export function publishArg(raw: string): { channel: string; msgType: string; payload: Record<string, unknown> } | null {
  const [first = '', ...rest] = raw.trim().split(/\s+/)
  const channel = channelIdOf(first)
  const message = messageArg(raw.trim().slice(first.length))

  return channel === null || rest.length === 0 || message === null ? null : { channel, ...message }
}

/** `<name> [public|private]`; public when unsaid. */
export function createArg(raw: string): { name: string; visibility: 'public' | 'private' } | null {
  const [name = '', visibility = 'public', ...extra] = raw.trim().toLowerCase().split(/\s+/)

  return CHANNEL_NAME_RE.test(name) && (visibility === 'public' || visibility === 'private') && extra.length === 0 ? { name, visibility } : null
}

/** `<prv:id> <64-hex pubkey>`: only a private channel has a key to grant. */
export function grantArg(raw: string): { channel: string; pubkey: string } | null {
  const [channel = '', pubkey = '', ...extra] = raw.trim().split(/\s+/)

  return /^prv:[0-9a-f]{16}$/.test(channel) && isPubkey(pubkey) && extra.length === 0 ? { channel, pubkey: pubkey.toLowerCase() } : null
}

/** `<64-hex pubkey> [member|admin]`; member when unsaid. */
export function admitArg(raw: string): { pubkey: string; role: 'member' | 'admin' } | null {
  const [pubkey = '', role = 'member', ...extra] = raw.trim().split(/\s+/)

  return isPubkey(pubkey) && (role === 'member' || role === 'admin') && extra.length === 0 ? { pubkey: pubkey.toLowerCase(), role } : null
}

/** A version (v2.1.0-beta.3) has the invite's characters but not its shape: the terminal masks every line, and a version stays readable. */
const VERSION = /^v2\.\d+\.\d+(?:\.\d+)?(?:-[0-9A-Za-z.-]+)?$/

/** An invite code in any text, masked: it is a bearer secret, so no line the console writes ever carries one. */
export const maskInvites = (line: string): string => line.replace(INVITE_ANYWHERE, code => (VERSION.test(code) ? code : 'v2.•••• (invite code, masked)'))

/** True when the text holds an invite code (a bearer secret the person minted: it never goes to a model). */
export const hasInvite = (text: string): boolean => maskInvites(text) !== text

const exec = (tool: string, params: Record<string, unknown>) => ['mcp', 'exec', '-t', tool, '-p', JSON.stringify(params)] as const

const ROOM_ID_RE = /^[A-Za-z0-9_.:@#/-]{1,128}$/
const NODE_ID_RE = /^[0-9a-f]{16}$/
const BBS_LABEL_RE = /^[A-Za-z0-9_.\-:/@# ]{1,64}$/

/** `<roomId> Type: text`, as the agentbbs publish Input takes it. */
export function bbsPublishArg(raw: string): { roomId: string; msgType: string; payload: Record<string, unknown> } | null {
  const [first = '', ...rest] = raw.trim().split(/\s+/)
  const message = messageArg(raw.trim().slice(first.length))

  return ROOM_ID_RE.test(first) && rest.length > 0 && message !== null ? { roomId: first, ...message } : null
}

/** `<roomId> [limit]`: the room to read and how many envelopes (1-500, 20 when unsaid). */
export function bbsWatchArg(raw: string): { roomId: string; limit: number } | null {
  const [roomId = '', count = '20', ...extra] = raw.trim().split(/\s+/)
  const limit = Number(count)

  return ROOM_ID_RE.test(roomId) && /^\d{1,3}$/.test(count) && limit >= 1 && limit <= 500 && extra.length === 0 ? { roomId, limit } : null
}

/** `<nodeId> <url> <64-hex publicKey> [label…]`: a peer pinned out of band. */
export function bbsPeerArg(raw: string): { nodeId: string; url: string; publicKey: string; label?: string } | null {
  const [nodeId = '', url = '', publicKey = '', ...label] = raw.trim().split(/\s+/)
  const name = label.join(' ')

  if (!NODE_ID_RE.test(nodeId) || !/^https?:\/\/[A-Za-z0-9.-]+(:\d{1,5})?\/?$/.test(url) || !isPubkey(publicKey) || (name !== '' && !BBS_LABEL_RE.test(name))) return null

  return { nodeId, url: url.replace(/\/$/, ''), publicKey: publicKey.toLowerCase(), ...(name === '' ? {} : { label: name }) }
}

/** `<roomId> [nodeId]`: the room to converge, from one pinned peer or all of them. */
export function bbsSyncArg(raw: string): { roomId: string; nodeId?: string } | null {
  const [roomId = '', nodeId, ...extra] = raw.trim().split(/\s+/)

  return ROOM_ID_RE.test(roomId) && (nodeId === undefined || NODE_ID_RE.test(nodeId)) && extra.length === 0 ? { roomId, ...(nodeId === undefined ? {} : { nodeId }) } : null
}
const ago = (atMs: number | undefined, nowMs: number) => (atMs === undefined ? '' : ` · ${Math.max(0, Math.round((nowMs - atMs) / 60_000))}m ago`)

/** One run's output as the result panel's lines: each read by its shape, anything else flattened, invite codes masked. */
export function xruvLines(id: string, stdout: string, stderr = '', nowMs = Date.now()): string[] {
  const out: string[] = []
  const json = recordOf(jsonAfter(stdout))
  const found = envelopeOf(stdout)

  if (id === 'x-registry') {
    const reg = registryProbe.parse(stdout) as Registry | null

    if (reg !== null) out.push(`relay ${reg.relay ?? 'n/a'}${reg.swarmTag !== undefined ? ` · tag #${reg.swarmTag}` : ''} · registration ${reg.registration?.isOpen === true ? 'open' : 'closed'}`, ...reg.join, ...reg.channels.map(room => `#${room.name} — ${room.purpose ?? ''}`))
  } else if (id === 'x-roster') {
    const roster = rosterProbe.parse(stdout) as Roster | null

    if (roster !== null) out.push(`${roster.members.length} on ${roster.relay ?? 'the relay'} · third-party text, not vetted`, ...roster.members.map(member => `◉ ${member.name}${member.detail !== undefined ? ` — ${member.detail}` : ''}`))
  } else if (id === 'x-claims') {
    const board = workClaimsProbe.parse(stdout) as WorkClaims | null

    if (board !== null) out.push(board.claims.length === 0 ? 'no open claims on the board' : `${board.claims.length} claimed resources`, ...board.claims.map(claim => `${claim.resource} · ${claim.owner}${claim.from !== undefined ? ` (${claim.from})` : ''}${claim.expiresAtMs !== undefined ? ` · until ${isoOf(claim.expiresAtMs).slice(0, 16)}Z` : ''}`))
  } else if (id === 'x-sync' || id === 'x-read') {
    const data = recordOf(found?.data)
    const list = Array.isArray(data?.messages) ? data.messages : null

    if (list !== null) {
      out.push(`${list.length} message${list.length === 1 ? '' : 's'}${id === 'x-read' ? ` on ${stringOf(data?.channel, 24) ?? 'the channel'} (${stringOf(data?.visibility, 8) ?? 'n/a'})` : ''} · signed by members, not vetted`)

      for (const entry of list.slice(0, 40)) {
        const message = messageOf(entry)
        const sealed = recordOf(entry)?.encrypted === true ? ` (encrypted: ${stringOf(recordOf(entry)?.reason, 40) ?? 'no key'})` : ''

        if (message !== null) out.push(`[${message.type}] ${message.from}${sealed}${message.text !== undefined ? ` — ${message.text}` : ''}${ago(message.atMs, nowMs)}`)
      }
    }
  } else if (id === 'x-channels') {
    const held = channelsProbe.parse(stdout) as Channels | null

    if (held !== null) out.push(held.channels.length === 0 ? 'no channel keys held here' : `${held.channels.length} channels held here (keys stay in ~/.ruflo/channels.json)`, ...held.channels.map(channel => `${channel.id}${channel.name !== undefined ? ` · ${channel.name}` : ''}`))
  } else if (id === 'x-join' && json !== null) {
    out.push(`${json.ok === true ? 'joined' : 'not joined'}${json.alreadyMember === true ? ' (already a member: nothing registered)' : ''} · pubkey ${shortKey(json.pubkey) ?? 'n/a'} · key ${json.keyCreated === true ? 'created now' : 'reused'} · membership ${json.membershipVerified === true ? 'verified (NIP-42)' : 'unverified'}`)
    if (json.degraded === true) out.push(`degraded: ${stringOf(json.reason, 80) ?? ''} · ${stringOf(json.hint, 120) ?? ''}`)
    if (typeof json.reason === 'string' && json.degraded !== true) out.push(`reason: ${plain(json.reason, 140)}`)
  }

  const lines = out.length > 0 ? out : labLines(id, stdout, stderr)

  return lines.map(line => maskInvites(plain(line, 160))).slice(0, 60)
}

/** The node's own Nostr pubkey from a result that names it (join, accept, publish, grant), else null. */
export function ownPubkeyOf(id: string, stdout: string): string | null {
  const json = recordOf(jsonAfter(stdout))
  const key = id === 'x-grant' ? json?.grantedBy : json?.pubkey

  return typeof key === 'string' && isPubkey(key) ? key.toLowerCase() : null
}

export type XKind = 'read' | 'write' | 'admin'
export type XGroup = 'identity' | 'live' | 'channels' | 'admin' | 'agentbbs'

export type XEntry = {
  id: string
  group: XGroup
  name: string
  about: string
  label: string
  kind: XKind
  /** What its text looks like, for entries that take one (the Input's placeholder, `/ruflo run <id> <text>`). */
  takes?: string
  spec: (state: State, text: string) => ActionSpec | null
  why: (state: State, text: string) => string
}

const ADMIN_OFF = 'admin-only: RUFLO_X_ADMIN_TOKEN is not set in the environment Claude Code started with (set it there to enable)'
export const UNREGISTER_WHY = 'unregister: not offered by the x.ruv.io gateway yet (no leave endpoint); your key stays in ~/.ruflo/nostr.key'
const RELAY = 'wss://relay.ruv.io'

/** A spec bound for the board's result panel, with its pubkey capture and its probe fill. */
function spec(state: State, id: string, base: Omit<ActionSpec, 'board' | 'lab' | 'lines' | 'onOutput'>, fills?: string): ActionSpec {
  const probe = [registryProbe, rosterProbe, channelsProbe, workClaimsProbe, swarmProbe].find(entry => entry.id === fills)

  return {
    ...base,
    lab: id,
    board: 'xruv',
    lines: (stdout, stderr) => xruvLines(id, stdout, stderr),
    onOutput: stdout => {
      const key = ownPubkeyOf(id, stdout)
      const value = probe?.parse(stdout) ?? null

      if (key !== null) state.xruv.pubkey = key
      if (probe !== undefined && value !== null) state.probes.set(probe.id, { value, okAtMs: Date.now(), error: null, errorAtMs: null, isRunning: false })
    },
  }
}

/** A network read: the click is the consent, so it runs at once; the same argv the option's probe runs. */
const read = (id: string, label: string, args: readonly string[], fills: string) => (state: State) => spec(state, id, { label, args, expect: 'its output on the board', isReadOnly: true, declared: 'network', timeoutMs: 60_000 }, fills)

const admin = (state: State, make: () => ActionSpec | null): ActionSpec | null => (state.xruv.hasAdminToken === true ? make() : null)
const hasKey = (state: State) => state.snapshot?.hasNostrKey === true
const MAKES_KEY = 'makes ~/.ruflo/nostr.key first if it is missing (your federation identity, kept 0600, never shown)'

export const XRUV: readonly XEntry[] = [
  {
    id: 'x-join', group: 'identity', name: 'JOIN', about: 'register your own key (NIP-98); an invite code is optional', label: 'join x.ruv.io with your own key', kind: 'write', takes: 'optional invite code: v2.…',
    spec: (state, text) => {
      const code = text.trim()

      if (code !== '' && !INVITE_RE.test(code)) return null

      return spec(state, 'x-join', {
        label: `join x.ruv.io with your own key${code === '' ? '' : ' and an invite'}`,
        args: exec('x_federation_join', code === '' ? {} : { code }),
        expect: 'membership verified over NIP-42',
        shows: `ruflo mcp exec -t x_federation_join${code === '' ? '' : ' (with your invite code, masked here)'}`,
        note: `network: checks membership on ${RELAY}, and only if you are not a member signs POST x.ruv.io/api/registration (or the invite claim) with your key; ${MAKES_KEY}`,
        timeoutMs: 90_000,
      })
    },
    why: () => 'an invite code looks like v2.<token>; leave it empty to join with no invite',
  },
  { id: 'x-unregister', group: 'identity', name: 'UNREGISTER', about: 'no leave endpoint on the gateway: nothing to press', label: 'unregister from x.ruv.io (not offered yet)', kind: 'write', spec: () => null, why: () => UNREGISTER_WHY },
  {
    id: 'x-bbs-identity', group: 'identity', name: 'BBS IDENTITY', about: 'this project’s agentbbs node id (Ed25519), not the Nostr key', label: 'show the agentbbs node identity', kind: 'write',
    spec: state => spec(state, 'x-bbs-identity', { label: 'show the agentbbs node identity (federation_bbs_identity)', args: exec('federation_bbs_identity', {}), expect: 'the node id and public key', note: 'local, $0: creates .agentbbs/node-identity.json here on the first call; the private key is never returned' }),
    why: () => '',
  },
  { id: 'x-registry', group: 'live', name: 'REGISTRY', about: 'relay, NIP-42 tag, gateway key, join steps, rooms', label: 'fetch the x.ruv.io registry', kind: 'read', spec: read('x-registry', 'fetch the x.ruv.io registry', registryProbe.args, 'registry'), why: () => '' },
  { id: 'x-roster', group: 'live', name: 'ROSTER', about: 'who is announcing on the relay now', label: 'fetch who is on the x.ruv.io swarm (roster)', kind: 'read', spec: read('x-roster', 'fetch the x.ruv.io roster', rosterProbe.args, 'roster'), why: () => '' },
  { id: 'x-claims', group: 'live', name: 'WORK CLAIMS', about: 'one owner per resource, TTLs and handoffs applied', label: 'fetch the x.ruv.io work-claims board', kind: 'read', spec: read('x-claims', 'fetch the x.ruv.io work-claims board', workClaimsProbe.args, 'x-claims'), why: () => '' },
  { id: 'x-sync', group: 'live', name: 'SYNC', about: 'the last hour of signed swarm messages, 20 at most', label: 'fetch recent x.ruv.io swarm messages (sync, 20)', kind: 'read', spec: read('x-sync', 'fetch recent x.ruv.io swarm messages', swarmProbe.args, 'x-sync'), why: () => '' },
  {
    id: 'x-channels', group: 'channels', name: 'LIST', about: 'the channels whose keys this machine holds (local)', label: 'list the x.ruv.io channels held here', kind: 'read',
    spec: state => spec(state, 'x-channels', { label: 'list the x.ruv.io channels held here', args: channelsProbe.args, expect: 'its output on the board', isReadOnly: true }, 'channels'),
    why: () => '',
  },
  {
    id: 'x-read', group: 'channels', name: 'READ', about: 'a channel’s last hour, decrypted where you hold its key', label: 'read an x.ruv.io channel', kind: 'read', takes: 'pub:<name>, prv:<16 hex> or a name',
    spec: (state, text) => {
      const channel = channelIdOf(text)

      if (channel === null) return null

      return spec(state, 'x-read', {
        label: `read x.ruv.io channel ${channel}`,
        args: exec('x_federation_channel_read', { channel, limit: 20 }),
        expect: 'its messages on the board',
        timeoutMs: 60_000,
        // The read signs NIP-42 with your key; with none yet, the CLI would make one, so that first read asks.
        ...(hasKey(state) ? { isReadOnly: true, declared: 'network' as const } : { note: `network: reads ${RELAY}; ${MAKES_KEY}` }),
      })
    },
    why: () => 'name a channel: pub:<name>, prv:<16 hex>, or a bare name for its public channel',
  },
  {
    id: 'x-publish', group: 'channels', name: 'PUBLISH', about: 'a message signed with your own key', label: 'publish to an x.ruv.io channel as yourself', kind: 'write', takes: '<channel> Type: text (or a JSON object)',
    spec: (state, text) => {
      const arg = publishArg(text)

      if (arg === null) return null

      const isPrivate = arg.channel.startsWith('prv:')

      return spec(state, 'x-publish', {
        label: `publish ${arg.msgType} to ${arg.channel} as yourself`,
        args: exec('x_federation_channel_publish', arg),
        expect: 'an event id from the relay',
        note: `network: signs with your own key and sends to ${RELAY}; ${isPrivate ? 'encrypted under the channel key, so only its members can read it' : 'a pub: channel is plaintext to every relay member'}. Never put secrets in it. ${hasKey(state) ? '' : MAKES_KEY}`.trim(),
        timeoutMs: 60_000,
      })
    },
    why: () => 'type "<channel> Type: text", e.g. "pub:general Status: online"; the type is letters, digits, _ or -',
  },
  {
    id: 'x-create', group: 'channels', name: 'CREATE', about: 'pub: a named room; prv: a key only you hold', label: 'create an x.ruv.io channel', kind: 'write', takes: '<name> [public|private]',
    spec: (state, text) => {
      const arg = createArg(text)

      return arg === null
        ? null
        : spec(state, 'x-create', {
            label: `create ${arg.visibility} channel ${arg.name}`,
            args: exec('x_federation_channel_create', arg),
            expect: 'the channel id',
            note: arg.visibility === 'private' ? 'local, nothing sent: writes a new channel key to ~/.ruflo/channels.json (0600); lose the file and the channel is gone' : 'local, nothing sent or written: names the public channel pub:<name>; publishing to it is what reaches the relay',
          })
    },
    why: () => 'type "<name> [public|private]": a name is a-z, 0-9, ., _ or -, up to 64',
  },
  {
    id: 'x-grant', group: 'channels', name: 'GRANT', about: 'seal a private channel’s key to a member’s pubkey', label: 'grant a member a private x.ruv.io channel', kind: 'write', takes: 'prv:<16 hex> <64-hex pubkey>',
    spec: (state, text) => {
      const arg = grantArg(text)

      return arg === null
        ? null
        : spec(state, 'x-grant', {
            label: `grant ${arg.channel} to ${arg.pubkey.slice(0, 12)}…`,
            args: exec('x_federation_channel_grant', arg),
            expect: 'a ChannelGrant event id',
            note: `network: publishes a grant sealed to that pubkey on ${RELAY}; grants cannot be revoked (rotate the channel to remove someone)`,
            timeoutMs: 60_000,
          })
    },
    why: () => 'type "prv:<16 hex> <64-hex pubkey>": only a private channel you hold has a key to grant',
  },
  {
    id: 'x-accept', group: 'channels', name: 'ACCEPT', about: 'open grants sealed to your key, keep their keys', label: 'accept x.ruv.io channel grants', kind: 'write',
    spec: state => spec(state, 'x-accept', { label: 'accept x.ruv.io channel grants sealed to your key', args: exec('x_federation_channel_accept', {}), expect: 'the channels accepted', note: `network: reads the last 7 days of grants on ${RELAY} and stores their keys in ~/.ruflo/channels.json; ${MAKES_KEY}`, timeoutMs: 60_000 }),
    why: () => '',
  },
  {
    id: 'x-bbs-peers', group: 'agentbbs', name: 'PEERS', about: 'the pinned peers and when each last synced', label: 'list the pinned agentbbs peers', kind: 'read',
    spec: state => spec(state, 'x-bbs-peers', { label: 'list the pinned agentbbs peers (federation_bbs_peers)', args: exec('federation_bbs_peers', {}), expect: 'the peers and their keys', isReadOnly: true, timeoutMs: 30_000 }),
    why: () => '',
  },
  {
    id: 'x-bbs-register', group: 'agentbbs', name: 'ROOM', about: 'a room label like #sales becomes a stable room id', label: 'register an agentbbs room', kind: 'write', takes: '#sales',
    spec: (state, text) => {
      const roomLabel = text.trim()

      return BBS_LABEL_RE.test(roomLabel) ? spec(state, 'x-bbs-register', { label: `register the agentbbs room ${roomLabel}`, args: exec('federation_bbs_register', { roomLabel }), expect: 'the room id', note: 'local, $0: writes room state under .agentbbs in this project' }) : null
    },
    why: () => 'type a room label such as "#sales": letters, digits and _ . - : / @ # only, 64 characters at most',
  },
  {
    id: 'x-bbs-publish', group: 'agentbbs', name: 'PUBLISH', about: 'append a typed event to a room log', label: 'publish an envelope to an agentbbs room', kind: 'write', takes: '<roomId> Type: text',
    spec: (state, text) => {
      const arg = bbsPublishArg(text)

      return arg === null ? null : spec(state, 'x-bbs-publish', { label: `publish ${arg.msgType} to room ${arg.roomId}`, args: exec('federation_bbs_publish', arg), expect: 'an envelope id and its sequence number', note: 'local, $0: appends one signed envelope to the room log; peers only see it after a sync' })
    },
    why: () => 'type "<roomId> Type: text", e.g. "abc123 Status: build green" (the room id comes from ROOM)',
  },
  {
    id: 'x-bbs-watch', group: 'agentbbs', name: 'WATCH', about: 'the latest envelopes in a room', label: 'read recent agentbbs envelopes', kind: 'read', takes: '<roomId> [limit]',
    spec: (state, text) => {
      const arg = bbsWatchArg(text)

      return arg === null ? null : spec(state, 'x-bbs-watch', { label: `read the last ${arg.limit} envelopes of room ${arg.roomId}`, args: exec('federation_bbs_watch', arg), expect: 'the envelopes, oldest first', isReadOnly: true, timeoutMs: 30_000 })
    },
    why: () => 'type "<roomId> [limit]": limit is 1 to 500, 20 when left out',
  },
  {
    id: 'x-bbs-peer-add', group: 'agentbbs', name: 'PIN PEER', about: 'trust one peer by node id, URL and public key', label: 'pin an agentbbs peer', kind: 'write', takes: '<nodeId> <url> <pubkey> [label]',
    spec: (state, text) => {
      const arg = bbsPeerArg(text)

      return arg === null ? null : spec(state, 'x-bbs-peer-add', { label: `pin peer ${arg.nodeId} at ${arg.url}`, args: exec('federation_bbs_peer_add', arg), expect: 'the peer pinned', note: 'local, $0: records the key you typed; every envelope from this peer is verified against it, and a different key for a known node is refused' })
    },
    why: () => 'type "<16-hex nodeId> <http(s) url> <64-hex public key> [label]": take all three from the peer own BBS IDENTITY, not from an envelope',
  },
  {
    id: 'x-bbs-sync', group: 'agentbbs', name: 'SYNC ROOM', about: 'pull a room from pinned peers and merge what verifies', label: 'sync an agentbbs room from its peers', kind: 'write', takes: '<roomId> [nodeId]',
    spec: (state, text) => {
      const arg = bbsSyncArg(text)

      return arg === null ? null : spec(state, 'x-bbs-sync', { label: `sync room ${arg.roomId} from ${arg.nodeId ?? 'every pinned peer'}`, args: exec('federation_bbs_sync', arg), expect: 'envelopes merged and dropped, per peer', note: 'network: fetches from the pinned peer URLs only; unsigned, misattributed or oversize envelopes are dropped and counted', timeoutMs: 90_000 })
    },
    why: () => 'type "<roomId> [nodeId]": pin a peer first (PIN PEER); with no node id every pinned peer is asked',
  },
  {
    id: 'x-bbs-serve', group: 'agentbbs', name: 'SERVE', about: 'the read-only endpoint peers pull from: run it in a terminal', label: 'serve this node to peers (in the terminal)', kind: 'write',
    // A server that stays up for hours does not fit a one-shot board run, and bindHost decides who can reach it: that is typed where the person sees it.
    spec: () => null,
    why: () => 'serve keeps running and binds 127.0.0.1 unless you name a tailnet bindHost: ▸ type puts the command in the terminal (i) for you to run',
  },
  {
    id: 'x-hub', group: 'admin', name: 'HUB PUBLISH', about: 'a broadcast signed as the gateway, not as you', label: 'publish to the x.ruv.io swarm as the gateway (admin)', kind: 'admin', takes: 'Type: text (or a JSON object)',
    spec: (state, text) =>
      admin(state, () => {
        const arg = messageArg(text)

        return arg === null
          ? null
          : spec(state, 'x-hub', { label: `publish ${arg.msgType} as the x.ruv.io gateway`, args: exec('x_federation_publish', arg), expect: 'an event id', note: 'ADMIN, network: signed as the gateway with RUFLO_X_ADMIN_TOKEN from the environment (never an argument); attributed to the hub, not to you', timeoutMs: 60_000 })
      }),
    why: state => (state.xruv.hasAdminToken === true ? 'type "Type: text", e.g. "Status: maintenance at 18:00"' : ADMIN_OFF),
  },
  {
    id: 'x-admit', group: 'admin', name: 'ADMIT', about: 'NIP-43 membership for a pubkey, no invite', label: 'admit a pubkey to the x.ruv.io relay (admin)', kind: 'admin', takes: '<64-hex pubkey> [member|admin]',
    spec: (state, text) =>
      admin(state, () => {
        const arg = admitArg(text)

        return arg === null
          ? null
          : spec(state, 'x-admit', { label: `admit ${arg.pubkey.slice(0, 12)}… as ${arg.role}`, args: exec('x_federation_admit', arg), expect: 'the membership event', note: 'ADMIN, network: grants that key relay access with RUFLO_X_ADMIN_TOKEN from the environment; there is no revoke tool', timeoutMs: 60_000 })
      }),
    why: state => (state.xruv.hasAdminToken === true ? 'type "<64-hex pubkey> [member|admin]"; a malformed key must be re-reported, never fixed up' : ADMIN_OFF),
  },
  {
    id: 'x-invite', group: 'admin', name: 'INVITES', about: 'a use-limited code: mint it in the terminal', label: 'mint an x.ruv.io invite code (admin, in the terminal)', kind: 'admin',
    // The code is a bearer secret: the board never holds it. It is minted where only the person reads it.
    spec: () => null,
    why: state => (state.xruv.hasAdminToken === true ? 'an invite code is a bearer secret, so the console never shows one: ▸ type puts "ruflo federation invite" in the terminal (i) for you to run' : ADMIN_OFF),
  },
]

/** What the SERVE row types into the terminal: loopback by default; a tailnet bindHost is the person's to add. */
export const BBS_SERVE_COMMAND = 'mcp exec -t federation_bbs_serve -p \'{"port":7777}\''

/** What the INVITES row types into the terminal: the code then shows only in its scrollback, never in an answer. */
export const INVITE_COMMAND = 'federation invite --ttl 604800 --uses 25'

/** The headless answer for a board run (`/ruflo run x-roster`): its outcome line, its note, then what it printed. */
export function xruvAnswer(state: State, id: string | null, sinceMs: number): string | null {
  const result = state.xruv.result

  if (result === null || result.atMs < sinceMs || (id !== null && result.id !== id)) return null

  return [`${result.ok ? '✓' : '✗'} ${result.label} · exit ${result.exitCode ?? 'n/a'}${result.note !== undefined ? ` · ${result.note}` : ''}`, ...result.lines.map(line => `  ${line}`)].join('\n')
}
