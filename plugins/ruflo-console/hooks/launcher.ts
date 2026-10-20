/**
 * Which command reaches the ruflo CLI for a confirmed action (ADR-407 update, ADR-444). With the `cli` option on `npx` the
 * argv used to be `npx -y @claude-flow/cli@latest ...` with a 90 s limit, so in a project whose npm cache lacked the package
 * a settings write downloaded about 2.5 GB, was killed at 90 s and showed "still running after 90000ms". The launcher is now
 * chosen once, cheapest first: `ruflo` on PATH, a project-local bin, the cached npx copy, and only then a cold download, which
 * gets a long limit and says it is a first run. The other `cli` choices are the person's explicit pick and are never changed.
 */
import type { Host } from './host'
import { CLI_PREFIXES, type State } from './state'

export type LauncherKind = 'fixed' | 'path' | 'local' | 'cached' | 'cold'
export type Launcher = { prefix: readonly string[]; kind: LauncherKind }

/** A cold `npx -y @claude-flow/cli@latest` took 36 s on a fast link (2.5 GB cache); five minutes covers a slow one. */
export const COLD_TIMEOUT_MS = 300_000
export const FIRST_RUN_LABEL = 'first run downloads the ruflo CLI: this can take a few minutes'
const PROBE_MS = 5_000
const CACHED_PROBE_MS = 20_000

/** Tried in order; the first whose `--version` answers wins. Relative paths run in the project (the host's cwd). */
const CANDIDATES: readonly { kind: LauncherKind; prefix: readonly string[]; timeoutMs: number }[] = [
  { kind: 'path', prefix: ['ruflo'], timeoutMs: PROBE_MS },
  { kind: 'local', prefix: ['node_modules/.bin/ruflo'], timeoutMs: PROBE_MS },
  { kind: 'local', prefix: ['node_modules/.bin/claude-flow'], timeoutMs: PROBE_MS },
  { kind: 'cached', prefix: CLI_PREFIXES['npx-offline'], timeoutMs: CACHED_PROBE_MS },
]

// A found launcher is kept for the session (per cli choice); a cold answer never is, since the first run warms the cache.
const found = new WeakMap<State, { cli: string; launcher: Launcher }>()

async function answers(host: Host, prefix: readonly string[], timeoutMs: number): Promise<boolean> {
  try {
    const result = await host.run([...prefix, '--version'], timeoutMs)

    return result.exitCode === 0 && result.stdout.trim() !== ''
  } catch {
    return false
  }
}

export async function resolveLauncher(host: Host, state: State): Promise<Launcher> {
  const cli = state.options.cli

  if (cli !== 'npx') return { prefix: CLI_PREFIXES[cli], kind: 'fixed' }

  const kept = found.get(state)

  if (kept !== undefined && kept.cli === cli) return kept.launcher

  for (const candidate of CANDIDATES) {
    if (await answers(host, candidate.prefix, candidate.timeoutMs)) {
      const launcher = { prefix: candidate.prefix, kind: candidate.kind }

      found.set(state, { cli, launcher })

      return launcher
    }
  }

  return { prefix: CLI_PREFIXES.npx, kind: 'cold' }
}

/** Forgets the kept launcher: a failed run may mean the cache or the install changed. */
export function forgetLauncher(state: State): void {
  found.delete(state)
}

const WARM = 'npx -y @claude-flow/cli@latest --version'

/** What to tell the person when a run of the CLI could not finish, or null when the failure is not about reaching the CLI. */
export function explainFailure(argv: readonly string[], failure: { error?: unknown; exitCode?: number; stdout?: string; stderr?: string }): string | null {
  if (argv[0] !== 'npx') return null

  const isOffline = argv.includes('--offline')

  if (failure.error !== undefined) {
    const message = failure.error instanceof Error ? failure.error.message : String(failure.error)
    const ms = /still running after (\d+)\s*ms/.exec(message)?.[1]

    if (ms === undefined && !/aborted|timed out/i.test(message)) return null

    return `npx did not finish${ms === undefined ? '' : ` in ${Math.round(Number(ms) / 1000)} s`}: it was likely still downloading the ruflo CLI. Install it once with "npm i -g ruflo" or warm the cache with "${WARM}", then ask again`
  }

  if (isOffline && failure.exitCode !== 0 && /\bENOTCACHED\b/.test(`${failure.stderr ?? ''}\n${failure.stdout ?? ''}`)) {
    return `the ruflo CLI is not cached here. Run "${WARM}" once (or "npm i -g ruflo"), or set the ruflo CLI option to npx, then ask again`
  }

  return null
}
