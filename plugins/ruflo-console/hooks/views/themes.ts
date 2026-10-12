import type { RenderElement } from 'claude-code'
import { activeTheme, COLOR_KEYS, lowContrast, themesOf } from '../themes'
import { button, clip, col, picture, row, text, THEME, type Ctx } from './common'

/** A terminal color picker: visible swatches and exact hex input, stacked at every width. */
export function themesView(ctx: Ctx): RenderElement {
  const pick = (key: string, label: string, run: () => void) => button(ctx, key, clip(label, Math.max(1, ctx.columns - 2)), run)
  const studio = themesOf(ctx.state), act = ctx.act.themes
  const input = (key: string, label: string, placeholder: string, submit: (value: string) => void) => ctx.kit.Input
    ? ctx.kit.Input({ key, label, placeholder, submitLabel: 'preview', onSubmit: submit })
    : text(ctx, `${label}: text input is unavailable on this surface`, { dimColor: true })
  const selected = studio.selected ?? ctx.state.options.look
  const swatches = ['#f06449', '#72c79b', '#78c8ff', '#ca9bff', '#ffcf73', '#f2f4f3', '#000000', '#101820']
  const rows: RenderElement[] = [
    text(ctx, 'THEME STUDIO', { bold: true, color: THEME.head }),
    text(ctx, 'Choose a look. Custom themes use Orbital animation.'),
    ...(['bbs', 'plain', 'orbital'] as const).map(id => pick(`theme-${id}`, `${selected === id ? '●' : '○'} ${id === 'bbs' ? 'Classic BBS' : id === 'plain' ? 'Terminal plain' : 'Orbital'}`, () => act.select(id))),
    ...studio.saved.map(theme => pick(`theme-custom-${theme.name}`, `${selected === `custom:${theme.name}` ? '●' : '○'} ${theme.name}`, () => act.select(`custom:${theme.name}`))),
    pick('theme-reset', 'Use configured look', act.reset),
    text(ctx, `Active: ${studio.active ? activeTheme(ctx.state).name : ctx.state.options.look}`, { color: THEME.ok }),
    text(ctx, 'PREVIEW', { bold: true, color: THEME.head }),
    picture(ctx, 'theme-preview', `Preview: ${studio.draft.name}`),
    ...(studio.draft.motion.globe ? [picture(ctx, 'theme-globe', 'Globe preview')] : []),
    input('theme-name', 'Theme name', studio.draft.name, act.name),
  ]
  for (const key of COLOR_KEYS) {
    rows.push(text(ctx, `${key}  ${studio.draft.palette[key]}`, { color: THEME.info }))
    // Four swatches per row at normal widths, two on a narrow pane.
    const count = ctx.columns < 36 ? 2 : 4
    for (let i = 0; i < swatches.length; i += count) rows.push(row(ctx, swatches.slice(i, i + count).map((color, j) => col(ctx, [ctx.kit.Text({ color, backgroundColor: studio.draft.palette.background, children: ' ▄▄ ' }), pick(`theme-${key}-${i + j}`, String(i + j + 1), () => act.color(key, color))]))))
    rows.push(input(`theme-color-${key}`, `${key} hex`, studio.draft.palette[key], value => act.color(key, value)))
  }
  rows.push(text(ctx, 'MOTION', { bold: true, color: THEME.head }))
  for (const key of ['stars', 'globe', 'topology'] as const) rows.push(pick(`theme-motion-${key}`, `${studio.draft.motion[key] ? '●' : '○'} ${key}`, () => act.motion(key, !studio.draft.motion[key])))
  for (const speed of [0.25, 0.5, 1, 2]) rows.push(pick(`theme-speed-${speed}`, `${studio.draft.motion.speed === speed ? '●' : '○'} ${speed}x motion`, () => act.motion('speed', speed)))
  rows.push(text(ctx, ctx.state.options.fps === 0 ? 'Reduced motion is on. Previews are still.' : 'Settings > fps = 0 stops all motion.', { dimColor: true }))
  const low = lowContrast(studio.draft)
  if (low.length) rows.push(text(ctx, `Low contrast: ${low.join(', ')}. Adjust before saving.`, { color: THEME.warn }))
  rows.push(pick('theme-save', studio.saving ? 'Saving…' : 'Save preview and apply', act.save))
  rows.push(text(ctx, 'GENERATE WITH AI', { bold: true, color: THEME.head }))
  rows.push(input('theme-brief', 'Design brief', studio.brief, act.brief))
  rows.push(text(ctx, studio.brief, { dimColor: true }))
  rows.push(pick('theme-generate-claude', 'Generate with Claude', () => act.generate('claude')))
  rows.push(pick('theme-generate-codex', 'Generate with Codex', () => act.generate('codex')))
  rows.push(text(ctx, 'Uses the bundled skill in AI Terminal. Paste its JSON below.'))
  rows.push(input('theme-import', 'Import theme JSON', '{"version":1,...}', act.import))
  rows.push(text(ctx, studio.message || 'Preview changes stay here until you save.', { color: THEME.info }))
  return col(ctx, rows, 'themes')
}
