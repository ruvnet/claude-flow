/**
 * The autopilot's scope contract (ADR-466 §1): the ONE thing the person approves. Pure. An envelope is validated field by field (an
 * unknown field is an error, so nothing can smuggle in a grant), canonicalised, hashed and sealed with a revision. A sealed file whose
 * hash does not match its body is treated as tampered and the loop refuses to run on it. Hard denies are not part of the envelope: they
 * are a constant of this file, and an envelope that names one as allowed is rejected, never trimmed.
 */

/** Classes of action an envelope can allow. Each task is classified (data/ap-guard.ts) into exactly one, or is parked. */
export const TOOL_CLASSES = ['read', 'edit', 'test', 'git-local', 'git-branch', 'network', 'spawn', 'mcp'] as const
export type ToolClass = (typeof TOOL_CLASSES)[number]

/** What autopilot can never be granted, however the envelope is written. */
export const HARD_DENIES = ['publish', 'release', 'deploy', 'force-push', 'secret-access', 'delete-outside-worktree', 'envelope-edit'] as const
export type HardDeny = (typeof HARD_DENIES)[number]

/** Words that mean a hard deny. Matching is deliberately broad: a false match only parks a task for a question (and rejects a verify command). */
export const DENY_PATTERNS: readonly [HardDeny, RegExp][] = [
  ['publish', /\b(npm\s+publish|publish(es|ed|ing)?\b|pnpm\s+publish|cargo\s+publish|twine|docker\s+push)/i],
  ['release', /\b(gh\s+release|git\s+tag\b.*push|cut\s+a\s+release|create\s+(a\s+)?release|release\s+notes?\s+and\s+tag)/i],
  ['deploy', /\b(deploy(s|ed|ing)?\b|gcloud\s+run\s+deploy|firebase\s+deploy|kubectl\s+apply|terraform\s+apply)/i],
  ['force-push', /(push\s+(--force|-f\b|--force-with-lease)|force[- ]push)/i],
  ['secret-access', /\b(api[_ -]?key|secret|credential|password|private\s+key|\.env\b|gcloud\s+secrets|token)\b/i],
  ['delete-outside-worktree', /\b(rm\s+-rf?\s+(\/|~|\$HOME)|delete\s+(the\s+)?(home|root|\/)|drop\s+database|mkfs|dd\s+of=\/dev)/i],
  ['envelope-edit', /\b(autopilot\s+(envelope|scope|settings)|widen\s+(the\s+)?(envelope|scope)|raise\s+(the\s+)?(spend|budget)\s+(cap|ceiling)|grant\s+(itself|autopilot))|\.claude-flow\/(console\/autopilot|protector-mod)|autopilot\/(envelope|journal|kill)|protector-mod|\b(clear|remove|delete|rm|unset|touch)\b[^\n]{0,40}\bkill\s*(flag|switch|file)\b/i],
]

/** Folders the autopilot's own steps may never be pointed at: its envelope, journal and kill flag, and Project Anatole's status. A task or envelope that names one is refused, not trimmed. */
export const PROTECTED_DIRS = ['.claude-flow/console', '.claude-flow/protector-mod'] as const
export const isProtectedPath = (path: string): boolean => {
  const flat = path.replace(/\/+/g, '/').replace(/\/\.\//g, '/')

  return PROTECTED_DIRS.some(dir => flat.includes(dir)) || flat.endsWith('/.claude-flow') || flat.endsWith('/.claude-flow/')
}

/** Programs a verify command may not run: shells and wrappers (they turn an argv into a shell line), privilege and network tools, and destructive ones. */
const VERIFY_BANNED = new Set(['sh', 'bash', 'zsh', 'dash', 'fish', 'ksh', 'csh', 'tcsh', 'env', 'xargs', 'sudo', 'doas', 'su', 'eval', 'exec', 'nohup', 'setsid', 'timeout', 'time', 'watch', 'rm', 'rmdir', 'dd', 'mkfs', 'shred', 'chmod', 'chown', 'mv', 'ln', 'curl', 'wget', 'nc', 'ncat', 'socat', 'ssh', 'scp', 'sftp', 'rsync', 'ftp', 'telnet', 'python', 'python3', 'perl', 'ruby', 'php', 'osascript', 'crontab', 'systemctl', 'kill', 'pkill', 'killall', 'tee', 'cp', 'install', 'truncate'])
const hasCmdSubstitution = (part: string): boolean => /[`\n]|\$\(|;|&&|\|\||\|/.test(part)

/** Why a verify argv is refused, or null. The program is its basename; a shell metacharacter in any part, a banned program or a hard-deny word refuses it. */
export function verifyProblem(argv: readonly string[]): string | null {
  const program = (argv[0] ?? '').split('/').at(-1)?.toLowerCase() ?? ''

  if (VERIFY_BANNED.has(program)) return `"${program.slice(0, 20)}" is a shell, a wrapper or a destructive or network tool and cannot be a verify command`
  if (argv.some(hasCmdSubstitution)) return 'a verify part holds a shell metacharacter (; | & ` $( newline): give a program and its arguments only'

  const joined = argv.join(' ')
  const denied = DENY_PATTERNS.find(([, pattern]) => pattern.test(joined))?.[0]

  return denied === undefined ? null : `it names "${denied}", which can never be granted`
}

export const ENVELOPE_VERSION = 1
export const MIN_DURATION_MS = 3_600_000
export const MAX_DURATION_MS = 90 * 86_400_000
export const MAX_CONCURRENCY = 8

export type Spend = { hourUsd: number; dayUsd: number; totalUsd: number }

export type Envelope = {
  name: string
  toolClasses: ToolClass[]
  /** Absolute folders the work may touch (a path is inside when it is the folder or below it). */
  paths: string[]
  /** `owner/name` repositories it may use. */
  repos: string[]
  /** Hostnames it may reach. */
  network: string[]
  /** Names of environment variables it may read; never their values. */
  secretEnv: string[]
  spend: Spend
  concurrency: number
  maxDurationMs: number
  /** Fixed argv lists run after a step to check its effect (tests, gates). A step with none is recorded as unverified. */
  verify: string[][]
  /** Recorded consent to run with Project Anatole absent or off. */
  acceptWithoutAnatole: boolean
}

const KEYS = ['name', 'toolClasses', 'paths', 'repos', 'network', 'secretEnv', 'spend', 'concurrency', 'maxDurationMs', 'verify', 'acceptWithoutAnatole'] as const
// eslint-disable-next-line no-control-regex
const BAD_CHARS = /[\u0000-\u001f\u007f-\u009f​-‏‪-‮⁠-⁩﻿]|[\u{e0000}-\u{e0fff}]/u
const REPO = /^[A-Za-z0-9_.-]{1,60}\/[A-Za-z0-9_.-]{1,100}$/
const HOST = /^[a-z0-9]([a-z0-9.-]{0,251}[a-z0-9])?$/
const ENV = /^[A-Z][A-Z0-9_]{1,63}$/

export type Checked = { ok: true; envelope: Envelope } | { ok: false; errors: string[] }

const isRecord = (value: unknown): value is Record<string, unknown> => typeof value === 'object' && value !== null && !Array.isArray(value)
const strings = (value: unknown, max: number): string[] | null => (Array.isArray(value) && value.length <= max && value.every(item => typeof item === 'string') ? (value as string[]) : null)
const money = (value: unknown): value is number => typeof value === 'number' && Number.isFinite(value) && value > 0 && value <= 1_000_000

/** True for a name that is, or says it is, a hard deny. */
export const isHardDeny = (name: string): boolean => (HARD_DENIES as readonly string[]).includes(name.trim().toLowerCase())

/** Validates a candidate envelope. Every problem is listed; nothing is repaired or clamped. */
export function validateEnvelope(raw: unknown): Checked {
  const errors: string[] = []

  if (!isRecord(raw)) return { ok: false, errors: ['an envelope is an object'] }

  for (const key of Object.keys(raw)) if (!(KEYS as readonly string[]).includes(key)) errors.push(`unknown field "${key.slice(0, 30)}": nothing is granted by a field this console does not define`)

  const name = typeof raw.name === 'string' && raw.name.trim() !== '' && raw.name.length <= 60 && !BAD_CHARS.test(raw.name) ? raw.name.trim() : null

  if (name === null) errors.push('name: 1 to 60 printable characters')

  const classes = strings(raw.toolClasses, 12)

  if (classes === null) errors.push('toolClasses: a list of tool classes')

  for (const entry of classes ?? []) {
    if (isHardDeny(entry)) errors.push(`toolClasses: "${entry}" is a hard deny and can never be granted to autopilot`)
    else if (!(TOOL_CLASSES as readonly string[]).includes(entry)) errors.push(`toolClasses: unknown class "${entry.slice(0, 20)}"`)
  }

  const paths = strings(raw.paths, 20)

  if (paths === null || paths.length === 0) errors.push('paths: at least one absolute folder')

  for (const path of paths ?? []) {
    if (!path.startsWith('/') || path === '/' || path.length > 300 || BAD_CHARS.test(path) || path.split('/').includes('..') || path.includes('\\')) errors.push(`paths: "${path.slice(0, 40)}" is not an absolute folder below the root with no ..`)
    else if (isProtectedPath(path)) errors.push(`paths: "${path.slice(0, 40)}" is the autopilot's or Project Anatole's own folder: steps are never pointed at it`)
  }

  const repos = strings(raw.repos, 20)

  if (repos === null) errors.push('repos: a list of owner/name')

  for (const repo of repos ?? []) if (!REPO.test(repo)) errors.push(`repos: "${repo.slice(0, 40)}" is not owner/name`)

  const network = strings(raw.network, 30)

  if (network === null) errors.push('network: a list of hostnames (empty means none)')

  for (const host of network ?? []) if (!HOST.test(host) || host.includes('..')) errors.push(`network: "${host.slice(0, 40)}" is not a lowercase hostname (no wildcard, no port)`)

  const secretEnv = strings(raw.secretEnv, 8)

  if (secretEnv === null) errors.push('secretEnv: a list of up to 8 variable names (empty means none)')

  for (const variable of secretEnv ?? []) if (!ENV.test(variable)) errors.push(`secretEnv: "${variable.slice(0, 30)}" is not a variable name; give names only, never values`)

  const spend = isRecord(raw.spend) ? raw.spend : null
  const spendOk = spend !== null && money(spend.hourUsd) && money(spend.dayUsd) && money(spend.totalUsd)

  if (!spendOk) errors.push('spend: hourUsd, dayUsd and totalUsd, each above 0')
  else if (!((spend.hourUsd as number) <= (spend.dayUsd as number) && (spend.dayUsd as number) <= (spend.totalUsd as number))) errors.push('spend: hour must not exceed day, nor day the total')

  const concurrency = raw.concurrency

  if (typeof concurrency !== 'number' || !Number.isInteger(concurrency) || concurrency < 1 || concurrency > MAX_CONCURRENCY) errors.push(`concurrency: a whole number from 1 to ${MAX_CONCURRENCY}`)

  const duration = raw.maxDurationMs

  if (typeof duration !== 'number' || !Number.isFinite(duration) || duration < MIN_DURATION_MS || duration > MAX_DURATION_MS) errors.push('maxDurationMs: from 1 hour to 90 days')

  const verify = raw.verify

  if (!Array.isArray(verify) || verify.length > 6 || !verify.every(argv => Array.isArray(argv) && argv.length >= 1 && argv.length <= 24 && argv.every(part => typeof part === 'string' && part.length <= 300 && !BAD_CHARS.test(part)))) errors.push('verify: up to 6 argv lists of plain strings (a program and its arguments, never a shell line)')

  if (Array.isArray(verify) && errors.every(e => !e.startsWith('verify'))) for (const argv of verify as string[][]) {
    const problem = verifyProblem(argv)

    if (problem !== null) errors.push(`verify: ${problem}`)
  }

  if (typeof raw.acceptWithoutAnatole !== 'boolean') errors.push('acceptWithoutAnatole: true or false')

  if (errors.length > 0) return { ok: false, errors }

  return {
    ok: true,
    envelope: {
      name: name as string,
      toolClasses: [...new Set(classes as ToolClass[])].sort(),
      paths: [...new Set(paths as string[])].map(path => path.replace(/\/+$/, '')).sort(),
      repos: [...new Set(repos as string[])].sort(),
      network: [...new Set(network as string[])].sort(),
      secretEnv: [...new Set(secretEnv as string[])].sort(),
      spend: { hourUsd: (spend as Spend).hourUsd, dayUsd: (spend as Spend).dayUsd, totalUsd: (spend as Spend).totalUsd },
      concurrency: concurrency as number,
      maxDurationMs: duration as number,
      verify: (verify as string[][]).map(argv => [...argv]),
      acceptWithoutAnatole: raw.acceptWithoutAnatole as boolean,
    },
  }
}

/** Stable JSON: keys sorted at every level, so the same envelope always hashes the same. */
export function canonical(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`
  if (isRecord(value)) return `{${Object.keys(value).sort().map(key => `${JSON.stringify(key)}:${canonical(value[key])}`).join(',')}}`

  return JSON.stringify(value) ?? 'null'
}

const K = Uint32Array.from([
  0x428a2f98, 0x71374491, 0xb5c0fbcf, 0xe9b5dba5, 0x3956c25b, 0x59f111f1, 0x923f82a4, 0xab1c5ed5, 0xd807aa98, 0x12835b01, 0x243185be, 0x550c7dc3, 0x72be5d74, 0x80deb1fe, 0x9bdc06a7, 0xc19bf174, 0xe49b69c1, 0xefbe4786, 0x0fc19dc6, 0x240ca1cc, 0x2de92c6f, 0x4a7484aa, 0x5cb0a9dc, 0x76f988da,
  0x983e5152, 0xa831c66d, 0xb00327c8, 0xbf597fc7, 0xc6e00bf3, 0xd5a79147, 0x06ca6351, 0x14292967, 0x27b70a85, 0x2e1b2138, 0x4d2c6dfc, 0x53380d13, 0x650a7354, 0x766a0abb, 0x81c2c92e, 0x92722c85, 0xa2bfe8a1, 0xa81a664b, 0xc24b8b70, 0xc76c51a3, 0xd192e819, 0xd6990624, 0xf40e3585, 0x106aa070,
  0x19a4c116, 0x1e376c08, 0x2748774c, 0x34b0bcb5, 0x391c0cb3, 0x4ed8aa4a, 0x5b9cca4f, 0x682e6ff3, 0x748f82ee, 0x78a5636f, 0x84c87814, 0x8cc70208, 0x90befffa, 0xa4506ceb, 0xbef9a3f7, 0xc67178f2,
])

/** SHA-256 in plain TypeScript (the engine's module host is not promised `node:crypto`). Hex digest of the UTF-8 text. */
export function sha256(text: string): string {
  const bytes = new TextEncoder().encode(text)
  const total = Math.ceil((bytes.length + 9) / 64) * 64
  const data = new Uint8Array(total)

  data.set(bytes)
  data[bytes.length] = 0x80

  const view = new DataView(data.buffer)

  view.setUint32(total - 8, Math.floor((bytes.length * 8) / 0x100000000))
  view.setUint32(total - 4, (bytes.length * 8) >>> 0)

  const h = Uint32Array.from([0x6a09e667, 0xbb67ae85, 0x3c6ef372, 0xa54ff53a, 0x510e527f, 0x9b05688c, 0x1f83d9ab, 0x5be0cd19])
  const w = new Uint32Array(64)
  const rotr = (x: number, n: number): number => (x >>> n) | (x << (32 - n))

  for (let offset = 0; offset < total; offset += 64) {
    for (let i = 0; i < 16; i++) w[i] = view.getUint32(offset + i * 4)

    for (let i = 16; i < 64; i++) {
      const a = w[i - 15] as number
      const b = w[i - 2] as number

      w[i] = ((w[i - 16] as number) + (rotr(a, 7) ^ rotr(a, 18) ^ (a >>> 3)) + (w[i - 7] as number) + (rotr(b, 17) ^ rotr(b, 19) ^ (b >>> 10))) >>> 0
    }

    let [a, b, c, d, e, f, g, hh] = h as unknown as number[] as [number, number, number, number, number, number, number, number]

    for (let i = 0; i < 64; i++) {
      const t1 = (hh + (rotr(e, 6) ^ rotr(e, 11) ^ rotr(e, 25)) + ((e & f) ^ (~e & g)) + (K[i] as number) + (w[i] as number)) >>> 0
      const t2 = ((rotr(a, 2) ^ rotr(a, 13) ^ rotr(a, 22)) + ((a & b) ^ (a & c) ^ (b & c))) >>> 0

      hh = g
      g = f
      f = e
      e = (d + t1) >>> 0
      d = c
      c = b
      b = a
      a = (t1 + t2) >>> 0
    }

    const next = [a, b, c, d, e, f, g, hh]

    for (let i = 0; i < 8; i++) h[i] = ((h[i] as number) + (next[i] as number)) >>> 0
  }

  return [...h].map(word => word.toString(16).padStart(8, '0')).join('')
}

export const hashOf = (envelope: Envelope): string => sha256(canonical(envelope))

/** What is written to disk: the envelope, which revision of it this is, when the person approved it, and its hash. */
export type Sealed = { version: number; revision: number; approvedAtMs: number; hash: string; envelope: Envelope }

export const seal = (envelope: Envelope, revision: number, approvedAtMs: number): Sealed => ({ version: ENVELOPE_VERSION, revision, approvedAtMs, hash: hashOf(envelope), envelope })

export type Opened = { ok: true; sealed: Sealed } | { ok: false; why: string }

/** Reads a sealed envelope back: it must parse, validate, and hash to what it says. A mismatch is "tampered", never repaired. */
export function open(text: string | null): Opened {
  if (text === null) return { ok: false, why: 'no envelope approved yet' }

  let value: unknown

  try {
    value = JSON.parse(text)
  } catch {
    return { ok: false, why: 'the envelope file is not JSON' }
  }

  if (!isRecord(value) || value.version !== ENVELOPE_VERSION || typeof value.hash !== 'string' || typeof value.revision !== 'number' || typeof value.approvedAtMs !== 'number') return { ok: false, why: 'the envelope file is not a version-1 sealed envelope' }

  const checked = validateEnvelope(value.envelope)

  if (!checked.ok) return { ok: false, why: `the envelope no longer validates: ${checked.errors[0]}` }
  if (hashOf(checked.envelope) !== value.hash) return { ok: false, why: 'the envelope does not match its hash: it was changed outside the console, so autopilot will not run on it' }

  return { ok: true, sealed: { version: ENVELOPE_VERSION, revision: value.revision, approvedAtMs: value.approvedAtMs, hash: value.hash, envelope: checked.envelope } }
}

/** Dimensions in which `next` grants more than `prev`. Empty means it only narrows or keeps. Any change at all needs a fresh confirm; this says what the confirm card should warn about. */
export function widened(prev: Envelope, next: Envelope): string[] {
  const out: string[] = []
  const grew = (label: string, before: readonly string[], after: readonly string[]): void => {
    const added = after.filter(item => !before.includes(item))

    if (added.length > 0) out.push(`${label}: adds ${added.slice(0, 4).join(', ')}${added.length > 4 ? '…' : ''}`)
  }

  grew('tool classes', prev.toolClasses, next.toolClasses)
  grew('paths', prev.paths, next.paths)
  grew('repos', prev.repos, next.repos)
  grew('network', prev.network, next.network)
  grew('secret env', prev.secretEnv, next.secretEnv)
  grew('verify commands', prev.verify.map(argv => argv.join(' ')), next.verify.map(argv => argv.join(' ')))

  for (const key of ['hourUsd', 'dayUsd', 'totalUsd'] as const) if (next.spend[key] > prev.spend[key]) out.push(`${key}: ${prev.spend[key]} to ${next.spend[key]}`)

  if (next.concurrency > prev.concurrency) out.push(`concurrency: ${prev.concurrency} to ${next.concurrency}`)
  if (next.maxDurationMs > prev.maxDurationMs) out.push('duration: longer')
  if (next.acceptWithoutAnatole && !prev.acceptWithoutAnatole) out.push('runs without Project Anatole')

  return out
}

/** Dimensions in which `next` grants LESS than `prev` (the diff the confirm card and the editor show beside `widened`). */
export function narrowed(prev: Envelope, next: Envelope): string[] {
  const out: string[] = []
  const shrank = (label: string, before: readonly string[], after: readonly string[]): void => {
    const removed = before.filter(item => !after.includes(item))

    if (removed.length > 0) out.push(`${label}: removes ${removed.slice(0, 4).join(', ')}${removed.length > 4 ? '…' : ''}`)
  }

  shrank('tool classes', prev.toolClasses, next.toolClasses)
  shrank('paths', prev.paths, next.paths)
  shrank('repos', prev.repos, next.repos)
  shrank('network', prev.network, next.network)
  shrank('secret env', prev.secretEnv, next.secretEnv)
  shrank('verify commands', prev.verify.map(argv => argv.join(' ')), next.verify.map(argv => argv.join(' ')))

  for (const key of ['hourUsd', 'dayUsd', 'totalUsd'] as const) if (next.spend[key] < prev.spend[key]) out.push(`${key}: ${prev.spend[key]} to ${next.spend[key]}`)

  if (next.concurrency < prev.concurrency) out.push(`concurrency: ${prev.concurrency} to ${next.concurrency}`)
  if (next.maxDurationMs < prev.maxDurationMs) out.push('duration: shorter')
  if (!next.acceptWithoutAnatole && prev.acceptWithoutAnatole) out.push('no longer runs without Project Anatole')

  return out
}

/** A path is inside the envelope when it is one of its folders or below one (compared at a folder boundary, so /a/bc is not inside /a/b). */
export const pathAllowed = (envelope: Envelope, path: string): boolean => !path.split('/').includes('..') && !isProtectedPath(path) && envelope.paths.some(root => path === root || path.startsWith(`${root}/`))

export const hostAllowed = (envelope: Envelope, host: string): boolean => envelope.network.includes(host.toLowerCase())

export const classAllowed = (envelope: Envelope, toolClass: string): boolean => (envelope.toolClasses as readonly string[]).includes(toolClass)

/** The file the sealed envelope lives in, and its siblings. */
export const AUTOPILOT_DIR = '.claude-flow/console/autopilot'
export const ENVELOPE_FILE = `${AUTOPILOT_DIR}/envelope.json`
export const KILL_FILE = `${AUTOPILOT_DIR}/KILL`
