/**
 * The x.ruv.io board's pure parts under vitest: the validators lifted from the CLI's own checks, the payloads the
 * console builds, what reads and what asks, the two network probes and their gate, and the output readers (invite codes
 * masked). Run with
 *   npx vitest run plugins/ruflo-console/tests/xruv.spec.ts
 */
import { describe, expect, it } from 'vitest'

import { PROBES } from '../hooks/data/cli'
import { envelopeOf, messageOf, swarmProbe, workClaimsProbe, X_PROBES } from '../hooks/data/xruv'
import { newState } from '../hooks/state'
import { admitArg, channelIdOf, createArg, grantArg, isPubkey, maskInvites, messageArg, ownPubkeyOf, payloadOf, publishArg, UNREGISTER_WHY, XRUV, xruvAnswer, xruvLines } from '../hooks/xruv'

const KEY = 'c0ffee'.repeat(10) + 'beef'
const entry = (id: string) => {
  const found = XRUV.find(candidate => candidate.id === id)

  if (found === undefined) throw new Error(`no entry ${id}`)

  return found
}
const params = (args: readonly string[] | undefined) => JSON.parse(args?.[5] ?? 'null') as unknown

describe('validators', () => {
  it('a pubkey is exactly 64 hex digits', () => {
    expect(isPubkey(KEY)).toBe(true)
    expect(isPubkey(KEY.toUpperCase())).toBe(true)
    expect(isPubkey(KEY.slice(1))).toBe(false)
    expect(isPubkey(`${KEY}0`)).toBe(false)
    expect(isPubkey(`npub1${KEY.slice(5)}`)).toBe(false)
  })

  it('channel ids are pub:<name> or prv:<16 hex>; a bare name is its public channel', () => {
    expect(channelIdOf('pub:general')).toBe('pub:general')
    expect(channelIdOf('General')).toBe('pub:general')
    expect(channelIdOf('prv:0123456789abcdef')).toBe('prv:0123456789abcdef')
    expect(channelIdOf('prv:0123456789abcde')).toBeNull()
    expect(channelIdOf('prv:secret-room')).toBeNull()
    expect(channelIdOf('pub:-flag')).toBeNull()
    expect(channelIdOf('--channel')).toBeNull()
    expect(channelIdOf('')).toBeNull()
  })

  it('a payload is a JSON object as typed, else { text }; broken JSON and oversize bodies are refused', () => {
    expect(payloadOf('online and idle')).toEqual({ text: 'online and idle' })
    expect(payloadOf('{"task":"review #42","eta":5}')).toEqual({ task: 'review #42', eta: 5 })
    expect(payloadOf('{"broken"')).toBeNull()
    expect(payloadOf('[1,2]')).toEqual({ text: '[1,2]' })
    expect(payloadOf(`{"text":"${'x'.repeat(8_100)}"}`)).toBeNull()
    expect(payloadOf('   ')).toBeNull()
    expect(payloadOf('a\u0007b‮')).toEqual({ text: 'a b' })
  })

  it('messages, publishes, creates, grants and admits parse only in their documented shapes', () => {
    expect(messageArg('Task: review #42')).toEqual({ msgType: 'Task', payload: { text: 'review #42' } })
    expect(messageArg('just saying hi')).toEqual({ msgType: 'Status', payload: { text: 'just saying hi' } })
    expect(publishArg('pub:general Result: {"ok":true}')).toEqual({ channel: 'pub:general', msgType: 'Result', payload: { ok: true } })
    expect(publishArg('general online')).toEqual({ channel: 'pub:general', msgType: 'Status', payload: { text: 'online' } })
    expect(publishArg('pub:general')).toBeNull()
    expect(publishArg('not/a/channel hi')).toBeNull()
    expect(createArg('ops private')).toEqual({ name: 'ops', visibility: 'private' })
    expect(createArg('ops')).toEqual({ name: 'ops', visibility: 'public' })
    expect(createArg('ops secret')).toBeNull()
    expect(createArg('Ops Room')).toBeNull()
    expect(grantArg(`prv:0123456789abcdef ${KEY.toUpperCase()}`)).toEqual({ channel: 'prv:0123456789abcdef', pubkey: KEY })
    expect(grantArg(`pub:general ${KEY}`)).toBeNull()
    expect(grantArg('prv:0123456789abcdef short')).toBeNull()
    expect(admitArg(KEY)).toEqual({ pubkey: KEY, role: 'member' })
    expect(admitArg(`${KEY} owner`)).toBeNull()
  })
})

describe('the board catalog', () => {
  it('reads run at once, writes and admin rows ask, and every argv is one mcp exec with one JSON argument', () => {
    const state = newState({})

    state.xruv.hasAdminToken = true
    state.snapshot = { hasNostrKey: true } as never

    const samples: Record<string, string> = { 'x-join': '', 'x-read': 'pub:general', 'x-publish': 'pub:general hi', 'x-create': 'ops', 'x-grant': `prv:0123456789abcdef ${KEY}`, 'x-hub': 'Status: up', 'x-admit': KEY }

    expect(new Set(XRUV.map(candidate => candidate.id)).size).toBe(XRUV.length)

    for (const candidate of XRUV) {
      const spec = candidate.spec(state, samples[candidate.id] ?? '')

      if (spec === null) continue

      expect(spec.args.slice(0, 4)).toEqual(['mcp', 'exec', '-t', spec.args[3]])
      expect(spec.args).toHaveLength(6)
      expect(spec.board).toBe('xruv')
      expect(spec.isReadOnly === true).toBe(candidate.kind === 'read')
    }
  })

  it('a channel read asks first while there is no Nostr key, since the CLI would make one', () => {
    const state = newState({})

    expect(entry('x-read').spec(state, 'general')?.isReadOnly).toBeUndefined()
    expect(entry('x-read').spec(state, 'general')?.note).toContain('~/.ruflo/nostr.key')
    state.snapshot = { hasNostrKey: true } as never
    expect(entry('x-read').spec(state, 'general')?.isReadOnly).toBe(true)
    expect(params(entry('x-read').spec(state, 'general')?.args)).toEqual({ channel: 'pub:general', limit: 20 })
  })

  it('unregister and invite never produce a spec; admin rows need the token', () => {
    const state = newState({})

    expect(entry('x-unregister').spec(state, '')).toBeNull()
    expect(entry('x-unregister').why(state, '')).toBe(UNREGISTER_WHY)
    expect(entry('x-admit').spec(state, KEY)).toBeNull()
    expect(entry('x-admit').why(state, KEY)).toContain('RUFLO_X_ADMIN_TOKEN is not set')
    state.xruv.hasAdminToken = true
    expect(entry('x-invite').spec(state, '')).toBeNull()
    expect(params(entry('x-admit').spec(state, KEY)?.args)).toEqual({ pubkey: KEY, role: 'member' })
  })

  it('join takes an optional invite code, masks it on the confirm row, and refuses a malformed one', () => {
    const state = newState({})
    const join = entry('x-join').spec(state, 'v2.abcdefgh12')

    expect(params(entry('x-join').spec(state, '')?.args)).toEqual({})
    expect(params(join?.args)).toEqual({ code: 'v2.abcdefgh12' })
    expect(join?.shows).not.toContain('v2.abcdefgh12')
    expect(entry('x-join').spec(state, 'abcdefgh')).toBeNull()
  })
})

describe('network probes', () => {
  it('claims and sync are network reads drawn only on the board; PROBES keeps its two', () => {
    expect(X_PROBES.map(probe => [probe.id, probe.isNetwork, probe.views])).toEqual([
      ['x-claims', true, ['xruv']],
      ['x-sync', true, ['xruv']],
    ])
    expect(PROBES.filter(probe => probe.isNetwork === true).map(probe => probe.id)).toEqual(['roster', 'registry'])
    expect(params(swarmProbe.args)).toEqual({ limit: 20 })
  })

  it('reads the gateway envelope as data, short keys only, hostile text stripped', () => {
    const fenced = (data: unknown) => `Result:\n${JSON.stringify({ untrusted: true, relay: 'wss://relay.ruv.io', retrievedAt: '2026-10-02T12:00:00Z', data })}`
    const claims = workClaimsProbe.parse(fenced({ 'repo:x#1': { owner: KEY, from: 'node\u001b[31m', expiresAt: '2026-10-02T13:00:00Z' }, bad: 'nope' }))
    const sync = swarmProbe.parse(fenced({ messages: [{ type: 'Task', task: 'review', pubkey: KEY, created_at: 1 }, { type: 'Status', text: 'up', pubkey: KEY, created_at: 2 }, 'junk'] }))

    expect(envelopeOf('no json')).toBeNull()
    expect(claims?.claims).toEqual([{ resource: 'repo:x#1', owner: `${KEY.slice(0, 12)}…`, from: 'node', expiresAtMs: Date.parse('2026-10-02T13:00:00Z') }])
    expect(claims?.relay).toBe('wss://relay.ruv.io')
    expect(sync?.messages.map(message => message.text)).toEqual(['up', 'review'])
    expect(messageOf({ type: 'Status' })).toBeNull()
    expect(swarmProbe.parse('Result:\n{"untrusted":true,"data":{}}')).toBeNull()
  })
})

describe('result lines', () => {
  it('invite codes are masked in every line and in the headless answer', () => {
    const stdout = `Result:\n${JSON.stringify({ ok: true, code: 'v2.SECRETinviteTOKEN123', uses: 25 })}`
    const lines = xruvLines('x-hub', stdout)
    const state = newState({})

    expect(lines.join('\n')).not.toContain('SECRETinvite')
    expect(maskInvites('code v2.SECRETinviteTOKEN123 here')).toBe('code v2.•••• (invite code, masked) here')
    state.xruv.result = { id: 'x-hub', label: 'publish', ok: true, exitCode: 0, lines, atMs: 5 }
    expect(xruvAnswer(state, 'x-hub', 1)).not.toContain('SECRETinvite')
    expect(xruvAnswer(state, 'x-roster', 1)).toBeNull()
  })

  it('a join reads as joined or not, a read lists its messages, and the own pubkey is taken only when it is one', () => {
    const join = `Result:\n${JSON.stringify({ ok: true, pubkey: KEY, keyCreated: true, membershipVerified: true, alreadyMember: true })}`
    const read = `Result:\n${JSON.stringify({ channel: 'prv:0123456789abcdef', visibility: 'private', count: 1, messages: [{ id: 'e', pubkey: KEY, created_at: 1, encrypted: true, reason: 'no channel key held' }] })}`

    expect(xruvLines('x-join', join)[0]).toBe(`joined (already a member: nothing registered) · pubkey ${KEY.slice(0, 12)}… · key created now · membership verified (NIP-42)`)
    expect(xruvLines('x-read', read, '', 1_000)).toEqual(['1 message on prv:0123456789abcdef (private) · signed by members, not vetted', `[message] ${KEY.slice(0, 12)}… (encrypted: no channel key held) · 0m ago`])
    expect(ownPubkeyOf('x-join', join)).toBe(KEY)
    expect(ownPubkeyOf('x-grant', `Result:\n${JSON.stringify({ grantedBy: KEY })}`)).toBe(KEY)
    expect(ownPubkeyOf('x-join', 'Result:\n{"pubkey":"not-hex"}')).toBeNull()
  })
})
