import type { On } from 'claude-code'
import { describe, expect, test, tier } from 'claude-code/testing'

tier('user')

const ROOT = '/work'
const START = { surface: 'terminal', isInteractive: true, cwd: ROOT } as const
const STATUS = `${ROOT}/.claude-flow/rvf-mod/status.json`
const slash = (args: string) => ({ command: 'rvf-mod', args, origin: { kind: 'composer' }, presentation: { isFullscreen: false, columns: 100 } }) as const

const WRITER = 'mcp__plugin_ruflo-core_ruflo__session_save'
const READER = 'mcp__plugin_ruflo-core_ruflo__session_list'
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

  test('session_import, memory_import, config_import: bulk imports are screened like a write', async ($, on) => {
    world(on)
    await $.session.start(START)
    for (const name of ["session_import","memory_import","config_import"]) {
      const tool = `mcp__plugin_ruflo-core_ruflo__${name}`
      const denied = JSON.stringify(await attempt($.tool.call({ tool, data: { entries: [{ note: `token ${SECRET}` }] } } as never)))
      expect(denied).toContain('secret')
      expect(denied).not.toContain('ghp_')
      expect(JSON.stringify(await $.tool.call({ tool, data: { entries: [{ note: 'a plain note' }] } } as never))).toContain('done')
    }
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

describe('/rvf-mod', () => {
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
    expect((await $.command.run(slash('how do I do it'))).text).toContain('/rvf-mod scan <text>')
    expect((await $.command.run(slash(''))).text).toContain('/rvf-mod status')
  })
})

describe('guard: a write to a namespace this plugin does not own', () => {
  const STORE = 'mcp__plugin_ruflo-core_ruflo__memory_store'
  const put = (namespace: string | undefined, value: string) => ({ tool: STORE, key: 'k', ...(namespace === undefined ? {} : { namespace }), value }) as never
  const text = async ($: { tool: { call: (e: never) => Promise<unknown> } }, e: never) => JSON.stringify(await attempt($.tool.call(e)))

  test('is refused exactly as before, but the message neither claims the write nor echoes anything', async ($, on) => {
    world(on)
    await $.session.start(START)
    const own = await text($, put('rvf-sessions', `token ${SECRET}`))
    expect(own).toContain('ruflo-rvf')
    expect(own).toContain('this call holds')
    for (const ns of ['unrelated-notes', undefined, 'x'.repeat(80)]) {
      const denied = await text($, put(ns, `token ${SECRET}`))
      expect(denied).toContain('secret-shaped value')
      expect(denied).toMatch(ns === undefined ? /no namespace/ : new RegExp(`targeted namespace \\\\?"${ns.slice(0, 40)}\\\\?"`))
      expect(denied).not.toMatch(/this call holds|vector store|shared brain/)
      expect(denied).not.toContain('ghp_')
      expect(denied).toContain('reference')
    }
    expect(await text($, put('unrelated-notes', 'a plain note about indexing'))).toContain('done')
  })

  test('a secret-shaped namespace is refused and never repeated', async ($, on) => {
    world(on)
    await $.session.start(START)
    const denied = await text($, put(SECRET, 'a plain note'))
    expect(denied).toContain('secret-shaped value')
    expect(denied).not.toContain('ghp_')
  })
})
