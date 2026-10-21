import { hasSecret, textsOf } from './screen'
import { bare, namespaceOf } from './tools'
import type { ModOptions } from './options'

const IOT_NS = /^iot-/i
/** The plugin's CLI; its skills run it through Bash. */
const CLI = /\bcognitum-iot\b/
// Deleting a fleet, or deleting/revoking/decommissioning a device, is not undone by a rollback.
const DESTRUCTIVE = /\b(?:fleet\s+delete|device\s+(?:delete|remove|revoke|decommission|deregister))\b/
// An explicit go-ahead the person has given: a flag, or an env prefix (which the CLI never sees as an unknown option). Not `-y`: that is npx's own flag.
const CONFIRMED = /(?:^|\s)(?:--confirm|--yes)(?:\s|=|$)|\bCOGNITUM_IOT_CONFIRM=1\b/

/** The reason an IoT call is refused, or undefined when it may go. Never names or echoes the value. */
export function verdict(tool: string, input: unknown, opts: ModOptions): string | undefined {
  const name = bare(tool)

  if (name === 'memory_store') {
    if (!IOT_NS.test(namespaceOf(input))) return undefined
    return textsOf(input).some(hasSecret)
      ? 'ruflo-iot-cognitum: this device record holds what looks like a secret (a device token, key or password). Store the device id, not the credential.'
      : undefined
  }

  if (name !== 'Bash') return undefined
  const command = (input as { command?: unknown } | null)?.command
  if (typeof command !== 'string' || !CLI.test(command)) return undefined

  if (hasSecret(command)) {
    return 'ruflo-iot-cognitum: this cognitum-iot command carries what looks like a secret on its command line. Pass it through the environment or a prompt, not as an argument.'
  }
  if (opts.confirmDestructive && DESTRUCTIVE.test(command) && !CONFIRMED.test(command)) {
    return 'ruflo-iot-cognitum: deleting a fleet or removing a device cannot be undone by a rollback. Ask the user first; once they agree, run it again prefixed with COGNITUM_IOT_CONFIRM=1.'
  }
  return undefined
}
