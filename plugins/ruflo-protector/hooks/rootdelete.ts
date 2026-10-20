/** Copied from plugins/ruflo-mods/hooks/guard/dangerous-command.ts (ADR-452 root-delete scanner); keep in sync, never import across plugins. */
// Keep this literal-word scanner in sync with the classic helpers/fallback.
// It joins quote fragments and escapes, but never evaluates expansions or links.
export function hasRootDelete(command: string, depth = 0): boolean {
  let word = '', quote = '', started = false, redirect = false
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
  const finishWord = () => {
    if (!started) return false
    // Literal shell strings (e.g. sh -c 'rm -rf /') also carried the old guard.
    // Bound rescanning to four levels; beyond that retain its conservative check.
    if (word.includes('rm') && /[\s;&|()]/.test(word)) {
      if (depth < 4 ? hasRootDelete(word, depth + 1) : word.includes('rm -rf /')) return true
    }
    if (!inRm) inRm = word === 'rm' || word.endsWith('/rm')
    else if (!optionsEnded && word === '--') optionsEnded = true
    else if (!optionsEnded && word.startsWith('-')) {
      recursive = recursive || word === '--recursive' || /^-[a-z]*r[a-z]*$/.test(word)
      force = force || word === '--force' || /^-[a-z]*f[a-z]*$/.test(word)
    } else root = root || isRoot(word)
    word = ''; started = false
    return inRm && recursive && force && root
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
      if (char === quote) quote = ''
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
