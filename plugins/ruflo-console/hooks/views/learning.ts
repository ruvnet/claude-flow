import type { RenderElement } from 'claude-code'

import type { Intelligence } from '../data/cli'
import { ago, col, count, kv, live, pct, picture, row, section, sourceLine, starts, text, THEME, type Ctx } from './common'
import { stagesOf } from './frames'
import { CARD_COLUMNS, hasCards } from './card'
import { pipeStagesOf, routeModelOf, stageNote } from '../data/pipeline'
import { pipelineDiagram, routePicture } from '../gfx/pipeline'
import type { Grid } from '../gfx/raster'
import { settingsOf } from '../settings'
import { resultRows } from './automate'
import { pulseRows } from './learning-pulse'
import { neuralActionRows } from './neural'

/** A picture drawn here from the real state (the registry in frames.ts is not touched): the grid when the terminal has Raster, else its words. */
function drawn(ctx: Ctx, key: string, grid: Grid, fallback: string): RenderElement {
  return ctx.kit.Raster === undefined ? text(ctx, fallback, { dimColor: true }) : ctx.kit.Raster(grid.toRaster(key))
}

/** The width a picture is drawn to: a page in cards is narrower by the border and padding, as in frames.ts. */
const pictureWidth = (ctx: Ctx): number => Math.max(20, Math.min(200, hasCards(ctx.columns) ? ctx.columns - CARD_COLUMNS : ctx.columns))

/** The two switches that decide whether ruflo learns at all, folded away: each is a confirm-gated `ruflo config set`. */
function configRows(ctx: Ctx): RenderElement[] {
  const core = settingsOf(ctx.state).core
  const keys = [
    { key: 'neural.enabled', title: 'Neural learning', help: 'SONA / MoE pattern learning' },
    { key: 'hooks.enabled', title: 'Hooks', help: 'hooks that learn from your edits and routes' },
  ]

  // The header says where each switch stands, so the state reads without opening the section; each change still asks first.
  const summary = keys.map(item => `${item.title.toLowerCase()} ${core?.get(item.key) === 'true' ? 'on' : core?.get(item.key) === 'false' ? 'off' : 'n/a'}`).join(' · ')

  return section(
    ctx,
    'learn-config',
    'Settings & configuration',
    `${summary} · each change asks first`,
    [
      ...keys.map(item => {
        const value = core?.get(item.key)

        return row(
          ctx,
          [
            ctx.kit.Text({ bold: true, color: THEME.head, children: ` ${item.title.padEnd(16)}` }),
            ctx.kit.Text({ color: value === 'true' ? THEME.ok : value === 'false' ? THEME.bad : THEME.info, children: ` ${value === undefined ? 'n/a (open Settings to read it)' : value === 'true' ? 'on' : 'off'} ` }),
            ctx.kit.Button({ key: `learn-cfg-on-${item.key}`, label: ' ● on ', plain: true, onPress: () => ctx.act.settings.core(item.key, 'true') }),
            ctx.kit.Button({ key: `learn-cfg-off-${item.key}`, label: ' ○ off ', plain: true, onPress: () => ctx.act.settings.core(item.key, 'false') }),
            ctx.kit.Text({ dimColor: true, wrap: 'truncate-end', children: ` ${item.help}` }),
          ],
          `learn-cfg-${item.key}`,
        )
      }),
      text(ctx, ' every other setting is in Settings (s): the router, memory and swarm keys, the AI preferences', { dimColor: true }),
    ],
    false,
  )
}

/** The Learning Lab's actions on this page, folded: what was learned, training, pretrain, consolidate, the pattern store, the router. */
function actionRows(ctx: Ctx): RenderElement[] {
  return section(ctx, 'learn-actions', 'Self-learning actions', 'train, pretrain, consolidate, teach a pattern, route: the answer opens under the button', neuralActionRows(ctx, true), false)
}

/**
 * What ruflo has learned, from its own stores: the router's last pick and how routed tasks turned out, the model tier
 * router's tallies, and SONA's trajectory and pattern counts. A rate always carries its N. The router stays open; the pipeline
 * and SONA fold away, each header saying what it reads.
 */
export function learningView(ctx: Ctx): RenderElement {
  const { state, nowMs } = ctx
  const snap = state.snapshot
  const route = state.ruflo.route
  const outcomes = snap?.outcomes ?? null
  const router = snap?.router ?? null
  const neural = snap?.neural ?? null
  const intel = live<Intelligence>(state.probes.get('intelligence'))
  // The mod owns `route` only where no classic route hook runs it (ADR-404): with `owned` empty it routes nothing and records nothing here.
  const owned = state.ruflo.snapshot?.owned
  const classicOwnsRoute = owned !== undefined && !owned.includes('route')
  const lastOutcomeMs = outcomes?.points[outcomes.points.length - 1]?.atMs
  const staleOutcomes = lastOutcomeMs !== undefined && nowMs - lastOutcomeMs > 24 * 3_600_000
  const routeModel = routeModelOf({ seated: state.ruflo.snapshot !== null, classicOwnsRoute, route, lab: state.lab.result })
  const routeFallback = `route: ${routeModel.owner} owns routing · ${routeModel.candidates.map(c => `${c.agent} ${c.confidence === null ? 'n/a' : pct(c.confidence)}`).join(' · ') || 'no route recorded'}`
  // Each stage's age is its source's own timestamp; CONSOLIDATE's counter has none, so its age is n/a and it is never dimmed for age.
  const pipeStages = pipeStagesOf(stagesOf(state), { RETRIEVE: neural?.lastAdaptationMs, JUDGE: lastOutcomeMs, DISTILL: neural?.lastAdaptationMs }, nowMs)
  const routerRows: RenderElement[] = [
    kv(
      ctx,
      'last pick',
      route !== null
        ? `${route.agent} ${pct(route.confidence)} · ${route.matched ? 'keyword match' : 'no match, default'} · ${route.reason} (a prior, not a calibrated probability)`
        : state.ruflo.snapshot === null
          ? 'n/a — ruflo-mods not seated, so no in-process route'
          : classicOwnsRoute
            ? 'n/a — in this project the classic hook-handler owns routing, so ruflo-mods stands down and records no picks (see /ruflo-mods)'
            : 'n/a — no prompt routed yet this session',
    ),
    kv(
      ctx,
      'routed outcomes',
      outcomes === null || outcomes.total === 0
        ? 'n/a — no routing-outcomes.json'
        : `${outcomes.successes}/${outcomes.total} succeeded (${pct(outcomes.successes / outcomes.total)} success rate, N=${outcomes.total}) · last ${ago(lastOutcomeMs, nowMs)}${staleOutcomes ? ' · nothing recorded since' : ''}`,
      outcomes !== null && outcomes.total > 0 ? (staleOutcomes ? THEME.warn : THEME.info) : undefined,
    ),
    drawn(ctx, 'route', routePicture(routeModel, pictureWidth(ctx)), routeFallback),
    picture(ctx, 'curve', `running success rate over ${outcomes?.total ?? 0} outcomes`),
    text(ctx, 'running success rate of routed tasks, oldest left (router accuracy over N outcomes); new outcomes draw in', { dimColor: true }),
    kv(
      ctx,
      'model router',
      router === null
        ? 'n/a — no .swarm/model-router-state.json'
        : `${count(router.decisions)} decisions · ${router.distribution.filter(entry => entry.count > 0).map(entry => `${entry.model} ${entry.count}`).join(' · ') || 'none'} · avg confidence ${router.avgConfidence === undefined ? 'n/a' : router.avgConfidence.toFixed(2)} · ${ago(router.updatedMs, nowMs)}`,
    ),
  ]
  const pipelineRows: RenderElement[] = [
    drawn(ctx, 'pipeline-stages', pipelineDiagram(pipeStages, pictureWidth(ctx)), pipeStages.map(stage => `${stage.name} ${stage.count ?? 'n/a'} (${stageNote(stage)})`).join(' → ')),
    ...stagesOf(state).map((stage, i) => text(ctx, `  ${stage.name.toLowerCase()}: ${stage.source} · ${stageNote(pipeStages[i] as (typeof pipeStages)[number])}`, { dimColor: true })),
    text(ctx, `  a stage dims when its source has gained nothing for 24h; CONSOLIDATE has no timestamp, so its age is n/a`, { dimColor: true }),
    picture(ctx, 'patterns', `patterns since load: ${state.history.patterns.map(sample => sample.value).join(' ') || 'n/a'}`),
  ]
  const sonaRows: RenderElement[] = [
    kv(ctx, 'trajectories', neural === null ? 'n/a — no .claude-flow/neural/stats.json' : count(neural.trajectories)),
    kv(ctx, 'patterns learned', neural === null ? 'n/a' : count(neural.patterns)),
    kv(ctx, 'signals', neural === null ? 'n/a' : count(neural.signals)),
    kv(ctx, 'last learned', neural?.lastAdaptationMs !== undefined ? ago(neural.lastAdaptationMs, nowMs) : 'n/a', THEME.info),
    kv(ctx, 'SONA patterns', snap?.sona === null || snap?.sona === undefined ? 'n/a — no .swarm/sona-patterns.json' : String(snap.sona.patterns)),
    kv(
      ctx,
      'live engine',
      intel === null
        ? sourceLine(state.probes.get('intelligence'), nowMs, 'n/a').text
        : `${count(intel.trajectories)} trajectories · ${count(intel.patterns)} patterns · MoE ${count(intel.moeDecisions)} decisions · EWC ${count(intel.ewcConsolidations)} consolidations · neural router ${intel.neuralRouter ?? 'n/a'}`,
    ),
    text(ctx, 'live engine: hooks_intelligence_stats in a fresh CLI process, so in-memory counters start at zero there', { dimColor: true }),
  ]
  const rows: RenderElement[] = [
    ...section(ctx, 'learn-router', 'Router', 'ruflo-mods · routing-outcomes.json', routerRows, true),
    ...section(ctx, 'learn-pipeline', 'Pipeline', 'RETRIEVE → JUDGE → DISTILL → CONSOLIDATE', pipelineRows, true),
    ...section(ctx, 'learn-sona', 'SONA · ReasoningBank', 'neural/stats.json', sonaRows, false),
  ]

  // Nothing learned yet: the loop starts from the repository itself.
  if ((snap?.sona === null || snap?.sona === undefined) && (neural === null || neural === undefined) && snap?.isRufloProject === true) rows.push(starts(ctx, 'Nothing learned yet in this project.', ['pretrain']))

  return col(ctx, [...resultRows(ctx, ['nn-']), ...pulseRows(ctx), ...rows, ...configRows(ctx), ...actionRows(ctx)], 'learning')
}
