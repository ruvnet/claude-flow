/**
 * A run summary as markdown (ADR-461): phases, agents, results and, where a figure exists, tokens, time and cost. Pure.
 * Every string that came from a file passes `cleanText` (control characters out, credential shapes masked) and has table
 * characters escaped, so a label cannot break a row and a token in a result cannot reach the summary. A figure nobody
 * recorded reads n/a: the console holds no per-run cost, so cost is shown only when the caller hands one over with its source.
 */
import { isoOf } from './safe'
import type { ActionSpec } from '../actions'
import { newFileArgv } from './wf-file'
import type { WriteFlavor } from './write-flavor'
import { cleanText } from './wf-clean'
import { fmtElapsed, fmtTokens, modelName, type WfAgent, type WfRun } from './workflows'

/** A summary over this is cut at a line break and says so at the end: a run with thousands of agents does not make a megabyte file. */
export const MAX_EXPORT_BYTES = 200_000

export type ExportCost = { usd: number | null; /** Where the figure comes from, in words ("cost ledger, Claude Code logs"). */ source: string }

/** Table cell text: cleaned, one line, `|` escaped. */
const cell = (value: string | undefined, max = 80): string => (value === undefined || value === '' ? 'n/a' : cleanText(value).replace(/\s+/g, ' ').replace(/[|\\`]/g, ch => `\\${ch}`).slice(0, max))
const line = (value: string): string => cleanText(value).replace(/\s+/g, ' ')
/** UTF-8 size of a text, from the platform's own encoder. */
const BYTES = (text: string): number => new TextEncoder().encode(text).length
const when = (ms: number | undefined): string => isoOf(ms)

function agentRows(agents: readonly WfAgent[]): string[] {
  return [
    '| Agent | State | Model | Tokens | Time | Tools |',
    '| --- | --- | --- | --- | --- | --- |',
    ...agents.map(agent => `| ${cell(agent.label)} | ${agent.state} | ${agent.model === undefined ? 'n/a' : cell(modelName(agent.model), 30)} | ${fmtTokens(agent.tokens, agent.isTokensPartial)} | ${fmtElapsed(agent.elapsedMs)} | ${agent.toolCalls ?? 'n/a'} |`),
  ]
}

export function runMarkdown(run: WfRun, options: { nowMs: number; cost?: ExportCost | null }): string {
  const cost = options.cost
  const out: string[] = [
    `# Workflow run: ${line(run.name)}`,
    '',
    `Exported ${when(options.nowMs)} from the ruflo console. Read-only: nothing here changes the run.`,
    '',
    '| | |',
    '| --- | --- |',
    `| Run | ${cell(run.id)} |`,
    `| State | ${run.state} |`,
    `| Started | ${when(run.startedMs)} |`,
    `| Duration | ${fmtElapsed(run.durationMs)} |`,
    `| Agents | ${run.total} (${run.done} done, ${run.failed} failed, ${run.running} running) |`,
    `| Tokens | ${run.totalTokens === null ? 'n/a' : `${fmtTokens(run.totalTokens, run.isTokensPartial)} (the sum of each agent's context at its latest request)`} |`,
    `| Cost | ${cost === undefined || cost === null || cost.usd === null ? 'n/a (no cost source for this run)' : `$${cost.usd.toFixed(2)} (${cell(cost.source, 60)})`} |`,
    '',
  ]

  for (const [index, phase] of run.phases.entries()) {
    out.push(`## ${index + 1}. ${line(phase.title)}`, '', `${phase.done}/${phase.total} done${phase.failed > 0 ? `, ${phase.failed} failed` : ''}${phase.detail === undefined ? '' : ` · ${line(phase.detail)}`}`, '')
    out.push(...(phase.agents.length === 0 ? ['No agent started in this phase.'] : agentRows(phase.agents)), '')
  }

  const results = run.phases.flatMap(phase => phase.agents).filter(agent => agent.resultPreview !== undefined)

  if (results.length > 0) {
    out.push('## Results', '')

    for (const agent of results) out.push(`- **${cell(agent.label, 60)}** (${agent.state}): ${line(agent.resultPreview ?? '')}`)

    out.push('', 'Results are the first 160 characters of what each agent reported, with anything shaped like a key or token masked.', '')
  }

  out.push('## Provenance', '', run.hasRecord ? 'Figures are from the run record Claude Code wrote when the run finished.' : 'Figures are derived from the journal and transcripts of a run that has no finished record; they can still move.', '')

  return capped(out.join('\n'))
}

function capped(text: string): string {
  if (BYTES(text) <= MAX_EXPORT_BYTES) return `${text.trimEnd()}\n`

  let head = text.slice(0, MAX_EXPORT_BYTES - 200)

  // The cap is in bytes: shrink until multi-byte text fits too.
  while (BYTES(head) > MAX_EXPORT_BYTES - 200) head = head.slice(0, Math.floor(head.length * 0.9))

  return `${head.slice(0, Math.max(0, head.lastIndexOf('\n'))).trimEnd()}\n\n> Cut here: this summary is capped at ${MAX_EXPORT_BYTES / 1000} kB. The run itself is unchanged.\n`
}

/** The confirm-gated write of a summary: the card shows the path and size, the argv is fixed and the text goes in on stdin. */
export function exportSpec(path: string, markdown: string, label: string, hasDir: boolean, flavor: WriteFlavor): ActionSpec {
  return {
    label: `write run summary: ${label}`,
    args: [],
    argv: newFileArgv(path, hasDir, flavor),
    stdin: markdown,
    ...(flavor === 'host-fs' && { write: { kind: hasDir ? 'create-excl' : 'create-dirs', path, text: markdown } as const }),
    expect: `a new file at ${path}`,
    declared: 'write',
    shows: `write ${path} (${BYTES(markdown)} bytes; never overwrites)`,
    note: 'writes one new markdown file inside the project or the scratchpad; a file that already exists makes it fail instead of replacing it; a missing folder is made first',
    timeoutMs: 10_000,
    verifyLocal: async host => (await host.fs.stat(path).catch(() => undefined)) !== undefined,
  }
}

/** A file name for a run's summary: its name and id with anything unsafe turned into a dash. */
export const exportName = (run: WfRun): string => `${(run.name === run.id ? run.id : `${run.name}-${run.id}`).replace(/[^A-Za-z0-9._-]+/g, '-').replace(/^[^A-Za-z0-9]+/, '').slice(0, 90) || 'run'}.md`
