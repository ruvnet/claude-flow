/**
 * DETECT through the runner (ADR-496): the row stats the sample, picks the reader, runs that reader's call and draws that reader's lines
 * under a label that says what was chosen. Answers are the REAL captured CLI output (tests/fixtures/rure/).
 *   npx vitest run --dir plugins/ruflo-console/tests rure-detect-run
 */
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

import { describe, expect, it } from 'vitest'

import { devSpec, DEV } from '../hooks/devtools'
import { emptyFields } from '../hooks/data/devtools'
import type { Host } from '../hooks/host'
import { createRunner } from '../hooks/runner'
import { newState } from '../hooks/state'

const fixture = (name: string): string => readFileSync(join(__dirname, 'fixtures', 'rure', name), 'utf-8')
const flush = async () => {
  for (let turn = 0; turn < 12; turn++) await new Promise<void>(resolve => setTimeout(resolve, 0))
}

function world(entries: Record<string, { kind?: string; isLink?: boolean }>, answer: string) {
  const argvs: string[][] = []
  const state = newState({})
  const host = {
    invalidate: () => undefined,
    after: () => ({ cancel: () => undefined }),
    fs: { stat: async (path: string) => entries[path] },
    run: async (argv: readonly string[]) => {
      argvs.push([...argv])

      return { exitCode: 0, stdout: argv.includes('mcp') ? answer : '1.0.0', stderr: '' }
    },
  } as unknown as Host
  const runner = createRunner(state, host, { freshRead: async () => undefined, setView: () => undefined, drill: () => undefined, command: () => undefined })

  return { state, runner, argvs }
}

const detect = (sample: string) => devSpec(DEV.find(item => item.id === 'dt-re-auto')!, { ...emptyFields(), sample })!

describe('DETECT through the runner', () => {
  it('reads an ELF with the native binary reader and says it chose it', async () => {
    const { state, runner, argvs } = world({ bin: { kind: 'dir' }, 'bin/tool': { kind: 'file' } }, fixture('binary-elf.txt'))

    runner.ask(detect('bin/tool'), 'why')
    await flush()

    const call = argvs.find(argv => argv.includes('mcp'))!

    expect(call.slice(call.indexOf('mcp'), call.indexOf('mcp') + 4)).toEqual(['mcp', 'exec', '-t', 'rure_analyze_binary'])
    expect(state.lab.result?.id).toBe('dt-re-bin')
    expect(state.lab.result?.label).toBe('ruRE: detect → NATIVE BINARY')
    expect(state.lab.result?.ok).toBe(true)
    expect(state.lab.result?.lines[0]).toMatch(/^ELF/)
    expect(state.lab.result?.note).toMatch(/native binary/)
  })

  it('a folder goes to the JS reader, with the call for it', async () => {
    const { state, runner, argvs } = world({ app: { kind: 'dir' } }, fixture('js-app.txt'))

    runner.ask(detect('app'), 'why')
    await flush()

    expect(argvs.some(argv => argv.includes('rure_analyze_js_app'))).toBe(true)
    expect(state.lab.result?.id).toBe('dt-re-js')
    expect(state.lab.result?.label).toBe('ruRE: detect → APP MAP')
  })

  it('an .asar spawns nothing and names the row that asks first', async () => {
    const { state, runner, argvs } = world({ 'a/app.asar': { kind: 'file' } }, '')

    runner.ask(detect('a/app.asar'), 'why')
    await flush()

    expect(argvs.some(argv => argv.includes('mcp'))).toBe(false)
    expect(state.lab.result?.ok).toBe(false)
    expect(state.lab.result?.lines.join(' ')).toMatch(/UNPACK \.ASAR.*asks first/)
  })

  it('a link is refused before anything is chosen', async () => {
    const { state, runner, argvs } = world({ app: { isLink: true } }, '')

    runner.ask(detect('app'), 'why')
    await flush()

    expect(argvs.some(argv => argv.includes('mcp'))).toBe(false)
    expect(state.lab.result?.lines.join(' ')).toMatch(/app is a link/)
  })
})
