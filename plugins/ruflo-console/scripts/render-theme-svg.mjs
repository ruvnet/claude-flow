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
  const flush = () => { if (run) out.push(`<text ${FONT} font-size="16" fill="${run.fg}" x="${run.x}" y="15" xml:space="preserve">${esc(run.text)}</text>`); run = null }
  cells.forEach((c, x) => {
    if (c.ch === '█' || c.ch === '▀' || c.ch === '▄') {
      flush()
      const y = c.ch === '▄' ? 9 : 0, h = c.ch === '▀' ? 9 : c.ch === '▄' ? 10 : 19
      out.push(`<rect fill="${c.fg}" x="${x * 10}" y="${y}" width="10" height="${h}"/>`)
    } else if (c.ch === ' ') flush()
    else if (run && run.fg === c.fg && run.next === x) { run.text += c.ch; run.next = x + 1 }
    else { flush(); run = { fg: c.fg, x: x * 10, text: c.ch, next: x + 1 } }
  })
  flush()
  rows.set(key, { id, svg: `<g id="${id}">${out.join('')}</g>` })
  return id
}
const label = (s, x, y, fg, size = 16) => `<text ${FONT} font-size="${size}" fill="${fg}" x="${x}" y="${y + size - 1}" xml:space="preserve">${esc(s)}</text>`
const parts = frames.map((f, n) => {
  const start = n / frames.length, end = (n + 1) / frames.length
  const [times, values] = n === 0 ? [`0;${end.toFixed(12)};1`, 'visible;hidden;hidden']
    : n === frames.length - 1 ? [`0;${start.toFixed(12)};1`, 'hidden;visible;visible']
    : [`0;${start.toFixed(12)};${end.toFixed(12)};1`, 'hidden;visible;hidden;hidden']
  const left = 24 + (116 - f.columns) * 5
  return `<g id="frame${n}" visibility="${n === 0 ? 'visible' : 'hidden'}"><animate attributeName="visibility" calcMode="discrete" values="${values}" keyTimes="${times}" dur="${duration}s" repeatCount="indefinite"/>`
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
