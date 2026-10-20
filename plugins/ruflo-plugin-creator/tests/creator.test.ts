import type { On } from 'claude-code'
import { describe, expect, test, tier } from 'claude-code/testing'

tier('user')

const ROOT = '/work'
const START = { surface: 'terminal', isInteractive: true, cwd: ROOT } as const
const STATUS = `${ROOT}/.claude-flow/creator-mod/status.json`
const slash = (args: string) => ({ command: 'creator-mod', args, origin: { kind: 'composer' }, presentation: { isFullscreen: false, columns: 100 } }) as const

/** The engine resolves paths against the real cwd; the fixture is keyed on the part the mod typed. */
const rel = (p: string) => p.replace(/^.*\/plugins\/ruflo-plugin-creator\//, '')

/** A project root, a file map for writes, and a small read-only plugin tree. */
function world(on: On) {
  const files = new Map<string, string>()
  const tree: Record<string, string> = {
    'demo/.claude-plugin/plugin.json': JSON.stringify({ name: 'demo', version: '1.2.0', userConfig: { guard: {} } }),
    'demo/hooks/hooks.json': JSON.stringify({ modules: ['./register.ts'] }),
  }
  const dirs: Record<string, { name: string; kind: string; size: number; mtimeMs: number; isLink: boolean }[]> = {
    'demo/commands': [{ name: 'demo.md', kind: 'file', size: 1, mtimeMs: 0, isLink: false }],
    'demo/skills': [{ name: 'demo-skill', kind: 'directory', size: 0, mtimeMs: 0, isLink: false }],
  }
  on('session.start', ($, e) => ({ cwd: e.cwd }))
  on('session.root', () => ({ value: ROOT }))
  on('command.register', ($, e) => ({ value: { command: e.name } }))
  on('fs.write', ($, e) => (files.set(e.path, e.text), { value: undefined }))
  on('fs.read', ($, e) => {
    const text = tree[rel(e.path)]
    if (text === undefined) throw new Error('ENOENT')
    return { value: text }
  })
  on('fs.list', ($, e) => {
    const entries = dirs[rel(e.path ?? '')]
    if (entries === undefined) throw new Error('ENOENT')
    return { value: entries }
  })
  on('clock.now', () => ({ value: 5_000 }))
  return { status: () => JSON.parse(files.get(STATUS) ?? '{}') }
}

describe('status file', () => {
  test('written at session start, rewritten after a lookup', async ($, on) => {
    const w = world(on)
    await $.session.start(START)
    expect(w.status()).toMatchObject({ version: 1, updatedMs: 5000, checked: 0, reserved: 0 })
    await $.command.run(slash('check demo'))
    expect(w.status()).toMatchObject({ checked: 1, lastTarget: 'demo' })
  })
})

describe('/creator-mod', () => {
  test('status and help answer locally', async ($, on) => {
    world(on)
    await $.session.start(START)
    expect((await $.command.run(slash('status'))).text).toContain('checks run 0')
    expect((await $.command.run(slash(''))).text).toContain('/creator-mod reserved <plugin-dir>')
    expect((await $.command.run(slash('wat'))).text).toContain('Unknown: wat')
  })

  test('reserved lists the commands and skills a mod command must not reuse', async ($, on) => {
    world(on)
    await $.session.start(START)
    const text = (await $.command.run(slash('reserved demo/'))).text ?? ''
    expect(text).toContain('demo')
    expect(text).toContain('demo-skill')
  })

  test('check reports the manifest, hooks and options', async ($, on) => {
    world(on)
    await $.session.start(START)
    const text = (await $.command.run(slash('check demo'))).text ?? ''
    expect(text).toContain('demo 1.2.0')
    expect(text).toContain('mod modules 1 · userConfig options 1')
  })

  test('a missing plugin and a parent traversal are refused plainly', async ($, on) => {
    world(on)
    await $.session.start(START)
    expect((await $.command.run(slash('check nowhere'))).text).toContain('no readable')
    expect((await $.command.run(slash('check ../../etc'))).text).toContain('no .. segments')
    expect((await $.command.run(slash('check'))).text).toContain('usage')
  })
})
