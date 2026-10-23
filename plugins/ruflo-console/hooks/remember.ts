/**
 * "Always allow this kind of action": a person may tell the console not to ask again for one kind of low-risk ruflo
 * command (spawning a hive scout, say), and Settings lists and forgets each one. Only a plain ruflo CLI command can be
 * remembered: never one that reaches the network, spends money, deletes, publishes, registers, grants, restarts, changes
 * configuration or secrets, runs another program, or takes input on stdin. A kind is the ruflo command (for `mcp exec`,
 * its tool), so "spawn a scout" and "spawn a coder" are the same kind (`mcp hive-mind_spawn`).
 */
import type { ActionSpec } from './actions'
import { plain } from './data/parse'
import type { Host } from './host'
import type { State } from './state'

export const ALLOWED_KEY = 'allowed-actions'

/** A note naming any of these says the action leaves the machine, costs, or destroys: it always asks. */
const RISKY_NOTE = /network|clone|fetch|reaches|spend|money|budget|billed|cost|delete|remove|erase|purge|publish|register|secret|token|credential|overwrite|restart|writes? (your|the) (settings|config)/i

/** A command (or MCP tool) word that is destructive, public, or authority-changing. */
const RISKY_WORD = /(^|[_\s-])(delete|rm|remove|purge|reset|shutdown|terminate|stop|uninstall|destroy|revoke|publish|register|join|grant|admit|import|export|restore|rollback|deploy|promote|clear|wipe|kill|cancel|steal|handoff|invite|sign|config|federation|install|update|migrate|cleanup|mission_request_action)([_\s-]|$)/i

/** The kind of action a spec is, when it may be remembered; null when it must always ask. */
export function rememberKey(spec: ActionSpec): string | null {
  if (spec.argv !== undefined || spec.write !== undefined || spec.run !== undefined || spec.isReadOnly === true || spec.stdin !== undefined) return null

  const words = spec.args.join(' ')

  if (spec.args.length === 0 || RISKY_WORD.test(words) || (spec.note !== undefined && RISKY_NOTE.test(spec.note))) return null

  const tool = spec.args[0] === 'mcp' && spec.args[1] === 'exec' ? spec.args[spec.args.indexOf('-t') + 1] : undefined
  const key = tool !== undefined ? `mcp ${tool}` : spec.args.slice(0, 2).join(' ')

  return /^[A-Za-z0-9_. :-]{1,80}$/.test(key) ? key : null
}

/** Loads what was remembered: bad entries are dropped. */
export async function loadAllowed(state: State, host: Host): Promise<void> {
  const saved = await host.storeGet(ALLOWED_KEY).catch(() => undefined)

  if (!Array.isArray(saved)) return

  for (const entry of saved.slice(0, 200)) {
    if (Array.isArray(entry) && typeof entry[0] === 'string' && typeof entry[1] === 'string' && /^[A-Za-z0-9_. :-]{1,80}$/.test(entry[0])) state.allowed.set(entry[0], plain(entry[1], 120))
  }
}

export function saveAllowed(state: State, host: Host): void {
  void host.storeSet(ALLOWED_KEY, [...state.allowed.entries()]).catch(() => undefined)
}
