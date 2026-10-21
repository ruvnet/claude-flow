import { hasSecret } from './screen'
import { textsOf } from './screen'
export { textsOf }

/** The tool's short name: `mcp__<server>__<tool>` to `<tool>`. */
export const shortName = (name: string) => (name.startsWith('mcp__') && name.lastIndexOf('__') > 5 ? name.slice(name.lastIndexOf('__') + 2) : name)

const field = (input: unknown, key: string): string => {
  const v = typeof input === 'object' && input !== null ? (input as Record<string, unknown>)[key] : undefined
  return typeof v === 'string' ? v : ''
}

const FLOW = new Set(['workflow_create', 'workflow_run', 'workflow_execute', 'workflow_template'])
const MEMORY = new Set(['memory_store', 'agentdb_hierarchical-store', 'agentdb_pattern-store'])
const NS = /^(?:gaia|workflow)/i
// An id that stands for many workflows, or for none.
const BROAD = /^(?:\*|all|\.|\.\.|%|\.\*)?$/i

/** The label of a workflow call, else undefined: the guard only watches workflow tools and gaia/workflow memory writes. */
export function watched(tool: string, input: unknown): string | undefined {
  const t = shortName(tool)
  if (t === 'workflow_delete') return 'workflow delete'
  if (FLOW.has(t)) return t.replace('_', ' ')
  if (MEMORY.has(t) && NS.test(field(input, 'namespace'))) return 'gaia/workflow memory write'
  return undefined
}

/** The reason a call is refused, or undefined when it may go. Never names or echoes the secret. */
export function verdict(tool: string, input: unknown): string | undefined {
  const label = watched(tool, input)
  if (label === undefined) return undefined
  if (label === 'workflow delete') {
    return BROAD.test(field(input, 'workflowId').trim())
      ? 'ruflo-workflows: a delete must name one workflow id. List the workflows and delete a specific one.'
      : undefined
  }
  return textsOf(input).some(hasSecret)
    ? 'ruflo-workflows: this workflow or run record holds what looks like a secret (a key, token or password). Reference the secret by name and keep its value in the environment.'
    : undefined
}
