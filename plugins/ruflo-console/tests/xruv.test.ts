import { describe, expect, mock, test } from 'claude-code/testing'

import { RUFLO_FILES } from './fixtures/ruflo-run'
import { inputKeys, cliAnswer, command, elementsOf, keyOf, paneAt, PLUGIN, SESSION, textOf, worldOf, type Answer } from './fixtures/world'

const PUBKEY = 'ab'.repeat(32)
const TOKEN = 'xr-admin-token-do-not-print-0123456789'
const INVITE = 'v2.SECRETinviteTOKEN123'
const NETWORK = /x_federation_(registry|roster|claims|sync|channel_read|join|channel_publish|channel_grant|channel_accept|admit|publish|invite)/
const ok = (body: unknown): Answer => ({ exitCode: 0, stdout: `[INFO] Executing tool\nResult:\n${JSON.stringify(body)}`, stderr: '' })
const fenced = (data: unknown) => ({ untrusted: true, provenance: 'third-party relay text', relay: 'wss://relay.ruv.io', retrievedAt: '2026-10-02T12:00:00Z', data })

/** The federation reads and writes answered as the CLI answers them; everything else from the captured run. */
function respond(argv: readonly string[]): Answer {
  const line = argv.join(' ')

  if (line.includes('x_federation_roster')) return ok(fenced({ [`${PUBKEY.slice(0, 20)}`]: { about: 'coder node in Toronto' } }))
  if (line.includes('x_federation_claims')) return ok(fenced({ 'repo:ruflo#42': { owner: PUBKEY, from: 'ruvultra', ttlSeconds: 600, expiresAt: '2026-10-02T13:00:00Z' } }))
  if (line.includes('x_federation_sync')) return ok(fenced({ count: 1, messages: [{ type: 'Status', text: 'online and idle', id: 'e1', pubkey: PUBKEY, created_at: 1_790_000_000 }] }))
  if (line.includes('x_federation_registry')) return ok({ relay: 'wss://relay.ruv.io', swarmTag: 'ruflo-swarm', registration: { enabled: true, authentication: 'NIP-98' }, join: ['1. generate a key'], defaultChannels: [{ channel: 'general', purpose: 'everything' }] })
  if (line.includes('x_federation_channel_publish')) return ok({ ok: true, channel: 'pub:general', visibility: 'public', encrypted: false, eventId: 'ev1', pubkey: PUBKEY })
  if (line.includes('x_federation_join')) return ok({ ok: true, pubkey: PUBKEY, keyCreated: false, membershipVerified: true, next: `share ${INVITE} with nobody` })

  return cliAnswer(argv)
}

const fedRuns = (runs: readonly string[][]) => runs.filter(argv => NETWORK.test(argv.join(' ')))
const argsOf = (runs: readonly string[][], tool: string) => runs.find(argv => argv.includes(tool))?.slice(4)

describe('x.ruv.io board', () => {
  test('every capability is a row with a button or a field; nothing on the network is asked and the key is never read', { options: { boot: false } }, async ($, on) => {
    const world = worldOf(on, RUFLO_FILES, { home: { '.ruflo/nostr.key': 'never-read' } })
    world.respond = respond
    mock.clock(on)
    await $.session.start(SESSION)
    await $.command.run(command('xruv'))

    const pane = await $.ui.mount({ ...paneAt(120), surface: 'terminal' as const, plugin: PLUGIN })
    const tree = await pane.drawn()
    const text = textOf(tree)

    expect(elementsOf(tree, 'Button').map(keyOf)).toEqual(expect.arrayContaining(['xr-x-join', 'xr-x-bbs-identity', 'xr-x-registry', 'xr-x-roster', 'xr-x-claims', 'xr-x-sync', 'xr-x-channels', 'xr-x-accept', 'xr-x-bbs-peers', 'xr-x-bbs-serve']))
    expect(inputKeys(tree)).toEqual(expect.arrayContaining(['xr-in-x-bbs-register', 'xr-in-x-bbs-publish', 'xr-in-x-bbs-watch', 'xr-in-x-bbs-peer-add', 'xr-in-x-bbs-sync']))
    expect(inputKeys(tree)).toEqual(expect.arrayContaining(['xr-in-x-join', 'xr-in-x-read', 'xr-in-x-publish', 'xr-in-x-create', 'xr-in-x-grant']))
    expect(text).toContain(' JOIN ....')
    expect(text).not.toContain('present: ~/.ruflo/nostr.key')
    expect(text).toContain('unregister: not offered by the x.ruv.io gateway yet')
    expect(text).toContain('admin token: set it in the environment to enable')
    expect(text).toContain('Turn on federationNetwork in /config')
    expect(fedRuns(world.runs)).toEqual([])
    expect(world.stats.some(path => path.endsWith('nostr.key'))).toBe(false)
    expect(world.reads.some(path => path.endsWith('nostr.key') || path.endsWith('channels.json'))).toBe(false)
    await pane.unmount()
  })

  test('a fetch runs one fixed read on the click, fills its section and the result panel', { options: { boot: false } }, async ($, on) => {
    const world = worldOf(on, RUFLO_FILES)

    world.respond = respond
    mock.clock(on)
    await $.session.start(SESSION)
    await $.command.run(command('xruv'))

    const pane = await $.ui.mount({ ...paneAt(120), surface: 'terminal' as const, plugin: PLUGIN })

    await pane.press({ key: 'xr-x-claims' })

    const text = textOf(await pane.drawn())

    expect(fedRuns(world.runs).map(argv => argv.slice(4))).toEqual([['mcp', 'exec', '-t', 'x_federation_claims', '-p', '{}']])
    expect(text).toContain('repo:ruflo#42 · abababababab… (ruvultra)')
    expect(text).toContain('1 claimed resources')
    await pane.unmount()
  })

  test('with federationNetwork on, the board keeps the registry, roster, claims and swarm live', { options: { boot: false, federationNetwork: true } }, async ($, on) => {
    const world = worldOf(on, RUFLO_FILES)

    world.respond = respond
    mock.clock(on)
    await $.session.start(SESSION)

    await $.command.run(command('xruv'))
    await $.command.run(command('status'))

    const text = textOf(await $.ui.render(paneAt(120)))

    expect(argsOf(world.runs, 'x_federation_sync')).toEqual(['mcp', 'exec', '-t', 'x_federation_sync', '-p', '{"limit":20}'])
    expect(world.runs.some(argv => argv.includes('x_federation_claims'))).toBe(true)
    expect(text).toContain('[Status] abababababab… — online and idle')
    expect(text).toContain('◉ abababababababababab — coder node in Toronto')
    // Writes never run on their own, even with the network on.
    expect(world.runs.some(argv => /x_federation_(join|channel_publish|channel_grant|channel_accept|admit|publish|invite_mint)/.test(argv.join(' ')))).toBe(false)
  })

  test('writes ask first and run one fixed argv on yes; a bad value runs nothing', { options: { boot: false } }, async ($, on) => {
    const world = worldOf(on, RUFLO_FILES, { home: { '.ruflo/nostr.key': 'never-read' } })

    world.respond = respond
    mock.clock(on)
    await $.session.start(SESSION)
    await $.command.run(command('xruv'))

    const pane = await $.ui.mount({ ...paneAt(120), surface: 'terminal' as const, plugin: PLUGIN })

    await pane.input({ key: 'xr-in-x-publish', text: 'pub:general Status: online', kind: 'submit' })
    expect(textOf(await pane.drawn())).toContain('Confirm: publish Status to pub:general as yourself?')
    expect(fedRuns(world.runs)).toEqual([])
    await pane.press({ key: 'confirm' })
    expect(argsOf(world.runs, 'x_federation_channel_publish')).toEqual(['mcp', 'exec', '-t', 'x_federation_channel_publish', '-p', JSON.stringify({ channel: 'pub:general', msgType: 'Status', payload: { text: 'online' } })])

    // The pubkey the publish named now stands for this node.
    expect(textOf(await pane.drawn())).toContain(`${PUBKEY.slice(0, 16)}…${PUBKEY.slice(-6)}`)

    await pane.input({ key: 'xr-in-x-grant', text: 'prv:0123456789abcdef not-a-key', kind: 'submit' })
    await pane.input({ key: 'xr-in-x-create', text: 'Bad Name!', kind: 'submit' })
    expect(textOf(await pane.drawn())).not.toContain('Confirm:')
    expect(world.runs.some(argv => /x_federation_channel_(grant|create)/.test(argv.join(' ')))).toBe(false)

    await pane.press({ key: 'xr-x-accept' })
    await pane.press({ key: 'cancel' })
    expect(world.runs.some(argv => argv.includes('x_federation_channel_accept'))).toBe(false)
    await pane.unmount()
  })

  test('join with an invite: the code is masked on the confirm row and in the answer, and sent once as its own argv', { options: { boot: false } }, async ($, on) => {
    const world = worldOf(on, RUFLO_FILES)

    world.respond = respond
    mock.clock(on)
    await $.session.start(SESSION)

    const asked = await $.command.run(command(`run x-join ${INVITE}`))
    const shown = textOf(await $.ui.render(paneAt(120)))

    // The first line asks; the next say exactly what runs (the code masked) and that it reaches the network.
    expect((asked.text ?? '').split('\n')[0]).toBe('Asked: join x.ruv.io with your own key and an invite. Confirm with /ruflo yes (or y in the pane), cancel with /ruflo no.')
    expect(asked.text).toContain('with your invite code, masked here')
    expect(shown).toContain('your invite code, masked here')
    expect(shown).not.toContain(INVITE)

    const answer = await $.command.run(command('yes'))

    expect(argsOf(world.runs, 'x_federation_join')).toEqual(['mcp', 'exec', '-t', 'x_federation_join', '-p', JSON.stringify({ code: INVITE })])
    expect(answer.text).toContain('joined · pubkey abababababab… · key reused · membership verified (NIP-42)')
    expect(answer.text).not.toContain(INVITE)
    expect(textOf(await $.ui.render(paneAt(120)))).not.toContain(INVITE)
  })

  test('unregister is never run; headless reads answer with what they fetched', { options: { boot: false } }, async ($, on) => {
    const world = worldOf(on, RUFLO_FILES)

    world.respond = respond
    mock.clock(on)
    await $.session.start(SESSION)

    expect((await $.command.run(command('run x-unregister'))).text).toContain('not offered by the x.ruv.io gateway yet')
    expect((await $.command.run(command('yes'))).text).toBe('Nothing is waiting for a confirm.')
    expect(fedRuns(world.runs)).toEqual([])

    const roster = await $.command.run(command('run x-roster'))

    expect(roster.text).toMatch(/^✓ fetch the x\.ruv\.io roster/)
    expect(roster.text).toContain('◉ abababababababababab — coder node in Toronto')
  })

  test('admin rows: refused without the token; with it, they ask first and the token never reaches argv or the screen', { options: { boot: false } }, async ($, on) => {
    const world = worldOf(on, RUFLO_FILES)

    world.respond = respond
    mock.clock(on)
    await $.session.start(SESSION)
    expect((await $.command.run(command(`run x-admit ${PUBKEY}`))).text).toContain('RUFLO_X_ADMIN_TOKEN is not set')
    expect(fedRuns(world.runs)).toEqual([])
  })

  test('with the admin token set, admit asks first and runs without the token in its argv', { options: { boot: false } }, async ($, on) => {
    const world = worldOf(on, RUFLO_FILES, { env: { RUFLO_X_ADMIN_TOKEN: TOKEN } })

    world.respond = respond
    mock.clock(on)
    await $.session.start(SESSION)

    const asked = await $.command.run(command(`run x-admit ${PUBKEY}`))
    await $.command.run(command('xruv'))

    const shown = textOf(await $.ui.render(paneAt(120)))

    expect(asked.text).toContain(`Asked: admit ${PUBKEY.slice(0, 12)}… as member`)
    expect(shown).toContain('RUFLO_X_ADMIN_TOKEN is set')
    expect(fedRuns(world.runs)).toEqual([])
    await $.command.run(command('yes'))
    expect(argsOf(world.runs, 'x_federation_admit')).toEqual(['mcp', 'exec', '-t', 'x_federation_admit', '-p', JSON.stringify({ pubkey: PUBKEY, role: 'member' })])
    expect(world.runs.some(argv => argv.join(' ').includes(TOKEN))).toBe(false)
    expect(textOf(await $.ui.render(paneAt(120)))).not.toContain(TOKEN)
    // Invites are minted in the terminal, never by the board.
    expect((await $.command.run(command('run x-invite'))).text).toContain('the console never shows one')
    expect(world.runs.some(argv => argv.includes('x_federation_invite_mint'))).toBe(false)
  })

  test('the whole row is clickable: pressing a row name reads, asks, or focuses its field; nothing is a dead label', { options: { boot: false } }, async ($, on) => {
    const world = worldOf(on, RUFLO_FILES)

    world.respond = respond
    mock.clock(on)
    await $.session.start(SESSION)
    await $.command.run(command('xruv'))

    const pane = await $.ui.mount({ ...paneAt(120), surface: 'terminal' as const, plugin: PLUGIN })
    const keys = elementsOf(await pane.drawn(), 'Button').map(keyOf)
    const names = keys.filter(key => key.startsWith('xr-name-') || key.startsWith('xr-about-'))

    // Every row has both its name and its about line as buttons, so a click anywhere on the row lands on one.
    for (const id of ['x-join', 'x-bbs-identity', 'x-registry', 'x-roster', 'x-claims', 'x-sync', 'x-channels', 'x-read', 'x-publish', 'x-create', 'x-grant', 'x-unregister']) {
      expect(names).toContain(`xr-name-${id}`)
      expect(names).toContain(`xr-about-${id}`)
    }

    // A read row: the name fetches at once, one fixed argv, and the result panel answers.
    await pane.press({ key: 'xr-name-x-claims' })
    expect(fedRuns(world.runs).map(argv => argv.slice(4))).toEqual([['mcp', 'exec', '-t', 'x_federation_claims', '-p', '{}']])
    expect(textOf(await pane.drawn())).toContain('repo:ruflo#42')

    // The about line does the same as the name.
    await pane.press({ key: 'xr-about-x-roster' })
    expect(fedRuns(world.runs).some(argv => argv.includes('x_federation_roster'))).toBe(true)

    // A write row asks first and sends nothing until confirmed.
    const before = fedRuns(world.runs).length

    await pane.press({ key: 'xr-name-x-join' })
    expect(textOf(await pane.drawn())).toMatch(/join x\.ruv\.io/i)
    expect(fedRuns(world.runs)).toHaveLength(before)

    // Unregister has no gateway endpoint: pressing it says so in the board, and runs nothing.
    await pane.press({ key: 'xr-name-x-unregister' })
    expect(fedRuns(world.runs)).toHaveLength(before)
    expect(textOf(await pane.drawn())).toContain('✗ nothing to do')
    await pane.unmount()
  })
})
