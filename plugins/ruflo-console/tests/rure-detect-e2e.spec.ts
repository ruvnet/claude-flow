/**
 * ruRE DETECT end to end (ADR-496): real files in a temp project, the row's own preflight (the real detection, with a node-fs `stat`),
 * then the argv it chose through the REAL built ruflo CLI and the console's reader. Skips, saying so, without a CLI that has the tools.
 *   npx vitest run --dir plugins/ruflo-console/tests rure-detect-e2e
 */
import { spawnSync } from 'node:child_process'
import { existsSync, lstatSync, mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import { emptyFields } from '../hooks/data/devtools'
import { DEV, devSpec } from '../hooks/devtools'
import type { Host } from '../hooks/host'
import { buildDotNetPe, buildElf64, buildEvmBytecode, buildPe64 } from '../../../v3/@claude-flow/cli/__tests__/rure-binary-fixtures'

const CLI_DIR = resolve(__dirname, '../../../v3/@claude-flow/cli')
const CLI = join(CLI_DIR, 'bin', 'cli.js')
const TOOLS = join(CLI_DIR, 'dist', 'src', 'mcp-tools', 'rure-tools.js')
const HAVE_CLI = existsSync(CLI) && existsSync(TOOLS) && readFileSync(TOOLS, 'utf8').includes('rure_analyze_evm')

if (!HAVE_CLI) console.log('SKIP ruRE DETECT e2e: build the CLI first (cd v3/@claude-flow/cli && npx tsc)')

let project = ''

/** A `stat` the way the host answers it: a link is `isLink`, a folder is `dir`. Missing is undefined. */
const fs = {
  stat: async (path: string) => {
    try {
      const info = lstatSync(join(project, path))

      return { kind: info.isDirectory() ? 'dir' : 'file', isLink: info.isSymbolicLink(), size: info.size }
    } catch {
      return undefined
    }
  },
}

/** DETECT as the console runs it: preflight picks, then the chosen argv runs in the project and the chosen reader reads it. */
async function detect(sample: string): Promise<{ refused?: string; label?: string; note?: string; lines?: string[] }> {
  const spec = devSpec(DEV.find(item => item.id === 'dt-re-auto')!, { ...emptyFields(), sample })!
  const prep = await spec.preflight!({ fs } as unknown as Host)

  if (typeof prep === 'string') return { refused: prep }

  const chosen = { ...spec, ...prep }
  const done = spawnSync(process.execPath, [CLI, ...chosen.args], { cwd: project, encoding: 'utf8', timeout: 90_000, env: { ...process.env, NO_COLOR: '1' } })

  return { label: chosen.label, note: chosen.note, lines: chosen.lines?.(done.stdout ?? '', done.stderr ?? '') ?? [] }
}

beforeAll(async () => {
  if (!HAVE_CLI) return

  project = mkdtempSync(join(tmpdir(), 'ruflo-console-detect-e2e-'))

  for (const dir of ['bin', 'win', 'contracts', 'app/src']) mkdirSync(join(project, dir), { recursive: true })

  writeFileSync(join(project, 'bin/tool'), buildElf64())
  writeFileSync(join(project, 'win/native.exe'), buildPe64())
  writeFileSync(join(project, 'win/managed.dll'), buildDotNetPe())
  writeFileSync(join(project, 'contracts/token.hex'), Buffer.from(buildEvmBytecode()).toString('hex'))
  writeFileSync(join(project, 'app/package.json'), JSON.stringify({ name: 'demo', main: 'src/main.js' }))
  writeFileSync(join(project, 'app/src/main.js'), "const { ipcMain } = require('electron');\nipcMain.handle('x', () => 1);\n")
  symlinkSync('/etc/hostname', join(project, 'bin/escape'))

  const asar = createRequire(join(CLI_DIR, 'package.json'))('@electron/asar') as { createPackage: (src: string, dest: string) => Promise<void> }

  await asar.createPackage(join(project, 'app'), join(project, 'app.asar'))
}, 120_000)

afterAll(() => {
  if (project !== '') rmSync(project, { recursive: true, force: true })
})

describe.skipIf(!HAVE_CLI)('DETECT against the real CLI', () => {
  it('an ELF with no extension is read as a native binary and says ELF', async () => {
    const answer = await detect('bin/tool')

    expect(answer.label).toBe('ruRE: detect → NATIVE BINARY')
    // A caveat line (AIDefence unavailable in CI) may come first: the format line is somewhere in the result, not at index 0.
    expect(answer.lines!.some(line => /^ELF/.test(line))).toBe(true)
  })

  it('a PE .exe is a native binary', async () => {
    expect((await detect('win/native.exe')).lines!.some(line => /^PE/.test(line))).toBe(true)
  })

  it('a managed .dll is read natively, says it may be .NET, and the .NET row then reads its metadata', async () => {
    const answer = await detect('win/managed.dll')

    expect(answer.note).toMatch(/may be a \.NET assembly.*run \.NET ASSEMBLY/)

    const net = devSpec(DEV.find(item => item.id === 'dt-re-net')!, { ...emptyFields(), sample: 'win/managed.dll' })!
    const done = spawnSync(process.execPath, [CLI, ...net.args], { cwd: project, encoding: 'utf8', timeout: 90_000, env: { ...process.env, NO_COLOR: '1' } })

    expect(net.lines!(done.stdout ?? '', done.stderr ?? '').join('\n')).toMatch(/Demo|references|types/)
  })

  it('a .hex file is EVM bytecode', async () => {
    const answer = await detect('contracts/token.hex')

    expect(answer.label).toBe('ruRE: detect → EVM BYTECODE')
    expect(answer.lines!.join('\n')).toMatch(/selectors|instructions/)
  })

  it('a folder is read as JS source, with its Electron boundaries', async () => {
    const answer = await detect('app')

    expect(answer.label).toBe('ruRE: detect → APP MAP')
    expect(answer.lines!.join('\n')).toMatch(/Electron|ipc/)
  })

  it('an .asar is not read or unpacked: it names the row that asks first', async () => {
    expect((await detect('app.asar')).refused).toMatch(/UNPACK \.ASAR.*asks first/)
  })

  it('a link that leads outside the project is refused before anything is read', async () => {
    expect((await detect('bin/escape')).refused).toMatch(/bin\/escape is a link/)
  })
})
