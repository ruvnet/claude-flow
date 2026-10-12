/** Animated vector replay of theme-demo.mts cell frames: native SVG discrete animation, no scripts, images, video or external assets. Node only. */
import { readFileSync, writeFileSync } from 'node:fs'
import { createHash } from 'node:crypto'
import { resolve } from 'node:path'

const root = resolve(process.argv[2] ?? '/tmp/ruflo-console-demo')
const frames = JSON.parse(readFileSync(resolve(root, 'frames.json'), 'utf8'))
const width = 1208
let height = 120 + Math.max(...frames.map(f => f.rows.length)) * 19
height += height % 2
const fps = 12, duration = frames.length / fps
const esc = s => s.replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c])
const FONT = 'font-family="DejaVu Sans Mono, Menlo, Consolas, monospace"'
// Explicit vector icons avoid platform emoji fonts and missing-glyph boxes.
const ICONS = {
  "⛭": "M5 5V3M5 17v-2M1 9h2m4 0h2M2 5l1.5 1.5M7 12.5L8.5 14M2 14l1.5-1.5M7 6.5L8.5 5 M5 6a3 3 0 1 0 0 6a3 3 0 1 0 0-6",
  "⟳": "M8 8A3.5 4 0 1 0 8 12M8 4v4H4",
  "📟": "M1 5h8v10H1zM2.5 7h5v4h-5zM3 13h1m2 0h1",
  "🔎": "M4 5a3 3 0 1 0 0 6a3 3 0 1 0 0-6M6 11l3 4",
  "💻": "M2 5h6v8H2zM1 15h8l-1-2H2z",
  "🤖": "M1 7h8v8H1zM5 7V4M4 4h2M3 10v1m4-1v1M3 13h4",
  "🔧": "M7 4L5 6l1 2 2-1 1-2c1 4-1 5-3 5L2 15l-1-1 4-5C2 7 3 4 7 4z",
  "🧩": "M1 6h3V4h2v2h3v3H7v2h2v4H6v-2H4v2H1v-4h2V9H1z",
  "📐": "M1 4v12h8zM3 10v4h3z",
  "🆕": "M1 5h8v10H1zM3 12V8l4 4V8",
  "⚙": "M5 5V3M5 17v-2M1 9h2m4 0h2M2 5l1.5 1.5M7 12.5L8.5 14M2 14l1.5-1.5M7 6.5L8.5 5 M5 6a3 3 0 1 0 0 6a3 3 0 1 0 0-6"
}
const rows = new Map()
const rowId = cells => {
  const key = JSON.stringify(cells.map(c => [c.ch, c.fg, c.bg ?? null]))
  if (rows.has(key)) return rows.get(key).id
  const id = `r${rows.size}`, out = []
  for (let start = 0, end; start < cells.length; start = end) {
    const color = cells[start].bg
    for (end = start + 1; end < cells.length && cells[end].bg === color; end++);
    if (color) out.push(`<rect fill="${color}" x="${start * 10}" y="0" width="${(end - start) * 10}" height="19"/>`)
  }
  // Block glyphs are drawn as rectangles so they stay crisp; other characters share one text run per foreground colour.
  let run = null
  const flush = () => { if (run) out.push(`<text ${FONT} font-size="16" fill="${run.fg}" x="${run.positions.join(' ')}" y="15" xml:space="preserve">${esc(run.text)}</text>`); run = null }
  cells.forEach((c, x) => {
    if (c.ch === '█' || c.ch === '▀' || c.ch === '▄') {
      flush()
      const y = c.ch === '▄' ? 9 : 0, h = c.ch === '▀' ? 9 : c.ch === '▄' ? 10 : 19
      out.push(`<rect fill="${c.fg}" x="${x * 10}" y="${y}" width="10" height="${h}"/>`)
    } else if (Object.hasOwn(ICONS, c.ch)) {
      flush()
      out.push(`<path transform="translate(${x * 10},0)" d="${ICONS[c.ch]}" fill="none" stroke="${c.fg}" stroke-width="1" stroke-linecap="round" stroke-linejoin="round"/>`)
    } else if (c.ch === ' ' || c.ch === '\ufe0f' || c.ch === '\ufe0e') flush()
    else if (run && run.fg === c.fg && run.next === x) { run.text += c.ch; run.positions.push(x * 10); run.next = x + 1 }
    else { flush(); run = { fg: c.fg, positions: [x * 10], text: c.ch, next: x + 1 } }
  })
  flush()
  rows.set(key, { id, svg: `<g id="${id}">${out.join('')}</g>` })
  return id
}
const label = (s, x, y, fg, size = 16) => `<text ${FONT} font-size="${size}" fill="${fg}" x="${x}" y="${y + size - 1}" xml:space="preserve">${esc(s)}</text>`
const parts = frames.map((f, n) => {
  const start = n / frames.length, end = (n + 1) / frames.length
  const [times, values] = n === 0 ? [`0;${end.toFixed(12)};1`, 'inline;none;none']
    : n === frames.length - 1 ? [`0;${start.toFixed(12)};1`, 'none;inline;inline']
    : [`0;${start.toFixed(12)};${end.toFixed(12)};1`, 'none;inline;none;none']
  const left = 24 + (116 - f.columns) * 5
  return `<g id="frame${n}" display="${n === 0 ? 'inline' : 'none'}"><animate attributeName="display" calcMode="discrete" values="${values}" keyTimes="${times}" dur="${duration}s" repeatCount="indefinite"/>`
    + `<rect fill="${f.bg}" width="${width}" height="${height}"/>`
    + label('RUFLO / COMPLETE THEME WORKFLOW', 24, 16, f.accent) + label(f.caption, 24, 45, '#a8b2bd', 12)
    + `<path stroke="${f.accent}" d="M24 68H${width - 24}"/>`
    + f.rows.map((row, y) => `<use href="#${rowId(row)}" x="${left}" y="${78 + y * 19}"/>`).join('')
    + `<path stroke="${f.accent}" stroke-width="2" d="M24 ${height - 35}H${(24 + (width - 48) * (n + 1) / frames.length).toFixed(4)}"/>`
    + label('RENDERER DEMO / real UI actions + disk persistence / native host and AI generation unverified', 24, height - 23, '#a8b2bd', 12) + '</g>'
})
const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}" role="img" aria-labelledby="title desc"><title id="title">Ruflo console theme workflow</title><desc id="desc">${Math.round(duration)} second replay of actual renderer frames. Boot, six presets, customization, persistence, JSON import and resize. Native host and AI provider execution are unverified.</desc><defs>${[...rows.values()].map(r => r.svg).join('')}</defs>${parts.join('')}</svg>`
const file = resolve(root, 'ruflo-console-demo.svg')
writeFileSync(file, svg)
console.log(JSON.stringify({ file, bytes: Buffer.byteLength(svg), frames: frames.length, seconds: duration, rowSymbols: rows.size, sha256: createHash('sha256').update(svg).digest('hex') }))

