/**
 * The x.ruv.io board's two reads beyond the registry and the roster: the work-claims board and the recent swarm
 * messages. Both reach wss://relay.ruv.io through the gateway, so they run only with `federationNetwork` on, or once on
 * the board's ▸ fetch (the click is the consent). What they return is third parties' text, wrapped by the gateway in
 * its provenance envelope: every string is capped and stripped of control characters, and drawn as data.
 */
import { jsonAfter, type Probe } from './cli'
import { msOf, numberOf, plain, recordOf, stringOf } from './parse'

const exec = (tool: string, params: Record<string, unknown>) => ['mcp', 'exec', '-t', tool, '-p', JSON.stringify(params)] as const

/** A pubkey as the board shows it: its first twelve hex digits, never the whole of it. */
export const shortKey = (value: unknown): string | undefined => {
  const key = stringOf(value, 64)

  return key === undefined ? undefined : key.length > 12 ? `${key.slice(0, 12)}…` : key
}

/** The gateway's envelope (`untrusted`, `relay`, `retrievedAt`, `data`) as its data, keeping the relay and the date. */
export function envelopeOf(stdout: string): { data: unknown; relay?: string; atMs?: number } | null {
  const value = recordOf(jsonAfter(stdout))

  if (value === null) return null

  const relay = stringOf(value.relay, 60)
  const atMs = msOf(value.retrievedAt)

  return { data: value.untrusted === true ? value.data : value, ...(relay !== undefined && { relay }), ...(atMs !== undefined && { atMs }) }
}

export type WorkClaims = { claims: { resource: string; owner: string; from?: string; expiresAtMs?: number }[]; relay?: string; atMs?: number }

/** The claims board: one owner per resource, TTLs and handoffs already applied by the gateway. */
export const workClaimsProbe: Probe<WorkClaims> = {
  id: 'x-claims',
  args: exec('x_federation_claims', {}),
  views: ['xruv'],
  everyMs: 120_000,
  timeoutMs: 45_000,
  isNetwork: true,
  parse: stdout => {
    const found = envelopeOf(stdout)
    const board = recordOf(found?.data)

    if (found === null || board === null) return null

    return {
      claims: Object.entries(board)
        .slice(0, 40)
        .flatMap(([resource, entry]) => {
          const claim = recordOf(entry)
          const owner = shortKey(claim?.owner)
          const from = stringOf(claim?.from, 32)
          const expiresAtMs = msOf(claim?.expiresAt)

          return claim === null || owner === undefined ? [] : [{ resource: plain(resource, 60), owner, ...(from !== undefined && { from }), ...(expiresAtMs !== undefined && { expiresAtMs }) }]
        }),
      ...(found.relay !== undefined && { relay: found.relay }),
      ...(found.atMs !== undefined && { atMs: found.atMs }),
    }
  },
}

export type SwarmMessage = { type: string; from: string; text?: string; atMs?: number }
export type SwarmMessages = { messages: SwarmMessage[]; relay?: string; atMs?: number }

const SAYS = ['text', 'message', 'summary', 'status', 'title', 'task', 'result', 'note'] as const

/** One relay message as a line's worth: its type, who signed it, and the first field that says something. */
export function messageOf(entry: unknown): SwarmMessage | null {
  const body = recordOf(entry)
  const from = shortKey(body?.pubkey) ?? stringOf(body?.from, 24)

  if (body === null || from === undefined) return null

  const said = SAYS.map(key => stringOf(body[key], 140)).find(value => value !== undefined)
  const seconds = numberOf(body.created_at)
  const atMs = seconds !== undefined ? seconds * 1000 : msOf(body.ts)

  return { type: stringOf(body.type, 24) ?? 'message', from, ...(said !== undefined && { text: said }), ...(atMs !== undefined && { atMs }) }
}

/** The last hour of signed swarm messages, twenty at most, newest first. */
export const swarmProbe: Probe<SwarmMessages> = {
  id: 'x-sync',
  args: exec('x_federation_sync', { limit: 20 }),
  views: ['xruv'],
  everyMs: 120_000,
  timeoutMs: 45_000,
  isNetwork: true,
  parse: stdout => {
    const found = envelopeOf(stdout)
    const list = recordOf(found?.data)?.messages

    if (found === null || !Array.isArray(list)) return null

    return {
      messages: list
        .slice(0, 20)
        .flatMap(entry => messageOf(entry) ?? [])
        .sort((a, b) => (b.atMs ?? 0) - (a.atMs ?? 0)),
      ...(found.relay !== undefined && { relay: found.relay }),
      ...(found.atMs !== undefined && { atMs: found.atMs }),
    }
  },
}

/** The board's network probes, run by the controller beside PROBES and gated by the same option. */
export const X_PROBES = [workClaimsProbe, swarmProbe] as const
