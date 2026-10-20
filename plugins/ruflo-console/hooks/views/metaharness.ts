import type { RenderElement } from 'claude-code'

import type { Flywheel, HarnessScore } from '../data/cli'
import { ago, col, kv, live, picture, section, sourceLine, text, THEME, type Ctx } from './common'
import { labRows } from './mh-lab'

/**
 * MetaHarness is optional (ADR-150): every line here degrades to "unavailable" with the CLI's reason, and nothing in
 * the console depends on it. Score and flywheel come from the ruflo CLI; the active policy from disk. Readiness and the
 * flywheel stay open; the policy and audit trend fold away, and the lab below folds by group.
 */
export function metaharnessView(ctx: Ctx): RenderElement {
  const { state, nowMs } = ctx
  const score = live<HarnessScore>(state.probes.get('metaharness'))
  const flywheel = live<Flywheel>(state.probes.get('flywheel'))
  const policy = state.snapshot?.harnessPolicy ?? null
  const readiness: RenderElement[] = []
  const ledger: RenderElement[] = []
  const trend: RenderElement[] = []

  if (score === null) {
    const line = sourceLine(state.probes.get('metaharness'), nowMs, 'MetaHarness')

    readiness.push(text(ctx, state.probes.get('metaharness')?.error !== null && state.probes.get('metaharness')?.error !== undefined ? `${line.text} — optional (ADR-150), the console works without it` : line.text, { dimColor: true }))
  } else {
    readiness.push(picture(ctx, 'radar', score.dims.map(dim => `${dim.name} ${dim.value}`).join(' · ')))
    readiness.push(
      kv(
        ctx,
        'est. cost/run',
        `${score.costUsd === undefined ? 'n/a' : `$${score.costUsd.toFixed(3)}`} · hard constraints ${score.constraints ?? 'n/a'} · scaffold ${score.scaffoldReady === undefined ? 'n/a' : score.scaffoldReady ? 'ready' : 'not ready'} · scored ${ago(score.atMs, nowMs)}`,
      ),
    )
    readiness.push(text(ctx, 'static readiness heuristics from `metaharness score`, 0-100 per axis; the radar growing in is decoration', { dimColor: true }))
  }

  if (flywheel === null) {
    ledger.push(text(ctx, sourceLine(state.probes.get('flywheel'), nowMs, 'flywheel').text, { dimColor: true }))
  } else {
    ledger.push(kv(ctx, 'ledger', `${flywheel.isLedgerValid ? 'valid' : 'INVALID'} · ${flywheel.commits} commits · ${flywheel.receipts} receipts`, flywheel.isLedgerValid ? THEME.ok : THEME.bad))
    ledger.push(kv(ctx, 'champion', flywheel.champion ?? 'none promoted', flywheel.champion !== undefined ? THEME.info : undefined))
    ledger.push(kv(ctx, 'serving epoch', flywheel.epoch === undefined ? 'n/a' : String(flywheel.epoch)))

    for (const error of flywheel.errors) ledger.push(text(ctx, `ledger: ${error}`, { color: THEME.bad }))
  }

  trend.push(kv(ctx, 'active policy', policy === null ? 'n/a — no .claude-flow/harness-active-policy.json' : `${policy.champion.slice(0, 22)}… · ${policy.tier ?? 'n/a'} · ${policy.layer ?? 'n/a'} · applied ${ago(policy.appliedAtMs, nowMs)}`))
  trend.push(picture(ctx, 'trend', 'audit trend needs a terminal'))
  trend.push(text(ctx, 'from `metaharness audit-list` (memory namespace metaharness-audit) · ▸ OIA AUDIT below adds one', { dimColor: true }))

  const rows: RenderElement[] = [
    ...section(ctx, 'mh-readiness', 'Readiness', score?.archetype ?? 'metaharness score', readiness, true),
    ...section(ctx, 'mh-flywheel', 'Flywheel', 'receipts ledger', ledger, true),
    ...section(ctx, 'mh-trend', 'Policy and audit trend', 'worst severity per stored audit', trend, false),
    ...labRows(ctx),
  ]

  return col(ctx, rows, 'metaharness')
}
