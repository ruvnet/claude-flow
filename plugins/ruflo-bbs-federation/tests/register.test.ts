import type { On } from 'claude-code'
import { describe, expect, test, tier } from 'claude-code/testing'

tier('user')

const ROOT = '/work'
const START = { surface: 'terminal', isInteractive: true, cwd: ROOT } as const
const slash = (args: string) => ({ command: 'bbs-mod', args, origin: { kind: 'composer' }, presentation: { isFullscreen: false, columns: 100 } }) as const
const STATUS = `${ROOT}/.claude-flow/bbs-mod/status.json`

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
const T = (name: string) => `mcp__plugin_ruflo-core_ruflo__federation_bbs_${name}`

describe('guard', () => {
  test('refuses a secret in a published message, never echoes it, passes a clean one', async ($, on) => {
    const w = world(on)
    await $.session.start(START)
    const denied = await attempt($.tool.call({ tool: T('publish'), roomId: 'r', msgType: 'Status', payload: { note: `deploy with ${GH}` } } as never))
    expect(denied).toContain('secret')
    expect(denied).not.toContain('ghp_')
    expect(await attempt($.tool.call({ tool: T('publish'), roomId: 'r', msgType: 'Status', payload: { note: 'deployed api' } } as never))).toContain('stored')
    expect(status(w.files).byRule).toEqual({ 'secret in message': 1 })
  })

  test('refuses a credential-named field and a private key argument', async ($, on) => {
    world(on)
    await $.session.start(START)
    expect(await attempt($.tool.call({ tool: T('peer_add'), nodeId: 'n', publicKey: 'pk', url: 'http://10.0.0.2:7777', privateKey: 'x' } as never))).toContain('credential')
  })

  test('peer_add: credentials in the url or a non-http scheme are refused, a plain peer url passes', async ($, on) => {
    world(on)
    await $.session.start(START)
    const add = (url: string) => attempt($.tool.call({ tool: T('peer_add'), nodeId: 'n', publicKey: 'pk', url } as never))
    const withCreds = await add('http://user:hunter2secret@10.0.0.2:7777')
    expect(withCreds).toContain('credentials')
    expect(withCreds).not.toContain('hunter2')
    expect(await add('file:///etc/passwd')).toContain('http or https')
    expect(await add('http://100.64.0.2:7777')).toContain('stored')
  })

  test('serve: wildcard bind is refused by default, a routable address passes, allowWildcardBind lifts it', async ($, on) => {
    world(on)
    await $.session.start(START)
    expect(await attempt($.tool.call({ tool: T('serve'), bindHost: '0.0.0.0', port: 7777 } as never))).toContain('every interface')
    expect(await attempt($.tool.call({ tool: T('serve'), bindHost: '100.64.0.1', port: 7777 } as never))).toContain('stored')
  })

  test('allowWildcardBind: on lets a wildcard bind through', { options: { allowWildcardBind: 'on' } }, async ($, on) => {
    world(on)
    await $.session.start(START)
    expect(await attempt($.tool.call({ tool: T('serve'), bindHost: '0.0.0.0' } as never))).toContain('stored')
  })

  test('guard: off lets everything through; other tools are never touched', { options: { guard: 'off' } }, async ($, on) => {
    world(on)
    await $.session.start(START)
    expect(await attempt($.tool.call({ tool: T('publish'), payload: { n: GH } } as never))).toContain('stored')
  })

  test('tools of other plugins are ignored even when they hold a secret', async ($, on) => {
    world(on)
    await $.session.start(START)
    expect(await attempt($.tool.call({ tool: 'mcp__plugin_ruflo-core_ruflo__memory_store', value: GH } as never))).toContain('stored')
  })
})

describe('status file and command', () => {
  test('status.json is written at session start and after a block', async ($, on) => {
    const w = world(on)
    await $.session.start(START)
    expect(status(w.files)).toMatchObject({ version: 1, guard: true, allowWildcardBind: false, blocked: 0 })
    await attempt($.tool.call({ tool: T('serve'), bindHost: '0.0.0.0' } as never))
    expect(status(w.files)).toMatchObject({ blocked: 1, lastRule: 'wildcard bind' })
    expect(w.commands).toEqual(['bbs-mod'])
  })

  test('/bbs-mod answers status, scan and peer locally', async ($, on) => {
    world(on)
    await $.session.start(START)
    expect((await $.command.run(slash('status'))).text).toContain('guard on · wildcard bind refused')
    expect((await $.command.run(slash(`scan key ${GH}`))).text).toContain('github token')
    expect((await $.command.run(slash(`scan key ${GH}`))).text).not.toContain('ghp_')
    expect((await $.command.run(slash('scan plain words'))).text).toContain('Nothing found')
    expect((await $.command.run(slash('peer http://u:p@h:1'))).text).toContain('would refuse')
    expect((await $.command.run(slash('what is this'))).text).toContain('/bbs-mod status')
  })
})

describe('guard: every spelling of all interfaces', () => {
  test('0, 0.0, 00.0.0.0, 0x0.0.0.0, ::0 and the long IPv6 zero form are wildcards; ::1 and a tailnet address are not', async ($, on) => {
    world(on)
    await $.session.start(START)
    const serve = (bindHost: string) => attempt($.tool.call({ tool: T('serve'), bindHost, port: 7777 } as never))
    for (const h of ['0', '0.0', '00.0.0.0', '0x0.0.0.0', '::0', '0:0:0:0:0:0:0:0', '0000:0000:0000:0000:0000:0000:0000:0000', '[::]']) expect(await serve(h)).toContain('every interface')
    for (const h of ['::1', '127.0.0.1', '100.64.0.1', '10.0.0.0']) expect(await serve(h)).toContain('stored')
  })
})
