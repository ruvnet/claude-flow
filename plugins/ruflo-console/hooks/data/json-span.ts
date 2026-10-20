/** The index of the bracket that closes the one at `start`, skipping strings; -1 when it never closes. A trailing log line with a stray `}` or `]` is not part of the JSON. */
export function closeOf(text: string, start: number): number {
  let depth = 0
  let inString = false

  for (let i = start; i < text.length; i++) {
    const ch = text[i]

    if (inString) {
      if (ch === '\\') i++
      else if (ch === '"') inString = false
    } else if (ch === '"') {
      inString = true
    } else if (ch === '{' || ch === '[') {
      depth++
    } else if ((ch === '}' || ch === ']') && --depth === 0) {
      return i
    }
  }

  return -1
}
