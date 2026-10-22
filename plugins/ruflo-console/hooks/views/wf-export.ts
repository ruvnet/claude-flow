/**
 * Export on the Workflows page (ADR-461): a board slot that writes the picked run's summary as markdown to a path the person
 * names inside the project (or the scratchpad, once `setExportRoots` told it where that is). The path is checked
 * (data/wf-file.ts: no `..`, no link on the way, nothing overwritten), the text is masked (data/wf-export.ts), and the write goes
 * through the confirm card as a fixed argv. Registered by importing views/wf-replay.ts.
 */
import type { RenderElement } from 'claude-code'

import { exportName, exportSpec, runMarkdown, type ExportCost } from '../data/wf-export'
import { checkNoLinks, dirOf, EXPORT_DIR, resolveExportPath, type Roots } from '../data/wf-file'
import { writeFlavorReady } from '../data/write-flavor'
import { button, clip, row, text, THEME } from './common'
import { fold, redraw } from './wf-fold'
import { registerSlot, type SlotEnv } from './wf-slots'
import type { WfRun } from '../data/workflows'

type StatFs = Parameters<typeof checkNoLinks>[0]

let scratch: string | null = null
/** The stat the link check needs. A slot is handed no host, so the wiring supplies it once (`setExportFs(host.fs)`); until then no path can be checked and every export is refused. */
let fsOf: StatFs | null = null
let costOf: (run: WfRun) => ExportCost | null = () => null
const said = new Map<string, { ok: boolean; text: string }>()

export const setExportFs = (fs: StatFs | null): void => void (fsOf = fs)

/** The scratchpad folder a summary may also be written under, where the host tells the console (never guessed). */
export const setExportRoots = (scratchDir: string | null): void => void (scratch = scratchDir)

/** Where a per-run cost comes from, if anywhere: without one the summary says n/a. */
export const setExportCostSource = (source: (run: WfRun) => ExportCost | null): void => void (costOf = source)

/** For tests. */
export function resetExport(): void {
  said.clear()
  scratch = null
  fsOf = null
  costOf = () => null
}

export const rootsOf = (cwd: string): Roots => ({ cwd, scratch })
export const defaultPathOf = (cwd: string, run: WfRun): string => `${cwd.replace(/\/+$/, '')}/${EXPORT_DIR}/${exportName(run)}`

/** Checks the path and, if it passes, asks the runner for the write. Resolves with what to tell the person; never throws. */
export async function requestExport(env: Pick<SlotEnv, 'ctx' | 'nowMs'>, run: WfRun, input: string, fs: StatFs | null): Promise<{ ok: boolean; text: string }> {
  const roots = rootsOf(env.ctx.state.cwd)
  const wanted = resolveExportPath(input, roots)

  if (!wanted.ok) return { ok: false, text: wanted.why }

  if (fs === null) return { ok: false, text: 'the host\'s file reader is not wired to this page, so a path cannot be checked: nothing is written' }

  const clear = await checkNoLinks(fs, wanted.path, roots)

  if (!clear.ok) return { ok: false, text: clear.why }

  const markdown = runMarkdown(run, { nowMs: env.nowMs, cost: costOf(run) })

  const hasDir = (await fs.stat(dirOf(clear.path)).catch(() => undefined)) !== undefined

  env.ctx.act.workflows.ask(exportSpec(clear.path, markdown, clip(run.name, 40), hasDir, await writeFlavorReady()), 'that summary cannot be written')

  return { ok: true, text: `asked: confirm below to write ${clear.path}` }
}

export function exportBody(env: SlotEnv, run: WfRun, fs: StatFs | null): RenderElement[] {
  const { ctx } = env
  const note = said.get(run.id)
  const go = (input: string): void => {
    void requestExport(env, run, input, fs).then(result => {
      said.set(run.id, result)
      redraw(ctx)
    })
  }
  const roots = rootsOf(ctx.state.cwd)

  return [
    text(ctx, ` Writes a markdown summary: phases, agents, tokens, time, results (cost: n/a unless a source is wired). Credentials and control characters are masked.`, { dimColor: true }),
    text(ctx, ` Allowed: under ${clip(roots.cwd, 40)}${roots.scratch === null || roots.scratch === undefined ? '' : ` or ${clip(roots.scratch, 40)}`} · name ends in .md · no .. · never overwrites · you confirm first`, { dimColor: true }),
    ctx.kit.Input === undefined ? text(ctx, ' This surface has no text field: use the default path button.', { dimColor: true }) : ctx.kit.Input({ key: 'wf-export-path', label: 'path', placeholder: `${EXPORT_DIR}/${exportName(run)}`, submitLabel: 'export', onSubmit: value => go(value) }),
    row(ctx, [button(ctx, 'wf-export-default', 'Export to the default path', () => go(defaultPathOf(ctx.state.cwd, run)))], 'wf-export-controls'),
    ...(note === undefined ? [] : [text(ctx, ` ${note.text}`, note.ok ? { color: THEME.ok } : { color: THEME.warn })]),
  ]
}

registerSlot({
  kind: 'board',
  id: 'export',
  title: 'Export run summary',
  order: 60,
  render: env => {
    const run = env.run

    if (run === null) return []
    if (run.kind !== 'workflow') return [text(env.ctx, ' Export is for Claude Code workflow runs.', { dimColor: true })]

    return fold(env.ctx, 'export', `${EXPORT_DIR}/${clip(exportName(run), 40)} (default)`, () => exportBody(env, run, fsOf))
  },
})

