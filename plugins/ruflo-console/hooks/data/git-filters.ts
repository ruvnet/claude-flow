/**
 * Filter drivers named by a repository's own config (filter.<name>.clean, .smudge, .process) are programs git runs while it compares a work tree
 * with HEAD: status, diff and `worktree remove` all do. The console reads and removes worktrees of projects it did not make, so before such a
 * command it lists the configured drivers (a config read; nothing runs) and blanks each one on the command line, where it outranks the
 * repository's config. A driver name it cannot blank exactly stops the command (null) rather than letting the driver run.
 */
export type GitRun = (argv: readonly string[], timeoutMs: number) => Promise<{ stdout: string; exitCode?: number | null }>

/** The listing. `git config --get-regexp` exits 1 when nothing matches, which is the usual case and not a failure. */
export const FILTER_KEYS_ARGV = (dir: string): readonly string[] => ['git', '-C', dir, '--no-optional-locks', 'config', '--name-only', '--get-regexp', '^filter\\..*\\.(clean|smudge|process)$']

/** Letters, digits, dot, underscore and dash only: anything else (an equals sign, a space, a control character) cannot be written as one exact -c key. */
const KEY = /^filter\.([A-Za-z0-9_-]+(?:\.[A-Za-z0-9_-]+)*)\.(clean|smudge|process)$/

/** The -c overrides that blank every listed driver, or null when a listed key is not one it can blank exactly. */
export function filterOverrides(listing: string): string[] | null {
  const out: string[] = []
  const seen = new Set<string>()

  for (const line of listing.split('\n')) {
    const key = line.trim()

    if (key === '') continue

    if (!KEY.test(key)) return null

    if (seen.has(key)) continue

    seen.add(key)
    out.push('-c', `${key}=`)
  }

  return out
}

/**
 * `argv` with the overrides right after `git`, or null: the argv does not start with git, the listing failed or threw, or a driver name cannot be
 * blanked exactly. Callers treat null as "this probe is refused", the same as any other probe that could not be made safe.
 */
export async function filterGuarded(run: GitRun, dir: string, argv: readonly string[]): Promise<string[] | null> {
  if (argv[0] !== 'git') return null

  const listed = await run(FILTER_KEYS_ARGV(dir), 15_000).catch(() => null)

  if (listed === null) return null

  if (listed.exitCode !== 0 && !(listed.exitCode === 1 && listed.stdout.trim() === '')) return null

  const overrides = filterOverrides(listed.stdout)

  return overrides === null ? null : ['git', ...overrides, ...argv.slice(1)]
}
