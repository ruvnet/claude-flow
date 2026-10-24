/**
 * Outside folders for ruRE (ADR-499): the person names a folder in the option `rureFolders`; a sample reaches it as `@name/sub/file`.
 * Nothing else outside the project can be named, and a link is never followed.
 *   npx vitest run --dir plugins/ruflo-console/tests rure-folders
 */
import { mkdtempSync, mkdirSync, rmSync, symlinkSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it, vi } from 'vitest'

import { DEV, devSpec } from '../hooks/devtools'
import { allows, ALWAYS_ASK, classOf, TOOL_SPECS } from '../hooks/model-tools'
import { parseConfig, setOption, settingsOf } from '../hooks/settings'
import { emptyFields, fieldValue } from '../hooks/data/devtools'
import { aliasSampleOf, foldersLinkCheck, parseFolders, resolveAlias } from '../hooks/data/rure-folders'
import type { Host } from '../hooks/host'
import { createRunner } from '../hooks/runner'
import { newState, optionsOf } from '../hooks/state'

type Entry = { isLink?: boolean; kind?: string } | undefined
const fsOf = (entries: Record<string, Entry>) => ({ stat: async (path: string) => entries[path] })
const entry = (id: string) => DEV.find(item => item.id === id)!
const folders = parseFolders('samples=/data/samples; vendor=/opt/vendor/bin')

describe('parseFolders', () => {
  it('reads name=/folder pairs, separated by ; or a new line, and drops a trailing slash', () => {
    expect(parseFolders('a=/data/x/;\nb=/opt/y')).toEqual({ a: '/data/x', b: '/opt/y' })
    expect(parseFolders('win=C:/Users/me/samples')).toEqual({ win: 'C:/Users/me/samples' })
    expect(parseFolders('win=C:\\Users\\me\\samples')).toEqual({ win: 'C:/Users/me/samples' })
  })

  it('drops, never repairs, a pair that breaks a rule', () => {
    const bad = ['a=relative/dir', 'a=/', 'a=/home', 'a=C:/', 'a=/data/../etc', 'a=/data/./x', 'a=/data/my files', 'a=~/x', 'a=/data/$HOME/x', 'a=/data/x|rm', 'a=/data/`id`', '=/data/x', 'bad name=/data/x', `a=/${'x'.repeat(220)}/y`, 'a', 'a=']

    for (const raw of bad) expect(Object.keys(parseFolders(raw)), raw).toEqual([])
  })

  it('keeps the first of a repeated name, caps the count, and answers {} to a non-string', () => {
    expect(parseFolders('a=/d/one; a=/d/two')).toEqual({ a: '/d/one' })
    expect(Object.keys(parseFolders(Array.from({ length: 40 }, (_, i) => `n${i}=/d/f${i}`).join(';')))).toHaveLength(16)
    for (const value of [undefined, null, 5, {}, ['a=/d/x']]) expect(Object.keys(parseFolders(value))).toEqual([])
  })

  it('an alias called __proto__ or constructor is a plain name, not a hole in the object', () => {
    const map = parseFolders('__proto__=/d/x; constructor=/d/y')

    expect(Object.getPrototypeOf(map)).toBeNull()
    expect(Object.keys(map).sort()).toEqual(['__proto__', 'constructor'])
    expect(resolveAlias('@toString', map)).toHaveProperty('refuse')
  })

  it('is what the console option holds', () => {
    expect(optionsOf({ rureFolders: 'x=/data/x' } as never).rureFolders).toEqual({ x: '/data/x' })
    expect(optionsOf({} as never).rureFolders).toEqual({})
  })
})

describe('the sample rule', () => {
  it('accepts @name and @name/rel/path, and still only a plain relative path otherwise', () => {
    for (const ok of ['@samples', '@samples/app', '@samples/a/b/c.dll', 'bin/tool']) expect(fieldValue('sample', ok), ok).toBe(ok)
  })

  it('refuses an absolute path, .., an empty part, @ alone, odd characters and a long name', () => {
    for (const bad of ['/data/samples/x', 'C:/x', '@', '@/x', '@a/../b', '@a//b', '@a/./b', '@a b/c', '@a/b c', '@a;b', '@a/$(x)', `@${'a'.repeat(33)}`, `@a/${'b'.repeat(101)}`, '@a/' + Array(14).fill('p').join('/')]) {
      expect(aliasSampleOf(bad), bad).toBeNull()
      expect(fieldValue('sample', bad), bad).toBeNull()
    }
  })
})

describe('resolveAlias', () => {
  it('resolves a name and the part below it', () => {
    expect(resolveAlias('@samples', folders)).toEqual({ alias: 'samples', root: '/data/samples', rel: '', path: '/data/samples' })
    expect(resolveAlias('@samples/app/tool.exe', folders)).toEqual({ alias: 'samples', root: '/data/samples', rel: 'app/tool.exe', path: '/data/samples/app/tool.exe' })
  })

  it('refuses an unknown name and says how to allow one, and with none allowed says that Claude cannot', () => {
    expect(resolveAlias('@nope/x', folders)).toMatchObject({ refuse: expect.stringContaining('@samples, @vendor') })
    expect(resolveAlias('@nope', parseFolders(''))).toMatchObject({ refuse: expect.stringMatching(/rureFolders.*asks you first/) })
  })
})

describe('foldersLinkCheck', () => {
  const dir = { kind: 'dir' }

  it('lets a real folder and real parts through, and a part that is not there (the tool says so)', async () => {
    expect(await foldersLinkCheck(fsOf({ '/d/s': dir, '/d/s/a': dir, '/d/s/a/b': { kind: 'file' } }), '/d/s', 'a/b')).toBeNull()
    expect(await foldersLinkCheck(fsOf({ '/d/s': dir }), '/d/s', 'a/missing')).toBeNull()
  })

  it('refuses a folder that is missing, not a folder, or a link', async () => {
    expect(await foldersLinkCheck(fsOf({}), '/d/s', '')).toMatch(/is not there/)
    expect(await foldersLinkCheck(fsOf({ '/d/s': { kind: 'file' } }), '/d/s', '')).toMatch(/is not a folder/)
    expect(await foldersLinkCheck(fsOf({ '/d/s': { isLink: true, kind: 'dir' } }), '/d/s', '')).toMatch(/\/d\/s is a link/)
    expect(await foldersLinkCheck(fsOf({ '/d/s': { kind: 'symlink' } }), '/d/s', '')).toMatch(/is a link/)
  })

  it('refuses a link anywhere below the folder', async () => {
    expect(await foldersLinkCheck(fsOf({ '/d/s': dir, '/d/s/a': { isLink: true } }), '/d/s', 'a/b')).toMatch(/\/d\/s\/a is a link/)
    expect(await foldersLinkCheck(fsOf({ '/d/s': dir, '/d/s/a': dir, '/d/s/a/b': { kind: 'link' } }), '/d/s', 'a/b')).toMatch(/\/d\/s\/a\/b is a link/)
  })

  it('a host that refuses stat on the folder answers like a missing folder: it refuses, it never widens', async () => {
    expect(await foldersLinkCheck({ stat: async () => Promise.reject(new Error('refused')) }, '/d/s', 'a')).toMatch(/is not there/)
  })
})

describe('the preflight of a ruRE row', () => {
  const sample = '@samples/app/tool.exe'
  const spec = (id: string, over: Record<string, string> = {}) => devSpec(entry(id), { ...emptyFields(), sample, query: 'license', ...over })!
  const hostOf = (entries: Record<string, Entry>) => ({ fs: fsOf(entries) }) as unknown as Host
  const real = { '/data/samples': { kind: 'dir' }, '/data/samples/app': { kind: 'dir' }, '/data/samples/app/tool.exe': { kind: 'file' } } as const

  it('every reader row swaps @name for the absolute path in its one JSON argument, and keeps the rest', async () => {
    for (const id of ['dt-re-bin', 'dt-re-net', 'dt-re-cuda', 'dt-re-evm', 'dt-re-js', 'dt-re-asar', 'dt-re-find']) {
      const built = spec(id)
      const out = await built.preflight!(hostOf(real), { rureFolders: folders })

      expect(built.args.join(' '), id).toContain('@samples/app/tool.exe')
      expect(out, id).toMatchObject({ args: expect.any(Array) })

      const args = (out as { args: string[] }).args
      const params = JSON.parse(args[args.indexOf('-p') + 1]!) as Record<string, unknown>

      expect(params.path, id).toBe('/data/samples/app/tool.exe')
      expect(args.slice(0, args.indexOf('-p')), id).toEqual(built.args.slice(0, built.args.indexOf('-p')))
      if (id === 'dt-re-find') expect(params.query).toBe('license')
      if (id === 'dt-re-bin') expect(params.includeStrings).toBe(true)
    }
  })

  it('DETECT picks its reader from the resolved path', async () => {
    const out = await spec('dt-re-auto', { sample: '@samples/k.cubin' }).preflight!(hostOf({ '/data/samples': { kind: 'dir' }, '/data/samples/k.cubin': { kind: 'file' } }), { rureFolders: folders })

    expect(out).toMatchObject({ lab: 'dt-re-cuda', note: expect.stringContaining('in @samples') })
    expect(JSON.parse((out as { args: string[] }).args.at(-1)!)).toMatchObject({ path: '/data/samples/k.cubin' })
  })

  it('refuses an unknown name, a linked folder and a link below it, and runs nothing', async () => {
    expect(await spec('dt-re-bin', { sample: '@other/x' }).preflight!(hostOf(real), { rureFolders: folders })).toMatch(/@other is not one of your allowed folders/)
    expect(await spec('dt-re-bin').preflight!(hostOf({ ...real, '/data/samples': { isLink: true, kind: 'dir' } }), { rureFolders: folders })).toMatch(/\/data\/samples is a link/)
    expect(await spec('dt-re-bin').preflight!(hostOf({ ...real, '/data/samples/app': { isLink: true } }), { rureFolders: folders })).toMatch(/\/data\/samples\/app is a link/)
  })

  it('with no folder allowed, an @name sample is refused, and a project path is unchanged', async () => {
    expect(await spec('dt-re-bin').preflight!(hostOf(real), { rureFolders: parseFolders('') })).toMatch(/no outside folder is allowed/)
    expect(await spec('dt-re-bin', { sample: 'bin/tool' }).preflight!(hostOf({ bin: { kind: 'dir' }, 'bin/tool': { kind: 'file' } }), { rureFolders: folders })).toBeNull()
  })
})

describe('the runner', () => {
  const runnerFor = (folderText: string, entries: Record<string, Entry>) => {
    const run = vi.fn(async () => ({ stdout: '{"success":true}', stderr: '', exitCode: 0 }))
    const host = { invalidate: () => undefined, after: () => ({ cancel: () => undefined }), run, fs: fsOf(entries) } as unknown as Host
    const state = newState({ rureFolders: folderText } as never)
    const runner = createRunner(state, host, { freshRead: async () => undefined, setView: () => undefined, drill: () => undefined, command: () => undefined })

    return { run, state, runner }
  }
  const settle = async (): Promise<void> => { for (let turn = 0; turn < 12; turn++) await new Promise<void>(resolve => setTimeout(resolve, 0)) }

  it('runs the tool with the absolute path when the person allowed the folder', async () => {
    const { run, runner } = runnerFor('samples=/data/samples', { '/data/samples': { kind: 'dir' }, '/data/samples/tool': { kind: 'file' } })

    runner.ask(devSpec(entry('dt-re-bin'), { ...emptyFields(), sample: '@samples/tool' })!, 'why')
    await settle()

    expect(run).toHaveBeenCalledTimes(1)

    const argv = (run.mock.calls[0] as unknown as [string[]])[0]

    expect(JSON.parse(argv[argv.indexOf('-p') + 1]!)).toEqual({ path: '/data/samples/tool', includeStrings: true })
  })

  it('spawns nothing and shows the reason when the folder was never allowed', async () => {
    const { run, state, runner } = runnerFor('', { '/data/samples': { kind: 'dir' } })

    runner.ask(devSpec(entry('dt-re-bin'), { ...emptyFields(), sample: '@samples/tool' })!, 'why')
    await settle()

    expect(run).not.toHaveBeenCalled()
    expect(state.lab.result?.ok).toBe(false)
    expect(state.lab.result?.lines.join(' ')).toMatch(/no outside folder is allowed/)
  })
})

describe('on a real disk', () => {
  it('a symlink inside the allowed folder that points out is refused, a plain file is not', async () => {
    const base = mkdtempSync(join(tmpdir(), 'rure-folders-'))

    try {
      const root = join(base, 'allowed')
      const outside = join(base, 'secret')

      mkdirSync(root)
      mkdirSync(outside)
      writeFileSync(join(root, 'plain.bin'), 'x')
      writeFileSync(join(outside, 'key'), 'y')
      symlinkSync(outside, join(root, 'door'))

      const { lstat } = await import('node:fs/promises')
      const fs = { stat: async (path: string) => lstat(path).then(s => ({ kind: s.isDirectory() ? 'dir' : s.isFile() ? 'file' : 'other', isLink: s.isSymbolicLink() })).catch(() => undefined) }

      expect(await foldersLinkCheck(fs, root, 'plain.bin')).toBeNull()
      expect(await foldersLinkCheck(fs, root, 'door/key')).toMatch(/door is a link/)
      expect(await foldersLinkCheck(fs, join(base, 'allowed', 'door'), 'key')).toMatch(/is a link/)
    } finally {
      rmSync(base, { recursive: true, force: true })
    }
  })
})

describe('who can allow a folder', () => {
  const CONSOLE = JSON.stringify({
    pluginId: 'ruflo-console@ruflo',
    schema: { rureFolders: { type: 'string', title: 'Outside folders ruRE may read', description: 'name=/folder pairs', default: '' } },
    inputs: { rureFolders: '' },
    choices: {},
    configured: [],
  })

  it('is an install-class option write: Claude can only propose it at the full level, and it always asks the person', () => {
    const state = newState({})
    const config = parseConfig('ruflo-console', CONSOLE)

    expect(config).not.toBeNull()
    settingsOf(state).configs.set('ruflo-console', config!)

    const spec = setOption(state, 'ruflo-console', 'rureFolders', 'lab=/data/samples', () => undefined)

    expect(spec?.argv).toEqual(['claude', 'plugin', 'configure', 'ruflo-console@ruflo', '--values-stdin'])
    expect(spec?.stdin).toBe('{"rureFolders":"lab=/data/samples"}')
    expect(spec?.label).toContain('lab=/data/samples') // the card shows the exact folders
    expect(classOf(spec as NonNullable<typeof spec>)).toBe('install')
    expect(allows('write', 'install')).toBe(false)
    expect(allows('full', 'install')).toBe(true)
    expect(ALWAYS_ASK).toContain('install')
  })

  it('Claude has no console_set field that fills the sample or the option', () => {
    const set = TOOL_SPECS.find(tool => tool.name === 'console_set')

    expect(set).toBeDefined()
    expect(set!.description).not.toMatch(/sample|rureFolders/)
  })
})
