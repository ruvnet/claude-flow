/**
 * Line patterns for `security scan` phase 3, and what each line is tested on.
 *
 * The patterns are a heuristic. Each is narrowed only where a false positive was seen on a real tree, and only by a
 * shape that cannot carry the risk the rule looks for:
 *  - every rule is tested after comment text is blanked, so a comment naming `child_process.execFile` or `eval(` is
 *    not a finding;
 *  - eval needs a word start: "retrieval (" in prose is not a call; `eval(` and `window.eval(` still are;
 *  - command injection keeps the old rule's reach (any `exec` after `child_process` on the line), and no longer skips
 *    execSync as `exec[^S]` did;
 *  - a pg placeholder such as `$${paramCount + 1}` is a parameter number, not a value in the SQL text. It is exempt only
 *    when its expression is a number, a loop letter, `params.length`-style, or a name containing `param` or `placeholder`, it
 *    stands where SQL takes a value, and it is not inside a quoted SQL string.
 */

export type CodePattern = {
  /** Tested on one comment-stripped line. */
  match: (line: string) => boolean
  type: string
  severity: 'high' | 'medium'
  desc: string
}

/** No `g` flag, so `test` keeps no lastIndex between lines. */
const re = (pattern: RegExp) => (line: string) => pattern.test(line)

// A `.length` counts only on a param-, value- or arg-named array: `req.body.length` is whatever the client sent.
const COUNTER = /^\s*(?:\d+|[ijkn]|(?:[A-Za-z_$][\w$]*(?:Params?|Placeholders?|Values?|Args?)|params?|placeholders?|values?|args?)\.length|[A-Za-z_$]*(?:[Pp]aram|[Pp]laceholder)[\w$]*)\s*(?:[+-]\s*\d+\s*)?$/
// Where a pg parameter stands in SQL: after a comparison, a list or call opener, or a clause keyword.
const PARAM_BEFORE = /(?:[=<>(,]|\b(?:LIMIT|OFFSET|IN|VALUES|BETWEEN|AND|OR|LIKE|ILIKE|SET|BY|THEN|ELSE|WHEN|IS))\s*$/i
const PARAM_AFTER = /^(?:\s|[,);]|::|$|`)/

/**
 * `$${paramCount}` / `LIMIT $${params.length + 1}`: the pg parameter number where SQL takes a value, not interpolated
 * SQL text. `'$${n}'`, `"$${n}"`, `$${userInput}` and `x $${discount}` keep their interpolation. One left-to-right
 * pass: quotes are counted since the last backtick, so a placeholder inside a quoted SQL string keeps its finding.
 */
export const withoutPlaceholders = (line: string): string => {
  const token = /\\[\s\S]|\$\$\{([^}]{0,80})\}|[`'"]/g
  let single = 0
  let double = 0
  let out = ''
  let kept = 0

  for (let m = token.exec(line); m !== null; m = token.exec(line)) {
    if (m[0][0] === '\\') continue
    if (m[0] === '`') { single = 0; double = 0; continue }
    if (m[0] === "'") { single++; continue }
    if (m[0] === '"') { double++; continue }
    const end = m.index + m[0].length
    const isParam = single % 2 === 0 && double % 2 === 0 && COUNTER.test(m[1])
      && PARAM_BEFORE.test(line.slice(Math.max(0, m.index - 16), m.index)) && PARAM_AFTER.test(line.slice(end, end + 2))
    if (isParam) { out += line.slice(kept, m.index); kept = end }
  }

  return out + line.slice(kept)
}

/** The old `/\$\{.*\}.*sql|sql.*\$\{/i`, in linear time: a long minified line made the regex quadratic. */
const sqlInterpolation = (line: string): boolean => {
  const lower = line.toLowerCase()
  const open = line.indexOf('${')
  const close = open < 0 ? -1 : line.indexOf('}', open + 2)
  if (close >= 0 && lower.indexOf('sql', close + 1) >= 0) return true
  const sql = lower.indexOf('sql')
  return sql >= 0 && line.indexOf('${', sql + 3) >= 0
}

export const CODE_PATTERNS: readonly CodePattern[] = [
  { match: re(/(?<![\w$])eval\s*\(/), type: 'Eval Usage', severity: 'medium', desc: 'eval() can execute arbitrary code' },
  { match: re(/innerHTML\s*=/), type: 'innerHTML', severity: 'medium', desc: 'XSS risk with innerHTML' },
  { match: re(/dangerouslySetInnerHTML/), type: 'React XSS', severity: 'medium', desc: 'React XSS risk' },
  { match: re(/child_process.*exec/), type: 'Command Injection', severity: 'high', desc: 'Possible command injection' },
  { match: line => sqlInterpolation(line) && sqlInterpolation(withoutPlaceholders(line)), type: 'SQL Injection', severity: 'high', desc: 'Possible SQL injection' },
]

/**
 * The file's lines with comment text blanked (line count kept, so locations stay right). Strings are respected, so
 * `'http://x'` is not a comment; a template literal may span lines. Regex literals and JSX text are not parsed, so a
 * `//`, `/*` or backtick inside one can be misread. The damage is bounded to one line: a block comment carries to the
 * next line only from a `/*` that starts its line, and only through lines that look like comment lines (they start
 * with `*` or contain the closing `*` + `/`). Any other line ends the carried comment and is scanned as code. One pass,
 * linear in the file size.
 */
export function codeLinesOf(content: string): string[] {
  const out: string[] = []
  let inBlock = false
  let inTemplate = false

  for (const line of content.split('\n')) {
    if (inBlock && !/^\s*\*|\*\//.test(line)) inBlock = false
    const parts: string[] = []
    let tail = ''
    let hasCode = false
    let quote: string | null = inTemplate ? '`' : null
    let carries = inBlock
    // Parts plus a 12-character tail, not one growing string: slicing a concatenated string flattens it each time.
    const emit = (text: string) => {
      parts.push(text)
      tail = (tail + text).slice(-12)
      if (/\S/.test(text)) hasCode = true
    }

    for (let i = 0; i < line.length; i++) {
      const ch = line[i]
      const next = line[i + 1]

      if (inBlock) {
        if (ch === '*' && next === '/') { inBlock = false; i++; emit(' ') }
        continue
      }
      if (ch === '\\') { emit(ch + (next ?? '')); i++; continue }
      if (quote !== null) {
        if (ch === quote) quote = null
        emit(ch)
        continue
      }
      // `://` is a URL scheme, not a comment.
      if (ch === '/' && next === '/' && line[i - 1] !== ':') break
      if (ch === '/' && next === '*') {
        inBlock = true
        carries = !hasCode
        i++
        emit(' ')
        continue
      }
      if (ch === '/' && REGEX_MAY_START.test(tail)) {
        const end = regexEnd(line, i)
        if (end > i) { emit(line.slice(i, end + 1)); i = end; continue }
      }
      if (ch === '"' || ch === "'" || ch === '`') quote = ch
      emit(ch)
    }

    if (inBlock && !carries) inBlock = false
    inTemplate = quote === '`'
    out.push(parts.join(''))
  }

  return out
}

/** Code so far ends where an expression starts, so a `/` there opens a regex literal, not a division. */
const REGEX_MAY_START = /(?:^|[(,=:[!&|?{};+\-*%<>~^]|\b(?:return|typeof|case|do|else|in|of|void|yield|await))\s*$/

/**
 * The index of the `/` closing a regex literal that opens at `start`, or -1 when the line has none (then it was a
 * division). Its text is kept as code, so misreading a regex can only keep comment text, never blank code.
 */
function regexEnd(line: string, start: number): number {
  let inClass = false
  // Bounded, so a line of `(/` cannot make the stripper quadratic; a longer regex is read as code, which is safe.
  for (let i = start + 1; i < Math.min(line.length, start + 200); i++) {
    const ch = line[i]
    if (ch === '\\') { i++; continue }
    if (ch === '[') inClass = true
    else if (ch === ']') inClass = false
    else if (ch === '/' && !inClass) return i
  }
  return -1
}

/**
 * Generated report assets, named by what the report writes, inside a folder its marker file identifies. Only those
 * entries are skipped: other files in a folder that merely shares the name are still scanned.
 */
const REPORT_ASSETS = new Map<string, { markers: readonly string[]; assets: ReadonlySet<string> }>([
  ['coverage', { markers: ['coverage-final.json', 'lcov.info', 'clover.xml'], assets: new Set(['prettify.js', 'sorter.js', 'block-navigation.js', 'lcov-report']) }],
  ['playwright-report', { markers: ['index.html'], assets: new Set(['trace', 'data']) }],
])

/** True for an istanbul or Playwright asset, given its parent folder's name and what the parent folder holds. */
export function isGeneratedReportAsset(parentName: string, entryName: string, parentHas: (name: string) => boolean): boolean {
  // A Map, so a folder named `constructor` or `__proto__` is not looked up on Object.prototype.
  const report = REPORT_ASSETS.get(parentName)
  return report !== undefined && report.assets.has(entryName) && report.markers.some(parentHas)
}
