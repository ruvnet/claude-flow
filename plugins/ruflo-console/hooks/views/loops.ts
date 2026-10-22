import type { RenderElement } from 'claude-code'

import { INTERVALS, loopInput, loopsOf, PRESETS, TIERS } from '../loops'
import { clip, row, section, text, THEME, type Ctx } from './common'
import { fullRows } from './full-rows'

const chip = (ctx: Ctx, key: string, label: string, isOn: boolean, onPress: () => void): RenderElement =>
  ctx.kit.Button({ key, label: ` ${isOn ? '●' : '○'} ${label} `, plain: true, ...(isOn && { variant: 'primary' as const }), onPress })

/** A boxed one-line field: Enter applies it. */
function field(ctx: Ctx, key: string, label: string, placeholder: string, submit: string, onSubmit: (value: string) => void): RenderElement[] {
  const Input = ctx.kit.Input

  return Input === undefined ? [text(ctx, ` ${label}: use the palette (p)`, { dimColor: true })] : [ctx.kit.Box({ key: `${key}-box`, borderStyle: 'round', borderColor: THEME.info, paddingX: 1, children: [Input({ key, label, placeholder, submitLabel: submit, onSubmit })] })]
}

/**
 * The Loop Manager, a folded section of the Automation page: presets by tier (practical, steady, exotic), a configurator
 * (interval, task, stop condition) with the exact /loop that will be sent, and the launcher into the Claude UI. It asks first.
 */
export function loopRows(ctx: Ctx): RenderElement[] {
  const cfg = loopsOf(ctx.state)
  const m = ctx.act.loops
  const built = loopInput(cfg, ctx.state.commandNames)
  const presets = PRESETS.filter(preset => preset.tier === cfg.tier)
  const tiers = row(ctx, [text(ctx, ' tier '), ...TIERS.map(tier => chip(ctx, `loop-tier-${tier.id}`, `${tier.title} · ${tier.about}`, cfg.tier === tier.id, () => m.tier(tier.id)))], 'loop-tiers')
  const list = presets.map(preset =>
    row(
      ctx,
      [
        ctx.kit.Text({ color: cfg.preset === preset.id ? THEME.ok : THEME.info, children: cfg.preset === preset.id ? ' ◆ ' : ' ◇ ' }),
        ctx.kit.Button({ key: `loop-pick-${preset.id}`, label: `${preset.title} `.padEnd(30, '.'), plain: true, onPress: () => m.pick(preset.id) }),
        ctx.kit.Text({ dimColor: true, wrap: 'truncate-end', children: clip(` ${preset.interval} · ${preset.about}`, Math.max(12, ctx.columns - 46)) }),
        ctx.kit.Button({ key: `loop-use-${preset.id}`, label: ' ▸ use', plain: true, dimColor: true, onPress: () => m.pick(preset.id) }),
      ],
      `loop-preset-${preset.id}`,
    ),
  )
  const configure =
    cfg.task === ''
      ? [text(ctx, ' pick a preset above, or type a task below', { dimColor: true })]
      : [
          row(ctx, [text(ctx, ' every '), ...INTERVALS.map(interval => chip(ctx, `loop-int-${interval}`, interval, cfg.interval === interval, () => m.interval(interval)))], 'loop-intervals'),
          ...fullRows(ctx, ' task: ', cfg.task, { key: 'loop-task-line', bold: true, after: ctx.kit.Button({ key: 'loop-edit-task', label: '✎ edit', plain: true, onPress: () => ctx.act.editField('loop-task', cfg.task) }) }),
        ]

  return section(
    ctx,
    'loops',
    'Loop Manager',
    `${PRESETS.length} presets, practical to exotic · starts a /loop in the Claude UI (asks first)`,
    [
      tiers,
      ...list,
      ...configure,
      ...field(ctx, 'loop-task', '✎ task', 'what each tick should do (or /plugin:command)', 'use', value => m.task(value)),
      ...field(ctx, 'loop-stop', '⏹ stop', 'until 09:00 · after 12 runs · when done (optional)', 'set', value => m.stop(value)),
      ...fullRows(ctx, built.ok ? ' will send: ' : ' not ready: ', built.ok ? built.text : built.why, { key: 'loop-will', color: built.ok ? THEME.ok : THEME.warn, maxLines: 12, hint: 'the whole line is sent' }),
      row(
        ctx,
        [
          ctx.kit.Button({ key: 'loop-start', label: ' ▶ Start loop in Claude ', variant: 'primary', onPress: () => m.launch() }),
          ctx.kit.Button({ key: 'loop-manage', label: ' ☰ List / stop my loops ', plain: true, onPress: () => m.manage() }),
          text(ctx, '  each tick is a Claude Code turn: it asks first and says what it costs', { dimColor: true }),
        ],
        'loop-actions',
      ),
    ],
    false,
  )
}
