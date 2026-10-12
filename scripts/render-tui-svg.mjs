#!/usr/bin/env node
/**
 * Renders captured terminal frames (`tmux capture-pane -p -e`, ANSI text) as ONE animated, self-contained SVG: CSS keyframes
 * only, no scripts, images, fonts or external references, and `prefers-reduced-motion` shows the first frame. Node only.
 *
 *   node scripts/render-tui-svg.mjs spec.json
 *
 * spec.json: { "out": "docs/assets/x.svg", "title": "...", "desc": "...", "seconds": 2.5, "chrome": "npx ruflo tui",
 *              "frames": [{ "ansi": "frame.ans", "caption": "plain-language caption" }] }
 * Frames may differ in size; the canvas fits the largest and each frame is centred.
 */
import { readFileSync, writeFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'

const CW = 10, CH = 19, FONT = 'DejaVu Sans Mono, Menlo, Consolas, monospace'
const BG = '#0d1117', FG = '#c9d1d9'
const esc = s => s.replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c])

/** xterm 256-colour palette. */
function xterm(n) {
  const base = ['#000000', '#cd3131', '#0dbc79', '#e5e510', '#2472c8', '#bc3fbc', '#11a8cd', '#e5e5e5',
    '#666666', '#f14c4c', '#23d18b', '#f5f543', '#3b8eea', '#d670d6', '#29b8db', '#ffffff']
  if (n < 16) return base[n]
  if (n >= 232) { const v = 8 + (n - 232) * 10; return `rgb(${v},${v},${v})` }
  const i = n - 16, lv = k => (k === 0 ? 0 : 55 + k * 40)
  return `rgb(${lv(Math.floor(i / 36))},${lv(Math.floor(i / 6) % 6)},${lv(i % 6)})`
}

/** Terminal cell width: emoji and CJK take two cells, variation selectors none. */
function width(cp) {
  if (cp === 0xfe0f || cp === 0xfe0e || cp === 0x200d) return 0
  if ((cp >= 0x1f300 && cp <= 0x1faff) || (cp >= 0x2e80 && cp <= 0xa4cf) || (cp >= 0xff00 && cp <= 0xff60)) return 2
  return 1
}

/** One ANSI line to cells [{ ch, w, fg, bg, bold }] on a fixed-width grid. */
function parseLine(line, cols) {
  const cells = []
  let fg = null, bg = null, bold = false, dim = false, rev = false
  const re = /\x1b\[([0-9;:]*)m|\x1b\[[0-9;?]*[A-Za-z]|([\s\S])/gu
  let m
  while ((m = re.exec(line))) {
    if (m[2] === undefined) {
      if (m[1] === undefined) continue
      const p = m[1] === '' ? [0] : m[1].split(/[;:]/).map(Number)
      for (let i = 0; i < p.length; i++) {
        const c = p[i]
        if (c === 0) { fg = bg = null; bold = dim = rev = false }
        else if (c === 1) bold = true
        else if (c === 2) dim = true
        else if (c === 22) bold = dim = false
        else if (c === 7) rev = true
        else if (c === 27) rev = false
        else if (c >= 30 && c <= 37) fg = xterm(c - 30)
        else if (c >= 90 && c <= 97) fg = xterm(c - 90 + 8)
        else if (c >= 40 && c <= 47) bg = xterm(c - 40)
        else if (c >= 100 && c <= 107) bg = xterm(c - 100 + 8)
        else if (c === 39) fg = null
        else if (c === 49) bg = null
        else if ((c === 38 || c === 48) && p[i + 1] === 5) { const v = xterm(p[i + 2]); if (c === 38) fg = v; else bg = v; i += 2 }
        else if ((c === 38 || c === 48) && p[i + 1] === 2) { const v = `rgb(${p[i + 2]},${p[i + 3]},${p[i + 4]})`; if (c === 38) fg = v; else bg = v; i += 4 }
      }
      continue
    }
    const ch = m[2]
    if (ch === '\n' || ch === '\r') continue
    const w = width(ch.codePointAt(0))
    if (w === 0) continue
    let f = fg ?? FG, b = bg
    if (rev) { const t = f; f = b ?? BG; b = t }
    if (dim) f = `color-mix(in srgb, ${f} 60%, ${BG})`
    cells.push({ ch, w, fg: f, bg: b, bold })
  }
  let x = 0
  for (const c of cells) { c.x = x; x += c.w }
  while (x < cols) { cells.push({ ch: ' ', w: 1, fg: FG, bg: null, bold: false, x }); x++ }
  return cells
}

const LINES = { '─': 'M0 9.5H10', '│': 'M5 0V19', '╭': 'M5 19V12Q5 9.5 8 9.5H10', '╮': 'M5 19V12Q5 9.5 2 9.5H0', '╰': 'M5 0V7Q5 9.5 8 9.5H10', '╯': 'M5 0V7Q5 9.5 2 9.5H0' }
const rows = new Map()

/** Deduplicated row definition shared by every frame (borders and headers repeat a lot). */
function rowId(cells) {
  const key = JSON.stringify(cells.map(c => [c.ch, c.fg, c.bg, c.bold]))
  if (rows.has(key)) return rows.get(key)
  const id = `r${rows.size}`, out = []
  for (let s = 0, e; s < cells.length; s = e) {
    const color = cells[s].bg
    for (e = s + 1; e < cells.length && cells[e].bg === color; e++);
    if (color) out.push(`<rect fill="${color}" x="${cells[s].x * CW}" y="0" width="${(cells[e - 1].x + cells[e - 1].w - cells[s].x) * CW}" height="${CH}"/>`)
  }
  let run = null, hl = null
  // Monospace runs use textLength so every font lands on the 10px grid without a per-glyph x list (keeps the file small).
  const flush = () => {
    if (run) out.push(`<text fill="${run.fg}"${run.bold ? ' font-weight="700"' : ''} x="${run.x0}" y="14.5" textLength="${run.n * CW}" lengthAdjust="spacing" xml:space="preserve">${esc(run.t)}</text>`)
    run = null
  }
  const flushHl = () => { if (hl) out.push(`<path d="M${hl.x0} 9.5h${hl.n * CW}" stroke="${hl.fg}" stroke-width="1.2" fill="none"/>`); hl = null }
  for (const c of cells) {
    const x = c.x * CW
    if (c.ch !== '─') flushHl()
    if (c.ch === '█' || c.ch === '▀' || c.ch === '▄') {
      flush()
      out.push(`<rect fill="${c.fg}" x="${x}" y="${c.ch === '▄' ? 9.5 : 0}" width="${CW}" height="${c.ch === '█' ? CH : 9.5}"/>`)
    } else if (c.ch === '─') {
      flush()
      if (hl && hl.fg === c.fg && hl.x0 + hl.n * CW === x) hl.n++
      else { flushHl(); hl = { fg: c.fg, x0: x, n: 1 } }
    } else if (LINES[c.ch]) {
      flush()
      out.push(`<path transform="translate(${x},0)" d="${LINES[c.ch]}" fill="none" stroke="${c.fg}" stroke-width="1.2"/>`)
    } else if (c.w === 2) {
      flush()
      out.push(`<text x="${x + 1}" y="14.5" font-size="15" font-family="Noto Color Emoji, Apple Color Emoji, Segoe UI Emoji, ${FONT}">${esc(c.ch)}</text>`)
    } else if (c.ch === ' ') flush()
    else if (run && run.fg === c.fg && run.bold === c.bold && run.x0 + run.n * CW === x) { run.t += c.ch; run.n++ }
    else { flush(); run = { fg: c.fg, bold: c.bold, t: c.ch, x0: x, n: 1 } }
  }
  flush()
  flushHl()
  rows.set(key, id)
  rows.set(`def:${id}`, `<g id="${id}">${out.join('')}</g>`)
  return id
}

const specPath = resolve(process.argv[2] ?? '')
const spec = JSON.parse(readFileSync(specPath, 'utf8'))
const base = dirname(specPath)
const frames = spec.frames.map(f => {
  const lines = readFileSync(resolve(base, f.ansi), 'utf8').replace(/\s+$/, '').split('\n')
  const cols = Math.max(...lines.map(l => parseLine(l, 0).reduce((a, c) => a + c.w, 0)), 1)
  return { caption: f.caption, grid: lines.map(l => parseLine(l, cols)), cols }
})
const cols = Math.max(...frames.map(f => f.cols)), nrows = Math.max(...frames.map(f => f.grid.length))
const PAD = 12, BAR = 30, CAP = 54
const W = cols * CW + PAD * 2, H = BAR + nrows * CH + PAD + CAP
const secs = spec.seconds ?? 2.5, total = +(secs * frames.length).toFixed(3)
const groups = frames.map((f, n) => {
  const dx = PAD + Math.floor(((cols - f.cols) * CW) / 2)
  const uses = f.grid.map((cells, y) => `<use href="#${rowId(cells)}" x="${dx}" y="${BAR + y * CH}"/>`).join('')
  const cap = `<text class="cap" x="${PAD}" y="${BAR + nrows * CH + PAD + 24}">${esc(f.caption)}</text><text class="num" x="${W - PAD}" y="${BAR + nrows * CH + PAD + 24}" text-anchor="end">${n + 1} / ${frames.length}</text>`
  return `<g class="p p${n}">${uses}${cap}</g>`
})
const css = `.t{font-family:${FONT};font-size:16px}.cap{font:600 18px system-ui,Segoe UI,Helvetica,Arial,sans-serif;fill:#e6edf3}.num{font:14px ${FONT};fill:#8b949e}` +
  `.p{opacity:0;animation:show ${total}s infinite}${frames.map((_, n) => `.p${n}{animation-delay:${+(n * secs).toFixed(3)}s}`).join('')}` +
  `@keyframes show{0%,${(100 / frames.length - 0.01).toFixed(3)}%{opacity:1}${(100 / frames.length).toFixed(3)}%,100%{opacity:0}}` +
  `@media (prefers-reduced-motion:reduce){.p{animation:none}.p0{opacity:1}}`
const defs = [...rows.entries()].filter(([k]) => k.startsWith('def:')).map(([, v]) => v).join('')
const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}" role="img" aria-labelledby="t d">` +
  `<title id="t">${esc(spec.title)}</title><desc id="d">${esc(spec.desc)}</desc><style>${css}</style><defs>${defs}</defs>` +
  `<rect width="${W}" height="${H}" rx="10" fill="${BG}"/><rect width="${W}" height="${BAR}" rx="10" fill="#161b22"/><rect y="20" width="${W}" height="10" fill="#161b22"/>` +
  `<circle cx="20" cy="15" r="5" fill="#ff5f56"/><circle cx="38" cy="15" r="5" fill="#ffbd2e"/><circle cx="56" cy="15" r="5" fill="#27c93f"/>` +
  `<text x="${W / 2}" y="20" text-anchor="middle" class="t" font-size="13" fill="#8b949e">${esc(spec.chrome ?? '')}</text>` +
  `<g class="t" fill="${FG}">${groups.join('')}</g></svg>\n`
writeFileSync(resolve(base, spec.out), svg)
console.log(`${spec.out}: ${(svg.length / 1024).toFixed(1)} KB, ${frames.length} frames, ${rows.size / 2} unique rows, ${W}x${H}`)
