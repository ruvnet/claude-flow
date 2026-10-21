import type { On } from 'claude-code'
import { describe, expect, test, tier } from 'claude-code/testing'

tier('user')

const ROOT = '/work'
const START = { surface: 'terminal', isInteractive: true, cwd: ROOT } as const
const slash = (args: string) => ({ command: 'chatgpt-mod', args, origin: { kind: 'composer' }, presentation: { isFullscreen: false, columns: 100 } }) as const
const STATUS = `${ROOT}/.claude-flow/chatgpt-mod/status.json`

/** The world beneath the mod: a project root, a file map, a registered-command list, and a tool that answers `stored`. */
function world(on: On) {
  const files = new Map<string, string>()
  const commands: string[] = []
  on('session.start', ($, e) => ({ cwd: e.cwd }))
  on('session.root', () => ({ value: ROOT }))
  on('command.register', ($, e) => (commands.push(e.name), { value: { command: e.name } }))
  on('fs.write', ($, e) => (files.set(e.path, e.text), { value: undefined }))
  on('clock.now', () => ({ value: 1_700_000_000_000 }))
  on('tool.call', () => ({ result: 'stored' }))
  return { files, commands }
}

/** A call the guard refused comes back as an error; this returns its text, or the tool result when it went through. */
const attempt = (p: Promise<unknown>) => p.then(r => JSON.stringify(r), (e: unknown) => String(e))
const status = (files: Map<string, string>) => JSON.parse(files.get(STATUS) ?? '{}')
const GH = `ghp_${'a1B2'.repeat(10)}`
const PUBLISH = 'mcp__ruflo-chatgpt-federation__channel_publish'
const publish = (extra: object) => ({ tool: PUBLISH, channel: 'pub:announce', msgType: 'Status', payload: { note: 'deployed' }, ...extra }) as never

describe('guard', () => {
  test('a public clean message passes', async ($, on) => {
    world(on)
    await $.session.start(START)
    expect(await attempt($.tool.call(publish({})))).toContain('stored')
  })

  test('private or malformed channels are refused before they leave the machine', async ($, on) => {
    world(on)
    await $.session.start(START)
    expect(await attempt($.tool.call(publish({ channel: 'prv:secret-room' })))).toContain('public')
    expect(await attempt($.tool.call(publish({ channel: 'pub:Bad Name' })))).toContain('public')
  })

  test('a secret or credential field in the payload is refused and never echoed', async ($, on) => {
    const w = world(on)
    await $.session.start(START)
    const leak = await attempt($.tool.call(publish({ payload: { note: `token ${GH}` } })))
    expect(leak).toContain('secret')
    expect(leak).not.toContain('ghp_')
    expect(await attempt($.tool.call(publish({ payload: { password: 'hunter2hunter2' } })))).toContain('credential field')
    expect(status(w.files).byRule).toEqual({ 'secret in message': 2 })
  })

  test('an oversize payload is refused; the cap is an option', async ($, on) => {
    world(on)
    await $.session.start(START)
    expect(await attempt($.tool.call(publish({ payload: { blob: 'x'.repeat(9000) } })))).toContain('8192-byte cap')
  })

  test('maxPayloadBytes raises the cap', { options: { maxPayloadBytes: 20000 } }, async ($, on) => {
    world(on)
    await $.session.start(START)
    expect(await attempt($.tool.call(publish({ payload: { blob: 'x'.repeat(9000) } })))).toContain('stored')
  })

  test('only the connector\'s own channel_publish is guarded (not ruflo-core x_federation_*, not channel_sync)', async ($, on) => {
    world(on)
    await $.session.start(START)
    expect(await attempt($.tool.call({ tool: 'mcp__plugin_ruflo-core_ruflo__x_federation_channel_publish', channel: 'prv:x', payload: { n: GH } } as never))).toContain('stored')
    expect(await attempt($.tool.call({ tool: 'mcp__ruflo-chatgpt-federation__channel_sync', channel: 'prv:x' } as never))).toContain('stored')
  })

  test('guard: off lets it through', { options: { guard: 'off' } }, async ($, on) => {
    world(on)
    await $.session.start(START)
    expect(await attempt($.tool.call(publish({ channel: 'prv:x' })))).toContain('stored')
  })
})

describe('status file and command', () => {
  test('status.json is written at session start and after a block', async ($, on) => {
    const w = world(on)
    await $.session.start(START)
    expect(status(w.files)).toMatchObject({ version: 1, guard: true, maxPayloadBytes: 8192, blocked: 0 })
    await attempt($.tool.call(publish({ channel: 'prv:x' })))
    expect(status(w.files)).toMatchObject({ blocked: 1, lastRule: 'channel' })
    expect(w.commands).toEqual(['chatgpt-mod'])
  })

  test('/chatgpt-mod answers status, scan and channel locally', async ($, on) => {
    world(on)
    await $.session.start(START)
    expect((await $.command.run(slash('status'))).text).toContain('guard on · payload cap 8192 bytes')
    expect((await $.command.run(slash(`scan ${GH}`))).text).toContain('github token')
    expect((await $.command.run(slash('scan plain words'))).text).toContain('Nothing found')
    expect((await $.command.run(slash('channel pub:announce'))).text).toContain('allowed')
    expect((await $.command.run(slash('channel prv:x'))).text).toContain('would refuse')
    expect((await $.command.run(slash(''))).text).toContain('/chatgpt-mod status')
  })
})

describe('guard: the cap is in bytes', () => {
  test('3000 CJK characters are 9000 UTF-8 bytes and over the 8192 cap; 3000 ASCII characters are not', async ($, on) => {
    world(on)
    await $.session.start(START)
    expect(await attempt($.tool.call(publish({ payload: { blob: '漢'.repeat(3000) } })))).toContain('8192-byte cap')
    expect(await attempt($.tool.call(publish({ payload: { blob: 'x'.repeat(3000) } })))).toContain('stored')
  })
})
