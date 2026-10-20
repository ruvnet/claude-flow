import type { AgentSpawnInput, RenderInput, SessionStartInput } from 'claude-code'

export const PLUGIN = 'ruflo-swarm'
export const CWD = '/work'

export const SESSION: SessionStartInput = { surface: 'terminal', isInteractive: true, cwd: CWD }

export const HINT: RenderInput<'PromptHint'> = {
  component: 'PromptHint',
  surface: 'terminal',
  requestId: 'hint',
  viewport: { columns: 180, rows: 48, isFullscreen: true },
  props: { isDraft: false, isWorking: false, hint: '' },
}

export const MAIN_SCREEN_HINT: RenderInput<'PromptHint'> = { ...HINT, viewport: { columns: 180, rows: 48, isFullscreen: false } }

/** The swarm pane as the engine asks for it, docked, 72 columns of body and 44 rows. */
export const PANE: RenderInput<'Pane'> = {
  component: 'Pane',
  surface: 'terminal',
  requestId: 'ruflo-swarm',
  viewport: { columns: 180, rows: 48, isFullscreen: true },
  props: { title: 'Swarm', isFocused: false, bodyColumns: 73, placement: 'dock', scroll: { offset: 0, bodyRows: 44 }, view: {} },
}

export const paneAt = (bodyColumns: number, bodyRows = 44): RenderInput<'Pane'> => ({ ...PANE, props: { ...PANE.props, bodyColumns, scroll: { offset: 0, bodyRows } } })

export const command = (name: string, args = '') => ({
  command: name,
  args,
  origin: { kind: 'composer' as const },
  presentation: { isFullscreen: true, columns: 180 },
})

/** An Agent tool's spawn as the engine raises it, with what the caller asked for. */
export const spawn = (subagentType: string, prompt: string, name?: string): AgentSpawnInput => ({
  tool_use_id: `toolu_${subagentType.replace(/\W/g, '')}`,
  prompt,
  description: prompt.slice(0, 30),
  subagentType,
  provider: { plugin: 'engine', tier: 'core' },
  parentModel: 'claude-opus-5-5',
  background: true,
  fork: false,
  ...(name !== undefined && { name }),
})
