import type { RenderElement } from 'claude-code'

import type { MemoryEntry, MemoryStats, Namespaces } from '../data/cli'
import { gauge, recency, sparkline } from '../memory-lines'
import { agentdbModRows } from './agentdb-mod'
import { ago, button, clip, col, count, kv, live, row, rule, sourceLine, text, THEME, type Ctx } from './common'
import { memmapRows } from './memmap'
import { areaPanel, memoryLabRows } from './memory-lab'

/** Entries in the browse list at once; ◂ ▸ page the rest. */
export const BROWSE = 8

/** AgentDB's counts, the share of listed entries that carry a vector, and the second store the counts leave out. */
function storeRows(ctx: Ctx, memory: MemoryStats | null, spaces: Namespaces | null): RenderElement[] {
  const { state, nowMs } = ctx
  const rows: RenderElement[] = [rule(ctx, 'AgentDB', memory?.backend ?? '')]

  if (memory === null) {
    rows.push(text(ctx, sourceLine(state.probes.get('memory'), nowMs, 'memory stats').text, { dimColor: true }))
  } else {
    rows.push(kv(ctx, 'entries', `${count(memory.total)} · ${count(memory.vectors)} with vectors`))
    rows.push(kv(ctx, 'storage', memory.storage ?? 'n/a'))
    rows.push(kv(ctx, 'span', `oldest ${ago(memory.oldestMs, nowMs)} · newest ${ago(memory.newestMs, nowMs)}`))

    // Two stores: the CLI reads .swarm/memory.db; the MCP tools write .swarm/agentdb-memory.db as well. Never summed.
    if ((memory.unread ?? 0) > 0) rows.push(text(ctx, ` ⚠ ${memory.unread} more rows in .swarm/agentdb-memory.db (the MCP path’s store) are not in these counts or the list; unified search reads them`, { color: THEME.warn }))
  }

  const entries = spaces?.entries ?? []

  if (entries.length > 0) {
    const width = Math.max(8, Math.min(30, ctx.columns - 50))
    const withVector = entries.filter(entry => entry.hasVector).length

    // The stats' own vector count is a placeholder in this CLI; the listed entries say which carry an embedding.
    rows.push(kv(ctx, 'embedded', `${gauge(withVector, entries.length, width)} ${withVector}/${entries.length} of the newest listed carry a vector`, withVector === entries.length ? THEME.ok : THEME.warn))
  }

  return rows
}

/** One bar per namespace over the listed sample; a click narrows the browse list (and search, list, export) to it. */
function namespaceRows(ctx: Ctx, spaces: Namespaces | null): RenderElement[] {
  const { state, nowMs } = ctx
  const filter = state.memoryLab.filter
  const rows: RenderElement[] = [rule(ctx, 'Namespaces', spaces === null ? '' : `newest ${spaces.sampled} entries${filter !== null ? ` · showing ${filter}` : ''}`)]

  if (spaces === null) {
    rows.push(text(ctx, sourceLine(state.probes.get('namespaces'), nowMs, 'memory list').text, { dimColor: true }))

    return rows
  }

  if (spaces.byName.length === 0) {
    rows.push(text(ctx, 'no entries: store one below (▸ store), or import your Claude memories (IMPORT CLAUDE)', { dimColor: true }))

    return rows
  }

  const top = spaces.byName[0]?.count ?? 1
  const width = Math.max(4, Math.min(30, ctx.columns - 30))

  spaces.byName.slice(0, 8).forEach((space, i) => {
    const isPicked = filter === space.name

    rows.push(
      row(ctx, [
        ctx.kit.Button({ key: `mem-ns-${i}`, label: `${isPicked ? '▸' : ' '}${space.name.slice(0, 20).padEnd(21)}`, plain: true, ...(!isPicked && { dimColor: true }), onPress: () => ctx.act.memory.filter(space.name) }),
        ctx.kit.Text({ color: isPicked ? THEME.head : THEME.info, children: `${'█'.repeat(Math.max(1, Math.round((space.count / top) * width)))} ${space.count}` }),
      ], `mem-ns-row-${i}`),
    )
  })

  rows.push(text(ctx, `a sample: counts over the newest entries \`memory list\` returns, not the whole store · click a namespace to ${filter === null ? 'browse it' : 'show all again'}`, { dimColor: true }))

  return rows
}

/** When the listed entries were last written, oldest to now, as one row of bars. */
function timelineRows(ctx: Ctx, entries: readonly MemoryEntry[]): RenderElement[] {
  const { nowMs } = ctx
  const bins = Math.max(12, Math.min(48, ctx.columns - 30))
  const binned = recency(entries.flatMap(entry => (entry.atMs === undefined ? [] : [entry.atMs])), nowMs, bins)

  if (binned === null) return []

  return [
    rule(ctx, 'Recency', `${entries.length} entries by last write`),
    row(ctx, [
      ctx.kit.Text({ dimColor: true, children: ` ${ago(binned.fromMs, nowMs).padStart(8)} ` }),
      ctx.kit.Text({ color: THEME.ok, children: sparkline(binned.counts) }),
      ctx.kit.Text({ dimColor: true, children: ' now' }),
    ], 'mem-recency'),
  ]
}

/** The listed entries, newest first, in the picked namespace: each one opens (retrieve) or deletes (asks first). */
function browseRows(ctx: Ctx, entries: readonly MemoryEntry[]): RenderElement[] {
  const { state, nowMs } = ctx
  const lab = state.memoryLab
  const shown = lab.filter === null ? entries : entries.filter(entry => entry.namespace === lab.filter)
  const pages = Math.max(1, Math.ceil(shown.length / BROWSE))
  const page = Math.min(lab.page, pages - 1)
  const lead = Math.max(18, Math.min(34, ctx.columns - 60))
  const rows: RenderElement[] = [rule(ctx, 'Browse', shown.length === 0 ? '' : `${shown.length} listed · page ${page + 1}/${pages}`)]

  if (shown.length === 0) {
    rows.push(text(ctx, entries.length === 0 ? ' nothing listed yet' : ` nothing listed in ${lab.filter ?? ''}`, { dimColor: true }))

    return rows
  }

  shown.slice(page * BROWSE, page * BROWSE + BROWSE).forEach((entry, i) => {
    rows.push(
      row(ctx, [
        ctx.kit.Text({ bold: true, color: entry.hasVector ? THEME.head : THEME.info, children: clip(` ${entry.hasVector ? '◆' : '◇'} ${entry.key} `, lead).padEnd(lead, '.') }),
        ctx.kit.Text({ color: THEME.info, wrap: 'truncate-end', children: clip(` ${entry.namespace} · ${entry.size === undefined ? 'n/a' : `${entry.size} B`} · ${ago(entry.atMs, nowMs)}`, Math.max(4, ctx.columns - lead - 22)) }),
        ctx.kit.Button({ key: `mem-open-${i}`, label: ' ▸ view', plain: true, dimColor: true, onPress: () => ctx.act.memory.open(entry) }),
        ctx.kit.Button({ key: `mem-del-${i}`, label: ' ▸ delete', plain: true, dimColor: true, onPress: () => ctx.act.memory.remove(entry) }),
      ], `mem-entry-${i}`),
    )
  })

  rows.push(
    row(ctx, [
      text(ctx, ' ◆ has a vector · ▸ view reads it at once · ▸ delete asks · r re-lists ', { dimColor: true }),
      ...(page > 0 ? [button(ctx, 'mem-prev', '◂ newer', () => ctx.act.memory.page(-1))] : []),
      ...(page < pages - 1 ? [button(ctx, 'mem-next', 'older ▸', () => ctx.act.memory.page(1))] : []),
    ]),
  )

  return rows
}

/**
 * The Memory Lab: AgentDB's counts and how much of it is embedded, a bar per namespace, when entries were written,
 * the newest entries to open or delete, then search, the entry fields and every memory, AgentDB and embeddings verb
 * as a button. On open it runs only the view's two local probes (memory stats, memory list).
 */
export function memoryView(ctx: Ctx): RenderElement {
  const memory = live<MemoryStats>(ctx.state.probes.get('memory'))
  const spaces = live<Namespaces>(ctx.state.probes.get('namespaces'))
  const entries = spaces?.entries ?? []

  return col(ctx, [...storeRows(ctx, memory, spaces), ...agentdbModRows(ctx), ...namespaceRows(ctx, spaces), ...memmapRows(ctx), ...timelineRows(ctx, entries), ...browseRows(ctx, entries), ...areaPanel(ctx, 'browse'), ...memoryLabRows(ctx), text(ctx, 'spend, budget gauge and burn: Cost (9)', { dimColor: true })], 'memory')
}
