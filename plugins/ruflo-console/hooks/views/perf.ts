import type { RenderElement } from 'claude-code'

import { isPerfResult, PERF, perfMemo, sparkline } from '../perf'
import { ago, col, row, rule, section, text, THEME, type Ctx } from './common'
import { COST_KEY, entryRow, naRow, resultRows } from './secure'

/** One latency series: its name, the line of blocks, and its newest, lowest and highest sample. */
function seriesRow(ctx: Ctx, key: string, name: string, values: readonly number[], empty: string): RenderElement {
  if (values.length === 0) return text(ctx, ` ${name.padEnd(12)} ${empty}`, { dimColor: true })

  const width = Math.max(8, Math.min(40, ctx.columns - 50))
  const shown = values.slice(-width)
  const fmt = (value: number) => `${value.toFixed(3)}ms`

  return row(
    ctx,
    [
      ctx.kit.Text({ color: THEME.info, children: ` ${name.padEnd(12)} ` }),
      ctx.kit.Text({ bold: true, color: THEME.ok, children: sparkline(shown, width) }),
      ctx.kit.Text({ dimColor: true, wrap: 'truncate-end', children: ` now ${fmt(shown[shown.length - 1] ?? 0)} · min ${fmt(Math.min(...shown))} · max ${fmt(Math.max(...shown))} · ${shown.length} samples` }),
    ],
    key,
  )
}

/**
 * Performance: a latency sparkline per series (each `metrics` run adds a sample; `report` reads the stored history),
 * every measuring verb by cost, and the last run's output. Nothing runs on open.
 */
/** The measuring verbs, grouped by what they do: the ones to run now, the benchmarks, and the ones that write local records. */
const GROUPS: readonly { id: string; title: string; ids: readonly string[]; note: (count: number) => string; open: boolean }[] = [
  { id: 'perf-measure', title: 'Measure now', ids: ['perf-metrics', 'perf-profile'], note: count => `${count} · $0 · read-only`, open: true },
  { id: 'perf-bench', title: 'Benchmarks', ids: ['perf-bench-wasm', 'perf-bench-all'], note: count => `${count} · the wasm suite is $0; all may download a model`, open: false },
  { id: 'perf-record', title: 'Record and analyse', ids: ['perf-report', 'perf-bottleneck', 'perf-optimize'], note: count => `${count} · writes local files`, open: false },
]

/**
 * Performance: a latency sparkline per series (each `metrics` run adds a sample; `report` reads the stored history), the
 * measuring verbs grouped and folded (measure now is open; the benchmarks and the record verbs fold away, each header says what is
 * inside), the two fixed tables it does not measure, and the last run's output with its spinner while it runs. Nothing runs on open.
 */
export function perfView(ctx: Ctx): RenderElement {
  const memo = perfMemo(ctx.state)
  const rows: RenderElement[] = [
    rule(ctx, 'Latency', memo.atMs === 0 ? 'no sample yet' : `last sample ${ago(memo.atMs, ctx.nowMs)}${memo.heapMb !== null ? ` · heap ${memo.heapMb.toFixed(1)} MB` : ''}`),
    seriesRow(ctx, 'spark-loop', 'event loop', memo.loop, '▸ METRICS adds one sample per run (in-process, $0)'),
    seriesRow(ctx, 'spark-report', 'report', memo.report, '▸ REPORT reads the stored history of .claude-flow/performance/metrics.json'),
  ]
  const grouped = new Set(GROUPS.flatMap(group => group.ids))

  for (const group of GROUPS) {
    const entries = PERF.filter(entry => group.ids.includes(entry.id))

    rows.push(...section(ctx, group.id, group.title, group.note(entries.length), entries.map(entry => entryRow(ctx, entry)), group.open))
  }

  // Any verb not yet in a group still shows, in the last group, so none is lost when the list grows.
  const loose = PERF.filter(entry => !grouped.has(entry.id))

  if (loose.length > 0) rows.push(...section(ctx, 'perf-other', 'Other', `${loose.length}`, loose.map(entry => entryRow(ctx, entry)), false))

  rows.push(...section(ctx, 'perf-na', 'Not measured here', '2 fixed tables', [naRow(ctx, 'CLI BOTTLENECK', '`performance bottleneck` and `optimize` print a fixed table: the MCP tools above measure'), naRow(ctx, 'MCP METRICS', '`performance_metrics` reports fixed latency figures, so the sparkline reads `metrics` instead')], false))
  rows.push(text(ctx, COST_KEY, { dimColor: true }))
  rows.push(...resultRows(ctx, isPerfResult))

  return col(ctx, rows, 'perf')
}

/** This view's result block alone: the pane asks for it to place under the row that was clicked. */
export const perfResult = (ctx: Ctx): RenderElement[] => resultRows(ctx, isPerfResult)
