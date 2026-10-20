import type { On } from 'claude-code'
import { describe, expect, test, tier } from 'claude-code/testing'

tier('user')

const ROOT = '/work'
const START = { surface: 'terminal', isInteractive: true, cwd: ROOT } as const
const slash = (args: string) => ({ command: 'graph-mod', args, origin: { kind: 'composer' }, presentation: { isFullscreen: false, columns: 100 } }) as const
const SECRET = `ghp_${'a1B2'.repeat(10)}`
const STATUS = `${ROOT}/.claude-flow/graph-mod/status.json`

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
  test('session start registers /graph-mod and writes status.json (version 1, guard on)', async ($, on) => {
    const w = world(on)
    await $.session.start(START)
    expect(w.status()).toMatchObject({ version: 1, guard: true, blocked: 0, commands: 0 })
    expect(typeof w.status().updatedMs).toBe('number')
  })

  test('status, an unknown verb and help answer locally', async ($, on) => {
    world(on)
    await $.session.start(START)
    expect((await $.command.run(slash('status'))).text).toContain('guard on')
    expect((await $.command.run(slash('what is this'))).text).toContain('/graph-mod status')
    expect((await $.command.run(slash(''))).text).toContain('/graph-mod scan <text>')
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
  test('refuses a secret in a graph call (either spelling), passes a clean one, ignores other tools', async ($, on) => {
    const w = world(on)
    on('tool.call', () => ({ result: 'ranked' }))
    await $.session.start(START)
    const denied = await attempt($, { tool: `${CORE}sublinear_page-rank-entry`, graphId: 'g', nodeId: SECRET })
    expect(denied).toContain('secret')
    expect(denied).not.toContain('ghp_')
    expect(await attempt($, { tool: 'sublinear/solve', graphId: SECRET })).toContain('secret')
    expect(await attempt($, { tool: `${CORE}sublinear_page-rank-entry`, graphId: 'agents', nodeId: 'a-1', seedNodes: ['a-2'] })).toContain('ranked')
    expect(await attempt($, { tool: `${CORE}memory_store`, value: SECRET })).toContain('ranked')
    expect(w.status()).toMatchObject({ blocked: 2 })
  })

  test('guard: off lets it through', { options: { guard: 'off' } }, async ($, on) => {
    world(on)
    on('tool.call', () => ({ result: 'ranked' }))
    await $.session.start(START)
    expect(await attempt($, { tool: 'sublinear/solve', graphId: SECRET })).toContain('ranked')
  })
})

describe('/graph-mod tools', () => {
  test('lists the connected graph-intelligence tools', async ($, on) => {
    world(on, [`${CORE}sublinear_solve`, `${CORE}memory_store`])
    await $.session.start(START)
    const text = (await $.command.run(slash('tools'))).text ?? ''
    expect(text).toContain('sublinear_solve')
    expect(text).not.toContain('memory_store')
  })

  test('says plainly when none is connected', async ($, on) => {
    world(on, [`${CORE}memory_store`])
    await $.session.start(START)
    expect((await $.command.run(slash('tools'))).text).toContain('No graph-intelligence tool is connected')
  })
})
