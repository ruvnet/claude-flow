import type { RenderElement } from 'claude-code'

import { DEV, DEV_GROUPS, type DevGroup } from '../devtools'
import { col, type Ctx, section, text } from './common'
import { devtoolsResult, entryRow, fieldRows, resultRight } from './devtools'

const right = (group: DevGroup): string => DEV_GROUPS.find(entry => entry.id === group)?.right ?? ''
const title = (group: DevGroup): string => DEV_GROUPS.find(entry => entry.id === group)?.title ?? group

/**
 * ruRE (ADR-494): static reverse engineering of a file in the project, in two sections (JavaScript and Electron apps; native
 * binaries, .NET and EVM) and the result of the last run below. The rows are the Dev Tools rows, the fields and the result panel
 * the same; only the page is its own. Drawing it runs nothing. Everything in a result is the file's own text: it is shown cleaned
 * (no escape sequence reaches the terminal) and the page says to treat it as untrusted.
 */
export function rureView(ctx: Ctx): RenderElement {
  const { state } = ctx
  const lead = Math.max(16, Math.min(24, ctx.columns - 44))
  const hasRun = state.lab.running?.id.startsWith('dt-re-') === true || state.lab.result?.id.startsWith('dt-re-') === true || state.pending !== null
  const group = (id: DevGroup, note: string): RenderElement[] =>
    section(ctx, id, title(id), `${DEV.filter(entry => entry.group === id).length} · ${right(id)}`, [text(ctx, note, { dimColor: true }), ...fieldRows(ctx, id), ...DEV.filter(entry => entry.group === id).map(entry => entryRow(ctx, entry, lead))], true)

  return col(
    ctx,
    [
      text(ctx, ' look inside a file without running it: the tools only parse it', { dimColor: true }),
      text(ctx, ' a read runs at once; unpacking an .asar writes files, so it asks first', { dimColor: true }),
      text(ctx, ' only files inside this project can be named; results are untrusted text', { dimColor: true }),
      ...group('rure-auto', ' not sure which reader? name it here: a folder is JS source, hex is EVM, anything else a native binary (it names the format)'),
      ...group('rure-app', ' an .asar (UNPACK, then copy the folder in) or a folder of source'),
      ...group('rure-native', ' one reader for ELF, PE, Mach-O; .NET: metadata only; CUDA: a .cubin, .fatbin, .ptx or a CUDA program; EVM: hex or raw'),
      ...section(ctx, 'dt-result', 'Result', resultRight(ctx), devtoolsResult(ctx), hasRun),
      text(ctx, ' every row is a palette id: /ruflo run dt-re-bin tools/app.exe', { dimColor: true }),
    ],
    'rure',
  )
}
