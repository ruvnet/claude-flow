import type { On } from 'claude-code'
import { describe, expect, test, tier } from 'claude-code/testing'

import { readOptions } from '../hooks/options'

tier('user')

const ROOT = '/work'
const START = { surface: 'terminal', isInteractive: true, cwd: ROOT } as const
const slash = (args: string) => ({ command: 'arena-mod', args, origin: { kind: 'composer' }, presentation: { isFullscreen: false, columns: 100 } }) as const
const STATUS = `${ROOT}/.claude-flow/arena-mod/status.json`

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
    expect(readOptions(undefined).guard).toBe(false)
    expect(readOptions({ guard: 'banana' }).guard).toBe(false)
    expect(readOptions({ guard: 'off' }).guard).toBe(false)
  })

  test('session start registers /arena-mod and writes the status file', async ($, on) => {
    const w = world(on)
    await $.session.start(START)
    expect(w.commands).toContain('arena-mod')
    expect(status(w.files)).toMatchObject({ version: 1, mod: 'arena', guard: false, blocked: 0 })
    expect(typeof status(w.files).updatedMs).toBe('number')
  })
})

describe('/arena-mod', () => {
  test('status answer locally', async ($, on) => {
    world(on)
    await $.session.start(START)
    expect((await $.command.run(slash('status'))).text).toContain('no tool is guarded')
    expect((await $.command.run(slash('strategies'))).text).toContain("tit-for-tat")
  })

  test('an unknown verb gets the help, not a model turn', async ($, on) => {
    world(on)
    await $.session.start(START)
    expect((await $.command.run(slash('what is this'))).text).toContain('/arena-mod status')
    expect((await $.command.run(slash(''))).text).toContain('/arena-mod status')
  })
})
