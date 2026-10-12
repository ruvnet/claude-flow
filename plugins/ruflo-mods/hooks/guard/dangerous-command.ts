import type { Verdict } from './verdict'

/**
 * The commands hook-handler.cjs `pre-bash` refuses. The root-delete entry
 * matches a root operand, not the prefix of every absolute path. The parity
 * tests exercise the same commands against the mod and classic helpers.
 */
export const DANGEROUS_COMMANDS: readonly string[] = ['rm -rf /', 'format c:', 'del /s /q c:\\', ':(){:|:&};:']

// Keep this literal-word scanner in sync with the classic helpers/fallback.
// It joins quote fragments and escapes, but never evaluates expansions or links.
function hasRootDelete(command: string, depth = 0): boolean {
  let word = '', quote = '', started = false, redirect = false
  let ansiNul = false // a NUL inside $'...' ends that string, as in bash
  let inRm = false, optionsEnded = false, recursive = false, force = false, root = false
  const isRoot = (operand: string) => {
    if (!operand.startsWith('/')) return false
    const parts: string[] = []
    for (const part of operand.split('/')) {
      if (!part || part === '.') continue
      if (part === '..') parts.pop()
      else parts.push(part)
    }
    return parts.length === 0 || /[*?\[]/.test(parts[0])
  }
  // One backslash escape inside $'...', from the character after the backslash.
  // Returns the text it stands for and the index of its last character. An unknown escape keeps its backslash.
  // The command arrives lowercased, so an uppercase-U escape reads as a lowercase one: eight digits starting 0000 are one code point.
  const ansiEscape = (s: string, at: number): [string, number] => {
    const c = s[at]
    const simple: Record<string, string> = { a: '\x07', b: '\b', e: '\x1b', f: '\f', n: '\n', r: '\r', t: '\t', v: '\v', '\\': '\\', "'": "'", '"': '"', '?': '?' }
    if (simple[c] !== undefined) return [simple[c], at]
    const digits = (from: number, max: number, pattern: RegExp) => pattern.exec(s.slice(from, from + max))?.[0]
    const octal = digits(at, 3, /^[0-7]+/)
    if (octal) return [String.fromCharCode(parseInt(octal, 8) & 255), at + octal.length - 1]
    const hex = c === 'x' ? digits(at + 1, 2, /^[0-9a-f]+/) : undefined
    if (hex) return [String.fromCharCode(parseInt(hex, 16)), at + hex.length]
    const wide = c === 'u' ? (digits(at + 1, 8, /^0000[0-9a-f]{4}$/) ?? digits(at + 1, 4, /^[0-9a-f]+/)) : undefined
    if (wide) return [String.fromCodePoint(parseInt(wide, 16)), at + wide.length]
    if (c === 'c' && at + 1 < s.length) return [String.fromCharCode(s.charCodeAt(at + 1) & 31), at + 1]
    return ['\\' + c, at]
  }
  const finishWord = () => {
    if (!started) return false
    // Literal shell strings (e.g. sh -c 'rm -rf /') also carried the old guard.
    // Bound rescanning to four levels; beyond that retain its conservative check.
    if (/[\s;&|()\x60]/.test(word)) {
      if (depth < 4 ? hasRootDelete(word, depth + 1) : word.includes('rm -rf /')) return true
    }
    if (!inRm) inRm = word === 'rm' || word.endsWith('/rm')
    else if (!optionsEnded && word === '--') optionsEnded = true
    else if (!optionsEnded && word.startsWith('-')) {
      // GNU getopt accepts any unambiguous long-option prefix: --r, --recur, --forc.
      recursive = recursive || (word.length > 2 && '--recursive'.startsWith(word)) || /^-[a-z]*r[a-z]*$/.test(word)
      force = force || (word.length > 2 && '--force'.startsWith(word)) || /^-[a-z]*f[a-z]*$/.test(word)
    } else root = root || isRoot(word)
    word = ''; started = false
    return inRm && recursive && force && root
  }
  // A command substitution's body, from just after its opening backtick. Bash removes a
  // backslash only before $, a backtick or a backslash (and " inside double quotes) and
  // drops backslash-newline; any other backslash stays for the nested scan.
  const substitution = (from: number, inDouble: boolean): [number, boolean] => {
    let body = '', j = from
    for (; j < command.length && command[j] !== '\x60'; j++) {
      const next = command[j + 1]
      if (command[j] === '\\' && j + 1 < command.length) {
        if (next === '\n') { j++; continue }
        if (next === '$' || next === '\x60' || next === '\\' || (inDouble && next === '"')) { body += next; j++; continue }
      }
      body += command[j]
    }
    return [j, depth < 4 ? hasRootDelete(body, depth + 1) : body.includes('rm -rf /')]
  }
  const finishCommand = () => {
    const denied = inRm && recursive && force && root
    inRm = optionsEnded = recursive = force = root = false
    return denied
  }
  for (let i = 0; i < command.length; i++) {
    const char = command[i]
    const redirectionAmpersand = char === '&' && (redirect || command[i + 1] === '>')
    redirect = false
    if (quote) {
      if (quote === "$'") {
        if (char === "'") { quote = ''; ansiNul = false }
        else if (char === '\\' && i + 1 < command.length) {
          const [text, last] = ansiEscape(command, i + 1)
          i = last
          if (!ansiNul) { const nul = text.indexOf('\0'); if (nul < 0) word += text; else { word += text.slice(0, nul); ansiNul = true } }
        } else if (!ansiNul) word += char
        continue
      }
      if (char === quote) quote = ''
      else if (quote === '"' && char === '\x60' && command.indexOf('\x60', i + 1) > i) {
        const [end, denied] = substitution(i + 1, true)
        if (denied) return true
        // The substitution is gone from the word, as bash's empty output is (a quoted empty substitution glued to -rf leaves -rf).
        // A # right after it is still inside the word: a placeholder keeps a rescan (sh -c "...")
        // from reading it as the start of a comment.
        if (command[end + 1] === '#') word += '\u0001'
        i = end
      }
      else if (quote === '"' && char === '\\' && i + 1 < command.length &&
        (command[i + 1] === '"' || command[i + 1] === '\\' || command[i + 1] === '$' ||
          command.charCodeAt(i + 1) === 96 || command[i + 1] === '\n')) {
        const next = command[++i]
        if (next !== '\n') word += next
      } else word += char
      continue
    }
    if (char === '\\' && i + 1 < command.length) {
      const next = command[++i]
      if (next !== '\n') { word += next; started = true }
    } else if (char === '\x60' && command.indexOf('\x60', i + 1) > i) {
      // Command substitution: scan the body as its own command; the substitution
      // stays inside the enclosing word, so the rm being parsed keeps its state,
      // and the word has started (a # right after it is not a comment).
      const [end, denied] = substitution(i + 1, false)
      if (denied) return true
      i = end; started = true
    } else if (char === '$' && (command[i + 1] === "'" || command[i + 1] === '"')) {
      // ANSI-C ($'...': escapes decoded) and locale ($"...") quoting: the $ is not part of the word.
      quote = command[i + 1] === "'" ? "$'" : '"'; started = true; i++
    } else if (char === '"' || char === "'") {
      quote = char; started = true
    } else if (char === '#' && !started) {
      while (i < command.length && command[i] !== '\n') i++
      if (finishCommand()) return true
    } else if (char === ' ' || char === '\t' || char === '\r' || char === '\n' ||
      ';|&()<>'.includes(char)) {
      if (finishWord()) return true
      // Redirections separate words, but later operands still belong to rm.
      redirect = char === '<' || char === '>'
      if (!redirectionAmpersand && (char === '\n' || ';|&()'.includes(char)) && finishCommand()) return true
    } else {
      word += char; started = true
    }
  }
  return finishWord() || finishCommand()
}

/**
 * A deny for a Bash call whose command is on the list, else undefined.
 *
 * @param tool the tool name as the model calls it
 * @param input the tool's arguments, unvalidated
 */
export function dangerousCommandVerdict(tool: string, input: unknown): Verdict | undefined {
  if (tool !== 'Bash') return undefined
  const raw = input !== null && typeof input === 'object' ? (input as { command?: unknown }).command : undefined
  // Same belt-and-braces as #2017: a non-string command is checked as text,
  // never skipped.
  const command = String(raw ?? '').toLowerCase()
  const hit = DANGEROUS_COMMANDS.find(d => d === 'rm -rf /' ? hasRootDelete(command) : command.includes(d))
  return hit === undefined
    ? undefined
    : { decision: 'deny', reason: `ruflo: dangerous command blocked (${hit})` }
}
