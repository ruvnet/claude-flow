/**
 * Live: every read-only run button, against the real CLI. The self-check (tests/self-check.spec.ts) proves each command is built right;
 * this proves it runs. It takes every runnable id the palette lists (the same catalog a button press resolves through), keeps the ones
 * that are read-only ($0, local, run at once without a confirm), runs each exactly as a press would (the console's default `npx
 * --offline -y @claude-flow/cli@latest`) in a scratch directory, and applies the entry's own reader to what it printed.
 *
 * A pass is an exit 0 with lines to show. A warning is a non-zero exit that still printed something readable: many verbs exit 1 when they
 * find something, and the console shows that output. A failure is the CLI not knowing the command (the registry has drifted from it), a
 * reader that throws, a hang, or nothing printed at all. It is off by default (it starts a process per command), so run it with
 *   RUFLO_LIVE=1 npx vitest run plugins/ruflo-console/tests/live-read.spec.ts
 */
import { execFile } from 'node:child_process'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { describe, expect, it } from 'vitest'

import type { ActionSpec } from '../hooks/actions'
import { labLines } from '../hooks/mh-lab'
import { paletteEntries } from '../hooks/palette'
import { CLI_PREFIXES, newState } from '../hooks/state'

const LIVE = process.env.RUFLO_LIVE === '1'
const CONCURRENCY = 8
const CAP_MS = 60_000
/** Free text, an action type, a ref, a word, a pattern and an epoch count: the first that builds a command for a verb that takes text. */
const SAMPLES = ['hello world', 'deploy', 'HEAD', 'auth', 'coordination 3']
/** What the CLI says when it does not know a command or an option: the registry has drifted from it. */
const UNKNOWN = /\b(unknown (command|option|argument|subcommand)|unrecognized (command|option|argument)|invalid (command|subcommand)|command not found|no such command|did you mean|required option|missing required|unexpected argument|too many arguments)\b/i

type Found = { id: string; spec: ActionSpec }
type Outcome = { id: string; grade: 'pass' | 'warn' | 'fail'; detail: string; ms: number }

/** Every read-only spec the palette offers, through the same call a press makes; a verb that takes text is tried with each sample. */
function readOnlySpecs(): { found: Found[]; skipped: { id: string; why: string }[] } {
  const state = newState({})
  const found = new Map<string, Found>()
  const skipped: { id: string; why: string }[] = []

  for (const entry of paletteEntries(state, Date.now())) {
    const run = entry.run
    const spec = run.kind === 'spec' ? run.spec : run.kind === 'text' ? SAMPLES.map(sample => run.make(sample)).find(made => made !== null) ?? null : null

    if (spec === null || spec === undefined) continue
    if (spec.isReadOnly !== true) continue
    // Not a ruflo CLI call (a fixed command, or a closure that does its own thing): not what this checks.
    if (spec.argv !== undefined || spec.run !== undefined || spec.args.length === 0) {
      skipped.push({ id: entry.id, why: spec.argv !== undefined ? 'a fixed command outside ruflo' : 'runs its own code' })

      continue
    }

    found.set(entry.id, { id: entry.id, spec })
  }

  return { found: [...found.values()], skipped }
}

function execute(argv: readonly string[], cwd: string, timeoutMs: number, stdin?: string): Promise<{ code: number | null; stdout: string; stderr: string; timedOut: boolean; spawnError: string | null }> {
  return new Promise(resolve => {
    const [file, ...rest] = argv as [string, ...string[]]
    const child = execFile(file, rest, { cwd, timeout: timeoutMs, maxBuffer: 16 * 1024 * 1024, env: { ...process.env, NO_COLOR: '1', CI: '1', FORCE_COLOR: '0' } }, (error, stdout, stderr) => {
      const failure = error as (Error & { code?: number | string; killed?: boolean }) | null

      resolve({ code: failure === null ? 0 : typeof failure.code === 'number' ? failure.code : null, stdout, stderr, timedOut: failure?.killed === true, spawnError: failure !== null && typeof failure.code === 'string' ? failure.code : null })
    })

    if (stdin !== undefined) child.stdin?.end(stdin)
  })
}

async function grade({ id, spec }: Found, cwd: string): Promise<Outcome> {
  const started = Date.now()
  const argv = [...CLI_PREFIXES['npx-offline'], ...spec.args]
  const done = (g: Outcome['grade'], detail: string): Outcome => ({ id, grade: g, detail, ms: Date.now() - started })
  const ran = await execute(argv, cwd, Math.min(spec.timeoutMs ?? 90_000, CAP_MS), spec.stdin)
  const text = `${ran.stdout}\n${ran.stderr}`

  if (ran.spawnError !== null) return done('fail', `could not start: ${ran.spawnError}`)
  if (ran.timedOut) return done('fail', `no answer in ${Math.round(Math.min(spec.timeoutMs ?? 90_000, CAP_MS) / 1000)} s`)
  if (UNKNOWN.test(text)) return done('fail', `the CLI does not know this: ${(text.split('\n').find(line => UNKNOWN.test(line)) ?? '').trim().slice(0, 110)}`)

  // The runner's own test of whether a run went well, and its own order for what the result panel shows (runner.ts, execute): the spec's
  // `read`, else its `lines`, else the lab's reading keyed on the lab id; a run with no lab id shows the CLI's own text.
  const answer = /"success"\s*:\s*(true|false)/.exec(ran.stdout)?.[1]
  const error = /"error"\s*:\s*"([^"]{0,160})"/.exec(ran.stdout)?.[1] ?? /\[ERROR\]\s*(.{0,160})/.exec(ran.stdout)?.[1]
  const ok = ran.code === 0 && answer !== 'false' && error === undefined && !/"isError"\s*:\s*true/.test(ran.stdout)
  let lines: string[]

  try {
    lines = spec.lab !== undefined ? (spec.read?.(ran.stdout, ran.stderr, ok) ?? (spec.lines ?? ((out, err) => labLines(spec.lab ?? '', out, err)))(ran.stdout, ran.stderr)) : (spec.lines?.(ran.stdout, ran.stderr) ?? `${ran.stdout}\n${ran.stderr}`.split('\n'))
  } catch (error) {
    return done('fail', `its reader threw: ${error instanceof Error ? error.message : String(error)}`)
  }

  const shown = lines.filter(line => line.trim() !== '' && !/: printed nothing$/.test(line))

  if (shown.length === 0) return done('fail', ran.code === 0 ? 'exit 0 and the panel would be empty' : `exit ${ran.code} and the panel would be empty`)

  const first = (shown[0] ?? '').trim().slice(0, 90)

  // Not ok is not broken: a project with no audits, no database or no suite answers so, and the panel shows it. It is told apart from
  // a command that does not work by the checks above (the CLI not knowing it, a reader that throws, an empty panel).
  return ok ? done('pass', `${shown.length} lines`) : done('warn', `exit ${ran.code}: ${first}`)
}

/** Runs `items` with at most `limit` at a time. */
async function pool<T, R>(items: readonly T[], limit: number, work: (item: T) => Promise<R>): Promise<R[]> {
  const out: R[] = new Array(items.length)
  let next = 0

  await Promise.all(
    Array.from({ length: Math.min(limit, items.length) }, async () => {
      while (next < items.length) {
        const at = next++

        out[at] = await work(items[at] as T)
      }
    }),
  )

  return out
}

describe('the palette, offline', () => {
  it('lists read-only runs to check, through the same call a press makes', () => {
    const { found } = readOnlySpecs()

    expect(found.length).toBeGreaterThan(30)
    for (const { spec } of found) expect(spec.args.every(part => typeof part === 'string' && part !== '')).toBe(true)
  })
})

describe.skipIf(!LIVE)('live: every read-only run button against the real CLI', () => {
  it(
    'runs, and says something a person can read',
    async () => {
      const { found, skipped } = readOnlySpecs()
      const scratch = mkdtempSync(join(tmpdir(), 'ruflo-live-'))

      try {
        const outcomes = await pool(found, CONCURRENCY, entry => grade(entry, scratch))
        const by = (g: Outcome['grade']) => outcomes.filter(outcome => outcome.grade === g)
        const line = (outcome: Outcome) => `  ${outcome.grade.toUpperCase().padEnd(4)} ${outcome.id.padEnd(30)} ${String(outcome.ms).padStart(5)} ms  ${outcome.detail}`

        // eslint-disable-next-line no-console
        console.log(`\nlive read-only runs: ${found.length} run, ${by('pass').length} pass, ${by('warn').length} warn, ${by('fail').length} fail, ${skipped.length} skipped (not a ruflo CLI call)\n${[...by('fail'), ...by('warn')].map(line).join('\n')}\n`)

        expect(by('fail').map(line)).toEqual([])
      } finally {
        rmSync(scratch, { recursive: true, force: true })
      }
    },
    600_000,
  )
})
