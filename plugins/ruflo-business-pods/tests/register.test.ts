import type { On } from 'claude-code'
import { describe, expect, test, tier } from 'claude-code/testing'

tier('user')

const ROOT = '/work'
const START = { surface: 'terminal', isInteractive: true, cwd: ROOT } as const
const slash = (args: string) => ({ command: 'pods-mod', args, origin: { kind: 'composer' }, presentation: { isFullscreen: false, columns: 100 } }) as const
const STATUS = `${ROOT}/.claude-flow/pods-mod/status.json`

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
const T = (name: string) => `mcp__plugin_ruflo-core_ruflo__business_pod_${name}`
const template = { name: 'sales', agents: [{ agentType: 'coder' }], budgets: { usdMonthly: 40 } }

describe('guard', () => {
  test('a clean template passes, a secret or credential field in it is refused without being echoed', async ($, on) => {
    const w = world(on)
    await $.session.start(START)
    expect(await attempt($.tool.call({ tool: T('validate'), podTemplate: template } as never))).toContain('stored')
    const leak = await attempt($.tool.call({ tool: T('validate'), podTemplate: { ...template, notes: `use ${GH}` } } as never))
    expect(leak).toContain('secret')
    expect(leak).not.toContain('ghp_')
    expect(await attempt($.tool.call({ tool: T('route_backend'), podTemplate: { ...template, apiKey: 'x'.repeat(8) } } as never))).toContain('credential field')
    expect(status(w.files).byRule).toEqual({ 'secret in template': 2 })
  })

  test('template paths: traversal, credential locations and non-json are refused; a project template passes', async ($, on) => {
    world(on)
    await $.session.start(START)
    const route = (podTemplatePath: string) => attempt($.tool.call({ tool: T('route_backend'), podTemplatePath } as never))
    expect(await route('../../etc/shadow.json')).toContain('..')
    expect(await route('/home/u/.ssh/id_rsa')).toContain('credentials')
    expect(await route('/home/u/.aws/credentials.json')).toContain('credentials')
    expect(await route('templates/.env')).toContain('credentials')
    expect(await route('notes.txt')).toContain('.json')
    expect(await route('templates/sales.json')).toContain('stored')
    expect(await route('/abs/path/pods/ops.json')).toContain('stored')
  })

  test('guard: off lets it through; other tools are ignored', { options: { guard: 'off' } }, async ($, on) => {
    world(on)
    await $.session.start(START)
    expect(await attempt($.tool.call({ tool: T('route_backend'), podTemplatePath: '../x' } as never))).toContain('stored')
  })

  test('tools of other plugins are ignored', async ($, on) => {
    world(on)
    await $.session.start(START)
    expect(await attempt($.tool.call({ tool: 'mcp__plugin_ruflo-core_ruflo__memory_store', value: GH } as never))).toContain('stored')
  })
})

describe('status file and command', () => {
  test('status.json is written at session start and after a block', async ($, on) => {
    const w = world(on)
    await $.session.start(START)
    expect(status(w.files)).toMatchObject({ version: 1, guard: true, blocked: 0 })
    await attempt($.tool.call({ tool: T('route_backend'), podTemplatePath: '../x.json' } as never))
    expect(status(w.files)).toMatchObject({ blocked: 1, lastRule: 'template path' })
    expect(w.commands).toEqual(['pods-mod'])
  })

  test('/pods-mod answers status, scan and path locally', async ($, on) => {
    world(on)
    await $.session.start(START)
    expect((await $.command.run(slash('status'))).text).toContain('guard on')
    expect((await $.command.run(slash(`scan ${GH}`))).text).toContain('github token')
    expect((await $.command.run(slash('scan plain words'))).text).toContain('Nothing found')
    expect((await $.command.run(slash('path ../../x.json'))).text).toContain('would refuse')
    expect((await $.command.run(slash('path templates/sales.json'))).text).toContain('would let')
    expect((await $.command.run(slash('huh'))).text).toContain('/pods-mod status')
  })
})

describe('guard: credential locations are whole path segments', () => {
  test('.env and .env.json are refused; a .environments directory is not', async ($, on) => {
    world(on)
    await $.session.start(START)
    const route = (podTemplatePath: string) => attempt($.tool.call({ tool: T('route_backend'), podTemplatePath } as never))
    expect(await route('pods/.env.json')).toContain('credentials')
    expect(await route('pods/.env/pod.json')).toContain('credentials')
    expect(await route('pods/.environments/pod.json')).toContain('stored')
  })
})
