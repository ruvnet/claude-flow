import type { On } from 'claude-code'
import { describe, expect, test, tier } from 'claude-code/testing'

import { readOptions } from '../hooks/options'

tier('user')

const ROOT = '/work'
const START = { surface: 'terminal', isInteractive: true, cwd: ROOT } as const
const slash = (args: string) => ({ command: 'adr-mod', args, origin: { kind: 'composer' }, presentation: { isFullscreen: false, columns: 100 } }) as const
const STATUS = `${ROOT}/.claude-flow/adr-mod/status.json`

// Built at run time so no secret-shaped literal sits in the source.
const ghp = `ghp_${'a1B2'.repeat(10)}`

/** The world beneath the mod: a project root, a file map, command registration and a clock. */
function world(on: On) {
  const files = new Map<string, string>()
  const commands: string[] = []
  on('session.start', ($, e) => ({ cwd: e.cwd }))
  on('session.root', () => ({ value: ROOT }))
  on('command.register', ($, e) => (commands.push(e.name), { value: { command: e.name } }))
  on('fs.write', ($, e) => (files.set(e.path, e.text), { value: undefined }))
  on('clock.now', () => ({ value: Date.now() }))
  return { files, commands }
}
const status = (files: Map<string, string>) => JSON.parse(files.get(STATUS) ?? '{}')

describe('defaults', () => {
  test('options: bad values fall back to the safe default', () => {
    expect(readOptions(undefined).guard).toBe(true)
    expect(readOptions({ guard: 'banana' }).guard).toBe(true)
    expect(readOptions({ guard: 'off' }).guard).toBe(false)
  })

  test('session start registers /adr-mod and writes the status file', async ($, on) => {
    const w = world(on)
    await $.session.start(START)
    expect(w.commands).toContain('adr-mod')
    expect(status(w.files)).toMatchObject({ version: 1, mod: 'adr', guard: true, blocked: 0 })
    expect(typeof status(w.files).updatedMs).toBe('number')
  })
})

describe('guard', () => {
  test('refuses a secret, passes a clean call, ignores tools it does not own, never echoes the secret', async ($, on) => {
    const w = world(on)
    on('tool.call', () => ({ result: 'went through' }))
    await $.session.start(START)

    const denied = await $.tool.call(({ tool: "mcp__plugin_ruflo-core_ruflo__agentdb_hierarchical-store", namespace: "adr-patterns", key: "ADR-0001", value: `${ghp}` }) as never).then(
      r => r,
      (e: unknown) => ({ text: String(e) }),
    )
    expect(JSON.stringify(denied)).toContain('secret')
    expect(JSON.stringify(denied)).not.toContain('ghp_')
    expect(JSON.stringify(await $.tool.call(({ tool: "mcp__plugin_ruflo-core_ruflo__agentdb_hierarchical-store", namespace: "adr-patterns", key: "ADR-0001", value: "Use HNSW for pattern search" }) as never))).toContain('went through')
    expect(JSON.stringify(await $.tool.call(({ tool: "mcp__plugin_ruflo-core_ruflo__memory_store", namespace: "notes", key: "k", value: `${ghp}` }) as never))).toContain('went through')
    expect(status(w.files)).toMatchObject({ blocked: 1 })
  })

  test('guard: off lets the call through', { options: { guard: 'off' } }, async ($, on) => {
    world(on)
    on('tool.call', () => ({ result: 'went through' }))
    await $.session.start(START)
    expect(JSON.stringify(await $.tool.call(({ tool: "mcp__plugin_ruflo-core_ruflo__agentdb_hierarchical-store", namespace: "adr-patterns", key: "ADR-0001", value: `${ghp}` }) as never))).toContain('went through')
  })
})

describe('/adr-mod', () => {
  test('status and scan answer locally', async ($, on) => {
    world(on)
    await $.session.start(START)
    expect((await $.command.run(slash('status'))).text).toContain('guard on')
    expect((await $.command.run(slash(`scan key ${ghp}`))).text).toContain('github token')
    expect((await $.command.run(slash(`scan key ${ghp}`))).text).not.toContain('ghp_')
    expect((await $.command.run(slash('scan plain words'))).text).toContain('Nothing found')
    expect((await $.command.run(slash('format'))).text).toContain("Consequences")
  })

  test('an unknown verb gets the help, not a model turn', async ($, on) => {
    world(on)
    await $.session.start(START)
    expect((await $.command.run(slash('what is this'))).text).toContain('/adr-mod status')
    expect((await $.command.run(slash(''))).text).toContain('/adr-mod status')
  })
})

describe('guard: the writes the adr-create skill really makes', () => {
  const P = 'mcp__plugin_ruflo-core_ruflo__'
  const text = async (p: Promise<unknown>) => JSON.stringify(await p.then(r => r, (e: unknown) => ({ text: String(e) })))

  test('hierarchical-store has no namespace field: the mem:ADR key marks the entry, and a secret in it is refused', async ($, on) => {
    const w = world(on)
    on('tool.call', () => ({ result: 'went through' }))
    await $.session.start(START)
    const denied = await text($.tool.call(({ tool: `${P}agentdb_hierarchical-store`, key: 'mem:ADR-0007', tier: 'semantic', value: JSON.stringify({ note: ghp }) }) as never))
    expect(denied).toContain('secret')
    expect(denied).not.toContain('ghp_')
    expect(await text($.tool.call(({ tool: `${P}agentdb_hierarchical-store`, key: 'mem:ADR-0007', tier: 'semantic', value: '{"title":"Use HNSW"}' }) as never))).toContain('went through')
    expect(await text($.tool.call(({ tool: `${P}agentdb_hierarchical-store`, key: 'scratch', tier: 'working', value: ghp }) as never))).toContain('went through')
    expect(status(w.files)).toMatchObject({ blocked: 1 })
  })

  test('a causal edge between mem:ADR ids is screened', async ($, on) => {
    world(on)
    on('tool.call', () => ({ result: 'went through' }))
    await $.session.start(START)
    expect(await text($.tool.call(({ tool: `${P}agentdb_causal-edge`, sourceId: 'mem:ADR-0002', targetId: 'mem:ADR-0001', relation: ghp }) as never))).toContain('secret')
    expect(await text($.tool.call(({ tool: `${P}agentdb_causal-edge`, sourceId: 'mem:ADR-0002', targetId: 'mem:ADR-0001', relation: 'depends-on' }) as never))).toContain('went through')
    expect(await text($.tool.call(({ tool: `${P}agentdb_causal-edge`, sourceId: 'a', targetId: 'b', relation: ghp }) as never))).toContain('went through')
  })
})
