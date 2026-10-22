import type { On } from 'claude-code'
import { describe, expect, test, tier } from 'claude-code/testing'

tier('user')

const ROOT = '/work'
const START = { surface: 'terminal', isInteractive: true, cwd: ROOT } as const
const slash = (args: string) => ({ command: 'iot-mod', args, origin: { kind: 'composer' }, presentation: { isFullscreen: false, columns: 100 } }) as const
const SECRET = `ghp_${'a1B2'.repeat(10)}`
const STATUS = `${ROOT}/.claude-flow/iot-mod/status.json`

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
  test('session start registers /iot-mod and writes status.json (version 1, guard on)', async ($, on) => {
    const w = world(on)
    await $.session.start(START)
    expect(w.status()).toMatchObject({ version: 1, guard: true, blocked: 0, commands: 0 })
    expect(typeof w.status().updatedMs).toBe('number')
  })

  test('status, an unknown verb and help answer locally', async ($, on) => {
    world(on)
    await $.session.start(START)
    expect((await $.command.run(slash('status'))).text).toContain('guard on')
    expect((await $.command.run(slash('what is this'))).text).toContain('/iot-mod status')
    expect((await $.command.run(slash(''))).text).toContain('/iot-mod scan <text>')
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
  const bash = (command: string) => ({ tool: 'Bash', command })

  test('refuses a secret in a device record, passes clean, leaves other namespaces alone', async ($, on) => {
    const w = world(on)
    on('tool.call', () => ({ result: 'stored' }))
    await $.session.start(START)
    const denied = await attempt($, { tool: `${CORE}memory_store`, key: 'k', value: `token ${SECRET}`, namespace: 'iot-devices' })
    expect(denied).toContain('secret')
    expect(denied).not.toContain('ghp_')
    expect(await attempt($, { tool: `${CORE}memory_store`, key: 'k', value: 'Registered at 10.0.0.4', namespace: 'iot-devices' })).toContain('stored')
    expect(await attempt($, { tool: `${CORE}memory_store`, key: 'k', value: SECRET, namespace: 'scratch' })).toContain('stored')
    expect(w.status()).toMatchObject({ blocked: 1 })
  })

  test('fleet delete and device removal need a go-ahead; list and rollback do not', async ($, on) => {
    world(on)
    on('tool.call', () => ({ result: 'ran' }))
    await $.session.start(START)
    const cli = 'npx -y -p @claude-flow/plugin-iot-cognitum@latest cognitum-iot'
    expect(await attempt($, bash(`${cli} fleet delete f-1`))).toContain('COGNITUM_IOT_CONFIRM=1')
    expect(await attempt($, bash(`${cli} device revoke d-9`))).toContain('COGNITUM_IOT_CONFIRM=1')
    expect(await attempt($, bash(`COGNITUM_IOT_CONFIRM=1 ${cli} fleet delete f-1`))).toContain('ran')
    expect(await attempt($, bash(`${cli} fleet delete f-1 --confirm`))).toContain('ran')
    expect(await attempt($, bash(`${cli} fleet list`))).toContain('ran')
    expect(await attempt($, bash(`${cli} firmware rollback r-3`))).toContain('ran')
    expect(await attempt($, bash('ls -la'))).toContain('ran')
  })

  test('a secret on a cognitum-iot command line is refused without being echoed', async ($, on) => {
    world(on)
    on('tool.call', () => ({ result: 'ran' }))
    await $.session.start(START)
    const denied = await attempt($, bash(`cognitum-iot device register --endpoint http://x --token ${SECRET}`))
    expect(denied).toContain('command line')
    expect(denied).not.toContain('ghp_')
  })

  test('confirmDestructive: off lets a delete through', { options: { confirmDestructive: 'off' } }, async ($, on) => {
    world(on)
    on('tool.call', () => ({ result: 'ran' }))
    await $.session.start(START)
    expect(await attempt($, bash('cognitum-iot fleet delete f-1'))).toContain('ran')
  })

  test('guard: off lets everything through', { options: { guard: 'off' } }, async ($, on) => {
    world(on)
    on('tool.call', () => ({ result: 'ran' }))
    await $.session.start(START)
    expect(await attempt($, bash('cognitum-iot fleet delete f-1'))).toContain('ran')
  })
})

describe('/iot-mod devices', () => {
  test('reads the iot-devices namespace through the connected memory tool', async ($, on) => {
    const w = world(on, [`${CORE}memory_list`], 'seed-3 at 10.0.0.4')
    await $.session.start(START)
    expect((await $.command.run(slash('devices'))).text).toContain('seed-3')
    expect(w.calls[0]).toMatchObject({ tool: 'memory_list', args: { namespace: 'iot-devices' } })
  })

  test('says plainly when no memory tool is connected', async ($, on) => {
    world(on)
    await $.session.start(START)
    expect((await $.command.run(slash('devices'))).text).toContain('No memory tool is connected')
  })
})
