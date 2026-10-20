import type { On } from 'claude-code'
import { describe, expect, test, tier } from 'claude-code/testing'

tier('user')

const ROOT = '/work'
const P = 'mcp__plugin_ruflo-core_ruflo__'
const START = { surface: 'terminal', isInteractive: true, cwd: ROOT } as const
const slash = (args: string) => ({ command: 'loop-mod', args, origin: { kind: 'composer' }, presentation: { isFullscreen: false, columns: 100 } }) as const
const TOOLS = ["hooks_worker-dispatch","hooks_worker-status"].map(name => ({ name: P + name, description: '', mcp: true }))

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
  return { files, registered, status: () => JSON.parse(files.get(`${ROOT}/.claude-flow/loop-mod/status.json`) ?? '{}') }
}

const attempt = async ($: Parameters<Parameters<typeof test>[2]>[0], call: object) =>
  JSON.stringify(await $.tool.call(call as never).then(r => r, (e: unknown) => ({ text: String(e) })))

describe('guard', () => {
  test('refuses: secret in worker context, and never echoes the secret', async ($, on) => {
    world(on)
    await $.session.start(START)
    const out = await attempt($, { tool: P + 'hooks_worker-dispatch', trigger: 'audit', context: `token ghp_${'a1B2'.repeat(10)}` })
    expect(out).not.toContain('ran')
    expect(out).toContain('ruflo-loop-workers')
    expect(out).not.toContain('ghp_')
    expect(out).not.toContain('abcd1234')
    expect(out).not.toContain('Zx9Qm2')
  })

  test('passes good calls through', async ($, on) => {
    world(on)
    await $.session.start(START)
    expect(await attempt($, { tool: P + 'hooks_worker-dispatch', trigger: 'audit', context: 'src/auth' })).toContain('ran') // clean dispatch
    expect(await attempt($, { tool: P + 'hooks_worker-status' })).toContain('ran') // status
  })

  test('turning that option off lets the call through', { options: { guard: 'off' } }, async ($, on) => {
    world(on)
    await $.session.start(START)
    expect(await attempt($, { tool: P + 'hooks_worker-dispatch', trigger: 'audit', context: `token ghp_${'a1B2'.repeat(10)}` })).toContain('ran')
  })

  test('ignores tools that belong to someone else', async ($, on) => {
    world(on)
    await $.session.start(START)
    expect(await attempt($, { tool: P + 'some_other_tool', value: `token ghp_${'a1B2'.repeat(10)}` })).toContain('ran')
  })
})

describe('status file and /loop-mod', () => {
  test('the status file is written at session start with the shape the console reads', async ($, on) => {
    const w = world(on)
    await $.session.start(START)
    expect(w.registered).toEqual(['loop-mod'])
    expect(w.status()).toMatchObject({ version: 1, guard: true, total: 0, blocked: 0, calls: {} })
    expect(typeof w.status().updatedMs).toBe('number')
  })

  test('counters move when own tools run and when the guard refuses', async ($, on) => {
    const w = world(on)
    await $.session.start(START)
    await attempt($, { tool: P + 'hooks_worker-status' })
    await attempt($, { tool: P + 'hooks_worker-dispatch', trigger: 'audit', context: `token ghp_${'a1B2'.repeat(10)}` })
    expect(w.status()).toMatchObject({ total: 1, blocked: 1 })
    expect(Object.keys(w.status().calls)).toHaveLength(1)
    expect(JSON.stringify(w.status())).not.toContain('ghp_')
  })

  test('status, tools, recent, scan and help answer locally', async ($, on) => {
    world(on)
    await $.session.start(START)
    expect((await $.command.run(slash('status'))).text).toContain('guard on')
    expect((await $.command.run(slash('tools'))).text).toContain('hooks_worker-dispatch')
    expect((await $.command.run(slash('recent'))).text).toContain('Nothing')
    expect((await $.command.run(slash(`scan key ghp_${'a1B2'.repeat(10)}`))).text).toContain('github token')
    expect((await $.command.run(slash('scan plain words'))).text).toContain('Nothing found')
    expect((await $.command.run(slash(''))).text).toContain('/loop-mod status')
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
    expect(w.status()).toHaveProperty('maxDispatch')
  })
})

describe('dispatch cap', () => {
  const dispatch = { tool: P + 'hooks_worker-dispatch', trigger: 'audit', context: 'src/auth' }

  test('the Nth+1 dispatch is refused with the cap named; status calls still pass', { options: { maxDispatch: 2 } }, async ($, on) => {
    const w = world(on)
    await $.session.start(START)
    expect(await attempt($, dispatch)).toContain('ran')
    expect(await attempt($, dispatch)).toContain('ran')
    const out = await attempt($, dispatch)
    expect(out).not.toContain('ran')
    expect(out).toContain('2 workers')
    expect(await attempt($, { tool: P + 'hooks_worker-status' })).toContain('ran')
    expect(w.status()).toMatchObject({ maxDispatch: 2, blocked: 1, calls: { 'hooks_worker-dispatch': 2, 'hooks_worker-status': 1 } })
  })

  test('the cap defaults to 100 and is clamped', async ($, on) => {
    const w = world(on)
    await $.session.start(START)
    expect(w.status().maxDispatch).toBe(100)
  })
})
