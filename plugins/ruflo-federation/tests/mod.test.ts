import type { On } from 'claude-code'
import { describe, expect, test, tier } from 'claude-code/testing'

tier('user')

const ROOT = '/work'
const START = { surface: 'terminal', isInteractive: true, cwd: ROOT } as const
const slash = (args: string) => ({ command: 'federation-mod', args, origin: { kind: 'composer' }, presentation: { isFullscreen: false, columns: 100 } }) as const
const STATUS = `${ROOT}/.claude-flow/federation-mod/status.json`
const SECRET = `ghp_${'a1B2'.repeat(10)}`

/** The world beneath the mod: a project root, a file map, a tool list and a directory map. */
function world(on: On, tools: readonly string[] = [], dirs: Record<string, { name: string; kind: 'file' | 'dir'; mtimeMs?: number }[]> = {}) {
  const files = new Map<string, string>()
  on('session.start', ($, e) => ({ cwd: e.cwd }))
  on('session.root', () => ({ value: ROOT }))
  on('command.register', ($, e) => ({ value: { command: e.name } }))
  on('fs.write', ($, e) => (files.set(e.path, e.text), { value: undefined }))
  on('fs.list', ($, e) => {
    const key = Object.keys(dirs).find(k => e.path === k || e.path.endsWith(`/${k}`))
    const entries = key === undefined ? undefined : dirs[key]
    if (!entries) throw new Error('ENOENT')
    return { value: entries.map(x => ({ size: 0, mtimeMs: 0, isLink: false, ...x })) }
  })
  on('tool.list', () => ({ value: tools.map(name => ({ name, description: '', mcp: true })) }))
  on('clock.now', () => ({ value: 1_700_000_000_000 }))
  return { files }
}

const call = (input: Record<string, unknown>) => input as never
const denied = (r: unknown) => JSON.stringify(r)

describe('guard', () => {
  test('refuses a secret, never echoes it, and counts the block in the status file', async ($, on) => {
    const w = world(on)
    on('tool.call', () => ({ result: 'went through' }))
    await $.session.start(START)
    const r = await $.tool.call(call(((s: string) => ({ tool: 'mcp__plugin_ruflo-core_ruflo__x_federation_publish', body: `token ${s}` }))(SECRET))).then(
      x => x,
      (e: unknown) => ({ text: String(e) }),
    )
    expect(denied(r)).toContain('ruflo-')
    expect(denied(r)).not.toContain('went through')
    expect(denied(r)).not.toContain('ghp_')
    expect(JSON.parse(w.files.get(STATUS) ?? '{}')).toMatchObject({ version: 1, guard: true, blocked: 1 })
  })

  test('x_federation_invite_mint is screened like the other outbound calls', async ($, on) => {
    world(on)
    on('tool.call', () => ({ result: 'went through' }))
    await $.session.start(START)
    const tool = 'mcp__plugin_ruflo-core_ruflo__x_federation_invite_mint'
    const r = await $.tool.call(call({ tool, note: `token ${SECRET}` })).then(x => x, (e: unknown) => ({ text: String(e) }))
    expect(denied(r)).toContain('ruflo-federation')
    expect(denied(r)).not.toContain('ghp_')
    expect(denied(await $.tool.call(call({ tool, note: 'for ops' })))).toContain('went through')
  })

  test('passes clean input and tools the plugin does not own', async ($, on) => {
    world(on)
    on('tool.call', () => ({ result: 'went through' }))
    await $.session.start(START)
    expect(denied(await $.tool.call(call({ tool: 'mcp__plugin_ruflo-core_ruflo__x_federation_publish', body: 'release 3.1 is out' })))).toContain('went through')
    expect(denied(await $.tool.call(call({ tool: 'Read', file_path: `/tmp/${SECRET}` })))).toContain('went through')
  })

  test('guard: off lets the call through', { options: { guard: 'off' } }, async ($, on) => {
    world(on)
    on('tool.call', () => ({ result: 'went through' }))
    await $.session.start(START)
    expect(denied(await $.tool.call(call(((s: string) => ({ tool: 'mcp__plugin_ruflo-core_ruflo__x_federation_publish', body: `token ${s}` }))(SECRET))))).toContain('went through')
  })
})

describe('guard PII', () => {
  const publish = (body: string) => call({ tool: 'mcp__plugin_ruflo-core_ruflo__x_federation_publish', body })

  test('an SSN or a Luhn-valid card number is refused, an order id is not, and the value is never echoed', async ($, on) => {
    world(on)
    on('tool.call', () => ({ result: 'went through' }))
    await $.session.start(START)
    for (const bad of ['ssn 123-45-6789', 'card 4111 1111 1111 1111']) {
      const r = await $.tool.call(publish(bad)).then(
        x => x,
        (e: unknown) => ({ text: String(e) }),
      )
      expect(denied(r)).toContain('personal data')
      expect(denied(r)).not.toContain('6789')
      expect(denied(r)).not.toContain('4111')
    }
    expect(denied(await $.tool.call(publish('order 4111 1111 1111 1112')))).toContain('went through')
  })

  test('a federation-namespaced memory write is screened, other namespaces are not', async ($, on) => {
    world(on)
    on('tool.call', () => ({ result: 'went through' }))
    await $.session.start(START)
    const r = await $.tool.call(call({ tool: 'mcp__plugin_ruflo-core_ruflo__memory_store', namespace: 'federation', key: 'peer', value: `key ${SECRET}` })).then(
      x => x,
      (e: unknown) => ({ text: String(e) }),
    )
    expect(denied(r)).not.toContain('went through')
    expect(denied(await $.tool.call(call({ tool: 'mcp__plugin_ruflo-core_ruflo__memory_store', namespace: 'tasks', key: 'peer', value: `key ${SECRET}` })))).toContain('went through')
  })
})

describe('status file', () => {
  test('is written at session start with the defaults', async ($, on) => {
    const w = world(on)
    await $.session.start(START)
    expect(JSON.parse(w.files.get(STATUS) ?? '{}')).toEqual({ version: 1, updatedMs: 1_700_000_000_000, guard: true, blocked: 0 })
  })
})

describe('/federation-mod', () => {
  test('status and scan answer locally, and help is the fallback', async ($, on) => {
    world(on)
    await $.session.start(START)
    expect((await $.command.run(slash('status'))).text).toBe('guard on · calls blocked 0')
    expect((await $.command.run(slash(`scan key ${SECRET}`))).text).toContain('github token')
    expect((await $.command.run(slash(`scan key ${SECRET}`))).text).not.toContain('ghp_')
    expect((await $.command.run(slash('scan plain words'))).text).toContain('Nothing found')
    expect((await $.command.run(slash(''))).text).toContain('/federation-mod scan <text>')
    expect((await $.command.run(slash('what is this'))).text).toContain('Unknown: what')
  })

  test('tools lists the connected federation tools only', async ($, on) => {
    world(on, ['mcp__plugin_ruflo-core_ruflo__x_federation_publish', 'mcp__plugin_ruflo-core_ruflo__federation_bbs_peers', 'mcp__plugin_ruflo-core_ruflo__memory_store'])
    await $.session.start(START)
    const text = (await $.command.run(slash('tools'))).text ?? ''
    expect(text).toContain('2 federation tools connected')
    expect(text).not.toContain('memory_store')
  })
})

describe('guard PII: timestamps are not card numbers', () => {
  test('a 13-digit epoch-millisecond timestamp passes however its Luhn sum falls; a real card still does not', async ($, on) => {
    world(on)
    on('tool.call', () => ({ result: 'went through' }))
    await $.session.start(START)
    const publish = (body: string) => call({ tool: 'mcp__plugin_ruflo-core_ruflo__x_federation_publish', body })
    // 1791154825171 passes the Luhn check; it starts with 1, which no card network issues.
    expect(denied(await $.tool.call(publish('sent at 1791154825171')))).toContain('went through')
    expect(denied(await $.tool.call(publish('card 4242424242424242')).then(r => r, (e: unknown) => String(e)))).toContain('personal data')
    expect(denied(await $.tool.call(publish('amex 3782 822463 10005')).then(r => r, (e: unknown) => String(e)))).toContain('personal data')
  })
})
