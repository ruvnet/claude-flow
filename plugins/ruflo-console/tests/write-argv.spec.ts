/**
 * The console's file-writing argv on both kinds of host: GNU (Linux: dd oflag=append / conv=excl, install -D, no shell) and POSIX (macOS
 * and the BSDs, whose dd and install refuse those flags: one constant `sh -c` script per enumerated operation, the path as $1). The
 * builders are pure and take the flavor, so both branches are checked here on any machine; the POSIX scripts also run for real (sh and dd
 * exist on Linux and macOS alike), so their guarantees are measured, not assumed. Also: no write is built before the flavor is known.
 * Run with
 *   npx vitest run plugins/ruflo-console/tests/write-argv.spec.ts --testTimeout=30000
 */
import { spawnSync } from 'node:child_process'
import { closeSync, existsSync, lstatSync, mkdtempSync, openSync, readFileSync, rmSync, statSync, symlinkSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { afterEach, describe, expect, it } from 'vitest'

import { flush, queueLine, resetIo } from '../hooks/activity-io'
import { refreshAutopilot, storeOf, wireAutopilot } from '../hooks/ap-live'
import { rotate } from '../hooks/ap-maint'
import { hostOfRoot } from './adr-helpers'
import { J, rig, started, stateWith, T0 } from './fixtures/ap-rig'
import { realRun } from './fixtures/write-flavor'
import { appendArgv } from '../hooks/data/append-argv'
import { encodeLine, JOURNAL_FILE, touchArgv } from '../hooks/data/ap-journal'
import { snapshotEvents } from '../hooks/data/ap-loop'
import { copyExclusiveArgv, newFileArgv, replaceFileArgv } from '../hooks/data/wf-file'
import * as writeFlavor from '../hooks/data/write-flavor'
import { DETECT_DEADLINE_MS, flavorOfKernel, flavorOfPlatform, POSIX_SCRIPTS, setWriteFlavor, startWriteFlavorDetection, writeFlavorReady } from '../hooks/data/write-flavor'

const EVIL = "/work/proj/a b;$(touch pwned) `id` 'q' \"d\"\n-rf.md"
const sh = (op: keyof typeof POSIX_SCRIPTS, path: string, source?: string) => ['sh', '-c', POSIX_SCRIPTS[op], 'sh', path, ...(source === undefined ? [] : [source])]

afterEach(() => {
  setWriteFlavor(null)
  resetIo()
})

describe('which flavor, and when', () => {
  it('Linux keeps the GNU argv; Darwin and the BSDs take the sh scripts', () => {
    expect(flavorOfKernel('Linux\n')).toBe('gnu')
    expect(flavorOfKernel('Darwin\n')).toBe('posix')
    expect(flavorOfKernel('FreeBSD')).toBe('posix')
  })

  it('is GNU where no detection was started, so a host that never asks behaves exactly as before', async () => {
    expect(await writeFlavorReady()).toBe('gnu')
  })

  it('is detected once per process from uname -s: a second start reuses the first answer', async () => {
    const asked: (readonly string[])[] = []
    const run = async (argv: readonly string[]) => (asked.push(argv), { exitCode: 0, stdout: 'Darwin\n' })

    expect(await startWriteFlavorDetection(run)).toBe('posix')
    expect(await startWriteFlavorDetection(async () => ({ exitCode: 0, stdout: 'Linux\n' }))).toBe('posix')
    expect(await writeFlavorReady()).toBe('posix')
    expect(asked).toEqual([['uname', '-s']])
  })

  it('without an answer, the engine platform decides: darwin and the BSDs posix, everything else gnu', () => {
    for (const platform of ['darwin', 'freebsd', 'openbsd', 'netbsd']) expect(flavorOfPlatform(platform), platform).toBe('posix')
    for (const platform of ['linux', 'win32', 'aix', null, 42]) expect(flavorOfPlatform(platform), String(platform)).toBe('gnu')
    // In this test process the default reads Node's own process.platform.
    expect(flavorOfPlatform()).toBe(process.platform === 'darwin' || process.platform.endsWith('bsd') ? 'posix' : 'gnu')
  })

  it.each([
    ['a non-zero exit', async () => ({ exitCode: 1, stdout: 'Linux\n' })],
    ['an empty answer', async () => ({ exitCode: 0, stdout: '' })],
    ['a refused command', async () => Promise.reject(new Error('refused'))],
    ['a runner that throws', () => {
      throw new Error('no runner')
    }],
  ])('after %s, a darwin engine takes posix (and a linux one gnu)', async (_name, run) => {
    expect(await startWriteFlavorDetection(run as never, DETECT_DEADLINE_MS, () => flavorOfPlatform('darwin'))).toBe('posix')
    expect(await writeFlavorReady()).toBe('posix')
    setWriteFlavor(null)
    expect(await startWriteFlavorDetection(run as never, DETECT_DEADLINE_MS, () => flavorOfPlatform('linux'))).toBe('gnu')
  })

  it('a failing detector on this machine falls back to its own platform (posix on macOS)', async () => {
    expect(await startWriteFlavorDetection(async () => ({ exitCode: 127, stdout: '' }))).toBe(flavorOfPlatform(process.platform))
  })

  it('a runner that never settles cannot hold the writes: the deadline answers with the platform fallback', async () => {
    const started = Date.now()

    expect(await startWriteFlavorDetection(() => new Promise(() => undefined), 50, () => flavorOfPlatform('darwin'))).toBe('posix')
    expect(Date.now() - started).toBeLessThan(1_000)
    expect(await writeFlavorReady()).toBe('posix')
    expect(DETECT_DEADLINE_MS).toBe(3_000)
  })

  it('a write that starts while detection is still running waits for it, and is built with the detected flavor', async () => {
    let answer: (value: { exitCode: number; stdout: string }) => void = () => undefined
    const runs: (readonly string[])[] = []
    let detectedAt = -1

    void startWriteFlavorDetection(() => new Promise(resolve => (answer = resolve)))

    const host = {
      fs: { read: async () => '', stat: async () => undefined, list: async () => [] },
      run: async (argv: readonly string[]) => (runs.push(argv), { exitCode: 0, stdout: '', stderr: '' }),
    }

    // The Events store's first flush starts before uname answers (as a timer during controller construction can).
    queueLine('/work/proj/.claude-flow/console/events.jsonl', 1_000_000, '{"v":1}\n')

    const flushing = flush(host as never, '/work/proj', '/work/proj/.claude-flow/console/events.jsonl', 0)

    await new Promise(resolve => setTimeout(resolve, 20))
    // Nothing that depends on the flavor has been built yet: at most the flavor-free mkdir has run.
    expect(runs.every(argv => argv[0] === 'mkdir')).toBe(true)
    detectedAt = runs.length
    answer({ exitCode: 0, stdout: 'Darwin\n' })
    await flushing

    const writes = runs.slice(detectedAt)

    expect(writes).toContainEqual(sh('createExclusive', '/work/proj/.claude-flow/console/.gitignore'))
    expect(writes).toContainEqual(sh('append', '/work/proj/.claude-flow/console/events.jsonl'))
    expect(runs.some(argv => argv[0] === 'dd' || argv[0] === 'install')).toBe(false)
  })
})

describe('the GNU argv (Linux): unchanged, no shell, the path one element', () => {
  it('appends, creates, replaces and touches with the argv Linux has always run', () => {
    expect(appendArgv(EVIL, 'gnu')).toEqual(['dd', `of=${EVIL}`, 'oflag=append', 'conv=notrunc', 'bs=1M', 'iflag=fullblock', 'status=none'])
    expect(newFileArgv(EVIL, true, 'gnu')).toEqual(['dd', `of=${EVIL}`, 'conv=excl', 'status=none'])
    expect(newFileArgv(EVIL, false, 'gnu')).toEqual(['install', '-D', '-m', '0644', '/dev/stdin', '--', EVIL])
    expect(replaceFileArgv(EVIL, true, 'gnu')).toEqual(['dd', `of=${EVIL}`, 'status=none'])
    expect(replaceFileArgv(EVIL, false, 'gnu')).toEqual(['install', '-D', '-m', '0644', '/dev/stdin', '--', EVIL])
    expect(touchArgv(EVIL, 'gnu')).toEqual(['install', '-D', '-m', '600', '/dev/null', EVIL])
    expect(copyExclusiveArgv(`${EVIL}.src`, EVIL, 'gnu')).toEqual(['cp', '--no-clobber', '--', `${EVIL}.src`, EVIL])

    const all = [appendArgv(EVIL, 'gnu'), newFileArgv(EVIL, true, 'gnu'), newFileArgv(EVIL, false, 'gnu'), replaceFileArgv(EVIL, true, 'gnu'), replaceFileArgv(EVIL, false, 'gnu'), touchArgv(EVIL, 'gnu'), copyExclusiveArgv(EVIL, EVIL, 'gnu')]

    for (const argv of all) expect(argv.some(part => ['sh', 'bash', '-c'].includes(part))).toBe(false)
  })
})

describe('the POSIX argv (macOS, BSD): a fixed set of constant scripts, the path only ever as "$1"', () => {
  it('maps every write to its enumerated script, the path its own argument after $0', () => {
    expect(appendArgv(EVIL, 'posix')).toEqual(sh('append', EVIL))
    expect(newFileArgv(EVIL, true, 'posix')).toEqual(sh('createExclusive', EVIL))
    expect(newFileArgv(EVIL, false, 'posix')).toEqual(sh('createExclusiveWithDirs', EVIL))
    expect(replaceFileArgv(EVIL, true, 'posix')).toEqual(sh('replace', EVIL))
    expect(replaceFileArgv(EVIL, false, 'posix')).toEqual(sh('replaceWithDirs', EVIL))
    expect(touchArgv(EVIL, 'posix')).toEqual(sh('touch', EVIL))
    expect(copyExclusiveArgv('/src/j.jsonl', EVIL, 'posix')).toEqual(sh('copyExclusive', EVIL, '/src/j.jsonl'))
  })

  it('the set is closed: seven frozen scripts, and no exported builder takes a script', () => {
    expect(Object.isFrozen(POSIX_SCRIPTS)).toBe(true)
    expect(Object.keys(POSIX_SCRIPTS).sort()).toEqual(['append', 'copyExclusive', 'createExclusive', 'createExclusiveWithDirs', 'replace', 'replaceWithDirs', 'touch'])

    const builders = Object.entries(writeFlavor).filter(([name, value]) => typeof value === 'function' && name.startsWith('posix'))

    expect(builders.map(([name]) => name).sort()).toEqual(['posixAppend', 'posixCopyExclusive', 'posixCreateExclusive', 'posixCreateExclusiveWithDirs', 'posixReplace', 'posixReplaceWithDirs', 'posixTouch'])
    for (const [name, build] of builders) expect((build as (...args: unknown[]) => unknown).length, name).toBe(name === 'posixCopyExclusive' ? 2 : 1)
    // Every argument is a path that lands after the script, never in it.
    for (const [name, build] of builders) for (const argv of [(build as (a: string, b: string) => readonly string[])('X$(id)', 'Y`id`')]) expect(argv[2]?.includes('$(id)') || argv[2]?.includes('`id`'), name).toBe(false)
    expect(Object.keys(writeFlavor)).not.toContain('shArgv')
  })

  it('every script refuses a link or a non-regular target before it opens anything, quotes $1 at each use and names no other parameter', () => {
    for (const [op, script] of Object.entries(POSIX_SCRIPTS)) {
      const params = op === 'copyExclusive' ? ['$1', '$2'] : ['$1']

      for (const param of ['$1', '$2']) expect(script.replaceAll(`"${param}"`, '').includes(param), `${op} ${param}`).toBe(false)
      expect(script.replace(/\$\(dirname -- "\$1"\)/g, '').match(/\$[^12]/), op).toBeNull()
      if (!params.includes('$2')) expect(script.includes('$2'), op).toBe(false)

      const guard = script.indexOf('if [ -L "$1" ] || { [ -e "$1" ] && [ ! -f "$1" ]; }; then')
      const open = Math.min(...['>', ':'].map(c => script.indexOf(` ${c} "$1"`)).filter(i => i >= 0), script.indexOf('>>'))

      expect(guard, op).toBeGreaterThanOrEqual(0)
      expect(guard < open || open < 0, op).toBe(true)
    }

    expect(POSIX_SCRIPTS.createExclusive).toMatch(/set -C; exec cat > "\$1"$/)
    expect(POSIX_SCRIPTS.createExclusiveWithDirs).toMatch(/set -C; exec cat > "\$1"$/)
    expect(POSIX_SCRIPTS.touch).toMatch(/umask 077;.*set -C; : > "\$1"/)
    for (const op of ['append', 'createExclusive', 'createExclusiveWithDirs', 'replace', 'replaceWithDirs'] as const) expect(POSIX_SCRIPTS[op]).toMatch(/^umask 022;/)
    for (const op of ['touch', 'copyExclusive'] as const) expect(POSIX_SCRIPTS[op]).toMatch(/^umask 077;/)
    expect(POSIX_SCRIPTS.copyExclusive).toMatch(/set -C; exec cat < "\$2" > "\$1"$/)
  })
})

describe('the POSIX scripts on a real disk (sh and dd as this machine has them)', () => {
  let dir = ''

  afterEach(() => {
    if (dir !== '') rmSync(dir, { recursive: true, force: true })
    dir = ''
  })

  /** Runs argv under umask 000 (so a mode is the script's own, not the test's), stdin from a file (never Node's socket pair). */
  const run = (argv: readonly string[], input = '') => {
    const holder = `${dir}.in`

    writeFileSync(holder, input)

    const fd = openSync(holder, 'r')

    try {
      const result = spawnSync('sh', ['-c', 'umask 000; exec "$@"', 'wrap', ...argv], { stdio: [fd, 'pipe', 'pipe'], cwd: dir, encoding: 'utf8' })

      return { status: result.status, stderr: result.stderr }
    } finally {
      closeSync(fd)
      rmSync(holder, { force: true })
    }
  }
  const fresh = () => (dir = mkdtempSync(join(tmpdir(), 'write-argv-')))
  const fifo = (path: string) => expect(spawnSync('mkfifo', [path]).status).toBe(0)

  it('an exclusive create writes once, then refuses the file, a dangling link and a link to a file, replacing nothing', () => {
    fresh()

    const file = join(dir, "odd $(touch pwned) `touch pwned2` 'n'.md")

    expect(run(newFileArgv(file, true, 'posix'), 'one\n').status).toBe(0)
    expect(readFileSync(file, 'utf8')).toBe('one\n')
    expect(statSync(file).mode & 0o777).toBe(0o644)
    expect(run(newFileArgv(file, true, 'posix'), 'two\n').status).not.toBe(0)
    expect(readFileSync(file, 'utf8')).toBe('one\n')

    const victim = join(dir, 'victim')

    writeFileSync(victim, 'keep')
    symlinkSync(victim, join(dir, 'to-file.md'))
    symlinkSync(join(dir, 'not-yet'), join(dir, 'dangling.md'))

    for (const name of ['to-file.md', 'dangling.md']) {
      const refused = run(newFileArgv(join(dir, name), true, 'posix'), 'PWNED')

      expect(refused.status, name).toBe(73)
      expect(refused.stderr, name).toMatch(/link or not a regular file/)
    }

    expect(readFileSync(victim, 'utf8')).toBe('keep')
    expect(existsSync(join(dir, 'not-yet'))).toBe(false)
    expect(existsSync(join(dir, 'pwned')) || existsSync(join(dir, 'pwned2'))).toBe(false)
  })

  it('every script refuses a FIFO, a link to a device and a dangling link, and never blocks on the FIFO', () => {
    fresh()

    const pipe = join(dir, 'pipe')

    fifo(pipe)
    symlinkSync('/dev/null', join(dir, 'to-null'))
    symlinkSync(join(dir, 'gone'), join(dir, 'dangling'))

    const source = join(dir, 'source.jsonl')

    writeFileSync(source, 'x\n')

    const argvs = (path: string) => [appendArgv(path, 'posix'), newFileArgv(path, true, 'posix'), newFileArgv(path, false, 'posix'), replaceFileArgv(path, true, 'posix'), replaceFileArgv(path, false, 'posix'), touchArgv(path, 'posix'), copyExclusiveArgv(source, path, 'posix')]

    for (const name of ['pipe', 'to-null', 'dangling']) {
      for (const argv of argvs(join(dir, name))) {
        const result = run(argv, 'PWNED')

        expect(result.status, `${name}: ${argv[2]}`).toBe(73)
      }
    }

    expect(lstatSync(pipe).isFIFO()).toBe(true)
    expect(existsSync(join(dir, 'gone'))).toBe(false)
  })

  it('an exclusive copy (the journal archive) copies a regular file to a new 0600 file, and refuses an existing target or a source that is a link or a FIFO', () => {
    fresh()

    const journal = join(dir, "journal $(touch pwned).jsonl")
    const archive = `${journal}.20261009`

    writeFileSync(journal, '{"t":"start"}\n{"t":"stop"}\n', { mode: 0o600 })
    expect(run(copyExclusiveArgv(journal, archive, 'posix')).status).toBe(0)
    expect(readFileSync(archive, 'utf8')).toBe('{"t":"start"}\n{"t":"stop"}\n')
    expect(statSync(archive).mode & 0o777).toBe(0o600)

    writeFileSync(journal, 'changed\n')
    expect(run(copyExclusiveArgv(journal, archive, 'posix')).status).not.toBe(0)
    expect(readFileSync(archive, 'utf8')).toBe('{"t":"start"}\n{"t":"stop"}\n')

    symlinkSync(journal, join(dir, 'link-src'))
    fifo(join(dir, 'fifo-src'))
    for (const name of ['link-src', 'fifo-src']) expect(run(copyExclusiveArgv(join(dir, name), join(dir, `${name}.copy`), 'posix')).status, name).toBe(73)
    expect(existsSync(join(dir, 'pwned'))).toBe(false)
  })

  it('a create where the folder is missing makes the folders, writes mode 0644, and still never replaces', () => {
    fresh()

    const file = join(dir, 'a/b c/$(touch pwned)/new.md')

    expect(run(newFileArgv(file, false, 'posix'), '# hi\n').status).toBe(0)
    expect(readFileSync(file, 'utf8')).toBe('# hi\n')
    expect(statSync(file).mode & 0o777).toBe(0o644)
    expect(run(newFileArgv(file, false, 'posix'), 'again\n').status).not.toBe(0)
    expect(readFileSync(file, 'utf8')).toBe('# hi\n')
    expect(existsSync(join(dir, 'pwned'))).toBe(false)
  })

  it('a replace makes a missing folder, writes 0644, and replaces the content on the next run', () => {
    fresh()

    const file = join(dir, 'state/views.json')

    expect(run(replaceFileArgv(file, false, 'posix'), '{"a":1}\n').status).toBe(0)
    expect(statSync(file).mode & 0o777).toBe(0o644)
    expect(run(replaceFileArgv(file, false, 'posix'), '{"a":2}\n').status).toBe(0)
    expect(readFileSync(file, 'utf8')).toBe('{"a":2}\n')
    expect(run(replaceFileArgv(file, true, 'posix'), '{"a":3}\n').status).toBe(0)
    expect(readFileSync(file, 'utf8')).toBe('{"a":3}\n')
  })

  it('a touch makes the folders and an empty 0600 file, keeps an existing one, and refuses a link without following it', () => {
    fresh()

    const flag = join(dir, '.claude-flow/console/autopilot/KILL')

    expect(run(touchArgv(flag, 'posix')).status).toBe(0)
    expect(lstatSync(flag).isFile()).toBe(true)
    expect(statSync(flag).size).toBe(0)
    expect(statSync(flag).mode & 0o777).toBe(0o600)
    expect(run(touchArgv(flag, 'posix')).status).toBe(0)

    const victim = join(dir, 'victim')

    writeFileSync(victim, 'precious', { mode: 0o644 })
    symlinkSync(victim, join(dir, 'link-flag'))
    expect(run(touchArgv(join(dir, 'link-flag'), 'posix')).status).toBe(73)
    expect(readFileSync(victim, 'utf8')).toBe('precious')
    expect(statSync(victim).mode & 0o777).toBe(0o644)
  })

  it('an append creates the file 0644, then adds to it, and keeps every byte of a hostile path as one name', () => {
    fresh()

    const file = join(dir, "j; echo x > pwned2 $(touch pwned) `id`.jsonl")

    expect(run(appendArgv(file, 'posix'), '{"n":1}\n').status).toBe(0)
    expect(statSync(file).mode & 0o777).toBe(0o644)
    expect(run(appendArgv(file, 'posix'), '{"n":2}\n').status).toBe(0)
    expect(readFileSync(file, 'utf8')).toBe('{"n":1}\n{"n":2}\n')
    expect(existsSync(join(dir, 'pwned')) || existsSync(join(dir, 'pwned2'))).toBe(false)
  })

  it('eight writers of 55 kB batches through the POSIX append tear no line here (one dd block per batch)', () => {
    fresh()

    const batch = (c: string): string => Array.from({ length: 60 }, (_, i) => `{"w":"${c}","n":${i},"pad":"${c.repeat(900)}"}\n`).join('')
    const file = join(dir, 'out.jsonl')
    const argv = (appendArgv(file, 'posix') as string[]).map(arg => `'${arg.replaceAll("'", `'\\''`)}'`).join(' ')
    const script = Array.from({ length: 8 }, (_, w) => {
      const src = join(dir, `b${w}.txt`)

      writeFileSync(src, batch(w % 2 === 0 ? 'A' : 'B'))

      return `( for k in 1 2 3 4 5; do cat '${src}' | ${argv}; done ) &`
    }).join('\n')

    expect(spawnSync('bash', ['-c', `${script}\nwait`]).status).toBe(0)

    const lines = readFileSync(file, 'utf8').split('\n').filter(Boolean)

    expect(lines).toHaveLength(8 * 5 * 60)
    expect(lines.filter(line => !/^\{"w":"(A+|B+)","n":\d+,"pad":"(A+|B+)"\}$/.test(line) || line.length < 900)).toHaveLength(0)
  })

  it('the autopilot journal rotation archives and compacts on this machine, with the flavor the console detects', async () => {
    fresh()

    // The loop's state comes from the in-memory rig; the journal it rotates is a real file under a real project folder.
    const r = rig()
    const state = stateWith([])

    started(r, [])
    wireAutopilot(state, r.host)
    await refreshAutopilot(state, r.host, T0 + 1000)

    const journal = join(dir, JOURNAL_FILE)
    const before = r.files.get(J) as string

    expect(spawnSync('mkdir', ['-p', join(journal, '..')]).status).toBe(0)
    writeFileSync(journal, before)
    await startWriteFlavorDetection(realRun)
    await rotate(storeOf(state), hostOfRoot(dir).host as never, dir, T0 + 5000)

    const archive = `${journal}.${new Date(T0 + 5000).toISOString().replace(/[^0-9]/g, '').slice(0, 14)}`

    // The archive is the old journal byte for byte (on macOS `cp --no-clobber` exits 64 and rotation stopped here); the journal is the snapshot.
    expect(readFileSync(archive, 'utf8')).toBe(before)
    expect(readFileSync(journal, 'utf8')).toBe(snapshotEvents(storeOf(state).loop).map(encodeLine).join(''))
    // Run again at the same instant: the archive name is taken, so the copy refuses and nothing is replaced.
    writeFileSync(journal, 'newer\n')
    await rotate(storeOf(state), hostOfRoot(dir).host as never, dir, T0 + 5000)
    expect(readFileSync(archive, 'utf8')).toBe(before)
    expect(readFileSync(journal, 'utf8')).toBe('newer\n')
  })
})
