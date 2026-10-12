/**
 * The session workspace over a real directory (ADR-486): the synthetic machine written to a temp folder and read through node's own file
 * system with link-aware stats, the way the host's `$.fs` reports them. A real symlink to a file outside the folder must never be read, a
 * linked project folder must never be entered, and a real pass over 20 sessions is timed.
 *   npx vitest run plugins/ruflo-console/tests/sessions-real-fs.spec.ts
 */
import { mkdirSync, mkdtempSync, rmSync, symlinkSync, utimesSync, writeFileSync } from 'node:fs'
import { lstat, open, readdir, readFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'

import { afterAll, describe, expect, it } from 'vitest'

import type { SessionFs } from '../hooks/data/harness'
import { rowOf } from '../hooks/data/sessions-index'
import { scanSessions, workspaceOf } from '../hooks/sessions'
import { NOW, uuid } from './fixtures/sessions-fs'
import { world } from './fixtures/sessions-world'

const root = mkdtempSync(join(tmpdir(), 'ruflo-sessions-'))

afterAll(() => rmSync(root, { recursive: true, force: true }))

const nodeFs: SessionFs = {
  read: path => readFile(path, 'utf8'),
  stat: async path => {
    const l = await lstat(path).catch(() => undefined)

    return l === undefined ? undefined : { size: l.size, mtimeMs: l.mtimeMs, kind: l.isFile() ? 'file' : l.isDirectory() ? 'dir' : 'other', isLink: l.isSymbolicLink() }
  },
  list: async path => Promise.all((await readdir(path, { withFileTypes: true })).map(async d => ({ name: d.name, kind: d.isSymbolicLink() ? 'symlink' : d.isDirectory() ? 'dir' : 'file', size: (await lstat(join(path, d.name))).size, mtimeMs: (await lstat(join(path, d.name))).mtimeMs }))),
  readTail: async (path, bytes) => {
    const handle = await open(path, 'r')

    try {
      const size = (await handle.stat()).size
      const n = Math.min(bytes, size)
      const buffer = Buffer.alloc(n)

      await handle.read(buffer, 0, n, size - n)

      return buffer.toString('utf8')
    } finally {
      await handle.close()
    }
  },
}

describe('over a real directory', () => {
  it('never reads through a real symlink, enters a linked folder, or follows a link out of the config directory', async () => {
    const w = world()
    const outside = join(root, 'outside-secret.jsonl')

    writeFileSync(outside, 'ESCAPED-SECRET-MARKER\n')

    for (const [path, file] of w.disk.files) {
      const real = join(root, path)

      if (file.kind === 'symlink' || file.statLink === true) continue

      mkdirSync(dirname(real), { recursive: true })
      writeFileSync(real, file.content)
      utimesSync(real, file.mtimeMs / 1000, file.mtimeMs / 1000)
    }

    const config = join(root, '/home/u/.claude')

    symlinkSync(outside, join(config, 'projects/-work-repo-c', `${uuid(12)}.jsonl`))
    mkdirSync(join(root, 'elsewhere'), { recursive: true })
    writeFileSync(join(root, 'elsewhere', `${uuid(13)}.jsonl`), 'ESCAPED-SECRET-MARKER\n')
    symlinkSync(join(root, 'elsewhere'), join(config, 'projects/-linked'))

    const state = world().state
    const reads: string[] = []
    const host = { fs: { ...nodeFs, read: (path: string) => (reads.push(path), nodeFs.read(path)) }, invalidate: () => undefined } as never

    state.configDir = config
    state.home = join(root, '/home/u')

    const started = performance.now()

    await scanSessions(state, host, true, NOW)

    const full = performance.now() - started
    const index = workspaceOf(state).index!
    const link = index.rows.find(row => row.nativeId === uuid(12))

    // The listing already says it is a link, so it is not a session at all (the synthetic spec covers a link only a stat reveals).
    expect(link).toBeUndefined()
    expect(index.rows.some(row => row.nativeId === uuid(13))).toBe(false)
    expect(reads.some(path => path.includes('outside-secret') || path.includes('elsewhere') || path.includes(uuid(12)))).toBe(false)
    expect(JSON.stringify([...index.rows])).not.toContain('ESCAPED-SECRET')
    expect(rowOf(index, `claude:${config}:${uuid(1)}`)?.preview?.latest).toContain('TOK1X')

    const again = performance.now()

    await scanSessions(state, host, false, NOW + 1000)
    console.log(`real disk: full pass ${full.toFixed(1)} ms, incremental pass ${(performance.now() - again).toFixed(1)} ms over ${index.rows.length} sessions`)
    expect(full).toBeLessThan(1000)
  })
})
