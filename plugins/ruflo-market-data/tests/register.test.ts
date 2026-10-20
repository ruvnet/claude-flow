import type { On } from 'claude-code'
import { describe, expect, test, tier } from 'claude-code/testing'

tier('user')

const ROOT = '/work'
const P = 'mcp__plugin_ruflo-core_ruflo__'
const START = { surface: 'terminal', isInteractive: true, cwd: ROOT } as const
const slash = (args: string) => ({ command: 'market-mod', args, origin: { kind: 'composer' }, presentation: { isFullscreen: false, columns: 100 } }) as const
const TOOLS = ["memory_store","ruvllm_hnsw_add"].map(name => ({ name: P + name, description: '', mcp: true }))

/** The world beneath the mod: a project root, a file map, the connected tools, and a stub that answers every tool call. */
function world(on: On, tools = TOOLS) {
  const files = new Map<string, string>()
  const registered: string[] = []
  on('session.start', ($, e) => ({ cwd: e.cwd }))
  on('session.root', () => ({ value: ROOT }))
  on('command.register', ($, e) => (registered.push(e.name), { value: { command: e.name } }))
  on('fs.write', ($, e) => (files.set(e.path, e.text), { value: undefined }))
  on('tool.list', () => ({ value: tools }))
  on('clock.now', () => ({ value: Date.now() }))
  on('tool.call', () => ({ result: 'ran' }))
  return { files, registered, status: () => JSON.parse(files.get(`${ROOT}/.claude-flow/market-mod/status.json`) ?? '{}') }
}

const attempt = async ($: Parameters<Parameters<typeof test>[2]>[0], call: object) =>
  JSON.stringify(await $.tool.call(call as never).then(r => r, (e: unknown) => ({ text: String(e) })))

describe('guard', () => {
  test('refuses: API key in a market write, and never echoes the secret', async ($, on) => {
    world(on)
    await $.session.start(START)
    const out = await attempt($, { tool: P + 'memory_store', namespace: 'market-data', key: 'feed', value: `apikey=abcd1234abcd1234abcd1234` })
    expect(out).not.toContain('ran')
    expect(out).toContain('ruflo-market-data')
    expect(out).not.toContain('ghp_')
    expect(out).not.toContain('abcd1234')
    expect(out).not.toContain('Zx9Qm2')
  })

  test('refuses: credentialed feed URL, and never echoes the secret', async ($, on) => {
    world(on)
    await $.session.start(START)
    const out = await attempt($, { tool: P + 'memory_store', namespace: 'market-data', key: 'feed', value: 'https://feed.example/v1?token=Zx9Qm2LpR7vK4nT8' })
    expect(out).not.toContain('ran')
    expect(out).toContain('ruflo-market-data')
    expect(out).not.toContain('ghp_')
    expect(out).not.toContain('abcd1234')
    expect(out).not.toContain('Zx9Qm2')
  })

  test('passes good calls through', async ($, on) => {
    world(on)
    await $.session.start(START)
    expect(await attempt($, { tool: P + 'memory_store', namespace: 'notes', key: 'k', value: `token ghp_${'a1B2'.repeat(10)}` })).toContain('ran') // other namespace untouched
    expect(await attempt($, { tool: P + 'memory_store', namespace: 'market-data', key: 'AAPL', value: 'o=1 h=2 l=0.5 c=1.5' })).toContain('ran') // clean OHLCV
  })

  test('turning that option off lets the call through', { options: { guard: 'off' } }, async ($, on) => {
    world(on)
    await $.session.start(START)
    expect(await attempt($, { tool: P + 'memory_store', namespace: 'market-data', key: 'feed', value: `token ghp_${'a1B2'.repeat(10)}` })).toContain('ran')
  })

  test('ignores tools that belong to someone else', async ($, on) => {
    world(on)
    await $.session.start(START)
    expect(await attempt($, { tool: P + 'some_other_tool', value: `token ghp_${'a1B2'.repeat(10)}` })).toContain('ran')
  })
})

describe('status file and /market-mod', () => {
  test('the status file is written at session start with the shape the console reads', async ($, on) => {
    const w = world(on)
    await $.session.start(START)
    expect(w.registered).toEqual(['market-mod'])
    expect(w.status()).toMatchObject({ version: 1, guard: true, total: 0, blocked: 0, calls: {} })
    expect(typeof w.status().updatedMs).toBe('number')
  })

  test('counters move when own tools run and when the guard refuses', async ($, on) => {
    const w = world(on)
    await $.session.start(START)
    await attempt($, { tool: P + 'memory_store', namespace: 'market-data', key: 'AAPL', value: 'o=1 h=2 l=0.5 c=1.5' })
    await attempt($, { tool: P + 'memory_store', namespace: 'market-data', key: 'feed', value: `apikey=abcd1234abcd1234abcd1234` })
    expect(w.status()).toMatchObject({ total: 1, blocked: 1 })
    expect(Object.keys(w.status().calls)).toHaveLength(1)
    expect(JSON.stringify(w.status())).not.toContain('ghp_')
  })

  test('status, tools, recent, scan and help answer locally', async ($, on) => {
    world(on)
    await $.session.start(START)
    expect((await $.command.run(slash('status'))).text).toContain('guard on')
    expect((await $.command.run(slash('tools'))).text).toContain('memory_store')
    expect((await $.command.run(slash('recent'))).text).toContain('Nothing')
    expect((await $.command.run(slash(`scan key ghp_${'a1B2'.repeat(10)}`))).text).toContain('github token')
    expect((await $.command.run(slash('scan plain words'))).text).toContain('Nothing found')
    expect((await $.command.run(slash(''))).text).toContain('/market-mod status')
    expect((await $.command.run(slash('what is this'))).text).toContain('Unknown')
  })

  test('tools says so plainly when none are connected', async ($, on) => {
    world(on, [])
    await $.session.start(START)
    expect((await $.command.run(slash('tools'))).text).toContain('None of this plugin')
  })
})

describe('defaults', () => {
  test('with no options the guard is on', async ($, on) => {
    const w = world(on)
    await $.session.start(START)
    expect(w.status().guard).toBe(true)
  })
})
