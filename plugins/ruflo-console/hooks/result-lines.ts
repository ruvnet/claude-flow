/**
 * Tidies the lines of a result before any view draws them. The CLI prints its tables as ASCII (`+----+` rules and `| cell | cell |` rows);
 * by the time the console has cleaned the text for display the padding is gone and the columns no longer line up. This reads such a block
 * back as cells and draws it again with box characters and aligned columns. Everything else passes through, only with trailing space
 * removed and runs of blank lines collapsed to one. Pure, bounded, and it never invents text: a block it cannot read as a table stays as it was.
 */

/** A table rule: the CLI's `+----+----+`, or a markdown separator row `| --- | :---: |`. */
const RULE = /^\s*(?:\+[-=+]{2,}\+|\|?\s*:?-{3,}:?\s*(?:\|\s*:?-{3,}:?\s*)+\|?)\s*$/
const ROW = /^\s*\|.*\|\s*$/
/** The widest a column is drawn; a longer cell is cut with an ellipsis. */
const MAX_CELL = 48
/** The most table lines read as one block (a runaway block stays as plain lines). */
const MAX_BLOCK = 200

/**
 * Markdown inside a line, read as text: `**bold**`, `__bold__` and `code` lose their markers, `[text](url)` reads `text (url)`. Single `*` and `_` are
 * left alone (a product like 5 * 3, snake_case), and a marker with no partner is left as it is.
 */
export function plainMarkdown(line: string): string {
  return line
    .replace(/\*\*([^*\n]+?)\*\*/g, '$1')
    .replace(/__([^_\n]+?)__/g, '$1')
    .replace(/`([^`\n]+?)`/g, '$1')
    .replace(/\[([^\]\n]+)\]\((https?:\/\/[^)\s]+)\)/g, '$1 ($2)')
}

const cellsOf = (line: string): string[] => line.trim().slice(1, -1).split('|').map(cell => plainMarkdown(cell.trim()))
const cut = (cell: string): string => (cell.length > MAX_CELL ? `${cell.slice(0, MAX_CELL - 1)}…` : cell)

/** One table block (rules and rows, in order) as box-drawn lines, or null when it is not a rectangular table of at least two rows. */
function drawTable(block: readonly string[]): string[] | null {
  const rows = block.filter(line => ROW.test(line) && !RULE.test(line)).map(cellsOf)

  if (rows.length < 2) return null

  const columns = rows[0]?.length ?? 0

  if (columns < 2 || rows.some(row => row.length !== columns)) return null

  const widths = Array.from({ length: columns }, (_, column) => Math.max(1, ...rows.map(row => cut(row[column] ?? '').length)))
  const rule = (left: string, mid: string, right: string): string => `${left}${widths.map(width => '─'.repeat(width + 2)).join(mid)}${right}`
  const draw = (row: readonly string[]): string => `│${row.map((cell, column) => ` ${cut(cell).padEnd(widths[column] ?? 0)} `).join('│')}│`
  // The first row is the header when a rule sits right under it (the CLI's table shape).
  const first = block.findIndex(line => ROW.test(line) && !RULE.test(line))
  const hasHeader = first >= 0 && RULE.test(block[first + 1] ?? '')
  const [head, ...rest] = rows

  return [rule('┌', '┬', '┐'), ...(hasHeader && head !== undefined ? [draw(head), rule('├', '┼', '┤')] : head !== undefined ? [draw(head)] : []), ...rest.map(draw), rule('└', '┴', '┘')]
}

/** One non-table line: headings read `▸ Title`, bullets `•`, quotes `│`, and the inline markers are dropped. */
function textLine(raw: string): string {
  const heading = /^\s{0,3}#{1,6}\s+(.*?)\s*#*\s*$/.exec(raw)

  if (heading !== null) return `▸ ${plainMarkdown(heading[1] ?? '')}`

  const bullet = /^(\s*)[-*+]\s+(.*)$/.exec(raw)

  if (bullet !== null) return `${bullet[1] ?? ''}• ${plainMarkdown(bullet[2] ?? '')}`

  const quote = /^\s*>\s?(.*)$/.exec(raw)

  return quote !== null ? `│ ${plainMarkdown(quote[1] ?? '')}` : plainMarkdown(raw)
}

export function prettyLines(lines: readonly string[]): string[] {
  const out: string[] = []
  let block: string[] = []
  let blank = false
  let fenced = false

  const flush = (): void => {
    if (block.length === 0) return

    const drawn = block.length <= MAX_BLOCK ? drawTable(block) : null

    out.push(...(drawn ?? block.map(line => line.trimEnd())))
    block = []
  }

  for (const raw of lines) {
    // A fenced code block is shown as it is, minus the fence lines themselves.
    if (/^\s*(```|~~~)/.test(raw)) {
      flush()
      fenced = !fenced
      continue
    }

    if (fenced) {
      out.push(raw.trimEnd())
      continue
    }

    if (RULE.test(raw) || ROW.test(raw)) {
      blank = false
      block.push(raw)
      continue
    }

    flush()

    const line = raw.trimEnd()

    if (line.trim() === '') {
      if (!blank && out.length > 0) out.push('')
      blank = true
      continue
    }

    blank = false
    out.push(textLine(line))
  }

  flush()

  while (out.length > 0 && out[out.length - 1] === '') out.pop()

  return out
}
