import type { On } from 'claude-code'
import { describe, expect, test, tier } from 'claude-code/testing'

import { answer } from '../hooks/command'
import { newStats } from '../hooks/status'
import { verdict, watched } from '../hooks/guard'

tier('user')

const ROOT = '/work'
const START = { surface: 'terminal', isInteractive: true, cwd: ROOT } as const
const slash = (args: string) => ({ command: 'testgen-mod', args, origin: { kind: 'composer' }, presentation: { isFullscreen: false, columns: 100 } }) as const
const STATUS = `${ROOT}/.claude-flow/testgen-mod/status.json`
const DISPATCH = 'mcp__plugin_ruflo-core_ruflo__hooks_worker-dispatch'

function world(on: On) {
  const files = new Map<string, string>()
  on('session.start', ($, e) => ({ cwd: e.cwd }))
  on('session.root', () => ({ value: ROOT }))
  on('command.register', ($, e) => ({ value: { command: e.name } }))
  on('fs.write', ($, e) => (files.set(e.path, e.text), { value: undefined }))
  on('tool.list', () => ({ value: [] }))
  on('clock.now', () => ({ value: 1_700_000_000_000 }))
  return files
}

describe('guard (observe-only)', () => {
  test('watches testgen calls by label and never refuses anything', () => {
    expect(watched(DISPATCH, {})).toBe('worker dispatch')
    expect(watched('mcp__plugin_ruflo-core_ruflo__memory_store', {})).toBeUndefined()
    expect(verdict(DISPATCH, { trigger: 'testgaps', note: 'ghp_' + 'a1B2'.repeat(10) })).toBeUndefined()
  })

  test('a watched call passes through unchanged and is counted in the status file', async ($, on) => {
    const files = world(on)
    on('tool.call', () => ({ result: 'done' }))
    await $.session.start(START)
    expect(JSON.stringify(await $.tool.call({ tool: DISPATCH, trigger: 'testgaps' } as never))).toContain('done')
    expect(JSON.stringify(await $.tool.call({ tool: 'mcp__plugin_ruflo-core_ruflo__memory_store', key: 'k' } as never))).toContain('done')
    expect(JSON.parse(files.get(STATUS) ?? '{}')).toMatchObject({ version: 1, checked: 1, blocked: 0, seen: { 'worker dispatch': 1 } })
  })
})

describe('status file', () => {
  test('written at session start', async ($, on) => {
    const files = world(on)
    await $.session.start(START)
    expect(JSON.parse(files.get(STATUS) ?? '{}')).toMatchObject({ version: 1, checked: 0, blocked: 0 })
  })
})

describe('/testgen-mod', () => {
  test('status and workers answer locally; unknown verbs get the help', async ($, on) => {
    world(on)
    await $.session.start(START)
    expect((await $.command.run(slash('status'))).text).toContain('observe-only')
    expect((await $.command.run(slash('workers'))).text).toContain('No worker has been dispatched')
    expect((await $.command.run(slash('what now'))).text).toContain('/testgen-mod workers')
  })

  test('workers counts dispatches', async () => {
    const stats = newStats()
    stats.seen['worker dispatch'] = 2
    expect(await answer('workers', { opts: { guard: true }, stats, tools: async () => [] })).toContain('2 worker dispatches')
  })
})
