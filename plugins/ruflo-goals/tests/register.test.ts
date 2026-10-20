import type { On } from 'claude-code'
import { describe, expect, test, tier } from 'claude-code/testing'

tier('user')

const ROOT = '/work'
const START = { surface: 'terminal', isInteractive: true, cwd: ROOT } as const
const slash = (args: string) => ({ command: 'goals-mod', args, origin: { kind: 'composer' }, presentation: { isFullscreen: false, columns: 100 } }) as const
const SECRET = `ghp_${'a1B2'.repeat(10)}`
const STATUS = `${ROOT}/.claude-flow/goals-mod/status.json`

type Calls = { server: string; tool: string; args: unknown }[]

/** The world beneath the mod: a project, a file map, the connected tools, and an MCP that answers every call with `reply`. */
function world(on: On, tools: readonly string[] = [], reply = '') {
  const files = new Map<string, string>()
  const calls: Calls = []
  on('session.start', ($, e) => ({ cwd: e.cwd }))
  on('session.root', () => ({ value: ROOT }))
  on('command.register', ($, e) => ({ value: { command: e.name } }))
  on('fs.write', ($, e) => (files.set(e.path, e.text), { value: undefined }))
  on('tool.list', () => ({ value: tools.map(name => ({ name, description: '', mcp: name.startsWith('mcp__') })) }))
  on('clock.now', () => ({ value: 1_700_000_000_000 }))
  on('mcp.call', ($, e) => (calls.push({ server: e.server, tool: e.tool, args: e.args }), { value: { content: [{ type: 'text', text: reply }], isError: false } }))
  return { files, calls, status: () => JSON.parse(files.get(STATUS) ?? '{}') as Record<string, unknown> }
}

/** Runs a tool call through the mod; a denial comes back as its reason text, an allowed call as `ALLOWED`. */
async function attempt($: { tool: { call: (i: never) => Promise<unknown> } }, input: Record<string, unknown>): Promise<string> {
  try {
    return JSON.stringify(await $.tool.call(input as never))
  } catch (e) {
    return String(e)
  }
}

const CORE = 'mcp__plugin_ruflo-core_ruflo__'

describe('status file and defaults', () => {
  test('session start registers /goals-mod and writes status.json (version 1, guard on)', async ($, on) => {
    const w = world(on)
    await $.session.start(START)
    expect(w.status()).toMatchObject({ version: 1, guard: true, blocked: 0, commands: 0 })
    expect(typeof w.status().updatedMs).toBe('number')
  })

  test('status, an unknown verb and help answer locally', async ($, on) => {
    world(on)
    await $.session.start(START)
    expect((await $.command.run(slash('status'))).text).toContain('guard on')
    expect((await $.command.run(slash('what is this'))).text).toContain('/goals-mod status')
    expect((await $.command.run(slash(''))).text).toContain('/goals-mod scan <text>')
  })

  test('scan names the secret shape and never echoes the value', async ($, on) => {
    world(on)
    await $.session.start(START)
    const hit = (await $.command.run(slash(`scan key ${SECRET}`))).text ?? ''
    expect(hit).toContain('github token')
    expect(hit).not.toContain('ghp_')
    expect((await $.command.run(slash('scan plain words'))).text).toContain('No secret shape')
  })
})

describe('guard', () => {
  const store = (value: string, namespace = 'horizons') => ({ tool: `${CORE}memory_store`, key: 'k', value, namespace })

  test('refuses a secret in a goals namespace, passes clean text, leaves other namespaces to their own guard', async ($, on) => {
    const w = world(on)
    on('tool.call', () => ({ result: 'stored' }))
    await $.session.start(START)
    const denied = await attempt($, store(`deploy with ${SECRET}`))
    expect(denied).toContain('secret')
    expect(denied).not.toContain('ghp_')
    expect(await attempt($, store('ship the beta by friday'))).toContain('stored')
    expect(await attempt($, store(`deploy with ${SECRET}`, 'scratch'))).toContain('stored')
    expect(w.status()).toMatchObject({ blocked: 1, lastDenied: `${CORE}memory_store` })
  })

  test('a government ID number is refused in a dossier, not in a plan', async ($, on) => {
    world(on)
    on('tool.call', () => ({ result: 'stored' }))
    await $.session.start(START)
    const denied = await attempt($, store('subject SSN 123-45-6789', 'dossier-acme'))
    expect(denied).toContain('government ID')
    expect(denied).not.toContain('123-45')
    expect(await attempt($, store('order 123-45-6789 shipped', 'goap-plans'))).toContain('stored')
  })

  test('task_create is screened too', async ($, on) => {
    world(on)
    on('tool.call', () => ({ result: 'stored' }))
    await $.session.start(START)
    expect(await attempt($, { tool: `${CORE}task_create`, description: `use ${SECRET}` })).toContain('secret')
  })

  test('guard: off and personal: off relax it', { options: { guard: 'off' } }, async ($, on) => {
    world(on)
    on('tool.call', () => ({ result: 'stored' }))
    await $.session.start(START)
    expect(await attempt($, store(`deploy with ${SECRET}`))).toContain('stored')
  })

  test('personal: off lets an ID number through but not a secret', { options: { personal: 'off' } }, async ($, on) => {
    world(on)
    on('tool.call', () => ({ result: 'stored' }))
    await $.session.start(START)
    expect(await attempt($, store('SSN 123-45-6789', 'dossier-acme'))).toContain('stored')
    expect(await attempt($, store(SECRET, 'dossier-acme'))).toContain('secret')
  })
})

describe('/goals-mod horizons', () => {
  test('reads the horizons namespace through the connected memory tool', async ($, on) => {
    const w = world(on, [`${CORE}memory_list`], 'Q4 launch: milestone 2 of 5')
    await $.session.start(START)
    const text = (await $.command.run(slash('horizons'))).text ?? ''
    expect(text).toContain('Q4 launch')
    expect(w.calls[0]).toMatchObject({ server: 'plugin_ruflo-core_ruflo', tool: 'memory_list', args: { namespace: 'horizons' } })
  })

  test('says plainly when no memory tool is connected', async ($, on) => {
    world(on)
    await $.session.start(START)
    expect((await $.command.run(slash('horizons'))).text).toContain('No memory tool is connected')
  })
})
