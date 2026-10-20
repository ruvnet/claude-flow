import type { On } from 'claude-code'
import { describe, expect, test, tier } from 'claude-code/testing'

tier('user')

const ROOT = '/work'
const START = { surface: 'terminal', isInteractive: true, cwd: ROOT } as const
const slash = (args: string) => ({ command: 'intelligence-mod', args, origin: { kind: 'composer' }, presentation: { isFullscreen: false, columns: 100 } }) as const
const SECRET = `ghp_${'a1B2'.repeat(10)}`
const STATUS = `${ROOT}/.claude-flow/intelligence-mod/status.json`

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
  test('session start registers /intelligence-mod and writes status.json (version 1, guard on)', async ($, on) => {
    const w = world(on)
    await $.session.start(START)
    expect(w.status()).toMatchObject({ version: 1, guard: true, blocked: 0, commands: 0 })
    expect(typeof w.status().updatedMs).toBe('number')
  })

  test('status, an unknown verb and help answer locally', async ($, on) => {
    world(on)
    await $.session.start(START)
    expect((await $.command.run(slash('status'))).text).toContain('guard on')
    expect((await $.command.run(slash('what is this'))).text).toContain('/intelligence-mod status')
    expect((await $.command.run(slash(''))).text).toContain('/intelligence-mod scan <text>')
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
  test('refuses a secret in a learned pattern, passes a clean one', async ($, on) => {
    const w = world(on)
    on('tool.call', () => ({ result: 'learned' }))
    await $.session.start(START)
    const denied = await attempt($, { tool: `${CORE}hooks_intelligence_pattern-store`, pattern: `auth uses ${SECRET}` })
    expect(denied).toContain('secret')
    expect(denied).not.toContain('ghp_')
    expect(await attempt($, { tool: `${CORE}hooks_intelligence_pattern-store`, pattern: 'retry with backoff' })).toContain('learned')
    expect(w.status()).toMatchObject({ blocked: 1 })
  })

  test('memory_store is screened only in pattern namespaces', async ($, on) => {
    world(on)
    on('tool.call', () => ({ result: 'learned' }))
    await $.session.start(START)
    expect(await attempt($, { tool: `${CORE}memory_store`, value: SECRET, namespace: 'patterns' })).toContain('secret')
    expect(await attempt($, { tool: `${CORE}memory_store`, value: SECRET, namespace: 'scratch' })).toContain('learned')
  })

  test('a transfer refuses an email address, a plain pattern publishes', async ($, on) => {
    world(on)
    on('tool.call', () => ({ result: 'published' }))
    await $.session.start(START)
    const denied = await attempt($, { tool: `${CORE}hooks_transfer`, action: 'store', patterns: 'owner is jane.doe@example.com' })
    expect(denied).toContain('IPFS is public')
    expect(denied).not.toContain('jane.doe')
    expect(await attempt($, { tool: `${CORE}hooks_transfer`, action: 'store', patterns: 'retry with backoff' })).toContain('published')
  })

  test('reset needs confirm: true', async ($, on) => {
    world(on)
    on('tool.call', () => ({ result: 'reset done' }))
    await $.session.start(START)
    expect(await attempt($, { tool: `${CORE}hooks_intelligence-reset` })).toContain('confirm: true')
    expect(await attempt($, { tool: `${CORE}hooks_intelligence-reset`, confirm: false })).toContain('confirm: true')
    expect(await attempt($, { tool: `${CORE}hooks_intelligence-reset`, confirm: true })).toContain('reset done')
  })

  test('confirmReset: off lets a bare reset through', { options: { confirmReset: 'off' } }, async ($, on) => {
    world(on)
    on('tool.call', () => ({ result: 'reset done' }))
    await $.session.start(START)
    expect(await attempt($, { tool: `${CORE}hooks_intelligence-reset` })).toContain('reset done')
  })

  test('guard: off lets a secret through', { options: { guard: 'off' } }, async ($, on) => {
    world(on)
    on('tool.call', () => ({ result: 'learned' }))
    await $.session.start(START)
    expect(await attempt($, { tool: `${CORE}neural_train`, data: SECRET })).toContain('learned')
  })
})

describe('/intelligence-mod stats', () => {
  test('reads hooks_intelligence_stats through the connected tool', async ($, on) => {
    const w = world(on, [`${CORE}hooks_intelligence_stats`], '{"patterns": 42}')
    await $.session.start(START)
    expect((await $.command.run(slash('stats'))).text).toContain('42')
    expect(w.calls[0]).toMatchObject({ tool: 'hooks_intelligence_stats' })
  })

  test('says plainly when no intelligence tool is connected', async ($, on) => {
    world(on)
    await $.session.start(START)
    expect((await $.command.run(slash('stats'))).text).toContain('No intelligence tool is connected')
  })
})
