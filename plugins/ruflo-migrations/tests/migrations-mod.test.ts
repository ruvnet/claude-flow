import type { On } from 'claude-code'
import { describe, expect, test, tier } from 'claude-code/testing'

tier('user')

const ROOT = '/work'
const STATUS = `${ROOT}/.claude-flow/migrations-mod/status.json`
const START = { surface: 'terminal', isInteractive: true, cwd: ROOT } as const
const slash = (args: string) => ({ command: 'migrations-mod', args, origin: { kind: 'composer' }, presentation: { isFullscreen: false, columns: 100 } }) as const
const KEY = `ghp_${'a1B2'.repeat(10)}`

/** The world beneath the mod: a project root, a file map, a command registry; every tool call is answered 'ok'. */
function world(on: On) {
  const files = new Map<string, string>()
  const registered: string[] = []
  on('session.start', ($, e) => ({ cwd: e.cwd }))
  on('session.root', () => ({ value: ROOT }))
  on('command.register', ($, e) => (registered.push(e.name), { value: { command: e.name } }))
  on('fs.write', ($, e) => (files.set(e.path, e.text), { value: undefined }))
  on('clock.now', () => ({ value: 1_700_000_000_000 }))
  on('tool.call', () => ({ result: 'ok' }))
  return { files, registered }
}

const call = (tool: string, input: Record<string, unknown>) => ({ tool, ...input }) as never
const store = (value: string) => call('mcp__plugin_ruflo-core_ruflo__memory_store', { key: 'k', namespace: 'migrations', value })
const status = (files: Map<string, string>) => JSON.parse(files.get(STATUS) ?? '{}')

/** Runs the call; a denial surfaces as a rejection or a deny result, flattened to text either way. */
async function outcome($: { tool: { call: (e: never) => Promise<unknown> } }, e: never): Promise<string> {
  try {
    return JSON.stringify(await $.tool.call(e))
  } catch (err) {
    return String(err)
  }
}

describe('session', () => {
  test('writes the status file and registers /migrations-mod, guard on by default', async ($, on) => {
    const w = world(on)
    await $.session.start(START)
    expect(w.registered).toEqual(['migrations-mod'])
    expect(status(w.files)).toMatchObject({ version: 1, guard: true, checked: 0, blocked: 0 })
    expect(typeof status(w.files).updatedMs).toBe('number')
  })
})

describe('guard', () => {
  test('refuses a secret in a memory write, passes a clean one, never echoes the value', async ($, on) => {
    const w = world(on)
    await $.session.start(START)
    const denied = await outcome($, store(`token ${KEY}`))
    expect(denied).toContain('ruflo-migrations')
    expect(denied).not.toContain('ghp_')
    expect(await outcome($, store('prefer small reversible steps'))).toContain('ok')
    expect(status(w.files)).toMatchObject({ checked: 2, blocked: 1, lastBlock: 'github token' })
  })

  test('ignores tools that are not this mod\'s business', async ($, on) => {
    const w = world(on)
    await $.session.start(START)
    expect(await outcome($, call('Bash', { command: `echo ${KEY}` }))).toContain('ok')
    expect(status(w.files).checked).toBe(0)
  })

  test('guard: off lets the write through', { options: { guard: 'off' } }, async ($, on) => {
    world(on)
    await $.session.start(START)
    expect(await outcome($, store(`token ${KEY}`))).toContain('ok')
  })

  test('refuses a database URL with an inline password, allows one without', async ($, on) => {
    world(on)
    await $.session.start(START)
    const denied = await outcome($, store('applied against postgres://app:hunter2hunter2@db.internal:5432/prod'))
    expect(denied).toContain('database URL')
    expect(denied).not.toContain('hunter2')
    expect(await outcome($, store('applied against postgres://db.internal:5432/prod'))).toContain('ok')
  })
})

describe('/migrations-mod', () => {
  test('status and scan answer locally', async ($, on) => {
    world(on)
    await $.session.start(START)
    expect((await $.command.run(slash('status'))).text).toContain('guard on')
    const hit = (await $.command.run(slash(`scan key ${KEY}`))).text ?? ''
    expect(hit).toContain('github token')
    expect(hit).not.toContain('ghp_')
    expect((await $.command.run(slash('scan plain words'))).text).toContain('Nothing')
    const lint = (await $.command.run(slash('scan DROP TABLE users; DELETE FROM sessions;'))).text ?? ''
    expect(lint).toContain('drop table, schema or database')
    expect(lint).toContain('delete without where')
    expect((await $.command.run(slash('scan DELETE FROM sessions WHERE id = 1;'))).text).toContain('Nothing destructive')
  })

  test('an unknown verb or none gets the help, not a model turn', async ($, on) => {
    world(on)
    await $.session.start(START)
    expect((await $.command.run(slash('how do I do this'))).text).toContain('/migrations-mod status')
    expect((await $.command.run(slash(''))).text).toContain('/migrations-mod scan')
  })
})

describe('guard: a write to a namespace this plugin does not own', () => {
  const put = (namespace: string | undefined, value: string) =>
    call('mcp__plugin_ruflo-core_ruflo__memory_store', { key: 'k', ...(namespace === undefined ? {} : { namespace }), value })

  test('is refused exactly as before, but the message neither claims the write nor echoes anything', async ($, on) => {
    world(on)
    await $.session.start(START)
    const own = await outcome($, put('migrations', `token ${KEY}`))
    expect(own).toContain('ruflo-migrations')
    expect(own).toContain('this memory write')
    for (const ns of ['unrelated-notes', undefined, 'x'.repeat(80)]) {
      const denied = await outcome($, put(ns, `token ${KEY}`))
      expect(denied).toContain('secret-shaped value')
      expect(denied).toMatch(ns === undefined ? /no namespace/ : new RegExp(`targeted namespace \\\\?"${ns.slice(0, 40)}\\\\?"`))
      expect(denied).not.toMatch(/this memory write|migration name|database URL/)
      expect(denied).not.toContain('ghp_')
      expect(denied).toContain('reference')
    }
    expect(await outcome($, put('unrelated-notes', 'prefer small reversible steps'))).toContain('ok')
  })

  test('a secret-shaped namespace is refused and never repeated', async ($, on) => {
    world(on)
    await $.session.start(START)
    const denied = await outcome($, put(KEY, 'a plain note'))
    expect(denied).toContain('secret-shaped value')
    expect(denied).not.toContain('ghp_')
  })
})
