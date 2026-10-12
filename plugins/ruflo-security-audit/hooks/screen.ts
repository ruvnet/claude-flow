/**
 * Secret screening for the Security audit mod (copied from the ADR-445 AgentDB screen). Findings are NAMES only: the matched text is never
 * returned, logged or counted by value.
 */

// BEGIN SHARED SCREEN (generated from plugins/ruflo-agentdb/hooks/screen.ts by scripts/sync-mod-screen.mjs; do not edit in a copy)
export type Rules = readonly (readonly [string, RegExp])[]

/** The secret shapes every mod screens for. A plugin adds its own after these, outside the markers. */
export const COMMON_SECRETS: Rules = [
  ['private key', /-----BEGIN [A-Z ]*PRIVATE KEY-----/],
  ['aws access key', /\b(?:AKIA|ASIA)[0-9A-Z]{16}\b/],
  ['github token', /\b(?:gh[pousr]_[A-Za-z0-9]{30,}|github_pat_[A-Za-z0-9_]{40,})\b/],
  ['slack token', /\bxox[abprs]-[A-Za-z0-9-]{10,}/],
  ['slack webhook', /\bhooks\.slack\.com\/services\/T[A-Z0-9]{6,}\/B[A-Z0-9]{6,}\/[A-Za-z0-9]{16,}/],
  ['google api key', /\bAIza[0-9A-Za-z_-]{35}\b/],
  ['anthropic or openai key', /\bsk-(?:(?:ant|proj|svcacct|admin)-[A-Za-z0-9_-]{20,}|(?=[A-Za-z]{0,40}\d)[A-Za-z0-9]{32,})/],
  ['stripe key', /\b[rs]k_live_[A-Za-z0-9]{16,}/],
  ['npm token', /\bnpm_[A-Za-z0-9]{36}\b/],
  ['huggingface token', /\bhf_[A-Za-z0-9]{30,}\b/],
  ['sendgrid key', /\bSG\.[A-Za-z0-9_-]{16,}\.[A-Za-z0-9_-]{16,}/],
  ['twilio key', /\bSK[0-9a-f]{32}\b/],
  ['jwt', /\beyJ[A-Za-z0-9_-]{8,}\.eyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}/],
  ['bearer token', /\bBearer\s+([A-Za-z0-9._~+/=-]{24,})/],
  ['database url with credentials', /\b[a-z][a-z0-9+.-]{1,20}:\/\/[^\s:@/]+:[^\s@/]{3,}@[^\s/]+/i],
]

export const INJECTION: Rules = [
  ['override instructions', /\b(?:ignore|disregard|forget|override)\b[^.\n]{0,40}\b(?:previous|prior|above|earlier|all|any|system)\b[^.\n]{0,30}\b(?:instructions?|rules?|prompts?|guidelines?)\b/i],
  ['role reassignment', /\byou are (?:now|no longer)\b|\bact as (?:an? )?(?:unrestricted|jailbroken)\b/i],
  ['new instructions', /\b(?:new|updated|real) (?:system )?instructions?\s*:/i],
  ['fake role tags', /<\/?\s*(?:system|assistant|developer|instructions?)\s*>|^\s*(?:system|assistant)\s*:/im],
  ['concealment', /\bdo not (?:tell|inform|mention|reveal)[^.\n]{0,30}\b(?:user|human|operator)\b/i],
  ['exfiltration', /\b(?:exfiltrate|send|post|upload)\b[^.\n]{0,50}\b(?:secrets?|credentials?|tokens?|api keys?|\.env)\b/i],
  ['shell pipe', /\b(?:curl|wget)\b[^|\n]{0,200}\|\s*(?:sudo\s+)?(?:ba|z)?sh\b/i],
]

// C0/C1 controls (keeping tab and newline), DEL, soft hyphen, combining grapheme joiner, Arabic letter mark, Hangul and Mongolian fillers/separators,
// zero-width, bidi (overrides and isolates) and invisible-format characters, variation selectors; built with escapes, never raw.
const INVISIBLE = new RegExp(
  '[\\u0000-\\u0008\\u000b-\\u001f\\u007f-\\u009f\\u00ad\\u034f\\u061c\\u115f\\u1160\\u17b4\\u17b5\\u180b-\\u180e\\u200b-\\u200f\\u2028-\\u202e\\u2060-\\u206f\\u3164\\ufe00-\\ufe0f\\ufeff\\uffa0\\ufff9-\\ufffb]',
  'g',
)

/** Longest input scanned in one pass; a longer one keeps its head and tail halves. One regex pass per rule, so cost stays linear. */
const MAX_SCAN = 200_000

/** Input bounded to MAX_SCAN characters with invisible characters removed, so none can hide a secret or a phrase. */
export const bare = (text: string) =>
  (text.length > MAX_SCAN ? text.slice(0, MAX_SCAN / 2) + '\n' + text.slice(-MAX_SCAN / 2) : text).replace(INVISIBLE, '')

// A value is a secret CANDIDATE only when it is not a reference (env var, call, identifier path, placeholder, secret-manager path) and its
// shape is random enough: at least two character classes, one of them a digit or symbol, and Shannon entropy of at least 2.5 bits per character.
const PLACEHOLDER = /placeholder|your[-_ ]|example|changeme|change[-_]?me|redacted|dummy|replace[-_]?me|insert[-_]|\*{3,}|x{5,}|\.{3}|^(?:none|null|undefined|true|false)$/i
const REFERENCE =
  /^(?:\$(?:\{[^}]*\}|\(|[A-Za-z_]\w*$)|%[^%]*%$|<[^>]*>$|\{\{|process\.env|os\.environ|env[.[]|import\.meta|System\.getenv|secrets?\.|vault:|op:\/\/|ref\+|arn:|projects\/[^/]+\/secrets\/|gcp:|kms:|aws:|file:)/i
const CALL = /^[A-Za-z_$][\w$]*(?:\.[A-Za-z_$][\w$]*)*\(|^[A-Za-z_$][\w$]*\[/
const IDENT_PATH = /^[A-Za-z_$][\w$]*(?:\.[A-Za-z_$][\w$]*)+$/
const UUID = /^[0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12}$/i
const NAME_LIKE = /^[a-z][a-z0-9]*(?:[-_./][a-z0-9]+){2,}$/

function entropy(v: string): number {
  const counts = new Map<string, number>()
  for (const ch of v) counts.set(ch, (counts.get(ch) ?? 0) + 1)
  let h = 0
  for (const n of counts.values()) h -= (n / v.length) * Math.log2(n / v.length)
  return h
}

/** True when `v` is a name, call, path or placeholder rather than a literal credential. */
function isReference(v: string): boolean {
  if (PLACEHOLDER.test(v) || REFERENCE.test(v) || CALL.test(v) || IDENT_PATH.test(v) || URL_NO_CREDS.test(v)) return true
  return NAME_LIKE.test(v) && v.replace(/\D/g, '').length / v.length < 0.15
}

export function plausibleSecret(v: string): boolean {
  if (v.length < 8 || v.length > 256 || /\s/.test(v) || UUID.test(v) || isReference(v)) return false
  const symbol = /[^A-Za-z0-9]/.test(v)
  const digit = /\d/.test(v)
  const classes = [/[a-z]/.test(v), /[A-Z]/.test(v), digit, symbol].filter(Boolean).length
  return classes >= 2 && (digit || symbol) && entropy(v) >= 2.5
}

/** Under a secret-named key a literal this long is a secret even with one character class or a UUID shape, unless it is a clear reference. */
const KEYED_MIN = 20
const PLACEHOLDER_WORD = /(?:^|[^a-z])(?:your|placeholder|changeme|change[-_]?me|example|redacted|dummy|replace[-_]?me|insert)(?:[^a-z]|$)|\*{3,}|x{5,}|\.{3}|^(?:none|null|undefined|true|false)$/i
const URL_NO_CREDS = /^[a-z][a-z0-9+.-]{1,20}:\/\/[^\s@]*$/i

/** Three or more lowercase hyphen-separated words (no hex or digit-only run of 8+, few digits), such as my-k8s-secret-name-for-database. */
function hyphenName(v: string): boolean {
  const parts = v.split('-')
  return parts.length >= 3 && parts.every(p => /^[a-z0-9]{2,}$/.test(p) && !/^[0-9a-f]{8,}$/.test(p)) && v.replace(/\D/g, '').length / v.length < 0.15
}

function keyedSecret(v: string): boolean {
  if (v.length < KEYED_MIN || v.length > 256 || /\s/.test(v)) return false
  return !(PLACEHOLDER_WORD.test(v) || REFERENCE.test(v) || CALL.test(v) || IDENT_PATH.test(v) || URL_NO_CREDS.test(v) || (!UUID.test(v) && hyphenName(v)))
}

const KEY_NAME = /(?:api[_-]?key|secret|token|passw(?:or)?d|passwd|pwd|credential|private[_-]?key|auth(?!or))s?[A-Za-z0-9_-]{0,40}["']?\s*[:=]\s*/gi
const QUOTED = /(["'\x60])((?:(?!\1)[^\n]){1,256})\1/y
const BARE_VALUE = /[^\s"'\x60,;]{1,256}/y
const QUERY_VALUE = /[^\s"'\x60,;&]{1,256}/y

/** A secret-named key assigned a literal value: env style, JSON, YAML, code. Values that are calls, references or placeholders do not count. */
function assignmentSecret(text: string): boolean {
  let valueEnd = 0
  for (const m of text.matchAll(KEY_NAME)) {
    if (m.index < valueEnd) continue // a key-looking word inside the previous value, such as secretsmanager in an ARN
    const at = m.index + m[0].length
    let back = m.index
    while (back > 0 && m.index - back < 64 && /[A-Za-z0-9_.-]/.test(text.charAt(back - 1))) back--
    const re = /["'\x60]/.test(text.charAt(at)) ? QUOTED : /[?&]/.test(text.charAt(back - 1)) ? QUERY_VALUE : BARE_VALUE
    re.lastIndex = at
    const hit = re.exec(text)
    const v = hit && (hit[2] ?? hit[0])
    valueEnd = hit ? at + hit[0].length : at
    if (v && (plausibleSecret(v) || keyedSecret(v))) return true
  }
  return false
}

/** A password in a URL's userinfo that is not a placeholder such as user:password or ${DB_PASSWORD}. */
function urlCredential(url: string): boolean {
  const pass = /^[^:]+:\/\/[^\s:@/]+:([^\s@/]+)@/.exec(url)?.[1]
  if (!pass || /\$\{|\{\{|%\(|%s/.test(pass)) return false
  return !/^(?:password|passwd|pass|pwd|secret|changeme|dbpassword|db_password|\$\w*|<.*>|\{.*\}|\*+|x+)$/i.test(pass) && !PLACEHOLDER.test(pass)
}

const CHECKS: Readonly<Record<string, (m: RegExpMatchArray) => boolean>> = {
  'bearer token': m => !isReference(m[1] ?? ''),
  'database url with credentials': m => urlCredential(m[0]),
  'database url with password': m => urlCredential(m[0]),
}
const globals = new WeakMap<RegExp, RegExp>()

function matches(name: string, re: RegExp, text: string): boolean {
  if (name === 'key assignment') return assignmentSecret(text)
  const check = CHECKS[name]
  if (!check) return re.test(text)
  let g = globals.get(re)
  if (!g) globals.set(re, (g = new RegExp(re.source, re.flags.includes('g') ? re.flags : re.flags + 'g')))
  for (const m of text.matchAll(g)) if (check(m)) return true
  return false
}

/**
 * The text textsOf appends when it had to drop input (a node, character or per-string budget ran out). It is never matched against a rule:
 * `names` reports it as a finding of its own, so every guard that asks "is there a secret in these texts" refuses what it could not read in full.
 */
export const TRUNCATED = 'ruflo-screen: input exceeded the screening budget'
export const TRUNCATED_NAME = 'input too large to screen'

/** Names of the rules that match `text` (already bare'd). A rule named 'key assignment' is judged by assignmentSecret, whatever its regex. */
export const names = (rules: Rules, text: string) => text === TRUNCATED ? [TRUNCATED_NAME] : rules.filter(([name, re]) => matches(name, re, text)).map(([name]) => name)

export type Findings = { readonly secrets: readonly string[]; readonly injection: readonly string[] }

/** Names of every secret shape in `secrets` and every injection phrase found in `text`. Cost is linear in the capped input. */
export function screenWith(secrets: Rules, text: string): Findings {
  const bounded = bare(text)
  return { secrets: names(secrets, bounded), injection: names(INJECTION, bounded) }
}

export const hasSecretIn = (secrets: Rules, text: string) => names(secrets, bare(text)).length > 0

/** Makes stored text safe to show: no control or bidi characters, whitespace collapsed, at most `max` characters. */
export function tidy(text: string, max: number): string {
  const flat = text.replace(INVISIBLE, '').replace(/\s+/g, ' ').trim()
  return flat.length > max ? `${flat.slice(0, Math.max(0, max - 1))}…` : flat
}
/** Bounds for textsOf: nodes visited, characters returned, the longest string read in full, the size of one returned chunk, chunk overlap. */
export type TextLimits = { readonly nodes?: number; readonly chars?: number; readonly perString?: number }
const NODES = 20_000
const CHARS = 2_000_000
const PER_STRING = 1_500_000
const OVERLAP = 2_048
const BARE_KEY_MIN = 8

/** A string as texts the screen can read whole: one text up to MAX_SCAN, else overlapping MAX_SCAN windows so a secret anywhere is inside one. */
function windows(text: string, out: string[]): void {
  if (text.length <= MAX_SCAN) {
    out.push(text)
    return
  }
  for (let at = 0; ; at += MAX_SCAN - OVERLAP) {
    out.push(text.slice(at, at + MAX_SCAN))
    if (at + MAX_SCAN >= text.length) return
  }
}

/**
 * Every string in a tool input, for the screen to read: iterative (no recursion, so nesting 5000 deep cannot overflow the stack) and
 * breadth-first (siblings before depth, so a long list cannot hide a nested value). A string under an object key comes back as `key=value`,
 * so a secret-named key is judged with its value; a key whose value is not a string is returned bare. Strings longer than the screen window
 * come back as overlapping windows; one over `perString` keeps its head and tail. Work is bounded by `nodes` slots and `chars` characters.
 * Anything dropped (slots or characters ran out, or a string lost its middle) is reported by a final TRUNCATED text, which `names` and
 * `hasSecretIn` count as a finding, so the screen fails closed instead of passing what it did not read.
 */
export function textsOf(input: unknown, limits: TextLimits = {}): string[] {
  const out: string[] = []
  let slots = limits.nodes ?? NODES
  let chars = limits.chars ?? CHARS
  const perString = limits.perString ?? PER_STRING
  let truncated = false
  const take = (text: string): void => {
    if (chars <= 0) {
      truncated = true
      return
    }
    if (text.length <= Math.min(perString, chars)) {
      chars -= text.length
      windows(text, out)
      return
    }
    truncated = true
    const half = Math.floor(Math.min(perString, chars) / 2)
    chars -= 2 * half
    windows(text.slice(0, half), out)
    windows(text.slice(-half), out)
  }
  const queue: unknown[] = [input]
  let head = 0
  for (; head < queue.length && chars > 0; head++) {
    const node = queue[head]
    if (typeof node === 'string') take(node)
    else if (Array.isArray(node)) {
      let i = 0
      for (; i < node.length && slots > 0; i++, slots--) if (i in node) queue.push(node[i])
      if (i < node.length) truncated = true
    } else if (typeof node === 'object' && node !== null) {
      for (const k in node) {
        if (slots-- <= 0) {
          truncated = true
          break
        }
        if (!Object.prototype.hasOwnProperty.call(node, k)) continue
        const v = (node as Record<string, unknown>)[k]
        if (typeof v === 'string') queue.push(k + '=' + v)
        else {
          if (k.length >= BARE_KEY_MIN) take(k)
          queue.push(v)
        }
      }
    }
  }
  if (queue.length > head) truncated = true
  if (truncated) out.push(TRUNCATED)
  return out
}
// END SHARED SCREEN

const SECRETS: Rules = [
  ...COMMON_SECRETS,
  ['key assignment', /\b(?:api[_-]?key|secret|token|passw(?:or)?d|credential)s?["']?\s*[:=]\s*["']?[A-Za-z0-9/+=_.-]{16,}/i],
]

/** Names of every secret shape found in `text`. Cost is linear in the capped input. */
export const secretsIn = (text: string): string[] => names(SECRETS, bare(text))

export const hasSecret = (text: string) => hasSecretIn(SECRETS, text)
