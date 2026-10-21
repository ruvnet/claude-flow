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
import { execFile, spawn as spawnProcess } from 'node:child_process'
import { readdir, readFile, realpath, stat } from 'node:fs/promises'
import { homedir } from 'node:os'
import { dirname, isAbsolute, join, resolve, sep } from 'node:path'
import type { ProcessRunResult, ProcessSpawnChunk, ProcessSpawnResult, Timer } from 'claude-code'

import type { Host } from '../hooks/host'
import { PINNED_CODEX, validateCodexArgv, validateHttp } from './ai-guard'

/** What the AI page may reach (ADR-489 decision D). Absent: the host refuses every spawn, send and key read, as in phase 2. */
export type AiOptions = {
  /** The pinned Codex program, when it is not under `~/.codex/packages/standalone/releases/<pinned>-<platform>/bin/codex` (a test passes a fake). Its `--version` must still say the pinned version. */
  codexBin?: string
  /** Hosts an HTTPS request may go to (see allowedHostsOf). */
  allowedHosts?: readonly string[]
  /** Environment variable NAMES whose value may be read as a model key (the OpenRouter default and each convoTargets entry's keyEnv). The value goes to one request header and nowhere else. */
  keyEnvs?: readonly string[]
  /** The person opted in, for this session, to Codex writing in the workspace. */
  allowWrite?: boolean
  /** A fetch for a test; the real one is Node's. */
  fetch?: typeof fetch
}

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
  ai?: AiOptions
  /** Something changed that the screen should show (a stream wrote, a request answered). */
  onInvalidate?: () => void
}

const MAX_OUT = 1_000_000
/** Variables a child may see: enough to run node and find the project, none of the API keys in the parent's environment. */
const CHILD_ENV = /^(PATH|HOME|USERPROFILE|SystemRoot|TMPDIR|TEMP|TMP|LANG|LC_[A-Z]+|TERM|NO_COLOR|CLAUDE_CONFIG_DIR|CLAUDE_FLOW_[A-Z_]+|RUFLO_[A-Z_]+)$/
/** What the Codex child may also see: where its own login lives. No API key of ours reaches it. */
const CODEX_ENV = /^CODEX_HOME$/
const HTTP_WAIT_MS = 120_000
const HTTP_BODY_CAP = 1_000_000
/** What the pinned program's --version must print, exactly. */
const VERSION_SAYS = 'codex-cli ' + PINNED_CODEX

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

const childEnv = (...extra: RegExp[]): NodeJS.ProcessEnv => Object.fromEntries(Object.entries(process.env).filter(([key]) => CHILD_ENV.test(key) || extra.some(pattern => pattern.test(key))))

/** The pinned Codex program, or the reason there is none. Never `current`, never PATH: its `--version` must say exactly the pinned version. */
export async function resolveCodex(home: string, explicit?: string): Promise<{ ok: true; bin: string } | { ok: false; why: string }> {
  const candidates: string[] = []

  if (explicit !== undefined) candidates.push(explicit)
  else {
    const releases = join(home, '.codex', 'packages', 'standalone', 'releases')
    const names = await readdir(releases).catch(() => [] as string[])

    for (const name of names) if (name.startsWith(PINNED_CODEX + '-') && /^[0-9.]+-[A-Za-z0-9_-]+$/.test(name)) candidates.push(join(releases, name, 'bin', 'codex'))
  }

  for (const bin of candidates) {
    const said = await new Promise<string>(done => execFile(bin, ['--version'], { timeout: 5_000, windowsHide: true, env: childEnv(CODEX_ENV) }, (error, stdout) => done(error === null ? String(stdout) : '')))

    if (said.trim() === VERSION_SAYS) return { ok: true, bin }
  }

  return { ok: false, why: 'the pinned Codex ' + PINNED_CODEX + ' is not installed under ~/.codex/packages/standalone/releases (the terminal never uses current or PATH: 0.162.1 crashes)' }
}

type Streamed = AsyncGenerator<ProcessSpawnChunk, ProcessSpawnResult> & { readonly result: Promise<ProcessSpawnResult> }

/** A child's output as the Host's stream: chunks of stdout and stderr in order, then its exit as the result. */
function streamOf(child: ReturnType<typeof spawnProcess>): Streamed {
  const queue: ProcessSpawnChunk[] = []
  let wake: (() => void) | null = null
  let isDone = false
  let exit: ProcessSpawnResult = { code: null, signal: null }
  let settle: (value: ProcessSpawnResult) => void = () => undefined
  const result = new Promise<ProcessSpawnResult>(resolve => void (settle = resolve))
  const push = (stream: 'stdout' | 'stderr') => (data: Buffer) => {
    const text = data.toString('utf8')

    if (text !== '') queue.push({ stream, text })
    wake?.()
  }
  const finish = (value: ProcessSpawnResult) => {
    exit = value
    isDone = true
    settle(value)
    wake?.()
  }

  child.stdout?.on('data', push('stdout'))
  child.stderr?.on('data', push('stderr'))
  child.once('error', error => {
    queue.push({ stream: 'stderr', text: error.message + '\n' })
    finish({ code: 1, signal: null })
  })
  child.once('close', (code, signal) => finish({ code, signal }))

  const generator = (async function* () {
    for (;;) {
      const next = queue.shift()

      if (next !== undefined) yield next
      else if (isDone) return exit
      else await new Promise<void>(resolve => void (wake = resolve))
    }
  })() as Streamed

  Object.defineProperty(generator, 'result', { value: result })

  return generator
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
    invalidate: () => options.onInvalidate?.(),
    scrollTop: () => undefined,
    focus: () => refuse('focus'),
    blit: () => undefined,
    openPane: () => refuse('panes'),
    closePane: () => refuse('panes'),
    panes: () => refuse('panes'),
    registerCommand: () => refuse('slash commands'),
    run: (argv, timeoutMs, stdin) => {
      // A model key is read by NAME from this process's environment, and only a name the AI page was configured with.
      if (argv[0] === 'printenv' && argv.length === 2 && options.ai?.keyEnvs?.includes(argv[1] as string) === true) {
        const value = process.env[argv[1] as string]

        return Promise.resolve({ exitCode: value === undefined || value === '' ? 1 : 0, stdout: value === undefined ? '' : value + '\n', stderr: '', isStdoutTruncated: false, isStderrTruncated: false })
      }

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
    spawn: (argv, input) => {
      const ai = options.ai
      const verdict = ai === undefined ? ({ ok: false, why: 'the AI page is not enabled' } as const) : validateCodexArgv(argv, ai.allowWrite === true)

      if (!verdict.ok) throw new Error('spawning ' + String(argv[0]).slice(0, 30) + ': ' + verdict.why)

      // Nothing starts until the first read, so the pinned program is resolved (and refused, if absent) in the stream's own turn, as a failed start.
      let child: ReturnType<typeof spawnProcess> | null = null
      let isStopped = false
      let inner: Streamed | null = null
      const started = (async () => {
        const found = await resolveCodex(home, ai?.codexBin)

        if (!found.ok) throw new Error(found.why)
        if (isStopped) throw new Error('stopped before it started')

        child = spawnProcess(found.bin, verdict.args, { cwd, env: childEnv(CODEX_ENV), windowsHide: true, stdio: ['pipe', 'pipe', 'pipe'] })
        child.stdin?.on('error', () => undefined)
        child.stdin?.end(input ?? '')
        inner = streamOf(child)

        return inner
      })()

      started.catch(() => undefined)

      const outer = (async function* () {
        const stream = await started

        return yield* stream
      })() as Streamed
      const close = outer.return.bind(outer)

      Object.defineProperty(outer, 'result', { value: started.then(stream => stream.result) })
      ;(outer.result as Promise<unknown>).catch(() => undefined)
      outer.return = async value => {
        isStopped = true
        ;(child as ReturnType<typeof spawnProcess> | null)?.kill('SIGTERM')

        return close(value)
      }

      return outer
    },
    httpSend: async (url, init) => {
      const ai = options.ai
      const verdict = ai === undefined ? ({ ok: false, why: 'the AI page is not enabled' } as const) : validateHttp(url, init, ai.allowedHosts ?? ['openrouter.ai'])

      if (!verdict.ok) return { ok: false, status: 0, text: verdict.why }

      try {
        const response = await (ai?.fetch ?? fetch)(verdict.url, { method: 'POST', headers: init.headers, body: init.body, redirect: 'manual', signal: AbortSignal.timeout(HTTP_WAIT_MS) })

        // A redirect is never followed (it could carry the key to another host): it is an error.
        if (response.status >= 300 && response.status < 400) return { ok: false, status: response.status, text: 'the server redirected: the terminal does not follow redirects' }

        return { ok: response.ok, status: response.status, text: (await response.text()).slice(0, HTTP_BODY_CAP) }
      } catch (error) {
        return { ok: false, status: 0, text: error instanceof Error ? error.message.slice(0, 160) : 'the request failed' }
      }
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
