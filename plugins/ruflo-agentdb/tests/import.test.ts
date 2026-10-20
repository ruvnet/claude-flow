import type { On } from 'claude-code'
import { describe, expect, test, tier } from 'claude-code/testing'

import { importPath, importVerdict, IMPORT_MAX_BYTES, isImport, readImport } from '../hooks/import'

tier('user')

const ROOT = '/work'
const HOME = '/home/u'
const TOKEN = 'ghp_Zq8vT3mK9wX2LpR7sNd4Zq8vT3mK9wX2LpR7'
const START = { surface: 'terminal', isInteractive: true, cwd: ROOT } as const
const call = (tool: string, input: Record<string, unknown>) => ({ tool, ...input }) as never

describe('which file memory_import would read', () => {
  test('inside the project root or the home', () => {
    expect(importPath({ inputPath: '/work/data/m.json' }, ROOT, HOME)).toBe('/work/data/m.json')
    expect(importPath({ inputPath: 'data/./m.json' }, ROOT, HOME)).toBe('/work/data/m.json')
    expect(importPath({ inputPath: '/home/u/notes/m.json' }, ROOT, HOME)).toBe('/home/u/notes/m.json')
  })

  test('traversal, outside paths, null bytes and non-strings are not read', () => {
    for (const inputPath of ['/work/../etc/passwd', '../x.json', '/etc/passwd', '/workshop/m.json', '/work', 'a\0b.json', 'a\\..\\b', '', 7, null, ['/work/m.json']])
      expect(importPath({ inputPath }, ROOT, HOME)).toBeUndefined()
    expect(importPath({}, ROOT, HOME)).toBeUndefined()
    expect(importPath('/work/m.json', ROOT, HOME)).toBeUndefined()
    expect(importPath({ inputPath: 'm.json' }, undefined, undefined)).toBeUndefined()
  })

  test('the tool is memory_import, bare or prefixed', () => {
    expect(isImport('memory_import')).toBe(true)
    expect(isImport('mcp__ruflo__memory_import')).toBe(true)
    expect(isImport('memory_import_claude')).toBe(false)
    expect(isImport('memory_export')).toBe(false)
  })
})

describe('the screen and the bounded read', () => {
  test('a file holding a secret is refused without echoing it', () => {
    const reason = importVerdict(JSON.stringify({ entries: [{ key: 'note', value: `token ${TOKEN}` }] }))
    expect(reason).toMatch(/secret/)
    expect(reason).not.toContain(TOKEN)
    expect(importVerdict(JSON.stringify({ rows: [['api_key', 'Zq8vT3mK9wX2LpR7sNd4']] }))).toMatch(/secret/)
    expect(importVerdict(`plain text with ${TOKEN}`)).toMatch(/secret/)
  })

  test('a clean file passes', () => {
    expect(importVerdict(JSON.stringify({ entries: [{ key: 'note', value: 'see the vault' }] }))).toBeUndefined()
  })

  const files = (stat: () => Promise<{ kind: string; size: number }>, read = async () => 'x') => ({ stat, read })

  test('an oversize file, a directory and any error fail open', async () => {
    let reads = 0
    const read = async () => (reads++, TOKEN)
    expect(await readImport(files(async () => ({ kind: 'file', size: IMPORT_MAX_BYTES + 1 }), read), '/work/a')).toBeUndefined()
    expect(await readImport(files(async () => ({ kind: 'dir', size: 10 }), read), '/work/a')).toBeUndefined()
    expect(await readImport(files(async () => Promise.reject(new Error('ENOENT')), read), '/work/a')).toBeUndefined()
    expect(await readImport(files(async () => ({ kind: 'file', size: 10 }), async () => Promise.reject(new Error('EACCES'))), '/work/a')).toBeUndefined()
    expect(reads).toBe(0)
    expect(await readImport(files(async () => ({ kind: 'file', size: IMPORT_MAX_BYTES }), read), '/work/a')).toBe(TOKEN)
  })
})

/** The mod's tool.call hook over a file map, with the guard on (its default). */
function world(on: On, fs: Map<string, { kind: string; size: number; text: string }>) {
  const reads: string[] = []
  on('session.start', ($, e) => ({ cwd: e.cwd }))
  on('session.root', () => ({ value: ROOT }))
  on('command.register', ($, e) => ({ value: { command: e.name } }))
  on('fs.write', () => ({ value: undefined }))
  on('env.get', () => ({ value: HOME }))
  on('fs.stat', ($, e) => {
    const f = fs.get(e.path)
    if (!f) throw new Error(`ENOENT: ${e.path}`)
    return { value: { kind: f.kind, size: f.size, mtimeMs: 1 } }
  })
  on('fs.read', ($, e) => (reads.push(e.path), { value: fs.get(e.path)?.text ?? '' }))
  return reads
}

type Dollar = Parameters<Parameters<typeof test>[1]>[0]
const run = ($: Dollar, tool: string, inputPath: unknown) => $.tool.call(call(tool, { inputPath })).then(r => r, (e: unknown) => ({ text: String(e) }))

const file = (text: string, kind = 'file') => ({ kind, size: text.length, text })

describe('memory_import through the mod', () => {
  test('refuses a file with a secret, under either name, and passes a clean one', async ($, on) => {
    on('tool.call', () => ({ result: 'imported' }))
    world(on, new Map([['/work/bad.json', file(`{"v":"${TOKEN}"}`)], ['/work/ok.json', file('{"v":"see the vault"}')]]))
    await $.session.start(START)
    for (const tool of ['memory_import', 'mcp__ruflo__memory_import']) {
      const bad = await run($, tool, '/work/bad.json')
      expect(JSON.stringify(bad)).toMatch(/secret/)
      expect(JSON.stringify(bad)).not.toContain(TOKEN)
      expect(JSON.stringify(await $.tool.call(call(tool, { inputPath: '/work/ok.json' })))).not.toMatch(/secret/)
    }
  })

  test('missing file, directory, oversize file, traversal and non-string all pass unread', async ($, on) => {
    on('tool.call', () => ({ result: 'imported' }))
    const reads = world(on, new Map([['/work/dir', file('', 'dir')], ['/work/big.json', { kind: 'file', size: IMPORT_MAX_BYTES + 1, text: TOKEN }]]))
    await $.session.start(START)
    for (const inputPath of ['/work/none.json', '/work/dir', '/work/big.json', '/work/../etc/x', 42])
      expect(JSON.stringify(await run($, 'memory_import', inputPath))).toContain('imported')
    expect(reads).toEqual([])
  })
})
