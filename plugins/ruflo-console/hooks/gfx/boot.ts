/**
 * The BBS boot screen, played for the first seconds after the pane opens: the RuFlo neon sign strikes up tube by tube on its
 * brick wall (gfx/neon.ts), then a handshake line and a bar that fills with
 * the first ruflo reads, and under them a boot log that brings every area of the console online, one line at a time,
 * for as many rows as the pane has (it scrolls when the pane is short). The sign is decoration and ends by
 * itself; the log is not, when the self-check's results are passed: an area shows [ OK ] only if its check passed, and
 * [FAIL] with the first problem if not, so what the screen claims is what was verified.
 */
import type { BootCheck } from '../boot-checks'
import type { BootFacts } from '../boot-facts'
import { drawCyber } from './boot-cyber'
import { neonPicture, NEON_ROWS } from './neon'
import { Grid } from './raster'

/** The sign sits one row down, inside a border of its own: a row above it and a row below. */
const SIGN_TOP = 1
export const BOOT_ROWS = SIGN_TOP + NEON_ROWS + 4
/** The border strikes up over this long once the sign switches on. */
const FRAME_MS = 900

const GREEN = 0x39ff14
const CYAN = 0x05d9e8
const PINK = 0xff2a6d
const DIM = 0x6b7280
/** The sign begins to strike almost at once: there is nothing to dial first. */
const SIGN_ON_MS = 400
/** The boot log starts once the handshake is typed, and brings one area online every LOG_MS_PER. */
const LOG_FROM_MS = 1500
const LOG_MS_PER = 120

/** Every area of the console, in menu order: what the boot log brings online. */
export const BOOT_MODULES: readonly { name: string; note: string }[] = [
  { name: 'Missions', note: 'goal → SPARC plan → tasks' },
  { name: 'Overview', note: 'subsystems, health, Optimizer' },
  { name: 'Swarm', note: 'topology, agents, tasks' },
  { name: 'Workflows', note: 'Claude Code runs and the swarm' },
  { name: 'Hive-Mind', note: 'queen, workers, votes, quorum' },
  { name: 'Claims', note: 'one owner per resource' },
  { name: 'Approvals', note: 'votes and asks in one place' },
  { name: 'Automation', note: 'workflows, workers, autopilot' },
  { name: 'Learning', note: 'SONA, MoE, EWC++ pulse' },
  { name: 'Neural', note: 'pretrain, patterns, routing' },
  { name: 'Vector Lab', note: 'HNSW, RaBitQ, RVF' },
  { name: 'Memory Lab', note: 'AgentDB, embeddings' },
  { name: 'MetaHarness', note: 'readiness, flywheel, lab' },
  { name: 'Self-Evolution', note: 'governed receipts, lineage' },
  { name: 'Security', note: 'scans, AIDefence, doctor' },
  { name: 'Federation', note: 'peers, trust, relay' },
  { name: 'x.ruv.io', note: 'swarm board, AgentBBS rooms' },
  { name: 'Plugins & Mods', note: 'every ruflo plugin mapped' },
  { name: 'Skills', note: 'find, add, manage' },
  { name: 'Plugin Catalog', note: 'every plugin, mod and skill' },
  { name: 'Dev Tools', note: 'ADRs, SPARC, tests, git, docs' },
  { name: 'Sandbox', note: 'tmux, RVF branches, RVM' },
  { name: 'Cost & Budget', note: 'spend, burn, limits' },
  { name: 'Timeline', note: 'who was busy, and when' },
  { name: 'Events', note: 'what changed, live' },
  { name: 'The Room', note: 'who says and does what, and what waits for a yes' },
  { name: 'Performance', note: 'metrics and bottlenecks' },
  { name: 'AI Terminal', note: 'ruflo, codex, claude' },
  { name: 'ADRs', note: 'decisions your project made' },
  { name: 'What’s new', note: 'changes in your plugins' },
  { name: 'Settings', note: 'every option a button' },
]
const NAME_WIDTH = 15

/** The blue behind the white leading cell, and how many cells of it, while the border strikes: white, then blue, then pink. */
const BLUE = 0x3a7bff
const FRAME_BLUE = 10

/**
 * A neon border round the whole animation area, the brick wall included: a double line along the edge of the picture, a row above the sign and
 * a row below it. Dim before the sign switches on; then a run of light goes round it clockwise from the top left, a white leading cell, a
 * stretch of blue behind it, then pink; when the run has gone all the way round the whole border is that one pink. Left out only when the pane
 * is too narrow to draw a box at all.
 */
export function drawFrame(grid: Grid, columns: number, age: number): void {
  const x0 = 0
  const x1 = columns - 1
  const y0 = 0
  const y1 = SIGN_TOP + NEON_ROWS

  if (columns < 8) return

  const cells: { x: number; y: number; ch: string }[] = []

  for (let x = x0; x <= x1; x++) cells.push({ x, y: y0, ch: x === x0 ? '╔' : x === x1 ? '╗' : '═' })
  for (let y = y0 + 1; y < y1; y++) cells.push({ x: x1, y, ch: '║' })
  for (let x = x1; x >= x0; x--) cells.push({ x, y: y1, ch: x === x0 ? '╚' : x === x1 ? '╝' : '═' })
  for (let y = y1 - 1; y > y0; y--) cells.push({ x: x0, y, ch: '║' })

  const progress = Math.max(0, Math.min(1, (age - SIGN_ON_MS) / FRAME_MS))
  const lit = Math.floor(progress * cells.length)

  cells.forEach((cell, i) => {
    const color = progress >= 1 ? PINK : i >= lit ? DIM : i === lit - 1 ? 0xffffff : lit - i <= FRAME_BLUE ? BLUE : PINK

    grid.set(cell.x, cell.y, cell.ch, color)
  })
}

/**
 * `age` is ms since the pane opened; the bar mixes elapsed time with the reads that have answered (`done` of
 * `total`), so it moves before any read returns and reads 100% before the boot ends at BOOT_MIN_MS. `rows` is the
 * pane's body height when it is known: the boot log fills what is left under the sign (0: the sign alone).
 */
export function bootPicture(project: string, columns: number, age: number, done: number, total: number, rows = 0, checks?: readonly BootCheck[], facts?: BootFacts): Grid {
  const height = Math.max(BOOT_ROWS, rows)
  const grid = new Grid(columns, height)
  const type = (y: number, from: number, text: string, color: number, msPerChar = 22) => {
    if (age < from) return

    grid.text(0, y, text.slice(0, Math.min(text.length, Math.floor((age - from) / msPerChar), columns)), color)
  }

  // The sign's wall shows from the start, unlit; the tubes strike from SIGN_ON_MS.
  const sign = neonPicture(columns, age - SIGN_ON_MS, true)

  grid.cells.set(sign.cells, SIGN_TOP * columns * 3)
  drawFrame(grid, columns, age)

  type(BOOT_ROWS - 2, 1300, `> handshake ok · node ${project}`, CYAN, 14)

  // The boot log: one area comes online every LOG_MS_PER, [ .. ] while it starts and [ OK ] once the next one has begun; the
  // newest lines stay in view when the pane is shorter than the list, and READY closes it.
  // With the self-check's results the log is a report: READY counts what was verified, and an area that failed says why. Without
  // them (nothing has run the check) it draws as it always did.
  const failedAreas = checks === undefined ? 0 : BOOT_MODULES.filter(entry => checks.find(result => result.area === entry.name)?.ok === false).length
  const readyNote = checks === undefined ? `${BOOT_MODULES.length} areas online · press a key or click` : `${BOOT_MODULES.length - failedAreas} of ${BOOT_MODULES.length} areas verified${failedAreas > 0 ? ` · ${failedAreas} failed` : ''} · press a key or click`
  const entries = [...BOOT_MODULES.map(entry => ({ ...entry, ready: false })), { name: 'READY', note: readyNote, ready: true }]
  const room = height - BOOT_ROWS - 1
  const started = age < LOG_FROM_MS ? 0 : Math.min(entries.length, Math.floor((age - LOG_FROM_MS) / LOG_MS_PER) + 1)
  const logProgress = started / entries.length

  // With the machine's facts and room for it, the log is the cyberpunk uplink (boot-cyber.ts); otherwise the plain list below.
  const isCyber = facts !== undefined && age >= LOG_FROM_MS - 200 && drawCyber(grid, facts, BOOT_MODULES, checks, age, BOOT_ROWS + 1, room)

  if (!isCyber && room > 0 && started > 0) {
    const first = Math.max(0, started - room)

    for (let i = first; i < started; i++) {
      const entry = entries[i] as (typeof entries)[number]
      const y = BOOT_ROWS + 1 + (i - first)
      const isOn = i < started - 1 || started === entries.length

      if (entry.ready) {
        grid.text(0, y, failedAreas > 0 ? `[FAIL] ${entry.name}` : `[ OK ] ${entry.name}`, failedAreas > 0 ? PINK : GREEN)
        grid.text(7 + 'READY '.length, y, entry.note.slice(0, Math.max(0, columns - 13)), PINK)
      } else {
        // An area that is on has its verdict: [ OK ] only if its check passed; [FAIL] and the first problem, if it did not.
        const problem = isOn ? checks?.find(result => result.area === entry.name && !result.ok)?.problems[0] : undefined

        grid.text(0, y, problem !== undefined ? '[FAIL]' : isOn ? '[ OK ]' : '[ .. ]', problem !== undefined ? PINK : isOn ? GREEN : CYAN)
        grid.text(7, y, entry.name.padEnd(NAME_WIDTH).slice(0, NAME_WIDTH), 0xe6e6e6)
        grid.text(7 + NAME_WIDTH + 1, y, (problem ?? entry.note).slice(0, Math.max(0, columns - 7 - NAME_WIDTH - 1)), problem !== undefined ? PINK : DIM)
      }
    }
  }

  // LOADING [▓▓▓▓░░░░] 58%  reads 6/10, with a blinking cursor while it runs.
  if (age >= 1300) {
    const pct = Math.min(1, 0.4 * Math.min(1, (age - 1300) / 3300) + 0.3 * logProgress + 0.3 * (total > 0 ? done / total : 1))
    const barWidth = Math.max(6, Math.min(24, columns - 30))
    const filled = Math.round(pct * barWidth)
    const line = `LOADING [${'▓'.repeat(filled)}${'░'.repeat(barWidth - filled)}] ${String(Math.round(pct * 100)).padStart(3)}%  reads ${done}/${total}`

    grid.text(0, BOOT_ROWS - 1, line.slice(0, columns), pct >= 1 ? GREEN : CYAN)
    if (Math.floor(age / 400) % 2 === 0 && line.length + 1 < columns) grid.set(line.length + 1, BOOT_ROWS - 1, '█', CYAN)
  }

  return grid
}
