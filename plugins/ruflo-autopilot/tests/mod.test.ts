import type { On } from 'claude-code'
import { describe, expect, test, tier } from 'claude-code/testing'

import { readOptions } from '../hooks/options'

tier('user')

const ROOT = '/work'
const START = { surface: 'terminal', isInteractive: true, cwd: ROOT } as const
const slash = (args: string) => ({ command: 'autopilot-mod', args, origin: { kind: 'composer' }, presentation: { isFullscreen: false, columns: 100 } }) as const
const STATUS = `${ROOT}/.claude-flow/autopilot-mod/status.json`

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
    expect(readOptions(undefined).iterationCap).toBe(1000)
    expect(readOptions({ iterationCap: 'x' }).iterationCap).toBe(1000)
    expect(readOptions({ iterationCap: 1 }).iterationCap).toBe(10)
  })

  test('session start registers /autopilot-mod and writes the status file', async ($, on) => {
    const w = world(on)
    await $.session.start(START)
    expect(w.commands).toContain('autopilot-mod')
    expect(status(w.files)).toMatchObject({ version: 1, mod: 'autopilot', guard: true, blocked: 0 })
    expect(typeof status(w.files).updatedMs).toBe('number')
  })
})

describe('guard', () => {
  test('refuses a secret, passes a clean call, ignores tools it does not own, never echoes the secret', async ($, on) => {
    const w = world(on)
    on('tool.call', () => ({ result: 'went through' }))
    await $.session.start(START)

    const denied = await $.tool.call(({ tool: "mcp__plugin_ruflo-core_ruflo__autopilot_log", message: `used ${ghp}` }) as never).then(
      r => r,
      (e: unknown) => ({ text: String(e) }),
    )
    expect(JSON.stringify(denied)).toContain('secret')
    expect(JSON.stringify(denied)).not.toContain('ghp_')
    expect(JSON.stringify(await $.tool.call(({ tool: "mcp__plugin_ruflo-core_ruflo__autopilot_log", message: "finished task 3" }) as never))).toContain('went through')
    expect(JSON.stringify(await $.tool.call(({ tool: "mcp__plugin_ruflo-core_ruflo__autopilot_status", note: `${ghp}` }) as never))).toContain('went through')
    expect(status(w.files)).toMatchObject({ blocked: 1 })
  })

  test('guard: off lets the call through', { options: { guard: 'off' } }, async ($, on) => {
    world(on)
    on('tool.call', () => ({ result: 'went through' }))
    await $.session.start(START)
    expect(JSON.stringify(await $.tool.call(({ tool: "mcp__plugin_ruflo-core_ruflo__autopilot_log", message: `used ${ghp}` }) as never))).toContain('went through')
  })

  test('a loop limit over the cap is refused, one under it passes', async ($, on) => {
    world(on)
    on('tool.call', () => ({ result: 'went through' }))
    await $.session.start(START)
    const call = (maxIterations: number) => $.tool.call({ tool: 'mcp__plugin_ruflo-core_ruflo__autopilot_config', maxIterations } as never).then(r => r, (e: unknown) => ({ text: String(e) }))
    expect(JSON.stringify(await call(1_000_000))).toContain('iterationCap')
    expect(JSON.stringify(await call(50))).toContain('went through')
  })
})

describe('/autopilot-mod', () => {
  test('status and scan answer locally', async ($, on) => {
    world(on)
    await $.session.start(START)
    expect((await $.command.run(slash('status'))).text).toContain('guard on')
    expect((await $.command.run(slash(`scan key ${ghp}`))).text).toContain('github token')
    expect((await $.command.run(slash(`scan key ${ghp}`))).text).not.toContain('ghp_')
    expect((await $.command.run(slash('scan plain words'))).text).toContain('Nothing found')
    expect((await $.command.run(slash('limits'))).text).toContain("iteration cap 1000")
  })

  test('an unknown verb gets the help, not a model turn', async ($, on) => {
    world(on)
    await $.session.start(START)
    expect((await $.command.run(slash('what is this'))).text).toContain('/autopilot-mod status')
    expect((await $.command.run(slash(''))).text).toContain('/autopilot-mod status')
  })
})
