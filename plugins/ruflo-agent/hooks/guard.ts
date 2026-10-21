import { hasSecret } from './screen'
import { textsOf } from './screen'
export { textsOf }

/** `mcp__<server>__<tool>` into its two halves; tool names never hold a double underscore. */
export function splitName(name: string): { server: string; tool: string } | undefined {
  if (!name.startsWith('mcp__')) return undefined
  const at = name.lastIndexOf('__')
  return at > 5 ? { server: name.slice(5, at), tool: name.slice(at + 2) } : undefined
}

/** True for the tool calls this plugin guards: text sent into an agent runtime (`wasm_agent_prompt`, `wasm_agent_tool`, `wasm_agent_create`, `wasm_gallery_create`, `managed_agent_create`, `managed_agent_prompt`). */
export function owns(tool: string, input: unknown): boolean {
  const parts = splitName(tool)
  const name = parts?.tool ?? tool
  return ['wasm_agent_prompt', 'wasm_agent_tool', 'wasm_agent_create', 'wasm_gallery_create', 'managed_agent_create', 'managed_agent_prompt'].includes(name)
}

/** The reason a call is refused, or undefined when it may go. Never names or echoes the secret. */
export function verdict(tool: string, input: unknown): string | undefined {
  if (!owns(tool, input)) return undefined
  return textsOf(input).some(hasSecret) ? "ruflo-agent: this agent input holds what looks like a secret (a key, token or password). An agent runtime, and a cloud one above all, must not be handed the value; pass a reference instead." : undefined
}
