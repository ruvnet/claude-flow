import { BOOT_MIN_MS } from '../state'
import { ENTRY, entryAge, groupStart, itemStart } from '../menu-entry'
import { scramble } from '../gfx/boot-cyber'
import type { RenderElement } from 'claude-code'

import { ACCENT, badgesOf, chip, LOUD, MUTED, PALETTE } from '../menu-style'
import { VIEWS, type ViewId } from '../state'
import { barParts } from './bar'
import { button, clip, col, isBbs, picture, row, text, THEME, type Ctx } from './common'
import { missionStrip } from './mission-control'

type Item = { label: string; go: string }

/** The keys of the entries that are not views. */
const COMMAND_KEYS: Record<string, string> = { palette: 'p', help: 'h', close: 'O' }
const keyOf = (item: Item): string => COMMAND_KEYS[item.go] ?? VIEWS.find(view => view.id === item.go)?.key ?? '·'

/**
 * The board's menus: five groups, each split into a few sub-sections where the split says something (SWARM: start here, coordinate,
 * observe), the way the old BBS main menus grouped their commands. A group with one section draws no rule: its name would only repeat the group's. Keys are the pane's own hotkeys; an area without one (`·`) is reached by its name at the prompt. An
 * entry for a view this build does not have is left out.
 */
export const GROUPS: readonly { title: string; sections: readonly { name: string; items: readonly Item[] }[] }[] = [
  {
    title: 'SWARM',
    sections: [
      { name: 'start here', items: [{ label: 'Missions', go: 'missions' }, { label: 'Overview', go: 'overview' }] },
      { name: 'coordinate', items: [{ label: 'Hive-Mind', go: 'hive' }, { label: 'Claims Board', go: 'claims' }, { label: 'Approvals', go: 'approvals' }] },
      { name: 'observe', items: [{ label: 'Swarm Topology', go: 'swarm' }, { label: 'Workflows', go: 'workflows' }] },
    ],
  },
  {
    title: 'INTELLIGENCE',
    sections: [
      { name: 'learn', items: [{ label: 'Learning', go: 'learning' }, { label: 'Neural', go: 'neural' }, { label: 'MetaHarness', go: 'metaharness' }, { label: 'Self-Evolution', go: 'evolve' }] },
      { name: 'remember', items: [{ label: 'Memory Lab', go: 'memory' }, { label: 'Vector Lab', go: 'vector' }] },
    ],
  },
  {
    title: 'SAFETY & OPS',
    sections: [
      { name: 'protect', items: [{ label: 'Security & Doctor', go: 'secure' }, { label: 'Cost & Budget', go: 'cost' }] },
      { name: 'observe', items: [{ label: 'Performance', go: 'perf' }, { label: 'Agent Timeline', go: 'timeline' }, { label: 'Event Stream', go: 'events' }, { label: 'The Room', go: 'room' }] },
    ],
  },
  {
    title: 'NETWORK & EXTEND',
    sections: [
      { name: 'network', items: [{ label: 'Federation', go: 'federation' }, { label: 'x.ruv.io Board', go: 'xruv' }, { label: 'Sandbox', go: 'sandbox' }] },
      { name: 'extend', items: [{ label: 'Skills', go: 'skills' }, { label: 'Plugin Catalog', go: 'market' }] },
    ],
  },
  {
    title: 'TOOLS',
    sections: [{ name: 'tools', items: [{ label: 'AI Terminal', go: 'terminal' }, { label: 'Automation', go: 'automate' }, { label: 'Dev Tools', go: 'devtools' }, { label: 'Plugins & Mods', go: 'plugins' }, { label: 'ADRs', go: 'adrs' }, { label: 'What’s new', go: 'whatsnew' }, { label: 'Settings', go: 'settings' }, { label: 'Command Palette', go: 'palette' }, { label: 'Help', go: 'help' }, { label: 'Log Off', go: 'close' }] }],
  },
]

const COMMANDS = new Set(['palette', 'help', 'close'])

const mmss = (ms: number): string => {
  const s = Math.max(0, Math.floor(ms / 1000))

  return `${String(Math.floor(s / 60)).padStart(2, '0')}:${String(s % 60).padStart(2, '0')}`
}

/**
 * The main menu, the board's front door: where the cockpit lands when it opens in the BBS look. The name in block
 * art comes from the frame; under it the host line, four boxed groups whose entries go where their keys go, a status
 * bar in the old modem style with this project's live facts, and a prompt that takes a key or a name and Enter.
 */
export function menuView(ctx: Ctx): RenderElement {
  const { state, nowMs } = ctx
  // While the entry plays (menu-entry.ts) the cards light up in turn; null once it is over, or when there is none.
  const entry = entryAge({ look: state.options.look, boot: state.options.boot, ...state.pane }, nowMs, BOOT_MIN_MS)
  const project = state.cwd.split('/').filter(Boolean).at(-1) ?? 'ruflo'
  const go = (item: Item) => () => (item.go === 'palette' ? ctx.act.palette('all') : item.go === 'help' ? ctx.act.help() : item.go === 'close' ? ctx.act.close() : ctx.act.view(item.go as ViewId))
  const isShown = (item: Item) => COMMANDS.has(item.go) || VIEWS.some(view => view.id === item.go)
  // Two boxes a row where the pane is wide enough, else one; each box is a group with its own border.
  const perRow = ctx.columns >= 60 ? 2 : 1
  const width = Math.max(24, Math.floor((ctx.columns - 1) / perRow) - 1)
  const rows: RenderElement[] = []

  rows.push(text(ctx, ' '))
  rows.push(...missionStrip(ctx))

  // In the BBS look each group is set apart by an accent: its border, a solid title bar and its key chips. The plain look keeps the theme's
  // colours and has none of this. A badge says what is going on behind an entry (approvals waiting, a mission under way, findings, an update).
  const bbs = isBbs()
  const badges = badgesOf(state, nowMs)

  // Each group folds: its bar has a ▾ / ▸ that hides or shows its entries (like every other section). In a narrow pane (one column of four tall
  // boxes) only the first group starts open; the rest are one bar each until opened, and the row above the boxes opens or closes them all.
  const startsOpen = (gi: number): boolean => ctx.columns >= 60 || gi === 0
  const foldKey = (group: (typeof GROUPS)[number]): string => `menu/${group.title}`
  const isGroupOpen = (group: (typeof GROUPS)[number], gi: number): boolean => startsOpen(gi) !== state.sections.has(foldKey(group))
  const setAll = (open: boolean): void => GROUPS.forEach((group, gi) => isGroupOpen(group, gi) !== open && ctx.act.toggle(foldKey(group)))

  // Each group a bordered box: ▓▒░ TITLE ░▒▓ on top, then its sub-sections, each a dim ── name ── rule and its items.
  const box = (group: (typeof GROUPS)[number], gi: number) => {
    const started = entry === null || entry >= groupStart(gi)
    let seen = 0
    const accent = ACCENT[group.title] ?? '#d0d0d0'
    const title = clip(`▓▒░ ${group.title} ░▒▓`, width - 8)
    const isOpen = isGroupOpen(group, gi)
    const count = group.sections.reduce((n, section) => n + section.items.filter(isShown).length, 0)

    return ctx.kit.Box({
      flexDirection: 'column',
      width,
      borderStyle: 'single',
      borderColor: bbs && started ? accent : 'inactive',
      paddingX: 1,
      key: `menu-${group.title}`,
      children: [
        ctx.kit.Box({
          flexDirection: 'row',
          key: `menu-head-${group.title}`,
          children: [
            ctx.kit.Button({ key: `menu-fold-${group.title}`, label: isOpen ? '▾' : '▸', plain: true, onPress: () => ctx.act.toggle(foldKey(group)) }),
            bbs
              ? ctx.kit.Box({ key: `menu-bar-${group.title}`, children: [ctx.kit.Text({ ...chip(accent), wrap: 'truncate-end', children: (entry === null ? ` ${title}` : scramble(` ${title}`, entry, groupStart(gi), ENTRY.titleMs).padEnd(width - 7)).padEnd(width - 2).slice(0, width - 7) })] })
              : ctx.kit.Text({ bold: true, color: THEME.head, wrap: 'truncate-end', children: title }),
          ],
        }),
        ...(!isOpen
          ? [ctx.kit.Text({ color: THEME.info, dimColor: true, wrap: 'truncate-end', children: clip(` ${count} entr${count === 1 ? 'y' : 'ies'} · ▸ opens ${group.title.toLowerCase()}`, width - 4) })]
          : group.sections.flatMap(section => {
          const items = section.items.filter(isShown)

          if (entry !== null && !started) return items.length === 0 ? [] : [...(group.sections.length === 1 ? [] : [ctx.kit.Text({ children: ' ' })]), ...items.map(item => ctx.kit.Box({ key: `mi-${item.go}`, children: [ctx.kit.Text({ children: ' ' })] }))]

          return items.length === 0
            ? []
            : [
                ...(group.sections.length === 1 ? [] : [ctx.kit.Text({ color: THEME.info, dimColor: true, wrap: 'truncate-end', children: clip(`── ${section.name} ${'─'.repeat(Math.max(0, width - section.name.length - 8))}`, width - 4) })]),
                ...items.map(item => {
                  const badge = badges[item.go as ViewId]
                  const key = keyOf(item)
                  const since = entry === null ? Infinity : entry - itemStart(gi, seen++)

                  // Not yet: a blank row, so nothing below moves. Locking in: the key chip and the label scrambling into place, not yet a button.
                  if (since < 0) return ctx.kit.Box({ key: `mi-${item.go}`, children: [ctx.kit.Text({ children: ' ' })] })
                  if (since < ENTRY.settleMs) return ctx.kit.Box({ flexDirection: 'row', key: `mi-${item.go}`, children: [bbs ? ctx.kit.Text({ ...chip(accent), children: ` ${key} ` }) : ctx.kit.Text({ bold: true, color: THEME.ok, children: ` (${key})` }), ctx.kit.Text({ color: THEME.head, children: ` ${scramble(clip(item.label, width - 11), since, 0, ENTRY.settleMs)}` })] })

                  return ctx.kit.Box({
                    flexDirection: 'row',
                    key: `mi-${item.go}`,
                    children: [
                      // The key is a chip in the accent in the BBS look, so the keys read as the commands; plain, as it always was.
                      bbs ? ctx.kit.Text({ ...chip(accent), children: ` ${key} ` }) : ctx.kit.Text({ bold: true, color: THEME.ok, children: ` (${key})` }),
                      ctx.kit.Button({ key: `menu-go-${item.go}`, label: ` ${clip(item.label, width - 11 - (badge === undefined ? 0 : badge.text.length + 1))}`, plain: true, onPress: go(item) }),
                      ...(badge === undefined ? [] : [ctx.kit.Text({ bold: badge.tone === 'attention', color: bbs ? (badge.tone === 'attention' ? LOUD : MUTED) : badge.tone === 'attention' ? THEME.warn : THEME.info, children: ` ${badge.text}` })]),
                    ],
                  })
                }),
              ]
        })),
      ],
    })
  }

  // A strip of the accents across the top, as a BBS drew its palette, with a band of light sweeping along it (a picture, so it moves with
  // the frame loop and costs one element). A surface that cannot draw pictures gets the still strip.
  if (bbs) {
    rows.push(
      ctx.pictures.has('palette') && ctx.kit.Raster !== undefined
        ? picture(ctx, 'palette', '')
        : ctx.kit.Box({ flexDirection: 'row', key: 'menu-palette', children: PALETTE.map((color, i) => ctx.kit.Box({ key: `menu-palette-${i}`, children: [ctx.kit.Text({ color, children: '▀'.repeat(Math.max(1, Math.floor((ctx.columns - 2) / PALETTE.length))) })] })) }),
    )
  }

  // The labels shorten as the pane narrows, so the row never runs past the edge.
  const tight = ctx.columns < 34

  rows.push(row(ctx, [...(ctx.columns >= 46 ? [text(ctx, ' groups ', { dimColor: true })] : []), button(ctx, 'menu-expand-all', tight ? '▾ all' : '▾ expand all', () => setAll(true)), button(ctx, 'menu-collapse-all', tight ? '▸ none' : '▸ collapse all', () => setAll(false))], 'menu-fold-all'))

  for (let i = 0; i < GROUPS.length; i += perRow) {
    rows.push(ctx.kit.Box({ flexDirection: 'row', gap: 1, key: `menu-row-${i}`, children: GROUPS.slice(i, i + perRow).map((group, j) => box(group, i + j)) }))
  }

  // The status bar under the box: the line, then what is live in this project, then how long the board has been open.
  const online = mmss(nowMs - (state.pane.bootAtMs > 0 ? state.pane.bootAtMs : state.loadedAtMs))
  const facts = barParts(state, nowMs).slice(0, 3)
  const base = ` ${state.snapshot?.isRufloProject === true ? 'Registered' : 'Unregistered'}`
  const modem = ' │ ANSI-BBS │ 115200·N81 FDX'
  const right = ` Online ${online} `
  // The modem text goes first when the pane is narrow, then the label is cut: the bar never runs past the edge.
  const line = ctx.columns >= base.length + modem.length + right.length + 4 ? `${base}${modem}` : clip(base, Math.max(4, ctx.columns - right.length - 1))
  let room = Math.max(4, ctx.columns - right.length - line.length)

  rows.push(text(ctx, ' '))
  rows.push(
    ctx.kit.Box({
      flexDirection: 'row',
      backgroundColor: isBbs() ? '#870000' : undefined,
      key: 'menu-status',
      children: [
        ctx.kit.Text({ bold: true, color: '#ffd700', children: entry === null ? line : scramble(line, entry, ENTRY.statusFrom, 700).padEnd(line.length) }),
        // The live facts are links: a click goes to the view each is about.
        ...facts.flatMap((part, i) => {
          if (room <= 6 || (entry !== null && entry < ENTRY.factsFrom)) return []

          const label = clip(part.text, room - 3)

          room -= label.length + 3

          return [
            ctx.kit.Text({ bold: true, color: '#ffd700', children: ' │ ' }),
            part.go !== undefined
              ? ctx.kit.Button({ key: `status-${i}`, label, plain: true, onPress: () => ctx.act.view(part.go as ViewId) })
              : ctx.kit.Text({ bold: true, color: '#ffd700', children: label }),
          ]
        }),
        ctx.kit.Box({ flexGrow: 1, key: 'status-gap', children: [ctx.kit.Text({ children: ' ' })] }),
        ctx.kit.Text({ bold: true, color: '#ffd700', children: right }),
      ],
    }),
  )
  rows.push(text(ctx, ' '))
  // The prompt, in a box like the cards in the BBS look. (The `T - 01:00` line that sat above it said what the status bar's Online already does.)
  if (ctx.kit.Input !== undefined) {
    const prompt = ctx.kit.Input({
      key: 'menu-prompt',
      label: bbs ? `${clip(project, 20)} ❯` : `(1:1) (ruflo: ${clip(project, 24)})`,
      placeholder: 'a key or a name, then Enter · ? for help',
      submitLabel: 'go',
      onSubmit: value => ctx.act.menu(value),
    })

    rows.push(bbs ? ctx.kit.Box({ key: 'menu-prompt-box', borderStyle: 'round', borderColor: entry !== null && entry < ENTRY.promptFrom ? 'inactive' : (ACCENT.TOOLS as string), paddingX: 1, children: [prompt] }) : prompt)
  } else {
    rows.push(row(ctx, [text(ctx, `(1:1) (ruflo: ${clip(project, 24)}) : press a key from the menu`, { color: THEME.warn })]))
  }

  return col(ctx, rows, 'menu')
}
