import type { RenderElement } from 'claude-code'

import type { MapEntry } from '../gfx/memmap'
import { analyseHealth, HEALTH_CAP, type HealthReport, type HealthSample, NEAR_JACCARD, PAIR_CAP, recallEvidenceOf, type SemanticReport, semanticDuplicates, SIMILAR_COSINE, STALE_DAYS } from '../data/memory-health'
import { recallOf, type RecallFacts } from '../data/recall'
import { gauge } from '../memory-lines'
import { ago, button, clip, confirmHere, count, kv, live, row, sourceLine, text, THEME, type Ctx } from './common'

/** The probe id the integrator registers (data/memory-health.ts memoryHealthProbe). */
export const HEALTH_PROBE = 'memory-health'
/** Clusters and stale entries drawn at once; the counts above are exact, the lists are bounded and say so. */
const SHOW_CLUSTERS = 5
const SHOW_STALE = 5

const share = (part: number, whole: number): string => (whole <= 0 ? 'n/a' : `${Math.round((part / whole) * 100)}%`)

/** What limits the figures, in one line: the list cap, the pair budget, and what was left out. Never omitted. */
export function limitsLine(report: HealthReport, total: number | undefined): string {
  const listCut = total !== undefined && total > report.analysed ? ` of ${count(total)} stored (the newest ${HEALTH_CAP} are read)` : ''
  const pairs = report.isTruncated ? `pair budget ${count(PAIR_CAP)} reached: only the newest ${report.entriesCompared} entries were compared` : `${count(report.pairsCompared)} of ${count(report.pairsPossible)} pairs compared`

  return `${report.analysed} entries${listCut} · ${pairs} · from key and size only, no values read`
}

function summaryRows(ctx: Ctx, report: HealthReport, total: number | undefined): RenderElement[] {
  const width = Math.max(8, Math.min(24, ctx.columns - 50))

  return [
    text(ctx, ` ${limitsLine(report, total)}`, report.isTruncated ? { color: THEME.warn } : { dimColor: true }),
    kv(ctx, 'duplicates', `${gauge(report.duplicateEntries, report.analysed, width)} ${report.duplicateEntries} entries in ${report.clusterCount} cluster${report.clusterCount === 1 ? '' : 's'} (${share(report.duplicateEntries, report.analysed)})`, report.clusterCount === 0 ? THEME.ok : THEME.warn),
    kv(ctx, 'stale', `${gauge(report.staleCount, report.analysed, width)} ${report.staleCount} ${staleMeaning(report)} (${share(report.staleCount, report.analysed)})`, report.staleCount === 0 ? THEME.ok : THEME.warn),
    text(ctx, ` ${staleRule(report)}`, { dimColor: true }),
    kv(ctx, 'never retrieved', `${report.neverRecalledEntries} of ${report.analysed} entries have an access count of 0 (retrievals by memory retrieve or search, not the hook) · ${report.neverRecalledNamespaces.length} whole namespace${report.neverRecalledNamespaces.length === 1 ? '' : 's'}`),
  ]
}

/** What "stale" counts, said by the rules that actually fired. */
function staleMeaning(report: HealthReport): string {
  if (report.log === null) return `never retrieved and not updated for ${STALE_DAYS}d`

  return `not surfaced by the hook (log) or never retrieved (access count), and not updated for ${STALE_DAYS}d`
}

/** Which rule judged how many entries, and why the log is or is not used. Never omitted. */
export function staleRule(report: HealthReport): string {
  if (report.log === null) return 'rule: access count only (no recall log read: it needs the hook’s recall-log.jsonl and the ranked file). The count has no time, so this is “never retrieved”, not “not retrieved lately”.'

  const span = report.log.days < 1 ? 'under a day' : `${report.log.days.toFixed(1)} days`

  if (report.logChecked === 0) return `rule: access count (the recall log covers ${span} of ${report.log.records} recalls but is not used: ${report.log.days < STALE_DAYS ? `it is shorter than ${STALE_DAYS}d` : 'no entry key matches a name the hook recalls'})`

  return `rule: log for ${report.logChecked} entr${report.logChecked === 1 ? 'y' : 'ies'} whose key the hook can recall (not surfaced in ${STALE_DAYS}d of a ${span} log; ${report.staleByLog} stale), access count for the rest (${report.staleByCount} stale)`
}

function clusterRows(ctx: Ctx, report: HealthReport): RenderElement[] {
  if (report.clusterCount === 0) return [text(ctx, ` no duplicate or near-duplicate keys among these entries (near = key words ≥ ${Math.round(NEAR_JACCARD * 100)}% alike and a close size)`, { color: THEME.ok })]

  const rows: RenderElement[] = []

  for (const cluster of report.clusters.slice(0, SHOW_CLUSTERS)) {
    const names = cluster.members.slice(0, 3).map(member => `${member.namespace}/${member.key}`).join(' · ')
    const more = cluster.size > 3 ? ` +${cluster.size - 3}` : ''

    rows.push(row(ctx, [ctx.kit.Text({ bold: true, color: cluster.kind === 'exact' ? THEME.bad : THEME.warn, children: ` ${cluster.kind === 'exact' ? 'same ' : 'near '}×${cluster.size} ` }), text(ctx, clip(`${names}${more}`, Math.max(10, ctx.columns - 14)), { color: THEME.info })]))
  }

  if (report.clusterCount > SHOW_CLUSTERS) rows.push(text(ctx, `   +${report.clusterCount - SHOW_CLUSTERS} more cluster${report.clusterCount - SHOW_CLUSTERS === 1 ? '' : 's'} not drawn (the counts above include them)`, { dimColor: true }))

  return rows
}

function staleRows(ctx: Ctx, report: HealthReport): RenderElement[] {
  const rows = report.stale.slice(0, SHOW_STALE).map(entry => text(ctx, ` ${clip(`${entry.namespace}/${entry.key}`, Math.max(10, ctx.columns - 38))}  updated ${ago(entry.updatedAtMs, ctx.nowMs)} · by ${entry.by === 'log' ? 'recall log' : 'access count'}`, { color: THEME.warn }))

  if (report.staleCount > SHOW_STALE) rows.push(text(ctx, `   +${report.staleCount - SHOW_STALE} more, oldest shown first`, { dimColor: true }))
  if (rows.length === 0) rows.push(text(ctx, ` no entry is both unrecalled (by the rule above) and ${STALE_DAYS}+ days untouched`, { color: THEME.ok }))

  return rows
}

function namespaceRows(ctx: Ctx, report: HealthReport): RenderElement[] {
  const width = Math.max(6, Math.min(20, ctx.columns - 60))
  const rows = report.namespaces.slice(0, 8).map(space =>
    row(ctx, [
      ctx.kit.Text({ color: space.isNeverRecalled ? THEME.warn : THEME.info, children: ` ${clip(space.name, 18).padEnd(19)}` }),
      ctx.kit.Text({ dimColor: true, children: `${gauge(space.recalled, space.count, width)} ${space.recalled}/${space.count} recalled${space.stale > 0 ? ` · ${space.stale} stale` : ''}${space.isNeverRecalled ? ' · never recalled' : ''}` }),
    ]),
  )

  if (report.namespaces.length > 8) rows.push(text(ctx, `   +${report.namespaces.length - 8} smaller namespaces not drawn`, { dimColor: true }))

  return rows
}

/**
 * Consolidate runs the existing AgentDB consolidate (mem-consolidate) behind the lab's confirm card. Its answer is drawn
 * here, so the person who pressed it sees it: the run is raised under the AgentDB group and re-homed to this section.
 */
function consolidateRows(ctx: Ctx): RenderElement[] {
  const lab = ctx.state.memoryLab
  const press = () => {
    ctx.act.memory.run('mem-consolidate')
    lab.origin = 'health'
  }

  return [
    row(ctx, [
      button(ctx, 'mem-health-consolidate', '▸ consolidate', press, { primary: true }),
      text(ctx, ' asks first · merges across tiers, never deletes these keys (DELETE does)', { dimColor: true }),
    ]),
    ...(lab.origin === 'health' ? confirmHere(ctx, 'mem:agentdb') : []),
  ]
}

/**
 * The analysis is O(pairs) (up to PAIR_CAP, ~100 ms at the cap) and the view renders every frame, so it is computed once per
 * probe result and per minute (the stale cutoff is the only thing the clock changes), never per frame.
 */
const reports = new WeakMap<HealthSample, { minute: number; facts: RecallFacts | null; report: HealthReport }>()

export function reportFor(sample: HealthSample, nowMs: number, facts: RecallFacts | null = null): HealthReport {
  const minute = Math.floor(nowMs / 60_000)
  const cached = reports.get(sample)

  if (cached !== undefined && cached.minute === minute && cached.facts === facts) return cached.report

  const report = analyseHealth(sample, nowMs, { evidence: recallEvidenceOf(facts, nowMs) })

  reports.set(sample, { minute, facts, report })

  return report
}

const semantics = new WeakMap<readonly MapEntry[], SemanticReport | null>()

/** Similar-by-meaning clusters of the map's listed entries, computed once per probe result (about 50 ms at 500 x 384, never per frame). */
export function semanticFor(entries: readonly MapEntry[]): SemanticReport | null {
  if (!semantics.has(entries)) semantics.set(entries, semanticDuplicates(entries))

  return semantics.get(entries) ?? null
}

function semanticRows(ctx: Ctx, entries: readonly MapEntry[] | null): RenderElement[] {
  const report = entries === null ? null : semanticFor(entries)

  if (report === null) return [text(ctx, ' similar by meaning: not checked. It needs stored vectors, which memory list prints only with --embeddings (a CLI that has it, and entries stored with embeddings)', { dimColor: true })]

  const rows: RenderElement[] = [text(ctx, ` ${report.compared} of ${report.listed} listed entries with a stored vector compared${report.withVector > report.compared ? ` (the newest ${report.cap} of ${report.withVector}; the rest are not)` : ''} · ${count(report.pairs)} pairs · cosine ≥ ${SIMILAR_COSINE}`, { dimColor: true })]

  if (report.clusterCount === 0) return [...rows, text(ctx, ' no two stored vectors are that close', { color: THEME.ok })]

  for (const cluster of report.clusters.slice(0, SHOW_CLUSTERS)) {
    const names = cluster.members.slice(0, 3).map(member => `${member.namespace}/${member.key}`).join(' · ')

    rows.push(row(ctx, [ctx.kit.Text({ bold: true, color: THEME.warn, children: ` like ×${cluster.size} ` }), text(ctx, clip(`${names}${cluster.size > 3 ? ` +${cluster.size - 3}` : ''} (min cos ${cluster.minCosine.toFixed(3)})`, Math.max(10, ctx.columns - 14)), { color: THEME.info })]))
  }

  if (report.clusterCount > SHOW_CLUSTERS) rows.push(text(ctx, `   +${report.clusterCount - SHOW_CLUSTERS} more cluster${report.clusterCount - SHOW_CLUSTERS === 1 ? '' : 's'} not drawn (${report.entries} entries in ${report.clusterCount} clusters in all)`, { dimColor: true }))

  return rows
}

/** The health section's rows, or one honest line when the probe has not answered. */
export function healthRows(ctx: Ctx, now: () => number = () => ctx.nowMs): RenderElement[] {
  const result = ctx.state.probes.get(HEALTH_PROBE)
  const sample = live<HealthSample>(result)

  if (sample === null) return [text(ctx, ` ${sourceLine(result, ctx.nowMs, 'memory health (memory list)').text}${result === undefined ? ' (the health probe is not registered in this build)' : ''}`, { dimColor: true })]

  if (sample.entries.length === 0) return [text(ctx, ' no entries to analyse: store one, or import your Claude memories (IMPORT CLAUDE)', { dimColor: true })]

  const facts = recallOf(ctx.state.snapshot)
  const report = reportFor(sample, now(), facts)
  const mapped = live<MapEntry[]>(ctx.state.probes.get('memmap'))
  const total = live<{ total?: number }>(ctx.state.probes.get('memory'))?.total

  return [
    ...summaryRows(ctx, report, total),
    text(ctx, ' duplicate clusters', { bold: true, color: THEME.head }),
    ...clusterRows(ctx, report),
    text(ctx, ' similar by meaning (stored vectors)', { bold: true, color: THEME.head }),
    ...semanticRows(ctx, mapped),
    text(ctx, ' stale entries', { bold: true, color: THEME.head }),
    ...staleRows(ctx, report),
    text(ctx, ' recall by namespace', { bold: true, color: THEME.head }),
    ...namespaceRows(ctx, report),
    ...consolidateRows(ctx),
  ]
}
