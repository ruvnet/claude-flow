import type { On } from 'claude-code'
import { describe, expect, test, tier } from 'claude-code/testing'

tier('user')

const ROOT = '/work'
const START = { surface: 'terminal', isInteractive: true, cwd: ROOT } as const
const slash = (args: string) => ({ command: 'deepseek-mod', args, origin: { kind: 'composer' }, presentation: { isFullscreen: false, columns: 100 } }) as const
const STATUS = `${ROOT}/.claude-flow/deepseek-mod/status.json`
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
    const r = await $.tool.call(call(((s: string) => ({ tool: 'Bash', command: `node plugins/ruflo-deepseek-harness/scripts/chat.mjs --prompt "use ${s}"` }))(SECRET))).then(
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
    expect(denied(await $.tool.call(call({ tool: 'Bash', command: 'node plugins/ruflo-deepseek-harness/scripts/chat.mjs --prompt "hello"' })))).toContain('went through')
    expect(denied(await $.tool.call(call({ tool: 'Read', file_path: `/tmp/${SECRET}` })))).toContain('went through')
  })

  test('guard: off lets the call through', { options: { guard: 'off' } }, async ($, on) => {
    world(on)
    on('tool.call', () => ({ result: 'went through' }))
    await $.session.start(START)
    expect(denied(await $.tool.call(call(((s: string) => ({ tool: 'Bash', command: `node plugins/ruflo-deepseek-harness/scripts/chat.mjs --prompt "use ${s}"` }))(SECRET))))).toContain('went through')
  })
})

describe('status file', () => {
  test('is written at session start with the defaults', async ($, on) => {
    const w = world(on)
    await $.session.start(START)
    expect(JSON.parse(w.files.get(STATUS) ?? '{}')).toEqual({ version: 1, updatedMs: 1_700_000_000_000, guard: true, blocked: 0 })
  })
})

describe('/deepseek-mod', () => {
  test('status and scan answer locally, and help is the fallback', async ($, on) => {
    world(on)
    await $.session.start(START)
    expect((await $.command.run(slash('status'))).text).toBe('guard on · calls blocked 0')
    expect((await $.command.run(slash(`scan key ${SECRET}`))).text).toContain('github token')
    expect((await $.command.run(slash(`scan key ${SECRET}`))).text).not.toContain('ghp_')
    expect((await $.command.run(slash('scan plain words'))).text).toContain('Nothing found')
    expect((await $.command.run(slash(''))).text).toContain('/deepseek-mod scan <text>')
    expect((await $.command.run(slash('what is this'))).text).toContain('Unknown: what')
  })

})

describe('guard: an installed copy of the scripts', () => {
  test('a script under a plugin-cache version directory is screened like the repo path', async ($, on) => {
    world(on)
    on('tool.call', () => ({ result: 'went through' }))
    await $.session.start(START)
    const SECRET = `ghp_${'a1B2'.repeat(10)}`
    const run = (prompt: string) => call({ tool: 'Bash', command: `node ~/.claude/plugins/cache/ruflo/ruflo-deepseek-harness/0.2.0/scripts/reason.mjs --prompt "${prompt}"` })
    expect(denied(await $.tool.call(run(`use ${SECRET}`)).then(r => r, (e: unknown) => String(e)))).toContain('api.deepseek.com')
    expect(denied(await $.tool.call(run('hello')))).toContain('went through')
  })
})
