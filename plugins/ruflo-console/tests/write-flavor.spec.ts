/**
 * The Windows write flavor (A4): Claude Code's process environment on Windows has no uname, dd, sh, install, mkdir or cp, so there every
 * console disk write goes through the host's own file API (`$.fs.read` / `$.fs.write` / `$.fs.exists`). These tests pin: the flavor choice,
 * that the Linux GNU and macOS/BSD argv are byte-identical to what shipped before, and what `writeVia` does on a fake host-fs.
 */
import { createHash } from 'node:crypto'

import { afterEach, beforeEach, describe, expect, it } from 'vitest'

import { BATCH_MAX, flush, pendingOf, queueLine, resetIo } from '../hooks/activity-io'
import { encodeEvent, EVENTS_FILE } from '../hooks/data/activity-store'
import { appendArgv } from '../hooks/data/append-argv'
import { touchArgv } from '../hooks/data/ap-journal'
import { copyExclusiveArgv, newFileArgv, removeFileArgv, replaceFileArgv } from '../hooks/data/wf-file'
import { flavorOfKernel, flavorOfPlatform, setWriteFlavor, startWriteFlavor, writeFlavorReady } from '../hooks/data/write-flavor'
import { KILL_CLEARED } from '../hooks/data/ap-envelope'
import { HOST_FS_MAX, writeVia, type WriteHost } from '../hooks/data/write-via'

const P = '/work/proj/a b;$(x).jsonl'
const S = '/work/proj/src.jsonl'
const digest = (flavor: 'gnu' | 'posix') =>
  createHash('sha256')
    .update(JSON.stringify([appendArgv(P, flavor), newFileArgv(P, true, flavor), newFileArgv(P, false, flavor), replaceFileArgv(P, true, flavor), replaceFileArgv(P, false, flavor), copyExclusiveArgv(S, P, flavor), touchArgv(P, flavor), removeFileArgv(P)]))
    .digest('hex')

afterEach(() => {
  setWriteFlavor(null)
  resetIo()
})

describe('which flavor', () => {
  it('Windows takes host-fs; Linux gnu; darwin and the BSDs posix', () => {
    expect(flavorOfPlatform('win32')).toBe('host-fs')
    expect(flavorOfPlatform('linux')).toBe('gnu')
    expect(flavorOfPlatform('darwin')).toBe('posix')
    expect(flavorOfPlatform('freebsd')).toBe('posix')
  })

  it('the uname answers are unchanged: Linux gnu, every other kernel posix', () => {
    expect(flavorOfKernel('Linux')).toBe('gnu')
    expect(flavorOfKernel('Darwin')).toBe('posix')
  })

  it('a Windows working directory is a Windows engine even where the runtime does not expose its platform', async () => {
    const asked: (readonly string[])[] = []

    expect(await startWriteFlavor(async argv => (asked.push(argv), { exitCode: 0, stdout: 'Linux\n' }), undefined, 'C:\\Users\\me\\proj')).toBe('host-fs')
    expect(asked).toEqual([])
  })

  it('on a Windows engine no uname is run at all', async () => {
    const asked: (readonly string[])[] = []

    expect(await startWriteFlavor(async argv => (asked.push(argv), { exitCode: 0, stdout: 'Linux\n' }), 'win32')).toBe('host-fs')
    expect(await writeFlavorReady()).toBe('host-fs')
    expect(asked).toEqual([])
  })

  it('elsewhere the detection is the uname one', async () => {
    expect(await startWriteFlavor(async () => ({ exitCode: 0, stdout: 'Darwin\n' }), 'linux')).toBe('posix')
  })
})

describe('the argv that shipped before is unchanged', () => {
  it('GNU (Linux) literals', () => {
    expect(appendArgv(P, 'gnu')).toEqual(['dd', `of=${P}`, 'oflag=append', 'conv=notrunc', 'bs=1M', 'iflag=fullblock', 'status=none'])
    expect(newFileArgv(P, true, 'gnu')).toEqual(['dd', `of=${P}`, 'conv=excl', 'status=none'])
    expect(newFileArgv(P, false, 'gnu')).toEqual(['install', '-D', '-m', '0644', '/dev/stdin', '--', P])
    expect(replaceFileArgv(P, true, 'gnu')).toEqual(['dd', `of=${P}`, 'status=none'])
    expect(copyExclusiveArgv(S, P, 'gnu')).toEqual(['cp', '--no-clobber', '--', S, P])
    expect(touchArgv(P, 'gnu')).toEqual(['install', '-D', '-m', '600', '/dev/null', P])
    expect(removeFileArgv(P)).toEqual(['rm', '-f', '--', P])
  })

  it('whole-set digests of the GNU and the BSD argv (taken before this change)', () => {
    expect(digest('gnu')).toBe('cfd9124d0ee8208f81f0c8dc87ccdc9505b17d632267f9b8a942a6ae987094ad')
    expect(digest('posix')).toBe('4c60ee6b0510418188772bc443afc9b8744a46d18e6b07c82837f8960a4e1160')
  })

  it('writeVia on gnu and posix is the same host.run call as before (argv, timeout, stdin)', async () => {
    const calls: unknown[][] = []
    const host: WriteHost = {
      fs: { read: async () => '', stat: async () => undefined, list: async () => [] },
      run: async (argv, timeout, stdin) => (calls.push([argv, timeout, stdin]), { exitCode: 0, stdout: '', stderr: '' }),
    }

    await writeVia('gnu', host, { kind: 'append', path: P, text: 'x\n' })
    await writeVia('posix', host, { kind: 'create-excl', path: P, text: 'y' })
    await writeVia('gnu', host, { kind: 'create-dirs', path: P, text: 'z' })
    await writeVia('posix', host, { kind: 'replace', path: P, text: 'r', hasDir: false })
    await writeVia('gnu', host, { kind: 'copy-no-clobber', path: P, from: S })
    await writeVia('posix', host, { kind: 'touch', path: P })

    expect(calls).toEqual([
      [appendArgv(P, 'gnu'), 10_000, 'x\n'],
      [newFileArgv(P, true, 'posix'), 10_000, 'y'],
      [newFileArgv(P, false, 'gnu'), 10_000, 'z'],
      [replaceFileArgv(P, false, 'posix'), 10_000, 'r'],
      [copyExclusiveArgv(S, P, 'gnu'), 10_000, undefined],
      [touchArgv(P, 'posix'), 10_000, undefined],
    ])
  })
})

/** A fake host with a map for a disk and no way to run anything: a run is a test failure. */
function fsHost(files: Record<string, string> = {}, extra: { dirs?: string[]; links?: string[]; noWrite?: boolean } = {}) {
  const disk = new Map(Object.entries(files))
  const writes: [string, string][] = []
  const dirs = new Set(extra.dirs ?? [])
  const links = new Set(extra.links ?? [])
  const host: WriteHost = {
    fs: {
      read: async path => {
        const found = disk.get(path)

        if (found === undefined) throw new Error('missing')

        return found
      },
      stat: async path => (links.has(path) ? { kind: 'other', isLink: true } : disk.has(path) ? { kind: 'file', size: disk.get(path)!.length } : dirs.has(path) ? { kind: 'dir' } : undefined),
      list: async () => [],
      exists: async path => disk.has(path) || dirs.has(path) || links.has(path),
      ...(extra.noWrite === true ? {} : { write: async (path: string, text: string) => void (writes.push([path, text]), disk.set(path, text)) }),
    },
    run: async argv => {
      throw new Error(`host.run must not be called on host-fs: ${argv.join(' ')}`)
    },
  }

  return { host, disk, writes }
}

describe('writeVia on host-fs', () => {
  it('append concatenates onto what is there, and a missing file reads as empty', async () => {
    const { host, disk } = fsHost({ '/p/a.jsonl': '{"n":1}\n' })

    expect((await writeVia('host-fs', host, { kind: 'append', path: '/p/a.jsonl', text: '{"n":2}\n' })).exitCode).toBe(0)
    expect(disk.get('/p/a.jsonl')).toBe('{"n":1}\n{"n":2}\n')
    expect((await writeVia('host-fs', host, { kind: 'append', path: '/p/new.jsonl', text: 'first\n' })).exitCode).toBe(0)
    expect(disk.get('/p/new.jsonl')).toBe('first\n')
  })

  it('append past 4 MiB is refused, and nothing is written', async () => {
    const { host, disk, writes } = fsHost({ '/p/a.jsonl': 'x'.repeat(HOST_FS_MAX - 5) })
    const result = await writeVia('host-fs', host, { kind: 'append', path: '/p/a.jsonl', text: 'y'.repeat(10) })

    expect(result.exitCode).not.toBe(0)
    expect(result.stderr).toMatch(/4 MiB/)
    expect(writes).toEqual([])
    expect(disk.get('/p/a.jsonl')).toHaveLength(HOST_FS_MAX - 5)
  })

  it('create-excl refuses an existing file with the "already exists" text, and writes nothing', async () => {
    const { host, writes } = fsHost({ '/p/a.md': 'mine' })
    const result = await writeVia('host-fs', host, { kind: 'create-excl', path: '/p/a.md', text: 'new' })

    expect(result.exitCode).not.toBe(0)
    expect(result.stderr).toContain('already exists: the console does not overwrite a file; pick another name')
    expect(writes).toEqual([])
  })

  it('create-excl and create-dirs make a new file (the host write makes the folders)', async () => {
    const { host, disk } = fsHost()

    expect((await writeVia('host-fs', host, { kind: 'create-excl', path: '/p/a.md', text: 'a' })).exitCode).toBe(0)
    expect((await writeVia('host-fs', host, { kind: 'create-dirs', path: '/p/deep/er/b.md', text: 'b' })).exitCode).toBe(0)
    expect([...disk]).toEqual([['/p/a.md', 'a'], ['/p/deep/er/b.md', 'b']])
  })

  it('refuses a folder or a link as the target, for every kind', async () => {
    const { host, writes } = fsHost({}, { dirs: ['/p/folder'], links: ['/p/link'] })

    for (const path of ['/p/folder', '/p/link']) {
      for (const kind of ['append', 'replace', 'touch'] as const) {
        const result = await writeVia('host-fs', host, { kind, path, text: 'x' })

        expect(result.exitCode, `${kind} ${path}`).not.toBe(0)
        expect(result.stderr).toMatch(/refused/)
      }
    }

    expect(writes).toEqual([])
  })

  it('replace overwrites; touch keeps an existing file and makes an empty one', async () => {
    const { host, disk } = fsHost({ '/p/s.json': 'old', '/p/keep': 'content' })

    expect((await writeVia('host-fs', host, { kind: 'replace', path: '/p/s.json', text: 'new', hasDir: true })).exitCode).toBe(0)
    expect((await writeVia('host-fs', host, { kind: 'touch', path: '/p/keep' })).exitCode).toBe(0)
    expect((await writeVia('host-fs', host, { kind: 'touch', path: '/p/flag' })).exitCode).toBe(0)
    expect([...disk]).toEqual([['/p/s.json', 'new'], ['/p/keep', 'content'], ['/p/flag', '']])
  })

  it('copy-no-clobber copies the source to a new name and refuses an existing target or a missing source', async () => {
    const { host, disk } = fsHost({ '/p/j.jsonl': 'journal', '/p/taken': 'x' })

    expect((await writeVia('host-fs', host, { kind: 'copy-no-clobber', from: '/p/j.jsonl', path: '/p/j.jsonl.1' })).exitCode).toBe(0)
    expect(disk.get('/p/j.jsonl.1')).toBe('journal')
    expect((await writeVia('host-fs', host, { kind: 'copy-no-clobber', from: '/p/j.jsonl', path: '/p/taken' })).exitCode).not.toBe(0)
    expect(disk.get('/p/taken')).toBe('x')
    expect((await writeVia('host-fs', host, { kind: 'copy-no-clobber', from: '/p/none', path: '/p/new' })).exitCode).not.toBe(0)
    expect(disk.has('/p/new')).toBe(false)
  })

  it('a host without a file write, or a write that rejects, is a refusal with a reason, never a throw', async () => {
    const none = fsHost({}, { noWrite: true })
    const refused = await writeVia('host-fs', none.host, { kind: 'replace', path: '/p/a', text: 'x', hasDir: true })

    expect(refused.exitCode).not.toBe(0)
    expect(refused.stderr).toMatch(/file API/)

    const failing = fsHost()

    failing.host.fs.write = async () => {
      throw new Error('EACCES: permission denied')
    }
    expect((await writeVia('host-fs', failing.host, { kind: 'replace', path: '/p/a', text: 'x', hasDir: true })).stderr).toMatch(/EACCES/)
  })
})

describe('the Events store on host-fs', () => {
  const CWD = 'C:/work/proj'
  const FILE = `${CWD}/${EVENTS_FILE}`
  const line = (text: string) => encodeEvent({ kind: 'swarm', text, atMs: 1_800_000_000_000 })

  beforeEach(() => setWriteFlavor('host-fs'))

  it('persists a batch with no process run: the file is created, no mkdir runs, a .gitignore is written once', async () => {
    const { host, disk } = fsHost({}, { dirs: [CWD] })

    queueLine(FILE, 2 * 1024 * 1024, line('a'))
    queueLine(FILE, 2 * 1024 * 1024, line('b'))
    await flush(host as never, CWD, FILE, 1)

    expect(pendingOf(FILE)).toBe(0)
    expect(disk.get(FILE)?.split('\n').filter(Boolean)).toHaveLength(2)
    expect(disk.get(`${CWD}/.claude-flow/console/.gitignore`)).toContain('*')
  })

  it('rotates where the GNU path rotates (past the cap), by a whole rewrite to the newest half', async () => {
    const cap = 4_000
    const { host, disk } = fsHost({}, { dirs: [CWD] })
    const big = line('x'.repeat(400))

    for (let i = 0; i < Math.ceil((cap * 2) / big.length); i++) disk.set(FILE, (disk.get(FILE) ?? '') + big)
    queueLine(FILE, cap, line('tail'))
    await flush(host as never, CWD, FILE, 1)

    expect(disk.get(FILE)!.length).toBeLessThan(cap)
    expect(disk.get(FILE)!.endsWith(line('tail'))).toBe(true)
    expect(disk.has(`${FILE}.tmp`)).toBe(false)
  })

  it('a batch is never over the batch cap on host-fs either', () => {
    expect(BATCH_MAX).toBe(32 * 1024)
  })
})

describe('a confirmed write on host-fs is the host write, not an argv', () => {
  it('the run summary spec carries the write op (and the GNU spec does not)', async () => {
    const { exportSpec } = await import('../hooks/data/wf-export')
    const win = exportSpec('C:/p/s.md', '# run', 'r', false, 'host-fs')
    const linux = exportSpec('/p/s.md', '# run', 'r', true, 'gnu')

    expect(win.write).toEqual({ kind: 'create-dirs', path: 'C:/p/s.md', text: '# run' })
    expect(linux.write).toBeUndefined()
    expect(linux.argv).toEqual(['dd', 'of=/p/s.md', 'conv=excl', 'status=none'])
  })
})

describe('the autopilot kill flag on a machine with no delete', () => {
  async function world() {
    const { CWD, KILL, envOf, rig, stateWith, T0 } = await import('./fixtures/ap-rig')
    const { killSeen } = await import('../hooks/data/ap-guard')
    const live = await import('../hooks/ap-live')
    const panel = await import('../hooks/views/ap-panel')
    const r = rig()
    const state = stateWith([], 'off')
    const fs = r.host.fs as unknown as Record<string, unknown>

    fs.write = async (p: string, t: string) => void r.files.set(p, t)
    fs.exists = async (p: string) => r.files.has(p)
    live.wireAutopilot(state, r.host)

    return { r, state, KILL, CWD, killSeen, live, panel, envOf, T0 }
  }

  it('host-fs: stop -> flag seen -> a start is refused (autopilot is not yet available there) and leaves it -> clearKill writes the marker (not a delete) -> not seen -> stop again -> seen', async () => {
    setWriteFlavor('host-fs')

    const { r, state, KILL, CWD, killSeen, live, panel, envOf, T0 } = await world()

    await live.stopNow(state, r.host, 'because')
    expect(r.files.get(KILL)).toBe('')
    expect(await killSeen(r.host.fs, CWD)).toBe(true)

    panel.editDraft(panel.draftOf(state), { kind: 'anatole' })
    await panel.startSpec(envOf(state, T0))?.run?.()

    expect(live.storeOf(state).error).toBe('Autopilot is not yet available on Windows: its journal and path fence need atomic appends and Windows-aware path checks (follow-up).')
    expect(r.files.has(`${CWD}/.claude-flow/console/autopilot/envelope.json`)).toBe(false)
    expect(await killSeen(r.host.fs, CWD)).toBe(true)

    await live.clearKill(state, r.host)
    expect(r.files.get(KILL)).toBe(KILL_CLEARED)
    expect(await killSeen(r.host.fs, CWD)).toBe(false)
    expect(r.runs.filter(argv => argv[0] === 'rm')).toEqual([])

    await live.stopNow(state, r.host, 'again')
    expect(r.files.get(KILL)).toBe('')
    expect(await killSeen(r.host.fs, CWD)).toBe(true)
  })

  it('only the exact marker clears; a missing file is not a stop; any other content is', async () => {
    setWriteFlavor('host-fs')

    const { r, KILL, CWD, killSeen } = await world()

    expect(await killSeen(r.host.fs, CWD)).toBe(false)
    for (const content of ['', 'cleared\n', 'Cleared', 'x']) {
      r.files.set(KILL, content)
      expect(await killSeen(r.host.fs, CWD), JSON.stringify(content)).toBe(true)
    }
    r.files.set(KILL, KILL_CLEARED)
    expect(await killSeen(r.host.fs, CWD)).toBe(false)
  })

  it('gnu: clearKill is still the same rm -f argv, and a present flag is a stop whatever it holds', async () => {
    setWriteFlavor('gnu')

    const { r, state, KILL, CWD, killSeen, live } = await world()

    r.files.set(KILL, KILL_CLEARED)
    expect(await killSeen(r.host.fs, CWD)).toBe(true)
    await live.clearKill(state, r.host)
    expect(r.runs).toContainEqual(['rm', '-f', '--', KILL])
    expect(r.files.has(KILL)).toBe(false)
    expect(await killSeen(r.host.fs, CWD)).toBe(false)
  })
})
