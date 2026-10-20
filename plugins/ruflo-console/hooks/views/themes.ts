import type { RenderElement } from 'claude-code'
import { activeTheme, COLOR_KEYS, contrast, lowContrast, themeLayout, themesOf, THEME_PRESETS } from '../themes'
import { button, clip, col, picture, row, text, THEME, type Ctx } from './common'

/** One focused editor beside its live preview. Narrow panes stack without shrinking text. */
export function themesView(ctx: Ctx): RenderElement {
  const studio = themesOf(ctx.state), act = ctx.act.themes, layout = themeLayout(ctx.columns)
  const edit: Ctx = { ...ctx, columns: Math.max(1, layout.controls - 2) }
  const preview: Ctx = { ...ctx, columns: Math.max(1, layout.preview - 2) }
  const pick = (key: string, label: string, run: () => void) => button(edit, key, clip(label, Math.max(1, edit.columns - 3)), run)
  const input = (key: string, label: string, placeholder: string, submit: (value: string) => void) => ctx.kit.Input
    ? ctx.kit.Input({ key, label: clip(label, edit.columns), placeholder, submitLabel: 'set', onSubmit: submit })
    : text(edit, `${label}: text input unavailable`, { dimColor: true })
  const panel = (key: string, width: number, rows: RenderElement[]) => ctx.kit.Box({ key, width, flexDirection: 'column', borderStyle: 'single', borderColor: THEME.head, children: rows })
  const selected = studio.selected ?? ctx.state.options.look
  const choices: RenderElement[] = [text(edit, '01  LOOK', { bold: true, color: THEME.head })]
  for (const id of ['bbs', 'plain', 'orbital'] as const) choices.push(pick(`theme-${id}`, `${selected === id ? '●' : '○'} ${id === 'bbs' ? 'Classic BBS' : id === 'plain' ? 'Terminal plain' : 'Orbital'}`, () => act.select(id)))
  choices.push(text(edit, 'COLOR PRESETS', { color: THEME.info }))
  for (const { id, theme } of THEME_PRESETS) choices.push(row(edit, [
    ctx.kit.Text({ color: theme.palette.head, backgroundColor: theme.palette.background, children: ' ▄▄ ' }),
    pick(`theme-preset-${id}`, clip(`${selected === `preset:${id}` ? '●' : '○'} ${theme.name}`, Math.max(1, edit.columns - 7)), () => act.select(`preset:${id}`)),
  ]))
  for (const theme of studio.saved) choices.push(pick(`theme-custom-${theme.name}`, `${selected === `custom:${theme.name}` ? '●' : '○'} ${theme.name}`, () => act.select(`custom:${theme.name}`)))
  choices.push(text(edit, '02  CUSTOMIZE', { bold: true, color: THEME.head }))
  const tabs = (['colors', 'motion', 'generate'] as const).map(tab => pick(`theme-tab-${tab}`, `${studio.tab === tab ? '▸' : '·'} ${tab === 'generate' ? 'AI' : tab}`, () => act.tab(tab)))
  choices.push(edit.columns >= 31 ? row(edit, tabs) : col(edit, tabs))
  if (studio.tab === 'colors') {
    choices.push(input('theme-name', 'Name', studio.draft.name, act.name))
    // Each color role is its own labelled swatch. Only the selected role opens an editor.
    for (const key of COLOR_KEYS) choices.push(row(edit, [ctx.kit.Text({ color: studio.draft.palette[key], backgroundColor: studio.draft.palette.background, children: ' ▄▄ ' }), pick(`theme-role-${key}`, clip(`${studio.role === key ? '▸' : '·'} ${key.padEnd(10)} ${studio.draft.palette[key]}`, Math.max(1, edit.columns - 7)), () => act.role(key))]))
    choices.push(text(edit, `Editing ${studio.role}`, { color: THEME.head }))
    const colors = ['#f06449', '#72c79b', '#78c8ff', '#ca9bff', '#ffcf73', '#f2f4f3', '#000000', '#101820']
    const perRow = edit.columns >= 24 ? 4 : 2
    for (let i = 0; i < colors.length; i += perRow) choices.push(row(edit, colors.slice(i, i + perRow).map((color, j) => col(edit, [ctx.kit.Text({ color, backgroundColor: studio.draft.palette.background, children: ' ▄▄▄ ' }), pick(`theme-swatch-${i + j}`, String(i + j + 1), () => act.color(studio.role, color))]))))
    choices.push(input('theme-color', 'Hex color', studio.draft.palette[studio.role], value => act.color(studio.role, value)))
    const ratio = Math.min(...COLOR_KEYS.filter(key => key !== 'background').map(key => contrast(studio.draft.palette[key], studio.draft.palette.background)))
    choices.push(text(edit, `Minimum contrast ${ratio.toFixed(1)}:1`, { color: ratio >= 3 ? THEME.ok : THEME.warn }))
  } else if (studio.tab === 'motion') {
    choices.push(text(edit, 'DECORATIVE LAYERS', { color: THEME.info }))
    for (const key of ['stars', 'globe', 'topology'] as const) choices.push(pick(`theme-motion-${key}`, `${studio.draft.motion[key] ? '● ON ' : '○ OFF'} ${key}`, () => act.motion(key, !studio.draft.motion[key])))
    choices.push(text(edit, 'PLAYBACK SPEED', { color: THEME.info }))
    for (const speed of [0.25, 0.5, 1, 2]) choices.push(pick(`theme-speed-${speed}`, `${studio.draft.motion.speed === speed ? '●' : '○'} ${speed}x ${speed === 0.25 ? 'ambient' : speed === 0.5 ? 'calm' : speed === 1 ? 'standard' : 'fast'}`, () => act.motion('speed', speed)))
    choices.push(text(edit, ctx.state.options.fps === 0 ? 'Reduced motion: still preview' : 'Set fps to 0 for reduced motion.', { dimColor: true }))
  } else {
    choices.push(text(edit, 'DESCRIBE YOUR THEME', { color: THEME.info }))
    choices.push(input('theme-brief', 'Design brief', studio.brief, act.brief))
    choices.push(pick('theme-generate-claude', 'Generate with Claude', () => act.generate('claude')))
    choices.push(pick('theme-generate-codex', 'Generate with Codex', () => act.generate('codex')))
    choices.push(text(edit, '1. Generate in AI Terminal', { dimColor: true }))
    choices.push(text(edit, '2. Import returned JSON', { dimColor: true }))
    choices.push(text(edit, '3. Preview and save', { dimColor: true }))
    choices.push(input('theme-import', 'Import theme JSON', '{"version":1,...}', act.import))
  }
  const low = lowContrast(studio.draft)
  if (low.length) choices.push(text(edit, `Low contrast: ${low.join(', ')}`, { color: THEME.warn }))
  choices.push(text(edit, '03  APPLY', { bold: true, color: THEME.head }))
  choices.push(pick('theme-save', studio.saving ? 'Saving…' : 'Save and apply', act.save))
  choices.push(pick('theme-discard', 'Discard draft changes', act.discard))
  choices.push(pick('theme-reset', 'Use configured look', act.reset))
  choices.push(text(edit, studio.message || 'Draft only until saved.', { dimColor: true }))
  const stage = [text(preview, `LIVE PREVIEW / ${studio.draft.name}`, { bold: true, color: studio.draft.palette.head }),
    ...(studio.draft.motion.globe ? [picture(preview, 'theme-globe', 'Globe preview')] : [text(preview, 'Globe layer off', { dimColor: true })]),
    picture(preview, 'theme-preview', 'Swarm preview'),
    text(preview, `${studio.draft.motion.speed}x motion / ${ctx.state.options.fps === 0 ? 'paused' : 'animated'} / illustrative`, { dimColor: true }),
    (preview.columns >= 18 ? row : col)(preview, [text(preview, ' PASS ', { color: studio.draft.palette.ok }), text(preview, ' WARN ', { color: studio.draft.palette.warn }), text(preview, ' FAIL ', { color: studio.draft.palette.bad })]),
  ]
  return col(ctx, [text(ctx, `THEME STUDIO / active: ${studio.active ? activeTheme(ctx.state).name : ctx.state.options.look}`, { bold: true, color: THEME.head }),
    ctx.kit.Box({ key: 'theme-layout', flexDirection: layout.wide ? 'row' : 'column', gap: layout.wide ? 2 : 1, children: layout.wide ? [panel('theme-editor', layout.controls, choices), panel('theme-stage', layout.preview, stage)] : [panel('theme-stage', layout.preview, stage), panel('theme-editor', layout.controls, choices)] }),
  ], 'themes')
}
