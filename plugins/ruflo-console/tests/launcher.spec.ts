/**
 * The CLI launcher for confirmed actions (ADR-407 update): a settings write in a project whose npm cache lacks @claude-flow/cli
 * used to run `npx -y @claude-flow/cli@latest ...` with a 90 s limit and fail with "still running after 90000ms".
 *   npx vitest run plugins/ruflo-console/tests/launcher.spec.ts
 */
import { describe, expect, it } from 'vitest'

import type { ActionSpec } from '../hooks/actions'
import type { Host } from '../hooks/host'
import { explainFailure, FIRST_RUN_LABEL } from '../hooks/launcher'
import { createRunner } from '../hooks/runner'
import { setCore } from '../hooks/settings'
import { newState, type CliChoice } from '../hooks/state'

type Answer = { exitCode: number; stdout: string; stderr: string } | Error
type Call = { argv: readonly string[]; timeoutMs: number }

const ok = (stdout = '1.0.0'): Answer => ({ exitCode: 0, stdout, stderr: '' })
const key = (argv: readonly string[]): string => argv.join(' ')

/** A host whose process runner answers from `script` by argv (an Error rejects, as a missing binary or a kill does). */
function world(cli: CliChoice, script: (argv: readonly string[]) => Answer) {
  const calls: Call[] = []
  const state = newState({})
  const seen: string[] = []
  const host = {
    invalidate: () => seen.push(state.outcome?.detail ?? ''),
    after: () => ({ cancel: () => undefined }),
    run: async (argv: readonly string[], timeoutMs: number) => {
      calls.push({ argv, timeoutMs })
      const answer = script(argv)

      if (answer instanceof Error) throw answer

      return answer
    },
  } as unknown as Host

  state.options.cli = cli

  const runner = createRunner(state, host, { freshRead: async () => undefined, setView: () => undefined, drill: () => undefined, command: () => undefined })
  const write = (): ActionSpec => setCore(state, 'swarm.maxAgents', '15', () => undefined) as ActionSpec
  const confirmWrite = async () => {
    runner.ask(write(), 'why not')
    await runner.confirm()
  }
  const writeCall = () => calls.filter(call => call.argv.includes('set'))

  return { state, calls, seen, runner, confirmWrite, writeCall }
}

const missing = () => Object.assign(new Error('spawn ENOENT'), { code: 'ENOENT' })
const NEVER_CACHED: Answer = { exitCode: 1, stdout: '', stderr: 'npm error code ENOTCACHED\nnpm error cache mode is only-if-cached' }

describe('the write picks the cheapest launcher that answers (cli = npx)', () => {
  it('uses ruflo on PATH, with the ordinary 90 s limit', async () => {
    const w = world('npx', argv => (key(argv) === 'ruflo --version' || argv[0] === 'ruflo' ? ok() : missing()))

    await w.confirmWrite()
    expect(w.writeCall()).toEqual([{ argv: ['ruflo', 'config', 'set', '-k', 'swarm.maxAgents', '-v', '15'], timeoutMs: 90_000 }])
    expect(w.state.outcome?.ok).toBe(true)
  })

  it('falls through a missing ruflo to the project-local bin', async () => {
    const w = world('npx', argv => (argv[0] === 'node_modules/.bin/ruflo' ? ok() : missing()))

    await w.confirmWrite()
    expect(w.writeCall()[0]?.argv.slice(0, 2)).toEqual(['node_modules/.bin/ruflo', 'config'])
  })

  it('falls through to the cached npx copy and never to the online one', async () => {
    const w = world('npx', argv => (argv[0] === 'npx' && argv.includes('--offline') ? ok() : missing()))

    await w.confirmWrite()
    expect(w.writeCall()[0]?.argv.slice(0, 4)).toEqual(['npx', '--offline', '-y', '@claude-flow/cli@latest'])
    expect(w.writeCall()[0]?.timeoutMs).toBe(90_000)
  })

  it('keeps the launcher it found: a second write does not probe again', async () => {
    const w = world('npx', argv => (argv[0] === 'ruflo' ? ok() : missing()))

    await w.confirmWrite()
    const probes = w.calls.length
    await w.confirmWrite()
    expect(w.calls.length).toBe(probes + 1)
  })
})

describe('a cold download is the last resort and is announced', () => {
  const cold = (argv: readonly string[]): Answer => (key(argv).includes('--version') ? missing() : ok('Set swarm.maxAgents = 15'))

  it('runs online npx with the long limit and shows the first-run label while it works', async () => {
    const w = world('npx', cold)

    await w.confirmWrite()
    expect(w.writeCall()).toEqual([{ argv: ['npx', '-y', '@claude-flow/cli@latest', 'config', 'set', '-k', 'swarm.maxAgents', '-v', '15'], timeoutMs: 300_000 }])
    expect(w.seen).toContain(FIRST_RUN_LABEL)
    expect(w.state.outcome?.ok).toBe(true)
    expect(w.state.isActing).toBe(false)
  })

  it('ends a timeout as an error that names the exact fix, not the raw abort, and is not stuck', async () => {
    const w = world('npx', argv => (key(argv).includes('--version') ? missing() : new Error('ruflo-console: $.process.run(npx) aborted: still running after 300000ms')))

    await w.confirmWrite()
    expect(w.state.outcome?.ok).toBe(false)
    expect(w.state.outcome?.detail).toContain('npm i -g ruflo')
    expect(w.state.outcome?.detail).toContain('npx -y @claude-flow/cli@latest --version')
    expect(w.state.outcome?.detail).not.toContain('still running after')
    expect(w.state.isActing).toBe(false)
  })

  it('a retry after the cache is warm is fast: it resolves to the cached copy', async () => {
    let warm = false
    const w = world('npx', argv => {
      if (argv[0] === 'npx' && argv.includes('--offline')) return warm ? ok() : NEVER_CACHED
      if (key(argv).includes('--version')) return missing()

      return warm ? ok('Set') : new Error('aborted: still running after 300000ms')
    })

    await w.confirmWrite()
    expect(w.state.outcome?.ok).toBe(false)
    warm = true
    await w.confirmWrite()
    expect(w.state.outcome?.ok).toBe(true)
    expect(w.writeCall().at(-1)).toEqual({ argv: ['npx', '--offline', '-y', '@claude-flow/cli@latest', 'config', 'set', '-k', 'swarm.maxAgents', '-v', '15'], timeoutMs: 90_000 })
  })
})

describe('the explicit cli choices are never changed', () => {
  it('npx-offline runs as chosen, with no probes, and turns ENOTCACHED into the fix', async () => {
    const w = world('npx-offline', () => NEVER_CACHED)

    await w.confirmWrite()
    expect(w.calls.map(call => call.argv.slice(0, 3))).toEqual([['npx', '--offline', '-y']])
    expect(w.state.outcome?.ok).toBe(false)
    expect(w.state.outcome?.detail).toContain('not cached')
    expect(w.state.outcome?.detail).toContain('npx -y @claude-flow/cli@latest --version')
  })

  it('ruflo runs as chosen, with no probes', async () => {
    const w = world('ruflo', () => ok('Set'))

    await w.confirmWrite()
    expect(w.calls.map(call => call.argv[0])).toEqual(['ruflo'])
  })
})

describe('explainFailure', () => {
  it('speaks only about npx', () => {
    expect(explainFailure(['ruflo', 'x'], { error: new Error('aborted: still running after 90000ms') })).toBeNull()
    expect(explainFailure(['npx', '-y', 'x'], { exitCode: 1, stderr: 'boom' })).toBeNull()
  })

  it('names the seconds of a timeout', () => {
    expect(explainFailure(['npx', '-y', 'x'], { error: new Error('$.process.run(npx) aborted: still running after 90000ms') })).toContain('in 90 s')
  })
})
