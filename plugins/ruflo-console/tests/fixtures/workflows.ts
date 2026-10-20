/**
 * Workflow run files with the SHAPE of a real Claude Code run (journal, agent meta, transcript, run record, script) and
 * invented content. Timestamps are fixed so elapsed and staleness are exact.
 */
export const T0 = Date.parse('2026-10-06T01:30:00.000Z')
const iso = (offsetS: number): string => new Date(T0 + offsetS * 1000).toISOString()

export const started = (agentId: string, label: string, phase: string): string => JSON.stringify({ type: 'started', key: `v2:${agentId}`, agentId, label, phase })
export const result = (agentId: string, value: unknown): string => JSON.stringify({ type: 'result', key: `v2:${agentId}`, agentId, result: value })

export const journal = (...lines: string[]): string => [JSON.stringify({ type: 'launched' }), ...lines].join('\n') + '\n'

export const meta = (description: string, phase: string, extra: Record<string, unknown> = {}): string => JSON.stringify({ agentType: 'workflow-subagent', description, workflowPhase: phase, spawnDepth: 1, requestShape: 'foreground', requestNonInteractive: false, ...extra })

type Turn = { at: number; id: string; model?: string; input: number; write: number; read: number; output: number; tool?: string }

/** Assistant lines the way streaming writes them: one message id appears on several lines. */
export const transcript = (turns: readonly Turn[], opts: { userAt?: number } = {}): string => {
  const lines = [JSON.stringify({ type: 'user', timestamp: iso(opts.userAt ?? 0), message: { role: 'user', content: 'task' } })]

  for (const t of turns) {
    const base = { type: 'assistant', timestamp: iso(t.at), message: { id: t.id, model: t.model ?? 'claude-sonnet-5-5', role: 'assistant', content: t.tool === undefined ? [{ type: 'text', text: 'ok' }] : [{ type: 'tool_use', id: `tu-${t.id}`, name: t.tool }], usage: { input_tokens: t.input, cache_creation_input_tokens: t.write, cache_read_input_tokens: t.read, output_tokens: t.output } } }

    lines.push(JSON.stringify({ ...base, message: { ...base.message, usage: { ...base.message.usage, output_tokens: 3 } } }), JSON.stringify(base))
  }

  return lines.join('\n') + '\n'
}

export const record = (over: Record<string, unknown> = {}): string =>
  JSON.stringify({
    runId: 'wf_rec',
    status: 'completed',
    workflowName: 'demo-run',
    startTime: T0,
    durationMs: 90_000,
    totalTokens: 400_000,
    defaultModel: 'claude-opus-5-5',
    phases: [{ title: 'Build', detail: 'one writer per feature' }, { title: 'Review' }],
    workflowProgress: [
      { type: 'workflow_phase', index: 1, title: 'Build' },
      { type: 'workflow_agent', label: 'build:a', phaseTitle: 'Build', agentId: 'ra1', model: 'claude-sonnet-5-5', state: 'done', startedAt: T0, tokens: 181_212, toolCalls: 20, durationMs: 60_000, lastToolName: 'Bash' },
      { type: 'workflow_agent', label: 'build:b', phaseTitle: 'Build', agentId: 'ra2', state: 'failed', startedAt: T0, tokens: 1_200, durationMs: 5_000 },
      { type: 'workflow_agent', label: 'review:a', phaseTitle: 'Review', agentId: 'ra3', state: 'done', startedAt: T0 + 60_000, tokens: 90_000, durationMs: 30_000 },
    ],
    ...over,
  })

export const SCRIPT = `export const meta = {
  name: 'demo-run',
  description: 'x',
  phases: [{ title: 'Build', detail: 'one writer per feature' }, { title: 'Tune' }, { title: 'Review', detail: 'adversarial' }],
}
const COMMON = 'phases: [{ title: "Not This" }]'
`
