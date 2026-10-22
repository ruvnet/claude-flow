import type { On } from 'claude-code'
import { describe, expect, test, tier } from 'claude-code/testing'

tier('user')

const ROOT = '/work'
const START = { surface: 'terminal', isInteractive: true, cwd: ROOT } as const
const STATUS = `${ROOT}/.claude-flow/ruvllm-mod/status.json`
const slash = (args: string) => ({ command: 'ruvllm-mod', args, origin: { kind: 'composer' }, presentation: { isFullscreen: false, columns: 100 } }) as const

const WRITER = 'mcp__plugin_ruflo-core_ruflo__ruvllm_sona_adapt'
const READER = 'mcp__plugin_ruflo-core_ruflo__ruvllm_status'
const TOOLS = [WRITER, READER].map(name => ({ name, description: '', mcp: true }))
const SECRET = `ghp_${'a1B2'.repeat(10)}`

/** The world beneath the mod: a project root, a file map, connected tools, a fixed clock. */
function world(on: On, tools: readonly { name: string; description: string; mcp: boolean }[] = TOOLS) {
  const files = new Map<string, string>()
  let t = 1_000
  on('session.start', ($, e) => ({ cwd: e.cwd }))
  on('session.root', () => ({ value: ROOT }))
  on('command.register', ($, e) => ({ value: { command: e.name } }))
  on('fs.write', ($, e) => (files.set(e.path, e.text), { value: undefined }))
  on('tool.list', () => ({ value: tools }))
  on('clock.now', () => ({ value: (t += 10_000) }))
  on('tool.call', () => ({ result: 'done' }))
  return { files, status: () => JSON.parse(files.get(STATUS) ?? '{}') }
}

const call = (tool: string, value: string) => ({ tool, key: 'k', value }) as never
const attempt = (p: Promise<unknown>) => p.then(r => r, (e: unknown) => ({ text: String(e) }))

describe('guard', () => {
  test('refuses a secret in a write, never echoes it, passes clean input and other tools', async ($, on) => {
    const w = world(on)
    await $.session.start(START)

    const denied = JSON.stringify(await attempt($.tool.call(call(WRITER, `token ${SECRET}`))))
    expect(denied).toContain('secret')
    expect(denied).not.toContain('ghp_')
    expect(JSON.stringify(await $.tool.call(call(WRITER, 'a plain note about indexing')))).toContain('done')
    expect(JSON.stringify(await $.tool.call(call(READER, `query ${SECRET}`)))).toContain('done')
    expect(w.status()).toMatchObject({ version: 1, guard: true, blocked: 1, lastBlocked: WRITER.split('__').pop() })
  })

  test('a nested secret is found; a tool from nowhere is ignored', async ($, on) => {
    world(on)
    await $.session.start(START)
    const nested = { tool: WRITER, entries: [{ meta: { note: `Bearer ${'x9'.repeat(14)}` } }] } as never
    expect(JSON.stringify(await attempt($.tool.call(nested)))).toContain('secret')
    expect(JSON.stringify(await $.tool.call(call('Bash', `echo ${SECRET}`)))).toContain('done')
  })

  test('guard: off lets the write through', { options: { guard: 'off' } }, async ($, on) => {
    const w = world(on)
    await $.session.start(START)
    expect(JSON.stringify(await $.tool.call(call(WRITER, SECRET)))).toContain('done')
    expect(w.status()).toMatchObject({ guard: false, blocked: 0 })
  })
})

describe('status file', () => {
  test('written at session start with the defaults', async ($, on) => {
    const w = world(on)
    await $.session.start(START)
    expect(w.status()).toMatchObject({ version: 1, guard: true, seen: 0, blocked: 0 })
    expect(typeof w.status().updatedMs).toBe('number')
  })

  test('counts calls to the plugin\'s tools', async ($, on) => {
    const w = world(on)
    await $.session.start(START)
    await $.tool.call(call(READER, 'q'))
    await $.tool.call(call(READER, 'q'))
    const n = (await $.command.run(slash('status'))).text ?? ''
    expect(n).toContain('calls seen 2')
    expect(w.status().version).toBe(1)
  })
})

describe('/ruvllm-mod', () => {
  test('status, scan and tools answer locally', async ($, on) => {
    world(on)
    await $.session.start(START)
    expect((await $.command.run(slash('status'))).text).toContain('guard on')
    const scan = (await $.command.run(slash(`scan key ${SECRET}`))).text ?? ''
    expect(scan).toContain('github token')
    expect(scan).not.toContain('ghp_')
    expect((await $.command.run(slash('scan plain words'))).text).toContain('Nothing found')
    expect((await $.command.run(slash('tools'))).text).toContain('2 connected')
  })

  test('no connected tool is said plainly; an unknown verb gets the help', async ($, on) => {
    world(on, [])
    await $.session.start(START)
    expect((await $.command.run(slash('tools'))).text).toContain('None of this plugin')
    expect((await $.command.run(slash('how do I do it'))).text).toContain('/ruvllm-mod scan <text>')
    expect((await $.command.run(slash(''))).text).toContain('/ruvllm-mod status')
  })
})
