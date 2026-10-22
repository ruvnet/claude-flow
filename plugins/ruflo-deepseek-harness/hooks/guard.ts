import { hasSecret } from './screen'

/** A shell command that runs this plugin's scripts (from the repo, or from an installed copy under a version directory): they post the prompt to api.deepseek.com, a third party. */
const RUNS_HARNESS = /ruflo-deepseek-harness\/(?:[\w.@-]+\/)*scripts\/(?:chat|reason|_deepseek)\.mjs/

/** The reason a DeepSeek call is refused, or undefined when it may go. Never names or echoes the secret. */
export function verdict(tool: string, input: unknown): string | undefined {
  if (tool !== 'Bash') return undefined
  const command = typeof input === 'object' && input !== null ? (input as { command?: unknown }).command : undefined
  if (typeof command !== 'string' || !RUNS_HARNESS.test(command)) return undefined
  return hasSecret(command)
    ? 'ruflo-deepseek-harness: this prompt holds what looks like a secret (a key, token or password) and would be sent to api.deepseek.com. Remove it and run again.'
    : undefined
}
