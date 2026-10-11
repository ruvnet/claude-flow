/**
 * What the standalone terminal lets the AI page run and send (ADR-489 decision D). Pure: strings in, a verdict out, so a test
 * pins every refusal. Two doors, both narrow on purpose:
 *   - Codex: one program (the PINNED release, never `current` and never PATH: 0.162.1 crashes with a #GP), `exec` only, an explicit
 *     read-only sandbox, and a fixed list of flags. Anything else (a profile, an extra config key, danger-full-access, --yolo, an
 *     added directory) is refused before a process starts.
 *   - HTTPS to a short list of hosts: openrouter.ai and the hosts a convoTargets entry names; POST only, no redirects, no headers but
 *     the two a chat request needs.
 */
export const PINNED_CODEX = '0.162.0'

const SESSION = /^[0-9A-Za-z][0-9A-Za-z-]{7,63}$/
const MODEL = /^[A-Za-z0-9][A-Za-z0-9._:/@+-]{0,80}$/
const SANDBOX = /^sandbox_mode="(read-only|workspace-write)"$/

export type CodexVerdict = { ok: true; args: string[]; sandbox: 'read-only' | 'workspace-write' } | { ok: false; why: string }

/**
 * `codex exec [resume] [--json] [--skip-git-repo-check] [--ephemeral] [--sandbox|-s <mode>] [-c sandbox_mode="<mode>"] [-m <model>] [<session>] -`.
 * `workspace-write` is accepted only when the person opted in for the session (`allowWrite`); danger-full-access never is.
 */
export function validateCodexArgv(argv: readonly string[], allowWrite = false): CodexVerdict {
  if (argv[0] !== 'codex' || argv[1] !== 'exec') return { ok: false, why: 'only `codex exec` runs here' }

  const rest = argv.slice(2)
  const args: string[] = ['exec']
  let sandbox: 'read-only' | 'workspace-write' | null = null
  let isLast = false
  let hasSession = false

  const mode = (value: string | undefined): 'read-only' | 'workspace-write' | null => (value === 'read-only' || (allowWrite && value === 'workspace-write') ? value : null)

  for (let i = 0; i < rest.length; i += 1) {
    const token = rest[i] as string

    if (isLast) return { ok: false, why: 'nothing may follow the stdin marker' }

    if (token === 'resume' && i === 0) args.push(token)
    else if (token === '--json' || token === '--skip-git-repo-check' || token === '--ephemeral') args.push(token)
    else if (token === '--sandbox' || token === '-s') {
      const value = mode(rest[i + 1])

      if (value === null) return { ok: false, why: `sandbox "${String(rest[i + 1]).slice(0, 30)}" is not allowed: read-only only${allowWrite ? ' (or workspace-write, opted in)' : ''}` }
      if (sandbox !== null && sandbox !== value) return { ok: false, why: 'two different sandbox modes' }
      sandbox = value
      args.push('--sandbox', value)
      i += 1
    } else if (token === '-c') {
      const found = SANDBOX.exec(rest[i + 1] ?? '')
      const value = mode(found?.[1])

      if (value === null) return { ok: false, why: `config "${String(rest[i + 1]).slice(0, 40)}" is not allowed: only a read-only sandbox_mode` }
      if (sandbox !== null && sandbox !== value) return { ok: false, why: 'two different sandbox modes' }
      sandbox = value
      args.push('-c', `sandbox_mode="${value}"`)
      i += 1
    } else if (token === '-m' || token === '--model') {
      const value = rest[i + 1] ?? ''

      if (!MODEL.test(value)) return { ok: false, why: 'the model name is not a plain name' }
      args.push(token, value)
      i += 1
    } else if (token === '-') {
      args.push('-')
      isLast = true
    } else if (rest[0] === 'resume' && !hasSession && SESSION.test(token)) {
      hasSession = true
      args.push(token)
    } else return { ok: false, why: `"${token.slice(0, 40)}" is not a flag the terminal passes to codex` }
  }

  if (sandbox === null) return { ok: false, why: 'no explicit sandbox: the terminal never relies on the default (a config file may widen it)' }
  if (!isLast) return { ok: false, why: 'the prompt goes on stdin: the argument list must end with -' }

  return { ok: true, args, sandbox }
}

export type HttpVerdict = { ok: true; url: URL } | { ok: false; why: string }
const HEADERS = new Set(['content-type', 'authorization'])
export const HTTP_BODY_MAX = 100_000

/** `https://<allowed host>/...`: https, no credentials in the URL, the default port, a host from the list exactly, POST, two headers, a bounded body. */
export function validateHttp(url: string, init: { method: string; headers: Record<string, string>; body: string }, allowedHosts: readonly string[]): HttpVerdict {
  let parsed: URL

  try {
    parsed = new URL(url)
  } catch {
    return { ok: false, why: 'not a URL' }
  }

  if (parsed.protocol !== 'https:') return { ok: false, why: 'https only' }
  if (parsed.username !== '' || parsed.password !== '') return { ok: false, why: 'no credentials in the URL' }
  if (parsed.port !== '' && parsed.port !== '443') return { ok: false, why: 'the default https port only' }
  if (!allowedHosts.includes(parsed.hostname.toLowerCase())) return { ok: false, why: `${parsed.hostname.slice(0, 60)} is not a host the terminal may send to (openrouter.ai and the hosts a convoTargets entry names)` }
  if (init.method !== 'POST') return { ok: false, why: 'POST only' }

  for (const name of Object.keys(init.headers)) if (!HEADERS.has(name.toLowerCase())) return { ok: false, why: `header "${name.slice(0, 30)}" is not sent` }

  if (init.body.length > HTTP_BODY_MAX) return { ok: false, why: 'the request is too large' }

  return { ok: true, url: parsed }
}

/** The hosts the AI page may send to: openrouter.ai and each https host a convoTargets entry names. Other schemes and addresses are left out. */
export function allowedHostsOf(endpointUrls: readonly string[]): string[] {
  const hosts = new Set(['openrouter.ai'])

  for (const raw of endpointUrls) {
    try {
      const url = new URL(raw)

      if (url.protocol === 'https:' && /^[a-z0-9]([a-z0-9.-]*[a-z0-9])?$/i.test(url.hostname) && !/^\d+(\.\d+){3}$/.test(url.hostname) && !/\.(internal|local)$/i.test(url.hostname)) hosts.add(url.hostname.toLowerCase())
    } catch {
      // an unreadable entry adds nothing
    }
  }

  return [...hosts]
}
