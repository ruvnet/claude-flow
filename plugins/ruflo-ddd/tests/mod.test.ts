import type { On } from 'claude-code'
import { describe, expect, test, tier } from 'claude-code/testing'

tier('user')

const ROOT = '/work'
const START = { surface: 'terminal', isInteractive: true, cwd: ROOT } as const
const slash = (args: string) => ({ command: 'ddd-mod', args, origin: { kind: 'composer' }, presentation: { isFullscreen: false, columns: 100 } }) as const
const STATUS = `${ROOT}/.claude-flow/ddd-mod/status.json`
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
    const r = await $.tool.call(call(((s: string) => ({ tool: 'mcp__plugin_ruflo-core_ruflo__memory_store', key: 'ddd-context-billing', value: `token ${s}` }))(SECRET))).then(
      x => x,
      (e: unknown) => ({ text: String(e) }),
    )
    expect(denied(r)).toContain('ruflo-')
    expect(denied(r)).not.toContain('went through')
    expect(denied(r)).not.toContain('ghp_')
    expect(JSON.parse(w.files.get(STATUS) ?? '{}')).toMatchObject({ version: 1, guard: true, blocked: 1 })
  })

  test('passes clean input and tools the plugin does not own', async ($, on) => {
    world(on)
    on('tool.call', () => ({ result: 'went through' }))
    await $.session.start(START)
    expect(denied(await $.tool.call(call({ tool: 'mcp__plugin_ruflo-core_ruflo__memory_store', key: 'ddd-context-billing', value: 'Created bounded context' })))).toContain('went through')
    expect(denied(await $.tool.call(call({ tool: 'Read', file_path: `/tmp/${SECRET}` })))).toContain('went through')
  })

  test('guard: off lets the call through', { options: { guard: 'off' } }, async ($, on) => {
    world(on)
    on('tool.call', () => ({ result: 'went through' }))
    await $.session.start(START)
    expect(denied(await $.tool.call(call(((s: string) => ({ tool: 'mcp__plugin_ruflo-core_ruflo__memory_store', key: 'ddd-context-billing', value: `token ${s}` }))(SECRET))))).toContain('went through')
  })
})

describe('guard scope', () => {
  test('a memory write outside the domain model is not this guard\'s business', async ($, on) => {
    world(on)
    on('tool.call', () => ({ result: 'went through' }))
    await $.session.start(START)
    expect(denied(await $.tool.call(call({ tool: 'mcp__plugin_ruflo-core_ruflo__memory_store', key: 'other-note', value: `token ${SECRET}` })))).toContain('went through')
  })

  test('a hierarchy edge between context: and aggregate: nodes is screened', async ($, on) => {
    world(on)
    on('tool.call', () => ({ result: 'went through' }))
    await $.session.start(START)
    const r = await $.tool.call(call({ tool: 'mcp__plugin_ruflo-core_ruflo__agentdb_hierarchical-store', parent: 'context:billing', child: `aggregate:${SECRET}`, relation: 'contains' })).then(
      x => x,
      (e: unknown) => ({ text: String(e) }),
    )
    expect(denied(r)).not.toContain('went through')
    expect(denied(r)).not.toContain('ghp_')
  })
})

describe('status file', () => {
  test('is written at session start with the defaults', async ($, on) => {
    const w = world(on)
    await $.session.start(START)
    expect(JSON.parse(w.files.get(STATUS) ?? '{}')).toEqual({ version: 1, updatedMs: 1_700_000_000_000, guard: true, blocked: 0 })
  })
})

describe('/ddd-mod', () => {
  test('status and scan answer locally, and help is the fallback', async ($, on) => {
    world(on)
    await $.session.start(START)
    expect((await $.command.run(slash('status'))).text).toBe('guard on · calls blocked 0')
    expect((await $.command.run(slash(`scan key ${SECRET}`))).text).toContain('github token')
    expect((await $.command.run(slash(`scan key ${SECRET}`))).text).not.toContain('ghp_')
    expect((await $.command.run(slash('scan plain words'))).text).toContain('Nothing found')
    expect((await $.command.run(slash(''))).text).toContain('/ddd-mod scan <text>')
    expect((await $.command.run(slash('what is this'))).text).toContain('Unknown: what')
  })

  test('contexts lists folders that hold a domain/ layer', async ($, on) => {
    world(on, [], {
      src: [{ name: 'billing', kind: 'dir' }, { name: 'shared', kind: 'dir' }, { name: 'index.ts', kind: 'file' }],
      'src/billing': [{ name: 'domain', kind: 'dir' }, { name: 'application', kind: 'dir' }],
      'src/shared': [{ name: 'util.ts', kind: 'file' }],
    })
    await $.session.start(START)
    const text = (await $.command.run(slash('contexts'))).text ?? ''
    expect(text).toContain('1 bounded context')
    expect(text).toContain('src/billing')
    expect(text).not.toContain('src/shared')
  })

  test('contexts says plainly when there is no src/', async ($, on) => {
    world(on)
    await $.session.start(START)
    expect((await $.command.run(slash('contexts'))).text).toContain('No bounded context found')
  })
})

describe('guard: the keys the ddd skills write', () => {
  test('a domain-<context> model entry is screened like ddd-*', async ($, on) => {
    world(on)
    on('tool.call', () => ({ result: 'went through' }))
    await $.session.start(START)
    const SECRET = `ghp_${'a1B2'.repeat(10)}`
    const store = (key: string, value: string) => call({ tool: 'mcp__plugin_ruflo-core_ruflo__memory_store', key, namespace: 'tasks', value })
    expect(denied(await $.tool.call(store('domain-billing', `token ${SECRET}`)).then(r => r, (e: unknown) => String(e)))).toContain('secret')
    expect(denied(await $.tool.call(store('domain-billing', 'Contexts: billing, shipping')))).toContain('went through')
    expect(denied(await $.tool.call(store('domainless', `token ${SECRET}`)))).toContain('went through')
  })
})
