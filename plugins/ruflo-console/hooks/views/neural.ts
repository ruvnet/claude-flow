import type { RenderElement } from 'claude-code'

import { EPOCHS, PATTERNS, sparkline } from '../data/automate'
import { field, resultRows, strip } from './automate'
import { spinAt } from '../spinner'
import { lifecycleRows, recallRows } from './recall-rows'
import { ago, col, count, kv, row, section, text, THEME, type Ctx } from './common'

const BAR = 24

/** What ruflo's learning wrote to disk: trajectories, patterns and signals, and when it last adapted. */
function intelligenceRows(ctx: Ctx): RenderElement[] {
  const { state, nowMs } = ctx
  const neural = state.snapshot?.neural ?? null
  const rows: RenderElement[] = []

  rows.push(kv(ctx, 'trajectories', count(neural?.trajectories)))
  rows.push(kv(ctx, 'patterns learned', count(neural?.patterns)))
  rows.push(kv(ctx, 'signals', count(neural?.signals)))
  rows.push(kv(ctx, 'last adapted', neural?.lastAdaptationMs !== undefined ? ago(neural.lastAdaptationMs, nowMs) : 'n/a'))
  rows.push(kv(ctx, 'sona patterns', count(state.snapshot?.sona?.patterns)))
  rows.push(strip(ctx, 'nn-read', [{ id: 'nn-status', label: 'status', cost: 'read' }, { id: 'nn-patterns', label: 'patterns', cost: 'read' }, { id: 'nn-analyze', label: 'memory', cost: 'read' }, { id: 'nn-intel', label: 'intelligence stats', cost: 'read' }]))

  return rows
}

/**
 * Training: a progress bar while a run is out (the CLI prints no epochs off a TTY, so it sweeps rather than fills), the
 * loss of each run this session as a sparkline, and a row per pattern with its epoch buttons.
 */
function trainingRows(ctx: Ctx): RenderElement[] {
  const { state, nowMs } = ctx
  const trains = state.auto.trains
  const last = trains[trains.length - 1]
  const losses = trains.flatMap(run => (run.loss === undefined ? [] : [run.loss]))
  const running = state.lab.running?.id.startsWith('nn-train') === true ? state.lab.running : null
  const rows: RenderElement[] = []

  if (running !== null) {
    const at = Math.floor((nowMs - running.startedAtMs) / 250) % (BAR * 2)
    const head = at < BAR ? at : BAR * 2 - at - 1
    const bar = Array.from({ length: BAR }, (_, i) => (Math.abs(i - head) <= 2 ? '█' : '░')).join('')

    rows.push(text(ctx, ` ${spinAt(nowMs)} ${running.label} [${bar}] ${Math.round((nowMs - running.startedAtMs) / 1000)}s`, { bold: true, color: THEME.warn }))
  }

  rows.push(
    text(ctx, losses.length === 0 ? ' loss: n/a until a run ends (each run adds one point: Final Loss, else Avg Loss)' : ` loss ${sparkline(losses)}  last ${losses[losses.length - 1]?.toExponential(3)} · low ${Math.min(...losses).toExponential(3)} · ${losses.length} point${losses.length === 1 ? '' : 's'}`, {
      color: losses.length === 0 ? THEME.info : THEME.ok,
      dimColor: losses.length === 0,
    }),
  )
  if (last !== undefined) rows.push(text(ctx, ` last run: ${last.pattern} · ${last.epochs} epochs${last.seconds !== undefined ? ` · ${last.seconds}s` : ''}${last.backend !== undefined ? ` · ${last.backend}` : ''} · ${ago(last.atMs, nowMs)}`, { dimColor: true }))

  for (const pattern of PATTERNS) {
    rows.push(
      row(
        ctx,
        [
          ctx.kit.Text({ bold: true, color: THEME.warn, children: ' cpu ' }),
          ctx.kit.Text({ bold: true, color: THEME.head, children: ` ${pattern} `.padEnd(16, '.') }),
          ctx.kit.Text({ color: THEME.info, children: ' epochs ' }),
          ...EPOCHS.map(epochs => ctx.kit.Button({ key: `run-nn-train-${pattern}-${epochs}`, label: ` ▸ ${epochs}`, plain: true, onPress: () => void ctx.act.run(`nn-train-${pattern}-${epochs}`) })),
        ],
        `train-${pattern}`,
      ),
    )
  }

  rows.push(field(ctx, 'nn-train', 'train', 'a pattern and epochs: coordination 150 (1-500)', 'train'))
  rows.push(strip(ctx, 'nn-write', [{ id: 'nn-quantize', label: 'quantize patterns (Int8)', cost: 'local' }, { id: 'nn-compress', label: 'compress the store', cost: 'local' }]))

  return rows
}

/** Bootstrap, consolidate, and the pattern store: the learning loop's own actions. */
function selfLearnRows(ctx: Ctx): RenderElement[] {
  return [
    strip(ctx, 'nn-pretrain', [{ id: 'nn-pretrain-shallow', label: 'pretrain: shallow', cost: 'local' }, { id: 'nn-pretrain-medium', label: 'medium', cost: 'local' }, { id: 'nn-pretrain-deep', label: 'deep', cost: 'local' }]),
    strip(ctx, 'nn-consolidate', [{ id: 'nn-consolidate', label: 'consolidate retained memories', cost: 'local' }]),
    field(ctx, 'nn-pattern-search', 'pattern search', 'what the stored patterns should be searched for, in words', 'search'),
    field(ctx, 'nn-pattern-store', 'teach a pattern', 'a pattern to remember: always run the auth tests after touching login', 'store'),
  ]
}

function routerRows(ctx: Ctx): RenderElement[] {
  return [
    field(ctx, 'nn-route', 'route', 'a task: fix the login bug in auth.ts', 'route'),
    field(ctx, 'nn-explain', 'explain', 'a task, to see why the router picks its agent', 'explain'),
    field(ctx, 'nn-predict', 'predict', 'text for the trained models’ top predictions', 'predict'),
  ]
}

/**
 * Everything the Learning Lab does, as folded sections: what was learned and the router open; training open only while a run is
 * out (so its bar is never hidden) and folded otherwise; the self-learning actions folded. Also drawn, folded, on the Learning page.
 */
export const neuralActionRows = (ctx: Ctx, nested = false): RenderElement[] => {
  const { state } = ctx
  const neural = state.snapshot?.neural ?? null
  const trains = state.auto.trains
  const isTraining = state.lab.running?.id.startsWith('nn-train') === true

  // Nested under the Learning page's own fold, the sections start open, so there is one fold to open, not two.
  return [
    ...section(ctx, 'nn-intel', 'Intelligence', neural === null ? 'no .claude-flow/neural/stats.json' : 'neural/stats.json', intelligenceRows(ctx), true),
    ...section(ctx, 'nn-train', 'Training', `${trains.length} run${trains.length === 1 ? '' : 's'} this session${isTraining ? ' · running' : ''}`, trainingRows(ctx), nested || isTraining),
    ...section(ctx, 'nn-self', 'Self-learning', 'bootstrap, consolidate and teach the ReasoningBank · local, no model calls', selfLearnRows(ctx), nested),
    ...section(ctx, 'nn-recall', 'Explain a recall', 'what the hook surfaced · ranked-context.json', recallRows(ctx), true),
    ...section(ctx, 'nn-life', 'Pattern lifecycle', 'neural/models.json · prune and promote ask first', lifecycleRows(ctx), nested),
    ...section(ctx, 'nn-router', 'Router', 'which agent for this task? · $0, local', routerRows(ctx), true),
  ]
}

/**
 * The Learning Lab: what ruflo has learned (from its own files), training with a loss sparkline, and the router's
 * "which agent?" and "why?". Opening it runs nothing; reads run on a click, training and compression ask first.
 */
export function neuralView(ctx: Ctx): RenderElement {
  return col(
    ctx,
    [
      ...resultRows(ctx, ['nn-']),
      ...neuralActionRows(ctx),
      text(ctx, ' $0 read, runs at once · cpu local compute that writes .claude-flow/neural, asks first · no entry here calls a paid model', { dimColor: true }),
    ],
    'neural',
  )
}

/** This view's result block alone: the pane asks for it to place under the row that was clicked. */
export const neuralResult = (ctx: Ctx): RenderElement[] => resultRows(ctx, ['nn-'])
