/**
 * Who the console can talk to (ADR-465). Pure: what the session and the stores hold, and what the person configured, in; a list of targets
 * out. Every target declares its transport, WHAT LEAVES THE MACHINE, its cost class and HOW A REPLY ARRIVES, so the composer and the confirm
 * card say it before anything is sent. A target that is not configured is not listed as if it were: an absent one is an honest empty state.
 *
 * The configuration is one option string, entries separated by `;` (nothing in it is a secret: a key is named by its environment variable):
 *   endpoint:<name>=<base-url>|<KEY_ENV>|<model>    an OpenAI-compatible chat endpoint (OpenRouter, the meta-llm gateway, a local server)
 *   bbs:<room>                                       an agentbbs room            (federation_bbs_publish / federation_bbs_watch)
 *   x:<channel>                                      an x-federation channel     (pub:<name> or prv:<16 hex>)
 * OpenRouter is always offered as `openrouter` (https://openrouter.ai/api/v1, OPENROUTER_API_KEY) while no entry of that name replaces it.
 */
export type TransportKind = 'prompt' | 'send-message' | 'hive' | 'task' | 'bbs' | 'x-channel' | 'peer' | 'codex' | 'http'
export type Leaves = 'machine' | 'tailnet' | 'internet'
export type CostClass = 'session-turn' | 'free' | 'metered' | 'peer-session' | 'local-cli'
export type Arrival = 'turn' | 'immediate' | 'polled' | 'none'

export type Target = {
  id: string
  label: string
  transport: TransportKind
  /** What leaves this machine, in words. */
  leavesText: string
  leaves: Leaves
  cost: CostClass
  costText: string
  arrival: Arrival
  arrivalText: string
  /** Transport details: an agent id, a peer host, a channel id, an endpoint's name. */
  ref: string
}

/** The one option this feature reads, checked the way ADR-462's guard options are: a non-string is the default (empty), and the text is capped. */
export type ConvoOptions = { convoTargets: string }

export const convoOptionsOf = (raw: unknown): ConvoOptions => {
  const value = (typeof raw === 'object' && raw !== null ? (raw as Record<string, unknown>).convoTargets : undefined) as unknown

  return { convoTargets: typeof value === 'string' ? value.slice(0, 2000) : '' }
}

export type Endpoint = { name: string; baseUrl: string; keyEnv: string; model: string }

export type Config = { endpoints: Endpoint[]; rooms: string[]; channels: string[]; errors: string[] }

export const OPENROUTER: Endpoint = { name: 'openrouter', baseUrl: 'https://openrouter.ai/api/v1', keyEnv: 'OPENROUTER_API_KEY', model: 'openrouter/auto' }

const NAME = /^[a-z][a-z0-9-]{0,23}$/
const ENV_NAME = /^[A-Z_][A-Z0-9_]{0,63}$/
/** Variables that hold credentials for something other than a model endpoint: naming one would send it to whatever host the URL names. */
const NOT_A_MODEL_KEY = /^(AWS_|GH_|GITHUB_|NPM_|SSH_|KUBE|DOCKER|GCLOUD|GOOGLE_APPLICATION|CLOUDFLARE_|FLY_|TAILSCALE_|NPM)|PASSWORD|PRIVATE|SECRET_ACCESS|PASSPHRASE|^HOME$|^PATH$/
const ROOM = /^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/
const CHANNEL = /^(pub:[a-z0-9][a-z0-9._-]{0,63}|prv:[0-9a-f]{16})$/
const MODEL = /^[A-Za-z0-9][A-Za-z0-9._:/@+-]{0,80}$/
export const HOST = /^[A-Za-z0-9][A-Za-z0-9._-]{0,62}$/

const isTailnetIp = (host: string): boolean => {
  const m = /^100\.(\d{1,3})\.\d{1,3}\.\d{1,3}$/.exec(host)

  return m !== null && Number(m[1]) >= 64 && Number(m[1]) <= 127
}

/** Addresses a request must never be aimed at, whatever the scheme: link-local (the cloud metadata service), the unspecified address, multicast and every IPv6 literal but ::1 (an IPv4-mapped one reaches the same). */
const forbiddenHost = (host: string): boolean => {
  const h = host.toLowerCase().replace(/\.$/, '')

  if (h.startsWith('[')) return h !== '[::1]'

  return /^169\.254\./.test(h) || /^0\./.test(h) || /^(22[4-9]|23\d|24\d|25[0-5])\./.test(h) || h === 'metadata' || h === 'metadata.google.internal' || h.endsWith('.internal') || h.endsWith('.local') || h === 'instance-data'
}

/** True for an http(s) base URL with no credentials, query or fragment in it, not aimed at a link-local, metadata or IPv6-literal host, and only https unless it is this machine or the tailnet (100.64/10, *.ts.net, a bare MagicDNS name). */
export function isBaseUrl(value: string): boolean {
  let url: URL

  try {
    url = new URL(value)
  } catch {
    return false
  }

  if (url.username !== '' || url.password !== '' || url.search !== '' || url.hash !== '') return false
  if (url.protocol !== 'https:' && url.protocol !== 'http:') return false
  if (forbiddenHost(url.hostname)) return false
  if (url.protocol === 'https:') return true

  return /^(localhost|127\.0\.0\.1|\[::1\]|[a-z][a-z0-9-]*|[a-z0-9.-]+\.ts\.net)$/i.test(url.hostname) || isTailnetIp(url.hostname)
}

/** The option string as targets: each bad entry is dropped with a reason (never thrown), so one typo does not hide the rest. */
export function parseConfig(value: string | undefined): Config {
  const config: Config = { endpoints: [], rooms: [], channels: [], errors: [] }

  for (const entry of (value ?? '').split(';').map(part => part.trim()).filter(part => part !== '').slice(0, 24)) {
    const at = entry.indexOf(':')
    const kind = entry.slice(0, at)
    const rest = entry.slice(at + 1)

    if (kind === 'endpoint') {
      const eq = rest.indexOf('=')
      const [baseUrl = '', keyEnv = '', model = ''] = rest.slice(eq + 1).split('|').map(part => part.trim())
      const name = rest.slice(0, Math.max(eq, 0)).trim()

      if (eq < 0 || !NAME.test(name)) config.errors.push(`endpoint "${entry.slice(0, 30)}": the name is a lowercase word (endpoint:<name>=<base-url>|<KEY_ENV>|<model>)`)
      else if (!isBaseUrl(baseUrl)) config.errors.push(`endpoint ${name}: the base URL must be https (or http to a local or tailnet address), with no credentials, query or fragment`)
      else if (keyEnv !== 'NONE' && !ENV_NAME.test(keyEnv)) config.errors.push(`endpoint ${name}: the key is named by an environment variable (UPPER_SNAKE), or NONE; a key itself is never accepted here`)
      else if (keyEnv !== 'NONE' && NOT_A_MODEL_KEY.test(keyEnv)) config.errors.push(`endpoint ${name}: ${keyEnv} is not a model key; an endpoint is only given the key of a model provider`)
      else if (!MODEL.test(model)) config.errors.push(`endpoint ${name}: no model named`)
      else if (config.endpoints.some(held => held.name === name)) config.errors.push(`endpoint ${name}: named twice`)
      else config.endpoints.push({ name, baseUrl: baseUrl.replace(/\/+$/, ''), keyEnv, model })
    } else if (kind === 'bbs' && ROOM.test(rest)) config.rooms.push(rest)
    else if (kind === 'x' && CHANNEL.test(rest)) config.channels.push(rest)
    else config.errors.push(`"${entry.slice(0, 40)}" is not endpoint:, bbs: or x: with a valid value`)
  }

  return config
}

/** The endpoints with OpenRouter defaulted in, unless the person named their own `openrouter`. */
export const endpointsOf = (config: Config): Endpoint[] => (config.endpoints.some(held => held.name === OPENROUTER.name) ? config.endpoints : [...config.endpoints, OPENROUTER])

export type PeerRef = { host: string; trusted: boolean }

/** The peers in the federation helper's `peers.json` (`peers[].host` and `.trusted`); anything else is dropped. */
export function peersOf(text: string | null): PeerRef[] {
  if (text === null) return []

  try {
    const list = (JSON.parse(text) as { peers?: unknown }).peers

    return Array.isArray(list) ? list.flatMap(item => (typeof item === 'object' && item !== null && typeof (item as { host?: unknown }).host === 'string' && HOST.test((item as { host: string }).host) ? [{ host: (item as { host: string }).host, trusted: (item as { trusted?: unknown }).trusted === true }] : [])).slice(0, 40) : []
  } catch {
    return []
  }
}

export type AgentRef = { id: string; name: string }

export type TargetInput = { agents: readonly AgentRef[]; peers: readonly PeerRef[]; config: Config; hasHive: boolean; hasCodex: boolean }

const mention = (value: string): string => value.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 24)

/** Every target the console can address now, in a stable order: the main session, then agents, the hive, channels, peers, Codex and endpoints. */
export function targetsOf(input: TargetInput): Target[] {
  const out: Target[] = [
    { id: 'claude', label: 'Claude (this session)', transport: 'prompt', leaves: 'machine', leavesText: 'nothing beyond what a turn of this session sends to the model', cost: 'session-turn', costText: 'a visible turn of this session, billed as any turn is', arrival: 'turn', arrivalText: 'its answer is the next turn in the transcript, not captured here', ref: 'main' },
  ]

  for (const agent of input.agents.slice(0, 20)) {
    const id = mention(agent.name)

    if (id !== '' && !out.some(held => held.id === id)) out.push({ id, label: `agent ${agent.name}`, transport: 'send-message', leaves: 'machine', leavesText: 'nothing: queued inside this session', cost: 'session-turn', costText: 'the agent\'s own next turn', arrival: 'none', arrivalText: 'in its inbox at once, read when its current turn ends (minutes into a long turn); its answer is not routed back here', ref: agent.id })
  }

  if (input.hasHive) out.push({ id: 'hive', label: 'ruflo hive-mind', transport: 'hive', leaves: 'machine', leavesText: 'nothing: written to the hive\'s shared memory', cost: 'free', costText: 'no model call', arrival: 'none', arrivalText: 'appended to the hive memory; a worker sees it only if its own turn reads it (a proposal needs votes)', ref: 'hive' })

  if (input.hasHive) out.push({ id: 'hive-propose', label: 'ruflo hive consensus (a proposal)', transport: 'hive', leaves: 'machine', leavesText: 'nothing: a proposal in the hive state', cost: 'free', costText: 'no model call', arrival: 'none', arrivalText: 'workers vote on it; a pass binds no agent', ref: 'propose' })

  out.push({ id: 'task', label: 'ruflo task note', transport: 'task', leaves: 'machine', leavesText: 'nothing: written to the task store', cost: 'free', costText: 'no model call', arrival: 'none', arrivalText: 'the task record changes; an agent sees it only when it reads the task', ref: 'task' })

  for (const room of input.config.rooms) out.push({ id: `bbs-${mention(room)}`, label: `agentbbs room ${room}`, transport: 'bbs', leaves: 'machine', leavesText: 'a message in the room log on this machine, and to its peers if the room syncs', cost: 'free', costText: 'no model call', arrival: 'polled', arrivalText: 'read back with federation_bbs_watch while the thread is open', ref: room })

  for (const channel of input.config.channels) out.push({ id: `x-${mention(channel.replace(':', '-'))}`, label: `x channel ${channel}`, transport: 'x-channel', leaves: 'internet', leavesText: `a message to the relay (${channel.startsWith('prv:') ? 'encrypted under the channel key' : 'PUBLIC: anyone can read it'}) signed with your key`, cost: 'free', costText: 'no model call', arrival: 'polled', arrivalText: 'read back with x_federation_channel_read while the thread is open', ref: channel })

  for (const peer of input.peers) out.push({ id: `peer-${mention(peer.host)}`, label: `peer ${peer.host}${peer.trusted ? '' : ' (not trusted: needs your confirm)'}`, transport: 'peer', leaves: 'tailnet', leavesText: `the prompt, over ssh to ${peer.host}, run as \`claude -p\` there with that machine's own permissions and files`, cost: 'peer-session', costText: `a headless Claude run on ${peer.host}, billed to that machine's login`, arrival: 'immediate', arrivalText: 'the peer\'s stdout comes back when it finishes (up to 10 minutes)', ref: peer.host })

  if (input.hasCodex) out.push({ id: 'codex', label: 'Codex (codex exec, read-only)', transport: 'codex', leaves: 'internet', leavesText: 'the prompt, to OpenAI via the codex CLI, run in a read-only sandbox here', cost: 'local-cli', costText: 'the codex CLI\'s own login; its usage is not read here', arrival: 'immediate', arrivalText: 'its final message comes back when it finishes (up to 5 minutes)', ref: 'codex' })

  for (const endpoint of endpointsOf(input.config)) out.push({ id: endpoint.name, label: `${endpoint.name} (${endpoint.model})`, transport: 'http', leaves: endpoint.baseUrl.startsWith('https://') ? 'internet' : 'machine', leavesText: `the prompt, to ${new URL(endpoint.baseUrl).host}${endpoint.keyEnv === 'NONE' ? ' with no key' : `, with the key from $${endpoint.keyEnv} (never shown or stored)`}`, cost: 'metered', costText: 'metered by the provider; the tokens it reports are shown, a price is not guessed', arrival: 'immediate', arrivalText: 'the answer comes back in the same request', ref: endpoint.name })

  return out
}

export type Mentions = { targets: Target[]; unknown: string[]; body: string }

/** `@name` words at the start or after a space pick targets (`@all` picks the agents, the hive and the rooms: what stays on this machine; anything that leaves it is named); the rest is the body. */
export function parseMentions(text: string, targets: readonly Target[]): Mentions {
  const picked: Target[] = []
  const unknown: string[] = []
  const kept: string[] = []

  for (const word of text.trim().split(/\s+/)) {
    const match = /^@([A-Za-z0-9][A-Za-z0-9-]{0,31})$/.exec(word)

    if (match === null) {
      kept.push(word)
      continue
    }

    const name = (match[1] ?? '').toLowerCase()
    const found = targets.find(target => target.id === name)

    if (name === 'all') {
      for (const target of targets.filter(held => held.leaves === 'machine' && ['send-message', 'hive', 'bbs'].includes(held.transport) && held.ref !== 'propose')) if (!picked.includes(target)) picked.push(target)

      continue
    }

    if (found !== undefined) {
      if (!picked.includes(found)) picked.push(found)
    } else unknown.push(name)
  }

  return { targets: picked.slice(0, MAX_FANOUT), unknown, body: kept.join(' ').trim() }
}

/** At most this many targets get one question: a longer list is cut, and the composer says so. */
export const MAX_FANOUT = 6
