import { execFileSync } from 'node:child_process';

const GIT_CONFIG_OVERRIDE = ['-c', 'core.fsmonitor=false'] as const;
const DEFAULT_MAX_BUFFER = 4 * 1024 * 1024;

export interface SafeGitSyncOptions {
  readonly maxBuffer?: number;
  readonly timeoutMs?: number;
  readonly stderr?: 'pipe' | 'ignore';
}

/**
 * Build the argument vector used for every RuFlo-controlled Git subprocess.
 *
 * `core.fsmonitor` is command-bearing repository-local configuration. A copied
 * repository can therefore select a host command that Git executes while
 * refreshing its index. Command-line `-c` has higher precedence than local
 * repository configuration, so this invariant must precede every repository
 * operation that RuFlo performs itself.
 *
 * This deliberately does not claim that every command-bearing Git setting is
 * neutralized. Keep the wrapper as the single policy point so additional
 * reviewed overrides can be added without auditing every caller again.
 */
export function safeGitArgv(repoRoot: string, args: readonly string[]): string[] {
  assertGitPath(repoRoot);
  for (const arg of args) assertGitArgument(arg);
  return [...GIT_CONFIG_OVERRIDE, '-C', repoRoot, ...args];
}

export function safeGitTextSync(
  repoRoot: string,
  args: readonly string[],
  options: SafeGitSyncOptions = {},
): string {
  return execFileSync('git', safeGitArgv(repoRoot, args), {
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', options.stderr ?? 'pipe'],
    maxBuffer: boundedMaxBuffer(options.maxBuffer),
    ...(options.timeoutMs === undefined ? {} : { timeout: boundedTimeout(options.timeoutMs) }),
    windowsHide: true,
  }).trim();
}

export function safeGitBufferSync(
  repoRoot: string,
  args: readonly string[],
  options: SafeGitSyncOptions = {},
): Buffer {
  return execFileSync('git', safeGitArgv(repoRoot, args), {
    encoding: 'buffer',
    stdio: ['ignore', 'pipe', options.stderr ?? 'pipe'],
    maxBuffer: boundedMaxBuffer(options.maxBuffer),
    ...(options.timeoutMs === undefined ? {} : { timeout: boundedTimeout(options.timeoutMs) }),
    windowsHide: true,
  });
}

function assertGitPath(value: string): void {
  if (value.length === 0 || value.includes('\0')) {
    throw new Error('Git repository path is invalid');
  }
}

function assertGitArgument(value: string): void {
  if (value.includes('\0')) throw new Error('Git argument contains a NUL byte');
}

function boundedMaxBuffer(value: number | undefined): number {
  const resolved = value ?? DEFAULT_MAX_BUFFER;
  if (!Number.isSafeInteger(resolved) || resolved < 1024 || resolved > 256 * 1024 * 1024) {
    throw new Error('Git maxBuffer is outside the supported range');
  }
  return resolved;
}

function boundedTimeout(value: number): number {
  if (!Number.isSafeInteger(value) || value < 1 || value > 120_000) {
    throw new Error('Git timeout is outside the supported range');
  }
  return value;
}
