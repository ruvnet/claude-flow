/**
 * Outside folders for ruRE, end to end (ADR-499): a real folder outside a real project, the row's own preflight with a node-fs `stat` on
 * absolute paths, then the argv it chose through the REAL built ruflo CLI and the console's reader. Skips, saying so, without a CLI that has the tools.
 *   npx vitest run --dir plugins/ruflo-console/tests rure-folders-e2e
 */
import { spawnSync } from 'node:child_process'
import { copyFileSync, existsSync, lstatSync, mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import { emptyFields } from '../hooks/data/devtools'
import { parseFolders } from '../hooks/data/rure-folders'
import { DEV, devSpec } from '../hooks/devtools'
import type { Host } from '../hooks/host'
import { buildElf64 } from '../../../v3/@claude-flow/cli/__tests__/rure-binary-fixtures'

const CLI_DIR = resolve(__dirname, '../../../v3/@claude-flow/cli')
const CLI = join(CLI_DIR, 'bin', 'cli.js')
const TOOLS = join(CLI_DIR, 'dist', 'src', 'mcp-tools', 'rure-tools.js')
const CUDA_HOST = join(CLI_DIR, '__tests__', 'fixtures', 'cuda', 'host-cubinonly')
const HAVE_CLI = existsSync(CLI) && existsSync(TOOLS) && existsSync(CUDA_HOST) && readFileSync(TOOLS, 'utf8').includes('rure_analyze_cuda')

if (!HAVE_CLI) console.log('SKIP ruRE outside-folder e2e: build the CLI first (cd v3 && pnpm -r build)')

let project = ''
let outside = ''

/** A `stat` the way the host answers it, on the absolute path the preflight asks for. */
const fs = {
  stat: async (path: string) => {
    try {
      const info = lstatSync(path)

      return { kind: info.isDirectory() ? 'dir' : 'file', isLink: info.isSymbolicLink(), size: info.size }
    } catch {
      return undefined
    }
  },
}

/** The row as the console runs it: preflight resolves the alias, then the chosen argv runs in the project and the row's reader reads it. */
async function run(id: string, sample: string, folderOption: string): Promise<{ refused?: string; label?: string; note?: string; lines?: string[]; argv?: string[] }> {
  const spec = devSpec(DEV.find(item => item.id === id)!, { ...emptyFields(), sample })!
  const prep = await spec.preflight!({ fs } as unknown as Host, { rureFolders: parseFolders(folderOption) })

  if (typeof prep === 'string') return { refused: prep }

  const chosen = { ...spec, ...(prep ?? {}) }
  const done = spawnSync(process.execPath, [CLI, ...chosen.args], { cwd: project, encoding: 'utf8', timeout: 90_000, env: { ...process.env, NO_COLOR: '1' } })

  return { label: chosen.label, note: chosen.note, argv: [...chosen.args], lines: chosen.lines?.(done.stdout ?? '', done.stderr ?? '') ?? [] }
}

beforeAll(() => {
  if (!HAVE_CLI) return

  project = mkdtempSync(join(tmpdir(), 'ruflo-folders-e2e-project-'))
  outside = mkdtempSync(join(tmpdir(), 'ruflo-folders-e2e-outside-'))
  mkdirSync(join(outside, 'bin'))
  writeFileSync(join(outside, 'bin', 'tool'), buildElf64())
  copyFileSync(CUDA_HOST, join(outside, 'gpu-host'))
  symlinkSync('/etc/hostname', join(outside, 'bin', 'escape'))
})

afterAll(() => {
  for (const dir of [project, outside]) if (dir !== '') rmSync(dir, { recursive: true, force: true })
})

describe.skipIf(!HAVE_CLI)('ruRE reads a folder outside the project that the person allowed', () => {
  it('reads a native binary there through the real CLI', async () => {
    const out = await run('dt-re-bin', '@lab/bin/tool', `lab=${outside}`)

    expect(out.refused).toBeUndefined()
    expect(JSON.parse(out.argv![out.argv!.indexOf('-p') + 1]!).path).toBe(`${outside}/bin/tool`)
    expect(out.lines!.join('\n')).toMatch(/ELF/i)
  })

  it('DETECT reads a CUDA host binary there with the native reader and hints at the CUDA row', async () => {
    const out = await run('dt-re-auto', '@lab/gpu-host', `lab=${outside}`)

    expect(out.refused).toBeUndefined()
    expect(out.note).toContain('(in @lab)')
    expect(out.lines!.join('\n')).toMatch(/CUDA/i)
  })

  it('refuses a link inside the allowed folder that leads out, and nothing is read', async () => {
    const out = await run('dt-re-bin', '@lab/bin/escape', `lab=${outside}`)

    expect(out.refused).toMatch(/escape is a link/)
  })

  it('refuses a name that was never allowed, and an allowed folder that is itself a link', async () => {
    expect((await run('dt-re-bin', '@lab/bin/tool', '')).refused).toMatch(/no outside folder is allowed/)
    expect((await run('dt-re-bin', '@other/bin/tool', `lab=${outside}`)).refused).toMatch(/@other is not one of your allowed folders/)

    const door = join(project, 'door')

    symlinkSync(outside, door)
    expect((await run('dt-re-bin', '@d/bin/tool', `d=${door}`)).refused).toMatch(/door is a link/)
  })

  it('an absolute path typed as a sample reaches nothing, with the option set or not', () => {
    for (const sample of [`${outside}/bin/tool`, `${outside}/../x`, '/etc/hostname']) expect(devSpec(DEV.find(item => item.id === 'dt-re-bin')!, { ...emptyFields(), sample })).toBeNull()
  })
})
