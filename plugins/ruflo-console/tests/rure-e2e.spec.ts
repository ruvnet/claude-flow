/**
 * ruRE end to end (ADR-494): every row of the page, as the console would run it, against the REAL built ruflo CLI and real files.
 * A temp project gets an ELF, a PE, a Mach-O, a .NET assembly, two EVM contracts, a JS/Electron app, an .asar built from it and an
 * ELF whose section name carries terminal escapes; each row's exact argv (`ruflo mcp exec -t rure_* -p {...}`) runs in that project,
 * and what the CLI printed goes through the console's own reader. Nothing is mocked and nothing in the target is run.
 *
 * Needs the CLI built from a tree that has the ruRE tools: `cd v3/@claude-flow/cli && npx tsc`. Without a build the whole file skips,
 * and says so; with one that predates the tools (an older release) it skips as well, because that case is covered in rure-page.spec.ts.
 * Run with
 *   npx vitest run plugins/ruflo-console/tests/rure-e2e.spec.ts
 */
import { spawnSync } from 'node:child_process'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import { devLines, emptyFields, unwrap, type DevFields } from '../hooks/data/devtools'
import { NO_TOOLS } from '../hooks/data/rure'
import { DEV, devSpec } from '../hooks/devtools'
// The same fixture builders the ruRE tools' own tests use: real file formats, built byte by byte.
import { buildDotNetPe, buildElf64, buildEvmBytecode, buildMachO64, buildMinimalProxy, buildPe64 } from '../../../v3/@claude-flow/cli/__tests__/rure-binary-fixtures'

const CLI_DIR = resolve(__dirname, '../../../v3/@claude-flow/cli')
const CLI = join(CLI_DIR, 'bin', 'cli.js')
const TOOLS = join(CLI_DIR, 'dist', 'src', 'mcp-tools', 'rure-tools.js')
const HAVE_CLI = existsSync(CLI) && existsSync(TOOLS) && readFileSync(TOOLS, 'utf8').includes('rure_analyze_evm')

if (!HAVE_CLI) console.log('SKIP ruRE e2e: build the CLI first (cd v3/@claude-flow/cli && npx tsc); it needs the rure_* tools')

const EVIL = '\u001b[31mEVIL\u001b[0m\u001b]52;c;aGk=\u0007'
let project = ''

const fields = (over: Partial<DevFields>): DevFields => ({ ...emptyFields(), ...over })

/** One row as the console runs it: its fields -> its spec -> the real CLI in the project -> the console's own reader. */
function run(id: string, over: Partial<DevFields>): { lines: string[]; stdout: string; status: number | null } {
  const entry = DEV.find(candidate => candidate.id === id)!
  const spec = devSpec(entry, fields(over))

  expect(spec, `${id} builds from ${JSON.stringify(over)}`).not.toBeNull()

  const done = spawnSync(process.execPath, [CLI, ...spec!.args], { cwd: project, encoding: 'utf8', timeout: 90_000, env: { ...process.env, NO_COLOR: '1' } })
  const stdout = done.stdout ?? ''

  return { lines: spec!.lines?.(stdout, done.stderr ?? '') ?? [], stdout, status: done.status }
}

beforeAll(async () => {
  if (!HAVE_CLI) return

  project = mkdtempSync(join(tmpdir(), 'ruflo-console-rure-e2e-'))

  for (const dir of ['bin', 'lib', 'contracts', 'app/src']) mkdirSync(join(project, dir), { recursive: true })

  writeFileSync(join(project, 'bin/sample.elf'), buildElf64())
  writeFileSync(join(project, 'bin/hostile.elf'), buildElf64(EVIL))
  writeFileSync(join(project, 'bin/sample.exe'), buildPe64())
  writeFileSync(join(project, 'bin/sample.macho'), buildMachO64())
  writeFileSync(join(project, 'lib/sample.dll'), buildDotNetPe())
  writeFileSync(join(project, 'contracts/token.bin'), buildEvmBytecode())
  writeFileSync(join(project, 'contracts/proxy.bin'), buildMinimalProxy())
  writeFileSync(join(project, 'app/package.json'), JSON.stringify({ name: 'demo', main: 'src/main.js' }))
  writeFileSync(join(project, 'app/src/main.js'), "const { ipcMain, BrowserWindow } = require('electron');\nconst fs = require('fs');\nipcMain.handle('license:check', async (e, key) => { return fs.readFileSync(key, 'utf8'); });\nfetch('https://api.example.com/v1/activate');\n")

  // The packer lives in the CLI's own dependencies, as in the ruRE tools' tests.
  const asar = createRequire(join(CLI_DIR, 'package.json'))('@electron/asar') as { createPackage: (src: string, dest: string) => Promise<void> }

  await asar.createPackage(join(project, 'app'), join(project, 'app.asar'))
}, 120_000)

afterAll(() => {
  if (project !== '') rmSync(project, { recursive: true, force: true })
})

describe.skipIf(!HAVE_CLI)('ruRE rows against the real CLI', () => {
  it('NATIVE BINARY reads an ELF, a PE and a Mach-O from the project', () => {
    const elf = run('dt-re-bin', { sample: 'bin/sample.elf' })

    expect(elf.status).toBe(0)
    expect(elf.lines.join('\n')).toContain('ELF · x86-64 · 64-bit little-endian')
    expect(elf.lines.join('\n')).toContain('libraries (1): libc.so.6')
    expect(elf.lines.join('\n')).toContain('imports (1): puts')
    expect(run('dt-re-bin', { sample: 'bin/sample.exe' }).lines.join('\n')).toContain('imports (1): KERNEL32.dll!ExitProcess')
    expect(run('dt-re-bin', { sample: 'bin/sample.macho' }).lines.join('\n')).toContain('MACHO · aarch64')
  }, 120_000)

  it('.NET ASSEMBLY reads metadata and P/Invoke, and says what happened to the screening of its string literals', () => {
    const net = run('dt-re-net', { sample: 'lib/sample.dll' }).lines.join('\n')

    expect(net).toContain('Demo 1.2.3.4')
    expect(net).toContain('P/Invoke (1): libnative!do_thing')
    expect(net).toContain('hello-dotnet')
    // With AIDefence installed the flagged literal is hidden and counted; without it (CI) the tool reports screened:false and the page says so.
    // Either way the screening state is on screen: a page that said nothing would let untrusted strings pass as clean.
    expect(net).toMatch(/hidden by AIDefence|not screened: AIDefence was unavailable/)
  }, 120_000)

  it('EVM BYTECODE lists selectors, hazards and a minimal proxy', () => {
    const token = run('dt-re-evm', { sample: 'contracts/token.bin' }).lines.join('\n')

    expect(token).toContain('0xa9059cbb transfer(address,uint256)')
    expect(token).toMatch(/SELFDESTRUCT ×1/)
    expect(run('dt-re-evm', { sample: 'contracts/proxy.bin' }).lines.join('\n')).toContain('EIP-1167 minimal proxy')
  }, 120_000)

  it('APP MAP and FIND FEATURE read a source folder; FIND FEATURE needs the feature words', () => {
    const app = run('dt-re-js', { sample: 'app' }).lines.join('\n')

    expect(app).toContain('Electron app')
    expect(app).toMatch(/ipcMain ×2/)

    const found = run('dt-re-find', { sample: 'app', query: 'license check' }).lines.join('\n')

    expect(found).toMatch(/1 match/)
    expect(found).toContain('app/src/main.js')
    expect(devSpec(DEV.find(entry => entry.id === 'dt-re-find')!, fields({ sample: 'app' }))).toBeNull()
  }, 120_000)

  it('UNPACK .ASAR extracts to a temp folder outside the project and says so, then it is cleaned up here', () => {
    const asar = run('dt-re-asar', { sample: 'app.asar' })
    const text = asar.lines.join('\n')

    expect(text).toContain('extracted 2 files')
    expect(text).toMatch(/outside the project/)

    const where = (unwrap(asar.stdout)?.value as { unpackedPath?: string } | undefined)?.unpackedPath

    expect(where).toBeDefined()
    expect(existsSync(where!)).toBe(true)
    expect(where!.startsWith(tmpdir())).toBe(true)
    expect(where!.startsWith(project)).toBe(false)
    // The tool does not clean up after itself (a known gap): the test does.
    rmSync(dirname(where!), { recursive: true, force: true })
  }, 120_000)

  it('a binary whose section name carries terminal escapes never puts one in a line', () => {
    const hostile = run('dt-re-bin', { sample: 'bin/hostile.elf' })

    expect(hostile.status).toBe(0)
    expect(hostile.lines.length).toBeGreaterThan(0)
    // eslint-disable-next-line no-control-regex
    for (const line of hostile.lines) expect(line, JSON.stringify(line)).not.toMatch(/[\u0000-\u001f\u007f‪-‮]/)
  }, 120_000)

  it('a missing file is one ✗ line from the tool, not a stack trace', () => {
    const missing = run('dt-re-bin', { sample: 'bin/nothere.elf' })

    expect(missing.lines).toHaveLength(1)
    expect(missing.lines[0]).toMatch(/^✗ /)
  }, 120_000)

  it('a path outside the project never reaches the CLI: the row builds nothing', () => {
    for (const bad of ['/etc/passwd', '../outside', 'bin/../../x']) expect(devSpec(DEV.find(entry => entry.id === 'dt-re-bin')!, fields({ sample: bad })), bad).toBeNull()
  })

  it('a CLI without the ruRE tools (an older release) is read as "update ruflo", not as a crash', () => {
    const old = spawnSync(process.execPath, [CLI, 'mcp', 'exec', '-t', 'rure_tool_this_cli_does_not_have', '-p', '{"path":"bin/sample.elf"}'], { cwd: project, encoding: 'utf8', timeout: 90_000 })

    expect(devLines('dt-re-bin', old.stdout ?? '', old.stderr ?? '')).toEqual([`✗ ${NO_TOOLS}`])
  }, 120_000)
})
