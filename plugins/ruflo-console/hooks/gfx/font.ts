/** A two-row half-block font, the RUFLO logo's style, for the BBS section titles. */
export const FONT: Record<string, readonly [string, string]> = {
  A: ['▄▀▄', '█▀█'], B: ['█▄▄', '█▄█'], C: ['█▀▀', '█▄▄'], D: ['█▀▄', '█▄▀'], E: ['█▀▀', '██▄'],
  F: ['█▀▀', '█▀ '], G: ['█▀▀', '█▄█'], H: ['█ █', '█▀█'], I: ['▀█▀', '▄█▄'], J: ['  █', '█▄█'],
  K: ['█ █', '█▀▄'], L: ['█  ', '█▄▄'], M: ['█▀▄▀█', '█   █'], N: ['█▄ █', '█ ▀█'], O: ['█▀█', '█▄█'],
  P: ['█▀█', '█▀▀'], Q: ['█▀█', '▀▀█'], R: ['█▀█', '█▀▄'], S: ['█▀▀', '▄▄█'], T: ['▀█▀', ' █ '],
  U: ['█ █', '█▄█'], V: ['█ █', '▀▄▀'], W: ['█   █', '▀▄▀▄▀'], X: ['▀▄▀', '▄▀▄'], Y: ['▀▄▀', ' █ '],
  Z: ['▀▀█', '█▄▄'], '|': ['░▒▓▒░', '░▒▓▒░'], '.': [' ', '▄'], '-': ['▄▄', '  '], ' ': ['  ', '  '],
}

export function bigText(text: string): [string, string] {
  const rows: [string[], string[]] = [[], []]

  for (const ch of text.toUpperCase()) {
    const glyph = FONT[ch] ?? FONT[' ']!

    rows[0].push(glyph[0])
    rows[1].push(glyph[1])
  }

  return [rows[0].join(' '), rows[1].join(' ')]
}

/** Text spaced out letter by letter, the way BBS splash screens captioned their art: `S W A R M`. */
export function spaced(text: string): string {
  return [...text.toUpperCase()].join(' ')
}
