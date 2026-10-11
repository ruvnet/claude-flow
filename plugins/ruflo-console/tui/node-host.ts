/// <reference types="node" />
/**
 * The standalone adapter (ADR-489): a `Host` (hooks/host.ts) backed by Node, for `ruflo tui`. The views and the controller
 * are the ones the Claude Code mod runs; only this file and the terminal renderer differ.
 *
 * Read-only by construction. Reads stay inside the project, `~/.claude` and `~/.claude-flow` (symlinks resolved first); the only
 * program that runs is the ruflo CLI itself, by argv with no shell; every member that needs the Claude Code engine (panes, prompt
 * box, tool calls, network, a spawned process, a dialog) is refused, which the Host contract already allows: a refusal is a
 * missing fact, never a crash. A write phase must port the confirm gate (#3983) before it lifts any of these.
 */
import { execFile } from 'node:child_process'
import { readdir, readFile, realpath, stat } from 'node:fs/promises'
import { homedir } from 'node:os'
import { dirname, isAbsolute, join, resolve, sep } from 'node:path'
import type { ProcessRunResult, Timer } from 'claude-code'

import type { Host } from '../hooks/host'

export type NodeHostOptions = {
  cwd: string
  /** Defaults to the user's home directory. */
  home?: string
  /** `CLAUDE_CONFIG_DIR`, when set. */
  configDir?: string
  /** The running ruflo CLI's entry file: probes run `node <entry> ...`, never a fresh `npx` download. Absent: every run is refused. */
  cliEntry?: string
  /** Where the console's own files are (its catalog); informational in this host. */
  pluginRoot?: string
}

const MAX_OUT = 1_000_000
/** Variables a child may see: enough to run node and find the project, none of the API keys in the parent's environment. */
const CHILD_ENV = /^(PATH|HOME|USERPROFILE|SystemRoot|TMPDIR|TEMP|TMP|LANG|LC_[A-Z]+|TERM|NO_COLOR|CLAUDE_FLOW_[A-Z_]+|RUFLO_[A-Z_]+)$/

const refuse = (what: string): Promise<never> => Promise.reject(new Error(`${what}: not available in the standalone terminal`))

/** The fixed argv prefixes the console builds for the ruflo CLI (state.ts CLI_PREFIXES); the rest of the argv is the command. */
const CLI_HEADS: readonly (readonly string[])[] = [
  ['npx', '--offline', '-y', '@claude-flow/cli@latest'],
  ['npx', '-y', '@claude-flow/cli@latest'],
  ['ruflo'],
  ['claude-flow'],
]

/** `[node, cli.js, ...command]` for an argv that starts with a ruflo CLI prefix; null for anything else. */
export function cliArgv(argv: readonly string[], entry: string | undefined): string[] | null {
  if (entry === undefined) return null

  const head = CLI_HEADS.find(prefix => prefix.every((part, i) => argv[i] === part))

  return head === undefined ? null : [process.execPath, entry, ...argv.slice(head.length)]
}

export function createNodeHost(options: NodeHostOptions): Host {
  const cwd = resolve(options.cwd)
  const home = options.home ?? homedir()
  const roots = [cwd, resolve(options.configDir ?? join(home, '.claude')), resolve(join(home, '.claude-flow'))]
  const store = new Map<string, unknown>()
  const timers = new Set<NodeJS.Timeout>()

  const rooted = (path: string): string => (isAbsolute(path) ? resolve(path) : resolve(cwd, path))
  const within = (path: string, root: string): boolean => path === root || path.startsWith(root + sep)

  /** The path as the disk really has it (links followed, the nearest existing parent for a file not there), and only if it is inside a root. */
  async function allowed(path: string): Promise<string> {
    const wanted = rooted(path)

    if (!roots.some(root => within(wanted, root))) throw new Error('outside the project')

    let real = wanted
    const tail: string[] = []

    for (;;) {
      try {
        real = join(await realpath(real), ...tail.reverse())
        break
      } catch {
        const up = dirname(real)

        if (up === real) throw new Error('outside the project')
        tail.push(real.slice(up.length + 1))
        real = up
      }
    }

    const realRoots = await Promise.all(roots.map(root => realpath(root).catch(() => root)))

    if (!realRoots.some(root => within(real, root))) throw new Error('outside the project')

    return wanted
  }

  const timer = (handle: NodeJS.Timeout): Timer => {
    handle.unref()
    timers.add(handle)

    return { cancel: () => void (clearTimeout(handle), clearInterval(handle), timers.delete(handle)) }
  }

  const env = (): NodeJS.ProcessEnv => Object.fromEntries(Object.entries(process.env).filter(([key]) => CHILD_ENV.test(key)))

  return {
    fs: {
      read: async path => {
        const target = await allowed(path)

        return readFile(target, 'utf8')
      },
      stat: async path => {
        try {
          const target = await allowed(path)
          const link = await import('node:fs/promises').then(fs => fs.lstat(target))
          const info = await stat(target)

          return { mtimeMs: info.mtimeMs, size: info.size, kind: info.isDirectory() ? 'directory' : info.isFile() ? 'file' : 'other', isLink: link.isSymbolicLink() }
        } catch {
          return undefined
        }
      },
      list: async path => {
        const target = await allowed(path)
        const entries = await readdir(target, { withFileTypes: true })

        return Promise.all(
          entries.map(async entry => {
            const info = await stat(join(target, entry.name)).catch(() => undefined)

            return { name: entry.name, kind: entry.isDirectory() ? 'directory' : entry.isFile() ? 'file' : 'other', ...(info !== undefined && { size: info.size, mtimeMs: info.mtimeMs }) }
          }),
        )
      },
    },
    every: (ms, fn) => timer(setInterval(fn, ms)),
    after: (ms, fn) => timer(setTimeout(fn, ms)),
    // Kept for this run only: nothing is written to disk by the standalone host.
    storeGet: async key => store.get(key),
    storeSet: async (key, value) => void store.set(key, value),
    fetchText: () => refuse('network'),
    askChoice: () => refuse('a dialog'),
    toast: () => undefined,
    invalidate: () => undefined,
    scrollTop: () => undefined,
    focus: () => refuse('focus'),
    blit: () => undefined,
    openPane: () => refuse('panes'),
    closePane: () => refuse('panes'),
    panes: () => refuse('panes'),
    registerCommand: () => refuse('slash commands'),
    run: (argv, timeoutMs, stdin) => {
      const command = cliArgv(argv, options.cliEntry)

      if (command === null) return refuse('running a program other than the ruflo CLI')

      return new Promise<ProcessRunResult>(done => {
        const child = execFile(command[0] as string, command.slice(1), { cwd, env: env(), timeout: timeoutMs, maxBuffer: MAX_OUT, windowsHide: true }, (error, stdout, stderr) => {
          const code = (error as { code?: unknown } | null)?.code

          done({ exitCode: error === null ? 0 : typeof code === 'number' ? code : 1, stdout: String(stdout).slice(0, MAX_OUT), stderr: String(stderr).slice(0, MAX_OUT), isStdoutTruncated: String(stdout).length > MAX_OUT, isStderrTruncated: String(stderr).length > MAX_OUT })
        })

        child.stdin?.on('error', () => undefined)
        child.stdin?.end(stdin ?? '')
      })
    },
    spawn: () => {
      throw new Error('spawning a process: not available in the standalone terminal')
    },
    usage: async () => ({}),
    rufloTools: async () => ({ tools: 0, servers: [] }),
    settings: () => refuse('Claude Code settings'),
    home: async () => home,
    configDir: async () => options.configDir,
    pluginRoot: options.pluginRoot ?? '',
    rufloSnapshot: () => refuse('ruflo-mods'),
    rufloRoute: () => refuse('ruflo-mods'),
    rufloSegment: () => refuse('ruflo-mods'),
    submitPrompt: () => refuse('a prompt box'),
    fillPrompt: async () => false,
    listCommands: async () => [],
    runSlash: () => refuse('slash commands'),
  }
}
