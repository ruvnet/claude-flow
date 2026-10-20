/**
 * One-line usage hints for ruflo's own MCP tools (ADR-451). Every hint
 * restates what the project's CLAUDE.md already tells a person, so the model
 * sees it at the tool instead of only in a file it may not have loaded.
 * Static text only: `tool.describe` answers are cached for the session, and
 * an answer that changes spends the prompt cache.
 */
export const HINTS: Readonly<Record<string, string>> = {
  memory_search: 'Searches AgentDB only; memory_search_unified also covers Claude memories and patterns.',
  memory_store: 'Stores the value with a 384-dim ONNX embedding; give it a namespace.',
  swarm_init: 'For coding work use topology hierarchical, maxAgents 6-8, strategy specialized.',
  agent_spawn: 'Records the agent in ruflo coordination; Claude Code agents do the actual work.',
  hooks_route: 'Call before complex multi-file work to get the recommended agent and model tier.',
  guidance_brain: 'Call with mode recommend before complex ruflo work to read the live tool registry.',
}

/** The separator that marks a description a hint was already added to. */
export const MARK = '\n\nruflo: '

export const MAX_HINT_CHARS = 160

/** The server prefixes ruflo's MCP tools are listed under; nothing else is touched. */
export const RUFLO_TOOL_NAME = /^mcp__(?:plugin_ruflo-core_ruflo|claude-flow|ruflo)__([a-z0-9_-]+)$/

/** The hint for a tool as the model sees it by name, or undefined. */
export function hintFor(tool: string): string | undefined {
  const name = RUFLO_TOOL_NAME.exec(tool)?.[1]
  const hint = name === undefined ? undefined : Object.hasOwn(HINTS, name) ? HINTS[name] : undefined
  return hint !== undefined && hint.length <= MAX_HINT_CHARS ? hint : undefined
}

/** The description with the hint added once; anything unexpected is returned as it came. */
export function withHint(tool: string, description: unknown): unknown {
  if (typeof description !== 'string' || description.includes(MARK)) return description
  const hint = hintFor(tool)
  return hint === undefined ? description : `${description}${MARK}${hint}`
}
