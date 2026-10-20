/**
 * The ruvector CLI as fixed argv, the checks every typed value passes before it becomes an argv element, and the
 * readers for what it prints. Read against ruvector 0.3.3's own source (bin/cli.js) and `--help`: none of its brain,
 * rvf, rvlite, decompile, edge, identity or workers tools are in ruflo's MCP server, so each runs through this CLI or
 * not at all. Under a pipe the CLI prints JSON for brain, edge and identity; hooks and rvf print coloured text.
 * Pure: nothing here runs anything.
 */
import { plain } from './parse'

/**
 * The pin: the version the session's ruvector MCP server runs (`npx -y ruvector mcp start` resolved to 0.3.3), from
 * the npx cache only. The ruflo-ruvector plugin documents 0.2.25, which has no decompile MCP surface.
 */
export const RUVECTOR_VERSION = '0.3.3'
export const RV = ['npx', '--offline', '-y', `ruvector@${RUVECTOR_VERSION}`] as const

/** The vector lab's fields between renders: each Input's text, as the person typed it. */
export type VectorState = {
  /** A brain query, a memory id, a domain, `source target`, or `title :: content`, per the button pressed. */
  brain: string
  rvfPath: string
  /** The second RVF field: a query vector, an ingest file, a derived store, or a dimension. */
  rvfArg: string
  sql: string
  /** A local `./file.js` or an npm package to decompile. */
  target: string
  /** A task to route, a query to recall, or a note to remember. */
  task: string
  /** What a background worker is asked to look at. */
  worker: string
}

export const emptyVector = (): VectorState => ({ brain: '', rvfPath: '', rvfArg: '', sql: '', target: '', task: '', worker: '' })

export type VectorField = keyof VectorState

const TEXT = /^[\p{L}\p{N} .,:;!?'"()[\]{}/_@#+=&%*<>|~^$-]+$/u
const ID = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/
const DOMAIN = /^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/
const NUMBER = '-?(?:\\d+\\.?\\d*|\\.\\d+)(?:[eE][-+]?\\d+)?'
const VECTOR = new RegExp(`^${NUMBER}(?:,${NUMBER})*$`)
const NPM = /^(?:@[a-z0-9][a-z0-9._-]{0,63}\/)?[a-z0-9][a-z0-9._-]{0,127}(?:@[A-Za-z0-9.^~<>=+-]{1,40})?$/

export const MAX_TEXT = 8_000 // ARGV_TEXT_MAX: one argv element (ADR-481)

/** Free text, trimmed, or null: empty, too long, a control character, a character outside TEXT, or a leading -. */
export function textOf(value: string, max = MAX_TEXT): string | null {
  // Runs of spaces are one space (the text is words); nothing is cut: over `max` is null and the runner says by how much.
  const text = value.trim().replace(/ {2,}/g, ' ')

  return text === '' || text.length > max || text.startsWith('-') || !TEXT.test(text) ? null : text
}

export const vecIdOf = (value: string): string | null => (ID.test(value.trim()) ? value.trim() : null)
export const domainOf = (value: string): string | null => (DOMAIN.test(value.trim()) ? value.trim() : null)

/**
 * A path inside the project, or null: relative (no leading / or -), no `..` segment, plain characters only, and the
 * file kind asked for. `./` is kept off: the CLI joins it to the working directory either way.
 */
export function relPathOf(value: string, ext: string): string | null {
  const path = value.trim().replace(/^\.\//, '')

  if (path === '' || path.length > 160 || path.startsWith('/') || path.startsWith('-') || !path.endsWith(ext)) return null
  if (!/^[A-Za-z0-9._/-]+$/.test(path) || path.split('/').some(part => part === '..' || part === '' || part === '.')) return null

  return path
}

/** A query vector as the CLI takes it (`--vector=<values>`), commas between at most 4096 finite numbers. */
export function vectorOf(value: string): string | null {
  const text = value.replace(/[\s[\]]/g, '')

  if (text === '' || text.length > 65_536 || !VECTOR.test(text)) return null

  const parts = text.split(',')

  return parts.length <= 4096 && parts.every(part => Number.isFinite(Number(part))) ? text : null
}

/** A store dimension for `rvf create`: 1-4096, 384 when the field is empty. */
export function dimensionOf(value: string): string | null {
  const text = value.trim()

  if (text === '') return '384'

  return /^\d{1,4}$/.test(text) && Number(text) >= 1 && Number(text) <= 4096 ? String(Number(text)) : null
}

/** What `decompile` is pointed at, classified as ruvector's own parseTarget does: `./…` is a file, the rest npm. */
export type Target = { kind: 'file'; arg: string } | { kind: 'npm'; arg: string }

/**
 * A decompile target, or null. A file must be a relative `.js`, `.mjs` or `.cjs` (passed as `./path`, which the CLI
 * reads as a file); a package is an npm name with an optional `@version`. URLs are refused: the console fetches no
 * address a person typed.
 */
export function targetOf(value: string): Target | null {
  const text = value.trim()

  if (/^[a-z]+:/i.test(text)) return null

  const file = /\.(m|c)?js$/.test(text) && (text.startsWith('./') || text.includes('/')) && !text.startsWith('@') ? relPathOf(text, text.slice(text.lastIndexOf('.'))) : null

  if (file !== null) return { kind: 'file', arg: `./${file}` }

  return text.length <= 214 && NPM.test(text) ? { kind: 'npm', arg: text } : null
}

/** `title :: content` for brain share: both present, each plain text. */
export function shareOf(value: string): { title: string; content: string } | null {
  const at = value.indexOf('::')
  const title = at < 0 ? null : textOf(value.slice(0, at), 500)
  const content = at < 0 ? null : textOf(value.slice(at + 2), MAX_TEXT)

  return title === null || content === null ? null : { title, content }
}

/** Two words split at the first space: `source target`, `store.rvf vector`. */
export function twoOf(value: string): [string, string] {
  const text = value.trim()
  const at = text.search(/\s/)

  return at < 0 ? [text, ''] : [text.slice(0, at), text.slice(at + 1).trim()]
}

// Key material never reaches a line: a 64-hex pi key, its preview, the MCP token, or an `export PI=` hint.
const KEY_LINE = /(^|\s)(key|key_preview|mcp_token|apiKey)\s*:|export PI=|pi-key\s*:/i
const HEX_KEY = /\b[0-9a-f]{32,}\b/gi

/** Lines with any key material taken out: whole lines that name a key, and any long hex run in what is left. */
export function redact(lines: readonly string[]): string[] {
  return lines.filter(line => !KEY_LINE.test(line)).map(line => line.replace(HEX_KEY, hex => (/^[0-9a-f]{32}$/i.test(hex) ? hex : '‹redacted›')))
}

/** `identity generate --save --json`: only the pseudonym and where the key went; the key itself is never read out. */
export function generatedLines(stdout: string, stderr = ''): string[] {
  const pseudonym = /"pseudonym"\s*:\s*"([0-9a-f]{16,64})"/i.exec(stdout)?.[1]
  const saved = /Key saved to (\S+)/.exec(stdout)?.[1]

  if (pseudonym === undefined) return redact([plain(stderr, 160) || 'identity generate printed no pseudonym'])

  return [`pseudonym ${pseudonym}`, `key saved to ${saved !== undefined ? plain(saved, 120) : '~/.ruvector/pi-key'} (not shown: it is the secret)`]
}

/** True when the newest identity show said there is no key: the only state in which generate --save cannot overwrite one. */
export const isKeyless = (lines: readonly string[]): boolean => lines.some(line => /No pi key found/i.test(line))
