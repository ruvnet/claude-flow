import type { On } from 'claude-code'
import { describe, expect, test, tier } from 'claude-code/testing'

import { answer } from '../hooks/command'
import { readOptions } from '../hooks/options'
import { hasSecret, secretsIn } from '../hooks/screen'
import { newStats } from '../hooks/status'

tier('user')

const ROOT = '/work'
const START = { surface: 'terminal', isInteractive: true, cwd: ROOT } as const
const slash = (args: string) => ({ command: 'secaudit-mod', args, origin: { kind: 'composer' }, presentation: { isFullscreen: false, columns: 100 } }) as const
const STATUS = `${ROOT}/.claude-flow/secaudit-mod/status.json`

// Built at run time so no secret-shaped literal sits in the source.
const ghp = `ghp_${'a1B2'.repeat(10)}`
const bearer = 'Zm9vYmFyYmF6cXV4MTIzNDU2Nzg5MGFiY2RlZg'

/** The world beneath the mod: a project, a file map, and the connected tools. */
function world(on: On, tools: readonly string[] = ['mcp__plugin_ruflo-core_ruflo__x_federation_publish']) {
  const files = new Map<string, string>()
  on('session.start', ($, e) => ({ cwd: e.cwd }))
  on('session.root', () => ({ value: ROOT }))
  on('command.register', ($, e) => ({ value: { command: e.name } }))
  on('fs.write', ($, e) => (files.set(e.path, e.text), { value: undefined }))
  on('tool.list', () => ({ value: tools.map(name => ({ name, description: '', mcp: true })) }))
  on('clock.now', () => ({ value: 1_700_000_000_000 }))
  on('clock.sleep', () => ({ value: undefined }))
  return files
}

const deny = async (call: () => Promise<unknown>) => JSON.stringify(await call().then(r => r, (e: unknown) => ({ text: String(e) })))

describe('defaults', () => {
  test('guard on; a bad value is the default', () => {
    expect(readOptions(undefined)).toEqual({ guard: true })
    expect(readOptions({ guard: 'off' })).toEqual({ guard: false })
    expect(readOptions({ guard: 'banana' })).toEqual({ guard: true })
  })
})

describe('screen', () => {
  test('names secret shapes and never returns the value', () => {
    expect(secretsIn(`k ${ghp}`)).toEqual(['github token'])
    expect(JSON.stringify(secretsIn(`k ${ghp}`))).not.toContain('ghp_')
    expect(hasSecret('password = hunter2hunter2hunter2')).toBe(true)
    expect(hasSecret('the password field is validated server side')).toBe(false)
    expect(hasSecret(`ghp_\u200b${'a1B2'.repeat(10)}`)).toBe(true)
  })
})

describe('status file', () => {
  test('written at session start with version and mode', async ($, on) => {
    const files = world(on)
    await $.session.start(START)
    expect(JSON.parse(files.get(STATUS) ?? '{}')).toMatchObject({ version: 1, guard: true, checked: 0, blocked: 0 })
  })
})

describe('guard', () => {
  const BAD = { tool: 'mcp__plugin_ruflo-core_ruflo__memory_store', namespace: 'security-findings', key: 'f1', value: `leaked ${ghp} in config.ts` } as never
  const GOOD = { tool: 'mcp__plugin_ruflo-core_ruflo__memory_store', namespace: 'security-findings', key: 'f1', value: 'AWS key at src/a.ts:10 (redacted)' } as never
  const OTHER = { tool: 'mcp__plugin_ruflo-core_ruflo__memory_store', namespace: 'default', key: 'f1', value: `note ${ghp}` } as never

  test('refuses a secret, never echoes it, and counts it in the status file', async ($, on) => {
    const files = world(on)
    on('tool.call', () => ({ result: 'done' }))
    await $.session.start(START)
    const out = await deny(() => $.tool.call(BAD))
    expect(out).toContain('secret')
    expect(out).not.toContain(ghp)
    expect(out).not.toContain(bearer)
    expect(JSON.parse(files.get(STATUS) ?? '{}')).toMatchObject({ checked: 1, blocked: 1, seen: { 'audit-memory write': 1 } })
  })

  test('passes clean input and ignores calls that are not this plugin\'s', async ($, on) => {
    world(on)
    on('tool.call', () => ({ result: 'done' }))
    await $.session.start(START)
    expect(await deny(() => $.tool.call(GOOD))).toContain('done')
    expect(await deny(() => $.tool.call(OTHER))).toContain('done')
  })

  test('off lets the call through', { options: { guard: 'off' } }, async ($, on) => {
    world(on)
    on('tool.call', () => ({ result: 'done' }))
    await $.session.start(START)
    expect(await deny(() => $.tool.call(BAD))).toContain('done')
  })
})

describe('/secaudit-mod', () => {
  test('status, scan and namespaces answer locally', async ($, on) => {
    world(on)
    await $.session.start(START)
    expect((await $.command.run(slash('status'))).text).toContain('guard on')
    expect((await $.command.run(slash(`scan key ${ghp}`))).text).toContain('github token')
    expect((await $.command.run(slash('scan plain words'))).text).toContain('Nothing found')
    expect((await $.command.run(slash('namespaces'))).text).toContain('Guarded memory namespaces')
  })

  test('an unknown verb gets the help, not a model turn', async ($, on) => {
    world(on)
    await $.session.start(START)
    expect((await $.command.run(slash('how do I do this'))).text).toContain('/secaudit-mod status')
    expect((await $.command.run(slash(''))).text).toContain('/secaudit-mod status')
  })

  test('answer() is pure over its inputs', async () => {
    const text = await answer('status', { opts: { guard: false }, stats: newStats(), tools: async () => [] })
    expect(text).toContain('guard off')
  })
})
